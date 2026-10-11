# CoffeeBear 当前进行中的工作

> 本文件用于避免多个机器人重复做同一件事，也让维护者快速知道“现在正在处理什么”。
>
> 最后整理：2026-10-11

## 状态说明

- `进行中`：已经确认需要做，尚未完成
- `待确认`：存在问题，但需要维护者确认方案
- `已完成待关闭`：内容已经落实，Issue 仍可能保持 Open
- `阻塞`：需要外部条件、真实环境或人工操作才能继续

## 当前事项

### Issue #18 — Docker 正式发布基线加固

**状态：进行中 / 部分依赖真实 Docker 环境最终验收**

已知范围：

- 修正 Production 示例镜像名称为 CoffeeBear
- 候选镜像支持 `linux/amd64` 与 `linux/arm64`
- 增加配置回归检查
- 完善 Docker 部署说明
- 真实 Docker 环境完成最终启动验证

注意：

- 当前系统更新器属于 Git / 原生运行模式，不能直接在容器内开启
- 不应为了后台“更新”按钮而直接把 Docker socket 暴露给业务容器
- 容器化自动更新需要单独设计与确认

### Issue #17 — AI Agent 操作日志与决策记录规则

**状态：已完成待关闭**

已经落地：

- `.github/AGENTS.md`
- `docs/AGENT_WORKFLOW.md`
- `docs/DECISIONS.md`
- `docs/CURRENT_STATE.md`
- `docs/ACTIVE_WORK.md`
- Issue / PR 模板
- README 入口规则

后续要求：机器人每次重要工作继续留下 Issue / PR / Commit / 文档记录。

### Issue #16 — 两环境模型（Test + Production）

**状态：已完成待关闭**

已经落地：

- README 环境说明
- `docs/ENVIRONMENT.md`
- `docs/DECISIONS.md` 中长期决策记录
- `.github/AGENTS.md` 中强制约束

固定规则：

- Test = 开发 / 测试合并环境
- Production = 唯一正式运行环境
- 不新增独立 Staging，除非先创建 Issue 并得到维护者明确批准

## 新任务如何进入本列表

任何重要新工作应至少满足以下一种情况：

1. 已存在 GitHub Issue；
2. 已存在 Pull Request；
3. 维护者明确确认需要进入开发。

机器人不得仅根据聊天中的模糊想法，擅自把大范围架构任务标记为“进行中”。

## 完成任务时必须做什么

任务完成后：

1. 更新对应 Issue / PR；
2. 记录检查内容、修改内容、验证结果、遗留风险；
3. 更新本文件状态；
4. 如影响长期规则，同步更新 `docs/DECISIONS.md`、`docs/CURRENT_STATE.md` 或相关专项文档；
5. 确认没有遗留阻塞后再关闭 Issue。
