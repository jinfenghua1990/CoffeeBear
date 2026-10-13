# CoffeeBear 环境规范

## 1. 总体原则

CoffeeBear 采用轻量化云原生部署模型。

长期固定环境：

1. Test（开发 / 测试验证环境）
2. Production（正式业务环境）

不长期维护 Dev / Staging / Production 三套环境。

## 2. 程序运行环境

### Primary

Google Cloud Run

用于正式业务运行：

- 自动扩缩容
- 容器化部署
- GitHub 持续交付

### Alternative

Render

作为备用部署方案，用于：

- 快速验证
- 备用生产迁移
- 降低云厂商绑定风险

## 3. 数据库规范

### Primary

Neon PostgreSQL

用途：

- 正式业务数据库
- 用户数据
- 订单数据
- 商品数据
- 业务核心数据

### Alternative

Supabase PostgreSQL

作为备用 PostgreSQL 托管方案。

## 4. 对象存储规范

Primary：

Cloudflare R2

用途：

- 商品图片
- 营销素材
- 用户上传文件
- 附件资源

规则：

- 图片、视频、大文件不进入 GitHub
- 大文件不直接存数据库
- 文件资源进入 R2
- 业务数据进入 PostgreSQL

## 5. Production 架构

```text
GitHub
  |
  |
Google Cloud Run
  |
  |---- Neon PostgreSQL
  |       正式业务数据库
  |
  |---- Cloudflare R2
  |       对象存储
  |
  |---- Secret Manager
          密钥管理
```

## 6. Test 环境

用途：

- 新功能开发验证
- 功能测试
- Docker 构建验证
- 数据库迁移验证
- 发布前检查

规则：

- 不连接 Production 数据
- 不使用 Production 密钥
- 不使用 Production 对象存储

## 7. 密钥管理

禁止提交：

- 数据库密码
- API Token
- R2 Secret
- JWT Secret
- SMTP 密码

生产环境密钥统一使用云端 Secret 管理。

## 8. 完整环境规范

相关文档：

- README.md
- docs/CURRENT_STATE.md
- docs/ACTIVE_WORK.md
- docs/DECISIONS.md
- docs/DEPLOYMENT.md
- docs/DATABASE.md
