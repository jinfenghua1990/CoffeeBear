from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import BigInteger, Date, DateTime, ForeignKey, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, PkMixin, TimestampMixin

MONEY = Numeric(18, 4)


class OpenItem(Base, PkMixin, TimestampMixin):
    """Domestic receivable/payable item that remains open until cash allocation closes it.

    BusinessPartner owns counterparty identity; BankTransaction owns cash truth.  This
    table only owns the lifecycle of the outstanding receivable/payable balance.
    """

    __tablename__ = "finance_open_items"
    __table_args__ = (
        UniqueConstraint(
            "item_type", "source_type", "source_id", name="uq_finance_open_item_source"
        ),
    )

    partner_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("business_partners.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    item_type: Mapped[str] = mapped_column(String(16), nullable=False, index=True)  # receivable/payable
    source_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    source_id: Mapped[str] = mapped_column(String(128), nullable=False)
    source_no: Mapped[str] = mapped_column(String(128), nullable=False, default="", index=True)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="CNY")
    original_amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    settled_amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal("0"))
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open", index=True)
    occurred_on: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    due_on: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class OpenItemAllocation(Base, PkMixin, TimestampMixin):
    """Allocation of one bank transaction to one open item.

    Allocations are voided instead of deleted so settlement history stays auditable.
    """

    __tablename__ = "finance_open_item_allocations"
    __table_args__ = (
        UniqueConstraint(
            "open_item_id",
            "bank_transaction_id",
            "status",
            name="uq_finance_open_item_allocation_active",
        ),
    )

    open_item_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("finance_open_items.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    bank_transaction_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("bank_transactions.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active", index=True)
    note: Mapped[str] = mapped_column(Text, nullable=False, default="")
    voided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
