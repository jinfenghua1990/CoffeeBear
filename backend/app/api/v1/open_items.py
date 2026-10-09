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
from app.services import open_item_service

router = APIRouter(prefix="/finance/open-items", tags=["finance-open-items"])


class OpenItemInput(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    partner_id: int
    item_type: str = Field(pattern="^(receivable|payable)$")
    original_amount: Decimal = Field(gt=0)
    source_type: str = Field(default="manual", max_length=64)
    source_id: str = Field(default="", max_length=128)
    source_no: str = Field(default="", max_length=128)
    description: str = Field(default="", max_length=2000)
    currency: str = Field(default="CNY", max_length=8)
    occurred_on: date | None = None
    due_on: date | None = None


class AllocationInput(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    bank_transaction_id: int
    amount: Decimal = Field(gt=0)
    note: str = Field(default="", max_length=1000)


def _bad_request(exc: open_item_service.OpenItemError) -> HTTPException:
    message = str(exc)
    status = 404 if "不存在" in message else 409 if "已存在" in message else 400
    return HTTPException(status, message)


@router.get("")
def list_open_items(
    partner_id: int | None = Query(default=None, ge=1),
    item_type: str = Query("all", pattern="^(all|receivable|payable)$"),
    status: str = Query("open", pattern="^(all|open|partial|closed|cancelled)$"),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    return {
        "items": open_item_service.list_open_items(
            db,
            partner_id=partner_id,
            item_type=item_type,
            status=status,
            limit=limit,
            offset=offset,
        ),
        "summary": open_item_service.summary(db, partner_id=partner_id),
    }


@router.get("/summary")
def open_items_summary(
    partner_id: int | None = Query(default=None, ge=1),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    return open_item_service.summary(db, partner_id=partner_id)


@router.get("/{item_id}")
def get_open_item(item_id: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    try:
        item = open_item_service.get_open_item(db, item_id)
    except open_item_service.OpenItemError as exc:
        raise _bad_request(exc) from exc
    return open_item_service.serialize_item(db, item)


@router.post("")
def create_open_item(
    payload: OpenItemInput,
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        item, created = open_item_service.create_open_item(
            db,
            partner_id=payload.partner_id,
            item_type=payload.item_type,
            original_amount=payload.original_amount,
            source_type=payload.source_type,
            source_id=payload.source_id,
            source_no=payload.source_no,
            description=payload.description,
            currency=payload.currency,
            occurred_on=payload.occurred_on,
            due_on=payload.due_on,
        )
    except open_item_service.OpenItemError as exc:
        raise _bad_request(exc) from exc
    db.commit()
    db.refresh(item)
    audit(
        db,
        current_actor(request),
        "finance.open_item.created" if created else "finance.open_item.idempotent",
        "finance_open_item",
        str(item.id),
        {"sourceType": item.source_type, "sourceId": item.source_id, "created": created},
    )
    return {"created": created, "item": open_item_service.serialize_item(db, item)}


@router.post("/{item_id}/allocations")
def allocate_open_item(
    item_id: int,
    payload: AllocationInput,
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        allocation = open_item_service.allocate_bank_transaction(
            db,
            item_id=item_id,
            bank_transaction_id=payload.bank_transaction_id,
            amount=payload.amount,
            note=payload.note,
        )
    except open_item_service.OpenItemError as exc:
        raise _bad_request(exc) from exc
    db.commit()
    item = open_item_service.get_open_item(db, item_id)
    audit(
        db,
        current_actor(request),
        "finance.open_item.allocated",
        "finance_open_item",
        str(item.id),
        {
            "allocationId": allocation.id,
            "bankTransactionId": allocation.bank_transaction_id,
            "amount": str(allocation.amount),
        },
    )
    return open_item_service.serialize_item(db, item)


@router.post("/allocations/{allocation_id}/void")
def void_open_item_allocation(
    allocation_id: int,
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        allocation = open_item_service.void_allocation(db, allocation_id=allocation_id)
    except open_item_service.OpenItemError as exc:
        raise _bad_request(exc) from exc
    db.commit()
    item = open_item_service.get_open_item(db, allocation.open_item_id)
    audit(
        db,
        current_actor(request),
        "finance.open_item.allocation_voided",
        "finance_open_item",
        str(item.id),
        {"allocationId": allocation.id},
    )
    return open_item_service.serialize_item(db, item)


@router.post("/{item_id}/cancel")
def cancel_open_item(
    item_id: int,
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        item = open_item_service.cancel_open_item(db, item_id=item_id)
    except open_item_service.OpenItemError as exc:
        raise _bad_request(exc) from exc
    db.commit()
    audit(
        db,
        current_actor(request),
        "finance.open_item.cancelled",
        "finance_open_item",
        str(item.id),
        {},
    )
    return open_item_service.serialize_item(db, item)
