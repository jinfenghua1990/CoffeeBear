"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authenticatedFetch, reconApi, type ReconTxn } from "@/lib/api";
import { useTabScopedState } from "@/lib/workspace/tab-store";

type DirectionFilter = "all" | "in" | "out";
type MatchFilter = "all" | "matched" | "unmatched";

const CARD = "rounded-xl border border-slate-200 bg-white shadow-sm";

function previousMonth() {
  const now = new Date();
  const value = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
}

function money(value: string | number | null | undefined) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount)
    ? `¥${amount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "—";
}

function dateText(value: string) {
  return value ? value.slice(0, 10) : "—";
}

function matchText(row: ReconTxn) {
  if (row.direction === "in") return row.matched ? "已回款对账" : "待回款对账";
  return row.invoiceMatched ? "已关联发票" : "待关联发票";
}

function matchClass(row: ReconTxn) {
  const matched = row.direction === "in" ? row.matched : row.invoiceMatched;
  return matched
    ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
    : "bg-amber-50 text-amber-700 ring-amber-200";
}

export default function BankTransactionsPage() {
  const [rows, setRows] = useState<ReconTxn[]>([]);
  const [direction, setDirection] = useTabScopedState<DirectionFilter>("bank.direction", "all");
  const [matchFilter, setMatchFilter] = useTabScopedState<MatchFilter>("bank.match", "all");
  const [query, setQuery] = useTabScopedState("bank.search", "");
  const [period, setPeriod] = useTabScopedState("bank.period", previousMonth);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setRows(await reconApi.transactions(500));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (direction !== "all" && row.direction !== direction) return false;
      const matched = row.direction === "in" ? row.matched : row.invoiceMatched;
      if (matchFilter === "matched" && !matched) return false;
      if (matchFilter === "unmatched" && matched) return false;
      if (!needle) return true;
      return [row.txnDate, row.counterpartyName, row.summary, row.voucherNo, row.accountNo, row.accountName]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [direction, matchFilter, query, rows]);

  const summary = useMemo(() => {
    return rows.reduce(
      (result, row) => {
        const amount = Number(row.amount) || 0;
        result.count += 1;
        if (row.direction === "in") result.income += amount;
        else result.expense += amount;
        const matched = row.direction === "in" ? row.matched : row.invoiceMatched;
        if (!matched) result.pending += 1;
        return result;
      },
      { count: 0, income: 0, expense: 0, pending: 0 },
    );
  }, [rows]);

  const directionCounts = useMemo(
    () => ({
      all: rows.length,
      in: rows.filter((row) => row.direction === "in").length,
      out: rows.filter((row) => row.direction === "out").length,
    }),
    [rows],
  );

  async function uploadBank(file: File) {
    const [year, month] = period.split("-").map(Number);
    if (!year || !month) {
      setError("请先选择流水所属账期");
      return;
    }
    setUploading(true);
    setError("");
    setMessage("");
    const form = new FormData();
    form.append("file", file);
    form.append("period_year", String(year));
    form.append("period_month", String(month));
    form.append("category", "bank");
    form.append("original_name", `银行交易明细${file.name.toLowerCase().endsWith(".xlsx") ? ".xlsx" : ""}`);
    try {
      const response = await authenticatedFetch("/api/v1/finance/files", { method: "POST", body: form });
      const data = (await response.json().catch(() => ({}))) as {
        detail?: string;
        id?: number;
        version?: number;
        storedPath?: string;
        bankImport?: { created: number; duplicates: number; skipped: number };
        bankImportError?: string;
      };
      if (!response.ok) throw new Error(data.detail || `上传失败（${response.status}）`);
      if (data.bankImportError) {
        setError(`原件已归档 v${data.version ?? ""}（${data.storedPath ?? "原始文件库"}），流水解析失败：${data.bankImportError}`);
      } else if (data.bankImport) {
        setMessage(`银行交易明细已导入 v${data.version ?? ""}：新增 ${data.bankImport.created} 笔，重复跳过 ${data.bankImport.duplicates} 笔，无法识别 ${data.bankImport.skipped} 笔。`);
      } else {
        setMessage(`银行交易明细已归档 v${data.version ?? ""}，但没有生成流水记录，请检查文件格式。`);
      }
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-4 pb-8">
      <header className="app-page-header -mx-1 bg-[#f4f7fb]/95 pb-2 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="mb-1 text-[11px] font-medium tracking-wide text-blue-600">财务中心 / 银行流水</div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">银行流水</h1>
            <p className="mt-1 text-xs text-slate-500">查看账户收入与支出流水；收入用于回款对账，支出用于进项发票匹配。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadBank(file); }} />
            <input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} aria-label="银行流水账期" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 outline-none focus:border-blue-400" />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-wait disabled:opacity-50">{uploading ? "导入中…" : "上传银行流水"}</button>
            <button type="button" onClick={() => void load()} disabled={loading} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50">刷新</button>
          </div>
        </div>
      </header>

      {message && <div role="status" className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-700">{message}</div>}
      {error && <div role="alert" className="rounded-lg border border-rose-100 bg-rose-50 px-4 py-2.5 text-xs text-rose-700">{error}</div>}

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          ["流水笔数", summary.count.toLocaleString("zh-CN"), "已导入全部流水"],
          ["收入合计", money(summary.income), "用于回款对账"],
          ["支出合计", money(summary.expense), "用于进项发票匹配"],
          ["待匹配", summary.pending.toLocaleString("zh-CN"), "需要继续处理"],
        ].map(([label, value, hint]) => (
          <div key={label} className={`${CARD} px-4 py-3`}>
            <div className="text-xs text-slate-400">{label}</div>
            <div className="mt-1 text-xl font-semibold tracking-tight text-slate-900">{value}</div>
            <div className="mt-1 text-[11px] text-slate-400">{hint}</div>
          </div>
        ))}
      </section>

      <section className={`${CARD} overflow-hidden`}>
        <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
          <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5">
            {([ ["all", "全部流水"], ["in", "收入"], ["out", "支出"] ] as const).map(([value, label]) => (
              <button key={value} type="button" onClick={() => setDirection(value)} className={`rounded-md px-3 py-1.5 text-xs transition ${direction === value ? "bg-blue-600 font-medium text-white" : "text-slate-500 hover:bg-slate-50"}`}>
                {label} <span className={direction === value ? "text-blue-100" : "text-slate-400"}>{directionCounts[value]}</span>
              </button>
            ))}
          </div>
          <div className="relative min-w-[220px] flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">⌕</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索对方户名 / 摘要 / 凭证号 / 账户" className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs outline-none focus:border-blue-400" />
          </div>
          <select value={matchFilter} onChange={(event) => setMatchFilter(event.target.value as MatchFilter)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 outline-none">
            <option value="all">全部匹配状态</option>
            <option value="matched">已匹配</option>
            <option value="unmatched">待匹配</option>
          </select>
          <Link href="/finance/monthly-send" className="ml-auto rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50">月度资料</Link>
        </div>

        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/50 px-4 py-2 text-[11px] text-slate-400">
          <span>{loading ? "正在读取银行流水…" : `当前显示 ${visibleRows.length} / ${rows.length} 笔`}</span>
          <span>重复导入按流水指纹自动跳过</span>
        </div>

        {loading ? <div className="px-4 py-16 text-center text-sm text-slate-400">加载中…</div> : !visibleRows.length ? (
          <div className="px-4 py-16 text-center">
            <div className="text-sm font-medium text-slate-600">{rows.length ? "没有符合条件的流水" : "暂无银行流水"}</div>
            <div className="mt-2 text-xs text-slate-400">{rows.length ? "可以调整搜索或筛选条件" : "请选择账期并上传浙江农信交易明细 XLSX 文件"}</div>
            {!rows.length && <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="mt-4 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">上传银行流水</button>}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">交易日期</th>
                  <th className="px-4 py-3 font-medium">方向</th>
                  <th className="px-4 py-3 text-right font-medium">金额</th>
                  <th className="px-4 py-3 font-medium">对方户名</th>
                  <th className="px-4 py-3 font-medium">摘要</th>
                  <th className="px-4 py-3 font-medium">凭证号</th>
                  <th className="px-4 py-3 font-medium">账户</th>
                  <th className="px-4 py-3 font-medium">匹配状态</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleRows.map((row) => (
                  <tr key={row.id} className="hover:bg-blue-50/30">
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">{dateText(row.txnDate)}</td>
                    <td className="px-4 py-3"><span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-medium ring-1 ring-inset ${row.direction === "in" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-violet-50 text-violet-700 ring-violet-200"}`}>{row.direction === "in" ? "收入" : "支出"}</span></td>
                    <td className={`whitespace-nowrap px-4 py-3 text-right font-medium ${row.direction === "in" ? "text-emerald-700" : "text-slate-800"}`}>{row.direction === "in" ? "+" : "−"}{money(row.amount)}</td>
                    <td className="max-w-[220px] truncate px-4 py-3 text-slate-800">{row.counterpartyName || "—"}</td>
                    <td className="max-w-[240px] truncate px-4 py-3 text-xs text-slate-500">{row.summary || "—"}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-400">{row.voucherNo || "—"}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{row.accountName || row.accountNo || "浙江农信"}</td>
                    <td className="px-4 py-3"><span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-medium ring-1 ring-inset ${matchClass(row)}`}>{matchText(row)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
