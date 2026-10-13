# CoffeeBear 存储架构决策

## 已确认方案

CoffeeBear 采用：

```text
GitHub
  |
Google Cloud Run
  |
Neon PostgreSQL
  |
Cloudflare R2
```

## 数据库

Neon PostgreSQL 作为业务数据库。

存储内容：

- 用户
- 员工
- 门店
- 商品
- 库存
- 订单
- 客户
- 供应商
- 财务业务数据
- 权限与流程状态

## 对象存储

Cloudflare R2 作为文件和媒体存储。

正式 Bucket：

```text
coffeebear-prod
```

目录规划：

```text
coffeebear-prod
├── products
│   ├── coffee-beans
│   ├── drinks
│   └── packaging
├── stores
│   ├── store-images
│   └── store-documents
├── marketing
│   ├── banners
│   ├── campaigns
│   └── videos
├── documents
│   ├── contracts
│   ├── invoices
│   └── manuals
└── users
    └── avatars
```

## 环境规则

当前 CoffeeBear 不单独建立 coffeebear-dev 对象存储。

直接使用正式业务环境：

```text
coffeebear-prod
```

后续如需要大版本迁移或灾备，再增加 backup 存储。

## 设计原则

- 数据库只保存业务数据。
- 图片、视频、附件不直接存入 PostgreSQL。
- 代码仓库 GitHub 不存放业务文件。
- 应用通过配置读取对象存储地址，避免绑定具体供应商。

## 存储空间隔离（硬约束）

CoffeeBear 的 R2 存储空间**必须独占**，不得与其他项目共用桶或命名空间。

| 归属 | 存储空间 | 说明 |
|---|---|---|
| CoffeeBear | `coffeebear-prod` | 本项目唯一允许写入的桶 |
| 其他项目 | `ecommerce-workspace-backup` / `ecommerce-workspace-cold` / `alsvid-development` / `alsvid-production` | **严禁读写** |

约定：

- 对象前缀固定为 `coffeebear/backup`，不得使用 `ecommerce-workspace/` 或 `alsvid/` 前缀。
- R2 凭据必须是**仅授权 `coffeebear-prod` 桶**的令牌，不得复用其他项目的账号级令牌。
- 该约束在服务层强制（`r2_backup_service.save_config` 拒绝其他项目的桶与命名空间），不是仅靠约定。

## 未来扩展

如文件规模增长，可保持 Neon PostgreSQL 不变，仅替换对象存储层。
