"""套装档案批量删除：只删除没有历史业务引用的套装。"""

from datetime import datetime, timezone

from app.models.catalog import InventorySnapshot, ProductSku
from app.models.org import AuditLog


def test_bulk_delete_bundles_keeps_rows_with_history_references(client, db_session):
    removable = ProductSku(
        jackyun_sku_id="BULK-DELETE-REMOVABLE",
        sku_code="BULK-DELETE-REMOVABLE",
        sku_name="可删除套装",
        product_type="bundle",
    )
    referenced = ProductSku(
        jackyun_sku_id="BULK-DELETE-REFERENCED",
        sku_code="BULK-DELETE-REFERENCED",
        sku_name="有历史引用套装",
        product_type="virtual_bundle",
    )
    single = ProductSku(
        jackyun_sku_id="BULK-DELETE-SINGLE",
        sku_code="BULK-DELETE-SINGLE",
        sku_name="单品",
        product_type="single",
    )
    db_session.add_all([removable, referenced, single])
    db_session.flush()
    db_session.add(
        InventorySnapshot(
            sku_id=referenced.id,
            quantity=1,
            snapshot_at=datetime.now(timezone.utc),
            source="pytest",
        )
    )
    db_session.flush()
    removable_id, referenced_id, single_id = removable.id, referenced.id, single.id

    response = client.post(
        "/api/v1/dashboard/catalog/bundles/bulk-delete",
        json={"ids": [removable_id, referenced_id, single_id, 999999999]},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["deleted"] == 1
    assert body["deletedIds"] == [removable_id]
    assert body["blocked"][0]["id"] == referenced_id
    assert body["blocked"][0]["references"] == [{"label": "库存快照", "count": 1}]
    assert body["invalid"] == [{"id": single_id, "skuCode": "BULK-DELETE-SINGLE", "reason": "仅可删除套装或虚拟组合套装"}]
    assert body["notFound"] == [999999999]

    db_session.expire_all()
    assert db_session.get(ProductSku, removable_id) is None
    assert db_session.get(ProductSku, referenced_id) is not None

    db_session.query(InventorySnapshot).filter(InventorySnapshot.sku_id == referenced_id).delete(
        synchronize_session=False,
    )
    db_session.query(ProductSku).filter(ProductSku.id.in_([referenced_id, single_id])).delete(
        synchronize_session=False,
    )
    db_session.query(AuditLog).filter(AuditLog.action == "catalog.bundle.bulk_delete").delete(
        synchronize_session=False,
    )
    db_session.commit()
