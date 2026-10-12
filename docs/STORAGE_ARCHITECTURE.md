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

## 未来扩展

如文件规模增长，可保持 Neon PostgreSQL 不变，仅替换对象存储层。
