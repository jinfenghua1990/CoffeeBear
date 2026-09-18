/**
 * 全站导航配置（顶部一级 + 左侧二级 + 页面内 TAB）。
 * 增删菜单只改这里，不要在各页面硬编码。
 */

export type IconName =
  | "home" | "sales" | "profit" | "box" | "inventory" | "truck" | "warehouse"
  | "factory" | "cart" | "wallet" | "finance" | "tax" | "mail" | "alert"
  | "settings" | "automation" | "flow" | "receive" | "import";

export type SecondaryItem = { href: string; label: string; icon: IconName };
export type SecondaryGroup = { label: string; items: SecondaryItem[] };

export type ModuleDef = {
  key: string;
  /** 顶部一级菜单显示名 */
  label: string;
  /** 左侧栏顶部显示的模块名 */
  title: string;
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
      { href: "/sales?tab=overview", label: "业绩总览", icon: "sales" },
      { href: "/sales?tab=detail", label: "销售明细", icon: "profit" },
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
          { href: "/products?tab=bundles", label: "套装档案", icon: "box" },
          { href: "/products?tab=taxRules", label: "财务分类", icon: "tax" },
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
      p.startsWith("/supply-chain") || p.startsWith("/purchase") || p.startsWith("/procurement") || p.startsWith("/suppliers"),
    items: [
      { href: "/supply-chain", label: "供应链总览", icon: "home" },
      { href: "/suppliers", label: "供应商档案", icon: "box" },
      { href: "/data-center-import?tab=alibaba1688", label: "1688 采购拉取", icon: "import" },
      { href: "/data-center-import?tab=external_orders", label: "其他渠道采购接入", icon: "import" },
      { href: `${WORKBENCH}?view=orders`, label: "采购订单", icon: "cart" },
      { href: `${WORKBENCH}?view=chain`, label: "采购链路", icon: "flow" },
      { href: "/supply-chain/production", label: "生产订单", icon: "factory" },
      { href: "/supply-chain/receiving", label: "到仓入库单", icon: "receive" },
      { href: "/supply-chain/material-flow", label: "耗材流转", icon: "flow" },
    ],
  },
  {
    key: "finance",
    label: "财务",
    title: "财务中心",
    href: "/finance/monthly-send",
    match: (p) => p.startsWith("/finance") || p.startsWith("/payments") || p.startsWith("/profit"),
    items: [
      { href: "/finance/monthly-send", label: "月度资料", icon: "mail" },
      { href: "/finance/bank-transactions", label: "银行流水", icon: "wallet" },
      { href: "/finance/invoices", label: "发票管理", icon: "tax" },
      { href: "/finance/tax-accounting", label: "税务数据", icon: "tax" },
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
    key: "data",
    label: "数据",
    title: "数据接入",
    href: "/data-center-import?tab=alibaba1688",
    showInTop: false,
    match: (p) => p.startsWith("/data-center-import") || p.startsWith("/exceptions"),
    items: [
      { href: "/data-center-import?tab=alibaba1688", label: "1688 接入", icon: "import" },
      { href: "/data-center-import?tab=external_orders", label: "其他渠道采购", icon: "cart" },
      { href: "/data-center-import?tab=jackyun", label: "吉客云数据", icon: "box" },
      { href: "/exceptions", label: "异常中心", icon: "alert" },
    ],
  },
  {
    key: "system",
    label: "设置",
    title: "系统设置",
    href: "/settings",
    showInTop: false,
    match: (p) => p.startsWith("/settings") || p.startsWith("/automation"),
    items: [
      { href: "/settings", label: "系统设置", icon: "settings" },
      { href: "/settings/update", label: "系统更新", icon: "automation" },
      { href: "/automation", label: "自动化任务", icon: "flow" },
    ],
  },
];

/** 解析当前一级模块。顺序敏感：库存路由要先于 products / supply 判断。 */
const RESOLVE_ORDER = ["home", "sales", "inventory", "products", "supply", "finance", "logistics", "system", "data"];

export function resolveModule(pathname: string): ModuleDef {
  for (const key of RESOLVE_ORDER) {
    const module = MODULES.find((item) => item.key === key);
    if (module?.match(pathname)) return module;
  }
  return MODULES[0];
}

/** 左侧二级菜单激活态：路径一致，且 query 完全匹配（无参链接要求当前也不带相关参数）。 */
export function isSecondaryActive(item: SecondaryItem, pathname: string, search: URLSearchParams): boolean {
  const [path, query] = item.href.split("?", 2);
  if (path === "/inventory" && pathname.startsWith("/inventory/operations")) return true;
  if (pathname !== path) return false;
  if (!query) {
    if (path === "/products") return !search.get("tab") && !search.get("productTab");
    if (path === "/sales" && search.get("tab")) return false;
    return true;
  }
  const expected = new URLSearchParams(query);
  for (const [key, value] of expected.entries()) {
    if (search.get(key) !== value) return false;
  }
  return true;
}
