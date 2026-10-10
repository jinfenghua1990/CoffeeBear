# Mac 本地运行

当前阶段以 Mac 原生运行作为主要开发与验收环境，NAS / 极空间部署暂缓。

## 运行原则

- 代码主线：`main`
- 部署方式：`native`
- 默认端口：`8001`
- PostgreSQL / Redis：Mac 本机服务
- 数据、备份、日志：尽量放在仓库目录之外
- 系统版本中心：显示当前 Git SHA、环境、数据库 Revision
- NAS / GHCR / Compose 配置保留，但当前不作为日常运行入口

## 首次配置

1. 复制 `deploy/mac/.env.example` 到项目根目录 `.env`。
2. 修改数据库密码、管理员密码和持久化目录。
3. 确保 PostgreSQL、Redis、Python 虚拟环境和前端依赖已就绪。
4. 使用现有 LaunchAgent / `scripts/native-start.sh` 启动。

建议的运行身份：

```text
APP_ENV=development
RELEASE_CHANNEL=local
DEPLOYMENT_MODE=native
SYSTEM_UPDATE_BRANCH=main
```

如果 Mac 当前承担正式业务数据，也可以在真实 `.env` 中继续使用：

```text
APP_ENV=production
RELEASE_CHANNEL=stable
DEPLOYMENT_MODE=native
```

production 必须把 `PERSIST_ROOT / DATA_DIR / BACKUP_DIR / LOG_DIR` 放在 Git 仓库外。旧安装若仍使用项目内 `data/ backups/ logs/`，执行：

```bash
make persistence-migrate
```

脚本会先停止服务并备份，再复制和校验数据、更新 `.env`、重启并做健康检查；旧目录不会自动删除。

物理机器是 Mac 还是 NAS，与逻辑环境是否 production 是两回事，不强制修改现有生产数据环境。

## 旧版系统更新器的一次性手动引导

如果系统更新页面提示运行服务指向旧仓库（例如 `zhejiang`），不要为了通过检查而把 `origin` 改到旧仓库。CoffeeBear 的正确远程仓库是：

```text
https://github.com/jinfenghua1990/CoffeeBear.git
```

旧版更新器可能在联网检查前就拒绝 CoffeeBear 远程地址，因此首次升级需在 Mac 终端手动快进到 CoffeeBear `main`，之后系统更新页面才由新版程序接管。以下命令只更新代码并重启服务，不删除业务数据或文件，也不会自行执行数据库迁移。

先确认仓库路径、远程地址、分支和工作区状态；若工作区有修改、不是 `main`，或远程地址不是 CoffeeBear，请停止，不要继续拉取：

```bash
cd /path/to/CoffeeBear
git remote get-url origin
git status --short --branch
```

确认远程是上面的 CoffeeBear 地址、当前分支为 `main` 且工作区干净后，再运行：

```bash
git pull --ff-only origin main
```

然后用这台 Mac 上 CoffeeBear 实际使用的 LaunchAgent 标签重启服务。例如当前安装使用的标签是 `com.gino.ecommerce-workspace`：

```bash
launchctl kickstart -k "gui/$(id -u)/com.gino.ecommerce-workspace"
curl -fsS http://127.0.0.1:8001/healthz
```

健康检查成功后，重新打开 CoffeeBear 的“系统更新”页面并点击“刷新状态 / 检查更新”。其他 Mac 安装应使用各自的仓库路径、LaunchAgent 标签和端口。

## Codex 开发流程

```text
main
  ↓ CI
Mac 本地拉取 / 更新
  ↓
本地业务验收
```

当前 Mac 更新中心直接跟踪 `main`；NAS 容器发布仍按独立发布门禁执行。

## 安全

- `.env` 不提交 Git。
- PostgreSQL / Redis 不开放公网。
- 开发期不要把 Mac 的 8001 端口直接映射到公网。
- 每次较大结构调整前继续执行数据库 + DATA_DIR 备份。
