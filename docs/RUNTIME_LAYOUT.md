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
- 备份由 CoffeeBear 自己自动生成、校验和上传，不依赖用户手工运行 Supabase CLI、Databasus、Portabase 等第三方工具。
- 第三方备份工具以后可以作为可选组件，但不能成为 CoffeeBear 备份链路的必需依赖。
- 软件程序以 GitHub 为正式软件源；备份中只记录版本号 / Git SHA / Docker 镜像版本，不重复备份整个 Git 仓库。
- 数据库必须生成可恢复的逻辑备份；业务文件、加密配置、必要日志和恢复清单组成同一个恢复点。
- Q4 是可选本地副本，不是唯一备份中心，也不是日常备份必须条件。

建议本地位置：

```text
M1/CoffeeBear/backups/
```

## 自动化备份模式

CoffeeBear 的目标不是“提供一个备份命令让用户自己执行”，而是软件自动运行：

```text
定时触发
↓
生成恢复点
↓
导出 PostgreSQL
↓
整理业务文件
↓
加密配置
↓
写入版本信息和恢复清单
↓
SHA256 完整性校验
↓
自动上传到已启用的备份目标
↓
再次校验
↓
记录成功 / 失败
↓
失败主动告警
```

本地 M1 阶段可由 macOS `launchd` 等系统计划任务负责定时触发；以后迁云后替换为云端计划任务，但 CoffeeBear 的备份格式和流程不变。

### 用户操作目标

正常情况下用户不需要进入终端执行备份命令。界面只需要提供：

```text
备份状态：正常 / 异常
最近备份时间
最近恢复演练时间
已启用备份目标

[立即备份]
[查看历史]
[恢复]
```

## 统一的 5 个备份目标槽位

CoffeeBear 预留 5 个备份目标，不要求全部启用。所有目标接收同一种标准恢复点，便于以后替换服务商而不重写备份逻辑。

| 槽位 | 默认目标 | 定位 | 当前原则 |
| --- | --- | --- | --- |
| Target 1 | Cloudflare R2 | 第一云备份 | 优先启用 |
| Target 2 | Oracle Object Storage | 第二云备份 | 可选启用 |
| Target 3 | Backblaze B2 | 备用云备份 | 预留 |
| Target 4 | 预留云存储 | GCS / 其他 S3 兼容服务 | 预留 |
| Target 5 | 极空间 Q4 | 本地副本 | 可选，不参与也不影响云备份 |

原则：

```text
CoffeeBear
   ↓
统一恢复点
   ↓
Backup Target 1..5
```

每个目标可独立启用 / 停用；某一个目标失败，不应阻止其他目标继续完成备份。

如果已经有稳定公网云备份，Q4 不要求介入日常备份；只有用户需要额外本地实体副本时才启用 Target 5。

## 免费优先与零费用保护

当前目标是尽量使用免费额度，因此备份系统必须具备成本保护：

```text
接近免费额度
→ 提醒

达到预设安全上限
→ 停止继续写入该目标
→ 其他可用目标继续运行
→ 不允许为了“备份必须成功”自动产生超预算费用
```

后续接入每个云备份服务时，应单独记录其免费额度、安全阈值、保留策略和超限行为。

## 标准恢复点格式

每一次备份都生成一个完整恢复点，例如：

```text
2026-10-10_023000/
├─ 01-Application/        # 版本信息 / Git SHA / Docker 版本
├─ 02-Database/           # PostgreSQL 可恢复备份
├─ 03-Data/               # 业务文件
├─ 04-Config/             # 加密后的运行配置
├─ 05-Logs/               # 必要的近期日志
└─ 06-Recovery/           # manifest / SHA256 / 恢复记录
```

第 06 类“备份与恢复”是前面 1-5 类的恢复管理信息，不再递归备份自己。

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
| 备份（Backup / Disaster Recovery） | 统一 Backup Target 1..5 |

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
| 备份运行方式（Automated Backup） | ✅ 已确认策略 | CoffeeBear 自己自动生成、校验、上传；第三方 CLI/备份工具不是必需依赖 |
| 备份目标（Backup Targets） | ✅ 已确认架构 | 预留 5 个目标：R2、Oracle、B2、1 个云端预留、Q4 本地可选 |
| 告警（Alerting） | ❌ 待补 | 需要做到备份失败、程序异常、关键任务失败时主动通知，而不是只留下日志 |
| 恢复演练（Restore Drill） | 🟡 部分完成 | 已有本地恢复检查机制；后续要让恢复演练支持从任一启用的 Backup Target 获取真实恢复点 |
| 自动更新闭环（Automated Delivery） | 🟡 部分完成 | GitHub 测试 / Docker / GHCR 已有基础；还需完成 M1 拉取正式版本、健康检查、失败回滚 |
| 云端成本保护（Cost Guardrail） | 🟡 已确认原则 | 免费优先；接近免费额度提醒，达到安全阈值停写该目标，不自动超预算 |

### 当前建议确认顺序

```text
1. 选择并开通第一云备份目标（R2）
2. 确认自动备份频率和保留规则
3. 告警方式
4. 恢复演练规则
5. M1 自动更新闭环
6. 入口 / 身份权限（迁云或公网前）
```

## 当前阶段原则

1. 现在继续以 M1 作为 CoffeeBear 正式运行主机。
2. PostgreSQL 继续作为本地主数据库。
3. `/data` 继续作为本地主业务文件存储。
4. 前端和后端不分开部署。
5. GitHub 继续作为唯一正式软件源。
6. CoffeeBear 备份必须自动运行，不要求用户手工执行数据库备份工具。
7. 备份目标采用可插拔 5 槽位结构；Q4 是可选本地副本，不是必须的主备份中心。
8. 免费优先，并对云备份设置零费用保护。
9. 本地阶段暂不把复杂登录权限作为必做项；迁云、公网或员工远程访问前必须重新补全。
10. 后续调整目录或备份链路时必须先验证恢复能力，不允许以“备份完成”代替“确认可恢复”。
