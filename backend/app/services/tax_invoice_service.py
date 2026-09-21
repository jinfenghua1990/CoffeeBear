"""税务系统官方清单导入与发票台账服务。"""

from __future__ import annotations

import hashlib
import mimetypes
import re
from collections import Counter
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.adapters.bank_file import sanitize_name
from app.adapters.tax_invoice_file import ParsedTaxInvoiceExport, parse_tax_invoice_export
from app.config import settings
from app.core.audit import audit
from app.models.alibaba1688_import import Alibaba1688Order
from app.models.jackyun import JackyunGoodsDocument
from app.models.procurement_chain import ProcurementChainLink
from app.models.purchase import ExternalPurchaseOrder, JackyunPurchaseOrder, JackyunPurchaseOrderLink
from app.models.sales import SalesOrder
from app.models.tax import TaxInvoice, TaxInvoiceImport, TaxInvoiceImportRecord, TaxInvoiceLink
from app.services.import_lifecycle import (
    filter_active_import,
    filter_lifecycle,
    transition_lifecycle,
    transition_row_status,
)
from app.services.sales_scope import deal_orders_condition, is_deal_status
from app.utils.money import quantize, to_decimal
from sqlalchemy import and_, case, cast, func, or_, String
from sqlalchemy.orm import aliased


def _root() -> Path:
    root = Path(settings.DATA_DIR).resolve() / "tax-invoices"
    root.mkdir(parents=True, exist_ok=True)
    return root


# 进项发票分类 v2（终版）：category 与 processing_status 合并为一个 6+1 值分类字段。
# key → {label: 中文文案, group: 派生组}；group 决定统计口径：
# operating=计入运营成本，reimburse=计入报销成本，excluded=不计入任何报销运营，
# 空（待判断）不属于任何组，单独以 "pending" 口径统计。
CATEGORY_V2 = {
    "goods": {"label": "运营成本：货款发票", "group": "operating"},
    "platform_fee": {"label": "运营成本：平台服务费", "group": "operating"},
    "operating_other": {"label": "运营成本其他", "group": "operating"},
    "reimburse_advance": {"label": "报销：代付", "group": "reimburse"},
    "reimburse_operating": {"label": "报销：运营成本", "group": "reimburse"},
    "excluded": {"label": "不计入任何报销运营", "group": "excluded"},
}
CATEGORY_V2_KEYS = tuple(CATEGORY_V2)
CATEGORY_V2_LABELS = {key: item["label"] for key, item in CATEGORY_V2.items()}
CATEGORY_V2_OPERATING = tuple(key for key, item in CATEGORY_V2.items() if item["group"] == "operating")
CATEGORY_V2_REIMBURSE = tuple(key for key, item in CATEGORY_V2.items() if item["group"] == "reimburse")
CATEGORY_V2_EMPTY_LABEL = "待判断（未分类）"

# 销项发票分类（独立枚举，与进项 6+1 互斥）：给买家开发票 / 给平台开服务费；空 = 待判断。
OUTPUT_CATEGORY = {
    "buyer_sales": {"label": "给买家开发票"},
    "platform_service": {"label": "给平台开服务费"},
}
OUTPUT_CATEGORY_KEYS = tuple(OUTPUT_CATEGORY)
OUTPUT_CATEGORY_LABELS = {key: item["label"] for key, item in OUTPUT_CATEGORY.items()}
OUTPUT_CATEGORY_EMPTY_LABEL = "待判断"
# 全量合法 key（列表 category 筛选参数是方向无关的，取两枚举并集）。
CATEGORY_ALL_KEYS = CATEGORY_V2_KEYS + OUTPUT_CATEGORY_KEYS


def category_label(category: str | None) -> str:
    """进项分类 key 的中文文案；空 = 待判断（未分类）。"""
    if not category:
        return CATEGORY_V2_EMPTY_LABEL
    return CATEGORY_V2_LABELS.get(category, category)


def output_category_label(category: str | None) -> str:
    """销项分类 key 的中文文案；空 = 待判断。"""
    if not category:
        return OUTPUT_CATEGORY_EMPTY_LABEL
    return OUTPUT_CATEGORY_LABELS.get(category, category)


def category_label_for_direction(direction: str | None, category: str | None) -> str:
    """按发票方向取分类文案：销项走 OUTPUT_CATEGORY，其余（input/unknown）走进项 6+1。"""
    if direction == "output":
        return output_category_label(category)
    return category_label(category)


def validate_category_for_direction(direction: str | None, category: str) -> None:
    """按方向校验分类 key：进项只收 6+1，销项只收 buyer_sales/platform_service/空；互混即拒绝。"""
    if not category:
        return
    if direction == "output":
        if category in OUTPUT_CATEGORY_KEYS:
            return
        if category in CATEGORY_V2_KEYS:
            raise ValueError(
                "销项发票不能使用进项分类，合法值："
                + "、".join(OUTPUT_CATEGORY_KEYS) + " 或空（待判断）"
            )
        raise ValueError(
            "无效的销项发票类别，合法值：" + "、".join(OUTPUT_CATEGORY_KEYS) + " 或空（待判断）"
        )
    if category in CATEGORY_V2_KEYS:
        return
    if category in OUTPUT_CATEGORY_KEYS:
        raise ValueError(
            "进项发票不能使用销项分类，合法值："
            + "、".join(CATEGORY_V2_KEYS) + " 或空（待判断）"
        )
    raise ValueError(
        "无效的进项发票类别，合法值：" + "、".join(CATEGORY_V2_KEYS) + " 或空（待判断）"
    )


def category_group(category: str | None) -> str:
    """分类的派生组：operating / reimburse / excluded；空或无法识别 → pending（待判断）。"""
    if category in CATEGORY_V2:
        return CATEGORY_V2[category]["group"]
    return "pending"


# 报销类：餐饮/住宿/交通等差旅与费用报销；平台服务类：软件/云服务/仓储/会员等平台服务费。
_REIMBURSEMENT_KEYWORDS = re.compile(
    r"餐饮|餐费|住宿|运输|票价|退票|机票|停车|演唱会|客运|房租|物业|水费|电费|话费"
)
_PLATFORM_SERVICE_KEYWORDS = re.compile(
    r"软件|增值服务|云服务|仓储|会员|商标|经纪代理|广告|信息技术|技术服务|信息系统|信息服务|服务器|网络费"
)


def classify_category_from_items(goods_names: list[str]) -> str:
    """按开票明细归类进项发票；无法识别时返回空（待判断）等待人工调整。"""
    text = " ".join(goods_names or []).strip().lower()
    if not text:
        return ""
    if _REIMBURSEMENT_KEYWORDS.search(text):
        return "reimburse_operating"
    if _PLATFORM_SERVICE_KEYWORDS.search(text):
        return "platform_fee"
    return "goods"


def _derive_processing_status(category: str | None) -> str:
    """category 是唯一事实，processing_status 由类别派生（兼容缓存）：
    运营成本三分类→required；报销两分类与 excluded→not_required；空→pending（待判断）。"""
    if category in CATEGORY_V2_OPERATING:
        return "required"
    if category in CATEGORY_V2_REIMBURSE or category == "excluded":
        return "not_required"
    return "pending"


def _effective_processing_status(row: TaxInvoice) -> str:
    """派生处理结论；历史行类别为空时回退旧 processing_status，兼容既有数据。"""
    if row.category:
        return _derive_processing_status(row.category)
    return row.processing_status or "pending"


def _store_new_file(content: bytes, original_name: str, sha256: str) -> tuple[Path, bool]:
    target = _root() / sha256[:2] / f"{sha256}_{sanitize_name(original_name)}"
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        with target.open("xb") as output:
            output.write(content)
        return target, True
    except FileExistsError:
        return target, False


def _value(row: dict[str, str], parsed: ParsedTaxInvoiceExport, field: str) -> str:
    header = parsed.mapping.get(field)
    value = str(row.get(header, "") or "").strip() if header else ""
    if value or field != "invoice_number":
        return value
    # 税务数字发票导出常把“发票号码”列留空，把实际号码放在“数电发票号码”。
    for fallback in ("数电发票号码", "电子发票号码", "发票号", "发票编号"):
        value = str(row.get(fallback, "") or "").strip()
        if value:
            return value
    return ""


def _decimal(value: str) -> Decimal | None:
    text = str(value or "").strip().replace(",", "").replace("，", "")
    text = text.replace("¥", "").replace("￥", "").replace("元", "").replace(" ", "")
    if not text or text in {"-", "--", "/"}:
        return None
    negative = text.startswith("(") and text.endswith(")")
    if negative:
        text = text[1:-1]
    try:
        amount = Decimal(text)
    except (InvalidOperation, ValueError):
        return None
    return -amount if negative else amount


def _datetime(value: str) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    for candidate in (text, text.replace("/", "-")):
        try:
            parsed = datetime.fromisoformat(candidate.replace("Z", "+00:00"))
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=ZoneInfo(settings.TZ))
        except ValueError:
            pass
        for pattern in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d", "%Y%m%d"):
            try:
                return datetime.strptime(candidate, pattern).replace(tzinfo=ZoneInfo(settings.TZ))
            except ValueError:
                continue
    return None


def _direction(value: str, header_hint: str) -> str:
    text = f"{value} {header_hint}".lower()
    if any(token in text for token in ("进项", "购进", "收票", "供应商")):
        return "input"
    if any(token in text for token in ("销项", "销售", "开给", "客户")):
        return "output"
    return "unknown"


def _infer_batch_directions(
    rows: list[dict[str, str]], parsed: ParsedTaxInvoiceExport
) -> dict[int, str]:
    """从单批次购销方税号结构补足“进销项”未提供方向的官方清单。

    仅在一侧税号占比至少 80%、另一侧明显变化时推断；不满足条件就保持 unknown。
    这样可识别同一批次的进项/销项文件，但不会把混合批次强行归类。
    """
    seller_counts = Counter(
        _value(row, parsed, "seller_tax_id")
        for row in rows
        if _value(row, parsed, "seller_tax_id")
    )
    buyer_counts = Counter(
        _value(row, parsed, "buyer_tax_id")
        for row in rows
        if _value(row, parsed, "buyer_tax_id")
    )
    total = len(rows)
    if total < 2 or not seller_counts or not buyer_counts:
        return {}
    seller_tax, seller_count = seller_counts.most_common(1)[0]
    buyer_tax, buyer_count = buyer_counts.most_common(1)[0]
    seller_ratio = seller_count / total
    buyer_ratio = buyer_count / total
    if buyer_ratio >= 0.8 and (len(seller_counts) > 1 or seller_ratio < 0.8):
        return {index: "input" for index in range(len(rows)) if buyer_tax}
    if seller_ratio >= 0.8 and (len(buyer_counts) > 1 or buyer_ratio < 0.8):
        return {index: "output" for index in range(len(rows)) if seller_tax}
    return {}


def _status(value: str, total: Decimal | None = None, is_positive: str | None = None, remark: str | None = None) -> str:
    """票据状态判定。红冲必须是整张发票红冲，不能因单行折扣金额为负就误判。
    判定优先级：是否正数发票字段 > 备注红冲文字 > 发票状态文字 > 价税合计正负（兜底）。"""
    remark_text = str(remark or "")
    # 1. 税务清单明确给出的"是否正数发票"是最权威的判断依据
    if is_positive is not None:
        pos = str(is_positive).strip()
        if pos in ("否", "负数", "红字", "红冲"):
            return "red"
        if pos in ("是", "正数", "正常"):
            # 明确是正数发票，即使单行折扣金额为负也不判红冲
            text = str(value or "")
            if any(token in text for token in ("作废", "无效", "失效")):
                return "void"
            return "issued"
    # 2. 备注字段含红冲明确标识（被红冲蓝字/红字发票信息确认单），即使状态文字写"正常"也判红冲
    if any(token in remark_text for token in ("被红冲", "红字发票信息确认单", "红冲蓝字")):
        return "red"
    text = str(value or "")
    if any(token in text for token in ("作废", "无效", "失效")):
        return "void"
    if any(token in text for token in ("红字", "红冲", "冲红")):
        return "red"
    if any(token in text for token in ("正常", "有效", "已开", "开具")):
        return "issued"
    # 3. 兜底：缺少是否正数发票字段且备注无红冲文字时，才用发票级总额正负判断
    if total is not None and total < 0:
        return "red"
    return "unknown"


_RED_BLUE_REF_RE = re.compile(r"被红冲(?:蓝字)?(?:数电)?发票号码[：:]\s*([A-Za-z0-9_-]+)")
_RED_NOTICE_RE = re.compile(r"红字发票信息确认单编号[：:]\s*([A-Za-z0-9_-]+)")


def is_effective_for_accounting(invoice: TaxInvoice) -> bool:
    """税务底稿保留有效蓝字票和红字冲销票，让红冲成对数据自然相互抵销。"""
    return invoice.status in {"issued", "red"}


def is_bank_payment_reconciliation_eligible(invoice: TaxInvoice) -> bool:
    """银行付款核对资格的单一事实源。

    会计台账可以保留红字/红冲记录，但付款核对只允许“进项 + 有效 + 正数金额”发票。
    """
    total = Decimal(str(invoice.total_amount)) if invoice.total_amount is not None else Decimal("0")
    return invoice.direction == "input" and invoice.status == "issued" and total > 0


def bank_payment_reconciliation_ineligible_reason(invoice: TaxInvoice) -> str:
    """返回不参与银行付款核对的明确业务原因。"""
    total = Decimal(str(invoice.total_amount)) if invoice.total_amount is not None else Decimal("0")
    if invoice.status == "red":
        return "红冲相关发票不参与银行付款核对"
    if invoice.status == "void":
        return "作废发票不参与银行付款核对"
    if invoice.status != "issued":
        return "待确认或非有效发票不参与银行付款核对"
    if total <= 0:
        return "非正数金额发票不参与银行付款核对"
    if invoice.direction != "input":
        return "非进项发票不参与银行付款核对"
    return "该发票不参与银行付款核对"


def _invoice_number_text(row: TaxInvoice) -> str:
    return f"{row.invoice_code or ''}{row.invoice_number or ''}"


def _red_trace_context(rows: list[TaxInvoice]) -> dict[int, dict]:
    """从税务清单备注和状态中识别红冲蓝字票与红字冲销票的对应关系。"""
    referenced_by: dict[str, list[str]] = {}
    refs_by_invoice: dict[int, tuple[str, str]] = {}
    for row in rows:
        raw = row.raw if isinstance(row.raw, dict) else {}
        note = str(raw.get("备注") or "")
        red_ref = _RED_BLUE_REF_RE.search(note)
        notice = _RED_NOTICE_RE.search(note)
        if red_ref:
            ref = red_ref.group(1)
            refs_by_invoice[row.id] = (ref, notice.group(1) if notice else "")
            referenced_by.setdefault(ref, []).append(_invoice_number_text(row))

    result: dict[int, dict] = {}
    for row in rows:
        amount = Decimal(str(row.total_amount)) if row.total_amount is not None else None
        raw = row.raw if isinstance(row.raw, dict) else {}
        raw_status = str(raw.get("发票状态") or "")
        direct_ref, notice = refs_by_invoice.get(row.id, ("", ""))
        if row.status == "red" and amount is not None and amount < 0:
            result[row.id] = {
                "invoiceStatusLabel": "红字冲销票",
                "redStatus": "red_offset",
                "redRelatedInvoiceNo": direct_ref,
                "redNoticeNo": notice,
            }
        elif row.status == "red" and amount is not None and amount > 0:
            related = direct_ref or (referenced_by.get(row.invoice_number) or [""])[0]
            result[row.id] = {
                "invoiceStatusLabel": "已红冲" if "红冲" in raw_status else "红冲作废",
                "redStatus": "voided_blue",
                "redRelatedInvoiceNo": related,
                "redNoticeNo": notice,
            }
        else:
            result[row.id] = {
                "invoiceStatusLabel": "有效" if row.status == "issued" else "待确认",
                "redStatus": "none",
                "redRelatedInvoiceNo": "",
                "redNoticeNo": "",
            }
    # 红字票的备注有时不带“被红冲蓝字票”文本，补回蓝字票的反向关系。
    for row in rows:
        context = result[row.id]
        if context["redStatus"] == "red_offset" and not context["redRelatedInvoiceNo"]:
            context["redRelatedInvoiceNo"] = (referenced_by.get(row.invoice_number) or [""])[0]
    return result


def _normalize_row(
    row: dict[str, str], parsed: ParsedTaxInvoiceExport, direction_override: str = ""
) -> tuple[dict, str]:
    number = _value(row, parsed, "invoice_number")
    if not number:
        return {}, "缺少发票号码"
    code = _value(row, parsed, "invoice_code")
    amount = _decimal(_value(row, parsed, "amount_excl_tax"))
    tax_amount = _decimal(_value(row, parsed, "tax_amount"))
    total = _decimal(_value(row, parsed, "total_amount"))
    if total is None and amount is not None and tax_amount is not None:
        total = amount + tax_amount
    if amount is None and total is not None and tax_amount is not None:
        amount = total - tax_amount
    issue_date = _datetime(_value(row, parsed, "issue_date"))
    seller_name = _value(row, parsed, "seller_name")
    seller_tax_id = _value(row, parsed, "seller_tax_id")
    buyer_name = _value(row, parsed, "buyer_name")
    buyer_tax_id = _value(row, parsed, "buyer_tax_id")
    if issue_date is None and total is None and not (seller_name or seller_tax_id or buyer_name or buyer_tax_id):
        return {}, "仅有发票号码，缺少日期、金额或购销方信息"
    direction = _direction(_value(row, parsed, "direction"), parsed.direction_hint)
    if direction == "unknown" and direction_override in ("input", "output"):
        direction = direction_override
    # "是否正数发票"直接判定整张发票是否红冲；备注含"被红冲蓝字"也作为红冲依据
    is_positive = row.get("是否正数发票") or row.get("是否正数") or None
    remark = row.get("备注") or row.get("remark") or ""
    return {
        "invoice_key": f"{code}|{number}",
        "direction": direction,
        "invoice_code": code,
        "invoice_number": number,
        "invoice_type": _value(row, parsed, "invoice_type"),
        "status": _status(_value(row, parsed, "status"), total, is_positive, remark),
        "is_positive": is_positive,
        "issue_date": issue_date,
        "seller_name": seller_name,
        "seller_tax_id": seller_tax_id,
        "buyer_name": buyer_name,
        "buyer_tax_id": buyer_tax_id,
        "amount_excl_tax": amount,
        "tax_amount": tax_amount,
        "total_amount": total,
        "currency": _value(row, parsed, "currency") or "CNY",
        "related_order_ref": _value(row, parsed, "related_order_ref"),
    }, ""


def _deactivate_source_ref_links(db: Session, invoice: TaxInvoice, reason: str) -> None:
    """来源订单号失去唯一/有效依据时，只撤销系统 source_ref 确认；人工关联保持不动。"""
    rows = (
        db.query(TaxInvoiceLink)
        .filter(
            TaxInvoiceLink.invoice_id == invoice.id,
            TaxInvoiceLink.match_method == "source_ref",
            TaxInvoiceLink.confirmed.is_(True),
        )
        .all()
    )
    for link in rows:
        link.confirmed = False
        link.confidence = None
        link.note = reason


def _auto_link(db: Session, invoice: TaxInvoice, related_ref: str, direction: str) -> bool:
    """按税务清单明确订单号自动关联。

    保持历史布尔返回契约：True=已自动关联，False=未关联；
    是否需要人工确认由 invoice.match_status == "needs_review" 表达。
    只有整张发票金额和状态最终确定后才能调用。
    """
    ref = related_ref.strip()
    if not ref:
        return False

    candidates: list[tuple[str, int]] = []
    if direction in ("input", "unknown"):
        # 税务清单只给订单号时，必须把所有渠道同号采购单都纳入候选。
        # 不能用 .first() 猜一个，否则 1688 / 拼多多 / 淘宝同号时会错误自动关联。
        for external in db.query(ExternalPurchaseOrder).filter_by(external_order_id=ref).all():
            candidates.append(("external_purchase_order", external.id))
        for jpo in db.query(JackyunPurchaseOrder).filter_by(purch_no=ref).all():
            candidates.append(("jackyun_purchase_order", jpo.id))
    if direction in ("output", "unknown"):
        for sales in db.query(SalesOrder).filter_by(order_no=ref).all():
            candidates.append(("sales_order", sales.id))

    if len(candidates) != 1:
        reason = (
            f"关联单号 {ref} 未找到业务对象，待人工确认"
            if not candidates
            else f"关联单号 {ref} 命中多个采购渠道或业务对象，待人工确认"
        )
        _deactivate_source_ref_links(db, invoice, reason)
        invoice.match_status = "needs_review"
        invoice.match_note = reason
        return False

    invoice_total = quantize(to_decimal(invoice.total_amount))
    if invoice.status != "issued" or invoice_total <= 0:
        # 红冲、作废、待确认和非正数票不参与采购/销售订单金额匹配；
        # 若历史版本曾自动挂过 source_ref，要撤销自动确认，避免旧链接继续计入业务匹配。
        reason = (
            "票据状态待确认，不执行来源订单自动关联"
            if invoice.status == "unknown"
            else "票据已非有效正数发票，撤销来源订单自动关联"
        )
        _deactivate_source_ref_links(db, invoice, reason)
        invoice.match_status = "needs_review" if invoice.status == "unknown" else "unmatched"
        invoice.match_note = reason
        return False

    target_type, target_id = candidates[0]
    exists = (
        db.query(TaxInvoiceLink)
        .filter_by(invoice_id=invoice.id, target_type=target_type, target_id=target_id)
        .first()
    )
    if exists is not None and exists.match_method == "rejected":
        invoice.match_status = "needs_review"
        invoice.match_note = f"关联单号 {ref} 曾被人工解除，待人工确认后重新关联"
        return False

    if exists:
        exists.allocated_amount = invoice_total
        exists.match_method = "source_ref"
        exists.confidence = Decimal("1.0000")
        exists.confirmed = True
        exists.note = "税务官方清单明确提供关联单号"
    else:
        db.add(TaxInvoiceLink(
            invoice_id=invoice.id,
            target_type=target_type,
            target_id=target_id,
            allocated_amount=invoice_total,
            match_method="source_ref",
            confidence=Decimal("1.0000"),
            confirmed=True,
            note="税务官方清单明确提供关联单号",
        ))
    db.flush()
    _sync_business_match_status(db, invoice, target_type)
    invoice.match_note = f"按清单关联单号自动匹配：{target_type}"
    return True


def _serialize_import(row: TaxInvoiceImport) -> dict:
    return {
        "id": row.id,
        "originalName": row.original_name,
        "size": row.size,
        "sha256": row.sha256[:16],
        "sourceSystem": row.source_system,
        "period": f"{row.period_year:04d}-{row.period_month:02d}" if row.period_year and row.period_month else "",
        "sheetName": row.sheet_name,
        "headers": row.headers or [],
        "mapping": row.mapping or {},
        "status": row.status,
        "lifecycle": row.lifecycle,
        "lifecycleChangedAt": row.lifecycle_changed_at.isoformat() if row.lifecycle_changed_at else None,
        "rowCount": row.row_count,
        "recognizedRowCount": row.recognized_row_count,
        "matchedRowCount": row.matched_row_count,
        "needsReviewCount": row.needs_review_count,
        "errorSummary": row.error_summary or "",
        "uploader": row.uploader,
        "importedAt": row.imported_at.isoformat() if row.imported_at else None,
        "createdAt": row.created_at.isoformat() if row.created_at else None,
    }


def serialize_import(row: TaxInvoiceImport) -> dict:
    return _serialize_import(row)


def _payment_method_context(row: TaxInvoice, bank_status: str) -> dict[str, str]:
    """付款方式唯一派生入口；发票业务匹配状态不得参与计算。"""
    manual_method = (
        "personal"
        if row.direction == "input" and row.payment_method == "personal"
        else ""
    )
    if row.direction != "input":
        final_method = ""
    elif bank_status == "matched":
        final_method = "corporate"
    elif bank_status == "partial" and manual_method == "personal":
        final_method = "mixed"
    elif bank_status == "partial":
        final_method = "corporate"
    elif manual_method == "personal":
        final_method = "personal"
    else:
        final_method = ""
    return {
        "manualPaymentMethod": manual_method,
        "paymentMethod": final_method,
    }


def _serialize_invoice(row: TaxInvoice, context: dict | None = None, db: Session | None = None) -> dict:
    payload = {
        "id": row.id,
        "direction": row.direction,
        "invoiceCode": row.invoice_code,
        "invoiceNumber": row.invoice_number,
        "invoiceType": row.invoice_type,
        "status": row.status,
        "issueDate": row.issue_date.isoformat() if row.issue_date else None,
        "sellerName": row.seller_name,
        "sellerTaxId": row.seller_tax_id,
        "buyerName": row.buyer_name,
        "buyerTaxId": row.buyer_tax_id,
        "amountExclTax": str(row.amount_excl_tax) if row.amount_excl_tax is not None else None,
        "taxAmount": str(row.tax_amount) if row.tax_amount is not None else None,
        "totalAmount": str(row.total_amount) if row.total_amount is not None else None,
        "currency": row.currency,
        # matchStatus 保留兼容；新代码必须使用 businessMatchStatus，明确这是发票↔业务单据状态。
        "matchStatus": row.match_status,
        "businessMatchStatus": row.match_status,
        "matchNote": row.match_note,
        "businessMatchNote": row.match_note,
        "processingStatus": _effective_processing_status(row),
        "category": row.category or "",
        "sourceImportId": row.source_import_id,
        "sourceRowIndex": row.source_row_index,
        "verified": bool(row.verified),
        "verifiedMonth": row.verified_month or "",
    }
    if context is not None:
        payload.update(context)
    # 兼容字段也必须镜像实时业务匹配状态，禁止旧调用读到数据库缓存旧值。
    payload["matchStatus"] = payload.get("businessMatchStatus", row.match_status)
    # categoryLabel 跟随最终 category（含明细兜底识别），保证前后端文案一致；
    # 销项走独立 OUTPUT_CATEGORY 文案（空 = 待判断）。
    payload["categoryLabel"] = category_label_for_direction(row.direction, payload.get("category") or "")
    # 银行付款核对与发票业务匹配是两个独立域。
    if "bankPaymentStatus" not in payload:
        if row.direction == "input" and db is not None:
            payload.update(_invoice_bank_payment_context(db, [row]).get(row.id, {}))
        else:
            payload.update({
                "bankPaymentStatus": "not_applicable",
                "bankPaidAmount": "0.00",
                "bankRemainingAmount": "0.00",
            })

    # 付款方式只由“银行付款事实 + 人工 personal 标记”派生。
    # 即使上游 context 带旧字段也在这里覆盖，保证列表/详情/单票一个事实源。
    payload.update(
        _payment_method_context(row, str(payload.get("bankPaymentStatus") or "not_applicable"))
    )
    return payload


def serialize_invoice(row: TaxInvoice, db: Session | None = None) -> dict:
    """序列化单张发票时也实时计算两个独立域，避免返回数据库旧缓存状态。

    - businessMatchStatus：只来自采购/销售业务链接；
    - bankPaymentStatus：只来自 bank_transaction 付款链接。
    """
    if db is None:
        return _serialize_invoice(row)

    context = {
        **_invoice_business_context(db, [row]).get(row.id, {
            "links": [],
            "purchaseOrderNos": [],
            "inboundNos": [],
            "businessMatchStatus": row.match_status,
            "businessMatchedAmount": "0.00",
            "businessRemainingAmount": str(quantize(to_decimal(row.total_amount))),
        }),
        **_red_trace_context([row]).get(row.id, {}),
        **invoice_line_summaries(db, [row]).get(row.id, {"lineItems": [], "lineItemCount": 0}),
        **_invoice_bank_payment_context(db, [row]).get(row.id, {
            "bankPaymentStatus": "not_applicable",
            "bankPaidAmount": "0.00",
            "bankRemainingAmount": "0.00",
        }),
    }
    if row.direction == "input":
        context["paymentMethod"] = (
            "corporate"
            if context["bankPaymentStatus"] in {"partial", "matched"}
            else ""
        )
        if not row.category:
            context["category"] = classify_category_from_items(
                [str(item.get("goodsName") or "") for item in context.get("lineItems", [])]
            )
    elif row.direction == "output":
        context["paymentMethod"] = row.payment_method or ""

    return _serialize_invoice(row, context, db=db)


def _invoice_bank_payment_context(db: Session, rows: list[TaxInvoice]) -> dict[int, dict]:
    """独立计算进项发票的银行付款核对状态；绝不读取/修改 match_status。"""
    input_rows = [row for row in rows if row.direction == "input"]
    if not input_rows:
        return {}

    invoice_ids = [row.id for row in input_rows]
    links = (
        db.query(TaxInvoiceLink)
        .filter(
            TaxInvoiceLink.invoice_id.in_(invoice_ids),
            TaxInvoiceLink.target_type == "bank_transaction",
            TaxInvoiceLink.match_method != "rejected",
            TaxInvoiceLink.confirmed.is_(True),
        )
        .all()
    )
    allocated_by_invoice: dict[int, Decimal] = {}
    invoice_map = {row.id: row for row in input_rows}
    for link in links:
        invoice = invoice_map.get(link.invoice_id)
        if invoice is None:
            continue
        amount = (
            Decimal(str(link.allocated_amount))
            if link.allocated_amount is not None
            else Decimal(str(invoice.total_amount or 0))
        )
        allocated_by_invoice[link.invoice_id] = allocated_by_invoice.get(
            link.invoice_id, Decimal("0")
        ) + amount

    result: dict[int, dict] = {}
    tolerance = Decimal("0.01")
    for row in input_rows:
        if not is_bank_payment_reconciliation_eligible(row):
            result[row.id] = {
                "bankPaymentStatus": "not_applicable",
                "bankPaidAmount": "0.00",
                "bankRemainingAmount": "0.00",
            }
            continue
        total = Decimal(str(row.total_amount or 0))
        paid = min(max(allocated_by_invoice.get(row.id, Decimal("0")), Decimal("0")), total)
        remaining = max(total - paid, Decimal("0"))
        if paid <= 0:
            status = "unmatched"
        elif remaining <= tolerance:
            status = "matched"
        else:
            status = "partial"
        result[row.id] = {
            "bankPaymentStatus": status,
            "bankPaidAmount": str(paid.quantize(Decimal("0.01"))),
            "bankRemainingAmount": str(remaining.quantize(Decimal("0.01"))),
        }
    return result


def _invoice_business_context(db: Session, rows: list[TaxInvoice]) -> dict[int, dict]:
    """只补充发票↔采购/销售业务关联；银行付款链接严禁混入业务 links。"""
    invoice_ids = [row.id for row in rows]
    if not invoice_ids:
        return {}
    business_target_types = (
        "alibaba1688_order",
        "external_purchase_order",
        "jackyun_purchase_order",
        "sales_order",
    )
    links = (
        db.query(TaxInvoiceLink)
        .filter(
            TaxInvoiceLink.invoice_id.in_(invoice_ids),
            TaxInvoiceLink.target_type.in_(business_target_types),
            TaxInvoiceLink.match_method != "rejected",
            TaxInvoiceLink.confirmed.is_(True),
        )
        .order_by(TaxInvoiceLink.id)
        .all()
    )
    by_type: dict[str, set[int]] = {}
    links_by_invoice: dict[int, list[TaxInvoiceLink]] = {}
    for link in links:
        by_type.setdefault(link.target_type, set()).add(link.target_id)
        links_by_invoice.setdefault(link.invoice_id, []).append(link)

    alibaba = {
        row.id: row
        for row in db.query(Alibaba1688Order).filter(Alibaba1688Order.id.in_(by_type.get("alibaba1688_order", set()))).all()
    }
    external = {
        row.id: row
        for row in db.query(ExternalPurchaseOrder).filter(ExternalPurchaseOrder.id.in_(by_type.get("external_purchase_order", set()))).all()
    }
    jackyun = {
        row.id: row
        for row in db.query(JackyunPurchaseOrder).filter(JackyunPurchaseOrder.id.in_(by_type.get("jackyun_purchase_order", set()))).all()
    }
    sales = {
        row.id: row
        for row in db.query(SalesOrder).filter(SalesOrder.id.in_(by_type.get("sales_order", set()))).all()
    }

    # 入库单通过采购链路关联到 1688 订单或本系统采购单；吉客云采购单再通过采购单映射回去。
    external_ids = set(external)
    jpo_links = (
        db.query(JackyunPurchaseOrderLink)
        .filter(JackyunPurchaseOrderLink.jackyun_po_id.in_(by_type.get("jackyun_purchase_order", set())))
        .all()
    )
    external_ids.update(link.po_id for link in jpo_links)
    chain_links = []
    if external_ids or by_type.get("alibaba1688_order"):
        query = db.query(ProcurementChainLink).filter(ProcurementChainLink.target_type == "inbound")
        if external_ids and by_type.get("alibaba1688_order"):
            query = query.filter(
                or_(
                    ProcurementChainLink.external_po_id.in_(external_ids),
                    ProcurementChainLink.order_id.in_(by_type["alibaba1688_order"]),
                )
            )
        elif external_ids:
            query = query.filter(ProcurementChainLink.external_po_id.in_(external_ids))
        else:
            query = query.filter(ProcurementChainLink.order_id.in_(by_type["alibaba1688_order"]))
        chain_links = query.all()
    inbound_ids = {link.target_id for link in chain_links if link.match_method != "rejected"}
    inbound = {
        row.id: row
        for row in db.query(JackyunGoodsDocument).filter(JackyunGoodsDocument.id.in_(inbound_ids)).all()
    }
    inbound_by_target: dict[tuple[str, int], list[str]] = {}
    for link in chain_links:
        if link.match_method == "rejected":
            continue
        target_key = (
            "external_purchase_order", link.external_po_id
        ) if link.external_po_id is not None else ("alibaba1688_order", link.order_id)
        document = inbound.get(link.target_id)
        if document is not None:
            inbound_by_target.setdefault(target_key, []).append(document.goodsdoc_no)
    for link in jpo_links:
        for inbound_no in inbound_by_target.get(("external_purchase_order", link.po_id), []):
            inbound_by_target.setdefault(("jackyun_purchase_order", link.jackyun_po_id), []).append(inbound_no)

    target_maps = {
        "alibaba1688_order": alibaba,
        "external_purchase_order": external,
        "jackyun_purchase_order": jackyun,
        "sales_order": sales,
    }
    invoice_row_map = {row.id: row for row in rows}
    result: dict[int, dict] = {}
    for invoice_id in invoice_ids:
        invoice = invoice_row_map[invoice_id]
        domain_types = (
            (SALES_LINK_TARGET_TYPE,)
            if invoice.direction == "output"
            else PURCHASE_LINK_TARGET_TYPES
        )
        invoice_links = [
            link for link in links_by_invoice.get(invoice_id, [])
            if link.target_type in domain_types
        ]
        purchase_nos: list[str] = []
        inbound_nos: list[str] = []
        link_rows: list[dict] = []
        valid_invoice_links: list[TaxInvoiceLink] = []
        invalid_link_count = 0
        for link in invoice_links:
            target = target_maps.get(link.target_type, {}).get(link.target_id)
            target_exists = target is not None
            target_valid = target_exists and (
                link.target_type != "sales_order" or is_deal_status(target.order_status)
            )
            if target_valid:
                valid_invoice_links.append(link)
            else:
                invalid_link_count += 1
            if link.target_type == "alibaba1688_order":
                target_no = target.external_order_id if target else f"#{link.target_id}"
                target_label = f"1688采购单 {target_no}"
                if target_valid:
                    purchase_nos.append(target_no)
            elif link.target_type == "external_purchase_order":
                target_no = target.external_order_id if target else f"#{link.target_id}"
                target_label = f"采购单 {target_no}"
                if target_valid:
                    purchase_nos.append(target_no)
            elif link.target_type == "jackyun_purchase_order":
                target_no = (target.purch_no or target.jackyun_purch_id) if target else f"#{link.target_id}"
                target_label = f"吉客云采购单 {target_no}"
                if target_valid:
                    purchase_nos.append(target_no)
            elif link.target_type == "sales_order":
                target_no = target.order_no if target else f"#{link.target_id}"
                target_label = f"销售单 {target_no}"
            else:
                target_no = f"#{link.target_id}"
                target_label = f"业务单 {target_no}"
            if target_valid:
                inbound_nos.extend(inbound_by_target.get((link.target_type, link.target_id), []))
            link_rows.append({
                "id": link.id,
                "targetType": link.target_type,
                "targetId": link.target_id,
                "targetNo": target_no,
                "targetLabel": target_label,
                "targetExists": target_exists,
                "targetValid": target_valid,
                "allocatedAmount": str(quantize(to_decimal(link.allocated_amount))) if link.allocated_amount is not None else None,
                "matchMethod": link.match_method,
                "confirmed": bool(link.confirmed),
                "note": link.note or "",
            })
        invoice_total = quantize(to_decimal(invoice.total_amount))
        explicit_allocated = sum(
            (
                quantize(to_decimal(link.allocated_amount))
                for link in valid_invoice_links
                if link.allocated_amount is not None
            ),
            Decimal("0"),
        )
        has_unknown_allocation = any(link.allocated_amount is None for link in valid_invoice_links)
        if invoice_total > 0:
            business_matched = min(max(explicit_allocated, Decimal("0")), invoice_total)
            business_remaining = max(invoice_total - business_matched, Decimal("0"))
            if invalid_link_count or has_unknown_allocation:
                business_status = "needs_review"
            elif business_matched <= Decimal("0"):
                business_status = "needs_review" if invoice.match_status == "needs_review" else "unmatched"
            elif business_remaining <= Decimal("0.01"):
                business_status = "matched"
            else:
                business_status = "partial"
        else:
            business_matched = Decimal("0")
            business_remaining = Decimal("0")
            business_status = invoice.match_status

        result[invoice_id] = {
            "links": link_rows,
            "purchaseOrderNos": list(dict.fromkeys(purchase_nos)),
            "inboundNos": list(dict.fromkeys(inbound_nos)),
            "businessMatchStatus": business_status,
            "businessMatchedAmount": str(quantize(business_matched)),
            "businessRemainingAmount": str(quantize(business_remaining)),
            "invalidLinkCount": invalid_link_count,
        }
    return result


def _ingest_rows(
    db: Session, batch: TaxInvoiceImport, parsed: ParsedTaxInvoiceExport
) -> tuple[int, int, int]:
    """把解析行写入标准台账；新导入与历史批次重处理共用这一段。"""
    direction_overrides = _infer_batch_directions(parsed.rows, parsed)
    records_by_index = {
        record.row_index: record
        for record in db.query(TaxInvoiceImportRecord).filter_by(import_id=batch.id).all()
    }
    recognized = 0
    matched = 0
    needs_review = 0
    # 一票多行（正数行 + 折扣行）时，金额需累加所有明细行；否则最后一行（通常是折扣行）
    # 会把发票总额覆盖成负数，误判为红冲。按 invoice_key 累计不含税金额、税额、价税合计。
    amounts_by_invoice: dict[str, dict] = {}
    processed_invoices: dict[str, TaxInvoice] = {}
    row_indices_by_invoice: dict[str, list[int]] = {}
    related_refs_by_invoice: dict[str, set[str]] = {}
    for row_index, raw in enumerate(parsed.rows, start=1):
        normalized, error = _normalize_row(
            raw, parsed, direction_override=direction_overrides.get(row_index - 1, "")
        )
        record = records_by_index.get(row_index)
        if record is None:
            record = TaxInvoiceImportRecord(import_id=batch.id, row_index=row_index)
            db.add(record)
            records_by_index[row_index] = record
        previous_invoice = db.get(TaxInvoice, record.invoice_id) if record.invoice_id else None
        record.payload = raw
        record.recognition_status = "recognized" if not error else "needs_review"
        record.error_summary = error
        if error:
            record.invoice_id = None
            needs_review += 1
            continue

        invoice_key = normalized["invoice_key"]
        invoice = db.query(TaxInvoice).filter_by(invoice_key=invoice_key).first()
        if (
            invoice is None
            and previous_invoice is not None
            and previous_invoice.source_import_id == batch.id
            and previous_invoice.source_row_index == row_index
        ):
            # 兼容历史批次：解析规则从空的“发票号码”切换到“数电发票号码”时，
            # 沿用原行已有的台账记录，避免同一行产生第二张可见发票。
            invoice = previous_invoice
            invoice.invoice_key = invoice_key
        if invoice is None:
            invoice = TaxInvoice(
                invoice_key=invoice_key,
                invoice_number=normalized["invoice_number"],
            )
            db.add(invoice)
            db.flush()
        for field in (
            "direction", "invoice_code", "invoice_number", "invoice_type", "status", "issue_date",
            "seller_name", "seller_tax_id", "buyer_name", "buyer_tax_id", "currency",
        ):
            value = normalized[field]
            if value not in (None, ""):
                setattr(invoice, field, value)
        # 金额类字段按明细行累加，跳过“合计”行（货物名称为空或为合计/总计）。
        # 只有文件确实带货物明细列时才做这个判断：税务清单类导出是每行一张发票、
        # 没有货物列，若也按“货物名称为空”过滤，会把整张发票的金额全部丢掉。
        goods_keys = (
            "货物或应税劳务名称", "货物或应税劳务、服务名称", "项目名称", "货物名称",
        )
        has_goods_column = any(key in raw for key in goods_keys)
        goods_name = (
            raw.get("货物或应税劳务名称")
            or raw.get("货物或应税劳务、服务名称")
            or raw.get("项目名称")
            or raw.get("货物名称")
            or ""
        )
        is_total_row = has_goods_column and str(goods_name).strip() in ("", "合计", "总计")
        if invoice_key not in amounts_by_invoice:
            amounts_by_invoice[invoice_key] = {
                "amount_excl_tax": Decimal("0"),
                "tax_amount": Decimal("0"),
                "total_amount": Decimal("0"),
                "has_amount": False, "has_tax": False, "has_total": False,
            }
        if not is_total_row:
            acc = amounts_by_invoice[invoice_key]
            amt = normalized["amount_excl_tax"]
            tax = normalized["tax_amount"]
            tot = normalized["total_amount"]
            if isinstance(amt, Decimal):
                acc["amount_excl_tax"] += amt
                acc["has_amount"] = True
            if isinstance(tax, Decimal):
                acc["tax_amount"] += tax
                acc["has_tax"] = True
            if isinstance(tot, Decimal):
                acc["total_amount"] += tot
                acc["has_total"] = True
        invoice.source_import_id = batch.id
        invoice.source_row_index = row_index
        invoice.source_system = "tax_export"
        invoice.raw = raw
        invoice.match_status = invoice.match_status or "unmatched"
        processed_invoices[invoice_key] = invoice
        row_indices_by_invoice.setdefault(invoice_key, []).append(row_index)
        related_ref = str(normalized.get("related_order_ref") or "").strip()
        if related_ref:
            related_refs_by_invoice.setdefault(invoice_key, set()).add(related_ref)
        record.invoice_id = invoice.id
        recognized += 1

    # 所有行处理完后，把累加金额写回发票，并重新判定票据状态（红冲与否看发票总额，不看单行）
    for invoice_key, invoice in processed_invoices.items():
        acc = amounts_by_invoice.get(invoice_key)
        if acc is None:
            continue
        if acc["has_amount"]:
            invoice.amount_excl_tax = acc["amount_excl_tax"]
        if acc["has_tax"]:
            invoice.tax_amount = acc["tax_amount"]
        if acc["has_total"]:
            invoice.total_amount = acc["total_amount"]
        # 状态重判：红冲必须是整张发票（是否正数发票=否），不能因单行折扣误判
        raw = invoice.raw if isinstance(invoice.raw, dict) else {}
        raw_status = raw.get("发票状态") or ""
        is_positive = raw.get("是否正数发票") or raw.get("是否正数")
        remark = raw.get("备注") or raw.get("remark") or ""
        invoice.status = _status(raw_status, invoice.total_amount, is_positive, remark)

    # 金额与票据状态全部最终确定后，才允许按清单订单号自动关联。
    # 同一发票多行只处理一次；多行出现多个不同订单号时严禁逐行乱挂。
    for invoice_key, invoice in processed_invoices.items():
        row_indices = row_indices_by_invoice.get(invoice_key, [])
        refs = related_refs_by_invoice.get(invoice_key, set())
        outcome = "skipped"
        review_reason = ""
        if len(refs) > 1:
            review_reason = "同一张发票的多行出现多个不同关联订单号，待人工确认"
            _deactivate_source_ref_links(db, invoice, review_reason)
            invoice.match_status = "needs_review"
            invoice.match_note = review_reason
            outcome = "needs_review"
        elif len(refs) == 1:
            linked = _auto_link(db, invoice, next(iter(refs)), invoice.direction)
            if linked:
                outcome = "matched"
            elif invoice.match_status == "needs_review":
                outcome = "needs_review"
                review_reason = invoice.match_note or "关联订单待人工确认"

        if outcome == "matched":
            matched += len(row_indices)
        elif outcome == "needs_review":
            needs_review += len(row_indices)
            for row_index in row_indices:
                record = records_by_index.get(row_index)
                if record is not None:
                    record.recognition_status = "needs_review"
                    record.error_summary = review_reason

    batch.sheet_name = parsed.sheet_name
    batch.headers = parsed.headers
    batch.mapping = parsed.mapping
    batch.row_count = len(parsed.rows)
    batch.recognized_row_count = recognized
    batch.matched_row_count = matched
    batch.needs_review_count = needs_review
    batch.status = "needs_review" if needs_review else "parsed"
    batch.error_summary = f"{needs_review} 行需要人工核对" if needs_review else ""
    return recognized, matched, needs_review


def import_export(
    db: Session,
    *,
    content: bytes,
    original_name: str,
    actor: str,
    period_year: int = 0,
    period_month: int = 0,
    auto_confirm: bool = False,
) -> tuple[TaxInvoiceImport, bool]:
    if not content:
        raise ValueError("空文件")
    if len(content) > settings.MAX_UPLOAD_BYTES:
        limit = settings.MAX_UPLOAD_BYTES // (1024 * 1024)
        raise ValueError(f"税务发票清单超过单文件上限（{limit} MiB）")
    original_name = original_name or "tax-invoices.xlsx"
    sha256 = hashlib.sha256(content).hexdigest()
    existing = db.query(TaxInvoiceImport).filter_by(sha256=sha256).first()
    if existing:
        return existing, True

    parsed = parse_tax_invoice_export(content, original_name, max_rows=settings.MAX_JACKYUN_IMPORT_ROWS)
    target, created_file = _store_new_file(content, original_name, sha256)
    now = datetime.now(ZoneInfo(settings.TZ))
    batch = TaxInvoiceImport(
        original_name=original_name,
        stored_path=str(target),
        sha256=sha256,
        size=len(content),
        mime=mimetypes.guess_type(original_name)[0] or "application/octet-stream",
        period_year=period_year,
        period_month=period_month,
        sheet_name=parsed.sheet_name,
        headers=parsed.headers,
        mapping=parsed.mapping,
        uploader=actor,
        lifecycle="active" if auto_confirm else "draft",
        lifecycle_changed_at=now,
        imported_at=now,
    )
    db.add(batch)
    db.flush()

    recognized, matched, needs_review = _ingest_rows(db, batch, parsed)
    try:
        db.commit()
    except Exception:
        db.rollback()
        if created_file:
            target.unlink(missing_ok=True)
        raise
    audit(db, actor, "tax.invoice_import.upload", "tax_invoice_imports", batch.id, {
        "rows": batch.row_count,
        "recognized": batch.recognized_row_count,
        "needsReview": batch.needs_review_count,
    })
    return batch, False


def reprocess_import(db: Session, import_id: int, actor: str = "system") -> TaxInvoiceImport:
    """用当前解析规则重处理一个已保存批次，保留原始行和用户行级删除状态。"""
    batch = db.get(TaxInvoiceImport, import_id)
    if batch is None:
        raise LookupError(f"tax_invoice_imports #{import_id} 不存在")
    if batch.lifecycle == "deleted":
        raise ValueError("回收站批次不能重处理，请先恢复")
    path = Path(batch.stored_path)
    if not path.is_file():
        raise ValueError("找不到该导入的原始文件，无法重处理")
    parsed = parse_tax_invoice_export(
        path.read_bytes(), batch.original_name, max_rows=settings.MAX_JACKYUN_IMPORT_ROWS
    )
    recognized, matched, needs_review = _ingest_rows(db, batch, parsed)
    db.commit()
    audit(
        db,
        actor,
        "tax.invoice_import.reprocess",
        "tax_invoice_imports",
        batch.id,
        {"rows": len(parsed.rows), "recognized": recognized, "matched": matched, "needsReview": needs_review},
    )
    return batch


def list_imports(db: Session, lifecycle: str | None = None, limit: int = 50) -> list[dict]:
    query = db.query(TaxInvoiceImport).order_by(TaxInvoiceImport.id.desc())
    query = filter_lifecycle(query, TaxInvoiceImport, lifecycle)
    rows = query.limit(min(max(limit, 1), 200)).all()
    return [_serialize_import(row) for row in rows]


def confirm_import(db: Session, import_id: int, actor: str) -> TaxInvoiceImport:
    return transition_lifecycle(
        db, TaxInvoiceImport, import_id,
        target="active", allowed_from=("draft",),
        actor=actor, audit_action="tax.invoice_import.confirm",
    )


def soft_delete_import(db: Session, import_id: int, actor: str) -> TaxInvoiceImport:
    return transition_lifecycle(
        db, TaxInvoiceImport, import_id,
        target="deleted", allowed_from=("draft", "active"),
        actor=actor, audit_action="tax.invoice_import.soft_delete",
    )


def restore_import(db: Session, import_id: int, actor: str) -> TaxInvoiceImport:
    return transition_lifecycle(
        db, TaxInvoiceImport, import_id,
        target="draft", allowed_from=("deleted",),
        actor=actor, audit_action="tax.invoice_import.restore",
    )


def delete_row(db: Session, import_id: int, row_index: int, actor: str) -> TaxInvoiceImportRecord:
    """明细核对：删除单行（可恢复）；对应发票同步从台账隐藏。"""
    return transition_row_status(
        db, TaxInvoiceImportRecord,
        lookup={"import_id": import_id, "row_index": row_index},
        target="deleted", actor=actor, audit_action="tax.invoice_import.delete_row",
    )


def restore_row(db: Session, import_id: int, row_index: int, actor: str) -> TaxInvoiceImportRecord:
    return transition_row_status(
        db, TaxInvoiceImportRecord,
        lookup={"import_id": import_id, "row_index": row_index},
        target="active", actor=actor, audit_action="tax.invoice_import.restore_row",
    )


def filter_visible_invoices(query):
    """发票台账可见口径 = 导入 active 且来源明细行未被用户删除。

    供本服务与采购链路共用，避免两处口径漂移。
    无来源行（历史遗留 NULL）的发票保留。
    """
    record = aliased(TaxInvoiceImportRecord)
    query = filter_active_import(query, TaxInvoice, TaxInvoiceImport, TaxInvoice.source_import_id)
    return (
        query.outerjoin(
            record,
            and_(
                record.import_id == TaxInvoice.source_import_id,
                record.row_index == TaxInvoice.source_row_index,
            ),
        )
        .filter(or_(record.id.is_(None), record.row_status != "deleted"))
    )


def list_invoices(
    db: Session,
    *,
    direction: str | None = None,
    status: str | None = None,
    match_status: str | None = None,
    processing_status: str | None = None,
    category: str | None = None,
    verified: bool | None = None,
    limit: int = 200,
    offset: int = 0,
) -> list[dict]:
    query = filter_visible_invoices(db.query(TaxInvoice)).order_by(
        TaxInvoice.issue_date.desc().nullslast(), TaxInvoice.id.desc()
    )
    if direction:
        query = query.filter(TaxInvoice.direction == direction)
    if status:
        query = query.filter(TaxInvoice.status == status)
    if match_status:
        if match_status not in {"matched", "partial", "unmatched", "needs_review"}:
            raise ValueError("无效的业务匹配状态")

        def _business_stats(target_types: tuple[str, ...]):
            return (
                db.query(
                    TaxInvoiceLink.invoice_id.label("invoice_id"),
                    func.coalesce(
                        func.sum(TaxInvoiceLink.allocated_amount), Decimal("0")
                    ).label("allocated"),
                    func.coalesce(
                        func.sum(
                            case(
                                (TaxInvoiceLink.allocated_amount.is_(None), 1),
                                else_=0,
                            )
                        ),
                        0,
                    ).label("unknown_count"),
                )
                .filter(
                    TaxInvoiceLink.target_type.in_(target_types),
                    TaxInvoiceLink.match_method != "rejected",
                    TaxInvoiceLink.confirmed.is_(True),
                )
                .group_by(TaxInvoiceLink.invoice_id)
                .subquery()
            )

        purchase_stats = _business_stats(PURCHASE_LINK_TARGET_TYPES)
        sales_stats = _business_stats((SALES_LINK_TARGET_TYPE,))
        query = (
            query.outerjoin(
                purchase_stats, purchase_stats.c.invoice_id == TaxInvoice.id
            )
            .outerjoin(
                sales_stats, sales_stats.c.invoice_id == TaxInvoice.id
            )
        )

        purchase_allocated = func.coalesce(
            purchase_stats.c.allocated, Decimal("0")
        )
        sales_allocated = func.coalesce(
            sales_stats.c.allocated, Decimal("0")
        )
        allocated = case(
            (TaxInvoice.direction == "output", sales_allocated),
            else_=purchase_allocated,
        )
        purchase_unknown = func.coalesce(purchase_stats.c.unknown_count, 0)
        sales_unknown = func.coalesce(sales_stats.c.unknown_count, 0)
        unknown_count = case(
            (TaxInvoice.direction == "output", sales_unknown),
            else_=purchase_unknown,
        )
        invoice_total = func.coalesce(TaxInvoice.total_amount, Decimal("0"))
        zero_status = case(
            (TaxInvoice.match_status == "needs_review", "needs_review"),
            else_="unmatched",
        )
        business_status = case(
            (invoice_total <= 0, TaxInvoice.match_status),
            (unknown_count > 0, "needs_review"),
            (allocated <= 0, zero_status),
            (invoice_total - allocated <= Decimal("0.01"), "matched"),
            else_="partial",
        )
        query = query.filter(business_status == match_status)
    if processing_status:
        query = query.filter(TaxInvoice.processing_status == processing_status)
    if category is not None:
        # category 按分类枚举过滤（空字符串 = 待判断/未分类）；筛选参数方向无关，收进项+销项并集。
        if category and category not in CATEGORY_ALL_KEYS:
            raise ValueError(
                "无效的发票类别，合法值：进项 " + "、".join(CATEGORY_V2_KEYS)
                + "；销项 " + "、".join(OUTPUT_CATEGORY_KEYS) + "；或空（待判断）"
            )
        query = query.filter(TaxInvoice.category == category)
    if verified is not None:
        query = query.filter(TaxInvoice.verified == verified)
    rows = query.limit(min(max(limit, 1), 500)).offset(max(offset, 0)).all()
    context = _invoice_business_context(db, rows)
    red_context = _red_trace_context(rows)
    line_context = invoice_line_summaries(db, rows)
    bank_payment_context = _invoice_bank_payment_context(db, rows)
    result = []
    for row in rows:
        ctx = {
            **context.get(row.id, {"links": [], "purchaseOrderNos": [], "inboundNos": []}),
            **red_context.get(row.id, {}),
            **line_context.get(row.id, {"lineItems": [], "lineItemCount": 0}),
            **bank_payment_context.get(row.id, {
                "bankPaymentStatus": "not_applicable",
                "bankPaidAmount": "0.00",
                "bankRemainingAmount": "0.00",
            }),
        }
        # 明细兜底识别只面向进项（6+1）；销项分类不按货物名推断，空即待判断。
        if not row.category and row.direction != "output":
            ctx["category"] = classify_category_from_items(
                [str(item.get("goodsName") or "") for item in ctx.get("lineItems", [])]
            )
        result.append(_serialize_invoice(row, ctx, db))
    return result


def summary(db: Session) -> dict:
    rows = filter_visible_invoices(db.query(TaxInvoice)).all()
    red_context = _red_trace_context(rows)
    business_context = _invoice_business_context(db, rows)
    active_import_ids = [
        row.id for row in db.query(TaxInvoiceImport.id).filter(TaxInvoiceImport.lifecycle == "active").all()
    ]
    source_row_count = (
        db.query(TaxInvoiceImportRecord)
        .filter(
            TaxInvoiceImportRecord.import_id.in_(active_import_ids),
            TaxInvoiceImportRecord.row_status != "deleted",
            TaxInvoiceImportRecord.invoice_id.isnot(None),
        )
        .count()
        if active_import_ids else 0
    )
    raw_input_total = sum(
        (Decimal(str(row.total_amount)) for row in rows if row.direction == "input" and row.total_amount is not None),
        Decimal("0"),
    )
    effective_input_total = Decimal("0")
    excluded_red_amount = Decimal("0")
    for row in rows:
        if row.direction != "input" or row.total_amount is None:
            continue
        amount = Decimal(str(row.total_amount))
        if row.status == "issued" or amount < 0:
            effective_input_total += amount
        elif row.status == "red" and amount > 0:
            # 已红冲蓝字票只有在对应红字票也存在时才进入净额；否则先排除并提示。
            if red_context.get(row.id, {}).get("redRelatedInvoiceNo"):
                effective_input_total += amount
            else:
                excluded_red_amount += amount
    out = {
        "total": len(rows),
        "activeBatchCount": len(active_import_ids),
        "sourceRowCount": source_row_count,
        "duplicateRowCount": max(source_row_count - len(rows), 0),
        "byDirection": {"input": 0, "output": 0, "unknown": 0},
        "byStatus": {"issued": 0, "void": 0, "red": 0, "unknown": 0},
        "byMatchStatus": {"matched": 0, "partial": 0, "unmatched": 0, "needs_review": 0},
        "byProcessing": {"pending": 0, "required": 0, "not_required": 0},
        "byCategory": {key: 0 for key in CATEGORY_V2_KEYS} | {"": 0},
        "byCategoryGroup": {"operating": 0, "reimburse": 0, "excluded": 0, "pending": 0},
        "byVerification": {"verified": 0, "unverified": 0},
        "inputVerification": {"verified": 0, "unverified": 0},
        "inputTotalAmount": float(effective_input_total),
        "rawInputTotalAmount": float(raw_input_total),
        "excludedRedAmount": float(excluded_red_amount),
    }
    for row in rows:
        out["byDirection"][row.direction] = out["byDirection"].get(row.direction, 0) + 1
        out["byStatus"][row.status] = out["byStatus"].get(row.status, 0) + 1
        business_status = business_context.get(row.id, {}).get(
            "businessMatchStatus", row.match_status
        )
        out["byMatchStatus"][business_status] = out["byMatchStatus"].get(business_status, 0) + 1
        if row.direction == "input":
            processing_status = _effective_processing_status(row)
            out["byProcessing"][processing_status] = out["byProcessing"].get(processing_status, 0) + 1
            # 分类与派生组计数：运营成本 / 报销成本 / 不计入 / 待判断。
            category = row.category or ""
            out["byCategory"][category] = out["byCategory"].get(category, 0) + 1
            out["byCategoryGroup"][category_group(category)] += 1
        out["byVerification"]["verified" if row.verified else "unverified"] += 1
        if row.direction == "input" and row.status == "issued":
            out["inputVerification"]["verified" if row.verified else "unverified"] += 1
    return out


def list_import_records(db: Session, import_id: int, limit: int = 200) -> list[dict]:
    rows = (
        db.query(TaxInvoiceImportRecord)
        .filter_by(import_id=import_id)
        .order_by(TaxInvoiceImportRecord.row_index)
        .limit(min(max(limit, 1), 1000))
        .all()
    )
    return [{
        "rowIndex": row.row_index,
        "recognitionStatus": row.recognition_status,
        "invoiceId": row.invoice_id,
        "errorSummary": row.error_summary,
        "rowStatus": row.row_status,
        "payload": row.payload,
    } for row in rows]


_LINE_PLACEHOLDERS = {"-", "--", "/", "—", "――", "－"}


def _line_text(payload: dict, key: str) -> str | None:
    value = payload.get(key)
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _line_number(payload: dict, key: str) -> Decimal | str | None:
    """数字字段尝试解析成 Decimal（兼容 ¥、逗号、括号负数）；解析失败保留原文本。"""
    text = _line_text(payload, key)
    if text is None or text in _LINE_PLACEHOLDERS:
        return None
    parsed = _decimal(text)
    return parsed if parsed is not None else text


def _line_out(value: Decimal | str | None) -> str | None:
    return str(value) if isinstance(value, Decimal) else value


def _line_text_first(payload: dict, *keys: str) -> str | None:
    for key in keys:
        value = _line_text(payload, key)
        if value is not None:
            return value
    return None


def _line_number_first(payload: dict, *keys: str) -> Decimal | str | None:
    for key in keys:
        value = _line_number(payload, key)
        if value is not None:
            return value
    return None


def _parse_line_item(
    payload: dict,
) -> tuple[dict, Decimal | str | None, Decimal | str | None, Decimal | str | None] | None:
    goods_name = _line_text_first(
        payload, "货物或应税劳务名称", "货物或应税劳务、服务名称", "项目名称"
    )
    if goods_name is None:
        return None
    amount = _line_number_first(payload, "金额", "不含税金额")
    tax_amount = _line_number_first(payload, "税额")
    total_amount = _line_number_first(payload, "价税合计", "含税金额")
    return (
        {
            "goodsName": goods_name,
            "spec": _line_text(payload, "规格型号"),
            "unit": _line_text(payload, "单位"),
            "quantity": _line_out(_line_number_first(payload, "数量")),
            "unitPrice": _line_out(_line_number_first(payload, "单价", "不含税单价")),
            "amount": _line_out(amount),
            "taxRate": _line_text(payload, "税率"),
            "taxAmount": _line_out(tax_amount),
            "totalAmount": _line_out(total_amount),
            "remark": _line_text(payload, "备注"),
        },
        amount,
        tax_amount,
        total_amount,
    )


def _norm_num(value) -> str:
    """把 31 / 31.0 / 31.00 归一化为同一字符串，避免重复行因小数尾巴不同而漏去重。"""
    if value in (None, ""):
        return ""
    try:
        return str(Decimal(str(value)).normalize())
    except Exception:
        return str(value)


def _dedupe_line_items(items: list[dict]) -> list[dict]:
    """税务导出清单偶有完全相同的明细行重复出现（同一货物、数量、单价、金额），
    导致明细合计翻倍而与发票头价税合计不一致。按核心字段去重，只保留首次出现。"""
    seen: set[tuple] = set()
    unique: list[dict] = []
    for item in items:
        key = (
            str(item.get("goodsName") or ""),
            str(item.get("spec") or ""),
            str(item.get("unit") or ""),
            _norm_num(item.get("quantity")),
            _norm_num(item.get("unitPrice")),
            _norm_num(item.get("amount")),
            str(item.get("taxRate") or ""),
            _norm_num(item.get("taxAmount")),
            _norm_num(item.get("totalAmount")),
        )
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return unique


def invoice_detail_lines(db: Session, invoice_id: int) -> dict:
    """一张发票的货物明细行 = 清单导入记录中 invoice_id 指向该发票且 active 的全部行。

    一票多行（同一 invoice_key 的多行清单）都指向同一张台账发票；payload 里没有
    「货物或应税劳务名称」键的行不是货物明细行，跳过。
    """
    invoice = db.get(TaxInvoice, invoice_id)
    if invoice is None:
        raise LookupError(f"tax_invoices #{invoice_id} 不存在")
    records = (
        db.query(TaxInvoiceImportRecord)
        .filter(
            TaxInvoiceImportRecord.invoice_id == invoice_id,
            TaxInvoiceImportRecord.row_status == "active",
        )
        .order_by(TaxInvoiceImportRecord.id)
        .all()
    )
    items: list[dict] = []
    sum_amount = Decimal("0")
    sum_tax = Decimal("0")
    sum_total = Decimal("0")
    has_amount = has_tax = has_total = False
    for record in records:
        payload = record.payload if isinstance(record.payload, dict) else {}
        parsed = _parse_line_item(payload)
        if parsed is None:
            continue
        item, amount, tax_amount, total_amount = parsed
        if isinstance(amount, Decimal):
            sum_amount += amount
            has_amount = True
        if isinstance(tax_amount, Decimal):
            sum_tax += tax_amount
            has_tax = True
        if isinstance(total_amount, Decimal):
            sum_total += total_amount
            has_total = True
        items.append(item)
    items = _dedupe_line_items(items)
    # 去重后重新合计，避免重复行把金额翻倍
    sum_amount = Decimal("0")
    sum_tax = Decimal("0")
    sum_total = Decimal("0")
    has_amount = has_tax = has_total = False
    for item in items:
        amt = item.get("amount")
        tax = item.get("taxAmount")
        tot = item.get("totalAmount")
        if amt not in (None, ""):
            sum_amount += Decimal(str(amt))
            has_amount = True
        if tax not in (None, ""):
            sum_tax += Decimal(str(tax))
            has_tax = True
        if tot not in (None, ""):
            sum_total += Decimal(str(tot))
            has_total = True
    return {
        "items": items,
        "total": len(items),
        "sumAmount": float(sum_amount) if has_amount else None,
        "sumTax": float(sum_tax) if has_tax else None,
        "sumTotal": float(sum_total) if has_total else None,
    }


def invoice_line_summaries(db: Session, rows: list[TaxInvoice], max_items: int = 3) -> dict[int, dict]:
    """为发票列表一次性补充当前导入批次的明细摘要，避免列表逐票请求明细接口。"""
    invoice_ids = [row.id for row in rows]
    import_ids = {row.source_import_id for row in rows if row.source_import_id is not None}
    if not invoice_ids or not import_ids:
        return {}
    row_by_id = {row.id: row for row in rows}
    records = (
        db.query(TaxInvoiceImportRecord)
        .filter(
            TaxInvoiceImportRecord.invoice_id.in_(invoice_ids),
            TaxInvoiceImportRecord.import_id.in_(import_ids),
            TaxInvoiceImportRecord.row_status == "active",
        )
        .order_by(TaxInvoiceImportRecord.invoice_id, TaxInvoiceImportRecord.id)
        .all()
    )
    result = {row.id: {"lineItems": [], "lineItemCount": 0} for row in rows}
    # 先按发票收集全部明细，再统一去重，避免重复行抬高计数
    collected: dict[int, list[dict]] = {row.id: [] for row in rows}
    for record in records:
        row = row_by_id.get(record.invoice_id)
        if row is None or record.import_id != row.source_import_id:
            continue
        payload = record.payload if isinstance(record.payload, dict) else {}
        parsed = _parse_line_item(payload)
        if parsed is None:
            continue
        collected[record.invoice_id].append(parsed[0])
    for invoice_id, items in collected.items():
        unique = _dedupe_line_items(items)
        result[invoice_id]["lineItemCount"] = len(unique)
        result[invoice_id]["lineItems"] = unique[:max_items]
    return result


def set_processing_status(
    db: Session, invoice_id: int, processing_status: str, actor: str = "system"
) -> TaxInvoice:
    """旧状态按钮兼容接口：按状态映射写 v2 分类（required→goods、not_required→reimburse_operating、
    pending→空即待判断），再由分类派生 processing_status；原始发票和采购匹配关系保持不变。"""
    if processing_status not in {"pending", "required", "not_required"}:
        raise ValueError("无效的进项发票处理状态")
    invoice = db.get(TaxInvoice, invoice_id)
    if invoice is None:
        raise LookupError(f"tax_invoices #{invoice_id} 不存在")
    if invoice.direction != "input":
        raise ValueError("只有进项发票可以设置处理状态")
    status_to_category = {"required": "goods", "not_required": "reimburse_operating", "pending": ""}
    invoice.category = status_to_category[processing_status]
    invoice.processing_status = _derive_processing_status(invoice.category)
    audit(
        db,
        actor,
        "tax.invoice.set_processing_status",
        "tax_invoices",
        invoice.id,
        {"processingStatus": processing_status, "category": invoice.category},
        commit=False,
    )
    db.commit()
    return invoice


def set_invoice_categories(
    db: Session, invoice_ids: list[int], category: str, actor: str = "system"
) -> list[TaxInvoice]:
    """批量设置发票分类，幂等：进项 6+1（空=待判断未分类），销项 buyer_sales/platform_service/空（待判断）；
    分类 key 按发票方向校验，互混（进项传销项 key、销项传进项 key）直接拒绝。"""
    invoices = db.query(TaxInvoice).filter(TaxInvoice.id.in_(invoice_ids)).all()
    if not invoices:
        return []
    for invoice in invoices:
        validate_category_for_direction(invoice.direction, category)
    # 派生处理结论：进项按 6+1 组；销项 key 与空都落 pending（待判断）。
    derived = _derive_processing_status(category)
    for invoice in invoices:
        invoice.category = category
        invoice.processing_status = derived
        audit(
            db, actor, "tax.invoice.set_category", "tax_invoices", invoice.id,
            {"category": category}, commit=False,
        )
    db.commit()
    return invoices


# payment_method 是人工补充事实，不是银行付款事实：
# personal=进项发票个人垫付（或部分对公后的剩余部分个人垫付）；空=未人工标记。
# corporate / mixed 只能由银行付款事实动态派生，禁止人工直接写入。
MANUAL_PAYMENT_METHOD_VALUES = ("personal", "")
PAYMENT_METHOD_LABELS = {
    "corporate": "对公账户支出",
    "personal": "个人垫付",
    "mixed": "对公 + 个人垫付",
    "": "未设置",
}


def set_invoice_payment_methods(
    db: Session, invoice_ids: list[int], payment_method: str, actor: str = "system"
) -> list[TaxInvoice]:
    """人工维护有效正数进项发票的个人垫付标记。

    corporate 必须来自已确认银行付款证据；销项不适用。
    部分银行付款后可人工标 personal，表示剩余部分个人垫付，最终派生为 mixed。
    """
    if payment_method not in MANUAL_PAYMENT_METHOD_VALUES:
        raise ValueError("只能人工设置 personal（个人垫付）或清除；对公付款必须由已确认银行付款生成")
    invoices = db.query(TaxInvoice).filter(TaxInvoice.id.in_(invoice_ids)).all()
    if not invoices:
        return []
    for invoice in invoices:
        if invoice.direction != "input":
            if payment_method:
                raise ValueError(f"发票 #{invoice.id} 不是进项发票，不适用个人垫付")
            continue
        if payment_method == "personal":
            if not is_bank_payment_reconciliation_eligible(invoice):
                raise ValueError(bank_payment_reconciliation_ineligible_reason(invoice))
            bank = _invoice_bank_payment_context(db, [invoice]).get(invoice.id, {})
            if bank.get("bankPaymentStatus") == "matched":
                raise ValueError(f"发票 #{invoice.id} 已由银行付款全额核对，不能再标记个人垫付")
    for invoice in invoices:
        invoice.payment_method = payment_method if invoice.direction == "input" else ""
        audit(
            db, actor, "tax.invoice.set_payment_method", "tax_invoices", invoice.id,
            {"manual_payment_method": invoice.payment_method}, commit=False,
        )
    db.commit()
    return invoices


PURCHASE_LINK_TARGET_TYPES = ("alibaba1688_order", "external_purchase_order", "jackyun_purchase_order")
SALES_LINK_TARGET_TYPE = "sales_order"
ALLOWED_LINK_TARGET_TYPES = PURCHASE_LINK_TARGET_TYPES + (SALES_LINK_TARGET_TYPE,)
_PURCHASE_LINK_MODELS = {
    "alibaba1688_order": Alibaba1688Order,
    "external_purchase_order": ExternalPurchaseOrder,
    "jackyun_purchase_order": JackyunPurchaseOrder,
}


def _purchase_target_brief(target_type: str, row: Any) -> dict:
    """统一取采购类目标的单号/供应商/日期/金额（金额为原始 Numeric 或 None）。"""
    if target_type == "alibaba1688_order":
        return {
            "orderNo": row.external_order_id or "",
            "supplier": row.seller_company_name or "",
            "orderDate": row.order_time,
            "amount": row.actual_payment,
        }
    if target_type == "external_purchase_order":
        return {
            "orderNo": row.external_order_id or "",
            "supplier": row.supplier_name or "",
            "orderDate": row.ordered_at,
            "amount": row.order_amount if row.order_amount is not None else row.paid_amount,
        }
    return {
        "orderNo": row.purch_no or row.jackyun_purch_id,
        "supplier": row.supplier_name or "",
        "orderDate": _datetime(str((row.raw or {}).get("date") or "")),
        "amount": row.amount,
    }


def _load_purchase_targets(db: Session, target_type: str, target_ids: list[int]) -> dict:
    model = _PURCHASE_LINK_MODELS[target_type]
    if not target_ids:
        return {}
    return {row.id: row for row in db.query(model).filter(model.id.in_(target_ids)).all()}


def _purchase_link_occupancy(db: Session) -> dict[tuple[str, int], tuple[int, str]]:
    """业务单当前被哪张发票非 rejected 关联：{(target_type, target_id): (invoice_id, invoice_number)}。"""
    links = (
        db.query(TaxInvoiceLink)
        .filter(
            TaxInvoiceLink.target_type.in_(ALLOWED_LINK_TARGET_TYPES),
            TaxInvoiceLink.match_method != "rejected",
            TaxInvoiceLink.confirmed.is_(True),
        )
        .all()
    )
    invoice_ids = {link.invoice_id for link in links}
    invoice_map = (
        {row.id: row for row in db.query(TaxInvoice).filter(TaxInvoice.id.in_(invoice_ids)).all()}
        if invoice_ids else {}
    )
    return {
        (link.target_type, link.target_id): (link.invoice_id, invoice_map[link.invoice_id].invoice_number)
        for link in links if link.invoice_id in invoice_map
    }


_SALES_BUYER_RAW_KEYS = (
    "customerName", "customer_name", "customerAccount", "customer_account",
    "buyerNick", "buyer_nick", "buyerName", "buyer_name", "buyerAccount",
    "nickName", "shopBuyerAccount", "customerCode", "customer_code",
)


def _issue_month_bounds(invoice: TaxInvoice) -> tuple[datetime | None, datetime | None]:
    """发票开票日期所在月的 [月初, 下月初) 区间；无开票日期返回 (None, None)。"""
    moment = invoice.issue_date
    if moment is None:
        return None, None
    start = moment.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if start.month == 12:
        end = start.replace(year=start.year + 1, month=1)
    else:
        end = start.replace(month=start.month + 1)
    return start, end


def _sales_order_buyer(row: Any) -> str:
    """从 SalesOrder.raw 里尽力取买家/客户（不同采集通道字段名不一）。"""
    raw = row.raw if isinstance(row.raw, dict) else {}
    sources = [raw] + [value for value in raw.values() if isinstance(value, dict)]
    for source in sources:
        for key in _SALES_BUYER_RAW_KEYS:
            text = str(source.get(key) or "").strip()
            if text:
                return text
    return ""


def _sales_link_candidates(db: Session, invoice: TaxInvoice, keyword: str, limit: int) -> list[dict]:
    """销项发票人工关联销售订单的候选；keyword 匹配订单号/买家/客户。

    keyword 为空时优先返回发票开票当月的订单，缺月则回退最近订单。
    排序：订单号精确 > 买家匹配 > 金额接近 > 时间最近；buyer 为买家/客户。
    """
    needle = str(keyword or "").strip()
    lowered = needle.lower()
    invoice_amount = Decimal(str(invoice.total_amount)) if invoice.total_amount is not None else None
    occupancy = _purchase_link_occupancy(db)

    query = db.query(SalesOrder).filter(deal_orders_condition())
    if needle:
        rows = (
            query.filter(
                or_(
                    SalesOrder.order_no.ilike(f"%{lowered}%"),
                    cast(SalesOrder.raw, String).ilike(f"%{lowered}%"),
                )
            )
            .order_by(SalesOrder.ordered_at.desc().nullslast(), SalesOrder.id.desc())
            .limit(200)
            .all()
        )
    else:
        start, end = _issue_month_bounds(invoice)
        month_query = query
        if start is not None:
            month_query = query.filter(SalesOrder.ordered_at >= start, SalesOrder.ordered_at < end)
        rows = (
            month_query.order_by(SalesOrder.ordered_at.desc().nullslast(), SalesOrder.id.desc())
            .limit(50)
            .all()
        )
        if not rows and start is not None:
            rows = (
                query.order_by(SalesOrder.ordered_at.desc().nullslast(), SalesOrder.id.desc())
                .limit(50)
                .all()
            )

    candidates: list[dict] = []
    for row in rows:
        buyer = _sales_order_buyer(row)
        amount = row.order_amount if row.order_amount is not None else row.paid_amount
        amount = Decimal(str(amount)) if amount is not None else None
        diff = abs(amount - invoice_amount) if amount is not None and invoice_amount is not None else None
        linked_invoice_id, linked_invoice_no = occupancy.get((SALES_LINK_TARGET_TYPE, row.id), (None, None))
        ordered_at = row.ordered_at
        if needle and row.order_no == needle:
            rank = 0
        elif needle and buyer and lowered in buyer.lower():
            rank = 1
        else:
            rank = 2
        candidates.append({
            "targetType": SALES_LINK_TARGET_TYPE,
            "targetId": row.id,
            "orderNo": row.order_no,
            "supplier": "",
            "buyer": buyer,
            "orderDate": ordered_at.isoformat()[:10] if ordered_at else None,
            "amount": str(quantize(amount)) if amount is not None else None,
            "amountDiff": str(quantize(diff)) if diff is not None else None,
            "linkedInvoiceId": linked_invoice_id,
            "linkedInvoiceNo": linked_invoice_no,
            "_rank": rank,
            "_diff": diff,
            "_date": ordered_at,
            "_id": row.id,
        })
    candidates.sort(key=lambda item: (
        item["_rank"],
        item["_diff"] if item["_diff"] is not None else Decimal("999999999999"),
        -(item["_date"].timestamp() if item["_date"] else 0),
        -item["_id"],
    ))
    keys = ("targetType", "targetId", "orderNo", "supplier", "buyer", "orderDate", "amount", "amountDiff", "linkedInvoiceId", "linkedInvoiceNo")
    return [{key: item[key] for key in keys} for item in candidates[: min(max(limit, 1), 100)]]


def purchase_link_candidates(
    db: Session,
    invoice_id: int,
    keyword: str = "",
    limit: int = 20,
) -> list[dict]:
    """为一张发票搜人工关联候选。

    销项发票（direction=output）搜销售订单；采购类发票搜采购单
    （1688 文件订单 + 吉客云采购单）。linkedInvoice* 表示该单已被哪张
    发票非 rejected 占用（含本发票自身），用于前端展示占用与「仍要关联」。
    """
    invoice = db.get(TaxInvoice, invoice_id)
    if invoice is None:
        raise LookupError(f"tax_invoices #{invoice_id} 不存在")
    if invoice.direction == "output":
        return _sales_link_candidates(db, invoice, keyword, limit)

    needle = str(keyword or "").strip()
    lowered = needle.lower()
    invoice_amount = Decimal(str(invoice.total_amount)) if invoice.total_amount is not None else None
    seller = (invoice.seller_name or "").strip()
    occupancy = _purchase_link_occupancy(db)

    def _rank(order_no: str, supplier: str) -> int:
        if needle and order_no == needle:
            return 0
        if seller and supplier and (seller in supplier or supplier in seller):
            return 1
        return 2

    pools: list[tuple[str, list]] = []
    external_query = db.query(ExternalPurchaseOrder)
    if needle:
        external_query = external_query.filter(
            or_(
                ExternalPurchaseOrder.external_order_id.ilike(f"%{lowered}%"),
                ExternalPurchaseOrder.supplier_name.ilike(f"%{lowered}%"),
            )
        ).order_by(ExternalPurchaseOrder.id.desc()).limit(200)
    else:
        if seller:
            external_query = external_query.filter(ExternalPurchaseOrder.supplier_name.ilike(f"%{seller}%"))
        external_query = external_query.order_by(
            ExternalPurchaseOrder.ordered_at.desc().nullslast(), ExternalPurchaseOrder.id.desc()
        ).limit(50)
    pools.append(("external_purchase_order", external_query.all()))

    jackyun_query = db.query(JackyunPurchaseOrder)
    if needle:
        jackyun_query = jackyun_query.filter(
            or_(
                JackyunPurchaseOrder.purch_no.ilike(f"%{lowered}%"),
                JackyunPurchaseOrder.supplier_name.ilike(f"%{lowered}%"),
            )
        ).order_by(JackyunPurchaseOrder.id.desc()).limit(200)
    else:
        if seller:
            jackyun_query = jackyun_query.filter(JackyunPurchaseOrder.supplier_name.ilike(f"%{seller}%"))
        jackyun_query = jackyun_query.order_by(JackyunPurchaseOrder.id.desc()).limit(50)
    pools.append(("jackyun_purchase_order", jackyun_query.all()))

    candidates: list[dict] = []
    for target_type, rows in pools:
        for row in rows:
            brief = _purchase_target_brief(target_type, row)
            amount = Decimal(str(brief["amount"])) if brief["amount"] is not None else None
            diff = abs(amount - invoice_amount) if amount is not None and invoice_amount is not None else None
            linked_invoice_id, linked_invoice_no = occupancy.get((target_type, row.id), (None, None))
            order_date = brief["orderDate"]
            candidates.append({
                "targetType": target_type,
                "targetId": row.id,
                "orderNo": brief["orderNo"],
                "supplier": brief["supplier"],
                "orderDate": order_date.isoformat()[:10] if order_date else None,
                "amount": str(quantize(amount)) if amount is not None else None,
                "amountDiff": str(quantize(diff)) if diff is not None else None,
                "linkedInvoiceId": linked_invoice_id,
                "linkedInvoiceNo": linked_invoice_no,
                "_rank": _rank(brief["orderNo"], brief["supplier"]),
                "_diff": diff,
                "_date": order_date,
                "_id": row.id,
            })
    candidates.sort(key=lambda item: (
        item["_rank"],
        item["_diff"] if item["_diff"] is not None else Decimal("999999999999"),
        -(item["_date"].timestamp() if item["_date"] else 0),
        -item["_id"],
    ))
    keys = ("targetType", "targetId", "orderNo", "supplier", "orderDate", "amount", "amountDiff", "linkedInvoiceId", "linkedInvoiceNo")
    return [{key: item[key] for key in keys} for item in candidates[: min(max(limit, 1), 100)]]


def _sync_business_match_status(
    db: Session,
    invoice: TaxInvoice,
    target_type: str,
) -> str:
    """按采购/销售业务域的真实 confirmed 分摊重算缓存状态。"""
    domain_types = (
        PURCHASE_LINK_TARGET_TYPES
        if target_type in PURCHASE_LINK_TARGET_TYPES
        else (SALES_LINK_TARGET_TYPE,)
    )
    links = (
        db.query(TaxInvoiceLink)
        .filter(
            TaxInvoiceLink.invoice_id == invoice.id,
            TaxInvoiceLink.target_type.in_(domain_types),
            TaxInvoiceLink.match_method != "rejected",
            TaxInvoiceLink.confirmed.is_(True),
        )
        .all()
    )
    invoice_total = quantize(to_decimal(invoice.total_amount))
    has_unknown = any(link.allocated_amount is None for link in links)
    allocated = sum(
        (
            quantize(to_decimal(link.allocated_amount))
            for link in links
            if link.allocated_amount is not None
        ),
        Decimal("0"),
    )
    if invoice_total <= 0:
        status = "unmatched"
    elif has_unknown:
        status = "needs_review"
    elif allocated <= 0:
        status = "unmatched"
    elif invoice_total - allocated <= Decimal("0.01"):
        status = "matched"
    else:
        status = "partial"
    invoice.match_status = status
    return status


def link_purchase_order(
    db: Session,
    invoice_id: int,
    target_type: str,
    target_id: int,
    allocated_amount: Decimal | str | int | None = None,
    note: str = "",
    actor: str = "system",
) -> dict:
    """人工把发票挂到采购单/销售订单（manual+confirmed，软删行复活，同对幂等）。

    销售订单（target_type=sales_order）只允许销项发票；采购类目标不允许销项发票。
    """
    if target_type not in ALLOWED_LINK_TARGET_TYPES:
        raise ValueError("非法关联目标类型")
    invoice = db.get(TaxInvoice, invoice_id)
    if invoice is None:
        raise LookupError(f"tax_invoices #{invoice_id} 不存在")
    if target_type == SALES_LINK_TARGET_TYPE and invoice.direction != "output":
        raise ValueError("只有销项发票可以人工关联销售订单")
    if target_type in PURCHASE_LINK_TARGET_TYPES and invoice.direction == "output":
        raise ValueError("销项发票不能人工关联采购单，请关联销售订单")

    if target_type == SALES_LINK_TARGET_TYPE:
        target = db.get(SalesOrder, target_id)
        if target is None:
            raise LookupError(f"销售订单不存在：#{target_id}")
        if not is_deal_status(target.order_status):
            raise ValueError("已取消/关闭/退款等非成交销售订单不能关联销项发票")
        order_no = target.order_no
        default_note = "人工关联销售订单"
        audit_action = "tax_invoice.link_sales"
    else:
        target = _load_purchase_targets(db, target_type, [target_id]).get(target_id)
        if target is None:
            raise LookupError(f"采购单不存在：{target_type} #{target_id}")
        order_no = _purchase_target_brief(target_type, target)["orderNo"]
        default_note = "人工关联采购单"
        audit_action = "tax_invoice.link_purchase"

    # 锁定发票，避免并发手工关联同时通过剩余额度检查。
    db.refresh(invoice, with_for_update=True)
    link = (
        db.query(TaxInvoiceLink)
        .filter_by(invoice_id=invoice.id, target_type=target_type, target_id=target_id)
        .first()
    )

    domain_types = PURCHASE_LINK_TARGET_TYPES if target_type in PURCHASE_LINK_TARGET_TYPES else (SALES_LINK_TARGET_TYPE,)
    invoice_total = quantize(to_decimal(invoice.total_amount))
    if invoice_total <= 0:
        raise ValueError("发票价税合计必须大于 0")

    other_invoice_alloc = sum(
        (
            quantize(to_decimal(row.allocated_amount))
            for row in db.query(TaxInvoiceLink).filter(
                TaxInvoiceLink.invoice_id == invoice.id,
                TaxInvoiceLink.target_type.in_(domain_types),
                TaxInvoiceLink.match_method != "rejected",
                TaxInvoiceLink.confirmed.is_(True),
                TaxInvoiceLink.id != (link.id if link is not None else -1),
            ).all()
        ),
        Decimal("0"),
    )

    if target_type == SALES_LINK_TARGET_TYPE:
        target_limit_raw = target.paid_amount if target.paid_amount is not None else target.order_amount
    else:
        target_limit_raw = _purchase_target_brief(target_type, target)["amount"]
    target_limit = quantize(to_decimal(target_limit_raw)) if target_limit_raw is not None else None
    other_target_alloc = sum(
        (
            quantize(to_decimal(row.allocated_amount))
            for row in db.query(TaxInvoiceLink).filter(
                TaxInvoiceLink.target_type == target_type,
                TaxInvoiceLink.target_id == target_id,
                TaxInvoiceLink.match_method != "rejected",
                TaxInvoiceLink.confirmed.is_(True),
                TaxInvoiceLink.id != (link.id if link is not None else -1),
            ).all()
        ),
        Decimal("0"),
    )

    if allocated_amount is None:
        invoice_remaining = invoice_total - other_invoice_alloc
        target_remaining = (
            target_limit - other_target_alloc
            if target_limit is not None and target_limit > 0
            else invoice_remaining
        )
        amount = min(invoice_remaining, target_remaining)
    else:
        amount = quantize(to_decimal(allocated_amount))

    if not amount.is_finite() or amount <= 0:
        raise ValueError("分摊金额必须大于 0")
    if other_invoice_alloc + amount > invoice_total:
        raise ValueError(
            f"发票累计分摊 {other_invoice_alloc + amount} 超过票面金额 {invoice_total}"
        )
    if target_limit is not None and target_limit > 0 and other_target_alloc + amount > target_limit:
        raise ValueError(
            f"该业务单累计发票分摊 {other_target_alloc + amount} 超过订单金额 {target_limit}"
        )

    if link is None:
        link = TaxInvoiceLink(invoice_id=invoice.id, target_type=target_type, target_id=target_id)
        db.add(link)
    link.allocated_amount = amount
    link.match_method = "manual"
    link.confidence = Decimal("1")
    link.confirmed = True
    link.note = note or default_note

    db.flush()
    # 发票业务匹配缓存统一从业务域 confirmed 链接重算，避免 link/unlink 各写一套规则。
    _sync_business_match_status(db, invoice, target_type)
    msg = f"{default_note} {order_no}"
    invoice.match_note = f"{invoice.match_note}；{msg}" if invoice.match_note else msg

    db.commit()
    audit(
        db, actor, audit_action, "tax_invoice_links", str(link.id),
        {"invoiceId": invoice.id, "targetType": target_type, "targetId": target_id, "allocatedAmount": str(amount)},
    )
    return {"ok": True, "id": link.id, "orderNo": order_no}


def unlink_purchase(db: Session, link_id: int, actor: str = "system") -> dict:
    """解除人工采购/销售关联（软删 rejected 保审计；同对可再次关联=复活）。"""
    row = db.get(TaxInvoiceLink, link_id)
    if row is None or row.target_type not in ALLOWED_LINK_TARGET_TYPES or row.match_method == "rejected":
        raise LookupError("关联不存在或已解除")
    is_sales = row.target_type == SALES_LINK_TARGET_TYPE
    row.match_method = "rejected"
    row.confirmed = False
    row.confidence = None
    row.note = "解除销售订单关联" if is_sales else "解除采购单关联"
    # 先把解除状态写入数据库，再按 active confirmed 链接重算；避免查询读到旧行。
    db.flush()

    invoice = db.get(TaxInvoice, row.invoice_id)
    if invoice is not None:
        _sync_business_match_status(db, invoice, row.target_type)
        msg = "已解除人工销售订单关联" if is_sales else "已解除人工采购关联"
        invoice.match_note = f"{invoice.match_note}；{msg}" if invoice.match_note else msg

    db.commit()
    audit(
        db, actor, "tax_invoice.unlink_purchase", "tax_invoice_links", str(row.id),
        {"invoiceId": row.invoice_id, "targetType": row.target_type, "targetId": row.target_id},
    )
    return {"ok": True}
