# CoffeeBear 统一自动备份架构记录

> 本文记录后续 CoffeeBear 备份体系设计。目标：CoffeeBear 自己负责生成、校验、上传恢复点，用户不需要手工执行数据库备份工具。

## 1. 备份原则

CoffeeBear 不依赖 Supabase CLI、Databasus、Portabase 等第三方工具作为必需运行组件。

第三方工具可以作为内部组件参考，但最终用户体验必须是：

```text
自动运行
↓
自动生成恢复点
↓
自动校验
↓
自动上传
↓
自动记录结果
```

## 2. 标准恢复点结构

所有项目统一使用同一种备份格式：

```text
YYYY-MM-DD_HHMMSS/
├─ 01-Application/     # 软件版本、Git SHA、Docker版本
├─ 02-Database/        # PostgreSQL等数据库可恢复备份
├─ 03-Data/            # 上传文件、附件、业务资料
├─ 04-Config/          # 加密后的配置和Secrets
├─ 05-Logs/            # 必要运行日志
└─ 06-Recovery/        # manifest、校验信息、恢复记录
```

## 3. 自动备份流程

```text
定时触发
↓
数据库导出
↓
业务文件整理
↓
配置加密
↓
生成恢复清单
↓
SHA256完整性校验
↓
上传已启用Backup Target
↓
记录成功/失败
↓
失败主动告警
```

## 4. 统一备份目标槽位

预留5个备份目标，不要求全部启用：

| Target | 默认目标 | 状态 |
|---|---|---|
| Target 1 | Cloudflare R2 | 第一云备份，优先启用 |
| Target 2 | Oracle Object Storage | 第二云备份，可选 |
| Target 3 | Backblaze B2 | 备用云备份 |
| Target 4 | 其他S3兼容云存储 | 预留 |
| Target 5 | 极空间Q4 | 本地副本，可选 |

原则：

```text
软件
↓
统一恢复点
↓
多个Backup Target
```

某一个备份目标失败，不应阻止其他目标继续备份。

## 5. 当前推荐存储策略

优先采用公网云备份：

```text
Cloudflare R2
+
Oracle Object Storage
```

Q4不作为唯一备份中心，只作为可选本地副本。

如果公网云备份稳定，则Q4可以不参与日常备份。

## 6. 免费优先策略

备份系统必须支持零费用保护：

```text
接近免费额度
↓
提醒

达到安全阈值
↓
停止该目标继续写入
↓
不自动产生超预算费用
```

## 7. 用户操作目标

正常情况下不进入终端。

界面提供：

```text
备份状态
最近备份时间
已启用备份目标
恢复状态

[立即备份]
[查看历史]
[恢复]
```

## 8. 适用范围

该备份标准后续不仅用于CoffeeBear，也作为ALSVID等系统统一备份规范参考。

不同系统只改变数据来源，不改变备份格式和恢复逻辑。
