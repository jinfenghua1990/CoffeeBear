"""外贸工作台核心模型：渠道、海外 SKU 映射、外贸订单。"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import BigInteger, DateTime, ForeignKey, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, PkMixin, TimestampMixin

MONEY = Numeric(18, 4)
RATE = Numeric(18, 6)


class ForeignTradeChannel(Base, PkMixin, TimestampMixin):
    __tablename__ = "foreign_trade_channels"
    __table_args__ = (UniqueConstraint("code", name="uq_foreign_trade_channels_code"),)

    code: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    channel_type: Mapped[str] = mapped_column(String(32), default="manual")
    brand: Mapped[str] = mapped_column(String(128), default="")
    currency: Mapped[str] = mapped_column(String(8), default="EUR")
    countries: Mapped[list] = mapped_column(JSONB, default=list)
    enabled: Mapped[bool] = mapped_column(default=True)
    connected: Mapped[bool] = mapped_column(default=False)
    note: Mapped[str] = mapped_column(Text, default="")
    raw: Mapped[dict] = mapped_column(JSONB, default=dict)


class ForeignTradeSkuMapping(Base, PkMixin, TimestampMixin):
    __tablename__ = "foreign_trade_sku_mappings"
    __table_args__ = (
        UniqueConstraint("channel_code", "external_sku", name="uq_foreign_trade_sku_channel_external"),
    )

    channel_code: Mapped[str] = mapped_column(String(64), nullable=False)
    external_sku: Mapped[str] = mapped_column(String(128), nullable=False)
    internal_sku: Mapped[str] = mapped_column(String(128), default="")
    product_name: Mapped[str] = mapped_column(String(512), default="")
    status: Mapped[str] = mapped_column(String(16), default="pending")
    note: Mapped[str] = mapped_column(Text, default="")


class ForeignTradeOrder(Base, PkMixin, TimestampMixin):
    __tablename__ = "foreign_trade_orders"
    __table_args__ = (
        UniqueConstraint("channel_code", "external_order_no", name="uq_foreign_trade_order_channel_external"),
    )

    channel_code: Mapped[str] = mapped_column(String(64), nullable=False)
    external_order_no: Mapped[str] = mapped_column(String(128), nullable=False)
    brand: Mapped[str] = mapped_column(String(128), default="")
    country: Mapped[str] = mapped_column(String(64), default="")
    currency: Mapped[str] = mapped_column(String(8), default="EUR")
    gross_amount: Mapped[Decimal] = mapped_column(MONEY, default=0)
    discount_amount: Mapped[Decimal] = mapped_column(MONEY, default=0)
    shipping_income: Mapped[Decimal] = mapped_column(MONEY, default=0)
    paid_amount: Mapped[Decimal] = mapped_column(MONEY, default=0)
    refund_amount: Mapped[Decimal] = mapped_column(MONEY, default=0)
    payment_fee: Mapped[Decimal] = mapped_column(MONEY, default=0)
    purchase_cost: Mapped[Decimal] = mapped_column(MONEY, default=0)
    logistics_cost: Mapped[Decimal] = mapped_column(MONEY, default=0)
    exchange_rate_to_cny: Mapped[Decimal] = mapped_column(RATE, default=1)
    status: Mapped[str] = mapped_column(String(24), default="pending")
    procurement_status: Mapped[str] = mapped_column(String(24), default="pending")
    fulfillment_status: Mapped[str] = mapped_column(String(24), default="pending")
    payment_status: Mapped[str] = mapped_column(String(24), default="unpaid")
    customer_name: Mapped[str] = mapped_column(String(128), default="")
    customer_email: Mapped[str] = mapped_column(String(256), default="")
    ship_to: Mapped[str] = mapped_column(Text, default="")
    carrier: Mapped[str] = mapped_column(String(128), default="")
    tracking_no: Mapped[str] = mapped_column(String(128), default="")
    ordered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    shipped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    items: Mapped[list] = mapped_column(JSONB, default=list)
    note: Mapped[str] = mapped_column(Text, default="")
    raw: Mapped[dict] = mapped_column(JSONB, default=dict)


class ForeignTradeDealer(Base, PkMixin, TimestampMixin):
    """B2B 经销商客户主档。Shopify Company / Location 只是外部映射，不是主数据。"""

    __tablename__ = "foreign_trade_dealers"
    __table_args__ = (UniqueConstraint("code", name="uq_foreign_trade_dealers_code"),)

    code: Mapped[str] = mapped_column(String(64), nullable=False)
    company_name: Mapped[str] = mapped_column(String(256), nullable=False)
    country: Mapped[str] = mapped_column(String(64), default="")
    region: Mapped[str] = mapped_column(String(128), default="")
    contact_name: Mapped[str] = mapped_column(String(128), default="")
    email: Mapped[str] = mapped_column(String(256), default="")
    phone: Mapped[str] = mapped_column(String(64), default="")
    dealer_level: Mapped[str] = mapped_column(String(32), default="standard")
    status: Mapped[str] = mapped_column(String(24), default="active")
    currency: Mapped[str] = mapped_column(String(8), default="EUR")
    shopify_company_id: Mapped[str] = mapped_column(String(128), default="")
    shopify_company_location_id: Mapped[str] = mapped_column(String(128), default="")
    address: Mapped[str] = mapped_column(Text, default="")
    note: Mapped[str] = mapped_column(Text, default="")
    raw: Mapped[dict] = mapped_column(JSONB, default=dict)


class ForeignTradeInventoryReservation(Base, PkMixin, TimestampMixin):
    """B2B 专属库存预留。只影响可售量，不修改真实库存总账。"""

    __tablename__ = "foreign_trade_inventory_reservations"

    dealer_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("foreign_trade_dealers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sku_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("product_skus.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    reservation_kind: Mapped[str] = mapped_column(String(24), default="quote")
    reference_no: Mapped[str] = mapped_column(String(128), default="", index=True)
    source: Mapped[str] = mapped_column(String(32), default="manual")
    shopify_draft_order_id: Mapped[str] = mapped_column(String(128), default="")
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(24), default="active", index=True)
    note: Mapped[str] = mapped_column(Text, default="")
