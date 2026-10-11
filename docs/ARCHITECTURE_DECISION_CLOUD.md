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
| 对象存储 | Backblaze B2 | Cloudflare R2 |
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
  +--> Backblaze B2
```

## 对象存储资源规则

CoffeeBear 与 ALSVID 根据业务访问场景选择不同对象存储方案。

### CoffeeBear

使用：Backblaze B2

用途：

- 发票
- 合同
- 采购附件
- 财务资料
- 业务文档
- 内部文件归档

原因：

- 主要为业务存储和归档
- 高频公开访问需求低
- S3 兼容，方便未来迁移
- 控制长期存储成本

### ALSVID

使用：Cloudflare R2

用途：

- 产品图片
- 车辆资料
- 售后照片
- 国际访问文件

原因：

- 面向国际访问场景
- 适合图片和公开资源分发

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
- 适合 CoffeeBear 当前阶段业务规模

### Supabase PostgreSQL

- PostgreSQL 标准数据库
- 提供托管能力
- 适合 CoffeeBear 业务数据模型

### Backblaze B2

- 用于 CoffeeBear 业务文件存储
- 支持 S3 API
- 适合长期低成本文件保存

### Cloudflare R2

- 用于 ALSVID 国际业务文件
- 适合图片、产品资料等访问场景
- 保持 S3 兼容迁移能力

## 后续要求

任何运行环境、数据库或对象存储调整，需要先更新架构决策文档，再修改部署配置。
