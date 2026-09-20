"""银行账户汇总。

财务中心的银行总览以“账户”为第一层、银行流水为事实来源。
本页只做只读聚合：
- 账户系统余额 = 期初余额 + 已导入全部收入 - 已导入全部支出
- 本期收入/支出/净流入按所选月份统计
- 收入是否已对账复用 reconciliation_matches confirmed
- 支出是否已对账按 tax_invoice_links(bank_transaction) 的确认分摊累计是否覆盖整笔付款判断

这里不把“系统余额”包装成银行实时余额；只有已导入流水才能参与计算。
"""
from __future__ import annotations

import calendar
from collections import defaultdict
from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.models.bank import BankAccount, BankTransaction
from app.services import payment_invoice_match_service, reconciliation


def _dec(value: Decimal | float | int | str | None) -> Decimal:
    if value is None:
        return Decimal("0")
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def _month_range(year: int, month: int) -> tuple[date, date]:
    if not (1 <= month <= 12):
        raise ValueError("月份必须在 1-12")
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, 1), date(year, month, last_day)


def build_summary(db: Session, *, year: int, month: int) -> dict[str, Any]:
    start, end = _month_range(year, month)
    accounts = db.query(BankAccount).order_by(BankAccount.id).all()
    transactions = db.query(BankTransaction).order_by(BankTransaction.txn_date, BankTransaction.id).all()
    month_txns = [row for row in transactions if start <= row.txn_date <= end]
    month_ids = [row.id for row in month_txns]

    confirmed_income_ids = reconciliation.confirmed_settlement_txn_ids(
        db, [row.id for row in month_txns if row.direction == "in"]
    )
    expense_ids = [row.id for row in month_txns if row.direction == "out"]
    confirmed_expense_ids = payment_invoice_match_service.fully_reconciled_txn_ids(db, expense_ids)

    account_ids = {row.id for row in accounts}
    all_by_account: dict[int | None, list[BankTransaction]] = defaultdict(list)
    month_by_account: dict[int | None, list[BankTransaction]] = defaultdict(list)
    for row in transactions:
        key = row.account_id if row.account_id in account_ids else None
        all_by_account[key].append(row)
    for row in month_txns:
        key = row.account_id if row.account_id in account_ids else None
        month_by_account[key].append(row)

    rows: list[dict[str, Any]] = []
    # 历史脏数据可能没有 account_id；保留一个“未归属账户”行，避免汇总静默丢金额。
    account_keys: list[int | None] = [row.id for row in accounts]
    if None in all_by_account:
        account_keys.append(None)

    total_balance = Decimal("0")
    monthly_income = Decimal("0")
    monthly_expense = Decimal("0")
    pending_income = 0
    pending_expense = 0

    account_map = {row.id: row for row in accounts}
    for account_id in account_keys:
        account = account_map.get(account_id) if account_id is not None else None
        all_rows = all_by_account.get(account_id, [])
        selected_rows = month_by_account.get(account_id, [])

        opening = _dec(account.opening_balance if account else None)
        all_income = sum((_dec(row.amount) for row in all_rows if row.direction == "in"), Decimal("0"))
        all_expense = sum((_dec(row.amount) for row in all_rows if row.direction == "out"), Decimal("0"))
        system_balance = opening + all_income - all_expense

        income = sum((_dec(row.amount) for row in selected_rows if row.direction == "in"), Decimal("0"))
        expense = sum((_dec(row.amount) for row in selected_rows if row.direction == "out"), Decimal("0"))
        account_pending_income = sum(
            1 for row in selected_rows if row.direction == "in" and row.id not in confirmed_income_ids
        )
        account_pending_expense = sum(
            1 for row in selected_rows if row.direction == "out" and row.id not in confirmed_expense_ids
        )
        last_txn_date = max((row.txn_date for row in all_rows), default=None)

        total_balance += system_balance
        monthly_income += income
        monthly_expense += expense
        pending_income += account_pending_income
        pending_expense += account_pending_expense

        rows.append({
            "accountId": account.id if account else None,
            "accountNo": account.account_no if account else "",
            "accountName": account.account_name if account else "未归属账户",
            "bankName": account.bank_name if account else "",
            "currency": account.currency if account else "CNY",
            "openingBalance": str(opening),
            "systemBalance": str(system_balance),
            "monthIncome": str(income),
            "monthExpense": str(expense),
            "monthNet": str(income - expense),
            "monthTxnCount": len(selected_rows),
            "pendingIncomeCount": account_pending_income,
            "pendingExpenseCount": account_pending_expense,
            "pendingCount": account_pending_income + account_pending_expense,
            "lastTxnDate": last_txn_date.isoformat() if last_txn_date else "",
            "balanceSource": "opening_plus_imported_transactions" if account and account.opening_balance is not None else "imported_transactions",
        })

    return {
        "year": year,
        "month": month,
        "summary": {
            "accountCount": len(account_keys),
            "systemBalance": str(total_balance),
            "monthIncome": str(monthly_income),
            "monthExpense": str(monthly_expense),
            "monthNet": str(monthly_income - monthly_expense),
            "monthTxnCount": len(month_txns),
            "pendingIncomeCount": pending_income,
            "pendingExpenseCount": pending_expense,
            "pendingCount": pending_income + pending_expense,
        },
        "accounts": rows,
    }
