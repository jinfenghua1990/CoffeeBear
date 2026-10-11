# CoffeeBear 环境规范

## 1. 总体原则

CoffeeBear 采用**两环境模型**，不采用传统的 Dev / Staging / Production 三环境模型。

固定为：

1. **Test（开发 / 测试合并环境）**
2. **Production（正式环境）**

这是已经确认的项目决策，记录于 GitHub Issue #16 和 `docs/DECISIONS.md`。

## 2. Test 环境

### 用途

Test 用于：

- 新功能开发验证
- 功能测试
- Docker 构建验证
- Docker 启动验证
- 数据库迁移验证
- 发布前检查
- 与 Production 行为尽量一致的技术验证

### 当前目标形态

- M1 Mac + Docker
- 非生产数据库
- 非生产对象存储
- 非生产密钥

### 规则

- 不使用 Production 真实业务数据库作为默认 Test
- 不把 Production 用户数据直接当测试数据使用
- Test 不作为长期独立业务环境运行
- Test 的目的是真实验证 Production 发布前行为，而不是额外维护一套长期云环境

## 3. Production 正式环境

Production 是 CoffeeBear **唯一正式业务运行环境**。

正式环境包含：

- 正式运行服务器 / Runtime
- Production 数据库
- Production 对象存储
- Production 环境变量与密钥
- 正式业务数据

仓库当前包含 `deploy/zspace/` 下的 Production Docker 编排与示例配置。

## 4. 明确不采用的模式

默认禁止：

- 单独维护 Staging
- 同时长期维护 Dev / Test / Staging / Production 多套环境
- 因为某个机器人习惯传统企业架构，就自行增加第三套长期环境

## 5. 为什么采用两环境

当前项目阶段采用两环境的目的：

- 降低单团队 / AI 协作阶段的运维复杂度
- 避免数据库、对象存储、环境变量产生多套漂移
- 降低环境维护成本
- 让 Test 尽量贴近真实 Production
- 把精力放在真实业务和正式发布质量上

## 6. 环境资源隔离

Test 与 Production 至少需要隔离：

- 数据库
- 对象存储
- 密钥
- 管理员凭据
- 外部服务测试 / 正式配置（如服务支持）

不得因为“方便”让测试代码直接连接正式资源。

## 7. 环境变量规则

仓库可以提交：

- `.env.example`
- `production.env.example`
- 示例变量名
- `CHANGE_ME` 占位值

仓库不得提交真实：

- 数据库密码
- 应用密钥
- API Token
- 对象存储密钥
- 管理员密码
- Cookie / Session 密钥

## 8. 修改环境模型的流程

任何人或机器人如果认为未来需要第三套长期环境，必须：

1. 创建 GitHub 架构决策 Issue。
2. 写明为什么现有 Test + Production 无法满足需求。
3. 写明新增环境的成本、维护责任、数据库与对象存储方案。
4. 写明替代方案。
5. 等待维护者明确确认。
6. 确认后更新 `docs/DECISIONS.md`、本文件和相关部署文件。

在完成上述流程前，不得自行实施。

## 9. 相关文档

- `README.md`
- `.github/AGENTS.md`
- `docs/CURRENT_STATE.md`
- `docs/ACTIVE_WORK.md`
- `docs/DECISIONS.md`
- `docs/DEPLOYMENT.md`
- `docs/DATABASE.md`
