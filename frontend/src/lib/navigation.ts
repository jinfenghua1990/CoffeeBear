/**
 * 全站导航配置（顶部一级 + 左侧二级 + 页面内 TAB）。
 * 增删菜单只改这里，不要在各页面硬编码。
 * 左侧二级以“业务模块”为粒度：同一页面/同一业务对象的不同视图必须放页内 TAB、筛选或弹窗，不得拆成多个左侧入口。
 */

export type IconName =
  | "home" | "sales" | "profit" | "box" | "inventory" | "truck" | "warehouse"
  | "factory" | "cart" | "wallet" | "finance" | "tax" | "mail" | "alert"
  | "settings" | "automation" | "flow" | "receive" | "import";

export type WorkspaceKey = "domestic" | "foreign";
export type SecondaryItem = { href: string; label: string; icon: IconName; activeByPath?: boolean };
export type SecondaryGroup = { label: string; items: SecondaryItem[] };

export type ModuleDef = {
  key: string;
  /** 顶部一级菜单显示名 */
  label: string;
  /** 左侧栏顶部显示的模块名 */
  title: string;
  /** 所属业务工作台；未填写时默认内销。 */
  workspace?: WorkspaceKey;
  /** 点击一级菜单的默认落地页（= 第一项） */
  href: string;
  match: (pathname: string) => boolean;
  /** 是否显示在顶部一级业务菜单；系统/数据辅助区可隐藏但保留路由与侧栏归属。 */
  showInTop?: boolean;
  items?: SecondaryItem[];
  groups?: SecondaryGroup[];
};

const WORKBENCH = "/purchase/workbench";

export const MODULES: ModuleDef[] = [
  {
    key: "home",
    label: "经营",
    title: "经营中心",
    href: "/",
    match: (p) => p === "/",
    items: [{ href: "/", label: "经营总览", icon: "home" }],
  },
  {
    key: "sales",
    label: "销售",
    title: "销售中心",
    href: "/sales",
    match: (p) => p.startsWith("/sales"),
    items: [
      { href: "/sales", label: "销售分析", icon: "sales" },
    ],
  },
  {
    key: "products",
    label: "基础货品",
    title: "基础货品",
    href: "/products",
    match: (p) =>
      p.startsWith("/products")
      && !p.startsWith("/products/inventory-goods")
      && !p.startsWith("/products/inventory-consumables"),
    groups: [
      {
        label: "基础档案",
        items: [
          { href: "/products", label: "货品档案", icon: "box" },
        ],
      },
    ],
  },
  {
    key: "inventory",
    label: "库存",
    title: "库存中心",
    href: "/inventory",
    match: (p) =>
      p.startsWith("/inventory")
      || p.startsWith("/products/inventory-goods")
      || p.startsWith("/products/inventory-consumables")
      || p.startsWith("/supply-chain/warehouses")
      || p.startsWith("/settings/warehouses"),
    items: [
      { href: "/inventory", label: "库存总览", icon: "inventory" },
      { href: "/supply-chain/warehouses", label: "仓库档案", icon: "warehouse" },
      { href: "/inventory/transactions", label: "库存流水", icon: "flow" },
      { href: "/inventory/adjustments", label: "库存调整", icon: "settings" },
    ],
  },
  {
    key: "supply",
    label: "供应链",
    title: "供应链中心",
    href: "/supply-chain",
    match: (p) =>
      p.startsWith("/supply-chain")
      || p.startsWith("/purchase")
      || p.startsWith("/procurement")
      || p.startsWith("/suppliers")
      || p.startsWith("/data-center-import"),
    items: [
      { href: "/supply-chain", label: "供应链总览", icon: "home" },
      { href: "/suppliers", label: "供应商档案", icon: "box" },
      { href: "/data-center-import?tab=alibaba1688", label: "采购接入", icon: "import", activeByPath: true },
      { href: `${WORKBENCH}?view=orders`, label: "采购管理", icon: "cart", activeByPath: true },
      { href: "/supply-chain/production", label: "生产订单", icon: "factory" },
      { href: "/supply-chain/receiving", label: "到仓入库单", icon: "receive" },
      { href: "/supply-chain/material-flow", label: "耗材流转", icon: "flow" },
    ],
  },
  {
    key: "finance",
    label: "财务",
    title: "财务中心",
    href: "/finance",
    match: (p) => p.startsWith("/finance") || p.startsWith("/payments") || p.startsWith("/profit"),
    items: [
      { href: "/finance", label: "财务工作台", icon: "finance" },
      { href: "/finance/monthly-send", label: "月结中心", icon: "mail" },
      { href: "/finance/bank-transactions?view=summary", label: "银行", icon: "wallet", activeByPath: true },
      { href: "/finance/invoices", label: "发票管理", icon: "tax" },
      { href: "/finance/tax-accounting", label: "税务数据", icon: "tax" },
      { href: "/finance/opening", label: "期初数据", icon: "wallet" },
    ],
  },
  {
    key: "logistics",
    label: "快递物流",
    title: "快递物流",
    href: "/logistics/workbench",
    match: (p) => p.startsWith("/logistics"),
    items: [
      { href: "/logistics/workbench", label: "物流工作台", icon: "truck" },
      { href: "/logistics/bills", label: "物流账单", icon: "wallet" },
    ],
  },
  {
    key: "foreign",
    label: "总览",
    title: "外贸中心",
    workspace: "foreign",
    href: "/foreign-trade",
    match: (p) => p.startsWith("/foreign-trade"),
    items: [
      { href: "/foreign-trade", label: "外贸总览", icon: "home" },
      { href: "/foreign-trade/orders", label: "外贸订单", icon: "cart" },
      { href: "/foreign-trade/dealers", label: "B2B 客户", icon: "sales" },
      { href: "/foreign-trade/channels", label: "渠道管理", icon: "sales" },
      { href: "/foreign-trade/sku-mappings", label: "海外 SKU 映射", icon: "box" },
      { href: "/foreign-trade/fulfillment", label: "履约中心", icon: "truck" },
      { href: "/finance?scope=foreign_trade", label: "财务", icon: "wallet" },
      { href: "/foreign-trade/alsvid", label: "Alsvid", icon: "factory" },
    ],
  },
  {
    key: "data",
    label: "异常",
    title: "异常中心",
    href: "/exceptions",
    showInTop: false,
    match: (p) => p.startsWith("/exceptions"),
    items: [
      { href: "/exceptions", label: "异常中心", icon: "alert" },
    ],
  },
  {
    key: "system",
    label: "设置",
    title: "系统设置",
    href: "/settings/backup",
    showInTop: false,
    match: (p) => p.startsWith("/settings") || p.startsWith("/automation"),
    items: [
      { href: "/settings/backup", label: "备份与容灾", icon: "automation" },
      { href: "/settings/update", label: "系统更新", icon: "automation" },
      { href: "/automation", label: "自动化任务", icon: "flow" },
    ],
  },
];

/** 解析当前一级模块。顺序敏感：库存路由要先于 products / supply 判断。 */
const RESOLVE_ORDER = ["foreign", "home", "sales", "inventory", "products", "supply", "finance", "logistics", "system", "data"];

export function resolveModule(pathname: string): ModuleDef {
  for (const key of RESOLVE_ORDER) {
    const module = MODULES.find((item) => item.key === key);
    if (module?.match(pathname)) return module;
  }
  return MODULES[0];
}

export function moduleWorkspace(module: ModuleDef): WorkspaceKey {
  return module.workspace ?? "domestic";
}

/**
 * 开发期导航防重：同一业务模块下，相同 pathname 只能出现一次。
 * overview/detail、summary/transactions 等视图必须放页面内部 TAB、筛选或弹窗。
 */
function assertNoDuplicateSidebarViews() {
  for (const module of MODULES) {
    const items = module.groups?.flatMap((group) => group.items) ?? module.items ?? [];
    const seen = new Map<string, string>();
    for (const item of items) {
      const pathname = item.href.split("?", 1)[0];
      const previous = seen.get(pathname);
      if (previous) {
        throw new Error(
          `[navigation] ${module.key} 左侧菜单重复页面：${previous} / ${item.label} → ${pathname}。同一页面的不同视图必须使用页内 TAB、筛选或弹窗。`,
        );
      }
      seen.set(pathname, item.label);
    }
  }
}

if (process.env.NODE_ENV !== "production") assertNoDuplicateSidebarViews();

/** 左侧二级菜单激活态：路径一致，且 query 完全匹配（无参链接要求当前也不带相关参数）。 */
export function isSecondaryActive(item: SecondaryItem, pathname: string, search: URLSearchParams): boolean {
  const [path, query] = item.href.split("?", 2);
  if (path === "/inventory" && pathname.startsWith("/inventory/operations")) return true;
  if (pathname !== path) return false;
  if (item.activeByPath) return true;
  if (!query) return true;
  const expected = new URLSearchParams(query);
  for (const [key, value] of expected.entries()) {
    if (search.get(key) !== value) return false;
  }
  return true;
}
