# CoffeeBear 当前项目状态

> 本文件用于让后续开发者、AI Agent、Review Bot 在进入仓库后快速了解“现在做到哪里、当前约束是什么、下一步看哪里”。
>
> 最后整理：2026-10-11

## 1. 项目定位

CoffeeBear 是“卖咖啡的熊”中国国内经营平台的长期业务仓库。

当前仓库边界以 `README.md` 为准，主要覆盖：

- 国内采购与 1688 链路
- 吉客云 / JackYun 国内采购、入库、库存、销售与结算
- 国内供应商、客户与往来单位
- 国内仓库、生产、耗材与盘点
- 国内销售、售后、快递物流
- 银行流水、回单、对账与付款核对
- 税务发票、进项认证、红蓝票与 VAT 核对
- FinanceEntry、应收应付 Open Items、渠道结算
- 月结资料生成、完整性检查、归档与邮件交付

ALSVID 自行车、欧洲经销商、出口、国际物流与欧盟税费不属于 CoffeeBear 运行时范围。

## 2. 已确认的项目治理规则

以下规则已经固化到仓库，不再仅依赖聊天记录：

- GitHub 是项目事实来源（Single Source of Truth）。
- AI Agent / Review Bot / 自动化机器人不能只依赖聊天历史。
- 重要工作必须留下可追溯记录。
- 不确定的架构、数据模型、环境、部署、核心业务规则不得自行决定。
- 需要先通过 GitHub Issue 描述问题、方案和影响，由维护者确认后再实施。
- 已接受的长期决策记录在 `docs/DECISIONS.md`。

机器人进入项目时必须优先阅读：

1. `README.md`
2. 根目录 `AGENTS.md`
3. `.github/AGENTS.md`
4. `docs/AI-INSTRUCTIONS.md`
5. `docs/ARCHITECTURE.md`
6. `docs/CURRENT_STATE.md`
7. `docs/ACTIVE_WORK.md`
8. `docs/DECISIONS.md`
9. `docs/ENVIRONMENT.md`
10. `docs/DEPLOYMENT.md`
11. `docs/DATABASE.md`
12. 与任务相关的 Open Issues / Pull Requests
13. 最新 main 上的真实代码与配置

## 3. 环境模型

CoffeeBear 已确认只维护两套环境：

### Test（开发 / 测试合并环境）

当前目标形态：

- M1 Mac + Docker / 本地受控验证
- 功能验证
- Docker 构建与运行验证
- 数据库迁移验证
- 发布前检查
- 使用非生产数据库、非生产对象存储 / 备份命名空间与非生产密钥

### Production（正式环境）

- 唯一正式业务运行环境
- 使用正式数据库、正式对象存储 / 备份资源与正式密钥
- 仓库当前包含 `deploy/zspace/` 下的 Production Docker 编排与示例配置

明确禁止默认引入独立长期 Staging 环境或 Dev / Staging / Production 三环境模型。

代码中历史存在的 `APP_ENV=staging/development` 仅作为 Test 内部兼容运行值，不代表第三套长期环境。

完整规则见 `docs/ENVIRONMENT.md`。

## 4. 当前 Docker / 发布状态

### 已完成：配置与 CI 发布基线

Issue #18 的代码 / 配置 / CI 加固已经完成：

- Production 示例镜像已改为 `ghcr.io/jinfenghua1990/coffeebear:stable`
- Test Docker 示例已统一为 `deploy/zspace/test.env.example`
- 旧 `deploy/zspace/staging.env.example` 已删除
- 候选镜像配置同时支持 `linux/amd64` 与 `linux/arm64`
- CI 已加入旧镜像名、单架构配置和旧 staging 文件的防回退检查
- ZSpace / Docker / 基础设施文档已统一到 Test + Production 两环境语义
- 旧 PR #19 已关闭，避免旧分支覆盖当前 main

GitHub Actions CI run #75（commit `281ba198bcd8ef1bd3fd1792e1b71ce0627a41da`）已经全部通过：

- Frontend typecheck + production static build：通过
- Release configuration policy：通过
- Docker Compose topology：通过
- Unified production image build：通过
- Alembic migration + drift check：通过
- 备份 / 恢复演练：通过
- 目标回归测试 + 全量 backend pytest：通过
- Pyflakes debt budget：通过

### 仍未完成：真实 Docker Test 实机验收

不能因为 CI 全绿就宣称 Production 已真实运行验收。

Issue #18 仍需在具备 Docker 的真实 Test 机器完成：

- 使用 `deploy/zspace/test.env.example` 准备实际 Test `.env`
- 实机 `docker compose config`
- 启动 PostgreSQL / Redis
- 执行 `db-roles`（如需要）
- 执行真实 Alembic migration
- 启动 API / worker / beat
- `/healthz` 健康检查
- 采购、库存、财务等核心业务 smoke test
- 确认 GHCR 候选 manifest 可真实拉取 amd64 + arm64
- 记录镜像 SHA / 版本号 / 验收结果 / 回滚点

因此当前准确表述是：

**Docker 配置与 CI 发布基线已通过；真实 Docker Test 运行验收仍待执行。**

## 5. 数据库原则

CoffeeBear 使用 PostgreSQL，迁移工具为 Alembic。

数据库变更必须遵循：

代码 / 模型变更 → 生成或编写 migration → Test 验证 → 备份 / 风险检查 → Production migration。

禁止把“直接手工修改正式数据库”作为正常开发流程。

详细规则见 `docs/DATABASE.md`。

## 6. 当前治理待确认事项

### Issue #20

等待维护者确认：

- main 是否开启 GitHub 分支保护
- 是否要求关键 CI 通过后才能进入 main
- 是否保留维护者应急绕过权限
- 仓库简介是否更新掉旧“8000 Production + 8001 sandbox”描述
- CoffeeBear 仓库继续 Public 还是改为 Private

在确认前，AI 不得自行改变仓库可见性或强制提交流程。

### Issue #21

等待维护者确认历史分支清理策略。

已核实 `sandbox` 没有独有 commit，是 main 的祖先；其他旧 hotfix / running-state / archive / backup 分支需要按是否有独有 commit 和归档价值分别处理，禁止批量盲删。

## 7. 当前工作入口

当前正在处理和待完成事项统一看：

- `docs/ACTIVE_WORK.md`
- GitHub Open Issues
- GitHub Active Pull Requests

如果二者冲突，以 GitHub 当前 Issue / PR 的真实状态为准，并同步修正 `ACTIVE_WORK.md`。

## 8. 本文件维护规则

发生以下变化时必须同步更新本文件：

- 项目边界发生变化
- 环境模型发生变化
- Production 部署方式发生变化
- 关键数据库策略发生变化
- 重要业务模块的真实完成状态发生变化
- 当前主要风险或阻塞项发生变化

不得为了“看起来完整”而填写未经仓库代码、Issue、PR 或维护者确认的完成状态。
