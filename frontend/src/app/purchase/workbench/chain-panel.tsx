"use client";

import { CIRCLED, ChainFilter, DIM_DOT, Empty, Link, Loading, STAGE_ACTION, ViewMode, cx, fmtDate, fmtDateTime, fmtMoney } from "./workbench-shared";
import { MatchStatusChip } from "./workbench-shared";
import { useMemo, useState } from "react";
import {
  type ChainLinkCandidate,
  type ChainOrderRow,
  type ChainOverview,
  type PendingLink,
  type XrefApplyResult,
  type XrefPreview,
  procurementChainApi,

} from "@/lib/api";
import { QuickTriage, canonicalChainOrderId } from "./quick-triage";

export function ChainPanel({ overview, orders, total, pending, filter, loading, busy, prelinkBusy, xrefBusy, onFilterChange, onConfirm, onReject, onPrelink, onManualLink, onReload, onNotice, onStageView }: {
  overview: ChainOverview | null;
  orders: ChainOrderRow[];
  total: number;
  pending: PendingLink[];
  filter: ChainFilter;
  loading: boolean;
  busy: boolean;
  prelinkBusy: boolean;
  xrefBusy: boolean;
  onFilterChange: (value: ChainFilter) => void;
  onConfirm: (kind: string, linkId: number) => Promise<void>;
  onReject: (kind: string, linkId: number) => Promise<void>;
  onPrelink: (auto: boolean) => Promise<void>;
  onManualLink: (orderId: number, targetId: number) => Promise<void>;
  onReload?: () => Promise<void>;
  onNotice?: (text: string) => void;
  onStageView: (view: ViewMode) => void;
}) {
  const filtered = useMemo(() => {
    if (filter === "gap") return orders.filter((row) => row.doneCount < (row.stageTotal || 7));
    if (filter === "full") return orders.filter((row) => row.doneCount >= (row.stageTotal || 7));
    return orders;
  }, [filter, orders]);

  // 逐单候选展开：orderId -> 已加载候选
  const [candByOrder, setCandByOrder] = useState<Record<number, ChainLinkCandidate[]>>({});
  const [candLoadingId, setCandLoadingId] = useState<number | null>(null);
  const [expandedDetails, setExpandedDetails] = useState<Record<string, boolean>>({});
  async function toggleCandidates(row: ChainOrderRow) {
    const orderId = canonicalChainOrderId(row);
    if (candByOrder[orderId]) {
      setCandByOrder((prev) => { const next = { ...prev }; delete next[orderId]; return next; });
      return;
    }
    setCandLoadingId(orderId);
    try {
      const result = await procurementChainApi.candidates(orderId, "inbound", "", 8);
      setCandByOrder((prev) => ({ ...prev, [orderId]: result.items }));
    } catch {
      setCandByOrder((prev) => ({ ...prev, [orderId]: [] }));
    } finally {
      setCandLoadingId(null);
    }
  }
  async function linkCandidate(orderId: number, targetId: number) {
    await onManualLink(orderId, targetId);
    setCandByOrder((prev) => { const next = { ...prev }; delete next[orderId]; return next; });
  }

  // 对照表面板
  const [xrefOpen, setXrefOpen] = useState(false);
  const [xrefContent, setXrefContent] = useState("");
  const [xrefPreview, setXrefPreview] = useState<XrefPreview | null>(null);
  const [xrefApplyResult, setXrefApplyResult] = useState<XrefApplyResult | null>(null);
  const [xrefFileMeta, setXrefFileMeta] = useState<{ modifiedAt: number | null; size: number } | null>(null);
  async function openXrefPanel() {
    if (!xrefOpen) {
      try {
        const meta = await procurementChainApi.xrefFile();
        setXrefContent(meta.content || "");
        setXrefFileMeta({ modifiedAt: meta.modifiedAt, size: meta.size });
      } catch {
        setXrefContent("");
      }
    }
    setXrefOpen((v) => !v);
    setXrefPreview(null);
    setXrefApplyResult(null);
  }
  async function runXrefPreview() {
    if (!xrefContent.trim()) return;
    try {
      const result = await procurementChainApi.xrefPreview(xrefContent);
      setXrefPreview(result);
      setXrefApplyResult(null);
      onNotice?.(`预览完成：将创建 ${result.stats.to_create} 条，缺 ${result.stats.missing_order} 单 / ${result.stats.missing_rk} RK`);
    } catch (caught) {
      onNotice?.("对照表预览失败：" + String(caught));
    }
  }
  async function runXrefApply() {
    if (!xrefContent.trim()) return;
    try {
      const result = await procurementChainApi.xrefApply(xrefContent, true);
      setXrefApplyResult(result);
      setXrefPreview(null);
      onNotice?.(`对照表已应用：新建 ${result.created} 条链` + (result.missing_order.length || result.missing_rk.length
        ? `；缺 ${result.missing_order.length} 单 / ${result.missing_rk.length} RK` : ""));
      await onReload?.();
    } catch (caught) {
      onNotice?.("对照表应用失败：" + String(caught));
    }
  }

  return (
    <div className="mt-5 space-y-4">
      <section className="rounded-xl border border-slate-200/90 bg-white p-3.5 shadow-[0_3px_12px_rgba(40,53,85,0.04)]">
        <div className="flex flex-wrap items-stretch gap-1.5">
          {(overview?.stages ?? []).map((stage) => {
        const done = stage.count > 0;
        const action = STAGE_ACTION[stage.key];
        const body = (
          <>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className={cx("inline-block h-1.5 w-1.5 shrink-0 rounded-full", DIM_DOT[stage.dimension] ?? "bg-slate-300")} />
                <span className={cx("text-[11px]", done ? "text-indigo-400" : "text-slate-400")}>
                  {CIRCLED[stage.no - 1] ?? stage.no} {stage.short}
                </span>
              </div>
              <div className={cx("mt-0.5 text-lg font-semibold leading-6", done ? "text-indigo-700" : "text-slate-400")}>
                {stage.count}
                <span className="ml-1 text-[11px] font-normal text-slate-400">{stage.pct}%</span>
              </div>
              <div className="truncate text-[12px] text-slate-400" title={stage.label}>{stage.label}</div>
            </div>
            <span className={cx("h-2 w-2 shrink-0 rounded-full", done ? "bg-indigo-500" : "bg-slate-200")} />
          </>
        );
        const shell = cx(
          "group flex min-w-[112px] flex-1 items-center justify-between rounded-lg px-3 py-2.5 transition-colors",
          done ? "bg-indigo-50/80 hover:bg-indigo-50" : "bg-slate-50 hover:bg-slate-100"
        );
        return action?.view ? (
          <button key={stage.key} type="button" onClick={() => onStageView(action.view as ViewMode)} className={shell}>{body}</button>
        ) : (
          <Link key={stage.key} href={action?.href ?? "#"} className={shell}>{body}</Link>
        );
          })}
          <div className="flex min-w-[104px] flex-1 items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
        <div>
          <div className="text-[11px] text-amber-500">待确认</div>
          <div className="mt-0.5 text-lg font-semibold leading-6 text-amber-600">{overview?.pending ?? 0}</div>
        </div>
        {Number(overview?.pending ?? 0) > 0 && (
          <span className="animate-pulse rounded-full bg-amber-400 px-1.5 py-0.5 text-[12px] font-medium text-white">需处理</span>
        )}
          </div>
        </div>
      </section>

      <QuickTriage
        orders={orders}
        pending={pending}
        busy={busy}
        onConfirm={onConfirm}
        onManualInbound={onManualLink}
        onReload={onReload}
        onNotice={onNotice}
      />

      <section className="rounded-xl border border-amber-200 bg-amber-50/40 p-3.5">
        <div className="mb-2.5 flex items-center gap-2">
          <span className="h-3.5 w-1 rounded-full bg-amber-400" />
          <h2 className="text-[12px] font-semibold text-amber-800">关联待确认</h2>
          <span className="text-[11px] text-amber-500">{pending.length} 条建议</span>
        </div>
        {pending.length === 0 ? (
          <div className="rounded-lg border border-white bg-white/70 px-3 py-3 text-center text-[11px] text-amber-600/70">暂无待确认的关联建议；顶部「自动匹配并确认」会继续处理新数据</div>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
        {pending.map((item) => (
          <div key={item.kind + "-" + item.linkId} className="flex items-center justify-between gap-3 rounded-lg border border-amber-100 bg-white px-3 py-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate font-mono text-[11px] font-medium text-slate-800">{item.orderNo}</span>
                <span className="text-slate-300">→</span>
                <span className="truncate font-mono text-[11px] font-medium text-indigo-600">{item.targetNo}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[12px] text-slate-400">
                <span className="rounded bg-slate-50 px-1 py-px text-slate-500">
                  {item.targetType === "inbound" ? "入库" : item.targetType === "settlement" ? "付款" : "发票"}
                </span>
                {item.confidence !== null && <span>置信度 {(item.confidence * 100).toFixed(0)}%</span>}
                {item.targetAmount !== null && <span>{fmtMoney(item.targetAmount)}</span>}
                {item.note && <span className="truncate">{item.note}</span>}
              </div>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <button disabled={busy} onClick={() => void onConfirm(item.kind, item.linkId)} className="rounded-md bg-indigo-600 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-indigo-700 disabled:opacity-50">确认</button>
              <button disabled={busy} onClick={() => void onReject(item.kind, item.linkId)} className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[12px] text-slate-500 hover:bg-slate-50 disabled:opacity-50">拒绝</button>
            </div>
          </div>
        ))}
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-[0_3px_12px_rgba(40,53,85,0.04)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
          <div className="flex items-center gap-2">
        <span className="h-3.5 w-1 rounded-full bg-indigo-600" />
        <h2 className="text-[12px] font-semibold text-slate-800">订单链路</h2>
        <span className="text-[11px] text-slate-400">共 {total} 条 · 每单 7 环节完成度</span>
          </div>
          <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={prelinkBusy}
          onClick={() => void onPrelink(true)}
          title="多因子打分（SKU 重合+供应商+时间窗）：达到阈值的候选自动关联并确认；耗材按正品实际入库数量和映射自动扣减。一笔订单可拆批关联多张入库单。"
          className={cx(
            "rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors disabled:opacity-50",
            "bg-indigo-600 text-white hover:bg-indigo-700"
          )}
        >
          {prelinkBusy ? "自动处理中…" : "⚡ 智能预关联并确认"}
        </button>
        <button
          type="button"
          onClick={openXrefPanel}
          className={cx(
            "rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
            xrefOpen
              ? "bg-violet-600 text-white"
              : "border border-violet-200 bg-violet-50 text-violet-600 hover:bg-violet-100"
          )}
          title="维护 1688 ↔ 入库单 手动交叉对照表：粘贴/编辑后点「解析预览」查看将创建/缺失明细，确认无误后点「应用」批量建链（同时落盘到外部 DATA_DIR）"
        >
          {xrefOpen ? "收起对照表" : "📋 对照表"}
        </button>
        {([["all", "全部"], ["gap", "有缺口"], ["full", "已完成"]] as Array<[ChainFilter, string]>).map(([key, label]) => (
          <button key={key} onClick={() => onFilterChange(key)} className={cx(
            "rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
            filter === key ? "bg-indigo-600 text-white" : "bg-slate-50 text-slate-500 hover:bg-slate-100"
          )}>{label}</button>
        ))}
          </div>
        </div>
        {xrefOpen && (
          <section className="mt-3 rounded-xl border border-violet-200 bg-violet-50/30 p-3.5">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="h-3.5 w-1 rounded-full bg-violet-500" />
          <h3 className="text-[12px] font-semibold text-violet-800">1688↔入库单 对照表</h3>
          <span className="text-[12px] text-violet-500">
            粘贴或编辑 TSV（19 列：年度 订货日期 订单号 条形码 … 备注）后点「解析预览」查看将创建/缺失明细，确认后点「应用」批量建链并落盘。
          </span>
          {xrefFileMeta?.modifiedAt != null && (
            <span className="text-[12px] text-slate-400">
              当前文件 {Math.round((xrefFileMeta.size || 0) / 1024)} KB · 修改 {fmtDateTime(new Date(xrefFileMeta.modifiedAt * 1000).toISOString())}
            </span>
          )}
        </div>
        <textarea
          value={xrefContent}
          onChange={(e) => setXrefContent(e.target.value)}
          placeholder={"年度\t订货日期\t订单号\t条形码\t…\n2025年\t2025/7/23\t4648732165543821020\t2020240528007\t…"}
          className="h-48 w-full resize-y rounded-md border border-violet-100 bg-white px-2 py-1.5 font-mono text-[12px] text-slate-800 focus:border-violet-400 focus:outline-none"
          spellCheck={false}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={xrefBusy || !xrefContent.trim()}
            onClick={() => void runXrefPreview()}
            className="rounded-md border border-violet-200 bg-white px-2.5 py-1 text-[12px] font-medium text-violet-700 hover:bg-violet-50 disabled:opacity-50"
          >解析预览</button>
          <button
            type="button"
            disabled={xrefBusy || !xrefContent.trim()}
            onClick={() => void runXrefApply()}
            className="rounded-md bg-violet-600 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-violet-700 disabled:opacity-50"
          >应用（写入并落盘）</button>
          <button
            type="button"
            onClick={async () => {
              const meta = await procurementChainApi.xrefFile();
              setXrefContent(meta.content || "");
              setXrefFileMeta({ modifiedAt: meta.modifiedAt, size: meta.size });
              setXrefPreview(null);
              setXrefApplyResult(null);
              onNotice?.("已重新加载文件内容");
            }}
            className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[12px] text-slate-500 hover:bg-slate-50"
          >从文件重新加载</button>
          <span className="text-[12px] text-slate-400">已写入字节：{xrefContent.length.toLocaleString()}</span>
        </div>
        {xrefPreview && (
          <div className="mt-2 rounded-md border border-slate-100 bg-white p-2 text-[12px] text-slate-700">
            <div className="flex flex-wrap gap-3">
              <span>总行 {xrefPreview.totalXrefRows} / 唯一对 {xrefPreview.totalPairs}</span>
              <span className="text-emerald-600">将创建 {xrefPreview.stats.to_create}</span>
              <span className="text-slate-500">已存在 {xrefPreview.stats.already_linked}</span>
              <span className="text-amber-600">缺订单 {xrefPreview.stats.missing_order} / 缺RK {xrefPreview.stats.missing_rk}</span>
              <span className="text-slate-500">组合装 {xrefPreview.stats.combo_skipped}</span>
              {xrefPreview.noiseLinkCount > 0 && <span className="text-rose-600">噪声链 {xrefPreview.noiseLinkCount}</span>}
            </div>
            {xrefPreview.missingOrder.length > 0 && (
              <div className="mt-1 text-rose-600">缺 1688 订单：{xrefPreview.missingOrder.join("、") || "—"}</div>
            )}
            {xrefPreview.missingRk.length > 0 && (
              <div className="mt-1 text-rose-600">缺 RK 入库单：{xrefPreview.missingRk.join("、") || "—"}</div>
            )}
            {xrefPreview.toCreate.length > 0 && (
              <details className="mt-1">
                <summary className="cursor-pointer text-slate-500">查看前 {xrefPreview.toCreate.length} 条将创建</summary>
                <div className="mt-1 max-h-32 overflow-y-auto font-mono text-[12px] text-slate-600">
                  {xrefPreview.toCreate.map((c, i) => (
                    <div key={i}>{c.order_no} → {c.rk_no}　SKUs {c.barcodes.join("+")}　qty盒={c.qty_boxes}　{c.note_extra && `备注：${c.note_extra.slice(0, 30)}`}</div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
        {xrefApplyResult && (
          <div className="mt-2 rounded-md border border-emerald-100 bg-emerald-50/50 p-2 text-[12px] text-emerald-800">
            <div className="flex flex-wrap gap-3">
              <span>本次新建 {xrefApplyResult.created} 条链</span>
              <span className="text-slate-500">对照表行 {xrefApplyResult.total_xref_rows} / 对 {xrefApplyResult.total_pairs}</span>
              <span className="text-slate-500">已存在 {xrefApplyResult.already_linked_count}</span>
              <span className="text-slate-500">组合装 {xrefApplyResult.combo_skipped_count}</span>
              {(xrefApplyResult.missing_order.length || xrefApplyResult.missing_rk.length) > 0 && (
                <span className="text-amber-700">缺 {xrefApplyResult.missing_order.length} 单 / {xrefApplyResult.missing_rk.length} RK（需先同步入库/订单）</span>
              )}
              {xrefApplyResult.noise_links.length > 0 && <span className="text-rose-700">噪声链 {xrefApplyResult.noise_links.length} 条（建议人工拒绝）</span>}
            </div>
            {xrefApplyResult.noise_links.length > 0 && (
              <div className="mt-1">id 列表：{xrefApplyResult.noise_links.map((n) => `${n.id}`).join("、")}</div>
            )}
          </div>
        )}
          </section>
        )}
        {loading ? <Loading text="正在加载采购链路…" /> : filtered.length === 0 ? <Empty text="没有符合条件的订单链路" /> : (
          <div className="divide-y divide-slate-100">
        {filtered.map((row) => {
          const chainOrderId = canonicalChainOrderId(row);
          const stageTotal = row.stageTotal || 7;
          const pct = Math.round((row.doneCount / stageTotal) * 100);
          return (
            <div key={row.orderId} className="px-4 py-3 hover:bg-slate-50/60">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-mono text-[11.5px] font-semibold text-slate-800">{row.orderNo}</span>
                    {row.pendingCount > 0 && (
                      <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[12px] font-medium text-amber-600">{row.pendingCount} 条待确认</span>
                    )}
                    {row.source === "workflow" && (
                      <span className="shrink-0 rounded bg-violet-50 px-1.5 py-0.5 text-[12px] font-medium text-violet-600">手工</span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-[12px] text-slate-400">
                    {row.supplier || "—"}　·　{fmtDate(row.orderDate)}　·　{row.title || "无标题"}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-4">
                  <div className="text-right">
                    <div className="text-[13px] font-semibold tabular-nums text-slate-900">{fmtMoney(row.amount)}</div>
                    <div className="text-[12px] text-slate-400">完成度 {row.doneCount}/{stageTotal}</div>
                  </div>
                  <div className="w-24">
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div className={cx("h-full rounded-full", row.doneCount >= stageTotal ? "bg-emerald-500" : "bg-indigo-500")} style={{ width: pct + "%" }} />
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1">
                {row.stages.map((stage) => (
                  <span key={stage.key} title={stage.label} className={cx(
                    "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px]",
                    stage.done ? "bg-emerald-50 text-emerald-600" : "bg-slate-50 text-slate-400"
                  )}>
                    <span className={cx("inline-block h-1.5 w-1.5 rounded-full", stage.done ? "bg-emerald-500" : DIM_DOT[stage.dimension] ?? "bg-slate-300")} />
                    {CIRCLED[stage.no - 1] ?? stage.no} {stage.short}
                  </span>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy || candLoadingId === chainOrderId}
                  onClick={() => void toggleCandidates(row)}
                  className="rounded-md border border-indigo-100 bg-indigo-50/60 px-2 py-0.5 text-[12px] font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
                >
                  {candLoadingId === chainOrderId ? "加载中…" : candByOrder[chainOrderId] ? "收起候选" : "候选入库单"}
                </button>
                {(row.inbound ?? []).length > 0 && (
                  <span className="text-[12px] text-slate-400">
                    已关联 {row.inbound.length} 张：{row.inbound.map((i) => i.goodsdocNo).join("、")}
                  </span>
                )}
              </div>
              {candByOrder[chainOrderId] && (
                <div className="mt-2 rounded-lg border border-slate-100 bg-slate-50/60 p-2">
                  {candByOrder[chainOrderId].length === 0 ? (
                    <div className="px-1 py-1 text-[12px] text-slate-400">没有可用的入库单候选（可能是全新单据，请先同步或文件导入入库单）</div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {candByOrder[chainOrderId].map((c) => (
                        <div key={c.targetId} className="flex items-start justify-between gap-3 py-1.5">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-mono text-[12px] font-semibold text-slate-800">{c.targetNo}</span>
                              {c.currentlyLinked && <span className="rounded bg-emerald-50 px-1 text-[11px] text-emerald-600">已关联</span>}
                              {c.pendingSuggestion && <span className="rounded bg-amber-50 px-1 text-[11px] text-amber-600">待确认建议</span>}
                              {c.skuOverlapRatio !== null && c.skuOverlapRatio > 0 && (
                                <span className="rounded bg-indigo-50 px-1 text-[11px] text-indigo-600">SKU 重合 {c.matchedSkuCount}/{c.requiredSkuCount}</span>
                              )}
                              <span className={cx("rounded px-1 text-[11px]", c.score >= 0.5 ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400")}>
                                匹配 {(c.score * 100).toFixed(0)}%
                              </span>
                            </div>
                            <div className="mt-0.5 text-[12px] text-slate-400">
                              {c.targetSupplier || "无供应商"} · {fmtDate(c.targetDate)} · {c.reason}
                            </div>
                            {c.details.length > 0 && (() => {
                              const open = expandedDetails[`${chainOrderId}:${c.targetId}`];
                              return (
                                <div className="mt-1">
                                  <button
                                    type="button"
                                    onClick={() => setExpandedDetails((m) => ({ ...m, [`${chainOrderId}:${c.targetId}`]: !open }))}
                                    className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                                  >
                                    📦 明细 ({c.details.length}) {open ? "▴" : "▾"}
                                  </button>
                                  {open && (
                                    <div className="mt-1 overflow-x-auto rounded border border-slate-100 bg-white">
                                      <table className="w-full text-[11px]">
                                        <thead className="bg-slate-50 text-slate-500">
                                          <tr>
                                            <th className="px-1.5 py-0.5 text-left font-medium">货品</th>
                                            <th className="px-1.5 py-0.5 text-left font-medium">规格</th>
                                            <th className="px-1.5 py-0.5 text-right font-medium">数量</th>
                                            <th className="px-1.5 py-0.5 text-right font-medium">含税单价</th>
                                            <th className="px-1.5 py-0.5 text-right font-medium">含税金额</th>
                                            <th className="px-1.5 py-0.5 text-left font-medium">条码</th>
                                            <th className="px-1.5 py-0.5 text-left font-medium">SKU匹配</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-50">
                                          {c.details.map((d, i) => (
                                            <tr key={i} className="hover:bg-slate-50/50">
                                              <td className="px-1.5 py-0.5 text-slate-700">{d.goodsName || "—"}</td>
                                              <td className="px-1.5 py-0.5 text-slate-500">{d.spec || "—"}</td>
                                              <td className="px-1.5 py-0.5 text-right font-mono text-slate-700">{d.applyQuantity ?? d.quantity ?? 0}{d.unitName || ""}</td>
                                              <td className="px-1.5 py-0.5 text-right font-mono text-slate-700">{d.unitPriceTax != null ? d.unitPriceTax.toFixed(2) : "—"}</td>
                                              <td className="px-1.5 py-0.5 text-right font-mono text-slate-700">{d.amountTax != null ? d.amountTax.toFixed(2) : "—"}</td>
                                              <td className="px-1.5 py-0.5 font-mono text-[11px] text-slate-500">{d.barcode || "—"}</td>
                                              <td className="px-1.5 py-0.5 text-[11px]">
                                                {d.skuId ? <span className="rounded bg-indigo-50 px-1 text-indigo-600">#{d.skuId}·{d.matchStatus || "auto"}</span> : <span className="text-slate-300">未匹配</span>}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                          <button
                            type="button"
                            disabled={busy || c.currentlyLinked}
                            onClick={() => void linkCandidate(chainOrderId, c.targetId)}
                            className="shrink-0 rounded-md bg-indigo-600 px-2 py-0.5 text-[12px] font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
                          >
                            {c.currentlyLinked ? "已关联" : "关联"}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
          </div>
        )}
      </section>
    </div>
  );
}

// ---------- SKU 匹配工作台 ----------


