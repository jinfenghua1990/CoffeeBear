from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from app.core.audit import audit
from app.core.security import decrypt_secret, encrypt_secret
from app.models.integration import IntegrationConnection, IntegrationCredential

PROVIDER = "kodo_cold"
MODE = "upload_only"


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
        and str(meta.get("bucket") or "").strip()
        and str(meta.get("upload_url") or "").strip()
    )
    return {
        "configured": configured,
        "enabled": bool(meta.get("enabled")) if configured else False,
        "bucket": str(meta.get("bucket") or ""),
        "uploadUrl": str(meta.get("upload_url") or ""),
        "prefix": str(meta.get("prefix") or "ecommerce-workspace/cold"),
        "accessKeyHint": cred.key_hint if cred else "",
        "mode": MODE,
        "readEnabled": False,
    }


def save_config(
    db: Session,
    *,
    bucket: str,
    upload_url: str,
    prefix: str,
    access_key: str,
    secret_key: str,
    enabled: bool,
    actor: str,
) -> dict[str, Any]:
    bucket = bucket.strip()
    upload_url = upload_url.strip().rstrip("/")
    prefix = prefix.strip().strip("/") or "ecommerce-workspace/cold"
    access_key = access_key.strip()
    secret_key = secret_key.strip()

    if not bucket:
        raise ValueError("Bucket 不能为空")
    if not upload_url.startswith("https://"):
        raise ValueError("上传域名必须使用 https://")
    if ".." in prefix.split("/"):
        raise ValueError("对象前缀不能包含 ..")

    cred = _credential(db)
    if bool(access_key) != bool(secret_key):
        raise ValueError("Access Key 与 Secret Key 必须同时填写")
    if not cred and not (access_key and secret_key):
        raise ValueError("首次配置必须填写 Access Key 与 Secret Key")

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
        "bucket": bucket,
        "upload_url": upload_url,
        "prefix": prefix,
        "enabled": bool(enabled),
        "access": "upload_only",
        "remote_read": False,
    }
    db.commit()
    db.refresh(conn)

    audit(
        db,
        actor,
        "backup.kodo.config.save",
        "integration",
        conn.id,
        {
            "bucket": bucket,
            "upload_url": upload_url,
            "prefix": prefix,
            "enabled": bool(enabled),
            "access": "upload_only",
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
        "access_key": str(payload.get("access_key") or ""),
        "secret_key": str(payload.get("secret_key") or ""),
    }
