"use client";

import { cx, fmtDateTime, fmtMoney } from "./workbench-shared";
import { HeaderButton, MatchStatusChip } from "./workbench-shared";
import { useEffect, useState } from "react";
import {
  type CatalogSkuRow,
  type InboundMatchSummary,
  type PendingAllocation,
  type SkuCandidate,
  skuMatchingApi,

} from "@/lib/api";
import { SearchableSelect } from "./searchable-select";

export function MatchingView({ summary, pending, busy, loading, onRunAuto, onRefresh, onNotice, onOpenOrder }: {
  summary: InboundMatchSummary | null;
  pending: PendingAllocation[];
  busy: boolean;
  loading: boolean;
  onRunAuto: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onNotice: (text: string) => void;
  onOpenOrder: (orderId: number) => void;
}) {
  const counts = summary?.counts ?? {};
  return (
    <div className="mt-5 space-y-4">
      <InboundMatchCard summary={summary} counts={counts} busy={busy} loading={loading} onRunAuto={onRunAuto} onRefresh={onRefresh} onNotice={onNotice} />
      <PendingAllocationCard pending={pending} loading={loading} onRefresh={onRefresh} onNotice={onNotice} onOpenOrder={onOpenOrder} />
    </div>
  );
}

export function InboundMatchCard({ summary, counts, busy, loading, onRunAuto, onRefresh, onNotice }: {
  summary: InboundMatchSummary | null;
  counts: Record<string, number>;
  busy: boolean;
  loading: boolean;
  onRunAuto: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onNotice: (text: string) => void;
}) {
  const [skus, setSkus] = useState<CatalogSkuRow[]>([]);
  const [savingItem, setSavingItem] = useState<number | null>(null);
  useEffect(() => {
    skuMatchingApi.skus().then(setSkus).catch(() => setSkus([]));
  }, []);
  const anomalies = summary?.anomalies ?? [];
  const manualMatches = summary?.manualMatches ?? [];

  async function assign(itemId: number, skuId: number) {
    if (!skuId) return;
    setSavingItem(itemId);
    try {
      await skuMatchingApi.manualInbound(itemId, skuId);
      onNotice("人工 SKU 匹配已保存，后续自动扫描不会覆盖");
      await onRefresh();
    } catch (caught) {
      onNotice(caught instanceof Error ? caught.message : "人工指定失败，请重试");
    } finally {
      setSavingItem(null);
    }
  }

  async function unassign(itemId: number) {
    if (!window.confirm("确认解除这条入库明细的 SKU 匹配？\n\n该明细会保留为人工待处理，自动扫描不会重新绑定；你可以随后选择正确的 SKU。")) return;
    setSavingItem(itemId);
    try {
      await skuMatchingApi.clearManualInbound(itemId);
      onNotice("SKU 匹配已解除，明细保留为人工待处理");
      await onRefresh();
    } catch (caught) {
      onNotice(caught instanceof Error ? caught.message : "解除匹配失败，请重试");
    } finally {
      setSavingItem(null);
    }
  }

  async function acceptCost(itemId: number) {
    if (!window.confirm("确认更新吉客云 SKU 主档成本？\n\n系统优先按已关联的 1688 实付金额比例分摊；未关联时才使用入库含税单价。该变更会影响后续利润计算，并记录审计日志。")) return;
    setSavingItem(itemId);
    try {
      const res = await skuMatchingApi.acceptCost(itemId);
      onNotice(`已确认成本：${res.oldCost ?? "无"} → ${res.newCost}`);
      await onRefresh();
    } catch (caught) {
      onNotice(caught instanceof Error ? caught.message : "确认成本失败，请重试");
    } finally {
      setSavingItem(null);
    }
  }

  async function batchAcceptCost(documentId: number, docNo: string, count: number) {
    if (!window.confirm(`确认按入库单 ${docNo} 批量确认成本？\n\n将处理该单 ${count} 条金额异常明细：已关联 1688 订单时按实付比例分摊，未关联时按入库含税单价更新 SKU 主档成本。该变更会影响后续利润计算。`)) return;
    setSavingItem(-documentId);
    try {
      const res = await skuMatchingApi.batchAcceptCost(documentId);
      onNotice(
        `按单批量确认完成：接受 ${res.accepted} 条` +
        (res.failed.length ? `，跳过 ${res.failed.length} 条（请核对异常说明）` : "")
      );
      await onRefresh();
    } catch (caught) {
      onNotice(caught instanceof Error ? caught.message : "批量确认失败，请重试");
    } finally {
      setSavingItem(null);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[14px] font-semibold text-slate-900">吉客云入库明细 ↔ SKU</h2>
          <p className="mt-0.5 text-[11px] text-slate-400">SKU 条码/货号命中主档后校验金额；系统识别异常，人工可随时改绑，且人工结果不被自动覆盖</p>
        </div>
        <div className="flex items-center gap-2">
          <HeaderButton icon="sync" busy={busy} onClick={() => void onRunAuto()}>扫描未人工锁定项</HeaderButton>
          <HeaderButton icon="refresh" onClick={() => void onRefresh()}>刷新</HeaderButton>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {[
          { label: "明细总数", value: summary?.total ?? 0, cls: "bg-slate-100 text-slate-600" },
          { label: "金额通过", value: counts.price_ok ?? 0, cls: "bg-emerald-50 text-emerald-600" },
          { label: "自动命中", value: counts.auto ?? 0, cls: "bg-blue-50 text-blue-600" },
          { label: "人工锁定", value: counts.manual ?? 0, cls: "bg-indigo-50 text-indigo-600" },
          { label: "金额异常", value: counts.price_mismatch ?? 0, cls: "bg-red-50 text-red-600" },
          { label: "档案缺失", value: counts.missing ?? 0, cls: "bg-amber-50 text-amber-700" },
        ].map((chip) => (
          <span key={chip.label} className={cx("rounded-lg px-2.5 py-1.5 text-[11px] font-medium", chip.cls)}>
        {chip.label} <span className="ml-1 text-[13px] font-semibold">{chip.value}</span>
          </span>
        ))}
      </div>
      {anomalies.length > 0 && (
        <div className="mt-3 rounded-lg border border-red-100 bg-red-50/50 p-3">
          <div className="mb-2 text-[11px] font-medium text-red-600">以下 {anomalies.length} 条明细需要人工确认</div>
          <div className="space-y-2.5">
        {Array.from(
          anomalies.reduce((map, item) => {
            const group = map.get(item.documentId);
            if (group) group.items.push(item);
            else map.set(item.documentId, { docNo: item.goodsdocNo, items: [item] });
            return map;
          }, new Map<number, { docNo: string; items: InboundMatchSummary["anomalies"] }>())
        ).map(([documentId, group]) => {
          const mismatchCount = group.items.filter((i) => i.status === "price_mismatch" && i.matchedSkuId != null).length;
          return (
            <div key={documentId} className="rounded-lg border border-slate-100 bg-white/70 p-2">
              <div className="mb-1.5 flex flex-wrap items-center gap-2 px-1">
                <span className="text-[11px] font-medium text-slate-700">{group.docNo}</span>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[12px] text-slate-500">{group.items.length} 条异常</span>
                {mismatchCount > 1 && (
                  <button
                    onClick={() => void batchAcceptCost(documentId, group.docNo, mismatchCount)}
                    disabled={savingItem !== null}
                    className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[12px] font-medium text-emerald-600 hover:bg-emerald-100 disabled:opacity-50"
                    title={`一次确认该单 ${mismatchCount} 条异常明细的档案成本；历史价格偏差过大时会被拦截`}
                  >
                    按单批量确认成本（{mismatchCount}）
                  </button>
                )}
              </div>
              <InboundMatchRows items={group.items} skus={skus} savingItem={savingItem} onAssign={assign} onAcceptCost={acceptCost} />
            </div>
          );
        })}
          </div>
        </div>
      )}
      {!loading && anomalies.length === 0 && (
        <div className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-700">当前没有待处理的入库明细异常。</div>
      )}
      {manualMatches.length > 0 && (
        <details className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50/30">
          <summary className="cursor-pointer px-3 py-2 text-[11px] font-medium text-indigo-700">人工已匹配 {manualMatches.length} 条（展开可再次更换）</summary>
          <div className="border-t border-indigo-100 p-3">
        <InboundMatchRows items={manualMatches} skus={skus} savingItem={savingItem} onAssign={assign} onUnassign={unassign} />
          </div>
        </details>
      )}
      {loading && <div className="mt-2 text-[11px] text-slate-400">加载中…</div>}
    </section>
  );
}

export function InboundMatchRows({ items, skus, savingItem, onAssign, onUnassign, onAcceptCost }: {
  items: InboundMatchSummary["anomalies"];
  skus: CatalogSkuRow[];
  savingItem: number | null;
  onAssign: (itemId: number, skuId: number) => Promise<void>;
  onUnassign?: (itemId: number) => Promise<void>;
  onAcceptCost?: (itemId: number) => Promise<void>;
}) {
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.itemId} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-slate-100 bg-white px-3 py-2 text-[11px]">
          <MatchStatusChip status={item.status} />
          <span className="font-medium text-slate-700">{item.goodsdocNo}</span>
          <span className="font-mono text-[12px] text-slate-400">{item.goodsNo || "无货号"}</span>
          <span className="text-slate-600">{item.goodsName || "未命名商品"}</span>
          <span className="text-slate-400">数量 {item.quantity ?? "-"}</span>
          <span className="text-slate-400">金额 {fmtMoney(item.amountTax)}</span>
          <span className="min-w-[160px] flex-1 truncate text-amber-600" title={item.note}>{item.note || "人工已确认"}</span>
          <SearchableSelect
        ariaLabel={`为 ${item.goodsdocNo} 选择 SKU`}
        disabled={savingItem !== null}
        className="max-w-[280px]"
        placeholder="选择吉客云 SKU…"
        value={item.status === "manual" && item.matchedSkuId ? String(item.matchedSkuId) : ""}
        onChange={(next) => void onAssign(item.itemId, Number(next))}
        options={skus.map((sku) => ({
          value: String(sku.id), label: `${sku.skuCode} · ${sku.skuName || sku.goodsName}`, keywords: `${sku.skuCode} ${sku.skuName ?? ""} ${sku.goodsName ?? ""}`,
        }))}
      />
          {onAcceptCost && item.status === "price_mismatch" && item.matchedSkuId != null && (
        <button
          onClick={() => void onAcceptCost(item.itemId)}
          disabled={savingItem !== null}
          className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[12px] font-medium text-emerald-600 hover:bg-emerald-100 disabled:opacity-50"
          title="确认更新档案成本：优先按关联 1688 实付比例分摊，否则使用入库含税单价"
        >
          确认成本
        </button>
          )}
          {onUnassign && item.status === "manual" && item.matchedSkuId != null && (
        <button
          onClick={() => void onUnassign(item.itemId)}
          disabled={savingItem !== null}
          className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[12px] font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          title="解除当前 SKU，保留为人工待处理且不参与自动扫描"
        >
          解除匹配
        </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function PendingAllocationCard({ pending, loading, onRefresh, onNotice, onOpenOrder }: {
  pending: PendingAllocation[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  onNotice: (text: string) => void;
  onOpenOrder: (orderId: number) => void;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [candidates, setCandidates] = useState<Record<number, SkuCandidate[]>>({});
  const [draft, setDraft] = useState<{ skuId: number; quantity: string; unitPrice: string } | null>(null);
  const [savingPo, setSavingPo] = useState<number | null>(null);

  const toggle = async (poId: number) => {
    if (expanded === poId) {
      setExpanded(null);
      return;
    }
    setExpanded(poId);
    setDraft(null);
    if (!candidates[poId]) {
      try {
        const res = await skuMatchingApi.candidates(poId);
        setCandidates((c) => ({ ...c, [poId]: res.candidates }));
      } catch {
        setCandidates((c) => ({ ...c, [poId]: [] }));
      }
    }
  };

  const confirm = async (po: PendingAllocation) => {
    if (!draft) return;
    const quantity = Number(draft.quantity);
    const unitPrice = Number(draft.unitPrice);
    if (!po.editable) {
      onNotice("该订单已确认采购内容，如需改绑请先在订单详情核对状态");
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
      onNotice("请填写有效的数量和单价");
      return;
    }
    setSavingPo(po.poId);
    try {
      await skuMatchingApi.addAllocation(po.poId, {
        sku_id: draft.skuId,
        quantity: draft.quantity,
        unit_price: draft.unitPrice,
        amount: String((Number(draft.quantity) || 0) * (Number(draft.unitPrice) || 0)),
      });
      onNotice(`订单 ${po.externalOrderId} SKU 分配已保存`);
      setDraft(null);
      setExpanded(null);
      await onRefresh();
    } catch (caught) {
      onNotice(caught instanceof Error ? caught.message : "保存失败，请检查数量/单价后重试");
    } finally {
      setSavingPo(null);
    }
  };

  return (
    <section className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[14px] font-semibold text-slate-900">1688 订单 SKU 配置</h2>
          <p className="mt-0.5 text-[11px] text-slate-400">1688 源数据无商品明细，需人工指定 SKU；候选按同供应商历史入库货品推荐，金额不平衡会提示</p>
        </div>
        <span className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-[11px] font-medium text-slate-600">待配置 {pending.length}</span>
      </div>
      <div className="mt-3 space-y-2">
        {loading ? <div className="text-[11px] text-slate-400">加载中…</div> : pending.length === 0 ? (
          <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-600">全部订单已配置且金额平衡 ✓</div>
        ) : pending.map((po) => (
          <div key={po.poId} className="rounded-lg border border-slate-100">
        <div className="flex items-center gap-2 pr-3 hover:bg-slate-50">
          <button onClick={() => void toggle(po.poId)} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left text-[11px]">
            <span className="font-medium text-slate-700">{po.supplierName || "(未知供应商)"}</span>
            <span className="font-mono text-slate-400">{po.externalOrderId}</span>
            <span className="text-slate-400">采购时间 {fmtDateTime(po.orderedAt)}</span>
            <span className="text-slate-400">实付 {fmtMoney(po.paidAmount)}</span>
            {po.allocationCount > 0 && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">已配 {po.allocationCount} 条</span>}
            {!po.balance.balanced && po.allocationCount > 0 && (
              <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600" title={po.balance.abnormalNote}>金额不平衡</span>
            )}
            {!po.editable && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">当前状态已锁定</span>}
            <span className="ml-auto text-slate-300">{expanded === po.poId ? "收起 ▲" : "配置 ▼"}</span>
          </button>
          <button onClick={() => onOpenOrder(po.fileOrderId ?? -po.poId)} className="shrink-0 rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-indigo-600 hover:bg-indigo-50">进入订单调整</button>
        </div>
        {expanded === po.poId && (
          <div className="border-t border-slate-100 px-3 py-2.5">
            {(candidates[po.poId] ?? []).length > 0 && (
              <div className="mb-2">
                <div className="mb-1 text-[10px] font-medium text-slate-400">候选（同供应商历史优先，其余来自吉客云 SKU 主档）</div>
                <div className="flex flex-wrap gap-1.5">
                  {(candidates[po.poId] ?? []).map((c) => (
                    <button
                      key={c.skuId}
                      onClick={() => setDraft({
                        skuId: c.skuId,
                        quantity: "1",
                        unitPrice: c.defaultCost != null && c.defaultCost > 0 ? String(c.defaultCost) : po.paidAmount != null && po.paidAmount > 0 ? String(po.paidAmount) : "0",
                      })}
                      className={cx(
                        "rounded-md border px-2 py-1 text-left text-[10.5px]",
                        draft?.skuId === c.skuId ? "border-indigo-300 bg-indigo-50 text-indigo-600" : "border-slate-200 text-slate-600 hover:border-indigo-200 hover:bg-indigo-50/50"
                      )}
                      title={c.reason}
                    >
                      <span className="font-mono">{c.skuCode}</span> · {c.skuName || "未命名 SKU"}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {draft && (
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="text-slate-500">数量</span>
                <input value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: e.target.value })} className="w-16 rounded border border-slate-200 px-1.5 py-1" />
                <span className="text-slate-500">单价 ¥</span>
                <input value={draft.unitPrice} onChange={(e) => setDraft({ ...draft, unitPrice: e.target.value })} className="w-24 rounded border border-slate-200 px-1.5 py-1" />
                <span className="text-slate-400">新增 {fmtMoney(Number(draft.quantity || 0) * Number(draft.unitPrice || 0))}</span>
                {po.paidAmount != null && Math.abs(po.balance.allocated + Number(draft.quantity || 0) * Number(draft.unitPrice || 0) - po.paidAmount) > Math.max(po.paidAmount * 0.02, 0.5) && (
                  <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">新增后累计 {fmtMoney(po.balance.allocated + Number(draft.quantity || 0) * Number(draft.unitPrice || 0))}，与实付 {fmtMoney(po.paidAmount)} 仍不一致</span>
                )}
                {po.editable ? (
                  <HeaderButton icon="plus" busy={savingPo === po.poId} onClick={() => void confirm(po)}>保存分配</HeaderButton>
                ) : (
                  <span className="rounded-md bg-slate-100 px-2.5 py-1.5 text-[10px] text-slate-500">已确认状态不可直接改动</span>
                )}
              </div>
            )}
            {!draft && (candidates[po.poId] ?? []).length === 0 && (
              <div className="text-[11px] text-slate-400">暂无候选，可在采购订单详情中手动添加分配</div>
            )}
          </div>
        )}
          </div>
        ))}
      </div>
    </section>
  );
}
