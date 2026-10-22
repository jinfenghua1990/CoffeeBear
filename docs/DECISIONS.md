# CoffeeBear 长期决策记录

本文件保存已经被维护者接受、未来机器人和开发者必须继续遵守的长期项目决策。

GitHub Issue / Pull Request 保存讨论和实施过程；本文件保存最终已经确认的“长期规则”。

## 阅读规则

在修改以下内容前，机器人必须阅读本文件：

- 系统架构
- 环境策略
- 数据归属
- 数据库重大设计
- 部署方式
- 核心业务规则

如果现有决策不清楚、互相冲突或已经不适合当前情况：

1. 不得自行覆盖旧规则。
2. 创建或更新 GitHub Issue。
3. 说明当前事实、方案与影响。
4. 由维护者确认新方案。
5. 实施后更新本文件。

聊天中的新结论不能静默替换本文件中的已接受决策。

---

## DEC-001 — 只维护 Test + Production 两套环境

**状态：已接受**  
**来源：GitHub Issue #16 — `docs: establish two-environment model (Test + Production)`**

### 决策

CoffeeBear 只维护两套运行环境：

- **Test**：开发 / 测试合并环境，用于功能验证、Docker 验证、数据库迁移验证和发布前检查。
- **Production**：唯一正式业务运行环境。

CoffeeBear 不长期维护独立 Staging，也不采用 Dev / Staging / Production 三环境模型。

### 当前目标形态

- Test 计算环境：M1 Mac + Docker
- Test 数据资源：独立非生产数据库与对象存储（适用时）
- Production：正式 Runtime / Server + 正式数据库 + 正式对象存储 + 正式密钥

### 强制边界

任何新增长期环境的提议必须先：

1. 创建架构决策 Issue。
2. 说明必要性与成本。
3. 分析对数据库、对象存储、部署和维护的影响。
4. 获得维护者明确批准。

批准前禁止实施。

---

## DEC-002 — GitHub 是 AI 协作与项目决策的事实来源

**状态：已接受**  
**来源：GitHub Issue #17 — `docs: establish AI Agent operation log and decision record rules`**

### 决策

GitHub 是 CoffeeBear 项目决策、当前状态和重要实施历史的事实来源（Single Source of Truth）。

聊天历史不能单独承担长期项目记忆。

所有 AI Agent、Review Bot、开发机器人和自动化工具执行重要工作时，都必须通过合适的 GitHub 载体留下记录，包括：

- Issue
- Pull Request
- Commit message
- 长期文档更新

### 重要工作必须记录

根据任务性质记录：

- 检查了什么
- 读取了哪些关键文件
- 修改了什么
- 为什么修改
- 执行了什么验证
- 验证结果
- 因环境限制未完成的验证
- 发现的问题
- 遗留风险 / 未解决事项

禁止只写“已经完成”而没有可核对证据。

### 不确定事项规则

机器人在以下内容不确定时，不得独立发明或替换项目政策：

- 架构
- 数据归属 / 数据模型
- 环境策略
- 部署策略
- 权限 / 安全策略
- 核心业务规则

标准流程：

1. 创建或更新 GitHub Issue。
2. 描述当前事实。
3. 描述可选方案、影响和风险。
4. 给出推荐方案。
5. 明确列出需要维护者确认的问题。
6. 获得维护者确认。
7. 实施已经确认的方案。
8. 更新长期文档和工作记录。

---

## DEC-003 — 项目治理文档默认使用中文

**状态：已接受**

### 决策

为了让维护者能够直接审阅、确认和纠正机器人工作，以下内容默认使用中文：

- 当前状态
- 当前工作
- 环境规则
- 部署规则
- 数据库规则
- 架构 / 重大决策
- AI Agent 工作规范
- 风险与验收结论
- Issue / PR 中面向维护者的说明

代码、变量名、API、命令、文件路径和标准技术名词可以保留英文。

### 原因

项目规则如果只有机器人能快速理解而维护者难以直接审核，就无法形成可靠的人机协作治理。

---

## 治理文件关系

- `README.md`：项目入口、业务边界与高层规则
- `.github/AGENTS.md`：AI 机器人强制工作规则
- `docs/CURRENT_STATE.md`：现在做到哪里、当前真实状态
- `docs/ACTIVE_WORK.md`：当前正在做什么
- `docs/AGENT_WORKFLOW.md`：机器人执行和记录流程
- `docs/ENVIRONMENT.md`：两环境规范
- `docs/DEPLOYMENT.md`：部署与发布规范
- `docs/DATABASE.md`：数据库变更规范
- `docs/DECISIONS.md`：已经确认的长期决策（本文件）

如果这些来源出现冲突：

1. 机器人不得自行猜测哪个是对的。
2. 先核对最新代码、Issue、PR 和 Git 历史。
3. 仍无法确定时，创建 / 更新 Issue 请求维护者裁决。
4. 裁决后同步修正文档，避免冲突继续存在。


---

## DEC-004 — NAS 应用运行 + 云端唯一数据源，云服务器可接管（2026-10-22）

**状态：已接受（架构目标）；未完成 Production 迁移与验收**  
**来源：维护者明确确认；GitHub Issue #59**

### 决策

- NAS 继续作为 CoffeeBear 的本地日常应用运行端，短期不升级 NAS 内存；不得为更新而在 NAS 上重构建完整镜像。
- 将 Production **唯一业务数据库**规划为云端 PostgreSQL（本轮沟通按 Supabase），唯一业务附件对象存储规划为 Cloudflare R2；云端 Redis 为共享任务队列候选，提供方待实际确认。
- 云服务器可部署同版本 CoffeeBear 作为 Production **备用计算节点**，NAS 与云服务器直接访问同一云端正式数据，不做两套独立业务数据库双向同步。
- 与 DEC-001 兼容：两计算节点均属于一个 Production，不代表两个 Production，也不允许 Test 连接正式库。
- 只允许一个活跃 Celery beat / 数据库迁移执行者；固定 GHCR 不可变镜像，严格校验数据库迁移兼容性。
- 旧本地 PostgreSQL、`DATA_DIR` 文件、R2 备份与现有更新器不能凭修改连接字符串就视为已迁移；必须按 `docs/NAS_CLOUD_SHARED_DATA.md` 清单化、改造、核对、演练后才能生产切换。

### 历史配置关系

旧 `docs/ENVIRONMENT.md` / README 中的 Cloud Run + Neon 方案属于历史阶段记录；2026-10-22 新决策优先，但**不证明目前实际运行数据库已更换**。旧 NAS Compose 保留直到正式迁移验收，以免中断业务。

### 现实边界

云数据库或外网不可用时 NAS 也会受影响；同一数据库不能自动解决 R2 业务文件改造、Redis/任务重复、程序版本差异或备份问题。Issue #59 保持 Open 到 Production 验收。
