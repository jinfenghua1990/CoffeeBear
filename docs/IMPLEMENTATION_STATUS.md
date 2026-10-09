# CoffeeBear 当前实施状态

最后核对：2026-10-09

## 当前结论

`jinfenghua1990/CoffeeBear` 是“卖咖啡的熊”国内经营系统的唯一长期实现仓库。

当前边界：

- 只承载 DOMESTIC / 中国境内业务；
- 1688、吉客云 / JackYun、国内采购、库存、生产、销售、售后、物流、银行、税务、发票、回款、财务与月结属于本仓库；
- ALSVID、自行车、Dealer、Shopify 外贸订单、出口物流、欧洲库存和出口财务不属于本仓库；
- `jinfenghua1990/ALSVID` 是 ALSVID 自行车 / 出口业务唯一 authority；
- `jinfenghua1990/ChaiBen-OS` 已退出业务 authority，不应再接收新功能。

## 已落地的国内能力

### 经营与主数据

- 经营总览
- 国内销售与售后
- 商品 / SKU / 套装 / 耗材档案
- Business Partner / 往来单位统一主体
- 仓库档案与库存总览

### 采购与供应链

- 1688 订单导入 / 同步
- 吉客云 / JackYun 商品、库存、业务单据接入
- 采购工作台
- 生产订单
- 耗材备料与流转
- 到仓入库 / 手工入库
- 采购、到货、付款、发票、认证链路
- 物流工作台与物流对账

### 财务与月结

- FinanceEntry 国内业务投影
- 银行流水与对账
- 税务发票与匹配
- 回款 / 结算
- 渠道结算
- Open Items / 往来未清项
- 销售报表、无票收入、费用与利润
- 月度资料 / 财务交付
- 期初数据与月结

### 运维

- FastAPI + Next.js 静态前端统一 8000 端口
- PostgreSQL / Redis / Celery
- Alembic 数据库迁移
- 本地原生运行与 Docker 灾备路径
- 备份与恢复能力
- 系统更新中心

## 拆分状态

### CoffeeBear

主分支已移除 ALSVID / 外贸业务运行模块、页面和主要模型 authority。复检发现的旧外贸兼容壳、旧双工作台类型和误导性文档，按“迁移一个、旧位置删除一个”的规则继续清理，不作为长期兼容层保留。

### ALSVID

ALSVID 已独立成 `jinfenghua1990/ALSVID`，负责自行车产品、BOM、Vehicle、Dealer、客户、售后、出口商业事实、出口物流、欧洲库存、关税 / VAT / 退税等出口域能力。

### ChaiBen-OS

ChaiBen-OS 不再作为业务实现 authority。ALSVID 运行时已退休；国内能力由 CoffeeBear 接管。仓库只允许用于退役核对，不得恢复为第三套业务平台。

## 迁移规则

迁移完成的判定不是“新仓有一份”，而是：

1. 新仓功能可运行并通过测试；
2. 数据与入口切换完成；
3. 旧仓同一业务实现立即删除；
4. 不存在双路由、双模型、双页面或双 authority；
5. 相关权威文档同步删除旧方向。

Alembic 历史迁移文件属于数据库升级历史。它们只有在安全 baseline / cutover 建立后才删除，不能为了源码整洁直接破坏旧库升级链。

## 后续优先级

1. 完成 CoffeeBear 拆分后残余兼容壳清理；
2. 更新所有权威文档与边界测试，禁止 ALSVID / 外贸重新进入 CoffeeBear；
3. 核对 Alembic 历史外贸 schema 的 baseline / archive 方案；
4. 清理已合并和废弃分支，降低后续误开发风险；
5. 最终将 ChaiBen-OS 归档或删除，避免形成第三个 authority。