"use client";

import NextLink from "next/link";
import { useSearchParams } from "next/navigation";
import { type ComponentProps, type ReactNode } from "react";
import { workbenchHref, type WorkbenchView } from "@/lib/workbench-navigation";
import type { ConsumablePurchaseItem, WorkbenchOrderItem, WorkbenchStepState } from "@/lib/api";
import type { SupplyChainChannelFilter, SupplyChainStatusFilter } from "./supply-chain-replica";


export type ViewMode = WorkbenchView;
export type FilterKey = SupplyChainStatusFilter;
export type ChainFilter = "all" | "gap" | "full";

// 完整业务页保留自己的页面头和布局，避免再嵌套到采购工作台的第二层壳里。
export const STANDALONE_VIEW_ROUTES: Partial<Record<ViewMode, string>> = {
  dashboard: "/",
  sales: "/sales",
  products: "/products",
  inventory_goods: "/inventory?tab=goods",
  inventory_consumables: "/inventory?tab=consumables",
  finance: "/finance/monthly-send",
  exceptions: "/exceptions",
  automation: "/automation",
  settings: "/settings",
  imports: "/data-center-import",
};

/** 采购单状态流转（与 /purchase 执行中心一致） */
export const PO_STATUS: Record<string, string> = {
  pending_refine: "待完善", confirmed: "已确认采购内容", jackyun_linked: "已关联吉客云采购单",
  producing: "待发货/生产中", shipped: "已发货", arrived: "已到货", inbound: "已入库", done: "完成",
};
export const NEXT_STATUS: Record<string, string> = {
  jackyun_linked: "producing", producing: "shipped",
  shipped: "arrived", arrived: "inbound", inbound: "done",
};
/** 附加费用类型（不伪造成 SKU） */
export const EXPENSE_LABEL: Record<string, string> = {
  pack: "包装", processing: "加工", plate: "制版", mold: "模具", freight: "运费", testing: "检测", other: "其他",
};

/** 链路 7 环节：① 订单 → ② SKU → ③ 采购单 → ④ 入库 → ⑤ 发票 → ⑥ 付款 → ⑦ 认证 */
export const CIRCLED = ["①", "②", "③", "④", "⑤", "⑥", "⑦"];
/** 维度色：1688 导出 / 本平台采购中心 / 吉客云 / 税务 */
export const DIM_DOT: Record<string, string> = {
  "1688": "bg-indigo-500",
  purchase: "bg-violet-500",
  jackyun: "bg-teal-500",
  tax: "bg-amber-500",
};
/** 环节补数据入口：站内跳导入页，或切到工作台其它视图 */
export const STAGE_ACTION: Record<string, { href?: string; view?: ViewMode; act: string }> = {
  order: { href: "/data-center-import?tab=alibaba1688", act: "导入 1688 订单" },
  sku: { view: "matching", act: "配置 SKU 匹配" },
  jackyunPo: { href: "/purchase/workbench?view=orders", act: "查看本系统采购单" },
  inbound: { href: "/data-center-import?tab=jackyun", act: "导入入库单" },
  invoice: { href: "/finance/invoices", act: "导入发票清单" },
  paid: { href: "/data-center-import?tab=jackyun", act: "导入结算单" },
  verified: { href: "/finance/invoices", act: "查看发票清单" },
};
export type IconName =
  | "dashboard"
  | "sales"
  | "box"
  | "purchase"
  | "orders"
  | "calendar"
  | "users"
  | "wallet"
  | "reconcile"
  | "receipt"
  | "cloud"
  | "chart"
  | "settings"
  | "import"
  | "sync"
  | "magic"
  | "refresh"
  | "download"
  | "plus"
  | "filter"
  | "search"
  | "copy"
  | "chevron"
  | "history"
  | "alert-circle"
  | "edit"
  | "x";

export type AllocationRow = {
  id?: number;
  skuId?: number | null;
  goodsName?: string;
  skuCode?: string;
  quantity?: number;
  unitPrice?: number;
  amount?: number;
  note?: string;
  /** 来源入库单 ID：入库单明细自动反填的行有值；人工新增行为 null（归入手工补录区） */
  inboundDocumentId?: number | null;
};
export type ModalConsumableItem = ConsumablePurchaseItem & { purchaseId?: number };
export type EditorConsumableDraft = { consumableId: number; quantity: string };
export type PendingConsumableUpdate = { documentId: number; allocationId: number; draft: EditorConsumableDraft | null };
export type ExpenseRow = { id?: number; expenseType?: string; amount?: number | null };
export type SettlementRow = { paidAmount?: number | null; amount?: number | null };
export type InboundRow = {
  linkId?: number | null;
  documentId?: number;
  targetId?: number;
  goodsdocNo?: string;
  warehouseName?: string;
  supplier?: string;
  amount?: number | null;
  itemAmount?: number | null;
  itemCount?: number;
  date?: string | null;
  status?: string;
  matchMethod?: string;
  note?: string;
  consumableUsageDecided?: boolean;
  consumableUsageEnabled?: boolean | null;
  consumableUsageItems?: Array<{ consumableId: number; consumableCode: string; consumableName: string; unit: string; quantity: string }>;
};


export type ChannelKey = SupplyChainChannelFilter;

/** 采购渠道：1688 / 拼多多 / 淘宝 / 其他。 */
export const CHANNELS: Record<string, { key: ChannelKey; label: string; dot: string; badge: string }> = {
  "1688": { key: "1688", label: "1688", dot: "bg-indigo-500", badge: "border-indigo-200 bg-indigo-50 text-indigo-600" },
  pdd: { key: "pdd", label: "拼多多", dot: "bg-red-500", badge: "border-red-200 bg-red-50 text-red-600" },
  taobao: { key: "taobao", label: "淘宝", dot: "bg-orange-500", badge: "border-orange-200 bg-orange-50 text-orange-600" },
  other: { key: "other", label: "其他", dot: "bg-slate-500", badge: "border-slate-200 bg-slate-50 text-slate-600" },
};

export function channelOf(value: string | null | undefined): ChannelKey {
  const raw = (value || "").trim().toLowerCase();
  if (/(pdd|拼多多|duoduo)/i.test(raw)) return "pdd";
  if (/(taobao|淘宝|tmall|天猫)/i.test(raw)) return "taobao";
  if (raw === "1688" || /阿里/.test(raw)) return "1688";
  return "other";
}

export function PlatformBadge({ value, className }: { value: string | null | undefined; className?: string }) {
  const meta = CHANNELS[channelOf(value)];
  return (
    <span className={cx("inline-flex shrink-0 items-center rounded-md border px-2.5 py-1 text-[11px] font-semibold leading-none tracking-wide shadow-sm", meta.badge, className)}>
      {meta.label}
    </span>
  );
}

/** 订单类型标签：正品 / 耗材（包材）。缺省按 goods（正品）处理，避免旧后端未下发时空白。 */
export const ORDER_KIND_META: Record<string, { label: string; badge: string }> = {
  goods: { label: "正品", badge: "border-blue-200 bg-blue-50 text-blue-600" },
  consumable: { label: "耗材", badge: "border-amber-200 bg-amber-50 text-amber-600" },
};
export function OrderKindTag({ value, className }: { value?: string | null; className?: string }) {
  const meta = ORDER_KIND_META[value === "consumable" ? "consumable" : "goods"];
  return (
    <span className={cx("inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[8.5px] font-medium leading-none", meta.badge, className)}>
      {meta.label}
    </span>
  );
}

export function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function Link({ href, ...props }: Omit<ComponentProps<typeof NextLink>, "href"> & { href: string }) {
  const params = useSearchParams();
  let destination = workbenchHref(href);
  if (destination.startsWith("/purchase/workbench") && params.get("order")) {
    const url = new URL(destination, "http://workbench.local");
    if (!url.searchParams.has("order")) url.searchParams.set("order", params.get("order")!);
    destination = url.pathname + url.search;
  }
  return <NextLink href={destination} {...props} />;
}

export function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function inputDate(value: Date) {
  return value.getFullYear() + "-" + pad(value.getMonth() + 1) + "-" + pad(value.getDate());
}


export function fmtMoney(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return "¥" + value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtQty(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("zh-CN", { maximumFractionDigits: 3 });
}

export function fmtDate(value: string | null | undefined) {
  const date = parseDate(value);
  if (!date) return "—";
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
}

export function fmtDateTime(value: string | null | undefined) {
  const date = parseDate(value);
  if (!date) return "未记录";
  return fmtDate(value) + " " + pad(date.getHours()) + ":" + pad(date.getMinutes()) + ":" + pad(date.getSeconds());
}

// 1688 源单已关闭/取消：这类订单不再按正常待办推进，界面必须显式标为「已关闭」，
// 而不是沿用 firstUndone 让它看起来还停在某个正常环节上。
export function isOrderClosed(orderStatus?: string | null) {
  const value = (orderStatus || "").trim();
  if (!value) return false;
  return /关闭|已取消|交易取消|closed|canceled|cancelled/i.test(value);
}

export type StatusInput = {
  orderStatus?: string | null;
  hasException?: boolean;
  firstUndone?: string | null;
  firstUndoneLabel?: string;
  stepStates?: Record<string, WorkbenchStepState>;
  /** 收尾环节的具体卡点（后端统一算好，避免前后端各算一套） */
  closeoutStage?: string | null;
};

/** 收尾子状态 → 状态标签文案 */
export const CLOSEOUT_LABELS: Record<string, string> = {
  awaiting_inbound: "待入库",
  awaiting_invoice: "待开发票",
  awaiting_payment: "待付款",
  awaiting_verification: "待认证",
};

export const PURCHASE_STEP_ORDER = ["content", "sku", "jackyun_po", "inbound", "invoice"] as const;
export const PURCHASE_STEP_LABELS: Record<string, string> = {
  content: "待确认采购内容",
  sku: "待匹配SKU",
  jackyun_po: "待完成本系统采购单",
  inbound: "待入库",
  invoice: "待发票",
  closeout: "待收尾(入库/发票/付款)",
};

export function statusLabel(input: StatusInput) {
  if (isOrderClosed(input.orderStatus)) return "已关闭";
  if (input.hasException) return "异常";
  // 优先用后端给的最早未完成步骤；否则在 stepStates 里找明确未完成的采购推进步骤
  //（缺键=该视图不含此维度，不算未完成，避免 workbench 5 步视图误判成「待入库」）。
  let stepKey = input.firstUndone ?? null;
  if (!stepKey && input.stepStates) {
    stepKey =
      PURCHASE_STEP_ORDER.find((key) => {
        const state = input.stepStates?.[key];
        return state !== undefined && !state.done;
      }) ?? null;
    // workbench 视图把收尾合并为 closeout（入库/发票/付款）；税务认证在 7 环节链路中单独展示
    if (!stepKey && input.stepStates.closeout && !input.stepStates.closeout.done) {
      stepKey = "closeout";
    }
  }
  if (!stepKey) return "开票完成";
  // 收尾环节拆到具体卡点：光写「待收尾」看不出是缺入库、缺票还是缺付款
  if (stepKey === "closeout" && input.closeoutStage) {
    const sub = CLOSEOUT_LABELS[input.closeoutStage];
    if (sub) return sub;
  }
  return PURCHASE_STEP_LABELS[stepKey] ?? input.firstUndoneLabel ?? "待处理";
}

export function statusClass(label: string) {
  if (label === "已关闭") return "bg-slate-100 text-slate-500";
  if (label === "开票完成") return "bg-emerald-50 text-emerald-600";
  if (label === "异常") return "bg-red-50 text-red-600";
  if (label === "待确认采购内容") return "bg-orange-50 text-orange-600";
  if (label === "待匹配SKU") return "bg-amber-50 text-amber-600";
  if (label === "待完成本系统采购单") return "bg-blue-50 text-blue-600";
  if (label === "待入库") return "bg-emerald-50 text-emerald-600";
  if (label === "待收票" || label === "待开发票") return "bg-violet-50 text-violet-600";
  if (label === "待认证") return "bg-sky-50 text-sky-600";
  if (label === "待付款") return "bg-rose-50 text-rose-600";
  if (label === "待发票" || label === "待收尾(入库/发票/付款)") return "bg-violet-50 text-violet-600";
  return "bg-orange-50 text-orange-600";
}

export function exportOrders(items: WorkbenchOrderItem[]) {
  if (typeof window === "undefined" || items.length === 0) return;
  const rows = items.map((item) => [
    fmtDateTime(item.orderDate), CHANNELS[channelOf(item.platform)].label, item.orderKind === "consumable" ? "耗材" : "正品", item.orderNo, item.supplier, item.amount ?? "",
    item.invoiceStatus === "done"
      ? "已开票"
      : item.invoiceStatus === "needs_review"
        ? "发票需复核"
        : (item.invoiceOutstanding ?? "") === ""
          ? ""
          : `未开票 ${item.invoiceOutstanding ?? 0}`,
    statusLabel(item), item.orderStatus,
  ]);
  const csvRows = [["采购时间", "渠道", "类型", "订单号", "供应商", "订单金额", "开票（未开票）", "当前状态", "订单状态"], ...rows];
  const csv = csvRows
    .map((row) => row.map((value) => '"' + String(value).replaceAll('"', '""') + '"').join(","))
    .join("\n");
  const url = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "采购订单-" + new Date().toISOString().slice(0, 10) + ".csv";
  link.click();
  URL.revokeObjectURL(url);
}


export function FormField({ label, required, children, className }: {
  label: string;
  required?: boolean;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("min-w-0", className)}>
      <div className="flex items-center gap-1 text-[11px] text-slate-500">
        {label}
        {required && <span className="text-rose-500">*</span>}
      </div>
      <div className="mt-0.5 leading-7 text-[12px] text-slate-700">{children}</div>
    </div>
  );
}

/** 耗材订单专属：直接在本平台登记耗材入库单（HC 单）并收货进耗材库台账。 */

export function DetailSection({ title, badge, children }: { title: string; badge?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200/80 bg-white">
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="text-[12px] font-semibold text-slate-700">{title}</span>
        <span className="text-[11px] text-slate-400">{badge}</span>
      </div>
      <div className="border-t border-slate-100 px-3 py-2.5">{children}</div>
    </section>
  );
}

export function DetailField({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <div className="min-w-0"><div className="text-[8px] text-slate-400">{label}</div><div className={cx("mt-0.5 truncate text-[12px] text-slate-600", strong && "font-semibold tabular-nums text-slate-800")} title={value}>{value}</div></div>;
}

export function StatusSection({ title, status, records, href }: { title: string; status: string; records: string[]; href: string }) {
  return (
    <div className="rounded-lg border border-slate-200/80 bg-white px-3 py-2.5">
      <div className="flex items-center justify-between"><span className="text-[12px] font-semibold text-slate-700">{title}</span><Link href={href} className={cx("text-[9.5px]", records.length ? "text-emerald-600" : "text-slate-400")}>{status}</Link></div>
      {records.length > 0 && <div className="mt-1.5 truncate font-mono text-[11px] text-slate-400">{records.slice(0, 2).join("　")}</div>}
    </div>
  );
}

export function Loading({ text }: { text: string }) {
  return <div className="flex min-h-[160px] items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-[11px] text-slate-400"><span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-indigo-500" />{text}</div>;
}

export function Empty({ text }: { text: string }) {
  return <div className="flex min-h-[160px] items-center justify-center rounded-xl border border-slate-200 bg-white text-[11px] text-slate-400">{text}</div>;
}

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, string> = {
    dashboard: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
    sales: "M4 19V9m5 10V5m6 14v-7m5 7V3",
    box: "M4 7l8-4 8 4-8 4-8-4zm0 0v10l8 4 8-4V7M12 11v10",
    purchase: "M3 4h2l2 12h11l2-8H7m2 12h.01M18 20h.01",
    orders: "M6 3h12v18H6zM9 8h6M9 12h6M9 16h4",
    calendar: "M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2zm2-2v4m10-4v4M3 9h18",
    users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m7-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm9 4a4 4 0 0 1 4 4v2m-6-10a4 4 0 0 0 0-8",
    wallet: "M3 6h16a2 2 0 0 1 2 2v11H3zM3 6V4h14v2m0 7h4",
    reconcile: "M5 7h14M5 12h9M5 17h6m6-2 2 2 3-4",
    receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2V3zm3 5h6m-6 4h6m-6 4h4",
    cloud: "M7 18h11a4 4 0 0 0 .5-8A6 6 0 0 0 7.2 8.2 5 5 0 0 0 7 18zm5-8v7m-3-3 3 3 3-3",
    chart: "M4 20V10m5 10V4m6 16v-7m5 7H2",
    settings: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm0-13v2m0 15v2m9.5-9.5h-2m-15 0h-2m16.2-6.2-1.4 1.4M6.7 17.3l-1.4 1.4m13.4 0-1.4-1.4M6.7 6.7 5.3 5.3",
    import: "M12 3v12m-4-4 4 4 4-4M5 21h14",
    download: "M12 3v12m-4-4 4 4 4-4M5 21h14",
    plus: "M12 5v14M5 12h14",
    sync: "M20 7h-5V2M4 17h5v5M20 7a8 8 0 0 0-13-3M4 17a8 8 0 0 0 13 3",
    magic: "m5 19 14-14M15 5l4 4M5 4v3M3.5 5.5h3M18 16v4M16 18h4",
    refresh: "M20 6v5h-5M4 18v-5h5M19 11a7 7 0 0 0-12-4M5 13a7 7 0 0 0 12 4",
    filter: "M4 5h16l-6 7v6l-4 2v-8z",
    search: "m21 21-4.5-4.5M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0z",
    copy: "M9 9h11v11H9zM5 15V5h10",
    chevron: "m8 10 4 4 4-4",
    history: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm1-13v5l4 2 1-1.5-3.5-1.8V8H13z",
    "alert-circle": "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-12v5m0 3v.01",
    edit: "M4 20h4l10.5-10.5a2.1 2.1 0 0 0-4-4L4 16v4zm9.5-13.5 4 4",
    x: "M18 6 6 18M6 6l12 12",
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0"><path d={paths[name]} stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function HeaderButton({ icon, primary, busy, disabled, onClick, children }: {
  icon: IconName; primary?: boolean; busy?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode;
}) {
  const isDisabled = busy || disabled;
  return (
    <button
      disabled={isDisabled}
      onClick={isDisabled ? undefined : onClick}
      title={disabled ? "今日配额已耗尽，请走文件入库" : undefined}
      className={cx(
        "flex h-9 items-center gap-1.5 rounded-lg px-3 text-[11px] font-medium shadow-sm transition-colors",
        isDisabled ? "cursor-not-allowed border border-slate-200 bg-slate-50 text-slate-400" :
        primary ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white hover:from-indigo-700 hover:to-violet-700" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
      )}
    ><Icon name={icon} size={15} />{busy ? "处理中…" : children}</button>
  );
}

export function MatchStatusChip({ status }: { status: string }) {
  const meta = MATCH_STATUS_META[status] ?? MATCH_STATUS_META.unmatched;
  return <span className={cx("rounded px-1.5 py-0.5 text-[12px] font-medium", meta.cls)}>{meta.label}</span>;
}

export const MATCH_STATUS_META: Record<string, { label: string; cls: string }> = {
  price_ok: { label: "金额校验通过", cls: "bg-emerald-50 text-emerald-600" },
  auto: { label: "自动命中", cls: "bg-blue-50 text-blue-600" },
  manual: { label: "人工指定", cls: "bg-indigo-50 text-indigo-600" },
  price_mismatch: { label: "金额异常", cls: "bg-red-50 text-red-600" },
  missing: { label: "档案缺失", cls: "bg-amber-50 text-amber-700" },
  unmatched: { label: "未匹配", cls: "bg-slate-100 text-slate-500" },
};
