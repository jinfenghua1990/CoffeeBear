# CoffeeBear 云端架构决策

## 状态

已确认。

## CoffeeBear 与 ALSVID 架构边界

CoffeeBear 与 ALSVID 属于两个独立业务系统：

| 项目 | CoffeeBear | ALSVID |
| --- | --- | --- |
| 业务 | 国内经营系统 | 国际自行车品牌平台 |
| 软件运行 | Render | Google Cloud Run |
| 数据库 | Supabase PostgreSQL | Neon PostgreSQL |
| 对象存储 | Cloudflare R2 | Cloudflare R2 |
| 业务资源 | 独立 | 独立 |

## CoffeeBear Production 架构

```text
GitHub
  |
  v
Render
  |
  v
CoffeeBear Application
  |
  +--> Supabase PostgreSQL
  |
  +--> Cloudflare R2
```

## Cloudflare R2 资源规则

CoffeeBear 与 ALSVID 可以共同使用 Cloudflare R2 服务平台，但必须使用独立 Bucket。

推荐结构：

```text
Cloudflare Account
        |
        +----------------+
        |                |
        v                v
CoffeeBear R2       ALSVID R2
Bucket              Bucket

coffeebear-prod     alsvid-prod
```

规则：

- 可以共用 Cloudflare 管理账号
- 必须独立 Bucket
- 必须独立 Access Key / Secret
- 不共享文件路径空间
- 不混用业务文件

原因：

- 保持业务数据隔离
- 避免误删除风险
- 方便权限控制
- 保留未来独立运营、拆分或迁移能力

## 资源隔离规则

CoffeeBear 与 ALSVID 可以采用相同的工程规范，但生产业务资源必须保持独立：

- 不共享数据库
- 不共享对象存储 Bucket
- 不共享生产密钥
- 不混用业务数据

## 选择原因

### Render

- 支持 Docker 部署
- 降低服务器维护成本
- 适合当前阶段业务规模

### Supabase PostgreSQL

- PostgreSQL 标准数据库
- 提供托管能力
- 适合 CoffeeBear 业务数据模型

### Cloudflare R2

- 保存图片、附件、业务文件
- 与数据库分离
- 保持 S3 兼容迁移能力
- 两个业务系统共用服务平台，但使用独立 Bucket

## 后续要求

任何运行环境、数据库或对象存储调整，需要先更新架构决策文档，再修改部署配置。
