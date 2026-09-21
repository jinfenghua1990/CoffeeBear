"""发票维度对账：供应商进项发票 ↔ 采购订单 顺序配平（FIFO）。

业务背景：供应商常把多张采购订单合并开一张发票。用户不看"订单关联了哪些发票"，
而是以发票为主体核对：从该供应商最早的订单开始按时间顺序累加金额，
累加到与发票票面金额一致即"对上了"——这张发票覆盖的订单一目了然。

规则：
- 按**归一化供应商名**分组（发票 seller_name ↔ 订单 supplier_name）；
- 组内订单按下单时间升序、发票按开票日期升序；
- 发票按开票日期升序；每张发票只匹配“开票日当天及之前”的采购订单；
- 符合日期条件的订单按下单日期升序消耗金额，直到发票票面金额耗尽（容差 ±0.05 元）；
- 订单可被多张发票**渐进消耗**（部分覆盖，余量留给下一张发票），严格 FIFO；
- 金额口径：订单 = COALESCE(paid_amount, order_amount) + adjustment_amount；
  发票 = total_amount（含税票面）；
- 0 金额订单（金额未同步）跳过，不参与配平，另行提示。

纯推导展示，不落库、不修改任何关联数据；每次调用从头重算。
"""

from __future__ import annotations

import re
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.models.alibaba1688_import import Alibaba1688Order
from app.models.purchase import ExternalPurchaseOrder, JackyunPurchaseOrderLink
from app.models.tax import TaxInvoice, TaxInvoiceLink

TOLERANCE = Decimal("0.05")

_TRANS = str.maketrans({"（": "(", "）": ")", "　": "", "：": ":", "，": ","})


def normalize_supplier(name: str | None) -> str:
    """供应商名归一化：去空白、全角括号/标点转半角、大写。"""
    return re.sub(r"\s+", "", (name or "").translate(_TRANS)).upper()


def _dec(value: Decimal | float | int | None) -> Decimal:
    return Decimal(str(value)) if value is not None else Decimal("0")


def _matches(name_norm: str, target_norm: str) -> bool:
    """供应商名宽松匹配：全等，或一方是另一方的前缀（处理"河北鸿鲲食品" vs
    "河北鸿鲲食品有限公司"这类简称/全称差异）。"""
    if not name_norm or not target_norm:
        return False
    return name_norm == target_norm or name_norm.startswith(target_norm) or target_norm.startswith(name_norm)


def _explicit_link_map(db: Session, inv_ids: list[int], po_rows: list) -> dict[int, list[dict[str, Any]]]:
    """明确业务关联映射：人工 manual 优先，否则使用税务清单 source_ref。

    每条映射都携带真实 allocatedAmount；不能唯一落到采购工作流订单时保留 issue，
    由 reconcile 明确标为待核对，绝不静默猜单/猜金额。
    """
    if not inv_ids:
        return {}
    links = (
        db.query(TaxInvoiceLink)
        .filter(
            TaxInvoiceLink.invoice_id.in_(inv_ids),
            TaxInvoiceLink.target_type.in_((
                "external_purchase_order",
                "alibaba1688_order",
                "jackyun_purchase_order",
            )),
            TaxInvoiceLink.match_method.in_(("manual", "source_ref")),
            TaxInvoiceLink.confirmed.is_(True),
        )
        .all()
    )
    if not links:
        return {}

    # 同一发票人工选择优先于来源自动关联，避免用户纠正后 source_ref 再抢回去。
    by_invoice: dict[int, list[TaxInvoiceLink]] = {}
    for link in links:
        by_invoice.setdefault(link.invoice_id, []).append(link)
    selected: list[TaxInvoiceLink] = []
    for invoice_links in by_invoice.values():
        manual = [row for row in invoice_links if row.match_method == "manual"]
        selected.extend(manual or invoice_links)

    need_1688 = {lnk.target_id for lnk in selected if lnk.target_type == "alibaba1688_order"}
    no_by_1688: dict[int, str] = {}
    if need_1688:
        rows = (
            db.query(Alibaba1688Order.id, Alibaba1688Order.external_order_id)
            .filter(Alibaba1688Order.id.in_(need_1688))
            .all()
        )
        no_by_1688 = {r.id: r.external_order_id for r in rows}

    allowed_po_ids = {r.id for r in po_rows}
    po_ids_by_no: dict[str, list[int]] = {}
    for row in po_rows:
        po_ids_by_no.setdefault(row.external_order_id, []).append(row.id)

    need_jackyun = {lnk.target_id for lnk in selected if lnk.target_type == "jackyun_purchase_order"}
    jackyun_groups: dict[int, list[JackyunPurchaseOrderLink]] = {}
    if need_jackyun:
        for row in (
            db.query(JackyunPurchaseOrderLink)
            .filter(JackyunPurchaseOrderLink.jackyun_po_id.in_(need_jackyun))
            .all()
        ):
            if row.po_id in allowed_po_ids:
                jackyun_groups.setdefault(row.jackyun_po_id, []).append(row)

    result: dict[int, list[dict[str, Any]]] = {}

    def add(link: TaxInvoiceLink, *, po_id: int | None, allocated: Decimal | None, issue: str = "") -> None:
        result.setdefault(link.invoice_id, []).append({
            "linkId": link.id,
            "poId": po_id,
            "allocatedAmount": allocated,
            "source": link.match_method,
            "targetType": link.target_type,
            "issue": issue,
        })

    for link in selected:
        allocated = _dec(link.allocated_amount) if link.allocated_amount is not None else None
        if link.target_type == "external_purchase_order":
            if link.target_id in allowed_po_ids:
                add(link, po_id=link.target_id, allocated=allocated)
            else:
                add(link, po_id=None, allocated=allocated, issue="business_target_out_of_scope")
            continue

        if link.target_type == "alibaba1688_order":
            order_no = no_by_1688.get(link.target_id)
            candidates = po_ids_by_no.get(order_no or "", [])
            if len(candidates) == 1:
                add(link, po_id=candidates[0], allocated=allocated)
            elif not candidates:
                add(link, po_id=None, allocated=allocated, issue="source_order_not_in_workflow")
            else:
                add(link, po_id=None, allocated=allocated, issue="source_order_number_ambiguous")
            continue

        if link.target_type == "jackyun_purchase_order":
            group = jackyun_groups.get(link.target_id, [])
            if len(group) == 1:
                add(link, po_id=group[0].po_id, allocated=allocated)
                continue
            group_total = sum((_dec(row.alloc_amount) for row in group), Decimal("0"))
            if (
                len(group) > 1
                and allocated is not None
                and allocated > 0
                and group_total > 0
                and all(_dec(row.alloc_amount) > 0 for row in group)
            ):
                for row in group:
                    share_amount = allocated * _dec(row.alloc_amount) / group_total
                    add(link, po_id=row.po_id, allocated=share_amount)
            elif not group:
                add(link, po_id=None, allocated=allocated, issue="jackyun_target_not_mapped_to_workflow")
            else:
                add(link, po_id=None, allocated=allocated, issue="jackyun_group_allocation_missing")
            continue

        add(link, po_id=None, allocated=allocated, issue="unsupported_business_target")

    return result


def reconcile(db: Session, supplier: str | None = None) -> dict[str, Any]:
    """supplier 传入时只输出该供应商的分组（供供应商画像的发票匹配清单使用）。"""
    target_norm = normalize_supplier(supplier) if supplier else ""
    po_rows = (
        db.query(
            ExternalPurchaseOrder.id,
            ExternalPurchaseOrder.external_order_id,
            ExternalPurchaseOrder.platform,
            ExternalPurchaseOrder.supplier_name,
            ExternalPurchaseOrder.ordered_at,
            ExternalPurchaseOrder.order_amount,
            ExternalPurchaseOrder.paid_amount,
            ExternalPurchaseOrder.adjustment_amount,
        )
        .order_by(ExternalPurchaseOrder.ordered_at.nulls_last(), ExternalPurchaseOrder.id)
        .all()
    )
    inv_rows = (
        db.query(TaxInvoice)
        .filter(TaxInvoice.direction == "input", TaxInvoice.status == "issued")
        .order_by(TaxInvoice.issue_date.nulls_last(), TaxInvoice.id)
        .all()
    )
    if supplier:
        # 只保留与目标供应商宽松匹配的订单/发票，缩小配平范围
        po_rows = [r for r in po_rows if _matches(normalize_supplier(r.supplier_name), target_norm)]
        inv_rows = [v for v in inv_rows if _matches(normalize_supplier(v.seller_name), target_norm)]

    # 按归一化供应商分组；订单池用 list，队首订单可被多张发票渐进消耗；
    # po_all 保存同一批 dict 引用（含 0 金额单），配平结束后 remaining 即该单未配平余量
    po_pool: dict[str, list[dict[str, Any]]] = {}
    po_all: dict[str, list[dict[str, Any]]] = {}
    po_entry_by_id: dict[int, dict[str, Any]] = {}
    po_meta: dict[str, dict[str, Any]] = {}
    skipped_zero = 0
    for r in po_rows:
        # 供应商模式下统一挂到目标分组：宽松匹配进来的简称/全称归并到一起配平
        norm = target_norm or normalize_supplier(r.supplier_name)
        if not norm:
            continue
        meta = po_meta.setdefault(norm, {"supplier": r.supplier_name, "orderTotal": Decimal("0"), "orderCount": 0})
        amount = (_dec(r.paid_amount) if r.paid_amount is not None else _dec(r.order_amount)) + _dec(r.adjustment_amount)
        meta["orderTotal"] += amount
        meta["orderCount"] += 1
        order_entry = {
            "orderId": r.id, "orderNo": r.external_order_id, "platform": r.platform,
            "date": r.ordered_at.strftime("%Y-%m-%d") if r.ordered_at else None,
            "_orderedAt": r.ordered_at,
            "orderAmount": float(amount), "remaining": amount,
        }
        po_all.setdefault(norm, []).append(order_entry)
        po_entry_by_id[r.id] = order_entry
        if amount <= 0:
            skipped_zero += 1
            continue
        po_pool.setdefault(norm, []).append(order_entry)

    # 明确关联优先：人工 manual 优先于 source_ref；没有明确关联的发票才走 FIFO。
    explicit_map = _explicit_link_map(db, [v.id for v in inv_rows], po_rows)

    # 发票按供应商分组（保持时间升序）；供应商模式下归并到目标分组
    inv_by_supplier: dict[str, list[TaxInvoice]] = {}
    for inv in inv_rows:
        norm = target_norm or normalize_supplier(inv.seller_name)
        if norm:
            inv_by_supplier.setdefault(norm, []).append(inv)

    suppliers_out: list[dict[str, Any]] = []
    expense_sellers: list[dict[str, Any]] = []
    for norm, invoices in inv_by_supplier.items():
        pool = po_pool.get(norm, [])
        meta = po_meta.get(norm)
        month_buckets: dict[str, list[dict[str, Any]]] = {}
        inv_total = Decimal("0")
        matched_total = Decimal("0")
        for inv in invoices:
            amount = _dec(inv.total_amount)
            inv_total += amount
            explicit_links = explicit_map.get(inv.id, [])
            covered: list[dict[str, Any]] = []
            consumed_total = Decimal("0")
            remaining_need = amount
            explicit_issues: list[str] = []
            if explicit_links:
                # 明确关联金额就是唯一依据；不再根据“发票还差多少/订单还能吃多少”重新猜分摊。
                for link in explicit_links:
                    if link.get("issue"):
                        explicit_issues.append(str(link["issue"]))
                        continue
                    order_id = link.get("poId")
                    order = po_entry_by_id.get(order_id) if order_id is not None else None
                    requested = link.get("allocatedAmount")
                    if order is None:
                        explicit_issues.append("business_target_missing")
                        continue
                    if requested is None or requested <= 0:
                        explicit_issues.append("allocated_amount_missing")
                        continue
                    order_before = max(order["remaining"], Decimal("0"))
                    take = min(requested, order_before, max(remaining_need, Decimal("0")))
                    allocation_issue = abs(take - requested) > TOLERANCE
                    if allocation_issue:
                        explicit_issues.append("allocated_amount_exceeds_remaining")
                    if take <= 0:
                        continue
                    covered.append({
                        "orderId": order["orderId"], "orderNo": order["orderNo"],
                        "platform": order["platform"], "date": order["date"],
                        "orderAmount": order["orderAmount"],
                        "allocatedAmount": float(requested),
                        "consumed": float(take),
                        "partial": take < order_before - TOLERANCE,
                        "source": link.get("source") or "manual",
                        "linkId": link["linkId"],
                        "allocationIssue": allocation_issue,
                    })
                    order["remaining"] -= take
                    remaining_need -= take
                    consumed_total += take
                    if order["remaining"] <= TOLERANCE:
                        # 吃满的订单从所有 FIFO 池移除，避免后续 FIFO 重复消耗
                        for p in po_pool.values():
                            p[:] = [o for o in p if o["orderId"] != order["orderId"]]
            else:
                # 自动匹配受开票日期约束：发票只能覆盖开票日当天及之前已经发生的采购订单。
                # 订单池本身按 ordered_at 升序，因此每次都取最早的“日期合格且仍有余量”订单。
                while pool and remaining_need > TOLERANCE:
                    eligible_index = None
                    for idx, candidate in enumerate(pool):
                        ordered_at = candidate.get("_orderedAt")
                        if candidate["remaining"] <= TOLERANCE:
                            continue
                        if inv.issue_date is None:
                            eligible_index = idx
                            break
                        if ordered_at is not None and ordered_at.date() <= inv.issue_date.date():
                            eligible_index = idx
                            break
                    if eligible_index is None:
                        break
                    order = pool[eligible_index]
                    take = min(order["remaining"], remaining_need)
                    if take <= 0:
                        pool.pop(eligible_index)
                        continue
                    covered.append({
                        "orderId": order["orderId"], "orderNo": order["orderNo"],
                        "platform": order["platform"], "date": order["date"],
                        "orderAmount": order["orderAmount"],
                        "consumed": float(take),
                        "partial": take < order["remaining"] - TOLERANCE,
                        "source": "auto",
                    })
                    order["remaining"] -= take
                    remaining_need -= take
                    consumed_total += take
                    if order["remaining"] <= TOLERANCE:
                        pool.pop(eligible_index)
            diff = consumed_total - amount  # <0 仅当可用/明确分摊金额不足
            matched = diff >= -TOLERANCE and not explicit_issues
            if matched:
                matched_total += amount
            future_order_count = 0
            if not explicit_links and inv.issue_date is not None and remaining_need > TOLERANCE:
                future_order_count = sum(
                    1 for order in pool
                    if order["remaining"] > TOLERANCE
                    and (
                        order.get("_orderedAt") is None
                        or order["_orderedAt"].date() > inv.issue_date.date()
                    )
                )
            month = inv.issue_date.strftime("%Y-%m") if inv.issue_date else "未知月份"
            month_buckets.setdefault(month, []).append({
                "invoiceId": inv.id,
                "invoiceNo": inv.invoice_number or inv.invoice_code,
                "issueDate": inv.issue_date.strftime("%Y-%m-%d") if inv.issue_date else None,
                "seller": inv.seller_name,
                "amount": float(amount),
                "manualLinked": any(link.get("source") == "manual" for link in explicit_links),
                "explicitLinked": bool(explicit_links),
                "covered": covered,
                "coveredTotal": float(consumed_total),
                "diff": float(diff),
                "status": "matched" if matched else "short",
                "shortReason": (
                    "explicit_link_issue"
                    if explicit_issues
                    else "date_cutoff"
                    if diff < -TOLERANCE and future_order_count > 0
                    else "insufficient_orders"
                    if diff < -TOLERANCE
                    else None
                ),
                "explicitIssues": list(dict.fromkeys(explicit_issues)),
                "futureOrderCount": future_order_count,
            })

        entry = {
            "supplier": (meta or {}).get("supplier") or invoices[0].seller_name,
            "supplierNorm": norm,
            "hasOrders": bool(meta),
            "orderCount": (meta or {}).get("orderCount", 0),
            "orderTotal": float((meta or {}).get("orderTotal", Decimal("0"))),
            "invoiceCount": len(invoices),
            "invoiceTotal": float(inv_total),
            "matchedTotal": float(matched_total),
            "remainingOrders": len(pool),
            "remainingOrderTotal": float(sum(o["remaining"] for o in pool)),
            # 待开票订单（未被任何发票配平的部分）：找供应商开票时直接引用这些订单号
            "pendingOrders": [
                {
                    "orderId": o["orderId"], "orderNo": o["orderNo"], "platform": o["platform"],
                    "date": o["date"], "orderAmount": o["orderAmount"],
                    "remaining": float(o["remaining"]),
                    "partial": o["remaining"] < _dec(o["orderAmount"]) - TOLERANCE,
                }
                for o in pool
            ],
            # 全部订单及未配平余量（FIFO 顺序）：remaining≈orderAmount 未匹配，
            # 0<remaining<orderAmount 部分匹配，remaining≤容差 已配平；金额≤0 未同步
            "orders": [
                {
                    "orderId": o["orderId"], "orderNo": o["orderNo"], "platform": o["platform"],
                    "date": o["date"], "orderAmount": float(_dec(o["orderAmount"])),
                    "remaining": float(o["remaining"]),
                }
                for o in po_all.get(norm, [])
            ],
            "months": [
                {"month": m, "invoices": month_buckets[m]}
                for m in sorted(month_buckets)
            ],
        }
        if meta:
            suppliers_out.append(entry)
        elif len(invoices) <= 12:  # 无订单的费用类卖方（航司/酒店等），折叠展示
            expense_sellers.append({
                "seller": invoices[0].seller_name, "invoiceCount": len(invoices),
                "invoiceTotal": float(inv_total),
            })

    # （待开票订单已并入各供应商块的 pendingOrders，不再单独输出缺票清单）

    suppliers_out.sort(key=lambda e: -e["orderTotal"])
    expense_sellers.sort(key=lambda e: -e["invoiceTotal"])

    return {
        "tolerance": float(TOLERANCE),
        "matchingRule": "invoice_issue_date_cutoff_then_order_date_fifo",
        "skippedZeroOrders": skipped_zero,
        "suppliers": suppliers_out,
        "expenseSellers": expense_sellers,
    }
