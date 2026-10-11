# CoffeeBear 本地 Test 与云部署核对

核对日期：2026-10-11。关联 GitHub Issue #18、#25，以及 PR #24。

## 维护者本轮确认

- 本机 8000 仅作为部署前验证入口；云端直接使用 Google Cloud Run Production，不创建单独云测试环境。
- 8001 保持原样，不修改配置、进程或数据库，不迁移其业务数据。
- 从 GitHub 最新状态推进开发及云环境部署。

## GitHub 和本地事实

- 最新 `origin/main` / 本地 HEAD：`b1b150c850c6075d14c97feafb5a05ffe228d5c0`。
- 当前云架构决策：Google Cloud Run（Docker）+ Supabase PostgreSQL；Backblaze B2 暂不启用。其他长期文档仍有旧方案说明，需要随实际部署更新。
- Google Cloud Production 项目已选定为 `project-2a0763fd-e296-437d-833`（My First Project，账单已启用）；不使用 `alsvid-dev` / `alsvid-prod`。
- Cloud Run 所需 API、Artifact Registry `asia-east1/coffeebear`、部署 Service Account 和 GitHub OIDC 已创建；Cloud Run 服务尚未发布。
- PR #24 未合并，最新 head：`a5e831326a95bb92e5e8812394d291b589b492cc`。该提交 CI run `38109541276` 和 Release Policy run `38109541245` 均成功。
- 对最新 main 与 PR head 执行 `git merge-tree --write-tree` 成功，无当前 Git 文本合并冲突；未执行实际合并。
- 本地已有未跟踪 `docker-compose.override.yml`，用于把 8000 固定为部署前验证入口；旧 Render 草稿不纳入本次部署方案。

## 本地 Test 实施与验证

- `.env` 原配置备份到仓库外 `coffeebear-8000-data/config-backups/`，备份权限 0600。
- 本机验证曾使用 `APP_ENV=staging`、`RELEASE_CHANNEL=candidate`；这些标识不用于 Cloud Run Production。
- 保留现有 Docker 数据卷和附件目录。数据库名称仍为 `coffeebear_prod`，这是历史命名，不代表现在是正式环境。
- Docker Compose 配置验证通过。
- API、worker、beat 已在本机验证；PostgreSQL / Redis 保持原实例。
- `/healthz` 返回 200，本机验证使用独立标识。
- `/api/v1/purchase/orders`、`/api/v1/inventory/stocktakes`、`/api/v1/finance/entries`、`/api/v1/dashboard/inventory` 返回 200。
- `/finance`、`/supply-chain` 静态页面返回 200。
- 数据库 `SELECT 1` 成功；Alembic current / heads 均为 `domfin20261009`，`alembic check` 无新增升级操作。
- Celery worker inspect ping 返回 pong。
- 已从最新 main 本地构建 API / worker / beat Docker 镜像并启动；前端生产静态构建成功。新 API `/healthz` 返回 `gitSha=fb638020`，上述页面 / API、迁移 current / heads 和 worker ping 再次通过。
- 新 API 镜像 manifest list：`sha256:8fd65cb37b0e149eb2714ef40993be1a79a2f4f27dc3c11d6efd4ea7b7a14bed`；这是本地构建，不是 GHCR 发布。
- 8001 原 PID 38040、工作目录和健康入口仍在，无本轮修改。

以上是空业务库读路径 smoke，不等于完整采购、财务写流程验收，也不等于 GHCR 候选镜像 pull / run 验收或云 Production 验收。

## 云部署尚需解决的具体条件

- Google Cloud CLI 已安装并以 `jinfenghua1990@gmail.com` 认证；当前项目为 `project-2a0763fd-e296-437d-833`，账单已启用。当前没有等待中的 verification code。
- Supabase 项目 `coffeebear-prod`（ref `ialycmcpotovfbyzqtnj`）已创建并通过 CLI 绑定；运行 / migration 连接、管理员凭据仍未写入云 Secret Manager。不得使用本机 8001 数据库代替云正式数据库。
- Cloud Run Production 仍待写入正式 Secret Manager 值（至少 `DATABASE_URL`、`MIGRATION_DATABASE_URL`、`APP_SECRET_KEY` 和管理员凭据）；这些值不得提交 GitHub 或粘贴到聊天中。
- Cloud Run 运行脚本目前以 `IMAGE_REF` 为输入，正式部署前必须确认镜像已构建并推送到可供 Cloud Run 拉取的 Artifact Registry 或公开 GHCR，并记录不可变 digest。
- 当前业务附件实际写入 `DATA_DIR`，代码没有 B2 上传实现。Backblaze B2 暂不启用；Cloud Run 的临时文件系统不能作为正式附件持久化方案。
- 现有部署路径未包含 Redis / worker / beat，不能据此声称后台任务可用。需要在后续阶段明确 Cloud Run Jobs / worker 与队列方案。
- 云入口必须采用 RBAC 与独立正式密钥；本地 open 模式不得直接沿用到公网。
- 正式部署前记录已验收代码 / 镜像、备份恢复路径、迁移版本、健康检查、认证检查和核心业务 smoke；之后才能报告上线成功。

当前尚未创建 Cloud Run 服务、触发生产部署或修改 Supabase 正式数据库；已创建的 Google Cloud 基础资源仅用于后续正式发布。
