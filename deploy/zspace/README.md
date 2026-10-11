# 极空间 ZSpace 部署标准

> CoffeeBear 对外只维护 **Test + Production** 两套环境。本目录中的历史 `staging` 命名仅作为 Test 内部兼容标识，不代表第三套长期环境。

## 1. 目标发布链

```text
GitHub develop
  → CI
  → ghcr.io/jinfenghua1990/coffeebear:sha-<commit>
  → Test 验证

develop → main PR 合并
  → 不重新构建业务代码
  → 将已经验证的 SHA 镜像晋级为 vYYYY.MM.DD.HHmmss + stable
  → Production
```

Test 与 Production 使用同一套应用镜像体系，但数据库、Redis、DATA_DIR、端口和密钥必须隔离。

## 2. 极空间目录

业务数据不得放在 Git 仓库目录中。建议结构：

```text
ecommerce/
  test/
    postgres/
    redis/
    data/
    backups/
  production/
    postgres/
    redis/
    data/
    backups/
```

历史已有 `staging/` 目录时，可以继续作为 Test 物理目录使用，但文档和项目语义统一称为 Test；不要因此再维护第三套环境。

实际宿主机路径由极空间存储池决定，本仓库不硬编码。

## 3. 私有镜像登录

GHCR 镜像保持受控访问。

在极空间 Docker 镜像仓库凭证中配置：

- Registry：`ghcr.io`
- Username：GitHub 用户名
- Token：只授予读取 Packages 所需权限

Registry 凭证不得写入应用 `.env`，也不得提交 Git。

## 4. Test

> 当前 `staging.env.example` 文件名属于历史兼容命名，语义上等同本项目 Test；后续如果安全完成配置迁移，可再统一重命名。

Test 部署：

1. 创建独立 Compose 项目目录。
2. 复制本目录 `docker-compose.yml`。
3. 使用 Test 配置（当前兼容文件：`staging.env.example`）生成实际 `.env`。
4. 填写 Test 独立数据库、应用密钥、管理员凭据和真实宿主机目录。
5. `APP_IMAGE` 使用 `candidate` 或具体不可变 SHA 候选。
6. 首次启用数据库最小权限时，先备份，再初始化 app / migrator 角色。

```bash
docker compose up -d postgres redis
docker compose --profile ops run --rm db-roles
docker compose --profile ops run --rm migrate
docker compose up -d api worker beat
```

`db-roles` 是显式运维动作，不跟随 API 自动执行。

Test 需要完成：

- `/healthz`
- 采购
- 库存
- 耗材
- 财务
- 数据库 migration
- 关键业务 smoke test

正式发布前应尽量将 `APP_IMAGE` 固定为本次候选不可变 SHA：

```text
ghcr.io/jinfenghua1990/coffeebear:sha-<commit>
```

## 5. Production

main 只接受符合仓库发布策略的来源分支。

正式发布应把已经 Test 验证的 SHA 镜像原样晋级，例如：

```text
ghcr.io/jinfenghua1990/coffeebear:vYYYY.MM.DD.HHmmss
ghcr.io/jinfenghua1990/coffeebear:stable
```

正式环境建议固定具体版本：

```text
APP_IMAGE=ghcr.io/jinfenghua1990/coffeebear:v2026.10.11.120000
```

不要长期只依赖 `stable` 做审计；`stable` 用于发现最新正式版，具体版本用于追踪和回滚。

## 6. 发布顺序

```text
确认数据库 / 文件备份
→ 拉取指定版本镜像
→ 暂停 worker / beat（按发布需要）
→ 必要时执行 db-roles
→ 执行 migrate
→ 更新 api / worker / beat
→ /healthz 验证
→ 核心业务 smoke test
→ 记录实际版本与验证结果
```

数据库迁移必须单独执行，不允许靠 API 容器启动隐式完成。

## 7. 回滚

应用优先切回上一已验证版本，不重新构建：

```text
v2026.10.11.120000
→
v2026.10.10.220000
```

如果包含数据库 migration，必须根据迁移兼容性决定 downgrade、向前修复或从发布前备份恢复。

禁止直接删除 PostgreSQL 数据目录作为“回滚”。

## 8. 更新中心

容器模式下：

```text
SYSTEM_UPDATE_ENABLED=0
```

当前原生 Git 更新器不能直接等价用于 Docker 镜像升级。

版本发布由 GitHub + GHCR + Compose 管理。未经单独安全设计，不允许为了后台【更新】按钮直接向业务容器暴露 Docker socket。

未来容器自动更新需要单独 Issue 设计：

- 镜像发现
- 版本固定
- 拉取
- migration
- 健康检查
- 回滚
- 宿主权限隔离

## 9. 安全边界

- PostgreSQL 不对局域网暴露业务不需要的端口
- API / worker / beat 使用 app 数据库账号
- migrate 使用 migrator 账号
- `POSTGRES_USER` 仅用于部署 / 管理兜底
- Redis 不对局域网暴露业务不需要的端口
- 只暴露 Web/API 必需端口
- `.env` 不提交 Git
- Test 永远不用 Production 数据库密码和 DATA_DIR
- Production 数据至少保留本机备份 + 第二份异地 / 异盘备份

## 10. 当前未完成验收

当前 Production Docker 基线的活动事项以 GitHub Issue #18 为准。

静态配置修正、Workflow 修改完成，不代表真实 Docker 环境已经验收完成；最终仍需在具备 Docker 的真实环境做启动与业务验证。
