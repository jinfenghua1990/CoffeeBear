"use client";

import { useCallback, useEffect, useState } from "react";
import { logisticsApi, type LogisticsBill } from "@/lib/api";

function fmtMoney(v: string | null | undefined): string {
  if (v == null || v === "" || v === "0" || v === "0.00") return "—";
  try {
    return "¥" + parseFloat(v).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

const INVOICE_LABEL: Record<string, string> = { none: "无", uninvoiced: "未开票", invoiced: "已开票" };

export default function LogisticsBillsPage() {
  const [items, setItems] = useState<LogisticsBill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [detail, setDetail] = useState<LogisticsBill | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await logisticsApi.bills();
      setItems(d.items ?? []);
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

  const [form, setForm] = useState({
    periodLabel: "",
    periodStart: "",
    periodEnd: "",
    carrier: "",
    waybillCount: "",
    actualAmount: "",
    invoiceStatus: "none",
    note: "",
  });

  const openCreate = () => {
    setForm({ periodLabel: "", periodStart: "", periodEnd: "", carrier: "", waybillCount: "", actualAmount: "", invoiceStatus: "none", note: "" });
    setShowCreate(true);
  };

  const submitCreate = async () => {
    setSaving(true);
    setError(null);
    try {
      await logisticsApi.createBill({
        period_label: form.periodLabel,
        period_start: form.periodStart || null,
        period_end: form.periodEnd || null,
        carrier: form.carrier,
        waybill_count: form.waybillCount ? parseInt(form.waybillCount, 10) : null,
        actual_amount: form.actualAmount,
        invoice_status: form.invoiceStatus,
        note: form.note,
      });
      setShowCreate(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const settle = async (id: number) => {
    if (!window.confirm("确认核销该账单？核销后对应账期的物流成本将改为实际账单金额。")) return;
    setSaving(true);
    try {
      await logisticsApi.settleBill(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "核销失败");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    if (!window.confirm("确认删除该账单？")) return;
    try {
      await logisticsApi.deleteBill(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    }
  };

  const openDetail = async (id: number) => {
    try {
      const b = await logisticsApi.bill(id);
      setDetail(b);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载账单失败");
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-800">物流账单</h1>
          <p className="mt-0.5 text-xs text-gray-400">通常半年出一次账单，导入并核销后替换预估物流成本</p>
        </div>
        <button onClick={openCreate} className="rounded-lg bg-[#2574e8] px-3 py-2 text-sm font-medium text-white hover:bg-[#1f63c9]">
          ＋ 导入物流账单
        </button>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

      {loading && !items.length ? (
        <div className="py-16 text-center text-sm text-gray-400">加载中…</div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                  <th className="px-4 py-2.5 font-medium">账单周期</th>
                  <th className="px-4 py-2.5 font-medium">物流公司</th>
                  <th className="px-4 py-2.5 font-medium">运单数</th>
                  <th className="px-4 py-2.5 font-medium">系统预估</th>
                  <th className="px-4 py-2.5 font-medium">实际账单</th>
                  <th className="px-4 py-2.5 font-medium">实际单均</th>
                  <th className="px-4 py-2.5 font-medium">差额</th>
                  <th className="px-4 py-2.5 font-medium">核销情况</th>
                  <th className="px-4 py-2.5 font-medium">发票状态</th>
                  <th className="px-4 py-2.5 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr><td colSpan={10} className="px-4 py-10 text-center text-gray-400">暂无账单，点击右上角「导入物流账单」添加</td></tr>
                )}
                {items.map((b, i) => (
                  <tr key={b.id} className={i % 2 ? "bg-gray-50/40" : ""}>
                    <td className="px-4 py-2.5 text-gray-800">{b.periodLabel}</td>
                    <td className="px-4 py-2.5 text-gray-700">{b.carrier || "—"}</td>
                    <td className="px-4 py-2.5 tabular-nums text-gray-700">{fmtCount(b.waybillCount)}</td>
                    <td className="px-4 py-2.5 tabular-nums text-gray-600">{fmtMoney(b.estimatedAmount)}</td>
                    <td className="px-4 py-2.5 tabular-nums text-gray-800">{fmtMoney(b.actualAmount)}</td>
                    <td className="px-4 py-2.5 tabular-nums text-gray-600">{b.actualUnitPrice ? fmtMoney(b.actualUnitPrice) + "/单" : "—"}</td>
                    <td className={`px-4 py-2.5 tabular-nums ${b.difference && parseFloat(b.difference) < 0 ? "text-emerald-600" : "text-red-500"}`}>{fmtMoney(b.difference)}</td>
                    <td className="px-4 py-2.5"><StatusTag status={b.status} label={b.statusLabel} /></td>
                    <td className="px-4 py-2.5 text-gray-600">{INVOICE_LABEL[b.invoiceStatus] ?? b.invoiceStatus}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-3">
                        <button onClick={() => openDetail(b.id)} className="text-xs text-[#2574e8] hover:underline">查看</button>
                        {b.status === "pending" && (
                          <button onClick={() => settle(b.id)} className="text-xs text-emerald-600 hover:underline">核销</button>
                        )}
                        <button onClick={() => remove(b.id)} className="text-xs text-red-500 hover:underline">删除</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowCreate(false)}>
          <div className="w-[460px] rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-gray-800">导入物流账单</h3>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs text-gray-500">账单周期（如 2026 H1）</label>
                <input value={form.periodLabel} onChange={(e) => setForm({ ...form, periodLabel: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#2574e8]" placeholder="2026 H1" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500">周期开始（年-月-日）</label>
                  <input type="date" value={form.periodStart} onChange={(e) => setForm({ ...form, periodStart: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#2574e8]" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">周期结束</label>
                  <input type="date" value={form.periodEnd} onChange={(e) => setForm({ ...form, periodEnd: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#2574e8]" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500">物流公司</label>
                  <input value={form.carrier} onChange={(e) => setForm({ ...form, carrier: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#2574e8]" placeholder="圆通" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">运单数</label>
                  <input type="number" value={form.waybillCount} onChange={(e) => setForm({ ...form, waybillCount: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#2574e8]" placeholder="52130" />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500">实际账单金额（元）</label>
                <input type="number" value={form.actualAmount} onChange={(e) => setForm({ ...form, actualAmount: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#2574e8]" placeholder="251280.00" />
              </div>
              <div>
                <label className="text-xs text-gray-500">发票状态</label>
                <select value={form.invoiceStatus} onChange={(e) => setForm({ ...form, invoiceStatus: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#2574e8]">
                  <option value="none">无</option>
                  <option value="uninvoiced">未开票</option>
                  <option value="invoiced">已开票</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500">备注</label>
                <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#2574e8]" />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setShowCreate(false)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">取消</button>
              <button onClick={submitCreate} disabled={saving || !form.actualAmount} className="rounded-lg bg-[#2574e8] px-3 py-2 text-sm font-medium text-white hover:bg-[#1f63c9] disabled:opacity-50">
                {saving ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setDetail(null)}>
          <div className="w-[520px] rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-gray-800">账单明细</h3>
            <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50/50 p-4">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <Info k="物流公司" v={detail.carrier || "—"} />
                <Info k="账单周期" v={detail.periodLabel} />
                <Info k="账单金额" v={fmtMoney(detail.actualAmount)} />
                <Info k="系统预估" v={fmtMoney(detail.estimatedAmount)} />
                <Info k="差额" v={fmtMoney(detail.difference)} />
                <Info k="实际单均" v={detail.actualUnitPrice ? fmtMoney(detail.actualUnitPrice) + "/单" : "—"} />
                <Info k="核销情况" v={detail.statusLabel} />
                <Info k="发票状态" v={INVOICE_LABEL[detail.invoiceStatus] ?? detail.invoiceStatus} />
              </div>
              <div className="mt-3 border-t border-gray-200 pt-3 text-xs text-gray-400">
                <p>上传原始账单：暂未支持附件上传（第一阶段按「账期 + 公司 + 总金额」整体核销）。</p>
              </div>
            </div>
            <div className="mt-3 rounded-lg border border-gray-200 p-4">
              <div className="text-sm font-medium text-gray-700">账单匹配结果</div>
              <div className="mt-2 grid grid-cols-4 gap-3 text-center">
                <Match k="匹配运单" v={fmtCount(detail.matchedCount)} />
                <Match k="未匹配" v={fmtCount(detail.unmatchedCount)} />
                <Match k="重复运单" v={fmtCount(detail.duplicateCount)} />
                <Match k="异常金额" v={fmtCount(detail.abnormalCount)} />
              </div>
              <p className="mt-2 text-xs text-gray-400">第 1 阶段无运单级明细，匹配数据暂为空；后续上传含运单号的账单后可自动匹配。</p>
            </div>
            <div className="mt-5 flex justify-end">
              <button onClick={() => setDetail(null)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Info({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-gray-400">{k}</span>
      <span className="tabular-nums text-gray-700">{v}</span>
    </div>
  );
}

function Match({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg bg-white px-2 py-3 ring-1 ring-gray-200">
      <div className="text-sm font-semibold tabular-nums text-gray-800">{v}</div>
      <div className="mt-0.5 text-[11px] text-gray-400">{k}</div>
    </div>
  );
}
