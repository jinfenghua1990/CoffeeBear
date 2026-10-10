# CoffeeBear Docker 部署架构

## 目标

将 CoffeeBear 从当前本地运行模式逐步封装为标准 Docker 部署模式。

原则：

- GitHub 继续作为唯一正式软件源。
- 不重新开发业务代码，只封装运行环境。
- 当前 Mac 本地运行方式继续保留，不因 Docker 改造中断业务。
- 数据与程序分离，便于以后迁移服务器或云端。

## 目标结构

```text
CoffeeBear

应用程序
└── Docker Image
    ├── FastAPI 后端
    ├── Next.js 前端
    ├── Celery Worker
    └── Celery Beat

独立数据
├── PostgreSQL 数据库
├── Redis
├── data/ 业务文件
└── config/ 运行配置
```

## 更新方式

未来保留后台【更新】入口。

用户操作保持：

```text
点击更新
    ↓
检查 GitHub 最新版本
    ↓
获取新版运行包
    ↓
执行数据库迁移
    ↓
重启服务
    ↓
健康检查
```

底层可以从源码更新逐步升级为 Docker 镜像更新，但不改变用户使用方式。

## 数据原则

Docker 镜像只保存程序，不保存业务数据。

以下内容必须独立保存：

- PostgreSQL
- Redis 数据
- 业务附件和上传文件
- 环境配置
- 备份文件

这样升级程序不会影响业务数据。

## 实施阶段

1. 整理现有 Dockerfile / Compose 配置
2. 完成应用容器化
3. 分离数据库与业务文件
4. 建立版本发布流程
5. 测试 Docker 启动与升级
6. 后续再考虑云端部署

当前阶段不替换现有本地运行环境。