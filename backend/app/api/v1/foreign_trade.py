"""外贸工作台 API。"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.foreign_trade import (
    ForeignTradeChannel,
    ForeignTradeDealer,
    ForeignTradeOrder,
    ForeignTradeSkuMapping,
)
from app.services import foreign_trade_service as service

router = APIRouter(prefix="/foreign-trade", tags=["外贸工作台"])


def _money(value: str | int | float | Decimal | None) -> Decimal:
    try:
        return Decimal(str(value or "0"))
    except Exception as exc:
        raise HTTPException(status_code=400, detail="金额格式不正确") from exc


@router.get("/overview")
def overview(db: Session = Depends(get_db)) -> dict:
    return service.overview(db)


class ChannelBody(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=128)
    channel_type: str = Field(default="manual", max_length=32)
    brand: str = Field(default="", max_length=128)
    currency: str = Field(default="EUR", max_length=8)
    countries: list[str] = []
    enabled: bool = True
    connected: bool = False
    note: str = ""


@router.get("/channels")
def channels(db: Session = Depends(get_db)) -> dict:
    rows = db.scalars(select(ForeignTradeChannel).order_by(ForeignTradeChannel.id.desc())).all()
    return {"items": [service.channel_dict(row) for row in rows]}


@router.post("/channels", status_code=201)
def create_channel(body: ChannelBody, db: Session = Depends(get_db)) -> dict:
    row = ForeignTradeChannel(**body.model_dump())
    db.add(row)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="渠道编码已存在") from exc
    db.refresh(row)
    return service.channel_dict(row)


@router.put("/channels/{channel_id}")
def update_channel(channel_id: int, body: ChannelBody, db: Session = Depends(get_db)) -> dict:
    row = db.get(ForeignTradeChannel, channel_id)
    if not row:
        raise HTTPException(status_code=404, detail="渠道不存在")
    for key, value in body.model_dump().items():
        setattr(row, key, value)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="渠道编码已存在") from exc
    db.refresh(row)
    return service.channel_dict(row)


@router.delete("/channels/{channel_id}")
def delete_channel(channel_id: int, db: Session = Depends(get_db)) -> dict:
    row = db.get(ForeignTradeChannel, channel_id)
    if not row:
        raise HTTPException(status_code=404, detail="渠道不存在")
    db.delete(row)
    db.commit()
    return {"ok": True}


class SkuBody(BaseModel):
    channel_code: str = Field(min_length=1, max_length=64)
    external_sku: str = Field(min_length=1, max_length=128)
    internal_sku: str = Field(default="", max_length=128)
    product_name: str = Field(default="", max_length=512)
    status: str = Field(default="pending", max_length=16)
    note: str = ""


@router.get("/sku-mappings")
def sku_mappings(q: str = Query("", max_length=200), db: Session = Depends(get_db)) -> dict:
    stmt = select(ForeignTradeSkuMapping).order_by(ForeignTradeSkuMapping.id.desc())
    if q.strip():
        needle = f"%{q.strip()}%"
        stmt = stmt.where(
            (ForeignTradeSkuMapping.external_sku.ilike(needle))
            | (ForeignTradeSkuMapping.internal_sku.ilike(needle))
            | (ForeignTradeSkuMapping.product_name.ilike(needle))
        )
    return {"items": [service.sku_dict(row) for row in db.scalars(stmt).all()]}


@router.post("/sku-mappings", status_code=201)
def create_sku_mapping(body: SkuBody, db: Session = Depends(get_db)) -> dict:
    row = ForeignTradeSkuMapping(**body.model_dump())
    db.add(row)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="该渠道的海外 SKU 已存在") from exc
    db.refresh(row)
    return service.sku_dict(row)


@router.put("/sku-mappings/{mapping_id}")
def update_sku_mapping(mapping_id: int, body: SkuBody, db: Session = Depends(get_db)) -> dict:
    row = db.get(ForeignTradeSkuMapping, mapping_id)
    if not row:
        raise HTTPException(status_code=404, detail="SKU 映射不存在")
    for key, value in body.model_dump().items():
        setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return service.sku_dict(row)


@router.delete("/sku-mappings/{mapping_id}")
def delete_sku_mapping(mapping_id: int, db: Session = Depends(get_db)) -> dict:
    row = db.get(ForeignTradeSkuMapping, mapping_id)
    if not row:
        raise HTTPException(status_code=404, detail="SKU 映射不存在")
    db.delete(row)
    db.commit()
    return {"ok": True}


class OrderBody(BaseModel):
    channel_code: str = Field(min_length=1, max_length=64)
    external_order_no: str = Field(min_length=1, max_length=128)
    business_mode: Literal["b2c", "b2b"] = "b2c"
    dealer_id: int | None = None
    brand: str = Field(default="", max_length=128)
    country: str = Field(default="", max_length=64)
    currency: str = Field(default="EUR", max_length=8)
    gross_amount: str = "0"
    discount_amount: str = "0"
    shipping_income: str = "0"
    paid_amount: str = "0"
    refund_amount: str = "0"
    payment_fee: str = "0"
    purchase_cost: str = "0"
    logistics_cost: str = "0"
    exchange_rate_to_cny: str = "1"
    status: str = Field(default="pending", max_length=24)
    procurement_status: str = Field(default="pending", max_length=24)
    fulfillment_status: str = Field(default="pending", max_length=24)
    payment_status: str = Field(default="unpaid", max_length=24)
    customer_name: str = Field(default="", max_length=128)
    customer_email: str = Field(default="", max_length=256)
    ship_to: str = ""
    carrier: str = Field(default="", max_length=128)
    tracking_no: str = Field(default="", max_length=128)
    ordered_at: datetime | None = None
    paid_at: datetime | None = None
    shipped_at: datetime | None = None
    items: list[dict] = []
    note: str = ""


def _apply_order(db: Session, row: ForeignTradeOrder, body: OrderBody) -> ForeignTradeDealer | None:
    values = body.model_dump()
    dealer: ForeignTradeDealer | None = None
    if body.business_mode == "b2b":
        if body.dealer_id is None:
            raise HTTPException(status_code=400, detail="B2B 订单必须绑定经销商")
        dealer = db.get(ForeignTradeDealer, body.dealer_id)
        if dealer is None:
            raise HTTPException(status_code=404, detail="经销商不存在")
        if dealer.status != "active":
            raise HTTPException(status_code=400, detail="B2B 订单只能绑定启用中的经销商")
    else:
        values["dealer_id"] = None

    for key in (
        "gross_amount", "discount_amount", "shipping_income", "paid_amount", "refund_amount",
        "payment_fee", "purchase_cost", "logistics_cost", "exchange_rate_to_cny",
    ):
        values[key] = _money(values[key])
    for key, value in values.items():
        setattr(row, key, value)
    return dealer


@router.get("/orders")
def orders(
    q: str = Query("", max_length=200),
    status: str = Query("", max_length=24),
    channel_code: str = Query("", max_length=64),
    brand: str = Query("", max_length=128),
    business_mode: Literal["", "b2c", "b2b"] = Query(""),
    db: Session = Depends(get_db),
) -> dict:
    return {
        "items": service.list_orders(
            db,
            q=q,
            status=status,
            channel_code=channel_code,
            brand=brand,
            business_mode=business_mode,
        )
    }


@router.post("/orders", status_code=201)
def create_order(body: OrderBody, db: Session = Depends(get_db)) -> dict:
    row = ForeignTradeOrder(channel_code=body.channel_code, external_order_no=body.external_order_no)
    dealer = _apply_order(db, row, body)
    db.add(row)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="该渠道订单号已存在") from exc
    db.refresh(row)
    return service.order_dict(row, dealer)


@router.put("/orders/{order_id}")
def update_order(order_id: int, body: OrderBody, db: Session = Depends(get_db)) -> dict:
    row = db.get(ForeignTradeOrder, order_id)
    if not row:
        raise HTTPException(status_code=404, detail="外贸订单不存在")
    dealer = _apply_order(db, row, body)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="该渠道订单号已存在") from exc
    db.refresh(row)
    return service.order_dict(row, dealer)


@router.delete("/orders/{order_id}")
def delete_order(order_id: int, db: Session = Depends(get_db)) -> dict:
    row = db.get(ForeignTradeOrder, order_id)
    if not row:
        raise HTTPException(status_code=404, detail="外贸订单不存在")
    db.delete(row)
    db.commit()
    return {"ok": True}



class DealerBody(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    company_name: str = Field(min_length=1, max_length=256)
    country: str = Field(default="", max_length=64)
    region: str = Field(default="", max_length=128)
    contact_name: str = Field(default="", max_length=128)
    email: str = Field(default="", max_length=256)
    phone: str = Field(default="", max_length=64)
    dealer_level: str = Field(default="standard", max_length=32)
    status: str = Field(default="active", max_length=24)
    currency: str = Field(default="EUR", max_length=8)
    shopify_company_id: str = Field(default="", max_length=128)
    shopify_company_location_id: str = Field(default="", max_length=128)
    address: str = ""
    note: str = ""


@router.get("/b2b/dealers")
def dealers(q: str = Query("", max_length=200), db: Session = Depends(get_db)) -> dict:
    return {"items": service.list_dealers(db, q=q)}


@router.post("/b2b/dealers", status_code=201)
def create_dealer(body: DealerBody, db: Session = Depends(get_db)) -> dict:
    row = ForeignTradeDealer(**body.model_dump())
    db.add(row)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="经销商编码已存在") from exc
    db.refresh(row)
    return service.dealer_dict(row)


@router.put("/b2b/dealers/{dealer_id}")
def update_dealer(dealer_id: int, body: DealerBody, db: Session = Depends(get_db)) -> dict:
    row = db.get(ForeignTradeDealer, dealer_id)
    if row is None:
        raise HTTPException(status_code=404, detail="经销商不存在")
    for key, value in body.model_dump().items():
        setattr(row, key, value)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="经销商编码已存在") from exc
    db.refresh(row)
    return service.dealer_dict(row)


@router.get("/b2b/dealers/{dealer_id}/inventory")
def dealer_inventory(
    dealer_id: int,
    sku_code: str = Query("", max_length=128),
    db: Session = Depends(get_db),
) -> dict:
    try:
        return service.dealer_inventory(db, dealer_id, sku_code=sku_code)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc).strip("'")) from exc


@router.get("/b2b/dealers/{dealer_id}/reservations")
def dealer_reservations(dealer_id: int, db: Session = Depends(get_db)) -> dict:
    if db.get(ForeignTradeDealer, dealer_id) is None:
        raise HTTPException(status_code=404, detail="经销商不存在")
    return {"items": service.list_reservations(db, dealer_id=dealer_id)}


class ReservationBody(BaseModel):
    dealer_id: int
    sku_code: str = Field(min_length=1, max_length=128)
    quantity: str
    expires_at: datetime | None = None
    reservation_kind: str = Field(default="quote", max_length=24)
    reference_no: str = Field(default="", max_length=128)
    source: str = Field(default="manual", max_length=32)
    shopify_draft_order_id: str = Field(default="", max_length=128)
    note: str = ""


@router.post("/b2b/reservations", status_code=201)
def create_reservation(body: ReservationBody, db: Session = Depends(get_db)) -> dict:
    try:
        quantity = Decimal(body.quantity)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="预留数量格式不正确") from exc
    try:
        row = service.create_reservation(
            db,
            dealer_id=body.dealer_id,
            sku_code=body.sku_code,
            quantity=quantity,
            expires_at=body.expires_at,
            reservation_kind=body.reservation_kind,
            reference_no=body.reference_no,
            source=body.source,
            shopify_draft_order_id=body.shopify_draft_order_id,
            note=body.note,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc).strip("'")) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return service.list_reservations(db, dealer_id=row.dealer_id)[0]


@router.post("/b2b/reservations/{reservation_id}/release")
def release_reservation(reservation_id: int, db: Session = Depends(get_db)) -> dict:
    try:
        row = service.release_reservation(db, reservation_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc).strip("'")) from exc
    return {"ok": True, "id": row.id, "status": row.status}


class ExtendReservationBody(BaseModel):
    expires_at: datetime


@router.post("/b2b/reservations/{reservation_id}/extend")
def extend_reservation(
    reservation_id: int,
    body: ExtendReservationBody,
    db: Session = Depends(get_db),
) -> dict:
    try:
        row = service.extend_reservation(db, reservation_id, body.expires_at)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc).strip("'")) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "id": row.id, "expiresAt": row.expires_at.isoformat() if row.expires_at else None}
