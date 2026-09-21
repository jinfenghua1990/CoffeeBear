"""财务中心的统一往来单位档案 API。"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel
from sqlalchemy.orm import Session

from app.api.deps import current_actor
from app.core.audit import audit
from app.db import get_db
from app.services import business_partner_service as partner_service
from app.services import payment_invoice_match_service as payment_match_service


router = APIRouter(prefix="/finance/partners", tags=["finance-partners"])


class PartnerInput(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    name: str = Field(min_length=1, max_length=256)
    roles: list[str] = Field(default_factory=lambda: ["counterparty"])
    tax_no: str = Field(default="", max_length=64)
    contact: str = Field(default="", max_length=256)
    phone: str = Field(default="", max_length=64)
    address: str = Field(default="", max_length=512)
    bank_name: str = Field(default="", max_length=128)
    bank_account_no: str = Field(default="", max_length=128)
    bank_account_name: str = Field(default="", max_length=256)
    notes: str = Field(default="", max_length=2000)


class IdentifierInput(BaseModel):
    kind: str = Field(default="alias", max_length=32)
    value: str = Field(min_length=1, max_length=512)


class ReviewClaimInput(BaseModel):
    note: str = Field(default="", max_length=1000)


class DuplicateDecisionInput(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    same: bool
    note: str = Field(default="", max_length=1000)


def _sync_and_commit(db: Session) -> dict[str, int]:
    result = partner_service.sync_business_partners(db)
    db.commit()
    return result


@router.get("")
def list_partners(
    keyword: str = "",
    role: str = Query("all", pattern="^(all|supplier|customer|counterparty)$"),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    # 页面首次进入即可把历史采购、发票、银行流水回填进统一档案；同步完全幂等。
    _sync_and_commit(db)
    return partner_service.list_partners(
        db, keyword=keyword, role=role, limit=limit, offset=offset
    )


@router.post("/sync")
def sync_partners(request: Request, db: Session = Depends(get_db)) -> dict[str, Any]:
    actor = current_actor(request)

    # 第一阶段先把采购、发票、银行流水归入统一往来单位。
    first = _sync_and_commit(db)

    # 第二阶段才做“银行付款 ↔ 进项发票”核对。以前这个按钮只做第一阶段，
    # 导致同一档案里明明同时存在发票和银行流水，银行已关联仍长期为 0。
    payment = payment_match_service.auto_match_all_periods(db, actor=actor)

    # 新生成的发票付款链接本身也是强关联证据；再同步一次，让代付/户名不同等场景
    # 能立即回到正确往来单位，而不是等下次打开页面。
    second = partner_service.sync_business_partners(db)
    db.commit()

    result = {
        "createdPartners": int(first.get("createdPartners", 0)) + int(second.get("createdPartners", 0)),
        "updatedPartners": int(first.get("updatedPartners", 0)) + int(second.get("updatedPartners", 0)),
        "createdLinks": int(first.get("createdLinks", 0)) + int(second.get("createdLinks", 0)),
        "updatedLinks": int(first.get("updatedLinks", 0)) + int(second.get("updatedLinks", 0)),
        "needsReview": int(second.get("needsReview", first.get("needsReview", 0))),
        "bankInvoicePeriods": int(payment.get("periodCount", 0)),
        "bankInvoiceMatchesCreated": int(payment.get("matchedLinks", 0)),
        "bankInvoiceRepaired": int(payment.get("repaired", 0)),
        "bankInvoiceAmbiguous": int(payment.get("ambiguous", 0)),
    }
    audit(
        db,
        actor,
        "business_partner.synced",
        "business_partner",
        "",
        {**result, "paymentPeriods": payment.get("periods", [])},
    )
    return {"ok": True, **result}


@router.post("")
def create_partner(
    payload: PartnerInput, request: Request, db: Session = Depends(get_db)
) -> dict[str, Any]:
    try:
        row = partner_service.create_partner(db, payload.model_dump())
        db.commit()
        audit(
            db,
            current_actor(request),
            "business_partner.created",
            "business_partner",
            str(row.id),
            {"name": row.name, "roles": row.roles},
        )
        return partner_service.partner_detail(db, row.id) or {}
    except ValueError as exc:
        db.rollback()
        raise HTTPException(422, str(exc)) from exc


@router.get("/{partner_id}")
def get_partner(partner_id: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    _sync_and_commit(db)
    row = partner_service.partner_detail(db, partner_id)
    if row is None:
        raise HTTPException(404, "往来单位不存在")
    return row


@router.put("/{partner_id}")
def update_partner(
    partner_id: int,
    payload: PartnerInput,
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        row = partner_service.update_partner(db, partner_id, payload.model_dump())
        # 手工资料更新后立刻再跑一次，让已存在的待确认来源按新别名/税号/账号回填。
        sync = partner_service.sync_business_partners(db)
        db.commit()
        audit(
            db,
            current_actor(request),
            "business_partner.updated",
            "business_partner",
            str(row.id),
            {"name": row.name, "sync": sync},
        )
        return partner_service.partner_detail(db, row.id) or {}
    except ValueError as exc:
        db.rollback()
        raise HTTPException(422, str(exc)) from exc


@router.post("/{partner_id}/identifiers")
def add_partner_identifier(
    partner_id: int,
    payload: IdentifierInput,
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        row = partner_service.add_identifier(
            db, partner_id, kind=payload.kind, value=payload.value
        )
        sync = partner_service.sync_business_partners(db)
        db.commit()
        audit(
            db,
            current_actor(request),
            "business_partner.identifier_added",
            "business_partner",
            str(partner_id),
            {"kind": row.kind, "value": row.value, "sync": sync},
        )
        return partner_service.partner_detail(db, partner_id) or {}
    except ValueError as exc:
        db.rollback()
        raise HTTPException(422, str(exc)) from exc


@router.post("/{partner_id}/duplicates/{other_partner_id}/decide")
def decide_partner_duplicate(
    partner_id: int,
    other_partner_id: int,
    payload: DuplicateDecisionInput,
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        detail = partner_service.decide_duplicate(
            db,
            partner_id,
            other_partner_id=other_partner_id,
            same=payload.same,
            note=payload.note,
            actor=current_actor(request),
        )
        db.commit()
        audit(
            db,
            current_actor(request),
            "business_partner.duplicate_decided",
            "business_partner",
            str(partner_id),
            {"otherPartnerId": other_partner_id, "same": payload.same, "note": payload.note},
        )
        return detail
    except ValueError as exc:
        db.rollback()
        raise HTTPException(422, str(exc)) from exc


@router.post("/{partner_id}/review-links/{link_id}/claim")
def claim_partner_review_link(
    partner_id: int,
    link_id: int,
    payload: ReviewClaimInput,
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        row = partner_service.claim_review_link(
            db, partner_id=partner_id, link_id=link_id, note=payload.note
        )
        db.commit()
        audit(
            db,
            current_actor(request),
            "business_partner.review_claimed",
            "business_partner_link",
            str(row.id),
            {"partnerId": partner_id, "sourceType": row.source_type, "sourceId": row.source_id},
        )
        return partner_service.partner_detail(db, partner_id) or {}
    except ValueError as exc:
        db.rollback()
        raise HTTPException(422, str(exc)) from exc
