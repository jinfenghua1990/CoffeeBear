"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  consumablesApi,
  dashboardApi,
  type ConsumableRow,
  type InventorySkuRow,
  warehousesApi,
  type WarehouseRow,
} from "@/lib/api";

type InventoryTab = "all" | "goods" | "bundle" | "consumables";
type TypeFilter = "all" | "goods" | "bundle" | "consumable";
type StatusFilter = "all" | "active" | "inactive";
type AlertFilter = "all" | "normal" | "warning" | "critical" | "pending";
type StockStatus = "normal" | "warning" | "critical" | "pending" | "inactive";

type InventoryViewRow = {
  key: string;
  id: number;
  sourceKind: "goods" | "consumable";
  type: TypeFilter;
  typeLabel: "正品" | "耗材" | "组合套装";
  name: string;
  code: string;
  barcode: string;
  warehouse: string;
  warehouseNames: string[];
  available: number | null;
  locked: number | null;
  inbound30: number | null;
  outbound30: number | null;
  lastChanged: string | null;
  status: StockStatus;
  statusLabel: string;
  alert: AlertFilter;
  unit: string;
};

const TABS: Array<{ key: InventoryTab; label: string }> = [
  { key: "all", label: "全部库存" },
  { key: "goods", label: "正品单品" },
  { key: "bundle", label: "组合套装" },
  { key: "consumables", label: "耗材库存" },
];

function quantity(value: string | number | null | undefined) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatQuantity(value: number | null) {
  return value == null ? "—" : value.toLocaleString("zh-CN", { maximumFractionDigits: 4 });
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("zh-CN");
}

function statusFor(quantityValue: number | null, active: boolean, lowStock = false): { status: StockStatus; label: string; alert: AlertFilter } {
  if (!active) return { status: "inactive", label: "停用", alert: "all" };
  if (quantityValue == null) return { status: "pending", label: "待核算", alert: "pending" };
  if (quantityValue < 0) return { status: "critical", label: "紧张", alert: "critical" };
  if (lowStock || quantityValue === 0) return { status: "warning", label: "预警", alert: "warning" };
  return { status: "normal", label: "正常", alert: "normal" };
}

function typeOfGoods(row: InventorySkuRow): { type: TypeFilter; label: "正品" | "组合套装" } {
  return row.productType === "bundle" || row.productType === "virtual_bundle"
    ? { type: "bundle", label: "组合套装" }
    : { type: "goods", label: "正品" };
}

function toRows(goods: InventorySkuRow[], consumables: ConsumableRow[], warehouses: WarehouseRow[]): InventoryViewRow[] {
  const consumableWarehouseNames = warehouses
    .filter((row) => row.status === "active" && (row.purpose === "consumable" || row.purpose === "both"))
    .map((row) => row.name);
  const goodsRows = goods.map((row) => {
    const type = typeOfGoods(row);
    const available = row.hasMovement ? quantity(row.quantity) : null;
    const status = statusFor(available, row.status === "active");
    const warehouseNames = row.warehouses.map((warehouse) => warehouse.warehouseName || "未映射仓库");
    return {
      key: `goods-${row.skuId}`,
      id: row.skuId,
      sourceKind: "goods" as const,
      type: type.type,
      typeLabel: type.label,
      name: row.goodsName || row.skuName || row.skuCode,
      code: row.skuCode,
      barcode: row.barcode,
      warehouse: warehouseNames.length ? warehouseNames.join("、") : "未发生库存变动",
      warehouseNames,
      available,
      locked: null,
      inbound30: null,
      outbound30: null,
      lastChanged: row.lastDocumentAt,
      status: status.status,
      statusLabel: status.label,
      alert: status.alert,
      unit: row.unit,
    };
  });
  const consumableRows = consumables.map((row) => {
    const available = quantity(row.availableQty);
    const status = statusFor(available, row.status === "active", row.lowStock);
    return {
      key: `consumable-${row.id}`,
      id: row.id,
      sourceKind: "consumable" as const,
      type: "consumable" as const,
      typeLabel: "耗材" as const,
      name: row.name,
      code: row.code,
      barcode: row.barcode,
      warehouse: consumableWarehouseNames.length ? consumableWarehouseNames.join("、") : "耗材台账",
      warehouseNames: consumableWarehouseNames,
      available,
      locked: null,
      inbound30: null,
      outbound30: null,
      lastChanged: null,
      status: status.status,
      statusLabel: status.label,
      alert: status.alert,
      unit: row.unit,
    };
  });
  return [...goodsRows, ...consumableRows];
}

export default function InventoryPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<InventoryTab>(() => {
    const raw = new URLSearchParams(window.location.search).get("tab");
    return raw === "goods" || raw === "bundle" || raw === "consumables" ? raw : "all";
  });
  const [search, setSearch] = useState(() => searchParams.get("search") ?? "");
  const [warehouseFilter, setWarehouseFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [alertFilter, setAlertFilter] = useState<AlertFilter>("all");
  const [goods, setGoods] = useState<InventorySkuRow[]>([]);
  const [consumables, setConsumables] = useState<ConsumableRow[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    Promise.all([dashboardApi.inventorySkus(""), consumablesApi.list(""), warehousesApi.list(false)])
      .then(([goodsRows, consumableRows, warehouseRows]) => {
        setGoods(goodsRows);
        setConsumables(consumableRows);
        setWarehouses(warehouseRows);
      })
      .catch((caught) => setError(String(caught)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => toRows(goods, consumables, warehouses), [consumables, goods, warehouses]);
  const warehouseOptions = useMemo(
    () => [...new Set(rows.flatMap((row) => row.warehouseNames))].filter(Boolean).sort(),
    [rows],
  );
  const metrics = useMemo(() => ({
    inStockSku: rows.filter((row) => row.available != null && row.available > 0).length,
    goodsStock: rows.filter((row) => row.sourceKind === "goods").reduce((sum, row) => sum + (row.available ?? 0), 0),
    consumableSku: rows.filter((row) => row.sourceKind === "consumable").length,
    lowStock: rows.filter((row) => row.alert === "warning" || row.alert === "critical").length,
  }), [rows]);
  const visibleRows = useMemo(() => rows.filter((row) => {
    const term = search.trim().toLowerCase();
    const textMatch = !term || `${row.name} ${row.code} ${row.barcode}`.toLowerCase().includes(term);
    const tabMatch = tab === "all"
      || (tab === "goods" && row.sourceKind === "goods" && row.type === "goods")
      || (tab === "bundle" && row.sourceKind === "goods" && row.type === "bundle")
      || (tab === "consumables" && row.sourceKind === "consumable");
    const warehouseMatch = warehouseFilter === "all" || row.warehouseNames.includes(warehouseFilter);
    const typeMatch = typeFilter === "all" || row.type === typeFilter;
    const statusMatch = statusFilter === "all" || (statusFilter === "active" ? row.status !== "inactive" : row.status === "inactive");
    const alertMatch = alertFilter === "all" || row.alert === alertFilter;
    return textMatch && tabMatch && warehouseMatch && typeMatch && statusMatch && alertMatch;
  }), [alertFilter, rows, search, statusFilter, tab, typeFilter, warehouseFilter]);

  function changeTab(next: InventoryTab) {
    setTab(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next === "all") params.delete("tab");
    else params.set("tab", next);
    router.replace(`${pathname}${params.toString() ? `?${params}` : ""}`);
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 pb-8">
      <header className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-[11px] font-medium tracking-wide text-blue-600">货品中心 / 库存管理</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">库存总览</h1>
            <p className="mt-1 max-w-4xl text-sm leading-6 text-slate-500">统一查看正品、耗材与套装库存；正品按采购入库-销售出库运算，耗材按入库-领用-损耗管理。</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Link href="/inventory/adjustments" className="rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-medium text-white shadow-sm shadow-blue-200 transition hover:bg-blue-700">库存调整</Link>
            <button type="button" disabled className="cursor-not-allowed rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs text-slate-400" title="当前没有库存导出接口">导出库存</button>
            <Link href="/inventory/transactions" className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-600 transition hover:border-blue-200 hover:text-blue-600">查看流水</Link>
          </div>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="库存指标">
        <InventoryMetric label="在库 SKU" value={String(metrics.inStockSku)} hint="当前可用库存大于 0" tone="blue" />
        <InventoryMetric label="正品库存" value={formatQuantity(metrics.goodsStock)} hint="采购入库 − 销售出库" tone="indigo" />
        <InventoryMetric label="耗材 SKU" value={String(metrics.consumableSku)} hint="耗材库存台账" tone="amber" />
        <InventoryMetric label="低库存预警" value={String(metrics.lowStock)} hint="预警或紧张" tone="rose" />
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 pt-2">
          <div className="flex gap-5 overflow-x-auto">
            {TABS.map((item) => <button key={item.key} type="button" onClick={() => changeTab(item.key)} className={`whitespace-nowrap border-b-2 px-1 py-3 text-sm font-medium transition ${tab === item.key ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}>{item.label}</button>)}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/60 px-4 py-3">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索货品名称、编码或条码" className="h-9 w-64 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-400" />
          <select aria-label="仓库筛选" value={warehouseFilter} onChange={(event) => setWarehouseFilter(event.target.value)} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-600 outline-none focus:border-blue-400"><option value="all">仓库：全部</option>{warehouseOptions.map((warehouse) => <option key={warehouse} value={warehouse}>{warehouse}</option>)}</select>
          <select aria-label="类型筛选" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as TypeFilter)} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-600 outline-none focus:border-blue-400"><option value="all">类型：全部</option><option value="goods">正品单品</option><option value="bundle">组合套装</option><option value="consumable">耗材</option></select>
          <select aria-label="状态筛选" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-600 outline-none focus:border-blue-400"><option value="all">状态：全部</option><option value="active">状态：启用</option><option value="inactive">状态：停用</option></select>
          <select aria-label="预警状态筛选" value={alertFilter} onChange={(event) => setAlertFilter(event.target.value as AlertFilter)} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-600 outline-none focus:border-blue-400"><option value="all">预警：全部</option><option value="normal">预警：正常</option><option value="warning">预警：预警</option><option value="critical">预警：紧张</option><option value="pending">预警：待核算</option></select>
          <span className="ml-auto text-xs text-slate-400">显示 {visibleRows.length} / {rows.length} 条</span>
        </div>

        {error && <div role="alert" className="mx-4 mt-4 rounded-xl border border-rose-100 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">{error}</div>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1240px] text-left text-[13px]">
            <thead className="bg-slate-50 text-[11px] font-medium text-slate-500">
              <tr>
                <th className="px-4 py-3">货品名称</th>
                <th className="px-3 py-3">类型</th>
                <th className="px-3 py-3">仓库</th>
                <th className="px-3 py-3">编码</th>
                <th className="px-3 py-3 text-right">可用库存</th>
                <th className="px-3 py-3 text-right">锁定库存</th>
                <th className="px-3 py-3 text-right">近30天入库</th>
                <th className="px-3 py-3 text-right">近30天出库</th>
                <th className="px-3 py-3">最近变动</th>
                <th className="px-3 py-3">状态</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleRows.map((row) => <InventoryRow key={row.key} row={row} />)}
            </tbody>
          </table>
          {loading && <div className="p-12 text-center text-sm text-slate-400">正在加载库存…</div>}
          {!loading && !visibleRows.length && <div className="p-12 text-center text-sm text-slate-400">没有匹配的库存记录</div>}
        </div>
        <div className="border-t border-slate-100 bg-amber-50/50 px-4 py-3 text-xs leading-5 text-amber-800">锁定库存、近30天入库/出库当前接口未返回，页面保留字段位并显示“—”，未用 0 代替真实数据。</div>
      </section>
    </div>
  );
}

function InventoryRow({ row }: { row: InventoryViewRow }) {
  const typeClass = row.type === "consumable" ? "bg-amber-50 text-amber-700" : row.type === "bundle" ? "bg-indigo-50 text-indigo-700" : "bg-emerald-50 text-emerald-700";
  const statusClass = row.status === "normal" ? "bg-emerald-50 text-emerald-700" : row.status === "warning" ? "bg-amber-50 text-amber-700" : row.status === "critical" ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-500";
  return (
    <tr className="transition-colors hover:bg-slate-50/70">
      <td className="max-w-[260px] px-4 py-3"><div className="truncate font-medium text-slate-800" title={row.name}>{row.name}</div><div className="mt-0.5 text-[11px] text-slate-400">{row.barcode || "暂无条码"} · {row.unit || "—"}</div></td>
      <td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-[11px] font-medium ${typeClass}`}>{row.typeLabel}</span></td>
      <td className="max-w-[190px] px-3 py-3 text-xs text-slate-600"><span className="line-clamp-2" title={row.warehouse}>{row.warehouse}</span></td>
      <td className="px-3 py-3 font-mono text-xs text-slate-600">{row.code}</td>
      <td className="px-3 py-3 text-right font-medium tabular-nums text-slate-800">{formatQuantity(row.available)}</td>
      <td className="px-3 py-3 text-right tabular-nums text-slate-400" title="当前接口未提供锁定库存">{formatQuantity(row.locked)}</td>
      <td className="px-3 py-3 text-right tabular-nums text-slate-400" title="当前接口未提供近30天入库">{formatQuantity(row.inbound30)}</td>
      <td className="px-3 py-3 text-right tabular-nums text-slate-400" title="当前接口未提供近30天出库">{formatQuantity(row.outbound30)}</td>
      <td className="px-3 py-3 text-xs text-slate-500">{formatDate(row.lastChanged)}</td>
      <td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-[11px] font-medium ${statusClass}`}>{row.statusLabel}</span></td>
      <td className="whitespace-nowrap px-4 py-3 text-right"><Link href={`/inventory/adjustments?kind=${row.sourceKind}&id=${row.id}`} className="rounded-md px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50">调整</Link><Link href={`/inventory/transactions?kind=${row.sourceKind}&id=${row.id}`} className="rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100">流水</Link></td>
    </tr>
  );
}

function InventoryMetric({ label, value, hint, tone }: { label: string; value: string; hint: string; tone: "blue" | "indigo" | "amber" | "rose" }) {
  const toneClass = tone === "amber" ? "bg-amber-50 text-amber-600" : tone === "indigo" ? "bg-indigo-50 text-indigo-600" : tone === "rose" ? "bg-rose-50 text-rose-600" : "bg-blue-50 text-blue-600";
  return <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm"><div><div className="text-xs text-slate-500">{label}</div><div className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">{value}</div><div className="mt-1 text-[11px] text-slate-400">{hint}</div></div><span className={`flex h-10 w-10 items-center justify-center rounded-xl text-sm font-semibold ${toneClass}`}>{label.slice(0, 1)}</span></div>;
}
