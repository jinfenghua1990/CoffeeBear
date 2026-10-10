# CoffeeBear 运行架构记录

> 本文用于记录 CoffeeBear 后续统一采用的运行架构与数据分层。当前阶段先作为正式架构约定，不要求一次性把现有目录全部迁移；后续部署、备份、迁云和自动更新均按此标准推进。

## 六块标准架构

CoffeeBear 统一分为以下 6 块：

```text
CoffeeBear
├─ 01 软件程序（Application）
├─ 02 数据库（Database）
├─ 03 业务文件（File / Object Storage）
├─ 04 配置和密码（Configuration / Secrets）
├─ 05 日志（Logs）
└─ 06 备份（Backup / Disaster Recovery）
```

### 01 软件程序（Application）

内容：
- 前端
- 后端
- Docker / 容器运行文件
- 部署脚本

原则：
- GitHub 是唯一正式软件源。
- 软件程序可以重新下载、重新构建，不作为核心业务数据保存。
- 前端和后端代码继续分层管理，但现阶段不做分开部署。

建议本地位置：

```text
M1/CoffeeBear/app/
```

### 02 数据库（Database）

内容：
- PostgreSQL
- 订单
- 客户
- 商品
- 库存
- 财务
- 发票
- 付款等结构化业务数据

原则：
- PostgreSQL 是 CoffeeBear 主数据库。
- 数据库目录只允许 PostgreSQL 自己管理，不人工修改内部数据库文件。
- 正式备份使用 `pg_dump` 等数据库备份方式，不直接复制运行中的数据库目录作为备份。

建议本地位置：

```text
M1/CoffeeBear/database/postgres/
```

### 03 业务文件（File / Object Storage）

内容：
- 上传文件
- Excel
- PDF
- 图片
- 附件
- 导入文件
- 导出文件
- 其他业务资料

原则：
- 与数据库分开存放。
- 当前以 M1 本地文件为主，未来可以迁移到 R2 / S3 / GCS 等对象存储。

建议本地位置：

```text
M1/CoffeeBear/data/
```

### 04 配置和密码（Configuration / Secrets）

内容：
- `.env`
- 部署参数
- 数据库密码
- API Key
- 邮箱密码
- 第三方服务密钥
- 运行开关

原则：
- 真实密码和密钥禁止提交 GitHub。
- M1 阶段使用独立配置目录保存。
- 未来迁移 Google Cloud Run 时，敏感配置迁移到 Google Secret Manager。
- GitHub 只保存 `.env.example` 等模板，不保存真实 Secret。

建议本地位置：

```text
M1/CoffeeBear/config/
```

### 05 日志（Logs）

内容：
- 报错记录
- 运行记录
- 后台任务记录
- 运维脚本日志

原则：
- 与应用代码、数据库、业务文件分开。
- 以后上云可对应 Cloud Logging 等集中日志服务。

建议本地位置：

```text
M1/CoffeeBear/logs/
```

### 06 备份（Backup / Disaster Recovery）

内容：
- PostgreSQL 恢复点
- 业务文件备份
- 加密后的运行配置备份
- 恢复清单 / manifest
- 灾难恢复所需信息

原则：
- M1 本地可以保留近期恢复点。
- Q4 作为第一层本地灾备。
- Cloudflare R2 作为第二层异地云灾备。
- 应用程序代码以 GitHub 为正式软件源，不需要重复把整个 Git 仓库当成核心业务备份。

建议本地位置：

```text
M1/CoffeeBear/backups/
```

外部备份目标：

```text
Q4
└─ CoffeeBear Backup

Cloudflare R2
└─ CoffeeBear Offsite Backup
```

## M1 当前目标目录

后续 CoffeeBear 在 M1 上统一向以下结构收敛：

```text
M1
└─ CoffeeBear/
   ├─ app/                 # 软件程序（Application）
   ├─ database/
   │  └─ postgres/         # 数据库（Database）
   ├─ data/                # 业务文件（File / Object Storage）
   ├─ config/              # 配置和密码（Configuration / Secrets）
   ├─ logs/                # 日志（Logs）
   └─ backups/             # 备份（Backup / Disaster Recovery）
```

## 当前与未来云端对应关系

| 当前 M1 | 未来云端可对应 |
| --- | --- |
| 软件程序（Application） | Google Cloud Run / 其他容器运行平台 |
| 数据库（Database） | Cloud SQL / 托管 PostgreSQL |
| 业务文件（File / Object Storage） | Cloudflare R2 / S3 / GCS |
| 配置和密码（Configuration / Secrets） | Google Secret Manager |
| 日志（Logs） | Cloud Logging |
| 备份（Backup / Disaster Recovery） | Q4 + 异地云备份 |

## 当前阶段原则

1. 现在继续以 M1 作为 CoffeeBear 正式运行主机。
2. PostgreSQL 继续作为本地主数据库。
3. `/data` 继续作为本地主业务文件存储。
4. 前端和后端不分开部署。
5. GitHub 继续作为唯一正式软件源。
6. Q4 作为第一层本地灾备。
7. R2 作为第二层异地灾备，而不是当前主存储。
8. 后续调整目录时必须先备份、再迁移、再校验，不允许直接移动生产数据导致服务中断。
