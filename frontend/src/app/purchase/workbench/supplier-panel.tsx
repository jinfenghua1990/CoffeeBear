"use client";

import { Empty, Icon, Loading, cx, fmtDate, fmtMoney } from "./workbench-shared";
import NextLink from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type InvoiceReconciliation,
  type WorkbenchSupplierDetail,
  type WorkbenchSupplierSummary,
  procurementWorkbenchApi,

} from "@/lib/api";

export function SupplierList({ suppliers, loading, query, selectedName, onQueryChange, onSelect }: {
  suppliers: WorkbenchSupplierSummary[]; loading: boolean; query: string; selectedName: string | null;
  onQueryChange: (value: string) => void; onSelect: (name: string) => void;
}) {
  return (
    <section className="min-w-0 overflow-x-auto rounded-xl border border-slate-200/90 bg-white shadow-[0_3px_14px_rgba(40,53,85,0.035)]">
      <div className="flex min-w-[700px] items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div><h2 className="text-[13px] font-semibold text-slate-800">供应商管理</h2><p className="mt-0.5 text-[12px] text-slate-400">采购频次、金额、入库与发票状态汇总</p></div>
        <div className="flex w-56 items-center gap-2 rounded-lg bg-slate-50 px-3"><Icon name="search" size={14} /><input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="搜索供应商" className="h-8 min-w-0 flex-1 bg-transparent text-[11px] outline-none placeholder:text-slate-400" /></div>
      </div>
      <div className="grid min-w-[700px] grid-cols-[minmax(220px,1fr)_90px_130px_110px_110px] gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-2 text-[12px] font-medium text-slate-400">
        <span>供应商</span><span className="text-right">采购次数</span><span className="text-right">累计采购</span><span className="text-right">未入库</span><span className="text-right">最近采购</span>
      </div>
      {loading ? <Loading text="正在加载供应商…" /> : suppliers.length === 0 ? <Empty text="暂无供应商数据" /> : <div className="min-w-[700px] divide-y divide-slate-100">{suppliers.map((supplier) => (
        <button key={supplier.supplierName} onClick={() => onSelect(supplier.supplierName)} className={cx(
          "grid w-full grid-cols-[minmax(220px,1fr)_90px_130px_110px_110px] items-center gap-3 px-4 py-3 text-left transition-colors",
          selectedName === supplier.supplierName ? "bg-indigo-50/60 ring-1 ring-inset ring-indigo-400" : "hover:bg-slate-50"
        )}>
          <span className="truncate text-[12px] font-medium text-slate-700">{supplier.supplierName}</span>
          <span className="text-right text-[11px] tabular-nums text-slate-500">{supplier.orderCount}次</span>
          <span className="text-right text-[11px] font-semibold tabular-nums text-slate-700">{fmtMoney(supplier.totalPurchase)}</span>
          <span className="text-right text-[11px] tabular-nums text-orange-500">{fmtMoney(supplier.uninbound)}</span>
          <span className="text-right text-[12px] text-slate-400">{fmtDate(supplier.lastOrderDate)}</span>
        </button>
      ))}</div>}
    </section>
  );
}

/** 发票状态标签：与发票对账视图（view=tax）口径一致 */
const INVOICE_MATCH_BADGE: Record<string, { text: string; cls: string }> = {
  matched: { text: "已配平", cls: "bg-emerald-50 text-emerald-600" },
  short: { text: "订单不足", cls: "bg-amber-50 text-amber-600" },
};

/** 订单匹配状态：remaining = 该单未被发票覆盖的余量（后端 FIFO 配平结果） */
export function orderMatchStatus(order: { orderAmount: number; remaining: number }): { text: string; cls: string; sub: string } {
  if (order.orderAmount <= 0.005) return { text: "金额未同步", cls: "bg-slate-100 text-slate-400", sub: "金额为 0 未参与配平" };
  if (order.remaining <= 0.05) return { text: "已配平", cls: "bg-emerald-50 text-emerald-600", sub: "发票已足额覆盖" };
  const matched = order.orderAmount - order.remaining;
  if (matched > 0.05) return { text: "部分匹配", cls: "bg-sky-50 text-sky-600", sub: "已配 " + fmtMoney(matched) + " · 余 " + fmtMoney(order.remaining) };
  return { text: "待开票", cls: "bg-amber-50 text-amber-600", sub: "无发票覆盖" };
}

export function SupplierDetailPanel({ detail, loading, pendingName, onRenamed }: {
  detail: WorkbenchSupplierDetail | null;
  loading: boolean;
  /** 正在切换的目标供应商：detail 还是上一家时置灰并禁点，避免把改名写到旧供应商上。 */
  pendingName?: string | null;
  onRenamed?: (newName: string) => void | Promise<void>;
}) {
  const supplierName = detail?.supplierName ?? null;
  const supplierPartnerId = detail?.partnerId ?? null;
  const [invoiceData, setInvoiceData] = useState<InvoiceReconciliation | null>(null);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState("");

  // 供应商改名/归一：统一该供应商全部订单的写法，同名供应商自动合并
  async function saveRename() {
    if (!detail) return;
    const newName = nameDraft.trim();
    if (!newName || newName === detail.supplierName) {
      setEditingName(false);
      setRenameError("");
      return;
    }
    setRenaming(true);
    setRenameError("");
    try {
      await procurementWorkbenchApi.renameSupplier(detail.supplierName, newName);
      setEditingName(false);
      await onRenamed?.(newName);
    } catch (caught) {
      setRenameError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRenaming(false);
    }
  }

  // 发票匹配清单：按当前供应商拉取配平结果（手工关联优先 + FIFO 自动）；手工微调后 onReload 刷新
  const loadInvoiceMatch = useCallback(() => {
    if (!supplierName) {
      setInvoiceData(null);
      return;
    }
    let cancelled = false;
    setInvoiceLoading(true);
    procurementWorkbenchApi.invoiceReconciliation({
      partnerId: supplierPartnerId ?? undefined,
      supplier: supplierName,
    })
      .then((data) => { if (!cancelled) setInvoiceData(data); })
      .catch(() => { if (!cancelled) setInvoiceData(null); })
      .finally(() => { if (!cancelled) setInvoiceLoading(false); });
    return () => { cancelled = true; };
  }, [supplierName, supplierPartnerId]);

  useEffect(() => loadInvoiceMatch(), [loadInvoiceMatch]);

  const invoiceEntry = useMemo(() => {
    const list = invoiceData?.suppliers ?? [];
    if (list.length === 0) return null;
    return list.find((s) => s.supplier === supplierName) ?? list[0];
  }, [invoiceData, supplierName]);

  if (loading && !detail) return <aside className="rounded-xl border border-slate-200 bg-white"><Loading text="正在加载供应商画像…" /></aside>;
  if (!detail) return <aside className="flex min-h-[480px] items-center justify-center rounded-xl border border-slate-200 bg-white text-[12px] text-slate-400">选择供应商查看详情</aside>;
  const pendingSwap = pendingName != null && detail.supplierName !== pendingName;
  return (
    <aside className="xl:sticky xl:top-[calc(var(--wb-header-h,162px)+8px)] xl:self-start">
      <div className={cx("relative rounded-xl border border-slate-200/90 bg-white p-4 shadow-[0_4px_18px_rgba(40,53,85,0.04)] transition-opacity duration-150", pendingSwap && "pointer-events-none opacity-60")}>
        {pendingSwap && <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[2px] animate-pulse rounded-t-xl bg-blue-500/70" />}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-slate-400">供应商画像</div>
            {editingName ? (
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveRename();
                  if (e.key === "Escape") { setEditingName(false); setRenameError(""); }
                }}
                className="mt-1 w-full rounded-md border border-indigo-200 px-2 py-1 text-[14px] font-semibold text-slate-800 outline-none focus:border-indigo-400"
              />
            ) : (
              <h2 className="mt-1 text-[15px] font-semibold text-slate-800">{detail.supplierName}</h2>
            )}
          </div>
          {editingName ? (
            <span className="flex shrink-0 gap-1.5 pt-4">
              <button disabled={renaming} onClick={() => void saveRename()} className="rounded-md bg-indigo-500 px-2.5 py-1 text-[11px] text-white hover:bg-indigo-600 disabled:opacity-50">{renaming ? "保存中…" : "保存"}</button>
              <button onClick={() => { setEditingName(false); setRenameError(""); }} className="rounded-md border border-slate-200 px-2.5 py-1 text-[11px] text-slate-500 hover:bg-slate-50">取消</button>
            </span>
          ) : (
            <button onClick={() => { setNameDraft(detail.supplierName); setEditingName(true); }} className="mt-3 shrink-0 text-[11px] text-indigo-500 hover:underline">改名</button>
          )}
        </div>
        {editingName && (
          <p className="mt-1 text-[10px] leading-4 text-slate-400">
            该供应商全部订单将统一改为新名称；若与现有供应商同名会自动合并（发票卖方名是税务事实不受影响）。回车保存，Esc 取消。
          </p>
        )}
        {renameError && <p className="mt-1 text-[11px] text-red-500">{renameError}</p>}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <SupplierMetric label="采购次数" value={detail.orderCount + "次"} tone="indigo" />
          <SupplierMetric label="累计采购" value={fmtMoney(detail.totalPurchase)} tone="indigo" />
          <SupplierMetric label="未开票金额" value={fmtMoney(detail.uninvoiced)} tone="amber" />
          <SupplierMetric label="未入库金额" value={fmtMoney(detail.uninbound)} tone="amber" />
        </div>
        <div className="mt-3 rounded-lg border border-slate-100 p-3">
          <div className="text-[12px] font-semibold text-slate-700">常购SKU</div>
          <div className="mt-2 space-y-1.5">{detail.oftenSkus.length > 0 ? detail.oftenSkus.slice(0, 6).map((sku) => (
        <div key={sku.skuCode} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2.5 py-2 text-[12px]"><span className="truncate text-slate-600">{sku.goodsName || "未命名商品"}</span><span className="shrink-0 font-mono text-indigo-500">{sku.skuCode} · {sku.count}次</span></div>
          )) : <div className="py-4 text-center text-[12px] text-slate-400">暂无常购SKU</div>}</div>
        </div>
        <div className="mt-3 rounded-lg border border-slate-100 p-3">
          <div className="text-[12px] font-semibold text-slate-700">最近采购订单</div>
          <div className="mt-2 space-y-1.5">{detail.recentOrders.length > 0 ? detail.recentOrders.slice(0, 6).map((order) => (
        <div key={order.orderId} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2.5 py-2 text-[12px]"><span className="truncate font-mono text-indigo-500">{order.orderNo}</span><span className="shrink-0 text-slate-400">{fmtDate(order.orderDate)}　{fmtMoney(order.amount)}</span></div>
          )) : <div className="py-4 text-center text-[12px] text-slate-400">暂无历史订单</div>}</div>
        </div>
        <SupplierInvoiceMatchSection
          entry={invoiceEntry}
          loading={invoiceLoading && !invoiceEntry}
          hasData={invoiceData != null}
          onReload={loadInvoiceMatch}
        />
      </div>
    </aside>
  );
}

export function SupplierInvoiceMatchSection({ entry, loading, hasData, onReload }: {
  entry: InvoiceReconciliation["suppliers"][number] | null;
  loading: boolean;
  hasData: boolean;
  onReload: () => void;
}) {
  const [adjustingId, setAdjustingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // 手工微调：把订单挂到发票（manual 关联落库）后整票以手工为准，不再自动 FIFO
  async function addMatch(invoiceId: number, poId: number) {
    setBusy(true);
    try {
      await procurementWorkbenchApi.createInvoiceMatch(invoiceId, poId);
      setAdjustingId(null);
      onReload();
    } finally {
      setBusy(false);
    }
  }

  async function removeLink(linkId: number) {
    setBusy(true);
    try {
      await procurementWorkbenchApi.deleteInvoiceMatch(linkId);
      onReload();
    } finally {
      setBusy(false);
    }
  }

  const matchCandidates = (entry?.orders ?? []).filter((o) => o.remaining > 0.05);

  return (
    <div className="mt-3 rounded-lg border border-slate-100 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[12px] font-semibold text-slate-700">发票匹配清单</div>
        {entry && (
          <NextLink href={`/purchase/workbench?view=tax`} className="text-[11px] text-indigo-500 hover:underline">全量对账 →</NextLink>
        )}
      </div>
      <p className="mt-1 text-[10px] leading-4 text-slate-400">按开票日期配平：每张发票只自动匹配开票日当天及之前的采购订单；符合日期条件的订单再按下单时间从早到晚累计，一张发票可覆盖多张订单。手工调整优先并落库。</p>
      {loading ? (
        <div className="flex items-center gap-2 py-4 text-[12px] text-slate-400"><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-200 border-t-indigo-500" />正在匹配发票…</div>
      ) : !entry ? (
        <div className="py-4 text-center text-[12px] text-slate-400">
          {hasData ? "该供应商暂无已开票的进项发票" : "暂无发票数据"}
          <div className="mt-1 text-[11px] text-slate-300">可到「税务发票」页导入发票清单</div>
        </div>
      ) : (
        <>
          <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
            <div className="rounded-md bg-slate-50 px-1 py-1.5"><div className="text-[10px] text-slate-400">发票合计</div><div className="text-[12px] font-semibold tabular-nums text-slate-700">{entry.invoiceCount}张 · {fmtMoney(entry.invoiceTotal)}</div></div>
            <div className="rounded-md bg-emerald-50/70 px-1 py-1.5"><div className="text-[10px] text-slate-400">已配平</div><div className="text-[12px] font-semibold tabular-nums text-emerald-600">{fmtMoney(entry.matchedTotal)}</div></div>
            <div className="rounded-md bg-amber-50/70 px-1 py-1.5"><div className="text-[10px] text-slate-400">待开票订单</div><div className="text-[12px] font-semibold tabular-nums text-amber-600">{entry.remainingOrders}单 · {fmtMoney(entry.remainingOrderTotal)}</div></div>
          </div>
          {entry.months.length === 0 ? (
            <div className="py-3 text-center text-[12px] text-slate-400">该供应商暂无进项发票</div>
          ) : entry.months.map((month) => (
            <div key={month.month} className="mt-2">
              <div className="text-[11px] font-medium text-slate-500">{month.month === "未知月份" ? month.month : month.month + " 开票"}</div>
              <div className="mt-1 space-y-1.5">
                {month.invoices.map((inv) => {
                  const badge = INVOICE_MATCH_BADGE[inv.status] ?? { text: inv.status, cls: "bg-slate-100 text-slate-500" };
                  return (
                    <div key={inv.invoiceId} className="rounded-md bg-slate-50 px-2.5 py-2 text-[12px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-mono text-indigo-600">{inv.invoiceNo || "无发票号"}</span>
                        <span className="flex shrink-0 items-center gap-1">
                          {inv.manualLinked ? (
                            <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-500">手动</span>
                          ) : inv.explicitLinked ? (
                            <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-600">清单关联</span>
                          ) : null}
                          <span className={"rounded px-1.5 py-0.5 text-[10px] " + badge.cls}>{inv.shortReason === "explicit_link_issue" ? "待核对" : badge.text}</span>
                        </span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-400">
                        开票 {fmtDate(inv.issueDate)} · 票面 {fmtMoney(inv.amount)}
                        {inv.coveredTotal > 0 && <> · 已配订单 {fmtMoney(inv.coveredTotal)}</>}
                        {inv.status === "short" && <> · 差额 {fmtMoney(Math.abs(inv.diff))}</>}
                      </div>
                      {inv.status === "short" && inv.shortReason === "date_cutoff" && (
                        <div className="mt-1 rounded bg-amber-50 px-2 py-1 text-[10px] leading-4 text-amber-700">
                          截至 {fmtDate(inv.issueDate)} 的订单金额不足；后续订单不参与本票自动匹配
                          {inv.futureOrderCount ? `（后续/日期待确认订单 ${inv.futureOrderCount} 单）` : ""}。
                        </div>
                      )}
                      {inv.status === "short" && inv.shortReason === "insufficient_orders" && (
                        <div className="mt-1 rounded bg-amber-50 px-2 py-1 text-[10px] leading-4 text-amber-700">
                          截至开票日可用采购订单金额不足，请核对是否存在漏单、金额未同步或供应商名称不一致。
                        </div>
                      )}
                      {inv.status === "short" && inv.shortReason === "explicit_link_issue" && (
                        <div className="mt-1 rounded bg-rose-50 px-2 py-1 text-[10px] leading-4 text-rose-700">
                          已有明确关联，但分摊金额或采购单映射不完整，请先核对关联关系；系统不会回退到 FIFO 猜单。
                        </div>
                      )}
                      {inv.covered.length === 0 ? (
                        <div className="mt-1 text-[11px] text-amber-600">
                          {inv.shortReason === "date_cutoff"
                            ? "截至开票日暂无可用采购订单；系统不会把之后下单的订单倒挂到此前发票"
                            : inv.shortReason === "explicit_link_issue"
                            ? "明确关联尚未形成可用分摊，请核对订单映射或分摊金额"
                            : "未匹配到可用采购订单（订单池为空或金额已耗尽）"}
                        </div>
                      ) : inv.covered.map((order) => (
                        <div key={(order.linkId ?? "a") + "-" + order.orderId} className="mt-1 flex items-center justify-between gap-2 rounded bg-white px-2 py-1 text-[11px]">
                          <span className="flex min-w-0 items-center gap-1">
                            <span className={"shrink-0 rounded px-1 py-px text-[9px] " + (order.source === "manual" ? "bg-indigo-50 text-indigo-500" : order.source === "source_ref" ? "bg-sky-50 text-sky-600" : "bg-slate-100 text-slate-400")}>{order.source === "manual" ? "手动" : order.source === "source_ref" ? "清单" : "自动"}</span>
                            <span className="truncate font-mono text-slate-500">{order.orderNo || "无单号"}</span>
                          </span>
                          <span className="flex shrink-0 items-center gap-1.5 text-slate-400">
                            {fmtDate(order.date)} · 消耗 {fmtMoney(order.consumed)}{order.allocatedAmount != null && order.allocatedAmount !== order.consumed ? <span className="text-rose-500">（关联 {fmtMoney(order.allocatedAmount)}）</span> : null}{order.partial && <span className="text-amber-500">（部分）</span>}
                            {order.source === "manual" && order.linkId != null && (
                              <button disabled={busy} onClick={() => removeLink(order.linkId!)} className="text-red-400 hover:text-red-500">移除</button>
                            )}
                          </span>
                        </div>
                      ))}
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <span className="text-[10px] text-slate-300">{inv.manualLinked ? "已按手工关联配平；全部移除后恢复清单/FIFO规则" : inv.explicitLinked ? "已按税务清单明确关联；如需纠正可手动指定订单覆盖" : "自动匹配结果不对？可手动指定订单"}</span>
                        <button disabled={busy} onClick={() => setAdjustingId(adjustingId === inv.invoiceId ? null : inv.invoiceId)} className="shrink-0 text-[11px] text-indigo-500 hover:underline">
                          {adjustingId === inv.invoiceId ? "收起" : "调整匹配"}
                        </button>
                      </div>
                      {adjustingId === inv.invoiceId && (
                        <div className="mt-1 rounded-md border border-indigo-100 bg-indigo-50/40 p-2">
                          <div className="text-[10px] text-slate-500">手工调整可覆盖自动日期规则：点选有余量的订单，可连续添加多单，直到本票金额配平。</div>
                          <div className="mt-1 max-h-40 space-y-1 overflow-y-auto">
                            {matchCandidates.length === 0 ? (
                              <div className="py-2 text-center text-[11px] text-slate-400">该供应商没有可关联的订单余量</div>
                            ) : matchCandidates.map((o) => (
                              <button key={o.orderId} disabled={busy} onClick={() => addMatch(inv.invoiceId, o.orderId)} className="flex w-full items-center justify-between gap-2 rounded bg-white px-2 py-1 text-[11px] hover:bg-indigo-50 disabled:opacity-50">
                                <span className="truncate font-mono text-indigo-600">{o.orderNo || "无单号"}</span>
                                <span className="shrink-0 text-slate-400">{fmtDate(o.date)} · 余 {fmtMoney(o.remaining)}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {entry.orders.length > 0 && (
            <div className="mt-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] font-medium text-slate-500">全部采购订单匹配状态</div>
                <div className="text-[10px] text-slate-400">共 {entry.orders.length} 单 · 按下单时间排序</div>
              </div>
              <div className="mt-1 max-h-[280px] space-y-1 overflow-y-auto pr-0.5">
                {entry.orders.map((order) => {
                  const st = orderMatchStatus(order);
                  return (
                    <div key={order.orderId} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2.5 py-1.5 text-[12px]">
                      <div className="min-w-0">
                        <div className="truncate font-mono text-indigo-500">{order.orderNo || "无单号"}</div>
                        <div className="text-[10px] text-slate-400">{fmtDate(order.date)}{order.platform ? " · " + order.platform : ""}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <div className="text-right">
                          <div className="text-[12px] font-semibold tabular-nums text-slate-700">{fmtMoney(order.orderAmount)}</div>
                          <div className="text-[10px] text-slate-400">{st.sub}</div>
                        </div>
                        <span className={"shrink-0 rounded px-1.5 py-0.5 text-[10px] " + st.cls}>{st.text}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function SupplierMetric({ label, value, tone }: { label: string; value: string; tone: "indigo" | "amber" }) {
  return <div className={cx("rounded-lg px-3 py-2.5", tone === "indigo" ? "bg-indigo-50/60" : "bg-amber-50/60")}><div className="text-[11px] text-slate-400">{label}</div><div className={cx("mt-1 text-[12px] font-semibold tabular-nums", tone === "indigo" ? "text-indigo-700" : "text-amber-700")}>{value}</div></div>;
}
