# 极空间 ZSpace 部署标准

本目录用于 CoffeeBear 的 **Test / Production 两环境** Docker 部署。

> 重要：CoffeeBear 不维护独立长期 Staging。历史代码里的 `APP_ENV=staging` 仅作为 Test 的兼容运行值，不代表第三套环境。

## 目标结构

```text
GitHub develop / hotfix
  -> CI
  -> ghcr.io/jinfenghua1990/coffeebear:sha-<commit>
  -> Test 验证

确认通过后
  -> main / 正式发布
  -> 将已验证的 sha 镜像晋级为 vYYYY.MM.DD.HHmmss + stable
  -> Production
```

Test 与 Production 使用同一套应用镜像体系，但数据库、Redis、DATA_DIR、端口和所有密钥必须完全隔离。

## 极空间目录

不要把数据放在 Git 仓库目录中。建议创建：

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

实际宿主机绝对路径因极空间存储池而异，本仓库不硬编码。

## 私有镜像登录

仓库和 GHCR 镜像保持 Private 时，在极空间 Docker 的镜像仓库凭证中添加：

- Registry: `ghcr.io`
- Username: GitHub 用户名
- Token: 只授予读取 Packages 所需权限

不要把 Registry 凭证写进应用 `.env`，也不要提交到 Git。

## Test

1. 创建独立 Compose 项目目录。
2. 复制本目录 `docker-compose.yml`。
3. 将 `test.env.example` 复制为 `.env`。
4. 填写独立数据库密码、`APP_SECRET_KEY`、管理员密码和极空间真实目录。
5. `APP_IMAGE` 可先使用 `candidate` 或本次候选的不可变 SHA 标签。
6. Test 不得复用 Production 数据库、密码、DATA_DIR 或业务密钥。
7. 首次启用数据库最小权限时，先备份，再初始化 app / migrator 两个角色：

```bash
docker compose up -d postgres redis
docker compose --profile ops run --rm db-roles
docker compose --profile ops run --rm migrate
docker compose up -d api worker beat
```

`db-roles` 是显式运维动作，不会跟随 API 自动执行。

8. 浏览器访问 `NAS_IP:8100`。
9. 执行采购、库存、耗材、财务等核心业务回归。
10. 准备正式发布前，将 `APP_IMAGE` 固定为本次候选的不可变 SHA 标签：

```text
ghcr.io/jinfenghua1990/coffeebear:sha-<commit>
```

## Production

正式发布必须使用已经通过 Test / CI 验证的镜像，不应在 Production 临时重建代码。

正式版本示例：

```text
ghcr.io/jinfenghua1990/coffeebear:v2026.10.11.120000
ghcr.io/jinfenghua1990/coffeebear@sha256:<64位镜像摘要>
```

Production 的 `APP_IMAGE` 必须固定到已发布版本标签或 digest；`stable` 仅用于发现最新版，不作为正式部署目标。

发布顺序：

```text
确认数据库/文件备份
-> 拉取指定版本镜像
-> 暂停 worker/beat
-> （首次拆分账号或轮换密码时）运行 db-roles
-> 执行 migrate
-> 更新 api
-> /healthz 验证
-> 恢复 worker/beat
-> 核心业务 smoke test
-> 将验证结果写回 GitHub Issue / PR
```

## 回滚

应用回滚优先切换 `APP_IMAGE` 到上一已知可用版本，不重新构建。

如果版本包含数据库迁移，必须先判断 migration 是否向后兼容；需要恢复数据时使用发布前备份。禁止直接删除 PostgreSQL 数据目录。

## 极空间 Q4 更新脚本

正式容器通过 GHCR 镜像更新，不在 NAS 上构建源码。`deploy/update-q4.sh` 仅接受已发布的不可变版本标签或镜像摘要，执行前会备份 PostgreSQL 与 `DATA_DIR`，拉取目标镜像、停止 api/worker/beat、执行 Alembic 迁移、更新 API、检查 `/healthz`，最后恢复 worker/beat。

合并到 `main` 后，`container-promote.yml` 会生成 GitHub Release 版本（如 `v2026.10.20.153000`）。在 NAS 终端进入 CoffeeBear 仓库目录，首次使用新脚本前先更新仓库中的运维脚本：

```bash
git pull origin main
./deploy/update-q4.sh ghcr.io/jinfenghua1990/coffeebear:v2026.10.20.153000
```

将示例版本替换为 GitHub Releases 中实际生成的版本；也可以传入 Release 提供的完整 `ghcr.io/jinfenghua1990/coffeebear@sha256:...` 摘要。不要传 `stable`、`candidate` 或 `latest`。

如果正式 Compose 项目目录不是仓库中的 `deploy/zspace`，请指定 NAS 上实际目录：

```bash
COFFEEBEAR_DEPLOY_DIR=/你的/正式Compose目录 ./deploy/update-q4.sh ghcr.io/jinfenghua1990/coffeebear:v2026.10.20.153000
```

默认要求 `.env` 与 `docker-compose.yml` 位于同一正式 Compose 目录。若路径不同，可分别通过 `COFFEEBEAR_COMPOSE_FILE`、`COFFEEBEAR_ENV_FILE` 指定。私有 GHCR 镜像需要先在 NAS 上登录 `ghcr.io`，并确保备份目录有足够剩余空间。

如果迁移失败，脚本会恢复原 `APP_IMAGE`，但 API/worker/beat 会保持停止，避免在数据库状态不确定时继续处理业务。请检查迁移日志、Alembic 当前版本和备份后，再决定恢复或重试。如果迁移后 API 健康检查失败，脚本也会停止 API；不会擅自回滚数据库。

## 更新中心

极空间容器模式下，应用内 Git 自更新保持关闭：

```text
SYSTEM_UPDATE_ENABLED=0
```

不要使用应用内【更新】按钮更新 NAS 容器，也不要用旧的 `git pull + docker compose up --build` 脚本代替镜像发布流程。

## 公网访问（可选）：Cloudflare Tunnel

`docker-compose.tunnel.yml` 为可选 overlay，无需在路由器开端口、不暴露 NAS IP、自带 HTTPS。

前置：一个托管在 Cloudflare 的域名（免费套餐即可）。

1. 本机取得 token：

```bash
cloudflared tunnel login
cloudflared tunnel create coffeebear
cloudflared tunnel route dns coffeebear coffee.yourdomain.com
cloudflared tunnel token coffeebear   # 长串 token
```

2. token 填入 `.env` 的 `CLOUDFLARED_TOKEN=`。
3. 启动（tunnel 不映射任何宿主机端口）：

```bash
docker compose -f docker-compose.yml -f docker-compose.tunnel.yml --profile public up -d tunnel
```

4. Cloudflare Zero Trust → Networks → Tunnels 显示 Healthy 后，`https://coffee.yourdomain.com` 即公网入口。建议叠加 Cloudflare Access 保护登录页；公网后 ADMIN_PASSWORD 必须强密码。

## 安全边界

- PostgreSQL 不映射到 NAS 局域网端口。
- Redis 不映射到 NAS 局域网端口。
- API / worker / beat 使用 app 数据库账号；migration 使用 migrator 账号。
- 只暴露 Web/API 端口。
- `.env` 不提交 Git。
- Test 永远不用 Production 数据库密码、DATA_DIR 或业务密钥。
- Production 数据至少保留本机备份 + 第二份异地/异盘备份。

## 当前验收状态

配置与 CI 层面的 Docker 发布基线已加固；真实 Docker 启动、migration、`/healthz` 与核心业务 smoke test 仍必须在具备 Docker 的实际 Test 环境完成，未执行前不得标记为“Production 已真实验收”。
