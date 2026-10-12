# CoffeeBear 环境规范

## 1. 总体原则

CoffeeBear 采用**两环境模型**，不采用传统的 Dev / Staging / Production 三环境模型。

固定为：

1. **Test（开发 / 测试验证环境）**
2. **Production（正式业务环境）**

这是项目长期环境决策。

## 2. Test 环境

### 用途

Test 用于：

- 新功能开发验证
- 功能测试
- Docker 构建验证
- Docker 启动验证
- 数据库迁移验证
- 发布前检查

### 当前目标形态

- M1 Mac + Docker
- 非生产数据库
- 非生产对象存储
- 非生产密钥

### 规则

- 不连接 Production 真实业务数据
- 不使用 Production 正式对象存储
- 不使用 Production 正式密钥
- Test 不是长期独立业务环境

## 3. Production 正式环境

Production 是 CoffeeBear **唯一正式业务运行环境**。

正式架构：

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
  |       正式对象存储
  |
  |---- Google Secret Manager
          正式密钥管理
```

### Production 资源

运行服务：

- Google Cloud Run

数据库：

- Neon PostgreSQL

存储：

- Cloudflare R2
- Bucket：`coffeebear-prod`

密钥管理：

- Google Secret Manager

用于保存：

- 数据库连接信息
- R2 Access Key
- R2 Secret Key
- JWT Secret
- SMTP 密码
- 第三方 API Token

## 4. 对象存储规范

CoffeeBear 正式对象存储：

```text
coffeebear-prod

├── products
├── stores
├── marketing
├── documents
└── users
```

规则：

- 图片、视频、附件不进入 GitHub
- 大文件不进入数据库
- 业务数据进入 Neon PostgreSQL
- 文件资源进入 Cloudflare R2

## 5. 明确不采用的模式

默认禁止：

- 单独维护 Staging 环境
- 长期维护 Dev / Staging / Production 三套云环境
- 把正式密钥提交到 GitHub
- 把正式业务文件存放在代码仓库

## 6. 环境资源隔离

Test 与 Production 必须隔离：

- 数据库
- 对象存储
- 密钥
- 管理员凭据
- 外部服务配置

不得为了方便让测试代码直接连接正式资源。

## 7. 环境变量与密钥规则

仓库可以提交：

- `.env.example`
- 示例变量名
- 占位配置

仓库不得提交真实：

- 数据库密码
- API Token
- 对象存储密钥
- 管理员密码
- Session / Cookie Secret

正式密钥统一由 Google Secret Manager 管理。

## 8. 修改环境模型流程

任何新增长期环境必须：

1. 创建 GitHub 架构决策 Issue。
2. 说明必要性。
3. 说明成本和维护责任。
4. 明确数据库、对象存储、密钥方案。
5. 确认后更新相关文档。

## 9. 相关文档

- `README.md`
- `.github/AGENTS.md`
- `docs/CURRENT_STATE.md`
- `docs/ACTIVE_WORK.md`
- `docs/DECISIONS.md`
- `docs/DEPLOYMENT.md`
- `docs/DATABASE.md`
