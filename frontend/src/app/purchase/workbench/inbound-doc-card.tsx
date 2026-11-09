"use client";

import { AllocationRow, EditorConsumableDraft, InboundRow, PendingConsumableUpdate, cx, fmtDateTime, fmtMoney } from "./workbench-shared";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  type ConsumableMappingRow,
  type ConsumableRow,
  procurementChainApi,

} from "@/lib/api";
import { SearchableSelect } from "./searchable-select";

export function InboundDocCard({ doc, allocations, closed, editable, usageMaterials, usageMappings, busy,
  onChanged, onRequestReplace, onRemove, onCorrectAmount, onSaveAmount,
  onEditAllocation, onRemoveAllocation, onAddSku, onNotify, pendingConsumableUpdate,
  onPendingConsumableUpdateApplied, editor }: {
  doc: InboundRow;
  allocations: AllocationRow[];
  closed: boolean;
  editable: boolean;
  usageMaterials: ConsumableRow[];
  usageMappings: ConsumableMappingRow[];
  busy: boolean;
  onChanged: () => Promise<void>;
  onRequestReplace: (linkId: number) => void;
  onRemove: (linkId: number) => void;
  onCorrectAmount: (documentId: number) => void;
  onSaveAmount: (documentId: number, value: string) => void;
  onEditAllocation: (row: AllocationRow, consumable: EditorConsumableDraft | null) => void;
  onRemoveAllocation: (id: number) => void;
  onAddSku: (documentId: number) => void;
  onNotify: (message: string) => void;
  pendingConsumableUpdate?: PendingConsumableUpdate | null;
  onPendingConsumableUpdateApplied?: () => void;
  editor?: ReactNode;
}) {
  const [amountEditing, setAmountEditing] = useState(false);
  const [amountValue, setAmountValue] = useState("");
  const [usageEnabled, setUsageEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  // 每行耗材的本地草稿：key -> { consumableId, quantity } | null（null = 该行无默认绑定，需手工选）
  const [rowCons, setRowCons] = useState<Record<string, { consumableId: number; quantity: string } | null>>({});

  const linkId = doc.linkId ?? null;
  const decided = Boolean(doc.consumableUsageDecided);
  const items = doc.consumableUsageItems ?? [];
  const mismatch = doc.amount != null && doc.itemAmount != null && Math.abs(doc.amount - doc.itemAmount) > 0.01;
  const skuTotal = allocations.reduce((sum, row) => sum + (row.amount ?? 0), 0);

  const rowKey = (row: AllocationRow, i: number) => (row.id != null ? `a${row.id}` : `c${(row.skuCode ?? "")}-${i}`);
  const round3 = (n: number) => String(Number(n.toFixed(3)));
  const defaultFor = (row: AllocationRow, mapping?: ConsumableMappingRow) =>
    mapping ? { consumableId: mapping.consumableId, quantity: round3(Number(row.quantity ?? 0) * Number(mapping.usagePerUnit || 0)) } : null;
  // 选了某个耗材时，按“该货品→该耗材”的用量比例给出默认数量；无映射则默认 1
  const defaultQtyFor = (row: AllocationRow, consumableId: number) => {
    const m = usageMappings.find((row2) => row2.consumableId === consumableId);
    return round3(m ? Number(row.quantity ?? 0) * Number(m.usagePerUnit || 0) : 1);
  };

  // 卡片挂载（或换单据）时预填每行耗材草稿：
  // 1) 已登记过（decided && enabled）：该耗材仅被一行映射命中时，直接回显实际登记数量；
  // 2) 未登记：按 SKU→耗材映射预填默认（数量 = usagePerUnit × 数量）；无映射留给手工选。
  // 用户编辑会写入 rowCons 不被覆盖。
  useEffect(() => {
    const seeded: Record<string, { consumableId: number; quantity: string } | null> = {};
    const registered = doc.consumableUsageDecided && doc.consumableUsageEnabled ? (doc.consumableUsageItems ?? []) : [];
    const hitCount = new Map<number, number>();
    allocations.forEach((row) => {
      const m = usageMappings.find((mm) => mm.skuId === row.skuId);
      if (m) hitCount.set(m.consumableId, (hitCount.get(m.consumableId) ?? 0) + 1);
    });
    allocations.forEach((row, i) => {
      const k = rowKey(row, i);
      const m = usageMappings.find((mm) => mm.skuId === row.skuId);
      let draft = defaultFor(row, m);
      if (m && hitCount.get(m.consumableId) === 1) {
        const item = registered.find((it) => it.consumableId === m.consumableId);
        if (item) draft = { consumableId: m.consumableId, quantity: round3(Number(item.quantity)) };
      }
      seeded[k] = draft;
    });
    setRowCons(seeded);
    setUsageEnabled(decided ? Boolean(doc.consumableUsageEnabled) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.documentId]);

  useEffect(() => {
    if (!pendingConsumableUpdate) return;
    const index = allocations.findIndex((row) => row.id === pendingConsumableUpdate.allocationId);
    if (index < 0) return;
    const key = rowKey(allocations[index], index);
    setRowCons((previous) => ({ ...previous, [key]: pendingConsumableUpdate.draft }));
    onPendingConsumableUpdateApplied?.();
    // The parent clears this one-shot update after the allocation is present in the refreshed detail.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allocations, pendingConsumableUpdate]);

  async function saveConsumables() {
    if (!linkId) return;
    if (usageEnabled === null) { onNotify("请先选择「有耗材使用」或「本次不使用耗材」"); return; }
    setSaving(true);
    try {
      if (usageEnabled) {
        // 把每行耗材按 consumableId 聚合（一个货品对应一个耗材，多行可合并）
        const agg = new Map<number, number>();
        allocations.forEach((row, i) => {
          const k = rowKey(row, i);
          const c = rowCons[k] ?? defaultFor(row, usageMappings.find((m) => m.skuId === row.skuId));
          if (c && c.consumableId) {
            const q = Number(c.quantity);
            if (Number.isFinite(q) && q > 0) agg.set(c.consumableId, (agg.get(c.consumableId) ?? 0) + q);
          }
        });
        const payload = Array.from(agg, ([consumable_id, quantity]) => ({ consumable_id, quantity: round3(quantity) }));
        if (payload.length === 0) { onNotify("请为至少一行选择耗材并填写数量"); setSaving(false); return; }
        await procurementChainApi.setInboundConsumableUsage(linkId, true, payload, "采购工作台登记耗材使用");
      } else {
        await procurementChainApi.setInboundConsumableUsage(linkId, false, [], "采购工作台登记耗材使用");
      }
      await onChanged();
      onNotify(usageEnabled ? "耗材使用已登记" : "已标记本次入库不使用耗材");
    } catch (caught) {
      onNotify(caught instanceof Error ? caught.message : "保存耗材失败");
    } finally {
      setSaving(false);
    }
  }

  const usageTag = !decided
    ? { text: "耗材：待登记", className: "font-medium text-amber-600" }
    : items.length > 0
      ? { text: "耗材：有", className: "text-emerald-600" }
      : { text: "耗材：无", className: "text-slate-400" };

  return (
    <div className={cx("rounded-lg border bg-white px-2.5 py-2", decided ? "border-slate-200" : "border-amber-300")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-mono text-[12px] font-semibold text-slate-800">{doc.goodsdocNo || "已关联入库单"}</div>
          <div className="mt-0.5 truncate text-[11px] text-slate-400">{fmtDateTime(doc.date)} · {doc.warehouseName || "未注仓库"} · <span className={usageTag.className} title="由明细中登记的耗材使用自动标识">{usageTag.text}</span></div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {amountEditing ? (
              <>
                <input autoFocus onFocus={(e) => e.target.select()} value={amountValue}
                  onChange={(e) => setAmountValue(e.target.value)} placeholder={String(doc.amount ?? "")}
                  className="h-7 w-24 rounded border border-indigo-300 px-1.5 text-right text-[12px] tabular-nums outline-none" />
                <button disabled={busy || saving || !amountValue}
                  onClick={() => { onSaveAmount(doc.documentId!, amountValue); setAmountEditing(false); setAmountValue(""); }}
                  className="rounded bg-indigo-600 px-2 py-0.5 text-[11px] font-medium text-white disabled:opacity-40">保存</button>
                <button onClick={() => { setAmountEditing(false); setAmountValue(""); }}
                  className="rounded px-1.5 py-0.5 text-[11px] text-slate-400 hover:text-slate-600">取消</button>
              </>
            ) : (
              <>
                <span className="text-[12px] font-semibold tabular-nums text-slate-700">{fmtMoney(doc.amount)}</span>
                {doc.documentId ? (
                  <button disabled={busy || closed}
                    onClick={() => { setAmountEditing(true); setAmountValue(String(doc.amount ?? "")); }}
                    className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-40"
                    title="更正录错的入库单金额">✎ 改金额</button>
                ) : null}
                {mismatch && (
                  <>
                    <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700 ring-1 ring-amber-200">
                      单据头 {fmtMoney(doc.amount)} ≠ 明细合计 {fmtMoney(doc.itemAmount)}（{doc.itemCount} 行）
                    </span>
                    <button disabled={busy || closed} onClick={() => doc.documentId && onCorrectAmount(doc.documentId)}
                      className="rounded bg-amber-500 px-1.5 py-0.5 text-[11px] font-medium text-white hover:bg-amber-600 disabled:opacity-40"
                      title="以明细金额合计重算单据金额">按明细更正</button>
                  </>
                )}
              </>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {linkId ? (
            <div className="flex items-center gap-1">
              <button disabled={busy || closed} onClick={() => onRequestReplace(linkId)}
                className="rounded px-1.5 py-0.5 text-[11px] text-slate-400 hover:bg-slate-50 hover:text-indigo-600 disabled:opacity-40">更换</button>
              <button disabled={busy || closed} onClick={() => onRemove(linkId)}
                className="rounded px-1.5 py-0.5 text-[11px] text-slate-400 hover:bg-slate-50 hover:text-red-500 disabled:opacity-40">解除</button>
            </div>
          ) : <span className="text-[11px] text-slate-400">历史关联</span>}
        </div>
      </div>

      <div className="mt-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-slate-500">
            SKU 明细 {allocations.length > 0 ? `(${allocations.length} 行 · ${fmtMoney(skuTotal)})` : ""}
          </span>
          {editable && <button disabled={busy || closed} onClick={() => onAddSku(doc.documentId!)}
            className="rounded bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-600 hover:bg-indigo-100 disabled:opacity-40">＋ 新建</button>}
        </div>
        <div className="mt-1 overflow-x-auto">
        <table className="w-full table-fixed border-collapse text-[12px]">
          <colgroup>
            <col style={{ width: "38%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "20%" }} />
            <col style={{ width: "10%" }} />
          </colgroup>
          <thead>
            <tr className="text-[11px] text-slate-400">
              <th className="border-b border-slate-100 py-1 pr-2 text-left font-medium">SKU 明细</th>
              <th className="border-b border-slate-100 py-1 px-1 text-right font-medium">数量</th>
              <th className="border-b border-slate-100 py-1 px-1 text-right font-medium">单价</th>
              <th className="border-b border-slate-100 py-1 px-1 text-right font-medium">总价</th>
              <th className="border-b border-slate-100 py-1 px-1 text-left font-medium">耗材</th>
              <th className="border-b border-slate-100 py-1 pl-2 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {allocations.length > 0 ? allocations.map((row, i) => {
              const k = rowKey(row, i);
              const mapping = usageMappings.find((m) => m.skuId === row.skuId);
              const current = rowCons[k] ?? defaultFor(row, mapping);
              const material = current ? usageMaterials.find((m) => m.id === current.consumableId) : null;
              const editableCell = editable && !closed && usageEnabled !== false;
              return (
                <tr key={k} className="whitespace-nowrap border-b border-slate-50 last:border-0">
                  <td className="py-1.5 pr-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="shrink-0 font-mono text-[11px] text-indigo-500">{row.skuCode || "未关联SKU"}</span>
                      <span className="min-w-0 truncate text-[12px] font-medium text-slate-700" title={`${row.skuCode || ""} ${row.goodsName || "未命名商品"}`}>{row.goodsName || "未命名商品"}</span>
                    </div>
                  </td>
                  <td className="py-1.5 px-1 text-right tabular-nums text-slate-500">{row.quantity ?? "—"}</td>
                  <td className="py-1.5 px-1 text-right tabular-nums text-slate-500">{fmtMoney(row.unitPrice)}</td>
                  <td className="py-1.5 px-1 text-right tabular-nums font-medium text-slate-700">{fmtMoney(row.amount)}</td>
                  <td className="py-1.5 px-1">
                    {usageEnabled === false ? (
                      <span className="text-[11px] text-slate-400">本单不使用</span>
                    ) : (
                      <div className="flex items-center gap-1">
                        <SearchableSelect
                          compact
                          className="flex-1"
                          disabled={!editableCell}
                          ariaLabel="选择耗材"
                          placeholder={`＋ 选择耗材${mapping ? "" : "（手工）"}`}
                          value={current?.consumableId ? String(current.consumableId) : ""}
                          onChange={(next) => {
                            const id = Number(next);
                            if (!id) { setRowCons((p) => ({ ...p, [k]: null })); return; }
                            setRowCons((p) => ({ ...p, [k]: { consumableId: id, quantity: defaultQtyFor(row, id) } }));
                          }}
                          options={usageMaterials.map((m) => ({
                            value: String(m.id), label: `${m.code} · ${m.name}`, keywords: `${m.code} ${m.name}`,
                          }))}
                        />
                        <input value={current?.quantity ?? ""} disabled={!editableCell || !current?.consumableId}
                          onChange={(e) => setRowCons((p) => ({ ...p, [k]: { consumableId: current?.consumableId ?? mapping?.consumableId ?? 0, quantity: e.target.value } }))}
                          placeholder="数量" className="h-6 w-11 shrink-0 rounded border border-slate-200 px-1 text-center text-[11px] tabular-nums outline-none focus:border-amber-400 disabled:bg-slate-50" />
                        <span className="w-6 shrink-0 text-[11px] text-slate-400">{material?.unit}</span>
                      </div>
                    )}
                  </td>
                  <td className="py-1.5 pl-2 text-right">
                    {editable && row.id ? (
                      <div className="flex justify-end gap-1.5">
                        <button disabled={busy} onClick={() => onEditAllocation(row, current)} className="text-[11px] text-indigo-600 disabled:opacity-40">修改</button>
                        <button disabled={busy} onClick={() => onRemoveAllocation(row.id as number)} className="text-[11px] text-red-400 hover:text-red-600 disabled:opacity-40">删除</button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            }            ) : (
              <tr><td colSpan={6} className="py-2 text-center text-[11px] text-slate-400">本张单据没有反填 SKU 明细</td></tr>
            )}
            {editor}
          </tbody>
        </table>
        </div>
      </div>

      {/* 未登记时才显示登记表单；已登记的状态见右上角徽标 */}
      {!decided && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-amber-50/70 px-2 py-1.5">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium text-slate-600">耗材登记</span>
            <div className="flex gap-1">
              <button type="button" disabled={busy || saving} onClick={() => setUsageEnabled(true)}
                className={cx("rounded border px-1.5 py-0.5 text-[11px]",
                  usageEnabled === true ? "border-amber-400 bg-amber-100 font-semibold text-amber-800" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300")}>有耗材</button>
              <button type="button" disabled={busy || saving} onClick={() => setUsageEnabled(false)}
                className={cx("rounded border px-1.5 py-0.5 text-[11px]",
                  usageEnabled === false ? "border-slate-500 bg-slate-200 font-semibold text-slate-700" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300")}>不使用</button>
            </div>
          </div>
          {linkId && !closed ? (
            <button disabled={saving || busy || usageEnabled === null} onClick={() => void saveConsumables()}
              className="rounded bg-amber-500 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-amber-600 disabled:opacity-40">
              {saving ? "保存中…" : "保存耗材"}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
