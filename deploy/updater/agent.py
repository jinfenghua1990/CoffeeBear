#!/usr/bin/env python3
"""Restricted internal updater for CoffeeBear's NAS Compose deployment."""
from __future__ import annotations
import json, os, re, secrets, subprocess, threading, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

REPOSITORY = "jinfenghua1990/CoffeeBear"
APP_PREFIX = "ghcr.io/jinfenghua1990/coffeebear@sha256:"
UPDATER_TAG_RE = re.compile(r"^ghcr\.io/jinfenghua1990/coffeebear:updater-v\d{4}\.\d{2}\.\d{2}\.\d{6}$")
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
DIGEST_RE = re.compile(r"^ghcr\.io/jinfenghua1990/coffeebear@sha256:[0-9a-f]{64}$")
VERSION_RE = re.compile(r"^v\d{4}\.\d{2}\.\d{2}\.\d{6}$")
ACTIVE = {"queued", "preflight", "backup", "installing", "migrating", "restarting", "healthcheck"}
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

def request_json(url: str, timeout: int = 15) -> dict[str, Any]:
    req = urllib.request.Request(url, headers={"Accept":"application/vnd.github+json","User-Agent":"CoffeeBear-NAS-Updater","X-GitHub-Api-Version":"2022-11-28"})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        value = json.loads(response.read(2_000_000).decode("utf-8"))
    if not isinstance(value, dict): raise RuntimeError("GitHub 返回了无法识别的响应")
    return value

def latest_release() -> dict[str, Any]:
    item = request_json(f"https://api.github.com/repos/{REPOSITORY}/releases/latest")
    tag, body = str(item.get("tag_name") or ""), str(item.get("body") or "")
    tick = r"[\x60]"
    source = re.search(r"Source SHA:\s*" + tick + r"([0-9a-f]{40})" + tick, body)
    app = re.search(r"IMAGE_REF=(ghcr\.io/jinfenghua1990/coffeebear@sha256:[0-9a-f]{64})", body)
    updater = re.search(r"UPDATE_AGENT_IMAGE_REF=(ghcr\.io/jinfenghua1990/coffeebear:updater-v\d{4}\.\d{2}\.\d{2}\.\d{6})", body)
    if not VERSION_RE.fullmatch(tag) or not source or not app or not updater:
        raise RuntimeError("最新正式发布缺少合规版本号、源代码 SHA 或不可变镜像摘要，拒绝自动部署")
    if not SHA_RE.fullmatch(source.group(1)) or not DIGEST_RE.fullmatch(app.group(1)) or not UPDATER_TAG_RE.fullmatch(updater.group(1)):
        raise RuntimeError("正式发布的 SHA 或镜像摘要校验失败")
    if not app.group(1).startswith(APP_PREFIX):
        raise RuntimeError("正式发布镜像不属于受控 CoffeeBear 仓库")
    return {"tag":tag,"sourceSha":source.group(1),"appImageRef":app.group(1),"updaterImageRef":updater.group(1),
            "url":str(item.get("html_url") or ""),"name":str(item.get("name") or tag),"publishedAt":str(item.get("published_at") or "")}

def build_status(current_sha: str, current_version: str, current_image: str) -> dict[str, Any]:
    release = latest_release()
    available = current_sha != release["sourceSha"] if SHA_RE.fullmatch(current_sha) else current_version != release["tag"]
    commits = [{"sha":release["sourceSha"],"shortSha":release["sourceSha"][:10],
                "subject":release["name"],"committedAt":release["publishedAt"],"version":release["tag"]}] if available else []
    return {
        "phase":"idle","progress":0,"running":False,"message":"已检查 GitHub 正式发布",
        "currentSha":current_sha,"latestSha":release["sourceSha"],"targetSha":release["sourceSha"],
        "currentImageRef":current_image,"latestImageRef":release["appImageRef"],
        "latestUpdaterImageRef":release["updaterImageRef"],"latestReleaseUrl":release["url"],
        "latestReleaseTag":release["tag"],"updateAvailable":available,
        "currentCommit":{"sha":current_sha,"shortSha":current_sha[:10],"subject":"当前运行版本","committedAt":"","version":current_version or current_image or "未知版本"},
        "latestCommit":{"sha":release["sourceSha"],"shortSha":release["sourceSha"][:10],"subject":release["name"],"committedAt":release["publishedAt"],"version":release["tag"]},
        "changes":commits,"changedFiles":[],"changedFileCount":0,"updateLevel":"feature" if available else "patch",
        "updateLevelLabel":"功能版本" if available else "小版本","hasMigration":False,"impactedModules":[],
        "classificationReasons":["以已验证的正式发布为更新来源"],
        "lastCheckAt":now(),"lastCheckError":"","lastAutoError":"",
        "settings":{"enabled":False,"mode":"manual","checkIntervalMinutes":60,"autoUpdateHour":3,
                    "autoUpdateWindowMinutes":60,"autoInstallLevel":"patch","branch":"main","remote":"origin"},
        "updateAgentAvailable":True,"updateAgentError":"",
    }

def registry_login() -> None:
    username, password = (os.environ.get("GHCR_USERNAME") or "").strip(), (os.environ.get("GHCR_TOKEN") or "").strip()
    if not username or not password: return
    result = subprocess.run(["docker","login","ghcr.io","--username",username,"--password-stdin"],input=password,text=True,
                            stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=30,check=False)
    if result.returncode: raise RuntimeError("GHCR 登录失败，请检查 GHCR_USERNAME / GHCR_TOKEN")

def run_update(release: dict[str, Any], actor: str) -> None:
    try:
        script_path = STATE_DIR / f"update-q4-{release['tag']}.sh"
        url = f"https://raw.githubusercontent.com/{REPOSITORY}/{release['tag']}/deploy/update-q4.sh"
        req = urllib.request.Request(url, headers={"User-Agent":"CoffeeBear-NAS-Updater"})
        with urllib.request.urlopen(req, timeout=20) as response: script = response.read(512_000).decode("utf-8")
        if "CoffeeBear" not in script or "UPDATE_AGENT_IMAGE" not in script:
            raise RuntimeError("正式版本中的 NAS 更新脚本未通过校验")
        script_path.write_text(script, encoding="utf-8")
        os.chmod(script_path, 0o700)
        write_status(phase="preflight",progress=5,running=True,message=f"准备安装正式版本 {release['tag']}",
                     targetSha=release["sourceSha"],latestSha=release["sourceSha"],latestReleaseTag=release["tag"],
                     startedAt=now(),startedBy=actor,lastCheckError="",error="")
        registry_login()
        command = ["docker","compose","--project-directory",str(WORKSPACE),"--env-file",str(ENV_FILE),"-f",str(COMPOSE_FILE),
                   "--profile","ops","run","--rm","update-job","/app/update-job.sh",str(script_path),
                   release["appImageRef"],release["updaterImageRef"],release["tag"],release["sourceSha"],actor[:80]]
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
                         updateAvailable=False,latestReleaseTag=release["tag"],finishedAt=now(),lastInstallResult="success",error="")
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
        status.setdefault("settings",{"enabled":False,"mode":"manual","checkIntervalMinutes":60,"autoUpdateHour":3,
                                     "autoUpdateWindowMinutes":60,"autoInstallLevel":"patch","branch":"main","remote":"origin"})
        if current_sha: status["currentSha"]=current_sha
        if current_version:
            status["currentCommit"]={"sha":current_sha,"shortSha":current_sha[:10],"subject":"当前运行版本","committedAt":"","version":current_version}
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
            self.send_json(404,{"detail":"未找到"})
        except (ValueError,RuntimeError,urllib.error.URLError,TimeoutError) as exc:
            self.send_json(409,{"detail":str(exc)[:1500]})
        except Exception as exc:
            self.send_json(500,{"detail":f"更新器内部错误：{str(exc)[:1000]}"})

def main()->None:
    ensure_state()
    ThreadingHTTPServer((os.environ.get("UPDATE_AGENT_BIND","0.0.0.0"),int(os.environ.get("UPDATE_AGENT_PORT","8765"))),Handler).serve_forever()
if __name__=="__main__": main()
