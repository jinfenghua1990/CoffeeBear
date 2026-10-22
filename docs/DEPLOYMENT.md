# CoffeeBear 部署规范

> 本文档定义 Test 与 Production 的部署边界、发布步骤、回滚原则和当前已知限制。

## 1. 环境原则

CoffeeBear 只维护两套环境：

- Test：开发、测试、迁移、Docker 验证
- Production：唯一正式业务运行环境

不默认维护独立 Staging 环境。

## 2. Test 部署

Test 的主要目标不是长期对外提供业务，而是尽可能接近 Production 完成验证。

建议形态：

- M1 Mac
- Docker
- 非生产数据库
- 非生产对象存储
- 非生产密钥

Test 至少需要验证：

- 应用能构建
- 容器能启动
- 健康检查正常
- 数据库连接正常
- Alembic migration 正常
- 前后端核心链路正常
- 依赖的外部服务未配置时不会伪造成功

## 3. Production 部署

Production 是唯一正式运行环境。

仓库当前提供：

- 根 `Dockerfile`
- Test 用 `docker-compose.yml`
- `deploy/zspace/docker-compose.yml` Production 编排
- `deploy/zspace/production.env.example` Production 环境变量示例
- GHCR 候选镜像 / 晋级相关 GitHub Actions 基础

### Production 密钥规则

真实 `.env`、数据库密码、应用密钥、管理员密码、对象存储密钥等不得提交到 GitHub。

仓库只能提交：

- `.env.example`
- `production.env.example`
- 变量名
- 示例值或 `CHANGE_ME`

不能提交真实值。

## 4. 标准发布流程

正式发布至少遵循以下顺序：

1. 确认相关 Issue / PR 已完成评审。
2. Test 完成功能、Docker 和数据库迁移验证。
3. 确认 CI / 构建检查通过。
4. 生成不可变的候选镜像标签。
5. 对涉及数据库迁移的版本先做备份与回滚评估。
6. 在 Production 使用确认过的镜像标签发布。
7. 执行必要的数据库迁移。
8. 检查服务健康状态和核心业务链路。
9. 记录实际发布版本、验证结果和异常。
10. 验收无误后再把该版本视为稳定版本。

不建议只依赖可漂移的 `stable` 标签进行审计；正式发布应尽量记录具体不可变版本标签。

## 5. 回滚原则

应用回滚与数据库回滚分开考虑。

### 应用回滚

优先方式：切换回上一个已经验证的不可变镜像版本。

### 数据库回滚

数据库 migration 可能存在不可逆变更，因此不能简单假设应用回滚等于数据库回滚。

涉及高风险迁移时必须：

- 先备份
- 明确 migration 的向前兼容性
- 明确失败时恢复方案
- 必要时采用分阶段迁移

## 6. 当前发布验收状态

以 GitHub Issue #18 为 Docker / Production 基线验收事实来源。

已完成配置与 CI 基线：

- Production 镜像名统一为 `ghcr.io/jinfenghua1990/coffeebear`
- 候选镜像支持 `linux/amd64` 与 `linux/arm64`
- Compose、Alembic、备份恢复和发布配置检查已纳入 CI

仍未完成的真实环境验收：

- 在极空间 / NAS 的 Test 环境实际拉取并启动候选镜像
- 执行真实数据库迁移、`/healthz` 与采购 / 库存 / 财务 smoke test
- 记录目标设备架构、镜像摘要、验收结果和回滚点

Issue #48 同时修正了 Q4 更新脚本：Production 应部署已经发布的不可变镜像标签或 digest，不能在 NAS 上重建应用源码。新脚本与 Compose 逻辑仍需在真实 NAS 上演练后，才能视为 Production 更新流程验收通过。

在真实设备完成上述检查前，不得把静态检查或 GitHub CI 描述成 NAS / Production 实机验收通过。

## 7. 后台更新功能边界

当前容器编排显式关闭 `SYSTEM_UPDATE_ENABLED`。

现有更新器是 Git / 原生运行模式更新器，不能直接等价用于 Docker 镜像更新。

未经单独设计和确认，不允许：

- 为了实现后台更新按钮直接把 Docker socket 暴露给业务容器
- 让业务容器拥有不必要的宿主机控制权限

未来如果实现 Docker 自动更新，应单独创建 Issue，设计：

- 镜像发现
- 版本选择
- 拉取
- 迁移
- 健康检查
- 回滚
- 权限隔离

## 8. 发布记录要求

每次重要 Production 发布至少记录：

- Issue / PR
- Commit / 镜像版本
- 数据库 migration 版本
- 发布时间
- 验证项目
- 验证结果
- 是否回滚
- 遗留风险

这些记录应保存在 GitHub，而不是只存在聊天记录里。


## 9. NAS + 云端共享 Production 数据源（2026-10-22 新目标）

按 DEC-004 / Issue #59，NAS 与备用云服务器在切换后使用同一云端 PostgreSQL / R2 业务存储及受控共享任务队列。**这尚未部署，不得仅修改 .env 的 DATABASE_URL 直接切换**。

- 必须先盘点 DATA_DIR 持久业务文件并把业务对象操作改为 R2，保留安全恢复期；R2_BACKUP_* 不能直接充当业务上传对象存储。
- 当前 `deploy/update-q4.sh` 用 `exec postgres pg_dump` 生成数据库备份。改云库之前必须专门修复并测试更新器/恢复方案，否则自动更新会因无本地 postgres 失败。
- NAS/云端必须只执行一份 Alembic 迁移和 Celery beat，部署镜像保持一致并验收数据库向前兼容性。
- 旧 Compose 不直接覆盖；准备新的 opt-in 远端数据库模式，在 Test 验证后才生产迁移。

实施验收清单：`docs/NAS_CLOUD_SHARED_DATA.md`。


## 10. 内部域名与 Cloudflare Access（准备中）

目标内部入口：`https://coffee.alsvidbike.com`。旧 chaibenn 域名不再作为正式入口。

- 当前 NAS 应用继续运行；免费云服务器方案尚未选定，本轮不部署云服务器、不切换线上流量。
- `deploy/zspace/cloudflared.yml` 是目标 hostname 模板，不会自动创建 DNS 记录或 Access 策略。
- 在启用新 Tunnel/DNS 前，先于 Cloudflare Zero Trust 建立 Self-hosted Access 应用，hostname 为 `coffee.alsvidbike.com`，策略仅 Allow 维护者指定的邮箱，其他身份默认拒绝。
- Access 只作为外层门禁；Coffee 自身管理员登录不可关闭。不得把邮箱白名单、Access Token、Tunnel Token 或密钥写进仓库。
- 确认源站无法通过公网 IP/端口绕过 Access；不在路由器开放 NAS API 端口。若宿主机端口映射仍存在，必须通过防火墙或 Compose 绑定限制为可信本地接口。
- 完成未授权拒绝、授权访问后仍需应用登录、退出后重新认证等检查后，才允许由维护者执行 DNS/Tunnel 切换。

## 11. Neon / R2 迁移状态

Neon PostgreSQL 与 Cloudflare R2 是目标唯一数据服务，但当前 Production Compose 仍包含本地 PostgreSQL/Redis，应用仍存在 `DATA_DIR` 本地文件依赖。现有 R2 备份功能不代表业务文件已经迁移。

云端数据库和 R2 业务文件接入、更新器备份/恢复适配、共享 Redis/唯一 Beat、生产数据校验与回滚演练全部通过之前，禁止直接更改 Production 连接串、删除本地数据库或宣称迁移完成。
