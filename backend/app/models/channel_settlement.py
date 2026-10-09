from datetime import date
from decimal import Decimal

from sqlalchemy import BigInteger, Date, ForeignKey, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, PkMixin, TimestampMixin

MONEY = Numeric(18, 4)


class DomesticChannelSettlement(Base, PkMixin, TimestampMixin):
    """Domestic marketplace settlement statement.

    This is not a bank transaction and not a sales order. It captures the platform
    statement that explains how gross channel sales become the net amount receivable
    from the platform. Cash truth remains in BankTransaction.
    """

    __tablename__ = "finance_channel_settlements"
    __table_args__ = (
        UniqueConstraint(
            "channel",
            "shop_name",
            "external_key",
            name="uq_finance_channel_settlement_external",
        ),
    )

    legal_entity_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("finance_legal_entities.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    partner_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("business_partners.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    channel: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    shop_name: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    external_key: Mapped[str] = mapped_column(String(128), nullable=False)
    order_no: Mapped[str] = mapped_column(String(128), nullable=False, default="", index=True)
    settle_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="CNY")
    gross_amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal("0"))
    refund_amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal("0"))
    platform_fee: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal("0"))
    rebate_amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal("0"))
    other_fee: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal("0"))
    net_amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal("0"))
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="draft", index=True)
    raw: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    note: Mapped[str] = mapped_column(Text, nullable=False, default="")
