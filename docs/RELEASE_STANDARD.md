# 平台发布标准

## 1. 一个代码源，两套环境

本项目只维护一套代码仓库，不为测试版和正式版复制两套代码。对外只有 Test 与 Production 两套环境（见 `docs/DECISIONS.md` DEC-001），不维护独立 Staging，也不维护长期集成分支。

标准发布链路（单分支治理，`main` 是唯一长期分支）：

```text
工作分支 fix/* feat/* feature/* hotfix/* chore/* docs/* codex/*
        ↓  推送即构建不可变镜像 sha-<commit>，并把 candidate 指向它
   Test 环境验证（candidate）
        ↓  向 main 直接提 PR
       main
        ↓  合并时把已验证的同一不可变镜像晋升为 stable
 Production 正式环境
```

- `main`：唯一长期分支、生产分支，只有通过验证的版本可以进入。
- `fix/*` `feat/*` `feature/*`：普通缺陷修复与功能开发。
- `hotfix/*`：生产紧急修复，同样直接向 main 提 PR。
- `chore/*` `docs/*` `codex/*`：维护、文档与 AI 工作分支，完成后直接向 main 提 PR，不作为长期分支。
- 推送工作分支即产出不可变镜像 `sha-<commit>` 并让可变 `candidate` 指向它；PR 合并进 main 时**不重建镜像**，只把已验证镜像原样晋升为 `stable` 并生成版本号。

## 2. 测试版与正式版不是两套代码

正常情况下，同一提交先在 Test（`candidate`）验证，再晋级到 Production（`stable`）。

版本测试通过后，不重新修改代码再发布正式版；如果测试中发现问题，应产生新的提交和新的候选版本重新测试。

## 3. 发布版本号

用户可见版本使用北京时间时间码：

```text
vYYYY.MM.DD.HHmmss
```

Git SHA 继续作为技术追溯标识。

数据库结构版本由 Alembic revision 独立管理。仅 UI 或业务代码变化时，不应制造无意义数据库迁移。

## 4. 发布门禁

进入 main 前必须满足：

1. CI 全绿；
2. Alembic migration check 通过；
3. 后端测试通过；
4. 前端 TypeScript 与生产构建通过；
5. 备份可生成且 restore-check 可恢复；
6. smoke test 通过；
7. 如有数据库迁移，必须先完成备份；
8. 发布说明明确新增、优化、修复、数据库变化与风险。

本机可执行：

```bash
make release-check
```

## 5. 发布与回滚

### 数据库连接职责

- API / worker / beat 使用 `DATABASE_URL`；
- Alembic / migrate 阶段优先使用 `MIGRATION_DATABASE_URL`；
- `MIGRATION_DATABASE_URL` 未配置时暂时兼容回退 `DATABASE_URL`，用于旧实例平滑迁移；
- 一旦配置独立迁移连接，它必须与业务连接指向同一个 host / port / database，仅用户名和权限边界不同；
- 生产环境完成角色拆分后，不再允许 API 容器拥有 DDL/owner 权限。

正式发布固定顺序：

```text
锁定业务写入
→ 暂停 worker/beat
→ PostgreSQL + DATA_DIR 备份
→ 校验备份
→ 切换目标版本
→ 独立 migrate 阶段执行 Alembic migration
→ 构建前端
→ 启动 API
→ 健康检查
→ 恢复 worker/beat
→ 解除维护模式
```

失败时优先恢复到上一个稳定版本。数据库发生不可逆变更时，以发布前备份作为最终灾备边界。

## 6. 环境隔离

Test 与 Production 必须使用不同的：

- DATABASE_URL / 数据库；
- Redis；
- DATA_DIR；
- BACKUP_DIR；
- LOG_DIR；
- 外部系统测试凭证或沙盒账号（存在时）。

严禁测试环境连接生产数据库做写入测试。

## 7. 更新通道

镜像通道由工作流与 CI 门禁强制，不依赖运行时的分支切换：

- 测试实例：`APP_IMAGE` 使用 `candidate`，指向最近一次工作分支构建；
- 正式实例：`APP_IMAGE` 使用 `stable` 或晋升发布产生的 `vYYYY.MM.DD.HHmmss`；
- `deploy/zspace/test.env.example` 必须为 `candidate`、`deploy/zspace/production.env.example` 必须为 `stable`，由 CI 的 Release configuration policy 门禁校验。

发布采用“构建一次、同一不可变构建产物晋级”：工作分支构建 `sha-<commit>`，合并进 main 后原样 re-tag 为 `stable`，不在部署端重建镜像。
