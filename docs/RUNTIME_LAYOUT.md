# CoffeeBear 运行架构记录

> 本文用于记录 CoffeeBear 后续统一采用的运行架构与数据分层。当前阶段先作为正式架构约定，不要求一次性把现有目录全部迁移；后续部署、备份、迁云和自动更新均按此标准推进。

## 六块运行资源分类

> 这 6 块用于日常理解“东西放哪里”，属于 CoffeeBear 的运行资源清单，不把它称为完整的大厂架构分层。

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

## 本地阶段的身份与权限策略

当前 CoffeeBear 只在用户自己的 M1 / 受控局域网运行，因此现阶段不要求启用复杂的管理员、操作员、只读用户等角色体系。

当前约定：

```text
本地运行阶段
→ 以受控局域网直达为主
→ 不把复杂登录 / RBAC 作为当前必做项
→ 优先完成业务流程、数据保护、自动更新和灾备
```

必须重新启用并补全身份与权限的触发条件：

```text
任意一项发生即重新评估：
- CoffeeBear 搬到 Cloud Run 或其他云服务器
- CoffeeBear 开放公网访问
- CoffeeBear 绑定正式公网域名并允许外部访问
- 员工需要在公司外远程访问
- 多个员工需要区分不同操作权限
```

届时至少补全：
- 登录认证（Authentication）
- 员工账号
- 管理员 / 操作员 / 只读等角色权限（RBAC）
- 登录安全策略
- 关键操作审计记录

## 运营层待确认清单

> 六块运行资源解决“东西放哪里”；下面的运营层解决“怎么进、怎么知道出事、怎么恢复、怎么自动更新”。后续由用户逐项确认，确认后持续更新本清单。

| 项目 | 当前状态 | 当前决定 / 下一步 |
| --- | --- | --- |
| 身份与权限（Authentication / RBAC） | ✅ 已确认策略 | 本地阶段暂不做复杂权限；迁云、公网或员工远程访问前必须补全 |
| 入口（Domain / DNS / HTTPS） | ⏸ 暂缓 | 当前 M1 / 局域网运行不需要；迁云或公网访问时再配置正式域名、DNS、HTTPS |
| 告警（Alerting） | ❌ 待补 | 需要做到备份失败、程序异常、关键任务失败时主动通知，而不是只留下日志 |
| Q4 实际灾备（Backup / DR） | ❌ 待补 | 需要把 Q4 正式接入为第一层本地灾备，并验证能从 Q4 恢复数据库和业务文件 |
| 恢复演练（Restore Drill） | 🟡 部分完成 | 已有本地恢复检查机制；后续应增加“从 Q4 取真实备份恢复”的演练 |
| 自动更新闭环（Automated Delivery） | 🟡 部分完成 | GitHub 测试 / Docker / GHCR 已有基础；还需完成 M1 拉取正式版本、健康检查、失败回滚 |
| 云端成本保护（Cost Guardrail） | ⏸ 迁云时补 | 当前 M1 本地运行无需处理；迁云前配置预算提醒和费用保护，避免意外扣费 |

### 当前建议确认顺序

```text
1. Q4 实际灾备
2. 告警
3. M1 自动更新闭环
4. 入口（迁云 / 公网前）
5. 身份与权限（迁云 / 公网 / 员工远程前）
6. 云端成本保护（迁云前）
```

## 当前阶段原则

1. 现在继续以 M1 作为 CoffeeBear 正式运行主机。
2. PostgreSQL 继续作为本地主数据库。
3. `/data` 继续作为本地主业务文件存储。
4. 前端和后端不分开部署。
5. GitHub 继续作为唯一正式软件源。
6. Q4 作为第一层本地灾备。
7. R2 作为第二层异地灾备，而不是当前主存储。
8. 本地阶段暂不把复杂登录权限作为必做项；迁云、公网或员工远程访问前必须重新补全。
9. 后续调整目录时必须先备份、再迁移、再校验，不允许直接移动生产数据导致服务中断。
