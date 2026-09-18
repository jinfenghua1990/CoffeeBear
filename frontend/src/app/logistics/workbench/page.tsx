"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { logisticsApi, type LogisticsWorkbench } from "@/lib/api";

function fmtMoney(v: string | null | undefined): string {
  if (v == null || v === "" || v === "0" || v === "0.00") return "—";
  try {
    const n = parseFloat(v);
    return "¥" + n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch {
    return "—";
  }
}

function fmtCount(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("zh-CN");
}

const STATUS_STYLE: Record<string, string> = {
  settled: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  pending: "bg-amber-50 text-amber-700 ring-amber-200",
  abnormal: "bg-red-50 text-red-700 ring-red-200",
  partial: "bg-sky-50 text-sky-700 ring-sky-200",
};

function StatusTag({ status, label }: { status: string; label: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLE[status] ?? "bg-gray-100 text-gray-500 ring-gray-200"}`}>
      {label}
    </span>
  );
}

export default function LogisticsWorkbenchPage() {
  const [data, setData] = useState<LogisticsWorkbench | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [draftPrice, setDraftPrice] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await logisticsApi.workbench();
      setData(d);
      setDraftPrice(d.settings.defaultUnitPrice);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveSetting = useCallback(async () => {
    if (!data) return;
    setSaving(true);
    try {
      await logisticsApi.updateSetting(draftPrice);
      setShowSettings(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
      setSaving(false);
    }
  }, [data, draftPrice, load]);

  const cards = useMemo(() => {
    if (!data) return [];
    const c = data.cards;
    return [
      { label: "本月发货单量", value: fmtCount(c.monthShippedCount), hint: `${fmtMoney(c.monthEstimatedAmount)} = 单量 × 预估单价` },
      { label: "本月预估运费", value: fmtMoney(c.monthEstimatedAmount), hint: "未出账，按预估计入成本" },
      { label: "待出账运费", value: fmtMoney(c.pendingEstimatedAmount), hint: "本年未核销月份的预估合计" },
      { label: "最近实际单均运费", value: c.latestActualUnitPrice ? fmtMoney(c.latestActualUnitPrice) + "/单" : "—", hint: "最近一张已核销账单" },
      { label: "本年度物流成本", value: fmtMoney(c.annualLogisticsCost), hint: "已出账用实际、未出账用预估" },
    ];
  }, [data]);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-800">物流工作台</h1>
          <p className="mt-0.5 text-xs text-gray-400">日常预估 → 半年账单 → 实际核销 → 财务利润自动修正</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/logistics/bills" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
            物流账单
          </Link>
          <button
            onClick={() => { setDraftPrice(data?.settings.defaultUnitPrice ?? "5.00"); setShowSettings(true); }}
            className="rounded-lg bg-[#2574e8] px-3 py-2 text-sm font-medium text-white hover:bg-[#1f63c9]"
          >
            物流设置
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
      )}

      {loading && !data ? (
        <div className="py-16 text-center text-sm text-gray-400">加载中…</div>
      ) : data ? (
        <>
          {/* 顶部 5 张数据卡 */}
          <div className="grid grid-cols-5 gap-3">
            {cards.map((c) => (
              <div key={c.label} className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="text-xs text-gray-500">{c.label}</div>
                <div className="mt-1.5 text-lg font-semibold tabular-nums text-gray-800">{c.value}</div>
                <div className="mt-1 text-[11px] text-gray-400">{c.hint}</div>
              </div>
            ))}
          </div>

          {/* 月度物流成本表 */}
          <div className="rounded-xl border border-gray-200 bg-white">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="h-3.5 w-1 rounded bg-[#2574e8]" />
                <span className="text-sm font-medium text-gray-800">月度物流成本</span>
              </div>
              <span className="text-xs text-gray-400">预估单价 {fmtMoney(data.settings.defaultUnitPrice)}/单</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                    <th className="px-4 py-2.5 font-medium">月份</th>
                    <th className="px-4 py-2.5 font-medium">发货订单数</th>
                    <th className="px-4 py-2.5 font-medium">预估单价</th>
                    <th className="px-4 py-2.5 font-medium">预估运费</th>
                    <th className="px-4 py-2.5 font-medium">实际账单金额</th>
                    <th className="px-4 py-2.5 font-medium">实际单均运费</th>
                    <th className="px-4 py-2.5 font-medium">预估与实际差额</th>
                    <th className="px-4 py-2.5 font-medium">账单状态</th>
                    <th className="px-4 py-2.5 font-medium text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {data.months.length === 0 && (
                    <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400">暂无数据</td></tr>
                  )}
                  {data.months.map((row, i) => (
                    <tr key={row.period + (row.billId ?? "")} className={i % 2 ? "bg-gray-50/40" : ""}>
                      <td className="px-4 py-2.5 text-gray-800">{row.periodLabel}</td>
                      <td className="px-4 py-2.5 tabular-nums text-gray-700">{row.shippedCount != null ? fmtCount(row.shippedCount) : "—"}</td>
                      <td className="px-4 py-2.5 tabular-nums text-gray-600">{row.unitPrice ? fmtMoney(row.unitPrice) : "—"}</td>
                      <td className="px-4 py-2.5 tabular-nums text-gray-800">{fmtMoney(row.estimatedAmount)}{row.type === "month" ? " (估)" : ""}</td>
                      <td className="px-4 py-2.5 tabular-nums text-gray-800">{fmtMoney(row.actualAmount)}</td>
                      <td className="px-4 py-2.5 tabular-nums text-gray-600">{row.actualUnitPrice ? fmtMoney(row.actualUnitPrice) + "/单" : "—"}</td>
                      <td className={`px-4 py-2.5 tabular-nums ${row.difference && parseFloat(row.difference) < 0 ? "text-emerald-600" : "text-red-500"}`}>
                        {row.difference ? fmtMoney(row.difference) : "—"}
                      </td>
                      <td className="px-4 py-2.5"><StatusTag status={row.status} label={row.statusLabel} /></td>
                      <td className="px-4 py-2.5 text-right">
                        {row.type === "bill" ? (
                          <Link href="/logistics/bills" className="text-xs text-[#2574e8] hover:underline">查看</Link>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}

      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowSettings(false)}>
          <div className="w-[380px] rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-gray-800">物流设置</h3>
            <p className="mt-1 text-xs text-gray-400">系统按「预估运费 = 有效发货单量 × 默认预估单价」计算财务利润中的物流成本。账单核销后自动替换为实际成本。</p>
            <label className="mt-4 block text-sm text-gray-600">默认预估单价（元/单）</label>
            <input
              value={draftPrice}
              onChange={(e) => setDraftPrice(e.target.value)}
              type="number"
              step="0.01"
              min="0"
              className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#2574e8]"
              placeholder="5.00"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setShowSettings(false)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">取消</button>
              <button onClick={saveSetting} disabled={saving} className="rounded-lg bg-[#2574e8] px-3 py-2 text-sm font-medium text-white hover:bg-[#1f63c9] disabled:opacity-50">
                {saving ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
