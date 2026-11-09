"use client";

import { CIRCLED, Icon, IconName, cx, fmtMoney } from "./workbench-shared";
import {
  type WorkbenchSummary,

} from "@/lib/api";

export function KpiGrid({ summary, onOpenChain }: {
  summary: WorkbenchSummary | null;
  onOpenChain?: () => void;
}) {
  const cards: Array<{ label: string; value: number | string; hint: string; icon: IconName; tone: string }> = [
    {
      label: "新订单", value: summary?.newOrders ?? "—", hint: "按采购时间统计", icon: "orders", tone: "blue",
    },
    { label: "待匹配SKU", value: summary?.pendingSku ?? "—", hint: "待完善采购内容", icon: "magic", tone: "violet" },
    { label: "已到货待入库", value: summary?.pendingInbound ?? "—", hint: "等待入库确认", icon: "box", tone: "green" },
    { label: "待开票", value: summary?.pendingInvoice ?? "—", hint: "等待发票清单", icon: "receipt", tone: "amber" },
    { label: "异常数", value: summary?.exceptionCount ?? "—", hint: "需人工处理", icon: "reconcile", tone: "red" },
    {
      label: "已付款率",
      value: summary ? `${summary.paidRate}%` : "—",
      hint: summary ? `已付 ${fmtMoney(summary.paidAmount)} / 应付 ${fmtMoney(summary.totalAmount)}` : "采购摘要未就绪",
      icon: "reconcile",
      tone: "teal",
    },
  ];
  const funnel = summary?.funnel ?? null;
  const todos = summary?.todos ?? null;
  const steps = funnel?.steps ?? [];
  const pending = todos?.pending ?? 0;
  const doneStages = steps.filter((step) => step.pct >= 100).length;
  const stepTotal = funnel?.stepTotal ?? steps.length;
  return (
    <section className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
      {cards.map((card) => <KpiCard key={card.label} {...card} />)}
      {steps.length > 0 && (
        <article
          role="button"
          tabIndex={0}
          onClick={onOpenChain}
          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpenChain?.(); } }}
          title={steps.map((step) => `${CIRCLED[step.no - 1] ?? step.no} ${step.label}：${step.count}/${funnel?.total ?? 0}（${step.pct}%）｜${step.act}`).join("\n")}
          className="flex min-h-[84px] cursor-pointer flex-col justify-center gap-1 rounded-xl border border-slate-200/80 bg-white px-3 py-2.5 shadow-[0_3px_12px_rgba(40,53,85,0.04)] transition-colors hover:border-indigo-200 hover:bg-indigo-50/30 focus:outline-none focus:ring-2 focus:ring-indigo-200"
        >
          <div className="flex items-center gap-1.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-indigo-50 text-indigo-600"><Icon name="magic" size={12} /></span>
            <span className="truncate text-[10.5px] font-medium text-slate-500">环节完成度</span>
          </div>
          <div className="text-[19px] font-semibold leading-6 tabular-nums text-slate-900">{doneStages}/{stepTotal}<span className="ml-1.5 text-[9.5px] font-normal text-slate-400">{pending > 0 ? <span className="font-medium text-amber-600">{pending} 个待办</span> : "暂无待办"}</span></div>
          <div className="mt-2 flex items-end gap-1">
            {steps.map((step) => {
              const dimColor = step.dimension === "1688" ? "bg-indigo-500" : step.dimension === "purchase" ? "bg-violet-500" : step.dimension === "jackyun" ? "bg-teal-500" : "bg-amber-500";
              return (
                <div key={step.key} className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="h-1 overflow-hidden rounded-full bg-slate-100">
                    <div className={cx("h-full", dimColor)} style={{ width: step.pct + "%" }} />
                  </div>
                  <div className="truncate text-center font-mono text-[8px] leading-3 text-slate-400">{CIRCLED[step.no - 1] ?? step.no}{step.pct}%</div>
                </div>
              );
            })}
          </div>
        </article>
      )}
    </section>
  );
}

export function KpiCard({ label, value, hint, icon, tone }: {
  label: string; value: number | string; hint: string; icon: IconName; tone: string;
}) {
  const tones: Record<string, string> = {
    blue: "bg-blue-50 text-blue-600", violet: "bg-violet-50 text-violet-600", orange: "bg-orange-50 text-orange-600",
    green: "bg-emerald-50 text-emerald-600", amber: "bg-amber-50 text-amber-600", red: "bg-red-50 text-red-600",
    teal: "bg-teal-50 text-teal-600",
  };
  return (
    <article title={`${label}（${hint}）`} className="flex min-h-[84px] flex-col justify-center gap-0.5 rounded-xl border border-slate-200/80 bg-white px-3 py-2.5 shadow-[0_3px_12px_rgba(40,53,85,0.04)]">
      <div className="flex items-center gap-1.5">
        <span className={cx("flex h-5 w-5 shrink-0 items-center justify-center rounded-md", tones[tone])}><Icon name={icon} size={12} /></span>
        <span className="truncate text-[10.5px] font-medium text-slate-500">{label}</span>
      </div>
      <div className="text-[19px] font-semibold leading-6 tabular-nums text-slate-900">{value}</div>
      <div className="truncate text-[9.5px] text-slate-400" title={hint}>{hint}</div>
    </article>
  );
}
