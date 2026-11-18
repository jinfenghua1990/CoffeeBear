#!/usr/bin/env python3
"""Restricted internal updater for CoffeeBear's NAS Compose deployment."""
from __future__ import annotations
import base64, json, os, re, secrets, subprocess, threading, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

REPOSITORY = "jinfenghua1990/CoffeeBear"
# 镜像源白名单：仅官方 Registry 与经确认的可信镜像站。
# 域名字符串是唯一事实来源，正则由它派生，避免白名单与校验规则两处漂移；
# 不使用任何通配，杜绝「形似域名」被放行。
CANONICAL_REGISTRY = "ghcr.io"
IMAGE_REPO_PATH = "jinfenghua1990/coffeebear"
ALLOWED_DOMAINS = (
    "ghcr.io",
    "ghcr.nju.edu.cn",
    "ghcr.m.daocloud.io",
    "ghcr.dockerproxy.net",
)
MIRROR_DOMAINS = tuple(domain for domain in ALLOWED_DOMAINS if domain != CANONICAL_REGISTRY)
APP_PREFIX = f"{CANONICAL_REGISTRY}/{IMAGE_REPO_PATH}@sha256:"
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
_DOMAIN_PATTERN = "|".join(re.escape(domain) for domain in ALLOWED_DOMAINS)
_MANIFEST_RE = r"^sha256:[0-9a-f]{64}$"
DIGEST_RE = re.compile(
    rf"^(?:{_DOMAIN_PATTERN})/{re.escape(IMAGE_REPO_PATH)}@sha256:[0-9a-f]{{64}}$"
)
VERSION_RE = re.compile(r"^v\d{4}\.\d{2}\.\d{2}\.\d{6}$")
ACTIVE = {"queued", "preflight", "backup", "installing", "migrating", "restarting", "healthcheck"}
# 自动安装只允许在每天凌晨的维护窗口内进行；白天检测到新版只提示，由人工点击安装。
# 窗口以北京时间计算（容器默认 UTC），默认 01:00-02:00，可用环境变量覆盖。
AUTO_UPDATE_START_HOUR = int(os.environ.get("COFFEEBEAR_AUTO_UPDATE_HOUR", "1"))
AUTO_UPDATE_WINDOW_MINUTES = int(os.environ.get("COFFEEBEAR_AUTO_UPDATE_WINDOW_MINUTES", "60"))
CN_TZ = timezone(timedelta(hours=8))
DATA_DIR = Path(os.environ.get("DATA_DIR", "/data")).resolve()
STATE_DIR = DATA_DIR / "system-update"
STATUS_FILE = STATE_DIR / "container-status.json"
HISTORY_FILE = STATE_DIR / "history.jsonl"
TOKEN_FILE = STATE_DIR / "agent-token"
WORKSPACE = Path(os.environ.get("COFFEEBEAR_DEPLOY_DIR", "/workspace")).resolve()
COMPOSE_FILE = Path(os.environ.get("COFFEEBEAR_COMPOSE_FILE", str(WORKSPACE / "docker-compose.yml")))
ENV_FILE = Path(os.environ.get("COFFEEBEAR_ENV_FILE", str(WORKSPACE / ".env")))
LOCK = threading.RLock()

def now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat()

def in_auto_update_window() -> bool:
    """仅在北京时间每天凌晨维护窗口内返回 True。跨零点窗口同样支持。"""
    cn_now = datetime.now(CN_TZ)
    minute_of_day = cn_now.hour * 60 + cn_now.minute
    start = AUTO_UPDATE_START_HOUR * 60
    end = (AUTO_UPDATE_START_HOUR * 60 + AUTO_UPDATE_WINDOW_MINUTES) % (24 * 60)
    if start <= end:
        return start <= minute_of_day < end
    return minute_of_day >= start or minute_of_day < end

def ensure_state() -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    if not TOKEN_FILE.exists():
        tmp = TOKEN_FILE.with_suffix(".tmp")
        tmp.write_text(secrets.token_urlsafe(48), encoding="utf-8")
        os.chmod(tmp, 0o600)
        try: os.replace(tmp, TOKEN_FILE)
        except OSError: tmp.unlink(missing_ok=True)
    try: os.chmod(TOKEN_FILE, 0o600)
    except OSError: pass

def auth_token() -> str:
    ensure_state()
    return TOKEN_FILE.read_text(encoding="utf-8").strip()

def read_status() -> dict[str, Any]:
    try:
        value = json.loads(STATUS_FILE.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except Exception: return {}

def write_status(**updates: Any) -> dict[str, Any]:
    with LOCK:
        value = read_status()
        value.update(updates)
        value["updatedAt"] = now()
        if not isinstance(value.get("logs"), list): value["logs"] = []
        tmp = STATUS_FILE.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, STATUS_FILE)
        return value

def log(message: str) -> None:
    value = read_status()
    logs = value.get("logs") if isinstance(value.get("logs"), list) else []
    logs.append(f"[{now()}] {message}")
    write_status(logs=logs[-160:], message=message)

def request_bytes(url: str, *, headers: dict[str, str], timeout: int = 30, limit: int = 2_000_000) -> bytes:
    """Fetch a small trusted release resource with bounded retries.

    NAS connections may intermittently reset or stall while GitHub's raw host is
    reachable through a proxy.  A transient read failure must never turn into a
    failed deployment before the backup/install job has even started.
    """
    errors: list[str] = []
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as response:
                body = response.read(limit + 1)
            if len(body) > limit:
                raise RuntimeError("GitHub 返回内容超过安全大小限制")
            return body
        except (OSError, TimeoutError, urllib.error.URLError) as exc:
            errors.append(str(exc))
            if attempt < 2:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"GitHub 读取连续失败（已重试 3 次）：{errors[-1] if errors else '未知错误'}")

def request_json(url: str, timeout: int = 30) -> dict[str, Any]:
    value = json.loads(request_bytes(url, timeout=timeout, headers={
        "Accept":"application/vnd.github+json", "User-Agent":"CoffeeBear-NAS-Updater", "X-GitHub-Api-Version":"2022-11-28"
    }).decode("utf-8"))
    if not isinstance(value, dict): raise RuntimeError("GitHub 返回了无法识别的响应")
    return value

def request_json_list(url: str, timeout: int = 30) -> list[Any]:
    value = json.loads(request_bytes(url, timeout=timeout, headers={
        "Accept":"application/vnd.github+json", "User-Agent":"CoffeeBear-NAS-Updater", "X-GitHub-Api-Version":"2022-11-28"
    }).decode("utf-8"))
    if not isinstance(value, list):
        raise RuntimeError("GitHub 返回了无法识别的发布列表")
    return value

def release_from_item(item: dict[str, Any]) -> dict[str, Any] | None:
    tag, body = str(item.get("tag_name") or ""), str(item.get("body") or "")
    tick = r"[\x60]"
    source = re.search(r"Source SHA:\s*" + tick + r"([0-9a-f]{40})" + tick, body)
    app = re.search(rf"(?m)^IMAGE_REF=((?:{_DOMAIN_PATTERN})/{re.escape(IMAGE_REPO_PATH)}@sha256:[0-9a-f]{{64}})$", body)
    updater = re.search(rf"(?m)^UPDATE_AGENT_IMAGE_REF=((?:{_DOMAIN_PATTERN})/{re.escape(IMAGE_REPO_PATH)}@sha256:[0-9a-f]{{64}})$", body)
    if not (VERSION_RE.fullmatch(tag) and source and app and updater):
        return None
    if not (SHA_RE.fullmatch(source.group(1)) and DIGEST_RE.fullmatch(app.group(1)) and DIGEST_RE.fullmatch(updater.group(1))):
        return None
    # 下游（.env / compose / update-q4.sh）只接受规范名，故此处统一归一化，摘要保持不变。
    return {"tag":tag,"sourceSha":source.group(1),
            "appImageRef":canonical_ref(app.group(1)),"updaterImageRef":canonical_ref(updater.group(1)),
            "url":str(item.get("html_url") or ""),"name":str(item.get("name") or tag),"publishedAt":str(item.get("published_at") or "")}

def previous_release(current_tag: str) -> dict[str, Any] | None:
    """Find the release immediately older than current_tag among validated releases."""
    items = request_json_list(f"https://api.github.com/repos/{REPOSITORY}/releases?per_page=30")
    releases = [r for item in items if isinstance(item, dict) and (r := release_from_item(item)) is not None]
    releases.sort(key=lambda r: r["publishedAt"], reverse=True)
    for index, release in enumerate(releases):
        if release["tag"] == current_tag:
            return releases[index + 1] if index + 1 < len(releases) else None
    return None

def latest_release() -> dict[str, Any]:
    item = request_json(f"https://api.github.com/repos/{REPOSITORY}/releases/latest")
    tag, body = str(item.get("tag_name") or ""), str(item.get("body") or "")
    tick = r"[\x60]"
    source = re.search(r"Source SHA:\s*" + tick + r"([0-9a-f]{40})" + tick, body)
    app = re.search(rf"(?m)^IMAGE_REF=((?:{_DOMAIN_PATTERN})/{re.escape(IMAGE_REPO_PATH)}@sha256:[0-9a-f]{{64}})$", body)
    updater = re.search(rf"(?m)^UPDATE_AGENT_IMAGE_REF=((?:{_DOMAIN_PATTERN})/{re.escape(IMAGE_REPO_PATH)}@sha256:[0-9a-f]{{64}})$", body)
    if not VERSION_RE.fullmatch(tag) or not source or not app or not updater:
        raise RuntimeError("最新正式发布缺少合规版本号、源代码 SHA 或不可变镜像摘要，拒绝自动部署")
    if not SHA_RE.fullmatch(source.group(1)) or not DIGEST_RE.fullmatch(app.group(1)) or not DIGEST_RE.fullmatch(updater.group(1)):
        raise RuntimeError("正式发布的 SHA 或镜像摘要校验失败")
    # 域名白名单与仓库归属已由 DIGEST_RE 完整覆盖（含固定仓库路径与完整摘要），
    # 不再使用 startswith：前缀匹配对形似域名不设防。
    # 下游（.env / compose / update-q4.sh）只接受规范名，故此处统一归一化，摘要保持不变。
    return {"tag":tag,"sourceSha":source.group(1),
            "appImageRef":canonical_ref(app.group(1)),"updaterImageRef":canonical_ref(updater.group(1)),
            "url":str(item.get("html_url") or ""),"name":str(item.get("name") or tag),"publishedAt":str(item.get("published_at") or "")}

def build_status(current_sha: str, current_version: str, current_image: str) -> dict[str, Any]:
    release = latest_release()
    available = current_sha != release["sourceSha"] if SHA_RE.fullmatch(current_sha) else current_version != release["tag"]
    displayed_current_version = release["tag"] if not available else (current_version or current_image or "未知版本")
    commits = [{"sha":release["sourceSha"],"shortSha":release["sourceSha"][:10],
                "subject":release["name"],"committedAt":release["publishedAt"],"version":release["tag"]}] if available else []
    return {
        "phase":"idle","progress":0,"running":False,"message":"已检查 GitHub 正式发布",
        "currentSha":current_sha,"latestSha":release["sourceSha"],"targetSha":release["sourceSha"],
        "currentImageRef":current_image,"latestImageRef":release["appImageRef"],
        "latestUpdaterImageRef":release["updaterImageRef"],"latestReleaseUrl":release["url"],
        "latestReleaseTag":release["tag"],"updateAvailable":available,
        "currentCommit":{"sha":current_sha,"shortSha":current_sha[:10],"subject":"当前运行版本","committedAt":"","version":displayed_current_version},
        "latestCommit":{"sha":release["sourceSha"],"shortSha":release["sourceSha"][:10],"subject":release["name"],"committedAt":release["publishedAt"],"version":release["tag"]},
        "changes":commits,"changedFiles":[],"changedFileCount":0,"updateLevel":"feature" if available else "patch",
        "updateLevelLabel":"功能版本" if available else "小版本","hasMigration":False,"impactedModules":[],
        "classificationReasons":["以已验证的正式发布为更新来源"],
        "lastCheckAt":now(),"lastCheckError":"","lastAutoError":"",
        "settings":{"enabled":True,"mode":"auto_update","checkIntervalMinutes":60,"autoUpdateHour":3,
                    "autoUpdateWindowMinutes":60,"autoInstallLevel":"patch","branch":"main","remote":"origin"},
        "updateAgentAvailable":True,"updateAgentError":"",
    }

def display_current_version(status: dict[str, Any], current_sha: str, runtime_version: str) -> str:
    """Prefer the validated release tag when a digest-only runtime reports a SHA."""
    latest = status.get("latestCommit") if isinstance(status.get("latestCommit"), dict) else {}
    latest_sha = str(latest.get("sha") or "")
    latest_version = str(latest.get("version") or "")
    if current_sha and current_sha == latest_sha and VERSION_RE.fullmatch(latest_version):
        return latest_version
    return runtime_version or str((status.get("currentCommit") or {}).get("version") or "未知版本")

def registry_login() -> None:
    username, password = (os.environ.get("GHCR_USERNAME") or "").strip(), (os.environ.get("GHCR_TOKEN") or "").strip()
    if not username or not password: return
    result = subprocess.run(["docker","login","ghcr.io","--username",username,"--password-stdin"],input=password,text=True,
                            stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=30,check=False)
    if result.returncode: raise RuntimeError("GHCR 登录失败，请检查 GHCR_USERNAME / GHCR_TOKEN")

def _digest_of(ref: str) -> str:
    """取 @sha256:... 摘要段；调用前必须已通过 DIGEST_RE 校验。"""
    return ref.rsplit("@", 1)[1]

def canonical_ref(ref: str) -> str:
    """把白名单域名归一化为官方 ghcr.io 引用，摘要保持不变。

    镜像源选择只发生在更新器内部：下游 update-q4.sh 与 .env 仍然只看到
    `ghcr.io/...@sha256:<digest>`，其「只接受 ghcr.io」的安全校验不被放宽。
    """
    if not isinstance(ref, str) or not DIGEST_RE.fullmatch(ref):
        raise RuntimeError(f"镜像引用不在白名单内或摘要格式非法：{ref!r}")
    if not re.fullmatch(_MANIFEST_RE, _digest_of(ref)):
        raise RuntimeError("镜像摘要必须是 sha256:64 位十六进制值")
    return f"{CANONICAL_REGISTRY}/{IMAGE_REPO_PATH}@{_digest_of(ref)}"

def _docker(*args: str, timeout: int = 60) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["docker", *args], text=True, stdout=subprocess.PIPE,
                          stderr=subprocess.STDOUT, timeout=timeout, check=False)

def image_digests(ref: str) -> tuple[str, ...]:
    """读取本地镜像记录的 RepoDigests；镜像不存在时返回空元组。"""
    result = _docker("image", "inspect", "--format", "{{json .RepoDigests}}", ref)
    if result.returncode:
        return ()
    try:
        value = json.loads((result.stdout or "").strip() or "[]")
    except ValueError:
        return ()
    return tuple(item for item in value if isinstance(item, str)) if isinstance(value, list) else ()

def digest_present(ref: str) -> bool:
    """本地是否已有该摘要对应的镜像内容（按 RepoDigests 严格比对，不看 tag）。"""
    want = "@" + _digest_of(ref)
    return any(item.endswith(want) for item in image_digests(ref))

def warm_image(ref: str) -> str:
    """按白名单顺序拉取不可变摘要镜像，校验 RepoDigests 后确保规范名可用。

    安全要点：
    1. 只接受白名单域名 + 固定仓库路径 + 完整 sha256，无通配；
    2. 每个源拉取后必须校验 RepoDigests 含目标摘要，不匹配即弃用该源；
    3. 镜像层按 digest 存于本地 content store（与仓库域名无关），因此随后对
       ghcr.io 规范名的拉取只需获取 manifest，update-q4.sh 原有的 ghcr.io
       拉取步骤可在秒级完成，无需放宽其入参校验。
    """
    target = canonical_ref(ref)
    digest = _digest_of(target)
    if digest_present(target):
        log(f"目标镜像已在本机且摘要匹配：{digest[:19]}…")
        return target
    timeout = int(os.environ.get("COFFEEBEAR_PULL_TIMEOUT", "900") or 900)
    errors: list[str] = []
    for domain in MIRROR_DOMAINS:
        candidate = f"{domain}/{IMAGE_REPO_PATH}@{digest}"
        write_status(phase="installing", progress=35, running=True, message=f"从 {domain} 拉取目标镜像")
        log(f"尝试镜像源 {domain}")
        try:
            result = _docker("pull", candidate, timeout=timeout)
        except subprocess.TimeoutExpired:
            errors.append(f"{domain}: 超过 {timeout}s 未完成")
            log(f"{domain} 拉取超时，切换下一个镜像源")
            continue
        if result.returncode:
            tail = (result.stdout or "").strip().splitlines()
            errors.append(f"{domain}: {(tail[-1] if tail else '未知错误')[:200]}")
            log(f"{domain} 拉取失败，切换下一个镜像源")
            continue
        if not digest_present(candidate):
            errors.append(f"{domain}: RepoDigests 未包含期望摘要，已弃用该源")
            log(f"{domain} 返回内容摘要不匹配，已弃用该源")
            continue
        write_status(phase="installing", progress=45, running=True,
                     message=f"镜像已通过摘要校验（来源 {domain}）")
        log(f"镜像摘要校验通过（来源 {domain}）")
        break
    if not digest_present(target):
        # 层已在本机时此步只需 manifest，通常数秒；失败不致命，
        # update-q4.sh 会退回自行拉取（同样只需 manifest）。
        probe_timeout = int(os.environ.get("COFFEEBEAR_CANONICAL_PULL_TIMEOUT", "90") or 90)
        try:
            result = _docker("pull", target, timeout=probe_timeout)
            if result.returncode:
                tail = (result.stdout or "").strip().splitlines()
                log(f"注册规范名 manifest 失败（不影响后续）：{(tail[-1] if tail else '')[:200]}")
            else:
                log("已注册 ghcr.io 规范名，后续拉取将命中本地层")
        except subprocess.TimeoutExpired:
            log(f"注册规范名 manifest 超过 {probe_timeout}s，跳过")
    if not any(digest_present(f"{domain}/{IMAGE_REPO_PATH}@{digest}") for domain in ALLOWED_DOMAINS):
        raise RuntimeError("所有镜像源均未取得可信镜像，未更改任何运行配置：" + "；".join(errors)[:1200])
    return target

def fetch_release_script(tag: str, filename: str) -> str:
    """Get a release-pinned deploy script via two independent GitHub endpoints."""
    quoted_tag = urllib.parse.quote(tag, safe="")
    raw_url = f"https://raw.githubusercontent.com/{REPOSITORY}/{quoted_tag}/deploy/{filename}"
    try:
        return request_bytes(raw_url, timeout=45, limit=512_000, headers={"User-Agent":"CoffeeBear-NAS-Updater"}).decode("utf-8")
    except Exception as raw_error:
        # The GitHub Contents API uses a different network route from the raw
        # host. It is a safe fallback because the tag is validated by the caller
        # and the returned script is checked again before execution.
        api_url = f"https://api.github.com/repos/{REPOSITORY}/contents/deploy/{filename}?ref={quoted_tag}"
        try:
            item = request_json(api_url, timeout=45)
            if item.get("encoding") != "base64" or not isinstance(item.get("content"), str):
                raise RuntimeError("GitHub Contents API 未返回 base64 脚本内容")
            return base64.b64decode(item["content"], validate=True).decode("utf-8")
        except Exception as api_error:
            raise RuntimeError(f"无法获取正式脚本 {filename}：Raw 失败（{raw_error}）；GitHub API 备用通道失败（{api_error}）") from api_error

def run_update(release: dict[str, Any], actor: str) -> None:
    try:
        script_path = STATE_DIR / f"update-q4-{release['tag']}.sh"
        script = fetch_release_script(release["tag"], "update-q4.sh")
        if "CoffeeBear" not in script or "UPDATE_AGENT_IMAGE" not in script:
            raise RuntimeError("正式版本中的 NAS 更新脚本未通过校验")
        script_path.write_text(script, encoding="utf-8")
        os.chmod(script_path, 0o700)
        write_status(phase="preflight",progress=5,running=True,message=f"准备安装正式版本 {release['tag']}",
                     targetSha=release["sourceSha"],latestSha=release["sourceSha"],latestReleaseTag=release["tag"],
                     startedAt=now(),startedBy=actor,lastCheckError="",error="")
        registry_login()
        # 先从镜像站按原摘要把层拉到本地，再由 update-q4.sh 自行拉 ghcr.io 规范名（只取 manifest）。
        app_ref = warm_image(release["appImageRef"])
        updater_ref = warm_image(release["updaterImageRef"])
        command = ["docker","compose","--project-directory",str(WORKSPACE),"--env-file",str(ENV_FILE),"-f",str(COMPOSE_FILE),
                   "--profile","ops","run","--rm",
                   # update-q4.sh 已有的开关：目标镜像已在本机且可 inspect 时跳过重复 pull。
                   "-e","COFFEEBEAR_IMAGE_PREVERIFIED=1",
                   "update-job","/app/update-job.sh",str(script_path),
                   app_ref,updater_ref,release["tag"],release["sourceSha"],actor[:80]]
        log("启动隔离的正式更新任务容器")
        process = subprocess.Popen(command,cwd=str(WORKSPACE),env=os.environ.copy(),text=True,
                                   stdout=subprocess.PIPE,stderr=subprocess.STDOUT,bufsize=1)
        if process.stdout:
            for line in process.stdout:
                line=line.rstrip()
                if not line: continue
                log(line[:1000])
                if "[1/7]" in line: write_status(phase="backup",progress=15,message="备份数据库")
                elif "[2/7]" in line: write_status(phase="backup",progress=25,message="备份业务文件")
                elif "[3/7]" in line: write_status(phase="installing",progress=40,message="下载正式镜像")
                elif "[4/7]" in line: write_status(phase="migrating",progress=60,message="执行数据库迁移")
                elif "[5/7]" in line: write_status(phase="restarting",progress=75,message="启动新版 API")
                elif "[6/7]" in line or "[7/7]" in line: write_status(phase="healthcheck",progress=90,message="验证服务并恢复后台任务")
        rc=process.wait()
        status=read_status()
        if rc != 0 and status.get("phase") != "failed":
            write_status(phase="failed",progress=100,running=False,message="正式更新失败，请查看日志",
                         error=f"更新任务退出码 {rc}",finishedAt=now(),lastInstallResult="failed")
            raise RuntimeError(f"NAS 更新任务失败（退出码 {rc}）")
        if rc == 0 and status.get("phase") != "success":
            write_status(phase="success",progress=100,running=False,message=f"正式版本 {release['tag']} 更新完成",
                         currentSha=release["sourceSha"],latestSha=release["sourceSha"],targetSha=release["sourceSha"],
                         currentImageRef=app_ref,updateAvailable=False,latestReleaseTag=release["tag"],
                         finishedAt=now(),lastInstallResult="success",error="")
    except Exception as exc:
        log(f"更新失败：{str(exc)[:1000]}")
        status=read_status()
        if status.get("phase") not in {"success","failed"}:
            write_status(phase="failed",progress=100,running=False,message="正式更新失败",error=str(exc)[:1500],
                         finishedAt=now(),lastInstallResult="failed")

def start_update(release: dict[str, Any], actor: str) -> None:
    with LOCK:
        status=read_status()
        if status.get("running") or status.get("phase") in ACTIVE:
            raise RuntimeError("已有正式更新任务正在执行")
        write_status(phase="queued",progress=1,running=True,message="更新任务已排队",startedAt=now(),
                     startedBy=actor,targetSha=release["sourceSha"],latestSha=release["sourceSha"],
                     latestReleaseTag=release["tag"],lastCheckError="",error="")
    threading.Thread(target=run_update,args=(release,actor),daemon=True).start()

def rollback_target(status: dict[str, Any]) -> dict[str, Any]:
    """Resolve the version currently running so we can find its immediate predecessor."""
    current_tag = str(status.get("latestReleaseTag") or "")
    version = str((status.get("currentCommit") or {}).get("version") or "")
    if not VERSION_RE.fullmatch(current_tag) and VERSION_RE.fullmatch(version):
        current_tag = version
    if not VERSION_RE.fullmatch(current_tag):
        raise RuntimeError("无法确定当前运行的正式版本，回退已取消")
    target = previous_release(current_tag)
    if target is None:
        raise RuntimeError("当前已是仓库中最早的正式版本，没有可回退的上一版")
    return target

def run_rollback(target: dict[str, Any], actor: str) -> None:
    try:
        # Pull the rollback script from the latest validated release: the
        # rollback capability itself may not exist in the currently running
        # (older) version, but it is guaranteed to be in the newest release.
        script_tag = latest_release()["tag"]
        script = fetch_release_script(script_tag, "rollback-q4.sh")
        if "CoffeeBear" not in script or "APP_IMAGE" not in script or "rollback" not in script:
            raise RuntimeError("当前版本中的回退脚本未通过校验")
        script_path = STATE_DIR / f"rollback-q4-{script_tag}.sh"
        script_path.write_text(script, encoding="utf-8")
        os.chmod(script_path, 0o700)
        write_status(phase="installing",progress=30,running=True,message=f"回退到正式版本 {target['tag']}",
                     targetSha=target["sourceSha"],startedAt=now(),startedBy=actor,lastCheckError="",error="")
        registry_login()
        # 回退镜像可能已不在本地，同样按多源回退预热，避免回退路径受 ghcr.io 单点影响。
        rollback_ref = warm_image(target["appImageRef"])
        command = ["docker","compose","--project-directory",str(WORKSPACE),"--env-file",str(ENV_FILE),"-f",str(COMPOSE_FILE),
                   "--profile","ops","run","--rm",
                   "-e","COFFEEBEAR_IMAGE_PREVERIFIED=1",
                   "update-job","/app/update-job.sh",str(script_path),
                   rollback_ref,"",target["tag"],target["sourceSha"],actor[:80]]
        log("启动隔离回退任务容器")
        process = subprocess.Popen(command,cwd=str(WORKSPACE),env=os.environ.copy(),text=True,
                                   stdout=subprocess.PIPE,stderr=subprocess.STDOUT,bufsize=1)
        if process.stdout:
            for line in process.stdout:
                line=line.rstrip()
                if not line: continue
                log(line[:1000])
                if "[rollback 1/5]" in line: write_status(phase="backup",progress=15,message="准备回退镜像")
                elif "[rollback 3/5]" in line: write_status(phase="restarting",progress=70,message="启动回退版本")
                elif "[rollback 4/5]" in line: write_status(phase="healthcheck",progress=90,message="验证回退版本")
        rc=process.wait()
        if rc != 0:
            write_status(phase="failed",progress=100,running=False,message="回退失败，已尝试恢复原版本",
                         error=f"回退任务退出码 {rc}",finishedAt=now(),lastInstallResult="failed")
            raise RuntimeError(f"NAS 回退任务失败（退出码 {rc}）")
        write_status(phase="success",progress=100,running=False,message=f"已回退到正式版本 {target['tag']}",
                     currentSha=target["sourceSha"],latestSha=target["sourceSha"],targetSha=target["sourceSha"],
                     updateAvailable=False,latestReleaseTag=target["tag"],finishedAt=now(),
                     lastInstallResult="success",lastAction="rollback",error="")
    except Exception as exc:
        log(f"回退失败：{str(exc)[:1000]}")
        status=read_status()
        if status.get("phase") not in {"success","failed"}:
            write_status(phase="failed",progress=100,running=False,message="回退失败",error=str(exc)[:1500],
                         finishedAt=now(),lastInstallResult="failed")

def start_rollback(actor: str) -> dict[str, Any]:
    with LOCK:
        status=read_status()
        if status.get("running") or status.get("phase") in ACTIVE:
            raise RuntimeError("已有更新或回退任务正在执行")
        target = rollback_target(status)
        write_status(phase="queued",progress=1,running=True,message="回退任务已排队",startedAt=now(),
                     startedBy=actor,targetSha=target["sourceSha"],lastAction="rollback",lastCheckError="",error="")
    threading.Thread(target=run_rollback,args=(target,actor),daemon=True).start()
    return target

def automatic_update_loop() -> None:
    """白天只提示；仅在北京时间每日凌晨维护窗口内自动安装，不再有 1 小时冷静期。"""
    while True:
        try:
            status = read_status()
            settings = status.get("settings") if isinstance(status.get("settings"), dict) else {}
            if settings.get("enabled", True) and settings.get("mode") == "auto_update" and not status.get("running"):
                current_sha = str(status.get("currentSha") or "")
                current_version = str(status.get("currentCommit", {}).get("version") or "")
                current_image = str(status.get("currentImageRef") or "")
                checked = build_status(current_sha, current_version, current_image)
                if checked.get("updateAvailable"):
                    if not status.get("autoUpdateDetectedAt"):
                        write_status(**checked, autoUpdateDetectedAt=now(), autoUpdateEligibleAt=0)
                        log("检测到新正式版本：白天不自动安装，将在凌晨维护窗口自动更新，或由管理员手动点击安装")
                    elif (
                        in_auto_update_window()
                        and status.get("lastInstallResult") != "failed"
                    ):
                        log("进入凌晨维护窗口，开始自动安装新正式版本")
                        start_update(latest_release(), "auto-update")
                else:
                    if status.get("autoUpdateDetectedAt"):
                        write_status(autoUpdateDetectedAt="", autoUpdateEligibleAt=0)
        except Exception as exc:
            write_status(lastAutoError=str(exc)[:1000])
        time.sleep(300)

class Handler(BaseHTTPRequestHandler):
    server_version="CoffeeBearUpdater/1.0"
    def log_message(self,fmt: str,*args: Any)->None: return
    def send_json(self,code: int,payload: dict[str,Any])->None:
        body=json.dumps(payload,ensure_ascii=False).encode("utf-8")
        self.send_response(code); self.send_header("Content-Type","application/json; charset=utf-8")
        self.send_header("Content-Length",str(len(body))); self.send_header("Cache-Control","no-store"); self.end_headers(); self.wfile.write(body)
    def authorized(self)->bool:
        return secrets.compare_digest(self.headers.get("Authorization",""),"Bearer "+auth_token())
    def body(self)->dict[str,Any]:
        size=int(self.headers.get("Content-Length","0"))
        if size<0 or size>16384: raise ValueError("请求体大小无效")
        if not size: return {}
        value=json.loads(self.rfile.read(size).decode("utf-8"))
        if not isinstance(value,dict): raise ValueError("请求参数必须是对象")
        return value
    def do_GET(self)->None:
        parsed=urllib.parse.urlsplit(self.path)
        if parsed.path=="/health": self.send_json(200,{"ok":True,"service":"coffeebear-updater"}); return
        if not self.authorized(): self.send_json(401,{"detail":"未授权"}); return
        if parsed.path!="/status": self.send_json(404,{"detail":"未找到"}); return
        query=urllib.parse.parse_qs(parsed.query); current_sha=(query.get("currentSha") or [""])[0]
        current_version=(query.get("currentVersion") or [""])[0]; current_image=(query.get("currentImageRef") or [""])[0]
        status=read_status()
        try:
            history_lines = HISTORY_FILE.read_text(encoding="utf-8").splitlines()[-50:]
            status["history"] = [json.loads(line) for line in history_lines if line.strip()]
        except Exception:
            status.setdefault("history", [])
        status.setdefault("phase","idle"); status.setdefault("progress",0); status.setdefault("running",False)
        status.setdefault("message","更新器已就绪，请检查正式版本"); status.setdefault("logs",[]); status.setdefault("history",[])
        status.setdefault("settings",{"enabled":True,"mode":"auto_update","checkIntervalMinutes":60,"autoUpdateHour":3,
                                     "autoUpdateWindowMinutes":60,"autoInstallLevel":"patch","branch":"main","remote":"origin"})
        if current_sha: status["currentSha"]=current_sha
        if current_sha or current_version:
            status["currentCommit"]={"sha":current_sha,"shortSha":current_sha[:10],"subject":"当前运行版本","committedAt":"","version":display_current_version(status, current_sha, current_version)}
        if current_image: status["currentImageRef"]=current_image
        status["updateAgentAvailable"]=True; status["updateAgentError"]=""
        self.send_json(200,status)
    def do_POST(self)->None:
        parsed=urllib.parse.urlsplit(self.path)
        if not self.authorized(): self.send_json(401,{"detail":"未授权"}); return
        try:
            payload=self.body(); current_sha=str(payload.get("currentSha") or "")
            current_version=str(payload.get("currentVersion") or ""); current_image=str(payload.get("currentImageRef") or "")
            actor=str(payload.get("actor") or "admin")[:80]
            if current_sha and not SHA_RE.fullmatch(current_sha): raise ValueError("当前运行版本 SHA 格式无效")
            if parsed.path=="/check":
                checked=build_status(current_sha,current_version,current_image); old=read_status()
                for key in ("autoUpdateDetectedAt","autoUpdateEligibleAt","lastInstallResult","lastAutoError"):
                    if key in old: checked[key]=old[key]
                if old.get("running"):
                    for key in ("phase","progress","running","message","logs","startedAt","startedBy","targetSha"):
                        if key in old: checked[key]=old[key]
                write_status(**checked)
                self.send_json(200,{**read_status(),"started":False}); return
            if parsed.path=="/apply":
                release=latest_release()
                if (current_sha and current_sha==release["sourceSha"]) or (not current_sha and current_version==release["tag"]):
                    self.send_json(200,{**read_status(),"started":False,"reason":"already_latest","message":"当前已经是最新正式版本"}); return
                start_update(release,actor)
                self.send_json(202,{**read_status(),"started":True}); return
            if parsed.path=="/rollback":
                target=start_rollback(actor)
                self.send_json(202,{**read_status(),"started":True,"targetTag":target["tag"]}); return
            self.send_json(404,{"detail":"未找到"})
        except (ValueError,RuntimeError,urllib.error.URLError,TimeoutError) as exc:
            self.send_json(409,{"detail":str(exc)[:1500]})
        except Exception as exc:
            self.send_json(500,{"detail":f"更新器内部错误：{str(exc)[:1000]}"})

def main()->None:
    ensure_state()
    threading.Thread(target=automatic_update_loop, daemon=True).start()
    ThreadingHTTPServer((os.environ.get("UPDATE_AGENT_BIND","0.0.0.0"),int(os.environ.get("UPDATE_AGENT_PORT","8765"))),Handler).serve_forever()
if __name__=="__main__": main()
