# CoffeeBear Docker 部署架构

## 目标

CoffeeBear 采用“同一代码仓库 + 标准 Docker 镜像”的部署方式。GitHub 是唯一正式软件源，业务代码不因为容器化而重写。

原则：

- GitHub 继续作为唯一正式软件源。
- Docker 镜像只保存程序，不保存业务数据。
- Test 与 Production 两套环境长期存在，不增加独立 Staging 环境。
- Production 使用已经测试并晋级的 GHCR（GitHub 镜像仓库）镜像，不在正式主机重新构建源码。
- PostgreSQL、Redis、业务文件、运行配置和备份与应用镜像分离。

## 当前已经具备

仓库当前已经存在并持续维护：

- 根 `Dockerfile`：构建 Next.js 静态前端，并与 FastAPI 后端封装为统一应用镜像。
- 根 `docker-compose.yml`：用于本地/Test 的完整编排，包含 PostgreSQL、Redis、迁移、API、Worker、Beat。
- `.github/workflows/container-candidate.yml`：构建不可变候选镜像并推送 GHCR。
- `.github/workflows/container-promote.yml`：将已经测试的候选镜像直接晋级为 `stable` 和版本标签，不重新构建。
- `deploy/zspace/docker-compose.yml`：Production 镜像式编排示例，通过 `APP_IMAGE` 拉取已发布镜像。
- 数据目录通过宿主机目录或 Docker Volume 独立持久化，删除/替换应用容器不应删除业务数据。

候选镜像统一发布：

```text
linux/amd64
+
linux/arm64
```

因此同一个 CoffeeBear 版本可以在主流 x86_64 与 ARM64 Docker 主机运行。

## 标准发布链路

```text
GitHub 代码
    ↓
CI / Test
    ↓
构建 sha-<commit> 不可变 Docker 镜像
    ↓
验证
    ↓
晋级为 stable + vYYYY.MM.DD.HHmmss
    ↓
Production 拉取已晋级镜像
```

Production 不应该在服务器/NAS 上从源码重新 `docker build`，避免“同一个版本在不同机器重新构建出不同结果”。

## Production 运行结构

```text
Docker Host
├─ CoffeeBear API + Frontend  ┐
├─ Celery Worker              ├─ 同一个 APP_IMAGE
├─ Celery Beat                ┘
├─ PostgreSQL
├─ Redis
└─ 持久化目录
   ├─ postgres/
   ├─ redis/
   └─ data/
```

数据库迁移使用独立 `migrate` 生命周期执行，不把 Alembic 自动迁移塞进应用容器启动命令。

## 更新按钮原则

用户最终操作入口保持不变：

```text
打开 CoffeeBear
↓
点击【更新】
↓
等待完成
↓
继续使用
```

但是必须区分两种底层更新器：

- 原生运行模式：现有更新器可以通过受控 Git 更新代码。
- Docker 运行模式：不能让业务容器继续用 Git 更新自身，也不能为了省事直接给业务容器挂载 Docker socket。

当前 Production Docker 编排因此保持 `SYSTEM_UPDATE_ENABLED=0`，直到“容器更新代理（Container Update Agent）”完成。

Docker 更新代理的目标流程：

```text
用户点击【更新】
↓
CoffeeBear 发起受控更新请求
↓
更新代理确认 stable/指定版本镜像
↓
更新前备份
↓
拉取新镜像
↓
执行数据库迁移
↓
切换 API / Worker / Beat
↓
健康检查
↓
成功：记录版本
失败：自动回滚旧镜像
```

用户不需要手工输入 Docker 命令。

## 数据原则

Docker 镜像只保存程序。以下内容必须独立保存：

- PostgreSQL 数据
- Redis 持久化数据
- 业务附件、上传文件和导入导出资料
- 环境配置与 Secrets（密钥）
- 备份和恢复点

升级应用镜像不得删除或覆盖这些数据。

## 当前实施状态

| 项目 | 状态 |
| --- | --- |
| 应用 Docker 镜像 | ✅ 已有 |
| Test Compose | ✅ 已有 |
| Production 镜像式 Compose | ✅ 已有 |
| GHCR 候选镜像 | ✅ 已有 |
| GHCR stable / 版本晋级 | ✅ 已有 |
| amd64 + arm64 双架构发布 | ✅ 已纳入发布配置 |
| 数据持久化分离 | ✅ 已有基础 |
| Docker 实机启动验收 | ⏳ 需要在有 Docker 的执行环境完成 |
| 后台【更新】→ Docker 自动升级 | ⏳ 下一阶段 |
| 更新失败自动回滚 | ⏳ 随 Docker 更新代理完成 |

## 下一阶段

下一步优先完成“后台【更新】按钮 → Docker 自动升级闭环”，要求：

1. 不改变用户点击【更新】的习惯。
2. 不让业务容器直接控制 Docker 主机。
3. 更新前必须创建可验证恢复点。
4. 只部署已经晋级的正式镜像。
5. 数据库迁移成功后才切换应用。
6. 新版本健康检查失败必须自动回滚。
7. 全过程记录版本、结果与失败原因。

真实 Docker 启动、镜像拉取、网络、卷挂载和回滚仍必须在具备 Docker 的环境中做最终运行验收。
