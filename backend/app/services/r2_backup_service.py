from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.core.audit import audit
from app.core.security import decrypt_secret, encrypt_secret
from app.models.integration import IntegrationConnection, IntegrationCredential

PROVIDER = "cloudflare_r2"
MODE = "backup"
DEFAULT_PREFIX = "ecommerce-workspace/backup"


def _connection(db: Session) -> IntegrationConnection | None:
    return db.query(IntegrationConnection).filter_by(provider=PROVIDER, mode=MODE).first()


def _credential(db: Session) -> IntegrationCredential | None:
    return (
        db.query(IntegrationCredential)
        .filter_by(provider=PROVIDER)
        .order_by(IntegrationCredential.id.desc())
        .first()
    )


def get_config(db: Session) -> dict[str, Any]:
    conn = _connection(db)
    cred = _credential(db)
    meta = (conn.meta or {}) if conn else {}
    configured = bool(
        cred
        and str(meta.get("endpoint_url") or "").strip()
        and str(meta.get("bucket") or "").strip()
    )
    return {
        "configured": configured,
        "enabled": bool(meta.get("enabled")) if configured else False,
        "endpointUrl": str(meta.get("endpoint_url") or ""),
        "bucket": str(meta.get("bucket") or ""),
        "prefix": str(meta.get("prefix") or DEFAULT_PREFIX),
        "accessKeyHint": cred.key_hint if cred else "",
        "fullIntervalDays": int(meta.get("full_interval_days") or 10),
        "mode": MODE,
        "readEnabled": True,
    }


def save_config(
    db: Session,
    *,
    endpoint_url: str,
    bucket: str,
    prefix: str,
    access_key: str,
    secret_key: str,
    enabled: bool,
    full_interval_days: int,
    actor: str,
) -> dict[str, Any]:
    endpoint_url = endpoint_url.strip().rstrip("/")
    bucket = bucket.strip()
    prefix = prefix.strip().strip("/") or DEFAULT_PREFIX
    access_key = access_key.strip()
    secret_key = secret_key.strip()

    if not endpoint_url.startswith("https://"):
        raise ValueError("R2 Endpoint 必须使用 https://")
    if not bucket:
        raise ValueError("R2 Bucket 不能为空")
    if ".." in prefix.split("/"):
        raise ValueError("对象前缀不能包含 ..")
    if full_interval_days < 1 or full_interval_days > 365:
        raise ValueError("全量容灾间隔必须在 1-365 天之间")

    cred = _credential(db)
    if bool(access_key) != bool(secret_key):
        raise ValueError("Access Key ID 与 Secret Access Key 必须同时填写")
    if not cred and not (access_key and secret_key):
        raise ValueError("首次配置必须填写 Access Key ID 与 Secret Access Key")

    if access_key and secret_key:
        payload = json.dumps(
            {"access_key": access_key, "secret_key": secret_key},
            ensure_ascii=False,
            separators=(",", ":"),
        )
        if cred:
            cred.key_hint = f"••••{access_key[-4:]}" if len(access_key) >= 4 else "已保存"
            cred.secret_encrypted = encrypt_secret(payload)
        else:
            cred = IntegrationCredential(
                provider=PROVIDER,
                key_hint=f"••••{access_key[-4:]}" if len(access_key) >= 4 else "已保存",
                secret_encrypted=encrypt_secret(payload),
                extra={"mode": MODE},
            )
            db.add(cred)

    conn = _connection(db)
    if not conn:
        conn = IntegrationConnection(provider=PROVIDER, mode=MODE, phase=1)
        db.add(conn)
    conn.status = "configured"
    conn.error_summary = ""
    conn.meta = {
        "endpoint_url": endpoint_url,
        "bucket": bucket,
        "prefix": prefix,
        "enabled": bool(enabled),
        "full_interval_days": int(full_interval_days),
        "access": "read_write",
    }
    db.commit()
    db.refresh(conn)

    audit(
        db,
        actor,
        "backup.r2.config.save",
        "integration",
        conn.id,
        {
            "endpoint_url": endpoint_url,
            "bucket": bucket,
            "prefix": prefix,
            "enabled": bool(enabled),
            "full_interval_days": int(full_interval_days),
        },
    )
    return get_config(db)


def runtime_config(db: Session) -> dict[str, Any] | None:
    public = get_config(db)
    if not public["configured"]:
        return None
    cred = _credential(db)
    if not cred:
        return None
    payload = json.loads(decrypt_secret(cred.secret_encrypted))
    return {
        **public,
        "endpoint_url": public["endpointUrl"],
        "access_key": str(payload.get("access_key") or ""),
        "secret_key": str(payload.get("secret_key") or ""),
    }


def start_backup(mode: str = "auto") -> dict[str, Any]:
    if mode not in {"auto", "daily", "full"}:
        raise ValueError("备份模式必须是 auto / daily / full")

    root = Path(__file__).resolve().parents[3]
    script = root / "scripts" / "r2-backup.py"
    if not script.is_file():
        raise RuntimeError("R2 备份执行器不存在")

    data_dir = Path(os.getenv("DATA_DIR") or (root / "data")).expanduser()
    log_dir = data_dir / "backup-jobs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "r2-backup.log"
    log_stream = log_path.open("ab")
    try:
        subprocess.Popen(
            [sys.executable, str(script), "--mode", mode],
            cwd=str(root),
            stdout=log_stream,
            stderr=subprocess.STDOUT,
            env=os.environ.copy(),
            start_new_session=True,
        )
    finally:
        log_stream.close()
    return {"started": True, "target": "r2", "mode": mode, "log": str(log_path)}
