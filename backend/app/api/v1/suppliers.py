from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.api.deps import current_actor
from app.core.audit import audit
from app.db import get_db
from app.models.purchase import Supplier
from app.services.procurement_chain_service import supplier_summaries
from app.services.supplier_sync_service import normalize_supplier_name, sync_suppliers_from_business_data

router = APIRouter(prefix="/suppliers", tags=["suppliers"])


class SupplierInput(BaseModel):
    """前端统一传 camelCase（taxNo/isTemp 等），同时兼容 snake_case。"""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    name: str = Field(min_length=1, max_length=256)
    platform: str = Field(default="", max_length=32)
    external_shop_id: str = Field(default="", max_length=128)
    contact: str = Field(default="", max_length=256)
    tax_no: str = Field(default="", max_length=64)
    phone: str = Field(default="", max_length=64)
    address: str = Field(default="", max_length=512)
    notes: str = Field(default="", max_length=512)
    is_temp: bool = False


def _serialize(row: Supplier, order_count: int | None = None) -> dict[str, Any]:
    data: dict[str, Any] = {
        "id": row.id,
        "name": row.name,
        "platform": row.platform or "",
        "externalShopId": row.external_shop_id or "",
        "contact": row.contact or "",
        "taxNo": row.tax_no or "",
        "phone": row.phone or "",
        "address": row.address or "",
        "notes": row.notes or "",
        "isTemp": bool(row.is_temp),
        "purchaseType": "regular" if (order_count or 0) >= 2 else "temporary",
        "createdAt": row.created_at.isoformat() if row.created_at else None,
    }
    if order_count is not None:
        data["orderCount"] = order_count
    return data


def _ensure_tax_no_unique(db: Session, tax_no: str, exclude_id: int | None = None) -> None:
    if not tax_no:
        return
    q = db.query(Supplier).filter(Supplier.tax_no == tax_no)
    if exclude_id is not None:
        q = q.filter(Supplier.id != exclude_id)
    row = q.first()
    if row:
        raise HTTPException(409, f"税号 {tax_no} 已被供应商「{row.name}」使用")


@router.get("")
def list_suppliers(
    keyword: str = "",
    status: str = Query("all", pattern="^(all|regular|temporary|normal|temp)$"),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    sync = sync_suppliers_from_business_data(db)
    if sync["created"] or sync["updated"]:
        db.commit()
        audit(
            db,
            "system",
            "supplier.auto_sync",
            "suppliers",
            "",
            sync,
        )
    # 供应商档案的展示范围必须和采购工作台使用同一套“逻辑采购单”事实。
    # 这样 1688 原始单 + 工作流副本不会重复计数，也不会让只有报销/结算/入库
    # 记录、却没有真实采购订单的对象进入本页面。
    purchase_counts: dict[str, int] = {}
    summary = supplier_summaries(db, limit=100_000, offset=0)
    for item in summary["items"]:
        name = normalize_supplier_name(item.get("supplierName"))
        count = int(item.get("orderCount") or 0)
        if not name or count <= 0:
            continue
        purchase_counts[name] = purchase_counts.get(name, 0) + count

    if not purchase_counts:
        return []

    q = db.query(Supplier).filter(Supplier.name.in_(list(purchase_counts)))
    keyword = keyword.strip()
    if keyword:
        like = f"%{keyword}%"
        q = q.filter(
            or_(
                Supplier.name.ilike(like),
                Supplier.tax_no.ilike(like),
                Supplier.contact.ilike(like),
                Supplier.phone.ilike(like),
            )
        )

    rows = q.order_by(Supplier.name.asc(), Supplier.id.asc()).all()
    if status in {"regular", "normal"}:
        rows = [row for row in rows if purchase_counts.get(row.name, 0) >= 2]
    elif status in {"temporary", "temp"}:
        rows = [row for row in rows if purchase_counts.get(row.name, 0) == 1]

    return [_serialize(row, purchase_counts.get(row.name, 0)) for row in rows]


@router.post("")
def create_supplier(
    payload: SupplierInput, request: Request, db: Session = Depends(get_db)
) -> dict[str, Any]:
    _ensure_tax_no_unique(db, payload.tax_no.strip())
    row = Supplier(
        name=payload.name.strip(),
        platform=payload.platform.strip(),
        external_shop_id=payload.external_shop_id.strip(),
        contact=payload.contact.strip(),
        tax_no=payload.tax_no.strip(),
        phone=payload.phone.strip(),
        address=payload.address.strip(),
        notes=payload.notes.strip(),
        is_temp=payload.is_temp,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    audit(db, current_actor(request), "supplier.created", "supplier", str(row.id), {"name": row.name})
    return _serialize(row, 0)


@router.put("/{supplier_id}")
def update_supplier(
    supplier_id: int,
    payload: SupplierInput,
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    row = db.get(Supplier, supplier_id)
    if not row:
        raise HTTPException(404, "供应商不存在")
    _ensure_tax_no_unique(db, payload.tax_no.strip(), exclude_id=supplier_id)
    row.name = payload.name.strip()
    row.platform = payload.platform.strip()
    row.external_shop_id = payload.external_shop_id.strip()
    row.contact = payload.contact.strip()
    row.tax_no = payload.tax_no.strip()
    row.phone = payload.phone.strip()
    row.address = payload.address.strip()
    row.notes = payload.notes.strip()
    row.is_temp = payload.is_temp
    db.commit()
    db.refresh(row)
    audit(db, current_actor(request), "supplier.updated", "supplier", str(row.id), {"name": row.name})
    return _serialize(row)


@router.delete("/{supplier_id}")
def delete_supplier(
    supplier_id: int, request: Request, db: Session = Depends(get_db)
) -> dict[str, Any]:
    row = db.get(Supplier, supplier_id)
    if not row:
        raise HTTPException(404, "供应商不存在")
    audit(db, current_actor(request), "supplier.deleted", "supplier", str(row.id), {"name": row.name})
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.post("/resolve")
def resolve_suppliers(payload: dict[str, list[str]], db: Session = Depends(get_db)) -> dict[str, Any]:
    """按税号识别供应商：供采购/结算等导入流程自动匹配。"""
    tax_nos = [t.strip() for t in (payload.get("taxNos") or []) if t and t.strip()]
    if not tax_nos:
        return {"matched": {}, "unmatched": []}
    rows = db.query(Supplier).filter(Supplier.tax_no.in_(list(set(tax_nos)))).all()
    matched = {row.tax_no: {"id": row.id, "name": row.name, "isTemp": bool(row.is_temp)} for row in rows}
    unmatched = [t for t in tax_nos if t not in matched]
    return {"matched": matched, "unmatched": unmatched}
