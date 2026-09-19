"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  systemUpdateApi,
  type SystemUpdateMode,
  type SystemUpdateSettings,
  type SystemUpdateStatus,
  type SystemUpdateReadiness,
} from "@/lib/api";

const PHASE_LABEL: Record<string, string> = {
  idle: "待命",
  checking: "检查更新",
  queued: "已排队",
  preflight: "预检查",
  backup: "备份",
  quiescing: "暂停后台任务",
  installing: "安装更新",
  migrating: "数据库迁移",
  building: "构建前端",
  restarting: "重启服务",
  healthcheck: "健康检查",
  rollback: "自动回滚",
  success: "更新完成",
  rolled_back: "已自动回滚",
  failed: "更新失败",
};

const MODE_COPY: Record<SystemUpdateMode, { title: string; desc: string }> = {
  manual: {
    title: "手动更新",
    desc: "不后台检查；需要你点击“检查更新”，确认后再安装。",
  },
  auto_download: {
    title: "自动检测 + 下载",
    desc: "推荐。后台定时从 GitHub 下载最新代码对象，但不自动部署；你点击“立即更新”后才会重启系统。",
  },
  auto_update: {
    title: "全自动更新",
    desc: "后台检测到新版本后，在设定的凌晨维护窗口自动备份、更新、迁移、构建、重启并做健康检查；失败自动回滚。",
  },
};

function fmtDate(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("zh-CN", { hour12: false });
}

function shortSha(value?: string | null) {
  return value ? value.slice(0, 10) : "—";
}

function statusTone(status: SystemUpdateStatus) {
  if (status.phase === "success") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status.phase === "rolled_back") return "border-amber-200 bg-amber-50 text-amber-800";
  if (status.phase === "failed" || status.lastCheckError) return "border-red-200 bg-red-50 text-red-700";
  if (status.updateAvailable) return "border-blue-200 bg-blue-50 text-blue-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

export default function SystemUpdatePage() {
  const [status, setStatus] = useState<SystemUpdateStatus | null>(null);
  const [readiness, setReadiness] = useState<SystemUpdateReadiness | null>(null);
  const [draft, setDraft] = useState<SystemUpdateSettings | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [showAllChecks, setShowAllChecks] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await systemUpdateApi.status();
      setStatus(next);
      setDraft((current) => current ?? next.settings);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  const loadReadiness = useCallback(async () => {
    try {
      setReadiness(await systemUpdateApi.readiness());
    } catch {
      setReadiness(null);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadReadiness();
  }, [load, loadReadiness]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void load();
    }, status?.running ? 2000 : 12000);
    return () => window.clearInterval(timer);
  }, [load, status?.running]);

  useEffect(() => {
    if (status && !status.running) void loadReadiness();
  }, [loadReadiness, status?.running]);

  const changedCount = status?.changes?.length ?? 0;
  const progress = Math.max(0, Math.min(100, status?.progress ?? 0));
  const readinessIssues = (readiness?.checks ?? []).filter((item) => item.status !== "ok");
  const displayedChecks = showAllChecks ? (readiness?.checks ?? []) : readinessIssues;
  const readinessTotal = readiness?.checks?.length ?? 0;
  const updateModeLabel = draft ? MODE_COPY[draft.mode].title : "—";
  const installDisabled = Boolean(
    busy
      || status?.running
      || !status?.updateAvailable
      || status?.dirty
      || status?.diverged
      || !readiness
      || !readiness.ready
  );

  const saveChanged = useMemo(() => {
    if (!status || !draft) return false;
    const source = status.settings;
    return (
      source.enabled !== draft.enabled
      || source.mode !== draft.mode
      || source.checkIntervalMinutes !== draft.checkIntervalMinutes
      || source.autoUpdateHour !== draft.autoUpdateHour
      || source.autoUpdateWindowMinutes !== draft.autoUpdateWindowMinutes
    );
  }, [draft, status]);

  async function checkNow() {
    setBusy("check");
    setError("");
    try {
      const next = await systemUpdateApi.check();
      setStatus(next);
      setDraft(next.settings);
      await loadReadiness();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy("");
    }
  }

  async function saveSettings() {
    if (!draft) return;
    setBusy("save");
    setError("");
    try {
      const result = await systemUpdateApi.saveSettings({
        enabled: draft.enabled,
        mode: draft.mode,
        checkIntervalMinutes: draft.checkIntervalMinutes,
        autoUpdateHour: draft.autoUpdateHour,
        autoUpdateWindowMinutes: draft.autoUpdateWindowMinutes,
      });
      setDraft(result.settings);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy("");
    }
  }

  async function applyUpdate() {
    if (!window.confirm("更新会先自动备份，然后构建并重启系统。更新期间页面会短暂断开，失败会自动回滚。确认立即更新？")) return;
    setBusy("apply");
    setError("");
    try {
      const next = await systemUpdateApi.apply();
      setStatus(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy("");
    }
  }

  if (!status || !draft) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          {error ? `系统更新中心加载失败：${error}` : "正在读取系统版本…"}
        </div>
      </div>
    );
  }

  return (
    <div className="pb-8">
      <header className="app-page-header -mx-1 pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="mb-1 text-xs text-slate-400">
              <Link href="/settings" className="hover:text-indigo-600">系统设置</Link>
              <span className="mx-1.5">/</span>
              系统更新
            </div>
            <h1 className="text-xl font-semibold text-slate-900">系统更新</h1>
            <p className="mt-1 text-sm text-slate-500">检查版本、确认环境，再决定是否安装。正常状态保持简洁，只有异常才重点提示。</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void checkNow()}
              disabled={Boolean(busy || status.running)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {busy === "check" ? "检查中…" : "检查更新"}
            </button>
            <button
              type="button"
              onClick={() => void applyUpdate()}
              disabled={installDisabled}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {status.running ? "更新进行中…" : busy === "apply" ? "启动中…" : "立即更新"}
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <section className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className={`flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 ${statusTone(status)}`}>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">{status.message || PHASE_LABEL[status.phase || "idle"] || "系统更新"}</span>
              <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-medium">
                {PHASE_LABEL[status.phase || "idle"] || status.phase || "待命"}
              </span>
              {status.updateAvailable && <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-medium text-white">有新版本</span>}
            </div>
            <div className="mt-1 text-[11px] opacity-75">最后检查 {fmtDate(status.lastCheckAt)} · {status.settings.remote}/{status.settings.branch}</div>
          </div>
          {status.phase === "success" && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg border border-emerald-300 bg-white/70 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-white"
            >
              刷新进入新版
            </button>
          )}
        </div>

        {(status.running || progress > 0) && (
          <div className="h-1 bg-slate-100">
            <div className="h-full bg-indigo-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
        )}

        <div className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
          <div className="px-4 py-3">
            <div className="text-[10px] text-slate-400">当前版本</div>
            <div className="mt-1 font-mono text-sm font-semibold text-slate-800">{shortSha(status.currentSha)}</div>
            <div className="mt-0.5 truncate text-[10px] text-slate-400">{status.currentCommit?.subject || "—"}</div>
          </div>
          <div className="px-4 py-3">
            <div className="text-[10px] text-slate-400">GitHub 版本</div>
            <div className={`mt-1 font-mono text-sm font-semibold ${status.updateAvailable ? "text-blue-700" : "text-slate-800"}`}>{shortSha(status.latestSha)}</div>
            <div className="mt-0.5 truncate text-[10px] text-slate-400">{status.latestCommit?.subject || "点击“检查更新”获取"}</div>
          </div>
          <div className="px-4 py-3">
            <div className="text-[10px] text-slate-400">环境自检</div>
            <div className={`mt-1 text-sm font-semibold ${readiness?.ready ? "text-emerald-700" : readiness ? "text-red-700" : "text-slate-600"}`}>
              {readiness ? (readiness.ready ? "可以更新" : `${readiness.blockingCount} 项阻塞`) : "检查中…"}
            </div>
            <div className="mt-0.5 text-[10px] text-slate-400">{readiness ? `${readinessTotal} 项检查 · ${readiness.warningCount} 项提醒` : "正在读取运行环境"}</div>
          </div>
          <div className="px-4 py-3">
            <div className="text-[10px] text-slate-400">更新方式</div>
            <div className="mt-1 text-sm font-semibold text-slate-800">{updateModeLabel}</div>
            <div className="mt-0.5 text-[10px] text-slate-400">{draft.enabled ? `后台每 ${draft.checkIntervalMinutes} 分钟检查` : "后台自动检查已关闭"}</div>
          </div>
        </div>
      </section>

      {(status.dirty || status.diverged || status.lastCheckError || status.lastAutoError || (readiness && !readiness.ready)) && (
        <section className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
          {readiness && !readiness.ready && <div>⚠ 当前环境还有 {readiness.blockingCount} 项阻塞，处理完成前不能安装更新。</div>}
          {status.dirty && <div>⚠ 项目存在未提交修改，系统不会自动覆盖。</div>}
          {status.diverged && <div>⚠ 本地与远端 Git 历史已分叉，需要先人工处理。</div>}
          {status.lastCheckError && <div>⚠ 最近检查失败：{status.lastCheckError}</div>}
          {status.lastAutoError && <div>⚠ 自动任务：{status.lastAutoError}</div>}
        </section>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <section className="rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">更新内容</div>
              <div className="mt-0.5 text-[10px] text-slate-400">
                {status.updateAvailable ? `最近 ${changedCount} 条待安装提交` : "当前没有待安装的新版本"}
              </div>
            </div>
            {status.updateAvailable ? (
              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-medium text-blue-700">可更新</span>
            ) : (
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-medium text-emerald-700">已是最新</span>
            )}
          </div>
          <div className="max-h-72 overflow-y-auto px-4">
            {(status.changes ?? []).map((item) => (
              <div key={item.sha} className="grid grid-cols-[76px_minmax(0,1fr)_auto] items-center gap-3 border-b border-slate-100 py-2.5 last:border-b-0">
                <span className="font-mono text-[10px] text-slate-400">{item.shortSha}</span>
                <span className="min-w-0 truncate text-xs text-slate-700">{item.subject}</span>
                <span className="hidden text-[10px] text-slate-400 sm:block">{fmtDate(item.committedAt)}</span>
              </div>
            ))}
            {(status.changes ?? []).length === 0 && (
              <div className="flex min-h-28 items-center justify-center text-xs text-slate-400">暂无待安装更新内容</div>
            )}
          </div>
          {status.lastInstallResult && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5">
              <span className="text-[10px] text-slate-400">
                上次安装 {fmtDate(status.lastInstallAt)} · {shortSha(status.lastInstallFromSha)} → {shortSha(status.lastInstallToSha)}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                status.lastInstallResult === "success"
                  ? "bg-emerald-50 text-emerald-700"
                  : status.lastInstallResult === "rolled_back"
                    ? "bg-amber-50 text-amber-700"
                    : "bg-red-50 text-red-700"
              }`}>
                {status.lastInstallResult === "success" ? "安装成功" : status.lastInstallResult === "rolled_back" ? "失败后已回滚" : "安装失败"}
              </span>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">更新策略</div>
              <p className="mt-1 text-[10px] leading-4 text-slate-400">手工检查始终可用；这里仅控制后台检查和自动安装。</p>
            </div>
            <label className="flex items-center gap-2 text-[11px] text-slate-600">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
              />
              后台检查
            </label>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            {(Object.keys(MODE_COPY) as SystemUpdateMode[]).map((mode) => {
              const active = draft.mode === mode;
              const compactTitle = mode === "auto_download" ? "自动检测" : mode === "auto_update" ? "全自动" : "手动";
              return (
                <button
                  type="button"
                  key={mode}
                  onClick={() => setDraft({ ...draft, mode })}
                  className={`rounded-lg border px-2 py-2 text-center transition ${active ? "border-indigo-300 bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
                  title={MODE_COPY[mode].desc}
                >
                  <span className="block text-[11px] font-medium">{compactTitle}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 min-h-8 text-[10px] leading-4 text-slate-400">{MODE_COPY[draft.mode].desc}</p>

          <div className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3">
            <label className="text-[11px] text-slate-600">
              检查间隔
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="number"
                  min={5}
                  max={1440}
                  value={draft.checkIntervalMinutes}
                  onChange={(event) => setDraft({ ...draft, checkIntervalMinutes: Number(event.target.value || 10) })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-indigo-400"
                />
                <span className="shrink-0 text-[10px] text-slate-400">分钟</span>
              </div>
            </label>

            {draft.mode === "auto_update" ? (
              <label className="text-[11px] text-slate-600">
                自动更新
                <select
                  value={draft.autoUpdateHour}
                  onChange={(event) => setDraft({ ...draft, autoUpdateHour: Number(event.target.value) })}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
                >
                  {Array.from({ length: 24 }, (_, hour) => (
                    <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00 开始</option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="text-[11px] text-slate-600">
                代码来源
                <div className="mt-1 truncate rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">{draft.remote}/{draft.branch}</div>
              </div>
            )}
          </div>

          {draft.mode === "auto_update" && (
            <label className="mt-3 block text-[11px] text-slate-600">
              维护窗口
              <select
                value={draft.autoUpdateWindowMinutes}
                onChange={(event) => setDraft({ ...draft, autoUpdateWindowMinutes: Number(event.target.value) })}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
              >
                <option value={30}>30 分钟</option>
                <option value={60}>60 分钟</option>
                <option value={120}>120 分钟</option>
                <option value={180}>180 分钟</option>
              </select>
            </label>
          )}

          <button
            type="button"
            onClick={() => void saveSettings()}
            disabled={!saveChanged || busy === "save"}
            className="mt-4 w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-40"
          >
            {busy === "save" ? "保存中…" : saveChanged ? "保存更新策略" : "策略已保存"}
          </button>
        </section>
      </div>

      <section className="mt-4 rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-900">更新环境自检</span>
              {readiness && (
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${readiness.ready ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                  {readiness.ready ? "已就绪" : `${readiness.blockingCount} 项阻塞`}
                </span>
              )}
            </div>
            <div className="mt-0.5 text-[10px] text-slate-400">
              {readiness
                ? readinessIssues.length > 0
                  ? `优先显示 ${readinessIssues.length} 项需要关注的检查`
                  : `全部 ${readinessTotal} 项通过，无需逐项查看`
                : "正在读取运行环境…"}
            </div>
          </div>
          {readiness && readinessTotal > 0 && (
            <button
              type="button"
              onClick={() => setShowAllChecks((value) => !value)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] text-slate-600 hover:bg-slate-50"
            >
              {showAllChecks ? "只看异常" : `查看全部 ${readinessTotal} 项`}
            </button>
          )}
        </div>

        {readiness && displayedChecks.length > 0 ? (
          <div className="grid gap-px border-t border-slate-100 bg-slate-100 md:grid-cols-2">
            {displayedChecks.map((item) => (
              <div key={item.key} className="flex min-w-0 items-start gap-2 bg-white px-4 py-3">
                <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${
                  item.status === "ok"
                    ? "bg-emerald-50 text-emerald-700"
                    : item.status === "warn"
                      ? "bg-amber-50 text-amber-700"
                      : "bg-red-50 text-red-700"
                }`}>
                  {item.status === "ok" ? "✓" : item.status === "warn" ? "!" : "×"}
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-medium text-slate-700">{item.label}</div>
                  <div className="mt-0.5 break-all text-[10px] leading-4 text-slate-400">{item.detail}</div>
                </div>
              </div>
            ))}
          </div>
        ) : readiness ? (
          <div className="border-t border-slate-100 px-4 py-3 text-[11px] text-emerald-700">✓ 当前没有需要处理的环境问题。</div>
        ) : null}
      </section>

      <div className="mt-4 grid gap-3 xl:grid-cols-2">
        <details className="rounded-xl border border-slate-200 bg-white">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-slate-900">更新过程日志 <span className="ml-1 text-[10px] font-normal text-slate-400">最近 120 行</span></summary>
          <div className="mx-4 mb-4 max-h-80 overflow-auto rounded-lg bg-slate-950 p-3 font-mono text-[10px] leading-5 text-slate-200">
            {(status.logs ?? []).length > 0
              ? status.logs!.map((line, index) => <div key={index}>{line}</div>)
              : <div className="text-slate-500">尚无更新执行日志。</div>}
          </div>
        </details>

        <details className="rounded-xl border border-slate-200 bg-white">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-slate-900">更新历史 <span className="ml-1 text-[10px] font-normal text-slate-400">{status.history?.length ?? 0} 条</span></summary>
          <div className="mx-4 mb-4 max-h-80 overflow-y-auto">
            {(status.history ?? []).map((row, index) => (
              <div key={`${row.at}-${index}`} className="border-b border-slate-100 py-2.5 last:border-b-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-medium text-slate-700">{row.message}</div>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] ${row.result === "success" ? "bg-emerald-50 text-emerald-700" : row.result === "rolled_back" ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-600"}`}>
                    {row.result === "success" ? "成功" : row.result === "rolled_back" ? "已回滚" : "失败"}
                  </span>
                </div>
                <div className="mt-1 text-[10px] text-slate-400">{fmtDate(row.at)} · {shortSha(row.fromSha)} → {shortSha(row.toSha)} · {row.actor}</div>
                {row.error && <div className="mt-1 text-[10px] text-red-500">{row.error}</div>}
              </div>
            ))}
            {(status.history ?? []).length === 0 && <div className="py-8 text-center text-xs text-slate-400">暂无更新记录</div>}
          </div>
        </details>
      </div>

      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-[10px] leading-5 text-slate-500">
        安全流程：Git 快进校验 → 环境自检 → 数据备份 → 暂停后台任务 → 切换代码 → 迁移与构建 → 重启 → 健康检查；失败时自动尝试回滚。
      </div>
    </div>
  );
}
