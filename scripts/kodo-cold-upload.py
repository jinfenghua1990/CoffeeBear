#!/usr/bin/env python3
"""
七牛云 Kodo 国内冷备上传器（upload-only）。

安全边界：
- 只读取本地 BACKUP_DIR。
- 只向 Kodo 上传域名发送上传请求。
- 不调用下载、GET Object、List、Head、Stat、远端校验或恢复接口。
- 完整性校验在本地完成，manifest 最后上传作为远端恢复点提交标记。

默认关闭。优先读取系统里加密保存的 Kodo 配置；也保留 KODO_COLD_* 环境变量作为部署级兜底。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

import requests


ROOT = Path(__file__).resolve().parents[1]


def load_simple_env(path: Path) -> None:
    """仅补充当前进程中尚未存在的简单 KEY=VALUE；不执行 shell。"""
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key or key in os.environ:
            continue
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        os.environ[key] = value


def truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def env_runtime_config() -> dict[str, Any] | None:
    """环境变量仅作为部署级兜底；只有显式启用时才使用。"""
    if not truthy(os.getenv("KODO_COLD_ENABLED")):
        return None
    names = {
        "bucket": "KODO_COLD_BUCKET",
        "upload_url": "KODO_COLD_UPLOAD_URL",
        "access_key": "KODO_COLD_ACCESS_KEY",
        "secret_key": "KODO_COLD_SECRET_KEY",
    }
    missing = [env_name for env_name in names.values() if not (os.getenv(env_name) or "").strip()]
    if missing:
        raise RuntimeError("KODO_COLD_ENABLED=1，但缺少配置：" + ", ".join(missing))
    return {
        "configured": True,
        "enabled": True,
        "bucket": os.environ[names["bucket"]].strip(),
        "upload_url": os.environ[names["upload_url"]].strip().rstrip("/"),
        "access_key": os.environ[names["access_key"]].strip(),
        "secret_key": os.environ[names["secret_key"]].strip(),
        "prefix": (os.getenv("KODO_COLD_PREFIX") or "ecommerce-workspace/cold").strip().strip("/"),
        "source": "environment",
    }


def database_runtime_config() -> dict[str, Any] | None:
    """读取系统 UI 保存的加密配置；仅在服务端解密，不把密钥输出到日志。"""
    backend = ROOT / "backend"
    backend_text = str(backend)
    if backend_text not in sys.path:
        sys.path.insert(0, backend_text)

    from app.db import SessionLocal
    from app.services.kodo_backup_service import runtime_config

    db = SessionLocal()
    try:
        config = runtime_config(db)
    finally:
        db.close()
    if not config:
        return None
    return {
        **config,
        "upload_url": str(config.get("uploadUrl") or "").strip().rstrip("/"),
        "source": "database",
    }


def resolve_runtime_config() -> dict[str, Any] | None:
    env_config = env_runtime_config()
    if env_config:
        return env_config
    return database_runtime_config()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_manifest(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        if "=" not in raw:
            continue
        key, value = raw.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def qiniu_b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii")


def upload_token(access_key: str, secret_key: str, bucket: str, object_key: str) -> str:
    # scope 精确到单个 object key，避免脚本生成可覆盖其他对象的宽泛上传凭证。
    policy = {
        "scope": f"{bucket}:{object_key}",
        "deadline": int(time.time()) + 3600,
        "insertOnly": 1,
        "returnBody": '{"key":$(key),"hash":$(etag),"fsize":$(fsize)}',
    }
    encoded_policy = qiniu_b64(
        json.dumps(policy, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    )
    signature = hmac.new(
        secret_key.encode("utf-8"),
        encoded_policy.encode("ascii"),
        hashlib.sha1,
    ).digest()
    return f"{access_key}:{qiniu_b64(signature)}:{encoded_policy}"


def upload_one(
    *,
    upload_url: str,
    access_key: str,
    secret_key: str,
    bucket: str,
    object_key: str,
    source: Path,
) -> dict[str, Any]:
    token = upload_token(access_key, secret_key, bucket, object_key)
    with source.open("rb") as stream:
        response = requests.post(
            upload_url,
            data={"token": token, "key": object_key},
            files={"file": (source.name, stream, "application/octet-stream")},
            timeout=(15, 3600),
        )
    if response.status_code < 200 or response.status_code >= 300:
        body = response.text[:800].replace("\n", " ")
        raise RuntimeError(f"上传失败 HTTP {response.status_code}: {body}")
    try:
        payload = response.json()
    except ValueError:
        payload = {"response": response.text[:800]}
    return payload


def main() -> int:
    load_simple_env(ROOT / ".env")

    try:
        config = resolve_runtime_config()
    except Exception as exc:
        print(f"Kodo 冷备配置读取失败：{exc}", file=sys.stderr)
        return 2

    if not config:
        print("Kodo 冷备尚未配置或未启用；跳过本次上传。")
        return 0
    if not bool(config.get("enabled")):
        print("Kodo 冷备已配置但当前停用；跳过本次上传。")
        return 0

    backup_dir = Path(
        os.getenv("BACKUP_DIR")
        or (
            Path(os.getenv("PERSIST_ROOT", str(ROOT))) / "backups"
            if os.getenv("PERSIST_ROOT")
            else ROOT / "backups"
        )
    ).expanduser()
    manifests = sorted(
        backup_dir.glob("backup_*.manifest"),
        key=lambda item: item.stat().st_mtime,
        reverse=True,
    )
    if not manifests:
        print(f"未找到本地完整恢复点：{backup_dir}/backup_*.manifest", file=sys.stderr)
        return 2

    manifest = manifests[0]
    values = parse_manifest(manifest)
    timestamp = values.get("timestamp", "")
    db_name = values.get("db", "")
    db_hash = values.get("db_sha256", "")
    data_name = values.get("data", "")
    data_hash = values.get("data_sha256", "")

    if not timestamp or not db_name or "/" in db_name or not db_hash:
        print(f"manifest 无效：{manifest}", file=sys.stderr)
        return 2

    db_file = backup_dir / db_name
    if not db_file.is_file() or sha256_file(db_file) != db_hash:
        print(f"数据库备份本地 SHA256 校验失败：{db_file}", file=sys.stderr)
        return 2

    upload_files: list[Path] = [db_file]
    if data_name:
        if "/" in data_name or not data_hash:
            print(f"manifest 中 data 信息无效：{manifest}", file=sys.stderr)
            return 2
        data_file = backup_dir / data_name
        if not data_file.is_file() or sha256_file(data_file) != data_hash:
            print(f"data 归档本地 SHA256 校验失败：{data_file}", file=sys.stderr)
            return 2
        upload_files.append(data_file)

    # manifest 必须最后上传，作为“这一组本地校验已完成”的提交标记。
    upload_files.append(manifest)

    receipt_dir = backup_dir / ".kodo-uploaded"
    receipt_dir.mkdir(parents=True, exist_ok=True)
    receipt = receipt_dir / f"{timestamp}.json"
    if receipt.exists():
        print(f"该恢复点已有本地上传成功记录，跳过重复上传：{receipt}")
        return 0

    bucket = str(config["bucket"]).strip()
    upload_url = str(config["upload_url"]).strip().rstrip("/")
    access_key = str(config["access_key"]).strip()
    secret_key = str(config["secret_key"]).strip()
    prefix = str(config.get("prefix") or "ecommerce-workspace/cold").strip().strip("/")
    date_path = f"{timestamp[0:4]}/{timestamp[4:6]}/{timestamp[6:8]}" if len(timestamp) >= 8 else "undated"
    object_root = "/".join(part for part in [prefix, date_path, timestamp] if part)

    print(f"==> Kodo upload-only 冷备：{manifest.name}")
    print(f"==> 配置来源：{config.get('source', 'database')}")
    print("==> 规则：只上传，不下载、不取回、不列目录、不做远端校验。")

    uploaded: list[dict[str, Any]] = []
    for source in upload_files:
        object_key = f"{object_root}/{source.name}"
        result = upload_one(
            upload_url=upload_url,
            access_key=access_key,
            secret_key=secret_key,
            bucket=bucket,
            object_key=object_key,
            source=source,
        )
        uploaded.append(
            {
                "local_file": source.name,
                "object_key": object_key,
                "size": source.stat().st_size,
                "remote_hash": result.get("hash"),
            }
        )
        print(f"上传完成：{source.name} -> {object_key}")

    receipt.write_text(
        json.dumps(
            {
                "timestamp": timestamp,
                "bucket": bucket,
                "upload_url": upload_url,
                "object_root": object_root,
                "files": uploaded,
                "mode": "upload-only",
                "created_at": int(time.time()),
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"==> 完成。本地上传记录：{receipt}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
