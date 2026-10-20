# CoffeeBear AI 开发约定（每次会话必读）

> 本文件补充具体开发习惯；更高层强制规则先读根 `AGENTS.md`、`.github/AGENTS.md` 和 `docs/DECISIONS.md`。

## 一、端口与部署（最高优先级）

**所有业务功能继续集成在现有 8000 端口项目内，不允许为新业务模块新开独立应用端口。**

- 当前业务入口：`http://localhost:8000`
- FastAPI 提供 API 与静态前端托管
- Next.js 使用静态导出
- 新业务通过现有路由扩展

示例：

- `/` 经营总览
- `/supply-chain` 供应链中心
- `/finance` 财务
- `/products` 货品档案
- `/purchase/workbench` 采购工作台

如果已有路由结构，优先沿用，不为“模块独立”重建项目或新端口。

## 二、环境规则

CoffeeBear 对外只有：

- Test（开发 / 测试合并）
- Production（唯一正式环境）

不维护独立长期 Staging。

历史代码 / 配置里的 `development` 或 `staging` 可以作为 Test 内部兼容运行值，但不能被机器人解释成第三套长期环境。

环境长期规则见 `docs/ENVIRONMENT.md`。

## 三、修改前必须做

1. 读取根 `AGENTS.md`。
2. 读取 `.github/AGENTS.md`。
3. 读取 `docs/CURRENT_STATE.md` 和 `docs/ACTIVE_WORK.md`。
4. 读取相关架构、部署、数据库和长期决策文档。
5. 检查相关 Issue / PR。
6. 读取最新 main 的真实代码 / 配置。
7. 确认前端、后端、启动入口、路由、数据模型、接口和数据库影响。
8. 基于现有代码继续开发，优先复用组件、service、数据库事实源和接口。
9. 不做与本任务无关的大规模重构。
10. 需要访问 NAS / 生产环境（SFTP、`/health`、目录定位、版本更新纪律）时，读取 `docs/NAS_AI_ACCESS.md`。

## 四、当前技术基线

- 后端：FastAPI + SQLAlchemy + PostgreSQL + Alembic
- 前端：Next.js App Router + React + TypeScript，静态导出
- API 前缀：`/api/v1`
- 数据库：PostgreSQL
- 后台任务：Redis + Celery
- 公开业务端口：8000
- 业务时区：Asia/Shanghai

具体版本与当前结构以 `docs/ARCHITECTURE.md` 和最新代码为准，不再把某个历史日期统计的“路由数量 / 表数量”当长期规则。

## 五、核心硬性禁令

- 不破坏现有商品、库存、采购、1688、吉客云和数据库事实。
- 不写死模拟数据冒充真实连接。
- 暂无数据来源时明确显示未配置 / TODO。
- 新增数据库字段必须提供 migration。
- 新增接口保持现有 `/api/v1` 风格。
- 金额逻辑保持 Decimal / Numeric 精度原则。
- 不重复创建平行事实表或第二套同口径计算。
- 不把 ALSVID / 外贸运行能力重新带回 CoffeeBear。
- 不提交真实密码、Token、Cookie、API Key。

## 六、Git 安全

本地 Git 操作时：

- 不用 `git add -A` / `git add .` 无脑提交所有文件；按任务范围检查变更。
- 删除重要文件前确认版本历史 / 备份路径。
- pull / merge 前保护未提交改动。
- 不丢弃用户现有改动来方便机器人操作。

通过 GitHub API 工作时，优先按根 `AGENTS.md` 的批量提交规则减少无意义 CI 触发。

## 七、数据库

涉及数据库必须先读 `docs/DATABASE.md`。

至少遵循：

- Alembic migration 可追溯
- Test 先迁移验证
- Production 前检查备份 / 恢复
- 历史 migration 不随意重写
- 多 head / 冲突先核对真实升级链

## 八、验证与报告

必须区分：

- 静态检查通过
- 自动化测试通过
- Test 实际运行通过
- Docker 实际启动通过
- Production 真实验收通过

没有对应环境证据时不得升级结论强度。

每次重要任务结束要回写：

- 检查内容
- 修改内容
- 验证内容
- 结果
- 环境限制
- 遗留问题
- 下一步
