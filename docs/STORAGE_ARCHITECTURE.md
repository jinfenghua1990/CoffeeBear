# CoffeeBear 存储架构决策

> 已确认的目标：Neon PostgreSQL 作为唯一主数据库，Cloudflare R2 作为唯一业务对象存储。当前 NAS 运行配置尚未完成迁移。

## 1. 数据服务

- **Neon PostgreSQL**：用户、员工、门店、商品、库存、采购、订单、客户、供应商、财务和权限等结构化业务数据。
- **Cloudflare R2**：商品图片、营销媒体和经确认的业务附件。
- **GitHub/GHCR**：源代码和不可变容器镜像；不得保存业务文件、数据库转储或真实密钥。
- **NAS**：现阶段继续运行 CoffeeBear，并在迁移完成前保留本地原始数据库和文件以便回滚。

## 2. R2 Bucket 与前缀

目标正式 Bucket：

```text
coffeebear-prod
```

建议对象分类：

```text
coffeebear-prod/
├── business/
│   ├── products/
│   ├── stores/
│   ├── marketing/
│   ├── documents/
│   └── users/
└── coffeebear/backup/
```

业务对象和备份对象用途不同，必须采用独立前缀、清晰生命周期与最小权限；如权限模型需要，改用独立 Bucket。现有 `R2_BACKUP_*` 配置只代表备份能力，不代表业务上传已经接入 R2。

文件权限必须按类型设计：可公开访问的商品图与私有财务、税务、合同附件不能使用相同的公开访问规则。敏感认证态和临时缓存需要先做分类审查，不应不加区分地上传至业务 Bucket。

## 3. 数据库与文件一致性

- PostgreSQL 保存业务记录和稳定的 R2 object key / 元数据。
- 文件内容存储在 R2，不把大文件直接存入 PostgreSQL。
- NAS 与未来云端节点最终共用同一 Neon 数据库和同一 R2 业务空间。
- 上传/删除流程应处理对象写入与数据库事务之间的失败窗口，必要时采用暂存、补偿或定期孤儿对象清理。
- 迁移旧文件需核对数量、大小和 SHA-256；验收前保留 NAS 原件。

## 4. 当前实施状态

仓库现有 R2 备份服务和脚本，但业务上传/下载仍有 `DATA_DIR` 本地路径依赖。当前生产 Compose 仍配置本地 PostgreSQL / Redis；因此，不能宣称 Neon 主库或 R2 业务存储已在生产启用。

具体迁移与验收清单见 `docs/NAS_CLOUD_SHARED_DATA.md`。
