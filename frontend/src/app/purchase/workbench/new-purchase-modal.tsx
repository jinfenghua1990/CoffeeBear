"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  authenticatedFetch, consumablesApi, dashboardApi, warehousesApi,
  type CatalogSkuRow, type ConsumableRow, type WarehouseRow,
} from "@/lib/api";

type EntryLine = { key: number; itemId: string; quantity: string; amount: string; consumableId: string; consumableQuantity: string };
const EMPTY_LINE: EntryLine = { key: 1, itemId: "", quantity: "1", amount: "", consumableId: "", consumableQuantity: "" };

function localDateTime() {
  const now = new Date();
  const p = (v: number) => String(v).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}T${p(now.getHours())}:${p(now.getMinutes())}`;
}

export function NewPurchaseModal({ onClose, onCreated, createdOrderId, renderCreated }: {
  onClose: () => void;
  onCreated: (orderId: number, notice?: string) => void;
  createdOrderId?: number | null;
  renderCreated?: (orderId: number) => ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [orderKind, setOrderKind] = useState<"goods" | "consumable">("goods");
  const [platform, setPlatform] = useState("1688");
  const [supplier, setSupplier] = useState("");
  const [orderNo, setOrderNo] = useState("");
  const [orderedAt, setOrderedAt] = useState(localDateTime);
  const [warehouseId, setWarehouseId] = useState("");
  const [orderAmount, setOrderAmount] = useState("");
  const [paidAmount, setPaidAmount] = useState("0");
  const [inboundNo, setInboundNo] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [title, setTitle] = useState("");
  const [lines, setLines] = useState<EntryLine[]>([{ ...EMPTY_LINE }]);
  const [search, setSearch] = useState("");
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [goods, setGoods] = useState<CatalogSkuRow[]>([]);
  const [materials, setMaterials] = useState<ConsumableRow[]>([]);
  const [catalogError, setCatalogError] = useState("");

  useEffect(() => {
    let mounted = true;
    void Promise.all([
      warehousesApi.list(false),
      dashboardApi.products("", 1000),
      consumablesApi.list(),
    ]).then(([wh, skus, consumables]) => {
      if (!mounted) return;
      setWarehouses(wh.filter((row) => row.status === "active"));
      setGoods(skus.filter((row) => row.status === "active" && row.productType !== "virtual_bundle"));
      setMaterials(consumables.filter((row) => row.status === "active"));
    }).catch(() => {
      if (mounted) setCatalogError("商品或仓库档案未能加载，请刷新后重试");
    });
    return () => { mounted = false; };
  }, []);

  const candidates = useMemo(() => {
    const source = orderKind === "goods"
      ? goods.map((row) => ({ id: row.id, code: row.skuCode, name: row.skuName || row.goodsName, unit: row.unit }))
      : materials.map((row) => ({ id: row.id, code: row.code, name: row.name, unit: row.unit }));
    const term = search.trim().toLowerCase();
    const selected = new Set(lines.map((row) => Number(row.itemId)));
    return source.filter((row) => selected.has(row.id) || !term ||
      `${row.code} ${row.name}`.toLowerCase().includes(term)).slice(0, 500);
  }, [orderKind, goods, materials, search, lines]);

  const totalLines = lines.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const availableWarehouses = warehouses.filter((row) => row.purpose === orderKind || row.purpose === "both");
  // 与采购详情共用同一套紧凑信息密度：11px 标签、32px 控件、圆角 6px。
  // 新建单只是可编辑态，不应因为是弹窗而拥有另一套视觉比例。
  const inputClass = "h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[12px] text-slate-700 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50";
  const labelClass = "mb-1 block text-[11px] font-medium text-slate-500";
  const configuring = createdOrderId != null && renderCreated != null;

  function changeKind(kind: "goods" | "consumable") {
    setOrderKind(kind);
    setLines([{ ...EMPTY_LINE }]);
    setSearch("");
    if (!availableWarehouses.some((row) => row.id === Number(warehouseId) && (row.purpose === kind || row.purpose === "both"))) {
      setWarehouseId("");
    }
  }

  function updateLine(key: number, field: "itemId" | "quantity" | "amount" | "consumableId" | "consumableQuantity", value: string) {
    setLines((prev) => prev.map((row) => row.key === key ? { ...row, [field]: value } : row));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    const completeLines = lines.filter((row) => row.itemId || row.amount.trim());
    if (completeLines.some((row) => !row.itemId || !(Number(row.quantity) > 0) || !(Number(row.amount) >= 0) || !row.amount.trim() || (row.consumableId && !(Number(row.consumableQuantity) > 0)))) {
      setError("请补齐每条商品的商品名称、采购数量、行总价；填写耗材时还要填写使用量");
      return;
    }
    const inboundRef = inboundNo.trim();
    if (!completeLines.length && !inboundRef) {
      setError("请至少填写一条商品明细，或填写已有入库单号");
      return;
    }
    if (!(Number(orderAmount) >= 0) || !orderAmount.trim()) {
      setError("请输入有效采购总金额");
      return;
    }
    if (!(Number(paidAmount) >= 0) || !paidAmount.trim()) {
      setError("请输入已付款金额，未付款填 0");
      return;
    }
    setBusy(true);
    try {
      const response = await authenticatedFetch("/api/v1/purchase/orders/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform, external_order_id: orderNo.trim(), supplier_name: supplier.trim(),
          title: title.trim(), ordered_at: orderedAt,
          order_amount: orderAmount, paid_amount: paidAmount,
          warehouse_id: warehouseId ? Number(warehouseId) : null,
          order_kind: orderKind,
          inbound_no: inboundRef,
          invoice_reference_no: invoiceNo.trim(),
          items: completeLines.map((row) => ({
            item_id: Number(row.itemId), quantity: row.quantity, amount: row.amount,
            consumable_id: row.consumableId ? Number(row.consumableId) : null,
            consumable_quantity: row.consumableId ? row.consumableQuantity : null,
          })),
        }),
      });
      const body = await response.json().catch(() => ({})) as {
        detail?: string | Array<{ msg?: string }>;
        workbenchOrderId?: number; id?: number; inboundWarning?: string;
        consumableUsageStatus?: string; consumableUsageWarning?: string;
      };
      if (!response.ok) {
        const message = typeof body.detail === "string"
          ? body.detail
          : Array.isArray(body.detail) ? body.detail.map((item) => item.msg).join("；") : "";
        throw new Error(message || `整单保存失败（${response.status}）`);
      }
      const created = body.workbenchOrderId ?? (body.id ? -body.id : null);
      if (created == null) throw new Error("订单已提交但服务器未返回订单ID，请刷新列表核对，勿重复提交");
      const notice = body.consumableUsageWarning || body.inboundWarning || undefined;
      onCreated(created, notice);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "整单保存失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center overflow-y-auto bg-slate-950/40 p-2 sm:p-3">
      <div role="dialog" aria-modal="true" aria-label="一体化新建采购单" className="flex h-[calc(100vh-24px)] w-full max-w-[2048px] flex-col overflow-hidden rounded-xl bg-[#f7f9fc] shadow-[0_8px_32px_rgba(40,53,85,0.18)]">
        {configuring ? (
          <div className="min-h-0 flex-1 overflow-y-auto">{renderCreated?.(createdOrderId!)}</div>
        ) : (
          <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
            <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
              <div>
                <h2 className="text-[16px] font-semibold tracking-tight text-slate-900">新建采购单</h2>
                <p className="mt-1 text-[11px] text-slate-400">采购信息、商品明细、入库单号一次录入，最后统一保存整张单据。</p>
              </div>
              <button type="button" onClick={onClose} disabled={busy} aria-label="关闭" className="rounded-md px-2 py-1 text-xl text-slate-500 hover:bg-slate-100">×</button>
            </header>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 sm:p-4">
              <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 px-4 py-2.5"><h3 className="text-[13px] font-semibold text-slate-900">采购参数</h3><p className="mt-0.5 text-[11px] text-slate-400">新建时录入主档；保存后可在采购详情页继续调整。</p></div>
                <div className="p-4">
                <div className="grid gap-x-3 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-4">
                  <label><span className={labelClass}>供应商 *</span><input required autoFocus value={supplier} onChange={(e) => setSupplier(e.target.value)} className={inputClass} placeholder="供应商名称" maxLength={256} /></label>
                  <label><span className={labelClass}>采购渠道 *</span><select className={inputClass} value={platform} onChange={(e) => setPlatform(e.target.value)}><option value="1688">1688</option><option value="pdd">拼多多</option><option value="taobao">淘宝 / 天猫</option><option value="other">其他 / 线下</option></select></label>
                  <label><span className={labelClass}>采购订单号 *</span><input required value={orderNo} maxLength={128} onChange={(e) => setOrderNo(e.target.value)} className={inputClass} placeholder="优先填写平台原始订单号" /></label>
                  <label><span className={labelClass}>采购时间 *</span><input required type="datetime-local" value={orderedAt} onChange={(e) => setOrderedAt(e.target.value)} className={inputClass} /></label>
                  <label><span className={labelClass}>货品类型 *</span><select className={inputClass} value={orderKind} onChange={(e) => changeKind(e.target.value as "goods" | "consumable")}><option value="goods">正品</option><option value="consumable">耗材 / 包材</option></select></label>
                  <label><span className={labelClass}>目标入库仓库</span><select className={inputClass} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}><option value="">暂不指定</option>{availableWarehouses.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
                  <label><span className={labelClass}>采购总金额（元）*</span><input type="number" min="0" step="0.01" required className={inputClass} value={orderAmount} onChange={(e) => setOrderAmount(e.target.value)} placeholder="订单应付金额" /></label>
                  <label><span className={labelClass}>已付款金额（元）*</span><input type="number" min="0" step="0.01" required className={inputClass} value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} /><span className="mt-1 block text-[11px] text-slate-400">未付款填 0，不自动视为已付款</span></label>
                </div>
                <div className="mt-2.5 grid gap-x-3 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
                  <label><span className={labelClass}>已有入库单号（手工优先）</span><input value={inboundNo} onChange={(e) => setInboundNo(e.target.value)} maxLength={128} className={inputClass} placeholder="输入你已有的入库单号" /></label>
                  <label><span className={labelClass}>发票号码参考（可选）</span><input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} maxLength={128} className={inputClass} placeholder="待财务票据导入后正式匹配" /></label>
                  <label><span className={labelClass}>采购备注</span><input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} placeholder="采购说明 / 特殊要求" /></label>
                </div>
                <p className="mt-2.5 text-[11px] leading-5 text-slate-400">有入库单号先精确关联已有记录；暂未同步时保留原号等待核对，不会自动生成一张假入库单，也不会直接增加库存。发票号只保存参考，实际发票状态以税务发票池为准。</p>
                </div>
              </section>

              <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5">
                  <div><h3 className="text-[13px] font-semibold text-slate-900">商品明细 <span className="font-normal text-slate-400">（{lines.filter((row) => row.itemId).length} 行）</span></h3><p className="mt-0.5 text-[11px] text-slate-400">正品、数量、金额和对应耗材一次录入，保存后自动核算耗材使用。</p></div>
                  <button type="button" onClick={() => setLines((prev) => [...prev, { ...EMPTY_LINE, key: Math.max(...prev.map((row) => row.key)) + 1 }])} className="rounded-md bg-indigo-600 px-3 py-1.5 text-[11px] font-medium text-white shadow-[0_4px_12px_rgba(79,70,229,.2)] hover:bg-indigo-700">+ 新增商品</button>
                </div>
                <div className="p-4">
                {catalogError ? <p className="mb-2 text-xs text-red-600">{catalogError}</p> : null}
                <label className="mb-2.5 block max-w-[420px]"><span className={labelClass}>搜索商品档案</span><input className={inputClass} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索 SKU、商品名称或耗材代码" /></label>
                <div className="overflow-x-auto rounded-md border border-slate-100">
                  <div className="grid min-w-[940px] grid-cols-[2.5rem_1.5fr_90px_115px_1.1fr_95px_40px] gap-2 bg-slate-50 px-3 py-2 text-[11px] font-medium text-slate-500"><span>#</span><span>{orderKind === "goods" ? "商品 SKU" : "耗材"}</span><span>数量</span><span>金额</span><span>耗材名称</span><span>使用量</span><span /></div>
                  {lines.map((line, index) => (
                    <div key={line.key} className="grid min-w-[940px] grid-cols-[2.5rem_1.5fr_90px_115px_1.1fr_95px_40px] items-end gap-2 border-t border-slate-50 px-3 py-2 hover:bg-slate-50/50">
                      <div className="pb-2 text-center text-[11px] text-slate-400">{index + 1}</div>
                      <label><span className="sr-only">{orderKind === "goods" ? "商品 SKU" : "耗材"}</span><select aria-label={orderKind === "goods" ? "商品 SKU" : "耗材"} className={inputClass} value={line.itemId} onChange={(e) => updateLine(line.key, "itemId", e.target.value)}><option value="">选择商品</option>{candidates.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name} ({item.unit})</option>)}</select></label>
                      <label><span className="sr-only">数量</span><input aria-label="数量" type="number" min="0.0001" step="0.0001" value={line.quantity} onChange={(e) => updateLine(line.key, "quantity", e.target.value)} className={inputClass} /></label>
                      <label><span className="sr-only">行总价（元）</span><input aria-label="行总价（元）" type="number" min="0" step="0.01" value={line.amount} onChange={(e) => updateLine(line.key, "amount", e.target.value)} className={inputClass} placeholder="含税总价" /></label>
                      <label><span className="sr-only">耗材名称</span><select aria-label="耗材名称" className={inputClass} value={line.consumableId} onChange={(e) => updateLine(line.key, "consumableId", e.target.value)}><option value="">不指定</option>{materials.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
                      <label><span className="sr-only">耗材使用量</span><input aria-label="耗材使用量" type="number" min="0.0001" step="0.0001" value={line.consumableQuantity} onChange={(e) => updateLine(line.key, "consumableQuantity", e.target.value)} className={inputClass} placeholder="总用量" disabled={!line.consumableId} /></label>
                      <button type="button" disabled={lines.length === 1} onClick={() => setLines((prev) => prev.filter((row) => row.key !== line.key))} className="h-8 rounded-md text-lg text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30" title="删除此行">×</button>
                    </div>
                  ))}
                </div>
                </div>
                <div className="flex flex-wrap justify-end gap-5 border-t border-slate-100 bg-slate-50/50 px-4 py-2 text-[11px] text-slate-700">
                  <span>明细合计 <strong>¥{totalLines.toFixed(2)}</strong></span>
                  <span>与订单金额差额 <strong className={Math.abs(Number(orderAmount || 0) - totalLines) > 0.01 ? "text-amber-700" : "text-emerald-700"}>¥{(Number(orderAmount || 0) - totalLines).toFixed(2)}</strong></span>
                </div>
                <p className="mt-1 text-right text-[11px] text-slate-400">金额不一致时可保存待核对；运费等差额不冒充商品成本。</p>
              </section>
            </div>
            <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-3">
              <div className="max-w-[75%] text-[11px] text-slate-500">{error ? <span role="alert" className="text-red-600">{error}</span> : "一次提交整张单；若任何关键写入失败，后台会回滚，不会只保存一半。"}</div>
              <div className="flex gap-2"><button type="button" disabled={busy} onClick={onClose} className="rounded-md border border-slate-200 px-4 py-2 text-[12px] text-slate-600">取消</button><button type="submit" disabled={busy || Boolean(catalogError)} className="rounded-md bg-indigo-600 px-5 py-2 text-[12px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">{busy ? "保存中…" : "保存整张采购单"}</button></div>
            </footer>
          </form>
        )}
      </div>
    </div>
  );
}
