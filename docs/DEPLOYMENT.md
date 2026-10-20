# CoffeeBear 部署规范

> 本文档定义 Test 与 Production 的部署边界、发布步骤、回滚原则和当前已知限制。

## 1. 环境原则

CoffeeBear 只维护两套环境：

- Test：开发、测试、迁移、Docker 验证
- Production：唯一正式业务运行环境

不默认维护独立 Staging 环境。

## 2. Test 部署

Test 的主要目标不是长期对外提供业务，而是尽可能接近 Production 完成验证。

建议形态：

- M1 Mac
- Docker
- 非生产数据库
- 非生产对象存储
- 非生产密钥

Test 至少需要验证：

- 应用能构建
- 容器能启动
- 健康检查正常
- 数据库连接正常
- Alembic migration 正常
- 前后端核心链路正常
- 依赖的外部服务未配置时不会伪造成功

## 3. Production 部署

Production 是唯一正式运行环境。

仓库当前提供：

- 根 `Dockerfile`
- Test 用 `docker-compose.yml`
- `deploy/zspace/docker-compose.yml` Production 编排
- `deploy/zspace/production.env.example` Production 环境变量示例
- GHCR 候选镜像 / 晋级相关 GitHub Actions 基础

### Production 密钥规则

真实 `.env`、数据库密码、应用密钥、管理员密码、对象存储密钥等不得提交到 GitHub。

仓库只能提交：

- `.env.example`
- `production.env.example`
- 变量名
- 示例值或 `CHANGE_ME`

不能提交真实值。

## 4. 标准发布流程

正式发布至少遵循以下顺序：

1. 确认相关 Issue / PR 已完成评审。
2. Test 完成功能、Docker 和数据库迁移验证。
3. 确认 CI / 构建检查通过。
4. 生成不可变的候选镜像标签。
5. 对涉及数据库迁移的版本先做备份与回滚评估。
6. 在 Production 使用确认过的镜像标签发布。
7. 执行必要的数据库迁移。
8. 检查服务健康状态和核心业务链路。
9. 记录实际发布版本、验证结果和异常。
10. 验收无误后再把该版本视为稳定版本。

不建议只依赖可漂移的 `stable` 标签进行审计；正式发布应尽量记录具体不可变版本标签。

## 5. 回滚原则

应用回滚与数据库回滚分开考虑。

### 应用回滚

优先方式：切换回上一个已经验证的不可变镜像版本。

### 数据库回滚

数据库 migration 可能存在不可逆变更，因此不能简单假设应用回滚等于数据库回滚。

涉及高风险迁移时必须：

- 先备份
- 明确 migration 的向前兼容性
- 明确失败时恢复方案
- 必要时采用分阶段迁移

## 6. 当前发布验收状态

以 GitHub Issue #18 为 Docker / Production 基线验收事实来源。

已完成配置与 CI 基线：

- Production 镜像名统一为 `ghcr.io/jinfenghua1990/coffeebear`
- 候选镜像支持 `linux/amd64` 与 `linux/arm64`
- Compose、Alembic、备份恢复和发布配置检查已纳入 CI

仍未完成的真实环境验收：

- 在极空间 / NAS 的 Test 环境实际拉取并启动候选镜像
- 执行真实数据库迁移、`/healthz` 与采购 / 库存 / 财务 smoke test
- 记录目标设备架构、镜像摘要、验收结果和回滚点

Issue #48 同时修正了 Q4 更新脚本：Production 应部署已经发布的不可变镜像标签或 digest，不能在 NAS 上重建应用源码。新脚本与 Compose 逻辑仍需在真实 NAS 上演练后，才能视为 Production 更新流程验收通过。

在真实设备完成上述检查前，不得把静态检查或 GitHub CI 描述成 NAS / Production 实机验收通过。

## 7. 后台更新功能边界

当前容器编排显式关闭 `SYSTEM_UPDATE_ENABLED`。

现有更新器是 Git / 原生运行模式更新器，不能直接等价用于 Docker 镜像更新。

未经单独设计和确认，不允许：

- 为了实现后台更新按钮直接把 Docker socket 暴露给业务容器
- 让业务容器拥有不必要的宿主机控制权限

未来如果实现 Docker 自动更新，应单独创建 Issue，设计：

- 镜像发现
- 版本选择
- 拉取
- 迁移
- 健康检查
- 回滚
- 权限隔离

## 8. 发布记录要求

每次重要 Production 发布至少记录：

- Issue / PR
- Commit / 镜像版本
- 数据库 migration 版本
- 发布时间
- 验证项目
- 验证结果
- 是否回滚
- 遗留风险

这些记录应保存在 GitHub，而不是只存在聊天记录里。
