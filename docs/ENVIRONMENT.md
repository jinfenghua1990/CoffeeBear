# CoffeeBear 环境规范（目标与现状分开）

> 2026-10-22 已接受 DEC-004；跟踪 Issue #59。**目标状态不等于已经上线。**

## 环境数量

CoffeeBear 只保留 Test（开发验证）与 Production（唯一真实业务）两个逻辑环境。NAS 本地应用与备用云端应用是同一 Production 的两个运行节点，绝不是两套分别写入业务数据的正式环境。Test 必须使用隔离数据库、对象空间与密钥。

## 已确认目标

- Production 常用计算：NAS 的 CoffeeBear 容器；GHCR 预构建、固定不可变镜像，不在内存受限 NAS 本地构建。
- Production 备用计算：云服务器的相同 CoffeeBear 镜像，故障切换时接管应用入口。
- Production 唯一数据库：云端 PostgreSQL（按本轮决策规划 Supabase；云库是否已创建/连接需要实机核对）。
- Production 业务对象存储：Cloudflare R2；它不同于既有的 R2 备份归档接口。
- 任务队列：可从 NAS / 云备机访问的统一 Redis，供应商待落地核对；全 Production 只允许一个活跃 Celery beat。
- 代码与镜像：GitHub + GHCR；旧应用版本可能不兼容新 schema，需有发布与回滚纪律。

## 当前代码事实和重要限制

截至本次代码审阅，`deploy/zspace/docker-compose.yml` 仍包含本地 PostgreSQL / Redis，且 `DATA_DIR` 挂载到 NAS。当前还不能凭设置 DATABASE_URL 就保证附件/财务文件一致。NAS 正式环境具体数据库和密钥未读取或更改；所有迁移必须经 Test、备份、文件审计、数据验收、单节点调度验证。

## 历史决策

此前 Cloud Run 主运行、Render 备选、Neon 主库、Supabase 备选的写法保留在历史 Git 记录中；对于**新的目标架构**以 DEC-004 为准。变更前应检查现有云服务，避免重复开户和误删资源。

## 具体实施

参见 `docs/NAS_CLOUD_SHARED_DATA.md`，发布与安全边界参见 `docs/DEPLOYMENT.md` 和 `docs/DATABASE.md`，进度参见 Issue #59。
