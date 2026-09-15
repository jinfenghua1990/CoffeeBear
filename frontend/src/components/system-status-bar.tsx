"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getOverview, getSystemHealth, IntegrationStatus } from "@/lib/api";

type BarState = "loading" | "ok" | "attention" | "error";
type StatusTone = "error" | "attention" | "ok" | "neutral";

const HARD_FAILURES = new Set(["error", "blocked", "needs_login", "needs_user_verify"]);
const NEEDS_SETUP = new Set(["unconfigured", "configured_not_tested", "untested"]);
const COMPONENT_LABEL: Record<string, string> = { database: "数据库", redis: "任务队列" };

function integrationLabel(item: IntegrationStatus) {
  return item.name.replace(/（订单备用）|\(订单备用\)/g, "");
}

function dotTone(state: BarState) {
  return state === "error" ? "bg-rose-400" : state === "attention" ? "bg-amber-400" : state === "ok" ? "bg-emerald-400" : "bg-slate-400";
}

function launcherTone(state: BarState) {
  return state === "error"
    ? "border-rose-300/20 bg-rose-400/10 hover:bg-rose-400/15"
    : state === "attention"
      ? "border-amber-300/20 bg-amber-400/10 hover:bg-amber-400/15"
      : state === "ok"
        ? "border-emerald-300/20 bg-emerald-400/10 hover:bg-emerald-400/15"
        : "border-white/10 bg-white/5 hover:bg-white/8";
}

function ChevronIcon({ open }: { open: boolean }) {
  return <svg viewBox="0 0 16 16" fill="none" className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return <svg viewBox="0 0 20 20" fill="none" className={`h-3.5 w-3.5 ${spinning ? "animate-spin" : ""}`} aria-hidden="true"><path d="M16 6.5V3.8m0 0h-2.7M16 3.8a6.7 6.7 0 1 0 1.15 7.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function DetailRow({ tone, label, detail, href }: { tone: StatusTone; label: string; detail: string; href?: string }) {
  const dot = tone === "error" ? "bg-rose-500" : tone === "attention" ? "bg-amber-500" : tone === "ok" ? "bg-emerald-500" : "bg-slate-400";
  const content = (
    <>
      <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-medium text-slate-800">{label}</span>
        <span className="mt-0.5 block truncate text-[11px] text-slate-500">{detail}</span>
      </span>
      {href && <span className="shrink-0 text-[11px] font-medium text-blue-600">去处理</span>}
    </>
  );

  return href ? (
    <Link href={href} className="flex items-start gap-2.5 rounded-lg px-2.5 py-2 transition-colors hover:bg-slate-50">{content}</Link>
  ) : (
    <div className="flex items-start gap-2.5 rounded-lg px-2.5 py-2">{content}</div>
  );
}

export default function SystemStatusBar() {
  const [barState, setBarState] = useState<BarState>("loading");
  const [pendingExceptions, setPendingExceptions] = useState(0);
  const [failedIntegrations, setFailedIntegrations] = useState<IntegrationStatus[]>([]);
  const [setupIntegrations, setSetupIntegrations] = useState<IntegrationStatus[]>([]);
  const [infraIssues, setInfraIssues] = useState<string[]>([]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [checking, setChecking] = useState(false);

  const load = useCallback(() => {
    setChecking(true);
    Promise.all([getOverview(), getSystemHealth()])
      .then(([overview, health]) => {
        const failed = overview.integrations.filter((item) => HARD_FAILURES.has(item.status));
        const setup = overview.integrations.filter((item) => NEEDS_SETUP.has(item.status));
        const down = Object.entries(health.components)
          .filter(([, status]) => status !== "up")
          .map(([name]) => COMPONENT_LABEL[name] ?? name);
        setPendingExceptions(overview.pendingExceptions ?? 0);
        setFailedIntegrations(failed);
        setSetupIntegrations(setup);
        setInfraIssues(down);
        setBarState(overview.pendingExceptions > 0 || failed.length > 0 || down.length > 0 ? "error" : setup.length > 0 ? "attention" : "ok");
      })
      .catch(() => {
        setPendingExceptions(0);
        setFailedIntegrations([]);
        setSetupIntegrations([]);
        setInfraIssues([]);
        setBarState("error");
      })
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!detailsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDetailsOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [detailsOpen]);

  const hasError = pendingExceptions > 0 || failedIntegrations.length > 0 || infraIssues.length > 0;
  const hasDetails = hasError || setupIntegrations.length > 0 || barState === "error";
  const summary = barState === "loading"
    ? "正在检查状态…"
    : barState === "error"
      ? hasError
        ? pendingExceptions > 0 ? `有 ${pendingExceptions} 项需要关注` : "有连接需要处理"
        : "状态检查暂时失败"
      : barState === "attention"
        ? `还有 ${setupIntegrations.length} 项待确认`
        : "运行正常";
  const detailRows = [
    pendingExceptions > 0 ? { tone: "error" as const, label: "待处理事项", detail: `${pendingExceptions} 条异常记录需要确认`, href: "/exceptions" } : null,
    failedIntegrations.length > 0 ? { tone: "error" as const, label: "连接状态", detail: failedIntegrations.map(integrationLabel).join("、"), href: "/settings" } : null,
    infraIssues.length > 0 ? { tone: "error" as const, label: "基础服务", detail: `${infraIssues.join("、")}暂时不可用` } : null,
    setupIntegrations.length > 0 ? { tone: "attention" as const, label: "连接待确认", detail: setupIntegrations.map(integrationLabel).join("、"), href: "/settings" } : null,
    !hasError && barState === "error" ? { tone: "error" as const, label: "状态检查", detail: "暂时无法读取最新状态，请稍后再试" } : null,
  ].filter(Boolean) as Array<{ tone: StatusTone; label: string; detail: string; href?: string }>;

  return (
    <div className="absolute inset-x-3 bottom-[86px] z-dropdown" role="status" aria-live="polite">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => hasDetails && setDetailsOpen((open) => !open)}
          aria-expanded={hasDetails ? detailsOpen : undefined}
          aria-haspopup={hasDetails ? "dialog" : undefined}
          className={`group flex min-w-0 flex-1 items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ${launcherTone(barState)} ${hasDetails ? "cursor-pointer" : "cursor-default"}`}
        >
          <span className={`relative flex h-2.5 w-2.5 shrink-0 rounded-full ${dotTone(barState)} ${barState === "error" ? "shadow-[0_0_0_3px_rgba(251,113,133,.12)]" : ""}`} aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-medium text-slate-100">系统提醒</span>
            <span className="block truncate text-[10px] text-slate-300">{summary}</span>
          </span>
          {pendingExceptions > 0 && <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-rose-400/20 px-1.5 text-[10px] font-semibold text-rose-100">{pendingExceptions}</span>}
          {hasDetails && <ChevronIcon open={detailsOpen} />}
        </button>
        <button type="button" onClick={load} disabled={checking} aria-label="重新检查系统状态" title="重新检查" className="flex h-9 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-300 transition-colors hover:bg-white/10 disabled:cursor-wait disabled:opacity-60">
          <RefreshIcon spinning={checking} />
        </button>
      </div>

      {detailsOpen && hasDetails && (
        <div className="absolute bottom-[calc(100%+8px)] left-0 w-[min(360px,calc(100vw-1rem))] rounded-xl border border-slate-200 bg-white p-2 shadow-[0_14px_36px_rgba(15,23,42,0.2)]" role="dialog" aria-label="系统提醒详情">
          <div className="flex items-start justify-between gap-3 px-2.5 pb-1.5 pt-1">
            <div>
              <p className="text-[12px] font-semibold text-slate-800">需要你关注</p>
              <p className="mt-0.5 text-[11px] text-slate-400">处理后会自动重新检查状态</p>
            </div>
            <button type="button" onClick={() => setDetailsOpen(false)} aria-label="关闭系统提醒详情" className="rounded-md p-1 text-slate-400 hover:bg-slate-50 hover:text-slate-600">×</button>
          </div>
          <div className="border-t border-slate-100 pt-1">
            {detailRows.map((row) => <DetailRow key={`${row.label}-${row.detail}`} {...row} />)}
          </div>
        </div>
      )}
    </div>
  );
}
