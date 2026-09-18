"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import StatusBadge from "@/components/status-badge";
import {
  authenticatedFetch,
  consumablesApi,
  dashboardApi,
  fetchMe,
  getOverview,
  type AuthUser,
  procurementWorkbenchApi,
  type ConsumableRow,
  type IntegrationStatus,
  type InventorySummary,
  type SalesOrderRow,
  type TrendPoint,
  type WorkbenchSummary,
} from "@/lib/api";

type ProductionOrder = {
  orderNo: string;
  supplier: string;
  stage: string;
  stageLabel: string;
  archiveGroup: "production" | "transit" | "receiving" | "archive";
  itemCount: number;
  quantityTotal: number;
  hasException: boolean;
};

type DashboardState = {
  trend: TrendPoint[];
  procurement: WorkbenchSummary | null;
  completedPurchaseOrders: number;
  inventory: InventorySummary | null;
  consumables: ConsumableRow[];
  orders: SalesOrderRow[];
  production: ProductionOrder[];
  integrations: IntegrationStatus[];
};

const EMPTY_STATE: DashboardState = {
  trend: [],
  procurement: null,
  completedPurchaseOrders: 0,
  inventory: null,
  consumables: [],
  orders: [],
  production: [],
  integrations: [],
};

function number(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  return `¥${number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function quantity(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  return number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function shortDate(value: string | null | undefined) {
  if (!value) return "—";
  return value.slice(0, 10).replaceAll("-", "/");
}

function salesStatusLabel(value: string | null | undefined) {
  const raw = (value ?? "").trim();
  if (!raw) return "未标记";
  return /^\d+$/.test(raw) ? `平台状态 ${raw}` : raw;
}

type DashboardIconName =
  | "sales"
  | "orders"
  | "transit"
  | "warning"
  | "purchase"
  | "import"
  | "production"
  | "warehouse"
  | "product"
  | "report";

function DashboardIcon({ name }: { name: DashboardIconName }) {
  const common = "h-6 w-6";
  if (name === "sales") {
    return <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden="true"><path d="M3 5h2l2 10h10.5l2-7H6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><circle cx="9" cy="19" r="1.5" fill="currentColor" /><circle cx="17" cy="19" r="1.5" fill="currentColor" /></svg>;
  }
  if (name === "orders") {
    return <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden="true"><path d="M6 3.5h9l3 3v14H6v-17Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M15 3.5v3h3M9 11h6M9 15h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>;
  }
  if (name === "transit" || name === "product") {
    return <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden="true"><path d="m4 7 8-4 8 4v10l-8 4-8-4V7Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="m4.4 7.2 7.6 4 7.6-4M12 11.2V21" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>;
  }
  if (name === "warning") {
    return <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden="true"><path d="m12 3 9 17H3L12 3Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M12 9v5M12 17h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
  }
  if (name === "purchase") {
    return <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="1.7" /><path d="M12 8v8M8 12h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
  }
  if (name === "import") {
    return <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden="true"><path d="M6 3.5h9l3 3v14H6v-17Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M12 8v7m0 0-3-3m3 3 3-3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  }
  if (name === "production") {
    return <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden="true"><path d="M4 20V9l6 3V9l6 3V5h4v15H4Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M8 16h.01M12 16h.01M16 16h.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>;
  }
  if (name === "warehouse") {
    return <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden="true"><path d="M3.5 20V8l8.5-4 8.5 4v12M7 20v-7h10v7M9 9h.01M12 9h.01M15 9h.01" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  }
  return <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden="true"><path d="M4 19V9m5 10V5m5 14v-7m5 7V3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
}

function KpiCard({
  label,
  value,
  hint,
  href,
  tone,
  mark,
  iconTone,
}: {
  label: string;
  value: string;
  hint: string;
  href: string;
  tone: string;
  mark: DashboardIconName;
  iconTone: string;
}) {
  return (
    <Link href={href} className={`group rounded-xl border p-4 transition hover:-translate-y-0.5 hover:shadow-md ${tone}`}>
      <div className="flex items-center gap-3">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/75 shadow-sm ${iconTone}`}><DashboardIcon name={mark} /></div>
        <div className="min-w-0">
          <div className="truncate text-xs text-slate-500">{label}</div>
          <div className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{value}</div>
          <div className="mt-1 truncate text-[11px] text-slate-500">{hint}</div>
        </div>
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/70"><div className="h-full w-2/3 rounded-full bg-white/80 transition group-hover:w-5/6" /></div>
    </Link>
  );
}

function Panel({
  title,
  subtitle,
  href,
  children,
}: {
  title: string;
  subtitle?: string;
  href?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.03)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {subtitle && <p className="mt-1 text-[11px] text-slate-400">{subtitle}</p>}
        </div>
        {href && <Link href={href} className="shrink-0 text-xs font-medium text-indigo-600 hover:text-indigo-700">查看全部 →</Link>}
      </div>
      {children}
    </section>
  );
}

function TrendChart({
  points,
  loading,
  rangeStart,
  rangeEnd,
  onRangeStartChange,
  onRangeEndChange,
}: {
  points: TrendPoint[];
  loading: boolean;
  rangeStart: string;
  rangeEnd: string;
  onRangeStartChange: (value: string) => void;
  onRangeEndChange: (value: string) => void;
}) {

  const width = 720;
  const height = 190;
  const chartTop = 12;
  const chartBottom = 162;
  const maxSales = Math.max(1, ...points.map((point) => number(point.salesAmount)));
  const maxOrders = Math.max(1, ...points.map((point) => point.orders));
  const step = width / points.length;
  const barWidth = Math.max(3, step * 0.58);
  const orderPoints = points
    .map((point, index) => {
      const x = index * step + step / 2;
      const y = chartBottom - (point.orders / maxOrders) * (chartBottom - chartTop);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div className="mt-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm bg-indigo-400" />销售额</span>
          <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-emerald-400" />订单数</span>
          <span>有效数据日 {points.length}</span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
          <input aria-label="销售趋势开始日期" type="date" value={rangeStart} max={rangeEnd} onChange={(event) => onRangeStartChange(event.target.value)} className="rounded border border-slate-200 bg-white px-1.5 py-1 text-[10px] text-slate-600 outline-none focus:border-indigo-400" />
          <span>→</span>
          <input aria-label="销售趋势结束日期" type="date" value={rangeEnd} min={rangeStart} onChange={(event) => onRangeEndChange(event.target.value)} className="rounded border border-slate-200 bg-white px-1.5 py-1 text-[10px] text-slate-600 outline-none focus:border-indigo-400" />
        </div>
      </div>
      {loading ? <div className="flex h-56 items-center justify-center text-sm text-slate-400">正在加载销售趋势…</div> : !points.length ? <div className="flex h-56 items-center justify-center text-sm text-slate-400">该日期范围暂无销售趋势数据，请先导入销售清单。</div> : <>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-56 w-full" role="img" aria-label="销售额和订单数趋势">
        {[0, 1, 2, 3].map((line) => {
          const y = chartTop + ((chartBottom - chartTop) / 3) * line;
          return <line key={line} x1="0" x2={width} y1={y} y2={y} stroke="#e2e8f0" strokeDasharray="3 4" />;
        })}
        {points.map((point, index) => {
          const barHeight = (number(point.salesAmount) / maxSales) * (chartBottom - chartTop);
          const x = index * step + (step - barWidth) / 2;
          const y = chartBottom - barHeight;
          return (
            <rect key={point.date} x={x} y={y} width={barWidth} height={Math.max(1, barHeight)} rx="3" fill="#7da8f5" opacity="0.9">
              <title>{`${point.date} · ${money(point.salesAmount)} · ${point.orders} 单`}</title>
            </rect>
          );
        })}
        <polyline points={orderPoints} fill="none" stroke="#35b9a4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((point, index) => {
          const x = index * step + step / 2;
          const y = chartBottom - (point.orders / maxOrders) * (chartBottom - chartTop);
          return <circle key={`order-${point.date}`} cx={x} cy={y} r="2.5" fill="#35b9a4" />;
        })}
        <line x1="0" x2={width} y1={chartBottom} y2={chartBottom} stroke="#cbd5e1" />
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-slate-400">
        <span>{shortDate(points[0]?.date)}</span>
        <span>{shortDate(points[Math.floor(points.length / 2)]?.date)}</span>
        <span>{shortDate(points[points.length - 1]?.date)}</span>
      </div>
      </>}
    </div>
  );
}

type StatusSegment = { label: string; count: number; color: string; href?: string };

function StatusDonut({ segments, centerLabel }: { segments: StatusSegment[]; centerLabel: string }) {
  const total = segments.reduce((sum, segment) => sum + segment.count, 0);
  let cursor = 0;
  const gradient = total
    ? segments.map((segment) => {
        const start = (cursor / total) * 100;
        cursor += segment.count;
        return `${segment.color} ${start}% ${(cursor / total) * 100}%`;
      }).join(", ")
    : "#e2e8f0 0% 100%";

  return (
    <div className="flex flex-wrap items-center gap-6 py-4">
      <div className="relative mx-auto h-36 w-36 shrink-0 rounded-full" style={{ background: `conic-gradient(${gradient})` }}>
        <div className="absolute inset-[18px] flex flex-col items-center justify-center rounded-full bg-white">
          <span className="text-2xl font-semibold text-slate-900">{total}</span>
          <span className="text-[11px] text-slate-400">{centerLabel}</span>
        </div>
      </div>
      <div className="min-w-[150px] flex-1 space-y-2">
        {segments.map((segment) => {
          const content = (
            <>
              <span className="flex items-center gap-2 text-xs text-slate-600"><i className="h-2 w-2 rounded-full" style={{ backgroundColor: segment.color }} />{segment.label}</span>
              <span className="text-xs font-medium tabular-nums text-slate-800">{segment.count}</span>
            </>
          );
          return segment.href ? (
            <Link key={segment.label} href={segment.href} className="flex items-center justify-between rounded-md px-1 py-0.5 hover:bg-slate-50">{content}</Link>
          ) : (
            <div key={segment.label} className="flex items-center justify-between px-1 py-0.5">{content}</div>
          );
        })}
      </div>
    </div>
  );
}

function QuickAction({ href, mark, label, tone, iconTone }: { href: string; mark: DashboardIconName; label: string; tone: string; iconTone: string }) {
  return (
    <Link href={href} className={`flex min-h-24 flex-col items-center justify-center rounded-xl border p-3 text-center transition hover:-translate-y-0.5 hover:shadow-sm ${tone}`}>
      <span className={iconTone}><DashboardIcon name={mark} /></span>
      <span className="mt-2 text-xs font-medium text-slate-700">{label}</span>
    </Link>
  );
}

function PanelLoading({ label }: { label: string }) {
  return <div className="flex h-52 items-center justify-center text-sm text-slate-400">正在加载{label}…</div>;
}

function initialTrendRange() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 29);
  return { start: localIso(start), end: localIso(end) };
}

function localIso(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export default function OverviewPage() {
  const router = useRouter();
  const [state, setState] = useState<DashboardState>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const initialRange = useMemo(initialTrendRange, []);
  const [trendStart, setTrendStart] = useState(initialRange.start);
  const [trendEnd, setTrendEnd] = useState(initialRange.end);
  const loadRequest = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++loadRequest.current;
    setLoading(true);
    setError("");
    if (trendStart > trendEnd) {
      setError("销售趋势开始日期不能晚于结束日期");
      setLoading(false);
      return;
    }
    try {
      const [productionResponse, trend, procurement, completed, inventory, consumables, orders, overview] = await Promise.all([
        authenticatedFetch("/api/v1/supply-chain/production-purchase-view?group=all&limit=500", { cache: "no-store" }),
        dashboardApi.salesTrend(365, trendStart, trendEnd),
        procurementWorkbenchApi.summary(),
        procurementWorkbenchApi.orders({ status: "done", page: 1, pageSize: 100 }),
        dashboardApi.inventory(),
        consumablesApi.list(),
        dashboardApi.orders(),
        getOverview(),
      ]);
      if (!productionResponse.ok) throw new Error(`生产执行数据加载失败（${productionResponse.status}）`);
      const productionPayload = (await productionResponse.json()) as { rows?: ProductionOrder[] };
      if (requestId !== loadRequest.current) return;
      setState({
        trend,
        procurement,
        completedPurchaseOrders: completed.total,
        inventory,
        consumables,
        orders,
        production: productionPayload.rows ?? [],
        integrations: overview.integrations,
      });
    } catch (caught) {
      if (requestId !== loadRequest.current) return;
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (requestId === loadRequest.current) setLoading(false);
    }
  }, [trendEnd, trendStart]);

  useEffect(() => {
    void load();
    setNow(new Date());
    fetchMe().then(setUser).catch(() => {});
  }, [load]);

  const metrics = useMemo(() => {
    const sales = state.trend.reduce((sum, point) => sum + number(point.salesAmount), 0);
    const orders = state.trend.reduce((sum, point) => sum + point.orders, 0);
    const transit = state.production.filter((order) => order.archiveGroup === "transit").length;
    const warnings = state.consumables.filter((row) => row.lowStock);
    const activeProduction = state.production.filter((order) => order.archiveGroup === "production");
    const producing = state.production.filter((order) => order.stage === "producing").length;
    const pendingProduction = activeProduction.filter((order) => order.stage === "pending").length;
    const waitingProduction = activeProduction.filter((order) => order.stage === "waiting").length;
    return {
      sales,
      orders,
      transit,
      warnings,
      activeProduction,
      producing,
      pendingProduction,
      waitingProduction,
      latestDate: state.trend[state.trend.length - 1]?.date ?? null,
    };
  }, [state]);

  const purchaseSegments: StatusSegment[] = [
    { label: "待完善", count: state.procurement?.pendingSku ?? 0, color: "#f59e0b", href: "/purchase/workbench?view=orders&status=refine" },
    { label: "待入库", count: state.procurement?.pendingInbound ?? 0, color: "#35b9a4", href: "/purchase/workbench?view=orders&status=inbound" },
    { label: "待发票", count: state.procurement?.pendingInvoice ?? 0, color: "#8b6cf6", href: "/purchase/workbench?view=orders&status=invoice" },
    { label: "开票完成", count: state.completedPurchaseOrders, color: "#cbd5e1", href: "/purchase/workbench?view=orders&status=done" },
  ];

  const productionSegments: StatusSegment[] = [
    { label: "待确认", count: state.production.filter((order) => order.stage === "pending").length, color: "#f59e0b", href: "/supply-chain/production?group=production&stage=pending" },
    { label: "待生产", count: state.production.filter((order) => order.stage === "waiting").length, color: "#9bbcf7", href: "/supply-chain/production?group=production&stage=waiting" },
    { label: "生产中", count: state.production.filter((order) => order.stage === "producing").length, color: "#4f8df7", href: "/supply-chain/production?group=production&stage=producing" },
    { label: "在途", count: state.production.filter((order) => order.archiveGroup === "transit").length, color: "#35b9a4", href: "/supply-chain/production?group=transit" },
    { label: "到货/入库", count: state.production.filter((order) => order.archiveGroup === "receiving").length, color: "#8b6cf6", href: "/supply-chain/receiving" },
    { label: "已完成", count: state.production.filter((order) => order.archiveGroup === "archive").length, color: "#cbd5e1", href: "/supply-chain/production?group=archive" },
  ];

  const greeting = now ? (now.getHours() < 12 ? "早上好" : now.getHours() < 18 ? "下午好" : "晚上好") : "你好";
  const displayName = user?.displayName || user?.username || "Admin";
  const latestPoint = state.trend[state.trend.length - 1];
  const latestDataDate = shortDate(metrics.latestDate);
  const todayDataDate = now?.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
  const dayLabel = metrics.latestDate && todayDataDate === metrics.latestDate ? "今日" : "最近数据日";

  return (
    <div className="w-full min-w-0 space-y-5 pb-8">
      <header className="app-page-header -mx-1 bg-[#f4f7fb]/95 pb-3 backdrop-blur">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[22px] font-semibold tracking-tight text-[#14213a]">{greeting}，{displayName}</h1>
            <span className="text-lg" aria-hidden="true">👋</span>
          </div>
          <p className="mt-1 text-[13px] text-slate-500">从采购到入库，全流程跟踪，让供应链更简单</p>
        </div>
      </header>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">首页数据加载失败：{error}</div>}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label={`${dayLabel}销售额`} value={loading ? "…" : money(latestPoint?.salesAmount)} hint={`有效销售数据 · ${latestDataDate}`} href="/sales" tone="border-blue-100 bg-blue-50/70" mark="sales" iconTone="text-blue-600" />
        <KpiCard label={`${dayLabel}订单数`} value={loading ? "…" : quantity(latestPoint?.orders)} hint={`有效销售订单 · ${latestDataDate}`} href="/sales" tone="border-emerald-100 bg-emerald-50/70" mark="orders" iconTone="text-emerald-600" />
        <KpiCard label="在途订单" value={loading ? "…" : quantity(metrics.transit)} hint={`正品采购链路 · 待确认 ${metrics.pendingProduction} · 待生产 ${metrics.waitingProduction} · 生产中 ${metrics.producing}`} href="/supply-chain/production?group=transit" tone="border-orange-100 bg-orange-50/70" mark="transit" iconTone="text-orange-500" />
        <KpiCard label="库存预警" value={loading ? "…" : quantity(metrics.warnings.length)} hint="耗材可用库存低于安全库存" href="/inventory?tab=consumables" tone="border-violet-100 bg-violet-50/70" mark="warning" iconTone="text-violet-600" />
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
        <Panel title="近30天销售趋势" subtitle="销售额来自有效销售订单，订单数与销售额使用同一时间范围。" href="/sales">
          <TrendChart points={state.trend} loading={loading} rangeStart={trendStart} rangeEnd={trendEnd} onRangeStartChange={setTrendStart} onRangeEndChange={setTrendEnd} />
        </Panel>

        <Panel title="快捷操作" subtitle="直接进入下一步，不经过旧工作台中转。">
          <div className="mt-4 grid grid-cols-2 gap-3">
            <QuickAction href="/purchase/workbench?view=orders&action=new" mark="purchase" label="新建采购订单" tone="border-blue-100 bg-blue-50/60" iconTone="text-blue-600" />
            <QuickAction href="/data-center-import?tab=alibaba1688" mark="import" label="导入1688订单" tone="border-indigo-100 bg-indigo-50/60" iconTone="text-indigo-600" />
            <QuickAction href="/supply-chain/production/manual" mark="production" label="新建生产订单" tone="border-violet-100 bg-violet-50/60" iconTone="text-violet-600" />
            <QuickAction href="/supply-chain/warehouses" mark="warehouse" label="仓库管理" tone="border-orange-100 bg-orange-50/60" iconTone="text-orange-500" />
            <QuickAction href="/products" mark="product" label="货品档案" tone="border-slate-200 bg-slate-50" iconTone="text-slate-600" />
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="采购订单状态" subtitle="点击状态进入采购订单对应筛选。" href="/purchase/workbench">
          {loading ? <PanelLoading label="采购状态" /> : <StatusDonut segments={purchaseSegments} centerLabel="采购单" />}
        </Panel>

        <Panel title="生产订单状态" subtitle="正品采购按当前阶段自动归档，最终入库仍回到吉客云事实。" href="/supply-chain/production">
          {loading ? <PanelLoading label="生产状态" /> : state.production.length ? <StatusDonut segments={productionSegments} centerLabel="生产单" /> : <div className="flex h-52 items-center justify-center text-sm text-slate-400">暂无生产订单</div>}
        </Panel>

        <Panel title="库存预警" subtitle={`只展示耗材预警；正品库存=采购入库−销售出库独立运算 · 正品 SKU ${state.inventory?.skuCount ?? "—"} 个`} href="/inventory?tab=consumables">
          {loading ? <PanelLoading label="库存预警" /> : <div className="mt-4 divide-y divide-slate-100">
            {metrics.warnings.slice(0, 5).map((row) => (
              <Link key={row.id} href={`/inventory?tab=consumables&search=${encodeURIComponent(row.code)}`} className="flex items-center justify-between gap-3 py-2.5 hover:bg-amber-50/50">
                <span className="min-w-0 truncate text-xs text-slate-700">{row.name}<span className="ml-2 font-mono text-[10px] text-slate-400">{row.code}</span></span>
                <span className="shrink-0 text-right text-[11px] tabular-nums"><span className="text-amber-700">{quantity(row.availableQty)}</span><span className="text-slate-400"> / {quantity(row.minStockQty)}</span></span>
              </Link>
            ))}
            {!metrics.warnings.length && <div className="py-12 text-center text-sm text-slate-400">当前没有耗材库存预警</div>}
            {metrics.warnings.length > 5 && <Link href="/inventory?tab=consumables" className="block pt-2 text-center text-[11px] text-indigo-600">还有 {metrics.warnings.length - 5} 项，查看全部 →</Link>}
          </div>}
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <Panel title="最新销售订单" subtitle="订单号可直接穿透到销售明细，再继续查看 SKU、库存和货品档案。" href="/sales">
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-slate-50 text-left text-[11px] text-slate-500">
                <tr><th className="px-3 py-2 font-medium">订单号</th><th className="px-3 py-2 font-medium">渠道 / 店铺</th><th className="px-3 py-2 font-medium">商品名称</th><th className="px-3 py-2 text-right font-medium">数量</th><th className="px-3 py-2 text-right font-medium">实付</th><th className="px-3 py-2 font-medium">状态</th><th className="px-3 py-2 text-right font-medium">下单时间</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {state.orders.slice(0, 6).map((order) => (
                  <tr key={order.id} className="hover:bg-slate-50/70">
                    <td className="px-3 py-2.5"><Link href={`/sales?q=${encodeURIComponent(order.orderNo)}`} className="font-mono text-xs font-medium text-indigo-600 hover:underline">{order.orderNo}</Link></td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">{order.platform || "—"}<span className="ml-2 text-slate-400">{order.storeName || ""}</span></td>
                    <td className="max-w-[230px] truncate px-3 py-2.5 text-xs text-slate-600" title={order.itemName || "暂无商品明细"}>{order.itemName || "暂无商品明细"}{order.itemCount > 1 && <span className="ml-1 text-[10px] text-slate-400">+{order.itemCount - 1}项</span>}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-slate-700">{quantity(order.quantity)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-slate-700">{money(order.paidAmount)}</td>
                    <td className="px-3 py-2.5"><span className={`rounded-full px-2 py-0.5 text-[10px] ${/^\d+$/.test((order.orderStatus || "").trim()) ? "bg-slate-100 text-slate-600" : "bg-emerald-50 text-emerald-700"}`}>{salesStatusLabel(order.orderStatus)}</span></td>
                    <td className="px-3 py-2.5 text-right text-[11px] text-slate-400">{shortDate(order.orderedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {loading && <div className="py-10 text-center text-sm text-slate-400">正在加载销售订单…</div>}
            {!loading && !state.orders.length && <div className="py-10 text-center text-sm text-slate-400">暂无销售订单</div>}
          </div>
        </Panel>

        <Panel title="待办事项" subtitle="每一项都指向可以继续处理的业务模块。">
          <div className="mt-4 divide-y divide-slate-100">
            <Link href="/purchase/workbench?view=orders&status=refine" className="flex items-center justify-between py-3 text-xs hover:bg-slate-50"><span>待完善采购内容</span><b className="rounded-full bg-amber-50 px-2 py-1 text-amber-700">{state.procurement?.pendingSku ?? 0}</b></Link>
            <Link href="/purchase/workbench?view=orders&status=inbound" className="flex items-center justify-between py-3 text-xs hover:bg-slate-50"><span>待入库采购订单</span><b className="rounded-full bg-cyan-50 px-2 py-1 text-cyan-700">{state.procurement?.pendingInbound ?? 0}</b></Link>
            <Link href="/inventory?tab=consumables" className="flex items-center justify-between py-3 text-xs hover:bg-slate-50"><span>耗材库存预警</span><b className="rounded-full bg-orange-50 px-2 py-1 text-orange-700">{metrics.warnings.length}</b></Link>
            <Link href="/supply-chain/production" className="flex items-center justify-between py-3 text-xs hover:bg-slate-50"><span>生产链路待处理</span><b className="rounded-full bg-red-50 px-2 py-1 text-red-600">{state.production.filter((order) => order.hasException).length}</b></Link>
            <Link href="/exceptions" className="flex items-center justify-between py-3 text-xs hover:bg-slate-50"><span>异常中心</span><b className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">进入查看</b></Link>
          </div>
        </Panel>
      </div>

      <Panel title="数据连接" subtitle="连接状态只反映系统已记录的配置/测试结果，不把未测试通道显示为已连通。" href="/settings">
        <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {loading ? <div className="py-8 text-center text-sm text-slate-400">正在加载数据连接…</div> : state.integrations.map((item) => (
            <Link key={item.id} href="/settings" className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5 hover:border-indigo-100 hover:bg-indigo-50/40">
              <span className="min-w-0 truncate text-xs text-slate-700">{item.name}</span>
              <StatusBadge status={item.status} />
            </Link>
          ))}
          {!loading && !state.integrations.length && <div className="text-sm text-slate-400">暂无数据连接状态</div>}
        </div>
      </Panel>
    </div>
  );
}
