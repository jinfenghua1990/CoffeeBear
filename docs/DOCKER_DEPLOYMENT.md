# CoffeeBear Docker 部署架构

## 1. 目标

将 CoffeeBear 以可重复、可迁移、可回滚的 Docker 方式部署，同时保持业务数据与应用镜像分离。

当前 Docker 工作已经从“灾备 / 迁移设想”进入 Production 发布基线加固阶段，活动事项见 GitHub Issue #18。

## 2. 环境边界

CoffeeBear 只维护：

- Test：开发 / 测试 / Docker / migration 验证
- Production：唯一正式业务环境

不维护独立长期 Staging。

历史配置里 `APP_ENV=staging` 可以暂时作为 Test 内部兼容值，但不代表第三套环境。

## 3. 目标结构

```text
CoffeeBear 应用镜像
├── FastAPI
├── Next.js 静态产物
├── Celery Worker
└── Celery Beat

独立持久化
├── PostgreSQL
├── Redis
├── data/ 业务文件
└── 配置 / 备份
```

业务公开入口保持单端口 `8000`。

## 4. 当前仓库实现

- 根 `Dockerfile`：统一应用镜像
- 根 `docker-compose.yml`：Test / 本地 Docker 验证
- `deploy/zspace/docker-compose.yml`：当前 Production Docker 编排
- `deploy/zspace/test.env.example`：Test 编排示例
- `deploy/zspace/production.env.example`：Production 示例
- `.github/workflows/container-candidate.yml`：构建不可变候选镜像
- `.github/workflows/container-promote.yml`：制品晋级

## 5. 镜像原则

- 镜像只保存程序，不保存正式业务数据
- Production 尽量使用不可变版本标签
- `candidate` / `stable` 属于可移动通道标签，不能替代具体版本审计记录
- 正式发布必须能定位到具体 Commit / 镜像
- 镜像需要覆盖当前目标架构，包括 `linux/amd64` 与 `linux/arm64`

## 6. 更新方式

用户层面可以继续保留后台【更新】入口，但容器更新的底层实现必须与原生 Git 更新器分开设计。

当前容器编排显式设置：

```text
SYSTEM_UPDATE_ENABLED=0
```

这是有意的安全边界。

禁止为了让业务容器直接更新宿主 Docker 而未经评估挂载 Docker socket。

未来 Docker 自动更新应单独处理：

```text
检查新镜像
  ↓
选择 / 固定版本
  ↓
拉取镜像
  ↓
数据库迁移
  ↓
切换服务
  ↓
健康检查
  ↓
失败回滚
```

## 7. 数据原则

以下内容必须与应用代码 / 镜像分离：

- PostgreSQL 数据
- Redis 数据（如启用持久化）
- 业务附件 / 上传文件
- 环境配置
- 备份文件

升级镜像不得覆盖这些内容。

## 8. 数据库迁移

Docker API 容器启动不应隐式完成 Production Alembic migration。

迁移应作为独立 lifecycle stage：

1. Test 验证 migration
2. Production 发布前备份 / 风险检查
3. 使用 migrator 连接执行 migration
4. migration 成功后启动 / 切换应用
5. 检查健康状态与核心业务

详见 `docs/DATABASE.md`。

## 9. 当前验收边界

Issue #18 当前要求：

- Production 示例镜像必须指向 CoffeeBear
- 候选镜像必须支持 amd64 + arm64
- CI / 静态规则防止配置回退
- 最终仍需有 Docker 的真实环境完成启动验收

代码和 YAML 修改完成不等于真实 Docker 环境已经通过。

## 10. 长期文档关系

- `docs/ENVIRONMENT.md`：环境数量与用途
- `docs/INFRASTRUCTURE.md`：基础设施方向
- `docs/DEPLOYMENT.md`：完整发布 / 回滚流程
- `docs/DATABASE.md`：数据库 migration / 恢复规则
- `docs/ACTIVE_WORK.md`：当前未完成事项
