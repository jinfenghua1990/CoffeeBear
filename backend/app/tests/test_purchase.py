from decimal import Decimal

import pytest

from app.models.catalog import Warehouse
from app.models.purchase import ExternalPurchaseOrder, InboundLink
from app.services.purchase_service import (
    _has_actual_inbound,
    create_external_po,
    derive_invoice_status,
    update_external_po,
    validate_transition,
)


def test_forward_transition_valid():
    assert validate_transition("pending_refine", "confirmed")
    assert validate_transition("confirmed", "jackyun_linked")
    assert validate_transition("arrived", "inbound")


def test_backward_or_skip_transition_invalid():
    assert not validate_transition("confirmed", "pending_refine")   # 回退
    assert not validate_transition("pending_refine", "shipped")     # 跳步
    assert not validate_transition("done", "done")                  # 原地
    assert not validate_transition("whatever", "confirmed")         # 非法态


def test_invoice_status_full_when_covered():
    assert derive_invoice_status("50000", "50000", "applied") == "full"
    assert derive_invoice_status("50000", "52000", "applied") == "full"


def test_invoice_status_partial():
    assert derive_invoice_status("50000", "20000", "applied") == "partial"


def test_invoice_status_none_kept_when_no_link():
    assert derive_invoice_status("50000", "0", "none") == "none"
    assert derive_invoice_status("50000", "0", "unverified") == "unverified"


def test_invoice_status_defaults_unverified():
    assert derive_invoice_status("50000", "0", "weird") == "unverified"


def test_zero_paid_with_links_is_partial():
    assert derive_invoice_status("0", "100", "none") == "partial"


def test_actual_inbound_is_detected_from_legacy_link(db_session):
    po = ExternalPurchaseOrder(
        external_order_id="PYTEST-LEGACY-INBOUND",
        platform="taobao",
        purchase_status="jackyun_linked",
    )
    db_session.add(po)
    db_session.flush()
    assert not _has_actual_inbound(db_session, po)

    db_session.add(InboundLink(po_id=po.id, goodsdoc_no="RK-PYTEST-001"))
    db_session.flush()
    assert _has_actual_inbound(db_session, po)


def test_purchase_order_target_warehouse_is_saved_and_can_be_cleared(db_session):
    warehouse = Warehouse(code="WH-PURCHASE-TEST", name="采购测试仓", purpose="goods", status="active")
    db_session.add(warehouse)
    db_session.flush()
    po = create_external_po(
        db_session,
        external_order_id="PYTEST-TARGET-WAREHOUSE",
        supplier_name="测试供应商",
        warehouse_id=warehouse.id,
    )
    assert po.warehouse_id == warehouse.id

    update_external_po(db_session, po, warehouse_id=None)
    assert po.warehouse_id is None


def test_purchase_order_target_warehouse_rejects_inactive_warehouse(db_session):
    warehouse = Warehouse(code="WH-PURCHASE-INACTIVE", name="停用测试仓", purpose="goods", status="inactive")
    db_session.add(warehouse)
    db_session.flush()
    po = ExternalPurchaseOrder(external_order_id="PYTEST-INACTIVE-WAREHOUSE")
    db_session.add(po)
    db_session.flush()

    with pytest.raises(ValueError, match="不存在或已停用"):
        update_external_po(db_session, po, warehouse_id=warehouse.id)


def test_local_purchase_order_number_is_the_editable_system_key(db_session):
    po = ExternalPurchaseOrder(
        external_order_id="PDD-TEMP-ORDER",
        platform="pdd",
        supplier_name="本地采购供应商",
    )
    db_session.add(po)
    db_session.flush()

    update_external_po(db_session, po, external_order_id="PDD-LOCAL-001")

    assert po.external_order_id == "PDD-LOCAL-001"


def test_local_purchase_order_number_cannot_duplicate_same_channel(db_session):
    first = ExternalPurchaseOrder(external_order_id="PDD-LOCAL-DUP", platform="pdd")
    second = ExternalPurchaseOrder(external_order_id="PDD-LOCAL-OTHER", platform="pdd")
    db_session.add_all([first, second])
    db_session.flush()

    with pytest.raises(ValueError, match="当前渠道已存在"):
        update_external_po(db_session, second, external_order_id=first.external_order_id)


def test_formal_purchase_creation_promotes_reference_only_order(db_session):
    reference = ExternalPurchaseOrder(
        external_order_id="PDD-REFERENCE-001",
        platform="pdd",
        supplier_name="入库文件供应商",
        raw={"referenceOnly": True, "source": "jackyun_inbound_apply"},
    )
    db_session.add(reference)
    db_session.flush()

    promoted = create_external_po(
        db_session,
        external_order_id="PDD-REFERENCE-001",
        platform="pdd",
        supplier_name="正式采购供应商",
        title="正式采购单",
        order_amount="1800",
        paid_amount="1800",
    )

    assert promoted.id == reference.id
    assert promoted.raw["referenceOnly"] is False
    assert promoted.supplier_name == "正式采购供应商"
    assert promoted.order_amount == Decimal("1800")
