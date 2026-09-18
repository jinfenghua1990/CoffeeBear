"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { consumablesApi, type ConsumableRow, warehousesApi, type WarehouseRow } from "@/lib/api";

export default function InventoryAdjustmentsPage() {
  const searchParams = useSearchParams();
  const kind = searchParams.get("kind");
  const goodsRequested = kind === "goods";
  const requestedId = Number(searchParams.get("id"));
  const [rows, setRows] = useState<ConsumableRow[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(Number.isInteger(requestedId) && requestedId > 0 ? requestedId : null);
  const [warehouseId, setWarehouseId] = useState("");
  const [delta, setDelta] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (goodsRequested) {
      setRows([]);
      setWarehouses([]);
      setLoading(false);
      return;
    }
    Promise.all([consumablesApi.list(""), warehousesApi.list(false)])
      .then(([consumableRows, warehouseRows]) => {
        setRows(consumableRows);
        setWarehouses(warehouseRows);
        setSelectedId((current) => consumableRows.some((row) => row.id === current) ? current : consumableRows[0]?.id ?? null);
        const first = warehouseRows.find((row) => row.status === "active" && (row.purpose === "consumable" || row.purpose === "both"));
        if (first) setWarehouseId(String(first.id));
      })
      .catch((caught) => setError(String(caught)))
      .finally(() => setLoading(false));
  }, [goodsRequested]);

  const consumableWarehouses = useMemo(() => warehouses.filter((row) => row.status === "active" && (row.purpose === "consumable" || row.purpose === "both")), [warehouses]);
  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const selectedWarehouse = consumableWarehouses.find((row) => String(row.id) === warehouseId) ?? null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedId || !selectedWarehouse || !delta.trim() || Number(delta) === 0) return;
    setSaving(true); setError(""); setMessage("");
    try {
      await consumablesApi.addTransaction(selectedId, {
        transaction_type: "stocktake",
        quantity: delta.trim(),
        location: selectedWarehouse.warehouseType === "factory" ? "factory" : "own",
        warehouse_id: selectedWarehouse.id,
        note: note.trim(),
      });
      setMessage(`已为“${selected?.name ?? "耗材"}”登记 ${delta} 的盘点调整，流水已写入台账。`);
      setDelta(""); setNote("");
      setRows(await consumablesApi.list(""));
    } catch (caught) { setError(String(caught)); }
    finally { setSaving(false); }
  }

  return (
    <div className="mx-auto max-w-[1120px] space-y-4 pb-8">
      <header className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="text-[11px] font-medium tracking-wide text-blue-600">货品中心 / 库存管理</div><h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">库存调整</h1><p className="mt-1 text-sm leading-6 text-slate-500">耗材正常入库来自采购单实际收货；正品实际入库后，系统按货品映射自动生成耗材耗用。本页仅用于盘点差异与包装损耗校正。</p></div><Link href="/inventory" className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-medium text-slate-600 hover:border-blue-200 hover:text-blue-600">返回库存总览</Link></div></header>
      {message && <div role="status" className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>}
      {error && <div role="alert" className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      {goodsRequested ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-5 shadow-sm"><h2 className="text-base font-semibold text-amber-900">正品库存调整尚未开放</h2><p className="mt-2 text-sm leading-6 text-amber-800">正品库存由采购入库 − 销售出库独立运算，当前没有正品库存调整接口。正品实际入库后，系统会按货品与耗材映射自动形成耗材耗用流水。</p><Link href="/inventory/operations?tab=usage" className="mt-3 inline-flex rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-amber-700">查看自动耗材流水</Link></section>
      ) : (
        <>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-base font-semibold text-slate-900">耗材盘点 / 异常校正</h2><p className="mt-1 text-xs text-slate-500">只登记盘点差异或包装损耗，不作为日常耗材出库；正品实际入库后，耗材由系统按映射自动扣减。</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">非日常出库</span></div>
            <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-slate-600">耗材<select required value={selectedId ?? ""} onChange={(event) => setSelectedId(Number(event.target.value) || null)} className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-400"><option value="">请选择耗材</option>{rows.map((row) => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}</select></label>
              <label className="text-xs text-slate-600">实际仓库<select required value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-400"><option value="">请选择耗材仓库</option>{consumableWarehouses.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
              <label className="text-xs text-slate-600">调整差额<span className="ml-1 text-slate-400">（正数盘盈，负数盘亏）</span><input required inputMode="decimal" value={delta} onChange={(event) => setDelta(event.target.value)} placeholder="例如 10 或 -2" className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-400" /></label>
              <label className="text-xs text-slate-600">调整原因<input required value={note} onChange={(event) => setNote(event.target.value)} placeholder="例如：月末盘点差异" className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-400" /></label>
              <div className="flex items-end justify-between gap-3 sm:col-span-2"><p className="text-xs leading-5 text-slate-400">{selected ? `当前可用库存：${selected.availableQty} ${selected.unit}` : "请选择耗材后查看当前库存"}</p><button type="submit" disabled={loading || saving || !selectedId || !selectedWarehouse} className="rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-medium text-white shadow-sm shadow-blue-200 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40">{saving ? "保存中…" : "登记盘点调整"}</button></div>
            </form>
            {!loading && !consumableWarehouses.length && <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">当前没有用途为“耗材”或“正品 + 耗材”的启用仓库，暂不能登记盘点调整。</p>}
          </section>
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-xs leading-5 text-blue-800"><span>耗材采购收货增加库存；正品实际入库后系统自动生成耗材耗用；包装损耗在本页登记盘点差异。</span><span className="flex gap-3"><Link href="/inventory/operations?tab=receipt" className="font-medium text-blue-700 hover:underline">去耗材采购入库 →</Link><Link href="/inventory/operations?tab=usage" className="font-medium text-blue-700 hover:underline">查看自动耗材流水 →</Link></span></section>
        </>
      )}
    </div>
  );
}
