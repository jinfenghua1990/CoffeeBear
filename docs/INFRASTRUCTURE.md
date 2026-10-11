# CoffeeBear 基础设施架构

> 本文件描述当前基础设施方向。环境数量的长期规则以 `docs/ENVIRONMENT.md` 和 `docs/DECISIONS.md` 为准。

## 1. 环境策略

CoffeeBear 对外只维护两套环境：

- **Test**：开发 / 测试合并环境
- **Production**：唯一正式业务运行环境

不维护独立长期 Staging。

代码里历史出现的 `development` / `staging` 运行值，只能作为 Test 内部兼容标识理解，不代表新增第三套长期环境。

## 2. Test 环境

用途：

- 日常开发
- 功能调试
- Docker 验证
- 数据库 migration 验证
- 发布前验证

当前主要形态：

```text
M1 Mac
  ↓
Docker / 本地原生运行
  ↓
CoffeeBear
  ↓
非生产数据库 / 非生产对象存储 / 非生产密钥
```

原则：

- 不使用 Production 业务数据库作为默认 Test
- 不把 Production 真实业务数据当测试数据
- 不为了“企业标准”额外维护独立云 Staging

## 3. Production 环境

用途：

- 正式员工访问
- 正式业务处理
- 正式业务数据

当前仓库已经具备 Docker Production 编排基础：

- 根 `Dockerfile`
- `deploy/zspace/docker-compose.yml`
- `deploy/zspace/production.env.example`
- GHCR candidate / promote workflow

当前 Production Docker 发布基线仍以 GitHub Issue #18 为活动事项，未完成的真实 Docker 验收不得描述成已经正式通过。

## 4. 基础设施组件

当前架构基线：

| 组件 | 当前方向 |
|---|---|
| 源代码 | GitHub `jinfenghua1990/CoffeeBear` |
| 应用架构 | FastAPI + Next.js 静态导出，统一 8000 端口 |
| Test 计算 | M1 Mac + Docker / 本地验证 |
| Production 计算 | Docker Production 编排（当前仓库实现位于 `deploy/zspace/`） |
| 数据库 | PostgreSQL |
| 缓存 / 任务 | Redis + Celery |
| 对象 / 备份 | 按当前受控部署配置，真实密钥不进入 Git |

本文件不再把 Render / Supabase / Backblaze B2 写成 CoffeeBear 当前固定 Production 架构；如果未来确认使用新的托管平台，必须先通过架构决策 Issue 更新事实来源。

## 5. 数据与程序分离

Docker 镜像只承载程序，不承载长期业务数据。

长期数据必须独立保存：

- PostgreSQL
- Redis 持久化（如启用）
- 业务附件 / 上传文件
- 配置
- 备份

升级应用镜像不得覆盖业务数据。

## 6. 隔离规则

Test 与 Production 至少隔离：

- 数据库
- 数据目录
- 对象存储 / 备份命名空间
- 密钥
- 管理员凭据

禁止：

- Test 与 Production 共用正式数据库
- 把生产业务数据长期放在开发机代码目录
- 把真实生产密钥提交 GitHub
- 把本地临时文件系统当成 Production 永久存储方案

## 7. 发布与迁移

数据库 migration 必须是独立生命周期步骤，不应因为 API 容器启动而隐式执行高风险迁移。

正式发布遵循：

Test 验证 → 候选镜像 → 迁移 / 备份检查 → Production 发布 → 健康检查 → 记录结果。

完整流程见 `docs/DEPLOYMENT.md` 和 `docs/DATABASE.md`。

## 8. 冲突处理

如果旧文档、旧脚本、旧示例里仍出现：

- 三环境
- 独立 Staging
- Render / Supabase / Backblaze B2 被描述为当前唯一正式方案

不得直接沿用，应先以：

1. `docs/DECISIONS.md`
2. `docs/ENVIRONMENT.md`
3. 当前 Open Issues / PRs
4. 最新 main 实际配置

进行核对；仍不确定时创建 Issue 请求维护者确认。
