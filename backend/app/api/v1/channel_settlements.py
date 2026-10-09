from datetime import date
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel
from sqlalchemy.orm import Session

from app.api.deps import current_actor
from app.core.audit import audit
from app.db import get_db
from app.services import channel_settlement_service

router = APIRouter(prefix="/finance/channel-settlements", tags=["finance-channel-settlements"])


class ChannelSettlementInput(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    channel: str = Field(min_length=1, max_length=64)
    external_key: str = Field(min_length=1, max_length=128)
    settle_date: date
    gross_amount: Decimal = Field(ge=0)
    net_amount: Decimal = Field(ge=0)
    shop_name: str = Field(default="", max_length=128)
    order_no: str = Field(default="", max_length=128)
    refund_amount: Decimal = Field(default=Decimal("0"), ge=0)
    platform_fee: Decimal = Field(default=Decimal("0"), ge=0)
    rebate_amount: Decimal = Field(default=Decimal("0"), ge=0)
    other_fee: Decimal = Field(default=Decimal("0"), ge=0)
    partner_id: int | None = Field(default=None, ge=1)
    legal_entity_id: int | None = Field(default=None, ge=1)
    currency: str = Field(default="CNY", max_length=8)
    raw: dict[str, Any] = Field(default_factory=dict)
    note: str = Field(default="", max_length=2000)


def _http_error(exc: channel_settlement_service.ChannelSettlementError) -> HTTPException:
    message = str(exc)
    return HTTPException(404 if "不存在" in message else 422, message)


@router.get("")
def list_channel_settlements(
    channel: str = "",
    status: str = Query("all", pattern="^(all|draft|materialized)$"),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    return {
        "items": channel_settlement_service.list_settlements(
            db,
            channel=channel,
            status=status,
            limit=limit,
            offset=offset,
        ),
        "summary": channel_settlement_service.summary(db),
    }


@router.get("/{settlement_id}")
def get_channel_settlement(
    settlement_id: int,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        row = channel_settlement_service.get_settlement(db, settlement_id)
    except channel_settlement_service.ChannelSettlementError as exc:
        raise _http_error(exc) from exc
    return channel_settlement_service.serialize(row)


@router.post("")
def create_channel_settlement(
    payload: ChannelSettlementInput,
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        row, created = channel_settlement_service.create_settlement(
            db,
            channel=payload.channel,
            external_key=payload.external_key,
            settle_date=payload.settle_date,
            gross_amount=payload.gross_amount,
            net_amount=payload.net_amount,
            shop_name=payload.shop_name,
            order_no=payload.order_no,
            refund_amount=payload.refund_amount,
            platform_fee=payload.platform_fee,
            rebate_amount=payload.rebate_amount,
            other_fee=payload.other_fee,
            partner_id=payload.partner_id,
            legal_entity_id=payload.legal_entity_id,
            currency=payload.currency,
            raw=payload.raw,
            note=payload.note,
        )
    except channel_settlement_service.ChannelSettlementError as exc:
        db.rollback()
        raise _http_error(exc) from exc
    db.commit()
    db.refresh(row)
    audit(
        db,
        current_actor(request),
        "finance.channel_settlement.created"
        if created
        else "finance.channel_settlement.idempotent",
        "finance_channel_settlement",
        str(row.id),
        {
            "channel": row.channel,
            "externalKey": row.external_key,
            "created": created,
        },
    )
    return {
        "created": created,
        "item": channel_settlement_service.serialize(row),
    }


@router.post("/{settlement_id}/materialize")
def materialize_channel_settlement(
    settlement_id: int,
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        result = channel_settlement_service.materialize_settlement(db, settlement_id)
    except channel_settlement_service.ChannelSettlementError as exc:
        db.rollback()
        raise _http_error(exc) from exc
    db.commit()
    audit(
        db,
        current_actor(request),
        "finance.channel_settlement.materialized",
        "finance_channel_settlement",
        str(settlement_id),
        {
            "entryCount": result["entryCount"],
            "openItemId": result["openItemId"],
        },
    )
    return result
