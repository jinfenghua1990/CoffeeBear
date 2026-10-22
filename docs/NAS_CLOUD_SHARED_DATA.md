# CoffeeBear：NAS 继续运行 + Neon / R2 统一云端数据（2026-10-22）

> 对应 DEC-004、Issue #59。本文是已确认的目标和实施清单，**不代表生产数据已经迁移**。当前先保留 NAS 正在运行的版本；暂不部署云服务器、不切换线上 DNS。

## 1. 已确认目标

- **唯一主数据库：Neon PostgreSQL**，存放用户、商品、库存、采购、订单、客户、供应商、财务和权限等业务记录。
- **唯一业务对象存储：Cloudflare R2**，存放经分类确认的商品图片、业务附件和文件对象。数据库只保存对象 key、文件元数据及业务关联。
- **当前应用运行：NAS 保持现状**。NAS 内存暂不升级，也不在 NAS 上本地构建大型镜像。
- **未来云服务器：暂缓选择与部署**。免费运行方案尚未确认；之后可部署同版本程序并连接同一 Neon / R2，当前不改变线上运行节点。
- **内部域名目标：`coffee.alsvidbike.com`**。不再把旧的 chaibenn 域名作为正式入口；仓库中的 Tunnel 模板可以先准备，但 DNS、Access 策略和线上流量暂不切换。
- **访问保护：Cloudflare Access 邮箱 allowlist + Coffee 自身管理员登录**。Access 策略必须在 DNS 对外启用前建立并验证。

## 2. 目标结构

```text
GitHub / GHCR（构建并发布不可变镜像）
                 |
       当前 NAS 应用继续运行
                 |
        +--------+---------+
        |                  |
  Neon PostgreSQL      Cloudflare R2
  唯一业务数据库       唯一业务对象存储
        |
未来云端应用节点（供应商待选；本轮不部署）
        |
同一 Neon / 同一 R2，不创建第二套正式数据
```

NAS 与未来云端节点即使同时提供 Web/API，也属于同一 Production，不能各自写入独立数据库或独立文件库。实际切换前必须确定任务调度、Redis 和流量接管规则。

## 3. 当前仓库事实（不等于 NAS 实时状态）

- `deploy/zspace/docker-compose.yml` 仍包含本地 PostgreSQL 和 Redis；`production.env.example` 默认连接 `postgres:5432`。
- 应用仍把 `DATA_DIR=/data` 挂载到 NAS。现有 R2 备份脚本/配置不等于业务上传、附件读写已经接入 R2。
- `deploy/update-q4.sh` 目前依赖本地 `postgres` 容器执行数据库备份；Neon 切换前必须先改造并测试备份、恢复和更新流程。
- 本次只修改 GitHub 中的目标文档与配置模板，不读取或修改 NAS 的生产 `.env`、数据库、容器、Cloudflare DNS 或 Access 实际设置。
- 生产切换状态：**未迁移、未验收、未切换**。

## 4. Neon 数据库接入要求（待实施）

- 应用运行连接使用 Neon 项目提供的正式连接串；需要连接池时可使用 Neon pooled endpoint。
- `MIGRATION_DATABASE_URL` 单独使用适合 Alembic DDL 的连接串，并验证账号具备所需 schema 权限；不能把连接字符串改好就视为迁移完成。
- 迁移前先盘点 NAS PostgreSQL 版本、Alembic revision、记录数量、索引/约束和现有备份，导入到 Neon 后逐项核对。
- Test 必须使用独立的非生产数据库和密钥，不得连接正式 Neon 数据库。
- 正式环境始终只有一个权威写入数据库；禁止 NAS 本地库和 Neon 同时接收业务写入。

## 5. R2 业务文件接入要求（待实施）

- 先盘点所有 `DATA_DIR` 文件的读写路径，区分业务对象、临时缓存、备份和敏感认证态。
- 商品图片、业务附件等正式文件逐项改为 R2 对象读写，数据库保存稳定 object key 和元数据；对公开图片与私有财务/税务附件采用不同访问策略。
- 迁移旧文件时核对数量、大小与 SHA-256；迁移完成前保留原 NAS 文件作为回滚副本，不做无验证删除。
- 业务文件前缀与备份前缀必须分开。现有 `R2_BACKUP_*` 只表示备份功能，不得当成应用业务文件存储接口。
- R2 凭据放在受控环境变量/密钥管理中，不提交真实密钥；限制在 CoffeeBear 自有存储空间内。

## 6. Redis、worker 和定时任务（待实施）

- 当前 Redis 仍由 NAS Compose 本地运行；它还不是 NAS 与未来云端节点共享的队列。
- 未来双节点方案必须先确定可被两端安全访问的 Redis/队列方案，启用 TLS/认证并验证连接恢复。
- 全 Production 只允许一个活跃 Celery Beat 和一个数据库迁移执行者；Worker 即使多实例运行，也必须通过任务幂等与锁避免重复处理。
- 在云端队列和单调度方案完成前，不得宣称双节点可以无缝接管所有后台任务。

## 7. 内部域名和访问保护

目标入口：`https://coffee.alsvidbike.com`。

上线前必须依次完成：

1. 在 Cloudflare Zero Trust 中建立该 hostname 的 Self-hosted Access 应用。
2. 配置仅允许维护者明确指定的邮箱地址登录，默认拒绝其他用户；不得把邮箱白名单、Token 或密钥写入 Git。
3. 保留 Coffee 自身管理员登录，Access 只是外层门禁，不替代应用认证。
4. 确认源站没有可绕过 Access 的公网端口；不要在路由器开放 NAS API 端口。
5. 验证未授权邮箱被拒绝、授权邮箱通过 Access 后仍需登录 Coffee。
6. 上述检查通过后，才创建/启用 Tunnel DNS 路由并切换线上入口。

当前仓库仅准备 hostname 模板；**没有修改 Cloudflare DNS、Tunnel 线上状态或 Access 策略**。在 Access 配置完成前不要发布/应用新的 Tunnel hostname。

## 8. 实施顺序

- [ ] 盘点 NAS 当前运行版本、Compose、数据库版本、Alembic revision、`DATA_DIR` 文件和可恢复备份。
- [ ] 建立 Neon Test 数据库，完成全量迁移与记录校验。
- [ ] 完成 R2 业务文件适配和历史文件迁移演练。
- [ ] 解决远端 Redis、唯一 Beat、迁移执行者和任务幂等问题。
- [ ] 改造更新器，使数据库备份/恢复不再强制依赖本地 `postgres` 容器。
- [ ] 通过 Test 后，在维护窗口切换唯一正式数据库与文件存储。
- [ ] 先配置并验证 Cloudflare Access，再启用新域名 DNS。
- [ ] 免费云端运行方案确认后，才部署未来云节点并演练接管；本轮不执行该步骤。

## 9. 完成定义与故障边界

必须有 Neon 数据迁移核对、R2 文件读写回归、数据库和文件恢复演练、NAS 真实业务测试、Access 未授权拒绝测试、备份验证及明确回滚步骤，才能宣布迁移完成。

统一 Neon / R2 可以避免两套独立业务数据分叉，但不能消除网络故障；NAS 无法连接云端数据库时，依赖该数据库的业务也可能不可用。程序代码在 GitHub 中修改，不代表线上数据或域名已经切换。
