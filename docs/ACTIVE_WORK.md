# CoffeeBear 当前进行中的工作

> 本文件用于避免多个机器人重复做同一件事，也让维护者快速知道“现在正在处理什么”。
>
> 最后整理：2026-10-22

## 状态说明

- `进行中`：已经确认需要做，尚未完成
- `待确认`：存在问题，但需要维护者确认方案
- `已完成`：内容已经落实，对应 Issue 已关闭或无需继续执行
- `阻塞`：需要外部条件、真实环境或人工操作才能继续

## 当前事项

### Issue #20 — main 分支保护、仓库公开状态与仓库简介

**状态：维护者已确认；平台设置阻塞**

已确认事实：

- main 当前 `protected: false`，GitHub 平台没有强制 PR / required checks
- 仓库简介仍保留旧的“8000 生产 + 8001 沙盒”描述，与当前架构不一致
- 仓库当前为 Public（`private: false`）

需要维护者确认：

1. 是否给 main 开启分支保护；
2. 是否要求关键 CI 通过后才能进入 main；
3. 是否保留管理员应急绕过能力；
4. 是否把仓库简介更新为“Test + Production 两环境 + 统一 8000 端口”；
5. CoffeeBear 是否继续保持 Public，还是改为 Private。

平台设置仍待具备对应 GitHub 管理接口后执行；在此之前不宣称已启用保护或改为 Private。

### Issue #21 — sandbox / 旧 hotfix / 历史分支清理

**状态：维护者已确认；sandbox 删除阻塞**

已完成分支审计：

- `sandbox` 是 main 的祖先，main 已比它前进 43 个 commit，`sandbox` 没有独有 commit；从 Git 历史角度可安全删除分支指针
- `hotfix/docker-release-baseline` 与 main 已 diverged，仍有 1 个独有 commit；不自动删除
- `running-state-20261009` 与 main diverged，仍有 1 个独有 commit；不自动删除
- `archive/develop` 与当前 main 无共同祖先，属于历史 / 迁移 lineage；不自动删除
- 另有多批旧 feature / hotfix / backup 分支，需要按“是否已合入、是否有独有 commit、是否仍承担回滚/归档用途”逐个处理

维护者已确认，当前执行结果：

1. `sandbox` 已确认可删除，但当前工具没有删除远程分支接口，尚未执行；
2. 旧 feature/hotfix 继续逐个审计，不批量删除；
3. backup/archive 按确认策略保留周期、转 tag 后再决定删 branch。

### Issue #18 — Docker 正式发布基线加固

**状态：配置 / CI / GHCR 双架构基线已完成；真实 Docker Test 目标主机验收阻塞**

已经完成：

- ✅ `deploy/zspace/production.env.example` 正式镜像改为 `ghcr.io/jinfenghua1990/coffeebear:stable`
- ✅ `deploy/zspace/test.env.example` 作为两环境模型下的 Test Docker 示例
- ✅ 删除旧 `deploy/zspace/staging.env.example`
- ✅ 候选镜像同时构建 `linux/amd64` 与 `linux/arm64`
- ✅ CI 增加发布配置防回退检查
- ✅ Docker / ZSpace / 基础设施文档统一 Test + Production 语义
- ✅ 旧 PR #19 已关闭，避免旧分支覆盖当前 main
- ✅ GitHub Actions CI run #75 全部通过：Frontend、Deployment image、Compose、Alembic migration、migration drift、备份恢复、目标测试、全量 backend pytest、pyflakes budget 均通过
- ✅ GHCR 双架构镜像真实构建并推送成功：Container Candidate run `38074782735`
- ✅ 镜像 `ghcr.io/jinfenghua1990/coffeebear:sha-3fc6b09e346791f972ad5ac1be5d0447bbef9537`
- ✅ Manifest digest：`sha256:3e2eba9b5251a24e604127f0eac84dae6e71b5c6229654f9245e45929482e7aa`

仍未完成：

- ⏳ 在具备 Docker 的真实 Test 目标主机运行 Compose
- ⏳ 从 GHCR 在目标 Test 主机实际拉取候选镜像
- ⏳ 实际执行真实 Test 数据库 migration
- ⏳ `/healthz` 健康检查
- ⏳ 采购、库存、财务等核心业务 smoke test
- ⏳ 确认目标主机能自动选择并运行正确架构镜像
- ⏳ 将实际镜像 SHA、版本、验证结果和回滚点写回 Issue #18

因此 #18 暂不关闭。

注意：

- 当前系统更新器属于 Git / 原生运行模式，不能直接在业务容器内开启
- 不应为了后台【更新】按钮而直接把 Docker socket 暴露给业务容器
- 容器化自动更新需要单独设计与确认

### Issue #48 — 采购主档保存与 Q4 镜像更新

**状态：工作分支实现中；PR CI 与 NAS 实机验收待确认**

已定位：

- 采购详情把主档保存与 SKU 明细编辑共用同一个状态判断，后续采购状态会错误禁用主档保存。
- 主档写入后再创建 / 关联入库单，第二步失败可能被误报为整单保存失败。
- 旧 `deploy/update-q4.sh` 只拉 Git 源码并运行 `docker compose up --build`，没有明确更新 Production GHCR 镜像，也没有迁移和健康检查闭环。

本轮处理：

- 分离主档保存与 SKU 明细编辑权限，关闭订单仍只读；已有实际入库后锁定仓库。
- 对入库前置条件先校验，明确展示“主档已保存但入库处理失败”的部分成功结果。
- 移除不可用的“保存草稿”按钮，优化入库候选弹层的提示和失焦关闭行为。
- Q4 脚本改为部署不可变镜像，先备份 PostgreSQL / DATA_DIR，再迁移、更新 API、检查健康状态并恢复 worker/beat。
- CI 增加更新脚本语法和关键流程静态检查。

未完成：

- 等待 PR CI 结果。
- 真实极空间 NAS 上的备份恢复、Compose、迁移、健康检查和核心业务回归尚未执行。
- 未在 NAS 上实际切换镜像；不得把仓库修改描述为已部署。

## 已完成事项

### Issue #17 — AI Agent 操作日志与决策记录规则

**状态：已完成并关闭**

已经落地：

- 根 `AGENTS.md`
- `.github/AGENTS.md`
- `docs/AI-INSTRUCTIONS.md`
- `docs/AGENT_WORKFLOW.md`
- `docs/DECISIONS.md`
- `docs/CURRENT_STATE.md`
- `docs/ACTIVE_WORK.md`
- Issue / PR 模板
- README 入口规则

后续要求：机器人每次重要工作继续留下 Issue / PR / Commit / 文档记录。

### Issue #16 — 两环境模型（Test + Production）

**状态：已完成并关闭**

已经落地：

- README 环境说明
- 根 `AGENTS.md` 与 `.github/AGENTS.md` 强制约束
- `docs/ENVIRONMENT.md`
- `docs/INFRASTRUCTURE.md`
- `docs/DECISIONS.md`
- Docker / ZSpace 文档统一 Test + Production 语义

固定规则：

- Test = 开发 / 测试合并环境
- Production = 唯一正式运行环境
- 不新增独立长期 Staging，除非先创建 Issue 并得到维护者明确批准
- 历史 `APP_ENV=staging/development` 仅视为 Test 内部兼容运行值，不代表第三套环境

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


### Issue #59 — Neon / R2 统一数据源与内部域名（2026-10-22）

**状态：目标已确认；实施未完成**。Neon PostgreSQL 为目标唯一主数据库，Cloudflare R2 为目标唯一业务对象存储。NAS 现状先保留，免费云服务器尚未选定，本轮不部署、不切换线上流量。内部域名目标为 `coffee.alsvidbike.com`，启用前必须配置 Cloudflare Access 邮箱 allowlist、Coffee 自身登录和源站保护。

未完成：Neon 数据迁移与核对、业务文件 R2 适配、共享队列/唯一 Beat、更新器云库备份恢复、DNS/Access 实际配置和实机验收。生产 Compose 仍有本地 PostgreSQL/Redis 与 `DATA_DIR` 依赖；禁止把文档更新当成生产切换。具体清单见 `docs/NAS_CLOUD_SHARED_DATA.md`。
