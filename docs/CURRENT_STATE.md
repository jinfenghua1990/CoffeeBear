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
2. `.github/AGENTS.md`
3. `docs/CURRENT_STATE.md`
4. `docs/ACTIVE_WORK.md`
5. `docs/DECISIONS.md`
6. `docs/ENVIRONMENT.md`
7. `docs/DEPLOYMENT.md`
8. `docs/DATABASE.md`
9. 与任务相关的 Open Issues / Pull Requests

## 3. 环境模型

CoffeeBear 已确认只维护两套环境：

### Test（开发 / 测试合并环境）

当前目标形态：

- M1 Mac + Docker
- 功能验证
- Docker 构建与运行验证
- 数据库迁移验证
- 发布前检查
- 使用非生产数据库与非生产对象存储资源

### Production（正式环境）

- 唯一正式业务运行环境
- 使用正式数据库、正式对象存储与正式密钥
- 仓库当前包含 `deploy/zspace/` 下的 Production Docker 编排与示例配置

明确禁止默认引入独立 Staging 环境或 Dev / Staging / Production 三环境模型。

完整规则见 `docs/ENVIRONMENT.md`。

## 4. 当前部署状态

仓库已经具备 Docker / GHCR 正式发布基础，但正式发布基线仍有已知工作正在处理。

当前 Open Issue #18 已确认至少需要完成：

- 修正 `deploy/zspace/production.env.example` 中历史镜像名称
- Production 候选镜像增加 `linux/arm64`，与 `linux/amd64` 一起构建
- 增加静态回归检查，防止镜像名和平台配置退化
- 更新 Docker 部署文档并完成真实 Docker 环境最终验收

因此当前状态应理解为：

**Docker 正式部署框架已经存在，但 Production 发布基线仍在加固中。**

不要把 Issue #18 未完成事项描述为已经验收通过。

## 5. 数据库原则

CoffeeBear 使用 PostgreSQL，迁移工具为 Alembic。

数据库变更必须遵循：

代码 / 模型变更 → 生成或编写迁移 → Test 验证 → 备份 / 风险检查 → Production 迁移。

禁止把“直接手工修改正式数据库”作为正常开发流程。

详细规则见 `docs/DATABASE.md`。

## 6. 当前工作入口

当前正在处理和待完成事项统一看：

- `docs/ACTIVE_WORK.md`
- GitHub Open Issues
- GitHub Active Pull Requests

如果二者冲突，以 GitHub 当前 Issue / PR 的真实状态为准，并同步修正 `ACTIVE_WORK.md`。

## 7. 本文件维护规则

发生以下变化时必须同步更新本文件：

- 项目边界发生变化
- 环境模型发生变化
- Production 部署方式发生变化
- 关键数据库策略发生变化
- 重要业务模块的真实完成状态发生变化
- 当前主要风险或阻塞项发生变化

不得为了“看起来完整”而填写未经仓库代码、Issue、PR 或维护者确认的完成状态。
