from app.models.purchase import ExternalPurchaseOrder, Supplier
from app.models.production import ProductionOrder
from app.services.supplier_sync_service import sync_suppliers_from_business_data


def test_sync_creates_suppliers_from_purchase_and_production(db_session):
    db_session.add_all([
        ExternalPurchaseOrder(
            external_order_id="SUPPLIER-SYNC-PO-001",
            platform="1688",
            supplier_name="采购供应商  有限公司",
        ),
        ProductionOrder(
            order_no="SUPPLIER-SYNC-SC-001",
            factory_name="生产工厂",
        ),
    ])
    db_session.flush()

    result = sync_suppliers_from_business_data(db_session)

    assert result["created"] == 2
    assert {row.name for row in db_session.query(Supplier).all()} == {
        "采购供应商 有限公司",
        "生产工厂",
    }
    assert db_session.query(Supplier).filter_by(name="采购供应商 有限公司").one().platform == "1688"
    assert db_session.query(Supplier).filter_by(name="生产工厂").one().platform == "线下"


def test_sync_is_idempotent_and_skips_reference_only_purchase(db_session):
    db_session.add_all([
        ExternalPurchaseOrder(
            external_order_id="SUPPLIER-SYNC-REFERENCE-001",
            platform="other",
            supplier_name="仅供参考的供应商",
            raw={"referenceOnly": True},
        ),
        ExternalPurchaseOrder(
            external_order_id="SUPPLIER-SYNC-REAL-001",
            platform="taobao",
            supplier_name="真实供应商",
        ),
    ])
    db_session.flush()

    first = sync_suppliers_from_business_data(db_session)
    second = sync_suppliers_from_business_data(db_session)

    assert first["created"] == 1
    assert second["created"] == 0
    assert db_session.query(Supplier).filter_by(name="真实供应商").count() == 1
    assert db_session.query(Supplier).filter_by(name="仅供参考的供应商").count() == 0
