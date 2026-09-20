from __future__ import annotations

import json
import os
from datetime import datetime
from zoneinfo import ZoneInfo
from pathlib import Path
from typing import Any


def _root() -> Path:
    return Path(__file__).resolve().parents[3]


def _backup_dir() -> Path:
    root = Path(os.getenv("PERSIST_ROOT") or str(_root())).expanduser()
    return Path(os.getenv("BACKUP_DIR") or (root / "backups")).expanduser()


def _iso_from_timestamp(value: str) -> str | None:
    try:
        parsed = datetime.strptime(value[:15], "%Y%m%d_%H%M%S").replace(tzinfo=ZoneInfo(os.getenv("TZ") or "Asia/Shanghai"))
        return parsed.isoformat()
    except Exception:
        return None


def _read_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


def _local_records(directory: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for manifest in directory.glob("backup_*.manifest"):
        timestamp = manifest.stem.removeprefix("backup_")
        records.append(
            {
                "timestamp": timestamp,
                "time": _iso_from_timestamp(timestamp),
                "type": "local",
                "target": "本地",
                "status": "success",
                "detail": "PostgreSQL + data/ 基础恢复点",
            }
        )
    return records


def _r2_records(directory: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    receipt_dir = directory / ".r2-uploaded"
    if not receipt_dir.is_dir():
        return records
    for receipt in receipt_dir.glob("*.json"):
        payload = _read_json(receipt)
        timestamp = str(payload.get("timestamp") or receipt.stem.split("-", 1)[0])
        kind = str(payload.get("kind") or "daily")
        records.append(
            {
                "timestamp": timestamp,
                "time": _iso_from_timestamp(timestamp),
                "type": "r2_full" if kind == "full" else "r2_daily",
                "target": "Cloudflare R2",
                "status": "success",
                "detail": "完整容灾" if kind == "full" else "模块化快照",
            }
        )
    return records


def _kodo_records(directory: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    receipt_dir = directory / ".kodo-uploaded"
    if not receipt_dir.is_dir():
        return records
    for receipt in receipt_dir.glob("*.json"):
        payload = _read_json(receipt)
        timestamp = str(payload.get("timestamp") or receipt.stem)
        records.append(
            {
                "timestamp": timestamp,
                "time": _iso_from_timestamp(timestamp),
                "type": "kodo_full",
                "target": "七牛云 Kodo",
                "status": "success",
                "detail": "每日全量冷备 · 只写入",
            }
        )
    return records


def get_status(limit: int = 50) -> dict[str, Any]:
    directory = _backup_dir()
    if not directory.is_dir():
        return {
            "backupDir": str(directory),
            "records": [],
            "lastLocal": None,
            "lastR2": None,
            "lastR2Full": None,
            "lastKodo": None,
        }

    records = _local_records(directory) + _r2_records(directory) + _kodo_records(directory)
    records.sort(key=lambda row: str(row.get("timestamp") or ""), reverse=True)
    records = records[: max(1, min(limit, 200))]

    def first(types: set[str]) -> dict[str, Any] | None:
        return next((row for row in records if row["type"] in types), None)

    return {
        "backupDir": str(directory),
        "records": records,
        "lastLocal": first({"local"}),
        "lastR2": first({"r2_daily", "r2_full"}),
        "lastR2Full": first({"r2_full"}),
        "lastKodo": first({"kodo_full"}),
    }
