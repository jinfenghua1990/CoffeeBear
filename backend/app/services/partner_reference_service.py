"""Canonical BusinessPartner reference materialization for Phase 1.

Phase 1 is intentionally narrow:
- BusinessPartner remains the single identity root.
- Existing confirmed BusinessPartnerLink rows are copied into nullable direct FKs.
- Legacy role JSON and bank-account identifiers are normalized into relational tables.
- Raw source names/tax numbers/accounts are never overwritten.
- No matching heuristics, master merging, UI behavior, or invoice/payment logic lives here.
"""

from __future__ import annotations

import re
import unicodedata
from collections import defaultdict
from typing import Any

from sqlalchemy.orm import Session

from app.models.alibaba1688_import import Alibaba1688Order
from app.models.bank import BankTransaction
from app.models.business_partner import (
    BusinessPartner,
    BusinessPartnerBankAccount,
    BusinessPartnerIdentifier,
    BusinessPartnerLink,
    BusinessPartnerRole,
)
from app.models.consumable_purchase import ConsumablePurchase
from app.models.jackyun import JackyunGoodsDocument, JackyunPurchaseReturn, JackyunPurchaseSettlement
from app.models.jky_web import JkyWebSalesOrder, JkyWebStockinOrder
from app.models.purchase import ExternalPurchaseOrder, JackyunPurchaseOrder, Supplier
from app.models.tax import TaxInvoice


ROLE_VALUES = {"supplier", "customer", "counterparty"}

SOURCE_BINDINGS: dict[tuple[str, str], tuple[type[Any], str]] = {
    ("supplier", "supplier"): (Supplier, "partner_id"),
    ("external_purchase_order", "supplier"): (ExternalPurchaseOrder, "supplier_partner_id"),
    ("alibaba1688_order", "supplier"): (Alibaba1688Order, "supplier_partner_id"),
    ("jackyun_purchase_order", "supplier"): (JackyunPurchaseOrder, "supplier_partner_id"),
    ("jackyun_purchase_settlement", "supplier"): (JackyunPurchaseSettlement, "supplier_partner_id"),
    ("jackyun_purchase_return", "supplier"): (JackyunPurchaseReturn, "supplier_partner_id"),
    ("consumable_purchase", "supplier"): (ConsumablePurchase, "supplier_partner_id"),
    ("inbound_document", "supplier"): (JackyunGoodsDocument, "supplier_partner_id"),
    ("jky_web_stockin_order", "supplier"): (JkyWebStockinOrder, "supplier_partner_id"),
    ("tax_invoice", "seller"): (TaxInvoice, "seller_partner_id"),
    ("tax_invoice", "buyer"): (TaxInvoice, "buyer_partner_id"),
    ("bank_transaction", "counterparty"): (BankTransaction, "counterparty_partner_id"),
    ("jky_web_sales_order", "customer"): (JkyWebSalesOrder, "customer_partner_id"),
}


def normalize_account(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"[\s-]+", "", unicodedata.normalize("NFKC", str(value))).upper()


def _sync_roles(db: Session) -> int:
    existing = {
        (int(row.partner_id), row.role)
        for row in db.query(BusinessPartnerRole).all()
    }
    created = 0
    for partner in db.query(BusinessPartner).filter(BusinessPartner.status == "active").all():
        for role in sorted(set(partner.roles or []) & ROLE_VALUES):
            key = (int(partner.id), role)
            if key in existing:
                continue
            db.add(
                BusinessPartnerRole(
                    partner_id=partner.id,
                    role=role,
                    source="legacy_roles",
                    confirmed=True,
                )
            )
            existing.add(key)
            created += 1
    return created


def _bank_account_candidates(db: Session) -> dict[int, dict[str, dict[str, Any]]]:
    desired: dict[int, dict[str, dict[str, Any]]] = defaultdict(dict)

    for partner in db.query(BusinessPartner).filter(BusinessPartner.status == "active").all():
        raw_rows = partner.bank_accounts if isinstance(partner.bank_accounts, list) else []
        for raw in raw_rows:
            if not isinstance(raw, dict):
                continue
            account_no = str(raw.get("account_no") or raw.get("accountNo") or "").strip()
            normalized = normalize_account(account_no)
            if not normalized:
                continue
            desired[int(partner.id)][normalized] = {
                "bank_name": str(raw.get("bank_name") or raw.get("bankName") or "").strip(),
                "account_no": account_no,
                "account_name": str(raw.get("account_name") or raw.get("accountName") or "").strip(),
                "is_primary": bool(
                    raw.get("is_primary") if "is_primary" in raw else raw.get("isPrimary")
                ),
                "source": "legacy_json",
                "verified": True,
            }

        primary = normalize_account(partner.bank_account_no)
        if primary and primary not in desired[int(partner.id)]:
            desired[int(partner.id)][primary] = {
                "bank_name": partner.bank_name or "",
                "account_no": partner.bank_account_no or "",
                "account_name": partner.bank_account_name or "",
                "is_primary": True,
                "source": "legacy_primary",
                "verified": True,
            }

    for identifier in (
        db.query(BusinessPartnerIdentifier)
        .filter(BusinessPartnerIdentifier.kind == "bank_account")
        .all()
    ):
        normalized = normalize_account(identifier.normalized_value or identifier.value)
        if not normalized:
            continue
        desired[int(identifier.partner_id)].setdefault(
            normalized,
            {
                "bank_name": "",
                "account_no": identifier.value,
                "account_name": "",
                "is_primary": bool(identifier.is_primary),
                "source": identifier.source or "identifier",
                "verified": identifier.source == "manual",
            },
        )
    return desired


def _sync_bank_accounts(db: Session) -> int:
    desired = _bank_account_candidates(db)
    existing = {
        (int(row.partner_id), row.normalized_account_no): row
        for row in db.query(BusinessPartnerBankAccount).all()
    }
    changed = 0

    for partner_id, accounts in desired.items():
        primary_seen = False
        for normalized, payload in accounts.items():
            key = (partner_id, normalized)
            row = existing.get(key)
            is_primary = bool(payload["is_primary"] and not primary_seen)
            if row is None:
                row = BusinessPartnerBankAccount(
                    partner_id=partner_id,
                    normalized_account_no=normalized,
                    bank_name=payload["bank_name"],
                    account_no=payload["account_no"],
                    account_name=payload["account_name"],
                    is_primary=is_primary,
                    status="active",
                    source=payload["source"],
                    verified=bool(payload["verified"]),
                )
                db.add(row)
                existing[key] = row
                changed += 1
            else:
                values = {
                    "bank_name": payload["bank_name"] or row.bank_name,
                    "account_no": payload["account_no"] or row.account_no,
                    "account_name": payload["account_name"] or row.account_name,
                    "is_primary": is_primary,
                    "status": "active",
                    "verified": bool(row.verified or payload["verified"]),
                }
                for field, value in values.items():
                    if getattr(row, field) != value:
                        setattr(row, field, value)
                        changed += 1
            if row.is_primary:
                primary_seen = True
    return changed


def materialize_partner_references(db: Session) -> dict[str, Any]:
    """Materialize confirmed audit links into direct FKs; safe to run repeatedly."""
    changed_by_source: dict[str, int] = defaultdict(int)
    rows = (
        db.query(BusinessPartnerLink)
        .filter(
            BusinessPartnerLink.status == "linked",
            BusinessPartnerLink.partner_id.isnot(None),
        )
        .all()
    )
    grouped: dict[tuple[str, str], list[BusinessPartnerLink]] = defaultdict(list)
    for row in rows:
        grouped[(row.source_type, row.relation_role)].append(row)

    for key, links in grouped.items():
        binding = SOURCE_BINDINGS.get(key)
        if binding is None:
            continue
        model, attr = binding
        ids = [int(link.source_id) for link in links]
        objects = {
            int(obj.id): obj
            for obj in db.query(model).filter(model.id.in_(ids)).all()
        }
        for link in links:
            obj = objects.get(int(link.source_id))
            if obj is None:
                continue
            partner_id = int(link.partner_id)
            if getattr(obj, attr) != partner_id:
                setattr(obj, attr, partner_id)
                changed_by_source[link.source_type] += 1

    for partner in (
        db.query(BusinessPartner)
        .filter(BusinessPartner.legacy_supplier_id.isnot(None))
        .all()
    ):
        supplier = db.get(Supplier, int(partner.legacy_supplier_id))
        if supplier is not None and supplier.partner_id != partner.id:
            supplier.partner_id = partner.id
            changed_by_source["supplier"] += 1

    roles_created = _sync_roles(db)
    bank_accounts_changed = _sync_bank_accounts(db)
    db.flush()
    return {
        "materialized": sum(changed_by_source.values()),
        "rolesCreated": roles_created,
        "bankAccountsChanged": bank_accounts_changed,
        "bySource": dict(sorted(changed_by_source.items())),
    }


def _coverage(db: Session, model: type[Any], attr: str, *eligibility) -> dict[str, Any]:
    query = db.query(model)
    if eligibility:
        query = query.filter(*eligibility)
    total = query.count()
    linked = query.filter(getattr(model, attr).isnot(None)).count()
    return {
        "total": total,
        "linked": linked,
        "unlinked": max(0, total - linked),
        "coverage": round(linked / total, 4) if total else 1.0,
    }


def partner_reference_coverage(db: Session) -> dict[str, Any]:
    """Read-only coverage report for the Phase-1 rollout."""
    sources = {
        "suppliers": _coverage(db, Supplier, "partner_id"),
        "externalPurchases": _coverage(
            db,
            ExternalPurchaseOrder,
            "supplier_partner_id",
            ExternalPurchaseOrder.supplier_name != "",
        ),
        "alibaba1688": _coverage(
            db,
            Alibaba1688Order,
            "supplier_partner_id",
            Alibaba1688Order.row_status != "deleted",
        ),
        "jackyunPurchases": _coverage(
            db,
            JackyunPurchaseOrder,
            "supplier_partner_id",
            JackyunPurchaseOrder.supplier_name != "",
        ),
        "jackyunSettlements": _coverage(
            db,
            JackyunPurchaseSettlement,
            "supplier_partner_id",
            JackyunPurchaseSettlement.supplier_name != "",
        ),
        "jackyunReturns": _coverage(
            db,
            JackyunPurchaseReturn,
            "supplier_partner_id",
            JackyunPurchaseReturn.supplier_name != "",
        ),
        "inboundDocuments": _coverage(
            db,
            JackyunGoodsDocument,
            "supplier_partner_id",
            JackyunGoodsDocument.document_type == "inbound",
            JackyunGoodsDocument.supplier_name != "",
        ),
        "consumablePurchases": _coverage(
            db,
            ConsumablePurchase,
            "supplier_partner_id",
            ConsumablePurchase.supplier_name != "",
        ),
        "jkyStockin": _coverage(
            db,
            JkyWebStockinOrder,
            "supplier_partner_id",
            JkyWebStockinOrder.supplier_name != "",
        ),
        "taxInvoiceSeller": _coverage(
            db,
            TaxInvoice,
            "seller_partner_id",
            TaxInvoice.direction == "input",
        ),
        "taxInvoiceBuyer": _coverage(
            db,
            TaxInvoice,
            "buyer_partner_id",
            TaxInvoice.direction == "output",
        ),
        "bankTransactions": _coverage(
            db,
            BankTransaction,
            "counterparty_partner_id",
            (BankTransaction.counterparty_name != "")
            | (BankTransaction.counterparty_account != ""),
        ),
        "jkySales": _coverage(db, JkyWebSalesOrder, "customer_partner_id"),
    }
    total = sum(row["total"] for row in sources.values())
    linked = sum(row["linked"] for row in sources.values())
    return {
        "sources": sources,
        "totalFacts": total,
        "linkedFacts": linked,
        "unlinkedFacts": max(0, total - linked),
        "coverage": round(linked / total, 4) if total else 1.0,
    }
