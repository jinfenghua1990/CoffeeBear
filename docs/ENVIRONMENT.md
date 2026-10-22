# CoffeeBear 环境规范

> 2026-10-22 更新。架构目标已确认，但数据迁移、域名切换和云服务器部署均未执行。

## 1. 环境数量

CoffeeBear 只维护两个逻辑环境：

- **Test**：开发、功能测试、Docker 和数据库迁移验证；必须使用非生产数据、独立密钥与隔离存储。
- **Production**：唯一正式业务环境。当前 NAS 应用继续运行；未来云端运行节点尚未选定，也尚未部署。

未来 NAS 与云端应用如同时存在，只是同一 Production 的多个计算节点，不代表两套正式环境。

## 2. 唯一正式数据源（目标）

- **主数据库：Neon PostgreSQL**。
- **业务对象存储：Cloudflare R2**。
- 业务数据进入 PostgreSQL；图片和文件对象进入 R2。
- GitHub/GHCR 管理代码和不可变镜像，不存放业务文件或生产密钥。
- 当前 NAS Compose 仍包含本地 PostgreSQL、Redis 和 `DATA_DIR`。目标尚未落地，禁止只改 `DATABASE_URL` 就直接切换。

## 3. 应用运行位置

- 当前：保留 NAS 现有应用，不执行云服务器切换。
- 未来：免费云端方案仍在评估，供应商和主备角色暂不确定。
- NAS 内存暂不升级；后续发布优先使用 GHCR 预构建、固定版本镜像，避免在 NAS 上构建完整镜像。
- 云端运行节点只有在数据迁移、访问保护、后台任务和回滚方案验证后才可加入 Production。

## 4. Redis 与后台任务

当前 Redis 仍是 NAS 本地容器。它不等于未来 NAS 与云端共享的队列。正式双节点运行前，必须确定受认证和 TLS 保护的共享队列，且全 Production 只有一个活跃 Celery Beat 和一个数据库迁移执行者。

## 5. 内部域名与访问策略

- 目标内部域名：`coffee.alsvidbike.com`。
- 不再将旧 chaibenn 域名作为正式入口。
- 访问前置保护：Cloudflare Access 仅允许明确授权的邮箱；进入应用后仍须通过 Coffee 自身登录。
- 仅写入仓库模板不等于 DNS 或 Access 已配置。必须先配置 Access、检查源站无法绕过门禁，再启用新 DNS/Tunnel。
- 当前不切换线上 DNS 或流量。

## 6. 数据迁移与发布约束

1. 先备份 NAS 数据库和 `DATA_DIR`，并验证恢复。
2. 在 Test 验证 Neon 数据导入、R2 文件迁移、连接权限和业务链路。
3. 改造更新器以支持云数据库备份/恢复；不要依赖本地 `postgres` 容器继续处理云数据库。
4. 验证唯一 Beat、Redis 队列、任务幂等与数据库迁移兼容性。
5. 保留回滚窗口，未验收前不得删除 NAS 原数据。

详见 `docs/NAS_CLOUD_SHARED_DATA.md`、`docs/DEPLOYMENT.md` 与 `docs/DATABASE.md`。
