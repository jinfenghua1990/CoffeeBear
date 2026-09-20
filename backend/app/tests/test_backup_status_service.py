from __future__ import annotations

import json

from app.services import backup_status_service


def test_r2_full_receipt_exposes_recoverable_snapshot_key(tmp_path, monkeypatch):
    monkeypatch.setenv("BACKUP_DIR", str(tmp_path))
    receipt_dir = tmp_path / ".r2-uploaded"
    receipt_dir.mkdir()
    snapshot_key = (
        "ecommerce-workspace/backup/full/2026/09/20/"
        "20260920_120000/snapshot.json"
    )
    (receipt_dir / "20260920_120000-full.json").write_text(
        json.dumps(
            {
                "timestamp": "20260920_120000",
                "kind": "full",
                "snapshotObjectKey": snapshot_key,
            }
        ),
        encoding="utf-8",
    )

    status = backup_status_service.get_status()

    record = status["lastR2Full"]
    assert record is not None
    assert record["type"] == "r2_full"
    assert record["recoverable"] is True
    assert record["snapshotObjectKey"] == snapshot_key


def test_r2_daily_receipt_is_not_marked_recoverable(tmp_path, monkeypatch):
    monkeypatch.setenv("BACKUP_DIR", str(tmp_path))
    receipt_dir = tmp_path / ".r2-uploaded"
    receipt_dir.mkdir()
    (receipt_dir / "20260920_120000-daily.json").write_text(
        json.dumps(
            {
                "timestamp": "20260920_120000",
                "kind": "daily",
                "snapshotObjectKey": (
                    "ecommerce-workspace/backup/daily/2026/09/20/"
                    "20260920_120000.json"
                ),
            }
        ),
        encoding="utf-8",
    )

    status = backup_status_service.get_status()

    record = status["lastR2"]
    assert record is not None
    assert record["type"] == "r2_daily"
    assert record["recoverable"] is False
