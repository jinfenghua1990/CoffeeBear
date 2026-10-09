"use client";

import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import { WORKBENCH_VIEWS, parseWorkbenchView, workbenchHref } from "@/lib/workbench-navigation";

/**
 * 工作区路由注册表：pathname → 页面组件 / Tab 标题 / Tab 身份。
 *
 * CoffeeBear 只承载内销业务；ALSVID/外贸路由已迁出本仓库。
 * 工作区（components/workspace/workspace-host.tsx）接管页面渲染后，
 * 页面内容由这里挂载；Next 的路由只负责把地址栏同步成「激活 Tab 的 URL」。
 */
export type WorkspaceKey = "domestic";

export type RouteEntry = {
  pathname: string;
  workspace?: WorkspaceKey;
  workspaceFor?: (search: URLSearchParams) => WorkspaceKey;
  title: string;
  businessType: string;
  identityKeys?: string[];
  titleFor?: (search: URLSearchParams) => string | null;
  pinned?: boolean;
  closable?: boolean;
  load: () => Promise<{ default: ComponentType }>;
};

const ROUTES: RouteEntry[] = [
  {
    pathname: "/",
    title: "经营总览",
    businessType: "master",
    pinned: true,
    closable: false,
    load: () => import("@/app/page"),
  },
  {
    pathname: "/sales",
    title: "销售",
    businessType: "master",
    titleFor: (search) => (search.get("tab") === "detail" ? "销售明细" : null),
    load: () => import("@/app/sales/page"),
  },
  {
    pathname: "/products",
    title: "货品档案",
    businessType: "master",
    titleFor: (search) => {
      if (search.get("kind") === "consumable") return "耗材档案";
      const tab = search.get("tab") ?? search.get("productTab");
      if (tab === "bundles") return "套装档案";
      if (tab === "taxRules" || tab === "tax-rules") return "财务分类";
      return null;
    },
    load: () => import("@/app/products/page"),
  },
  {
    pathname: "/inventory",
    title: "库存总览",
    businessType: "master",
    titleFor: (search) => {
      const tab = search.get("tab");
      if (tab === "consumables") return "耗材库存";
      if (tab === "goods") return "正品库存";
      if (tab === "bundle") return "虚拟组合库存";
      return null;
    },
    load: () => import("@/app/inventory/page"),
  },
  {
    pathname: "/inventory/transactions",
    title: "库存流水",
    businessType: "master",
    load: () => import("@/app/inventory/transactions/page"),
  },
  {
    pathname: "/inventory/adjustments",
    title: "库存盘点",
    businessType: "master",
    load: () => import("@/app/inventory/adjustments/page"),
  },
  {
    pathname: "/inventory/operations",
    title: "耗材作业",
    businessType: "master",
    load: () => import("@/app/inventory/operations/page"),
  },
  {
    pathname: "/supply-chain/warehouses",
    title: "仓库档案",
    businessType: "master",
    load: () => import("@/app/supply-chain/warehouses/page"),
  },
  {
    pathname: "/suppliers",
    title: "供应商档案",
    businessType: "supplier",
    load: () => import("@/app/suppliers/page"),
  },
  {
    pathname: "/finance/partners",
    title: "往来单位档案",
    businessType: "master",
    load: () => import("@/app/finance/partners/page"),
  },
  {
    pathname: "/purchase/workbench",
    title: "采购订单",
    businessType: "purchase",
    identityKeys: ["order"],
    titleFor: (search) => {
      const order = search.get("order");
      if (order) return `采购单 · ${order}`;
      const view = search.get("view");
      return view ? WORKBENCH_VIEWS[parseWorkbenchView(view)] : null;
    },
    load: () => import("@/app/purchase/workbench/page"),
  },
  {
    pathname: "/supply-chain/production",
    title: "生产订单",
    businessType: "master",
    load: () => import("@/app/supply-chain/production/page"),
  },
  {
    pathname: "/supply-chain/production/manual",
    title: "特殊 / 内部生产",
    businessType: "master",
    load: () => import("@/app/supply-chain/production/manual/page"),
  },
  {
    pathname: "/supply-chain/receiving",
    title: "到仓入库",
    businessType: "master",
    titleFor: (search) => (search.get("panel") === "jackyun" ? "吉客云入库导入" : null),
    load: () => import("@/app/supply-chain/receiving/page"),
  },
  {
    pathname: "/supply-chain/receiving/manual",
    title: "手工入库单",
    businessType: "master",
    load: () => import("@/app/supply-chain/receiving/manual/page"),
  },
  {
    pathname: "/supply-chain/material-flow",
    title: "耗材流转",
    businessType: "master",
    load: () => import("@/app/supply-chain/material-flow/page"),
  },
  {
    pathname: "/data-center-import",
    title: "数据中台",
    businessType: "master",
    titleFor: (search) => {
      const titles: Record<string, string> = {
        alibaba1688: "1688 订单接入",
        external_orders: "其他渠道采购订单",
        jackyun: "吉客云业务单据",
        tax: "税务发票清单",
      };
      return titles[search.get("tab") ?? ""] ?? null;
    },
    load: () => import("@/app/data-center-import/page"),
  },
  {
    pathname: "/exceptions",
    title: "异常中心",
    businessType: "master",
    load: () => import("@/app/exceptions/page"),
  },
  {
    pathname: "/automation",
    title: "自动化",
    businessType: "master",
    load: () => import("@/app/automation/page"),
  },
  {
    pathname: "/finance",
    title: "财务中心",
    businessType: "master",
    load: () => import("@/app/finance/page"),
  },
  {
    pathname: "/finance/product-categories",
    title: "财务分类",
    businessType: "master",
    load: () => import("@/app/finance/product-categories/page"),
  },
  {
    pathname: "/finance/monthly-send",
    title: "月度资料",
    businessType: "master",
    load: () => import("@/app/finance/monthly-send/page"),
  },
  {
    pathname: "/finance/bank-transactions",
    title: "银行",
    businessType: "master",
    load: () => import("@/app/finance/bank-transactions/page"),
  },
  {
    pathname: "/finance/invoices",
    title: "发票管理",
    businessType: "master",
    load: () => import("@/app/finance/invoices/page"),
  },
  {
    pathname: "/finance/tax-accounting",
    title: "税务数据",
    businessType: "master",
    load: () => import("@/app/finance/tax-accounting/page"),
  },
  {
    pathname: "/finance/opening",
    title: "期初数据",
    businessType: "master",
    load: () => import("@/app/finance/opening/page"),
  },
  {
    pathname: "/logistics/workbench",
    title: "物流工作台",
    businessType: "master",
    load: () => import("@/app/logistics/workbench/page"),
  },
  {
    pathname: "/logistics/bills",
    title: "物流对账",
    businessType: "master",
    load: () => import("@/app/logistics/bills/page"),
  },
  {
    pathname: "/settings/backup",
    title: "备份与容灾",
    businessType: "master",
    load: () => import("@/app/settings/backup/page"),
  },
  {
    pathname: "/settings/update",
    title: "系统更新",
    businessType: "master",
    load: () => import("@/app/settings/update/page"),
  },
];

const ENTRY_BY_PATH = new Map(ROUTES.map((entry) => [entry.pathname, entry]));

/**
 * 页内重定向表：这些地址只有兼容意义，直接归一化到正式页面，避免开出一个「正在跳转」的空 Tab。
 * 采购域旧地址由 lib/workbench-navigation.ts 的 workbenchHref() 统一处理。
 */
const IN_PAGE_REDIRECTS: Record<string, string> = {
  "/settings": "/settings/backup",
  "/supply-chain": "/purchase/workbench?view=orders",
  "/supply-chain/receiving/jackyun": "/supply-chain/receiving?panel=jackyun",
  "/alibaba1688-import": "/data-center-import?tab=alibaba1688",
  "/jackyun-import": "/data-center-import?tab=jackyun",
  "/payments": "/finance/monthly-send",
  "/profit": "/finance/monthly-send",
  "/tax-invoices": "/finance/invoices",
  "/finance/bank-summary": "/finance/bank-transactions?view=summary",
  "/settings/warehouses": "/supply-chain/warehouses",
  "/finance/tax-accounting/categories": "/finance/product-categories?productTab=tax-rules",
  "/products/inventory-goods": "/inventory?tab=goods",
  "/products/inventory-consumables": "/inventory?tab=consumables",
};

export function normalizeRoute(href: string): string {
  const [rawPathname] = href.split("?", 2);
  const direct = IN_PAGE_REDIRECTS[rawPathname];
  if (direct) return direct;

  const legacy = workbenchHref(href);
  const [pathname, search = ""] = legacy.split("?", 2);
  const target = IN_PAGE_REDIRECTS[pathname];
  if (target) return target;
  return search ? `${pathname}?${search}` : pathname;
}

export type ResolvedRoute = { pathname: string; search: string; entry: RouteEntry; workspace: WorkspaceKey };

export function routeWorkspace(pathname: string, search = ""): WorkspaceKey {
  const entry = ENTRY_BY_PATH.get(pathname);
  if (!entry) return "domestic";
  return entry.workspaceFor?.(new URLSearchParams(search)) ?? entry.workspace ?? "domestic";
}

export function resolveRoute(href: string): ResolvedRoute | null {
  const normalized = normalizeRoute(href);
  const [pathname, search = ""] = normalized.split("?", 2);
  const entry = ENTRY_BY_PATH.get(pathname);
  if (!entry) return null;
  return { pathname, search, entry, workspace: routeWorkspace(pathname, search) };
}

export function tabTitle(entry: RouteEntry, search: string): string {
  return entry.titleFor?.(new URLSearchParams(search))?.trim() || entry.title;
}

export function tabIdentity(pathname: string, search: string, entry: RouteEntry): string {
  const keys = entry.identityKeys ?? [];
  if (keys.length === 0) return pathname;
  const params = new URLSearchParams(search);
  return `${pathname}?${keys.map((key) => `${key}=${params.get(key) ?? ""}`).join("&")}`;
}

export function tabBusinessId(entry: RouteEntry, search: string): string | null {
  const keys = entry.identityKeys ?? [];
  const params = new URLSearchParams(search);
  for (const key of keys) {
    const value = params.get(key);
    if (value) return value;
  }
  return null;
}

const LAZY_CACHE = new Map<string, LazyExoticComponent<ComponentType>>();

export function routeComponent(pathname: string): LazyExoticComponent<ComponentType> | null {
  const entry = ENTRY_BY_PATH.get(pathname);
  if (!entry) return null;
  let cached = LAZY_CACHE.get(pathname);
  if (!cached) {
    cached = lazy(entry.load);
    LAZY_CACHE.set(pathname, cached);
  }
  return cached;
}
