"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  systemUpdateApi,
  type SystemUpdateMode,
  type SystemUpdateLevel,
  type SystemUpdateReadiness,
  type SystemUpdateSettings,
  type SystemUpdateStatus,
} from "@/lib/api";

const MODE_COPY: Record<SystemUpdateMode, { title: string; desc: string }> = {
  manual: {
    title: "手动",
    desc: "只有你点击“检查更新”时才检查；安装始终由你确认。",
  },
  auto_download: {
    title: "自动检查",
    desc: "后台定时检查 GitHub；发现新版本后，只提示你，不会自动安装。",
  },
  auto_update: {
    title: "自动安装",
    desc: "后台定时检查，并只对符合“自动安装范围”的版本在维护窗口内自动更新。",
  },
};

const LEVEL_COPY: Record<SystemUpdateLevel, { label: string; desc: string; tone: string }> = {
  patch: {
    label: "小版本",
    desc: "UI、文案、普通 Bug 与低风险调整；默认允许自动安装。",
    tone: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  },
  feature: {
    label: "功能版本",
    desc: "新功能、数据模型或数据库迁移；默认等待人工确认。",
    tone: "bg-blue-50 text-blue-700 ring-blue-200",
  },
  major: {
    label: "重大版本",
    desc: "部署、安全或应用核心结构变化；默认必须人工确认。",
    tone: "bg-rose-50 text-rose-700 ring-rose-200",
  },
};

const PHASE_LABEL: Record<string, string> = {
  idle: "等待操作",
  checking: "检查 GitHub",
  queued: "准备更新",
  preflight: "更新前检查",
  backup: "备份数据",
  quiescing: "暂停后台任务",
  installing: "安装代码",
  migrating: "升级数据库",
  building: "构建前端",
  restarting: "重启服务",
  healthcheck: "验证新版本",
  rollback: "自动回滚",
  success: "更新完成",
  rolled_back: "已自动回滚",
  failed: "更新失败",
};

function fmtDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function shortSha(value?: string | null) {
  return value ? value.slice(0, 10) : "—";
}

function updateState(status: SystemUpdateStatus) {
  if (status.running) {
    return {
      label: PHASE_LABEL[status.phase || "idle"] || "更新中",
      tone: "bg-blue-50 text-blue-700 ring-blue-200",
    };
  }
  if (status.phase === "rolled_back") {
    return { label: "已回滚", tone: "bg-amber-50 text-amber-700 ring-amber-200" };
  }
  if (status.lastCheckError || status.lastAutoError || status.phase === "failed") {
    return { label: "需要处理", tone: "bg-rose-50 text-rose-700 ring-rose-200" };
  }
  if (status.updateAvailable) {
    return { label: "有新版本", tone: "bg-amber-50 text-amber-700 ring-amber-200" };
  }
  return { label: "已是最新", tone: "bg-emerald-50 text-emerald-700 ring-emerald-200" };
}

function blockerReason(
  status: SystemUpdateStatus,
  readiness: SystemUpdateReadiness | null,
  busy: string,
  isContainer: boolean,
) {
  if (isContainer) return "当前为容器托管模式，版本通过 GitHub / GHCR 发布。";
  if (busy) return "正在执行其他更新操作。";
  if (status.running) return "更新正在执行。";
  if (status.dirty) return "本地存在未提交修改，为避免覆盖，已禁止自动更新。";
  if (status.diverged) return "本地与远端分支已经分叉，需要先人工处理 Git 历史。";
  if (readiness && !readiness.ready) return `环境自检有 ${readiness.blockingCount} 项阻塞，请先处理。`;
  if (!status.updateAvailable) return "当前没有待安装的新版本。";
  return "";
}

export default function SystemUpdatePage() {
  const [status, setStatus] = useState<SystemUpdateStatus | null>(null);
  const [readiness, setReadiness] = useState<SystemUpdateReadiness | null>(null);
  const [draft, setDraft] = useState<SystemUpdateSettings | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showAllChecks, setShowAllChecks] = useState(false);
  const firstCheckRef = useRef(false);
  const sawRunningRef = useRef(false);
  const reloadScheduledRef = useRef(false);

  const load = useCallback(async (preserveDraft = false) => {
    try {
      const next = await systemUpdateApi.status();
      setStatus(next);
      if (!preserveDraft) setDraft(next.settings);
      const activeError =
        next.lastCheckError ||
        next.lastAutoError ||
        (next.phase === "failed" ? next.error || "" : "");
      setError(activeError);
      return next;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      return null;
    }
  }, []);

  const loadReadiness = useCallback(async () => {
    try {
      const next = await systemUpdateApi.readiness();
      setReadiness(next);
      return next;
    } catch (caught) {
      setReadiness(null);
      setError((current) => current || (caught instanceof Error ? caught.message : String(caught)));
      return null;
    }
  }, []);

  useEffect(() => {
    void Promise.all([load(), loadReadiness()]);
  }, [load, loadReadiness]);

  useEffect(() => {
    if (!status?.running) return;
    sawRunningRef.current = true;
    const timer = window.setInterval(() => void load(true), 1800);
    return () => window.clearInterval(timer);
  }, [load, status?.running]);

  useEffect(() => {
    if (
      !status
      || status.running
      || status.phase !== "success"
      || !sawRunningRef.current
      || reloadScheduledRef.current
    ) return;

    reloadScheduledRef.current = true;
    setNotice("更新完成，正在重新载入最新页面…");
    const timer = window.setTimeout(() => window.location.reload(), 1400);
    return () => window.clearTimeout(timer);
  }, [status]);

  const runtime = status?.runtime;
  const isContainer = runtime?.deploymentMode === "container";

  useEffect(() => {
    if (!status || isContainer || firstCheckRef.current) return;
    firstCheckRef.current = true;
    if (status.lastCheckAt) return;

    void (async () => {
      setBusy("check");
      try {
        const next = await systemUpdateApi.check();
        setStatus(next);
        setDraft(next.settings);
        setError(next.lastCheckError || "");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setBusy("");
      }
    })();
  }, [isContainer, status]);

  const checks = readiness?.checks ?? [];
  const issueChecks = checks.filter((item) => item.status !== "ok");
  const displayedChecks = showAllChecks ? checks : issueChecks;
  const saveChanged = useMemo(() => {
    if (!status || !draft) return false;
    const source = status.settings;
    return source.enabled !== draft.enabled
      || source.mode !== draft.mode
      || source.checkIntervalMinutes !== draft.checkIntervalMinutes
      || source.autoUpdateHour !== draft.autoUpdateHour
      || source.autoUpdateWindowMinutes !== draft.autoUpdateWindowMinutes
      || source.autoInstallLevel !== draft.autoInstallLevel;
  }, [draft, status]);

  async function refreshRuntime() {
    setBusy("refresh");
    setError("");
    setNotice("");
    try {
      await Promise.all([load(), loadReadiness()]);
    } finally {
      setBusy("");
    }
  }

  async function checkNow() {
    setBusy("check");
    setError("");
    setNotice("");
    try {
      const next = await systemUpdateApi.check();
      setStatus(next);
      setDraft(next.settings);
      setError(next.lastCheckError || "");
      setNotice(
        next.lastCheckError
          ? ""
          : next.updateAvailable
            ? `发现 ${next.changes?.length || 1} 项更新，可以直接点击“立即更新”。`
            : "检查完成，当前已经是最新版本。",
      );
      await loadReadiness();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy("");
    }
  }

  async function applyUpdate() {
    if (!window.confirm("系统会先自动备份数据库和业务文件，再安装更新、升级数据库、重建前端并重启服务。失败会自动尝试回滚。确认开始？")) {
      return;
    }
    setBusy("apply");
    setError("");
    setNotice("");
    sawRunningRef.current = true;
    try {
      const next = await systemUpdateApi.apply();
      setStatus(next);
      if (next.started === false) {
        sawRunningRef.current = false;
        setNotice("当前已经是最新版本，无需安装。");
      } else {
        setNotice("更新任务已启动。页面会持续显示进度，完成后自动载入新版。");
      }
    } catch (caught) {
      sawRunningRef.current = false;
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy("");
    }
  }

  async function saveSettings() {
    if (!draft) return;
    setBusy("save");
    setError("");
    setNotice("");
    try {
      const result = await systemUpdateApi.saveSettings({
        enabled: draft.enabled,
        mode: draft.mode,
        checkIntervalMinutes: draft.checkIntervalMinutes,
        autoUpdateHour: draft.autoUpdateHour,
        autoUpdateWindowMinutes: draft.autoUpdateWindowMinutes,
        autoInstallLevel: draft.autoInstallLevel,
      });
      setDraft(result.settings);
      setNotice("更新策略已保存并立即生效。");
      if (result.settings.enabled && result.settings.mode !== "manual") {
        const next = await systemUpdateApi.check();
        setStatus(next);
        setError(next.lastCheckError || "");
      } else {
        await load();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy("");
    }
  }

  function patchDraft(patch: Partial<SystemUpdateSettings>) {
    setDraft((current) => current ? { ...current, ...patch } : current);
    setNotice("设置已修改，点击“保存更新策略”后生效。");
  }

  if (!status || !draft) {
    return (
      <div className="pb-10">
        <header className="app-page-header -mx-1 pb-4">
          <h1 className="text-xl font-semibold text-slate-900">系统更新</h1>
          <p className="mt-1.5 text-sm text-slate-500">正在读取当前版本和更新状态。</p>
        </header>
        <div className="app-card rounded-xl p-6 text-sm text-slate-500">
          {error ? "系统更新加载失败：" + error : "正在连接更新服务…"}
        </div>
      </div>
    );
  }

  const state = updateState(status);
  const progress = Math.max(0, Math.min(100, Number(status.progress || 0)));
  const currentSha = runtime?.gitSha || status.currentSha || "";
  const targetSha = status.latestSha || status.targetSha || status.downloadedSha || "";
  const changeCount = status.changes?.length || 0;
  const reason = blockerReason(status, readiness, busy, Boolean(isContainer));
  const installDisabled = Boolean(reason);
  const latestSubject = status.latestCommit?.subject || status.changes?.[0]?.subject || "";
  const readinessTone = readiness?.ready ? "text-emerald-700 bg-emerald-50" : "text-rose-700 bg-rose-50";
  const updateLevel = (status.updateLevel || "patch") as SystemUpdateLevel;
  const levelMeta = LEVEL_COPY[updateLevel];
  const autoInstallLevelMeta = LEVEL_COPY[draft.autoInstallLevel || "patch"];

  return (
    <div className="pb-10">
      <header className="app-page-header -mx-1 pb-4">
        <h1 className="text-xl font-semibold text-slate-900">系统更新</h1>
        <p className="mt-1.5 text-sm leading-6 text-slate-500">
          后续版本直接在这里检查和更新。系统会自动备份、升级数据库、重建前端、重启并验证；失败自动尝试回滚。
        </p>
      </header>

      <section className="app-card overflow-hidden rounded-xl">
        <div className="grid xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-medium ring-1 ring-inset ${state.tone}`}>
                {state.label}
              </span>
              {status.updateAvailable && (
                <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-medium ring-1 ring-inset ${levelMeta.tone}`}>
                  {levelMeta.label}
                </span>
              )}
              {!isContainer && (
                <span className="text-[10px] text-slate-400">
                  {status.settings.remote}/{status.settings.branch}
                </span>
              )}
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <VersionPanel
                label="当前版本"
                version={status.currentCommit?.version}
                sha={currentSha}
                note={status.currentCommit?.subject || "当前正在运行的版本"}
              />
              <VersionPanel
                label={status.updateAvailable ? "待更新版本" : "远端版本"}
                version={status.latestCommit?.version}
                sha={targetSha}
                note={latestSubject || (status.updateAvailable ? "已检测到新版本" : "与当前版本一致")}
                emphasis={Boolean(status.updateAvailable)}
              />
            </div>

            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[10px] text-slate-400">
              <span>最后检查：{fmtDate(status.lastCheckAt)}</span>
              {status.updateAvailable && <span>待更新：{changeCount || 1} 项</span>}
              {status.changedFileCount ? <span>文件变化：{status.changedFileCount} 个</span> : null}
              {status.hasMigration && <span className="font-medium text-amber-600">包含数据库迁移</span>}
              {status.lastInstallAt && <span>上次安装：{fmtDate(status.lastInstallAt)}</span>}
            </div>

            {status.updateAvailable && (
              <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-[11px] font-semibold text-slate-700">影响模块</div>
                    <div className="mt-1 text-[9px] text-slate-400">
                      系统按变更文件自动识别；安装仍按整套系统原子更新，避免模块版本不一致。
                    </div>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${status.autoInstallEligible ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                    {status.autoInstallEligible ? "符合自动安装策略" : "等待人工确认"}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(status.impactedModules?.length ? status.impactedModules : ["其他 / 公共代码"]).map((module) => (
                    <span key={module} className="rounded-md bg-white px-2 py-1 text-[10px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                      {module}
                    </span>
                  ))}
                </div>
                {status.classificationReasons?.length ? (
                  <div className="mt-2 text-[9px] leading-4 text-slate-400">
                    判定依据：{status.classificationReasons.join("；")}
                  </div>
                ) : null}
              </div>
            )}

            {status.running && (
              <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/60 p-3">
                <div className="flex items-center justify-between gap-3 text-[11px]">
                  <span className="font-medium text-blue-800">
                    {PHASE_LABEL[status.phase || "idle"] || status.phase || "执行中"}
                  </span>
                  <span className="font-mono text-blue-700">{progress}%</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-blue-100">
                  <div className="h-full rounded-full bg-blue-600 transition-all duration-500" style={{ width: `${progress}%` }} />
                </div>
                <div className="mt-2 text-[10px] text-blue-700">{status.message || "正在执行系统更新…"}</div>
              </div>
            )}
          </div>

          <div className="border-t border-slate-100 bg-slate-50/60 p-5 xl:border-l xl:border-t-0">
            <div className="text-[12px] font-semibold text-slate-800">更新操作</div>
            <p className="mt-1 text-[10px] leading-5 text-slate-500">
              正常使用只需要：检查更新 → 查看内容 → 立即更新。
            </p>

            <div className="mt-4 grid gap-2">
              <button
                type="button"
                onClick={() => void checkNow()}
                disabled={Boolean(busy || status.running || isContainer)}
                className="app-button-secondary h-10 rounded-lg px-4 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-45"
              >
                {busy === "check" ? "正在检查 GitHub…" : "检查更新"}
              </button>
              <button
                type="button"
                onClick={() => void applyUpdate()}
                disabled={installDisabled}
                className="app-button-primary h-11 rounded-lg px-4 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-40"
              >
                {status.running ? "更新进行中…" : busy === "apply" ? "正在启动…" : status.updateAvailable ? "立即更新到最新版本" : "当前已是最新版本"}
              </button>
              <button
                type="button"
                onClick={() => void refreshRuntime()}
                disabled={Boolean(busy)}
                className="rounded-lg px-3 py-2 text-[11px] text-slate-500 hover:bg-white hover:text-slate-800 disabled:opacity-40"
              >
                {busy === "refresh" ? "刷新中…" : "刷新页面状态"}
              </button>
            </div>

            {reason && !status.running && (
              <div className="mt-3 rounded-lg bg-white px-3 py-2 text-[10px] leading-5 text-slate-500">
                {reason}
              </div>
            )}
          </div>
        </div>
      </section>

      {error && (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12px] leading-5 text-rose-700">
          <div className="font-semibold">更新服务需要处理</div>
          <div className="mt-1 break-all">{error}</div>
        </div>
      )}
      {notice && !error && (
        <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-[12px] text-blue-700">
          {notice}
        </div>
      )}

      {!isContainer && (
        <section className="mt-4 app-card rounded-xl">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">更新保护</h2>
            <p className="mt-1 text-[10px] text-slate-400">每次点击“立即更新”都会自动执行，不需要你手工备份或跑命令。</p>
          </div>
          <div className="grid md:grid-cols-4">
            <SafetyCell index="1" title="环境检查" desc="Git、分支、磁盘、依赖与运行服务" />
            <SafetyCell index="2" title="自动备份" desc="PostgreSQL + 业务文件" />
            <SafetyCell index="3" title="安装升级" desc="代码、依赖、数据库迁移、前端构建" />
            <SafetyCell index="4" title="验证 / 回滚" desc="健康检查失败时自动恢复上一版本" last />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
            <div className="flex items-center gap-2 text-[11px] text-slate-600">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${readinessTone}`}>
                {readiness ? (readiness.ready ? "环境可更新" : `${readiness.blockingCount} 项阻塞`) : "正在检查"}
              </span>
              {readiness?.warningCount ? <span className="text-amber-600">{readiness.warningCount} 项提醒</span> : null}
            </div>
            {checks.length > 0 && (
              <button
                type="button"
                onClick={() => setShowAllChecks((value) => !value)}
                className="text-[10px] font-medium text-blue-600 hover:text-blue-700"
              >
                {showAllChecks ? "收起环境明细" : "查看环境明细"}
              </button>
            )}
          </div>
          {showAllChecks && (
            <div className="divide-y divide-slate-100 border-t border-slate-100 px-4">
              {checks.map((item) => (
                <div key={item.key} className="flex items-start justify-between gap-4 py-2.5">
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium text-slate-700">{item.label}</div>
                    <div className="mt-0.5 break-all text-[10px] text-slate-400">{item.detail}</div>
                  </div>
                  <span className={
                    "shrink-0 rounded-full px-2 py-0.5 text-[9px] font-medium " +
                    (item.status === "ok"
                      ? "bg-emerald-50 text-emerald-700"
                      : item.status === "warn"
                        ? "bg-amber-50 text-amber-700"
                        : "bg-rose-50 text-rose-700")
                  }>
                    {item.status === "ok" ? "正常" : item.status === "warn" ? "提醒" : "阻塞"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {!isContainer && status.changes && status.changes.length > 0 && (
        <section className="mt-4 app-card rounded-xl">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">本次更新内容</h2>
              <p className="mt-1 text-[10px] text-slate-400">从当前版本到最新 develop 的提交记录。</p>
            </div>
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-medium text-amber-700">{status.changes.length} 项</span>
          </div>
          <div className="divide-y divide-slate-100 px-4">
            {status.changes.map((item) => (
              <div key={item.sha} className="flex items-start gap-3 py-2.5">
                <span className="mt-0.5 w-[74px] shrink-0 font-mono text-[10px] text-slate-400">{item.shortSha}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-medium text-slate-700">{item.subject}</div>
                  <div className="mt-0.5 text-[9px] text-slate-400">{fmtDate(item.committedAt)}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        {!isContainer ? (
          <section className="app-card rounded-xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">自动更新策略</h2>
                <p className="mt-1 text-[10px] leading-5 text-slate-400">你可以一直保持“自动检查”，需要更新时回来点一次即可。</p>
              </div>
              <label className="flex items-center gap-2 text-[11px] text-slate-600">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(event) => patchDraft({ enabled: event.target.checked })}
                />
                启用
              </label>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              {(Object.keys(MODE_COPY) as SystemUpdateMode[]).map((mode) => {
                const active = draft.mode === mode;
                return (
                  <button
                    type="button"
                    key={mode}
                    onClick={() => patchDraft({ mode })}
                    className={
                      "rounded-lg border px-2 py-2.5 text-center transition " +
                      (active
                        ? "border-blue-300 bg-blue-50 text-blue-700"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50")
                    }
                  >
                    <span className="block text-[11px] font-semibold">{MODE_COPY[mode].title}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-2 min-h-[42px] rounded-lg bg-slate-50 px-3 py-2 text-[10px] leading-5 text-slate-500">
              {MODE_COPY[draft.mode].desc}
            </div>

            <div className="mt-3 rounded-xl border border-slate-100 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold text-slate-700">自动安装范围</div>
                  <div className="mt-0.5 text-[9px] leading-4 text-slate-400">
                    当前：{autoInstallLevelMeta.label}及以下。建议保持“小版本”，功能版本与重大版本由你确认。
                  </div>
                </div>
                <select
                  value={draft.autoInstallLevel}
                  onChange={(event) => patchDraft({ autoInstallLevel: event.target.value as SystemUpdateLevel })}
                  className="app-input-control h-9 rounded-lg px-3 text-[11px]"
                  disabled={draft.mode !== "auto_update"}
                >
                  <option value="patch">仅小版本自动安装</option>
                  <option value="feature">小版本 + 功能版本</option>
                  <option value="major">所有版本</option>
                </select>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {(Object.keys(LEVEL_COPY) as SystemUpdateLevel[]).map((level) => {
                  const meta = LEVEL_COPY[level];
                  const auto = ["patch", "feature", "major"].indexOf(level) <= ["patch", "feature", "major"].indexOf(draft.autoInstallLevel);
                  return (
                    <div key={level} className="rounded-lg bg-slate-50 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-semibold text-slate-700">{meta.label}</span>
                        <span className={"text-[9px] " + (draft.mode === "auto_update" && auto ? "text-emerald-600" : "text-slate-400")}>
                          {draft.mode === "auto_update" && auto ? "自动安装" : "人工确认"}
                        </span>
                      </div>
                      <div className="mt-1 text-[9px] leading-4 text-slate-400">{meta.desc}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className="text-[10px] text-slate-500">
                检查间隔
                <div className="mt-1 flex items-center gap-1.5">
                  <input
                    type="number"
                    min={5}
                    max={1440}
                    value={draft.checkIntervalMinutes}
                    onChange={(event) => patchDraft({ checkIntervalMinutes: Number(event.target.value || 10) })}
                    className="app-input-control w-full rounded-lg px-3 py-2 text-xs"
                  />
                  <span className="shrink-0">分钟</span>
                </div>
              </label>
              <label className="text-[10px] text-slate-500">
                自动安装时间
                <div className="mt-1 flex items-center gap-1.5">
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={draft.autoUpdateHour}
                    onChange={(event) => patchDraft({ autoUpdateHour: Number(event.target.value || 0) })}
                    className="app-input-control w-full rounded-lg px-3 py-2 text-xs"
                  />
                  <span className="shrink-0">点</span>
                </div>
              </label>
              <label className="text-[10px] text-slate-500">
                维护窗口
                <div className="mt-1 flex items-center gap-1.5">
                  <input
                    type="number"
                    min={15}
                    max={360}
                    value={draft.autoUpdateWindowMinutes}
                    onChange={(event) => patchDraft({ autoUpdateWindowMinutes: Number(event.target.value || 60) })}
                    className="app-input-control w-full rounded-lg px-3 py-2 text-xs"
                  />
                  <span className="shrink-0">分钟</span>
                </div>
              </label>
            </div>

            <button
              type="button"
              onClick={() => void saveSettings()}
              disabled={!saveChanged || Boolean(busy)}
              className="app-button-primary mt-4 w-full rounded-lg px-3 py-2.5 text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy === "save" ? "保存中…" : saveChanged ? "保存更新策略" : "更新策略已保存"}
            </button>
          </section>
        ) : (
          <section className="app-card rounded-xl p-4">
            <h2 className="text-sm font-semibold text-slate-900">容器发布模式</h2>
            <p className="mt-2 text-[10px] leading-5 text-slate-500">
              当前环境由 GitHub / GHCR / Compose 管理，不允许应用内直接 git 更新。
            </p>
          </section>
        )}

        <section className="app-card rounded-xl">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">最近更新记录</h2>
            <p className="mt-1 text-[10px] text-slate-400">保留成功、失败与自动回滚记录，便于后续排查。</p>
          </div>
          <div className="divide-y divide-slate-100 px-4">
            {(status.history || []).slice(0, 8).map((item, index) => (
              <div key={item.at + index} className="py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className={
                    "text-[11px] font-medium " +
                    (item.result === "success"
                      ? "text-emerald-700"
                      : item.result === "rolled_back"
                        ? "text-amber-700"
                        : "text-rose-700")
                  }>
                    {item.message}
                  </span>
                  <span className="shrink-0 text-[9px] text-slate-400">{fmtDate(item.at)}</span>
                </div>
                <div className="mt-1 font-mono text-[9px] text-slate-400">
                  {shortSha(item.fromSha)} → {shortSha(item.toSha)} · {item.actor}
                </div>
                {item.error && <div className="mt-1 text-[10px] text-rose-600">{item.error}</div>}
              </div>
            ))}
            {(!status.history || status.history.length === 0) && (
              <div className="py-10 text-center text-xs text-slate-400">还没有更新记录</div>
            )}
          </div>
        </section>
      </div>

      {!isContainer && (status.logs?.length || status.running) ? (
        <section className="mt-4 app-card rounded-xl">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">执行日志</h2>
              <p className="mt-1 text-[10px] text-slate-400">更新过程中自动刷新；出现问题时这里会保留具体原因。</p>
            </div>
            {status.backupDb && <span className="text-[9px] text-slate-400">本次备份已生成</span>}
          </div>
          <pre className="max-h-[340px] overflow-auto whitespace-pre-wrap break-all px-4 py-3 text-[10px] leading-5 text-slate-500">
            {(status.logs || []).join("\n") || "更新任务已启动，等待执行日志…"}
          </pre>
        </section>
      ) : null}
    </div>
  );
}

function VersionPanel({
  label,
  version,
  sha,
  note,
  emphasis = false,
}: {
  label: string;
  version?: string | null;
  sha?: string | null;
  note: string;
  emphasis?: boolean;
}) {
  return (
    <div className={"rounded-xl border p-3 " + (emphasis ? "border-amber-200 bg-amber-50/50" : "border-slate-100 bg-slate-50/60")}>
      <div className="text-[10px] text-slate-400">{label}</div>
      <div className={"mt-1 font-mono text-[15px] font-semibold " + (emphasis ? "text-amber-800" : "text-slate-800")}>
        {version || shortSha(sha)}
      </div>
      <div className="mt-1 flex min-w-0 items-center gap-2 text-[10px] text-slate-500">
        <span className="shrink-0 font-mono text-slate-400">{shortSha(sha)}</span>
        <span className="truncate" title={note}>{note}</span>
      </div>
    </div>
  );
}

function SafetyCell({
  index,
  title,
  desc,
  last = false,
}: {
  index: string;
  title: string;
  desc: string;
  last?: boolean;
}) {
  return (
    <div className={"px-4 py-3 " + (last ? "" : "border-b border-slate-100 md:border-b-0 md:border-r")}>
      <div className="flex items-start gap-2.5">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[9px] font-semibold text-blue-700">
          {index}
        </span>
        <div>
          <div className="text-[11px] font-semibold text-slate-700">{title}</div>
          <div className="mt-0.5 text-[9px] leading-4 text-slate-400">{desc}</div>
        </div>
      </div>
    </div>
  );
}
