# CoffeeBear — Google Secret Manager / Cloud Run

本目录把 CoffeeBear 的“运行配置 / 密钥”从长期依赖 `.env` 的方式，升级为可直接接入 Google Cloud Secret Manager 的生产方案。

## 设计原则

- GitHub：只保存代码、`.env.example`、部署脚本和 Secret 名称映射；绝不保存真实 Secret 值。
- M1 当前生产：继续使用本机 `.env`，不改变现有运行方式。
- Cloud Run 未来生产：Secret Manager 把 Secret 注入为与现有应用相同名称的环境变量，因此业务代码无需引入 Google SDK，也无需改读取逻辑。
- 普通参数继续使用 Cloud Run environment variables；密码、Token、API Key、数据库连接串使用 Secret Manager。
- Secret Manager 与 Q4/R2 备份职责不同：Secret Manager 是“运行时凭据源”，Q4/R2 是“灾难恢复副本”。

CoffeeBear 当前 `backend/app/config.py` 已经通过环境变量 / `.env` 读取配置，所以 Cloud Run 注入 Secret 后可以直接工作。

## 文件

- `secret-map.env`：环境变量名 -> Google Secret Manager Secret 名称。只包含名称，不包含值。
- `bootstrap-secrets.sh`：从本地 `runtime.env` 读取非空 Secret，一次性创建/追加 Secret 版本，并为 Cloud Run 运行账号授予每个 Secret 的最小读取权限。
- `deploy.sh`：部署 Cloud Run，自动把已存在的 Secret 映射成同名环境变量。
- `runtime.env`：你实际运行时创建的本地文件，已经被 `.gitignore` 忽略，不得提交 GitHub。

## 一次性准备

需要本机安装并登录 Google Cloud CLI：

```bash
gcloud auth login
gcloud auth application-default login
```

创建 `deploy/cloudrun/runtime.env`：

```bash
GCP_PROJECT=your-project-id
GCP_REGION=asia-east1
CLOUD_RUN_SERVICE=coffeebear
IMAGE_REF=ghcr.io/jinfenghua1990/coffeebear:stable

# 可选；不填时脚本会使用 coffeebear-runtime@<project>.iam.gserviceaccount.com
RUNTIME_SERVICE_ACCOUNT=

# 下面放需要迁入 Secret Manager 的真实值；只在本机存在。
APP_SECRET_KEY=
ADMIN_PASSWORD=
DATABASE_URL=
MIGRATION_DATABASE_URL=
SMTP_PASSWORD=
R2_BACKUP_ACCESS_KEY=
R2_BACKUP_SECRET_KEY=
```

也可以继续补充 `secret-map.env` 中列出的其他集成 Secret。

然后执行：

```bash
bash deploy/cloudrun/bootstrap-secrets.sh
```

脚本会：

1. 启用 Secret Manager / Cloud Run API；
2. 创建 CoffeeBear 专用运行 Service Account（如不存在）；
3. 对 `runtime.env` 里非空的 Secret 创建或追加 Secret version；
4. 只给该运行账号授予对应 Secret 的 `roles/secretmanager.secretAccessor` 权限；
5. 不把 Secret 值写回 GitHub，也不会在终端打印真实值。

## 部署 Cloud Run

确认 `IMAGE_REF` 可被 Cloud Run 拉取后执行：

```bash
bash deploy/cloudrun/deploy.sh
```

默认部署为“需要身份认证”的内部服务。若未来明确需要公网匿名访问，再在 `runtime.env` 设置：

```bash
ALLOW_UNAUTHENTICATED=1
```

Cloud Run 会把 Secret Manager 中存在的 Secret 自动注入成：

```text
APP_SECRET_KEY
DATABASE_URL
SMTP_PASSWORD
...
```

应用继续使用原有 `os.environ` / Pydantic Settings 读取，不需要感知 Google Secret Manager。

## GHCR 注意事项

Cloud Run 可以直接使用公开 GHCR 镜像；私有 GHCR 镜像需要通过 Artifact Registry remote repository 或把正式镜像镜像到 Artifact Registry。当前 CoffeeBear 仍以 GitHub/GHCR 为正式软件源，因此 `IMAGE_REF` 保留为可配置项，不强制改变现有发布链。

## Secret 轮换

Secret Manager 按“有效 Secret version”计费。新版本验证完成后，应按你的保留策略销毁不再需要的旧版本；仅 Disabled 的版本仍属于有效版本。

不要在代码、Issue、PR、GitHub Actions 日志或截图里粘贴 Secret 值。
