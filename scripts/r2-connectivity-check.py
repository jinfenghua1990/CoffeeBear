"""R2 连通性与隔离性验证（仅用 stdlib 实现 SigV4，避免依赖）。

用途：在配置 R2 凭据后做一次端到端体检，既验证「能读写自己的桶」，
也验证「打不开其他项目的桶」——后者是存储空间隔离的硬证据。

用法：
    python3 scripts/r2-connectivity-check.py <ACCESS_KEY_ID> <SECRET_ACCESS_KEY> <ENDPOINT>

示例：
    python3 scripts/r2-connectivity-check.py \\
        "$R2_ACCESS_KEY" "$R2_SECRET_KEY" \\
        https://<ACCOUNT_ID>.r2.cloudflarestorage.com

凭据只经命令行传入，脚本不落盘、不打印。退出码 0 表示全部符合预期。

预期结果：
    [1] coffeebear-prod            全部 2xx（HEAD/PUT/GET/DELETE）
    [2] ecommerce-workspace-backup 403/404（被拒绝）
    [3] alsvid-production          403/404（被拒绝）
"""

from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ACCESS_KEY = sys.argv[1]
SECRET_KEY = sys.argv[2]
ENDPOINT = sys.argv[3].rstrip("/")
HOST = urllib.parse.urlsplit(ENDPOINT).netloc
REGION = "auto"
SERVICE = "s3"


def _sign(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


def _signing_key(secret: str, date_stamp: str) -> bytes:
    k = _sign(("AWS4" + secret).encode(), date_stamp)
    k = _sign(k, REGION)
    k = _sign(k, SERVICE)
    return _sign(k, "aws4_request")


def request(method: str, path: str, body: bytes = b"", extra_headers: dict | None = None):
    """发一次签名请求；网络层抖动（R2 拒绝时偶发 SSL 断连）重试一次。"""
    last: tuple[int, bytes] = (0, b"")
    for attempt in range(2):
        status, payload = _request_once(method, path, body, extra_headers)
        if status != 0:
            return status, payload
        last = (status, payload)
        if attempt == 0:
            time.sleep(1.0)
    return last


def _request_once(method: str, path: str, body: bytes = b"", extra_headers: dict | None = None):
    now = dt.datetime.now(dt.timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")
    payload_hash = hashlib.sha256(body).hexdigest()

    canonical_uri = urllib.parse.quote(path, safe="/-_.~")
    headers = {
        "host": HOST,
        "x-amz-content-sha256": payload_hash,
        "x-amz-date": amz_date,
    }
    if extra_headers:
        headers.update({k.lower(): v for k, v in extra_headers.items()})

    signed_headers = ";".join(sorted(headers))
    canonical_headers = "".join(f"{k}:{headers[k]}\n" for k in sorted(headers))
    canonical_request = "\n".join(
        [method, canonical_uri, "", canonical_headers, signed_headers, payload_hash]
    )
    scope = f"{date_stamp}/{REGION}/{SERVICE}/aws4_request"
    string_to_sign = "\n".join(
        [
            "AWS4-HMAC-SHA256",
            amz_date,
            scope,
            hashlib.sha256(canonical_request.encode()).hexdigest(),
        ]
    )
    signature = hmac.new(
        _signing_key(SECRET_KEY, date_stamp), string_to_sign.encode(), hashlib.sha256
    ).hexdigest()
    authorization = (
        f"AWS4-HMAC-SHA256 Credential={ACCESS_KEY}/{scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )

    req = urllib.request.Request(
        ENDPOINT + canonical_uri, data=body if method in {"PUT", "POST"} else None, method=method
    )
    for k, v in headers.items():
        if k != "host":
            req.add_header(k, v)
    req.add_header("Authorization", authorization)
    if extra_headers:
        for k, v in extra_headers.items():
            req.add_header(k, v)

    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            return resp.status, resp.read(200)
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read(300)
    except Exception as exc:  # noqa: BLE001
        return 0, f"{exc.__class__.__name__}: {exc}".encode()


def show(label: str, status: int, body: bytes, expect: str):
    text = body[:160].decode("utf-8", "replace").replace("\n", " ")
    ok = "✓" if _match(status, expect) else "✗"
    print(f"  {ok} {label:<46} HTTP {status}  {text}")
    return ok == "✓"


def _match(status: int, expect: str) -> bool:
    if expect == "2xx":
        return 200 <= status < 300
    return str(status) == expect


def main() -> int:
    print(f"Endpoint: {ENDPOINT}")
    print(f"Host:     {HOST}")
    print()
    results = []

    print("[1] 自有桶 coffeebear-prod —— 应可读写")
    results.append(show("HEAD /coffeebear-prod（列桶）", *request("HEAD", "/coffeebear-prod"), "2xx"))

    key = "/coffeebear-prod/coffeebear/backup/.connectivity-probe.txt"
    probe = b"coffeebear cloud run r2 connectivity probe\n"
    results.append(
        show(
            "PUT  coffeebear/backup/探针文件",
            *request("PUT", key, probe, {"content-type": "text/plain"}),
            "2xx",
        )
    )
    results.append(show("GET  读回探针文件", *request("GET", key), "2xx"))
    results.append(show("DELETE 清理探针文件", *request("DELETE", key), "2xx"))

    print()
    print("[2] 其他项目的桶 —— 必须被拒绝（隔离验证）")
    for foreign in ("/ecommerce-workspace-backup", "/alsvid-production"):
        status, body = request("HEAD", foreign)
        if status in (403, 404):
            mark, verdict = "✓", "被授权拒绝"
        elif status == 0:
            mark, verdict = "✓", "无法建立连接（同样访问不到）"
        elif 200 <= status < 300:
            mark, verdict = "✗", "竟然可访问——隔离失效！"
        else:
            mark, verdict = "?", f"未判定（HTTP {status}）"
        snippet = body[:100].decode("utf-8", "replace").replace("\n", " ")
        print(f"  {mark} HEAD {foreign:<40} HTTP {status:<4} {verdict}  {snippet}")
        results.append(mark != "✗")

    print()
    passed = sum(1 for r in results if r)
    print(f"结果：{passed}/{len(results)} 项符合预期")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
