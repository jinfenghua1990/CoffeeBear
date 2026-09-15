/**
 * 全站导航配置（顶部一级 + 左侧二级 + 页面内 TAB）。
 * 增删菜单只改这里，不要在各页面硬编码。
 */

export type IconName =
  | "home" | "sales" | "profit" | "box" | "inventory" | "truck" | "warehouse"
  | "factory" | "cart" | "wallet" | "finance" | "tax" | "mail" | "alert"
  | "settings" | "automation" | "flow" | "receive" | "import";

export type SecondaryItem = { href: string; label: string; icon: IconName };

export type ModuleDef = {
  key: string;
  /** 顶部一级菜单显示名 */
  label: string;
  /** 左侧栏顶部显示的模块名 */
  title: string;
  /** 点击一级菜单的默认落地页（= 第一项） */
  href: string;
  match: (pathname: string) => boolean;
  items: SecondaryItem[];
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
    label: "商品",
    title: "商品中心",
    href: "/products",
    match: (p) => p.startsWith("/products"),
    items: [
      { href: "/products", label: "基础档案", icon: "box" },
    ],
  },
  {
    key: "warehouse",
    label: "仓库",
    title: "仓库中心",
    href: "/supply-chain/warehouses",
    match: (p) => p.startsWith("/supply-chain/warehouses") || p.startsWith("/inventory"),
    items: [
      { href: "/supply-chain/warehouses", label: "仓库总览", icon: "warehouse" },
      { href: "/inventory", label: "库存总览", icon: "inventory" },
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
      { href: `${WORKBENCH}?view=orders`, label: "采购订单", icon: "cart" },
      { href: `${WORKBENCH}?view=merge`, label: "采购合并", icon: "inventory" },
      { href: `${WORKBENCH}?view=chain`, label: "采购链路", icon: "flow" },
      { href: "/supply-chain/production", label: "生产订单", icon: "factory" },
      { href: "/supply-chain/in-transit", label: "在途管理", icon: "truck" },
      { href: "/supply-chain/receiving", label: "到货入库", icon: "receive" },
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
      { href: "/profit", label: "利润分析", icon: "profit" },
      { href: "/payments", label: "回款与对账", icon: "wallet" },
      { href: "/finance/tax-accounting", label: "税务数据", icon: "tax" },
      { href: "/finance/tax-accounting/categories", label: "分类规则", icon: "settings" },
    ],
  },
  {
    key: "data",
    label: "数据",
    title: "数据中台",
    href: "/data-center-import?tab=alibaba1688",
    match: (p) =>
      p.startsWith("/data-center-import") || p.startsWith("/exceptions") || p.startsWith("/automation"),
    items: [
      { href: "/data-center-import?tab=alibaba1688", label: "1688 订单", icon: "import" },
      { href: "/data-center-import?tab=external_orders", label: "其他渠道采购订单", icon: "cart" },
      { href: "/data-center-import?tab=jackyun", label: "吉客云业务单据", icon: "box" },
      { href: "/data-center-import?tab=tax", label: "税务发票清单", icon: "tax" },
      { href: "/exceptions", label: "异常中心", icon: "alert" },
      { href: "/automation", label: "自动化", icon: "automation" },
    ],
  },
];

/** 解析当前一级模块。顺序敏感：/supply-chain/warehouses、/inventory 要先于 /supply-chain 判断。 */
const RESOLVE_ORDER = ["home", "sales", "products", "warehouse", "supply", "finance", "data"];

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
  if (pathname !== path) return false;
  if (!query) {
    if (path === "/products") return true;
    if (path === "/sales" && search.get("tab")) return false;
    return true;
  }
  const expected = new URLSearchParams(query);
  for (const [key, value] of expected.entries()) {
    if (search.get(key) !== value) return false;
  }
  return true;
}
