# CoffeeBear AI / Coding Agent 强制规则

> 本文件位于仓库根目录，是代码机器人进入 CoffeeBear 时的最高优先级项目规则之一。适用于整个仓库。

## 一、仓库边界（强制）

CoffeeBear 只承载“卖咖啡的熊”中国国内业务，是国内经营系统长期事实来源。

允许进入本仓库：

- 1688
- 吉客云 / JackYun
- 国内采购、库存、生产、销售、物流
- 国内银行、对账、税务、财务、月结
- Business Partner / Partner 360
- 国内应收 / 应付 Open Items
- 国内电商平台 / 渠道结算

禁止新增或恢复：

- ALSVID 自行车产品、车辆、经销商、售后运行时
- Shopify / ALSVID OMS
- 出口库存、德国 / 欧洲仓库逻辑
- 国际运输、出口报关、进口合规
- 外贸财务、进口 VAT、反倾销 / 反补贴税、出口退税运行时

这些属于 `jinfenghua1990/ALSVID`。

`jinfenghua1990/ChaiBen-OS` 已退休，只可用于迁移证据或历史边界核对，不得把旧的混合架构重新复制回 CoffeeBear。

历史 Alembic migration 中仍可能出现 ALSVID / 外贸表名，这是数据库升级历史，不代表当前运行时归属。没有明确 Production baseline / cutover 计划时不得删除或重写历史迁移链。

## 二、GitHub 是唯一事实来源

重要项目决策、当前状态和工作过程必须进入 GitHub。

禁止只依赖：

- 聊天历史
- AI 记忆
- 上一次会话总结
- 没有回写仓库的口头结论

重要工作必须通过 Issue / PR / Commit / docs 留下可追溯记录。

## 三、每次开工前必须读取

按顺序：

1. `README.md`
2. 根目录 `AGENTS.md`（本文件）
3. `.github/AGENTS.md`
4. `docs/AI-INSTRUCTIONS.md`
5. `docs/ARCHITECTURE.md`
6. `docs/CURRENT_STATE.md`
7. `docs/ACTIVE_WORK.md`
8. `docs/DECISIONS.md`
9. `docs/ENVIRONMENT.md`
10. `docs/DEPLOYMENT.md`
11. `docs/DATABASE.md`
12. 与任务有关的其他 docs
13. 相关 Open Issues / Pull Requests
14. 最新 main 上的真实代码 / 配置

如果文档之间冲突，不得自行挑一个执行；先核对最新代码和 Issue，仍无法确定则创建 Issue 让维护者裁决。

## 四、机器人过程记录强制要求

除纯拼写等无业务含义的小修正外，重要任务必须记录：

- 检查了什么
- 读取了哪些关键文件
- 当前确认的事实
- 修改了什么
- 为什么修改
- 执行了什么验证
- 验证结果
- 哪些验证受环境限制没有执行
- 新发现的问题
- 遗留风险 / 下一步

禁止只有“已完成 / 已修复”而没有验证证据。

## 五、不确定事项不得自行决定

以下内容不明确时必须先 Issue + 维护者确认：

- 系统架构
- 环境数量 / 用途
- 数据归属 / 数据模型
- 数据库重大设计
- 部署策略
- 权限 / 安全策略
- 财务 / 税务 / 库存 / 订单核心规则
- 业务事实来源

标准流程：

1. 写当前事实。
2. 写方案 A / B（必要时更多）。
3. 写各方案影响、风险、成本。
4. 给出推荐方案和理由。
5. 明确写“需要维护者确认什么”。
6. 等待确认。
7. 实施确认方案。
8. 更新长期文档和工作记录。

## 六、环境规则（强制）

CoffeeBear 对外只维护两套环境：

- **Test**：开发 / 测试合并环境
- **Production**：唯一正式业务运行环境

禁止引入独立长期 Staging，除非先通过架构决策 Issue 并获得维护者明确批准。

代码中历史 `APP_ENV=staging/development` 可以暂时作为 Test 内部兼容运行值，但它们**不是第三套长期环境**。

详见 `docs/ENVIRONMENT.md`。

## 七、端口与系统形态

- 整个业务系统只有一个公开应用端口：`8000`
- FastAPI + Next.js 静态导出保持同端口
- 新业务模块通过路由扩展
- 不为业务模块新建 8001 / 8002 / 9001 等独立应用
- 保持模块化单体，不因为“架构先进”擅自拆微服务

详见 `docs/ARCHITECTURE.md` 和 `docs/AI-INSTRUCTIONS.md`。

## 八、数据库与敏感信息

涉及数据库必须遵守 `docs/DATABASE.md`：

- Alembic 管理 schema 迁移
- Test 先验证
- Production 前确认备份 / 恢复路径
- 不把手工改 Production schema 当正常流程
- 不删除历史 migration 掩盖分叉

禁止提交真实：密码、Token、Cookie、API Key、数据库密钥、对象存储密钥、Production 管理员凭据。

## 九、验证结论必须分级

严格区分：

- 已检查
- 已修改
- 静态验证通过
- Test 实际运行验证通过
- Production 真实验收通过
- 部分完成
- 阻塞
- 待维护者确认

没有 Docker 的执行环境不能宣称 Docker 启动通过；没有进入 Production 就不能宣称 Production 已验收。

## 十、Git / GitHub 效率规则

GitHub Actions 分钟有限。一个连续的用户修改回合默认应：

1. 先检查所有相关文件。
2. 规划完整修改集合。
3. 一次性修改相关文件。
4. 在能力允许时只做一个 Commit / 一次 Push。

不要：

- 文件改一个就 push 一次
- 把远程 CI 当编辑器循环使用
- 为一次小补丁临时创建 workflow
- 为了触发 CI 反复 merge / rebase

通过 GitHub API 修改多个文件时，如果 Git-data 批处理能力可用，应优先使用 blob → tree → commit → ref 的单提交方式，而不是每个文件一个 commit。

如果工具能力不支持批处理，应在工作记录中如实说明。

## 十一、CI 使用规则

重型 CI 用于验证，不用于探索基本编辑错误。

Push 前优先做：

- 调用点 / 依赖检查
- 有条件时执行最小相关测试
- 将同一轮发现的问题合并处理

文档 / 机器人规则专用提交且不影响运行时、部署、migration、安全、依赖时，可以使用 `[skip ci]`；应用代码、数据库、Docker、部署、依赖、安全相关修改禁止用 skip 绕过应有验证。

## 十二、分支和发布安全

- 开发修改尽量批量完成
- PR / merge / release 边界执行完整验证
- Production 使用经过测试 / 晋级的制品路径
- 不创建无意义临时分支
- 不为省 Actions 而绕过发布安全检查

## 十三、完成任务前必须收尾

检查是否需要更新：

- 对应 Issue / PR
- `docs/CURRENT_STATE.md`
- `docs/ACTIVE_WORK.md`
- `docs/DECISIONS.md`
- `docs/ENVIRONMENT.md`
- `docs/DEPLOYMENT.md`
- `docs/DATABASE.md`

最终报告至少说明：

- 修改了什么
- 对应 Commit SHA / 分支
- 实际验证结果
- 是否触发 / 预计触发 CI
- 剩余需要在 PR / Release / Production 完成的验证

## 十四、文档语言

项目治理、进度、决策、风险和面向维护者的说明默认使用中文。

代码、变量名、API、命令、文件路径和标准技术术语可保留英文。

## 多设备与多 AI 协作规则（2026-10-18）

- 开工先读取当前 main、相关开放 PR 和工作树状态；已有任务优先续接原分支/PR，禁止从过期聊天快照覆盖代码。
- 一项任务一个短期分支和 PR；不要直接推送 main。换电脑优先重开同一个 Codespace；独立 AI 工作区只通过已推送的提交、分支和 PR 交接。
- 修改前 fetch 最新远端；脏工作树先保留并确认归属，不得 reset --hard、清理未跟踪文件、覆盖他人修改或强推共享分支。发现同文件并行工作先在 PR 说明并协调。
- 提交前检查 diff、密钥与相关验证；推送前再次检查远端分支，处理冲突并复验。禁止为了过 CI 而弱化检查。
- 交接写清仓库、分支、基准/当前 SHA、PR、已修改文件、验证结果、未提交内容和下一步。未提交修改不是 GitHub 备份。
- AGENTS.md 只约束实际读取并遵循它的工具；权限、分支保护和 CI 才能提供服务器侧约束。不得宣称所有机器人会自动读取。
- 不提交生产凭据或真实业务数据；代码回滚不等于数据库、对象存储和运行数据恢复。

## 本仓库适用边界

保留本仓库国内业务边界与 docs/RELEASE_STANDARD.md 的候选镜像 → 测试 → main 晋升流程，不复制 ALSVID 的 Cloud Run 发布或 Node 单体 devcontainer。云端空间只能承载隔离开发/测试，不新增长期业务环境，不使用生产凭据。

2026-10-18 审查时 main 显示未保护、rulesets 为空、没有开放 PR。完整保护接口返回 403，当前连接无管理设置写入工具。管理员需在 Settings → Branches 为 main 要求 PR、现有 CI 检查（如适用）、禁止 force push/delete 并核实绕过权限；保存后重新验证。本文件不能替代服务器保护。

恢复：已提交代码可从 History 找到 SHA，在恢复分支用 git revert 撤销错误提交或 git restore --source=<good-sha> -- <file> 恢复文件，再走 PR。不要强推重写 main。数据库、对象文件、运行数据和密钥需单独备份与隔离恢复演练。交接必须先 commit/push；独立 AI 看不到未提交编辑。
