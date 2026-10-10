# CoffeeBear — 卖咖啡的熊国内经营平台

> GitHub 仓库：`jinfenghua1990/CoffeeBear`

CoffeeBear 是 **卖咖啡的熊中国国内业务** 的唯一长期业务仓库。它负责国内采购、库存、销售、物流、银行、税务、财务与月结，不再承载 ALSVID、自行车出口、欧洲经销商或外贸运行时。

## AI Agent / Robot 协作规则

CoffeeBear 采用 GitHub 作为项目事实来源（Single Source of Truth）。

任何 AI Agent、Review Bot、自动化机器人或开发机器人在修改项目之前，必须阅读：

- `docs/ARCHITECTURE.md`（如存在）
- `docs/ENVIRONMENT.md`
- `docs/DECISIONS.md`
- `docs/AGENT_WORKFLOW.md`
- 当前 Open Issues / Pull Requests

重要规则：

- 架构决策必须记录在 GitHub Issue 或 docs 中。
- 不确定的架构、数据模型、部署方式、业务规则禁止自行决定。
- 必须先提出 Issue，说明方案、影响和待确认事项。
- 完成修改后必须记录检查内容、修改内容、验证结果和遗留问题。

详细规则见：

- `.github/AGENTS.md`
- `docs/AGENT_WORKFLOW.md`
- `docs/DECISIONS.md`

## Environment Model

CoffeeBear 不采用传统三环境模型（Dev / Staging / Production）。

采用两环境模型：

```text
Test Environment
    |
    |  M1 + Docker
    |  功能验证 / Docker验证 / 数据迁移验证
    |
    v
Production Environment
    |
    |  正式服务器
    |  正式数据库
    |  正式对象存储
```

规则：

- ❌ 不建立独立 Staging 环境
- ❌ 不维护三套长期环境
- ✅ Test 作为生产发布前验证环境
- ✅ Production 是唯一正式业务运行环境

完整环境规范见：

- `docs/ENVIRONMENT.md`

## 仓库边界

### CoffeeBear 负责

- 1688 采购、订单导入与采购链路
- 吉客云 / JackYun 国内采购、入库、库存、销售与结算事实
- 国内供应商、客户与统一往来单位 / Partner 360
- 国内仓库、生产、耗材与库存盘点
- 国内销售、售后、快递物流
- 银行流水、回单、对账与付款核对
- 税务发票、进项认证、红蓝票与 VAT 核对
- FinanceEntry 国内财务事项
- 应收 / 应付 Open Items 生命周期及银行分配
- 天猫、京东等国内渠道结算的 gross-to-net 财务拆分
- 月度资料完整性检查、版本化 ZIP、SMTP 发送与自动交付

### CoffeeBear 不负责

以下业务统一归 `jinfenghua1990/ALSVID`：

- ALSVID 自行车产品、车辆、BOM 与配件
- 德国 / 奥地利 / 欧洲经销商与售后
- 出口商业订单事实与 Shopify 外部订单映射
- 出口库存、德国仓库存量和经销商预留
- 国际运输、出口报关、欧盟进口与清关
- 关税、反倾销税、反补贴税、进口 VAT
- 外贸收入、费用、利润与出口退税

Shopify 是 ALSVID 的外部 OMS；CoffeeBear 不实现或承接 ALSVID OMS。

## 核心国内链路

```text
1688 / 其他国内采购
        ↓
采购单 / 吉客云入库
        ↓
国内库存 / 生产 / 耗材
        ↓
吉客云销售 / 国内渠道
        ↓
渠道结算 / 银行流水 / 发票
        ↓
Open Items 应收应付
        ↓
FinanceEntry / 税务 / 月结
```

业务事实各有唯一来源：银行流水是真实现金事实，发票是真实税务事实，Open Items 只管理应收应付未结生命周期，不重复创造付款事实。

## 财务中心

财务主体默认且仅使用 `domestic` 业务范围。历史数据库中拆分前可能仍存在外贸表、外贸 FinanceEntry 或旧 Alembic revision，这些只用于数据库升级链与历史审计，不属于当前 CoffeeBear 运行时，也不会进入新的财务列表、汇总或月结输出。

## 外部数据源

当前国内系统使用或支持：

- 吉客云 / JackYun
- 1688
- 浙江农信文件导入
- 税务发票清单
- SMTP 财务邮件

外部系统未配置时必须如实显示未配置，不使用模拟数据冒充真实连接。

## 技术栈

### 后端

- Python 3.12
- FastAPI
- SQLAlchemy 2
- Alembic
- Pydantic
- PostgreSQL
- Celery
- Redis

### 前端

- Next.js 16
- React 19
- Tailwind CSS 4
- 静态导出，由 FastAPI 同端口托管

## Mac 本地运行

当前主要开发与验收环境仍支持 Mac 本地原生运行，默认服务端口：

```text
http://127.0.0.1:8000
```

首次准备：

```bash
cp deploy/mac/.env.example .env
```

常用命令：

```bash
make status
make restart
make rebuild-fe
make migrate
make test
make tsc
make verify
```

远程仓库：

```bash
git@github.com:jinfenghua1990/CoffeeBear.git
```

## 开发原则

- 新的国内业务能力只进入 CoffeeBear。
- 新的 ALSVID / 出口 / 欧洲业务能力只进入 `jinfenghua1990/ALSVID`。
- 不因为历史 Alembic 文件仍存在，就把旧外贸运行时重新接回 CoffeeBear。
- `jinfenghua1990/ChaiBen-OS` 已退休，只可用于迁移证据与历史边界核对。
