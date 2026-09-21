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
  if (readiness && !readiness.ready) {
    const blocker = readiness.checks.find((item) => item.blocking && item.status === "error");
    return blocker
      ? `${blocker.label}：${blocker.detail}`
      : `环境自检有 ${readiness.blockingCount} 项阻塞，请先处理。`;
  }
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
  const [showChangedFiles, setShowChangedFiles] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "strategy" | "logs" | "history">("overview");
  const [autoScrollLogs, setAutoScrollLogs] = useState(true);
  const logRef = useRef<HTMLPreElement | null>(null);
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
    if (activeTab !== "logs" || !autoScrollLogs || !logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [activeTab, autoScrollLogs, status?.logs]);

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
    if (status.lastCheckAt && status.moduleVersions?.length) return;

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
    setNotice("设置已修改，保存后生效。");
  }

  if (!status || !draft) {
    return (
      <div className="pb-10">
        <header className="app-page-header -mx-1 pb-4">
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">系统更新</h1>
          <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-300">正在读取当前版本和更新状态。</p>
        </header>
        <div className="app-card rounded-xl p-6 text-sm text-slate-500 dark:text-slate-300">
          {error ? "系统更新加载失败：" + error : "正在连接更新服务…"}
        </div>
      </div>
    );
  }

  const state = updateState(status);
  const progress = Math.max(0, Math.min(100, Number(status.progress || 0)));
  const currentSha = runtime?.gitSha || status.currentSha || "";
  const targetSha = status.latestSha || status.targetSha || status.downloadedSha || "";
  const reason = blockerReason(status, readiness, busy, Boolean(isContainer));
  const installDisabled = Boolean(reason);
  const latestSubject = status.latestCommit?.subject || status.changes?.[0]?.subject || "";
  const updateLevel = (status.updateLevel || "patch") as SystemUpdateLevel;
  const levelMeta = LEVEL_COPY[updateLevel];
  const autoInstallLevelMeta = LEVEL_COPY[draft.autoInstallLevel || "patch"];
  const visibleChanges = (status.changes || []).slice(0, 6);
  const moduleVersions = status.moduleVersions || [];
  const moduleUpdateCount = moduleVersions.filter((item) => item.status === "update").length;
  const showProgressNumber = status.running || status.phase === "success";

  const phaseStep: Record<string, number> = {
    checking: 0,
    queued: 0,
    preflight: 0,
    backup: 1,
    quiescing: 1,
    installing: 2,
    migrating: 2,
    building: 2,
    restarting: 3,
    healthcheck: 3,
    success: 4,
    rolled_back: 3,
    rollback: 3,
    failed: 3,
  };
  const activeStep = phaseStep[status.phase || "idle"] ?? 0;
  const stageStatus = (index: number): "done" | "active" | "pending" | "error" => {
    if (status.phase === "success" && !status.running) return "done";
    if (status.phase === "failed" && index === activeStep) return "error";
    if (status.phase === "rolled_back" && index === activeStep) return "error";
    if (status.running) {
      if (index < activeStep) return "done";
      if (index === activeStep) return "active";
      return "pending";
    }
    if (index === 0 && readiness?.ready) return "done";
    return "pending";
  };
  const stageMessage = status.running
    ? PHASE_LABEL[status.phase || "idle"] || "更新中"
    : status.phase === "success"
      ? "更新完成"
      : status.updateAvailable
        ? "等待开始"
        : "当前为最新版本";

  return (
    <div className="pb-10 text-slate-900 dark:text-slate-100">
      <header className="app-page-header -mx-1 pb-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600/10 text-blue-600 dark:bg-blue-400/10 dark:text-blue-300">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
              <path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.64 5.64l2.12 2.12m8.48 8.48 2.12 2.12m0-12.72-2.12 2.12m-8.48 8.48-2.12 2.12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <circle cx="12" cy="12" r="3.5" stroke="currentColor" strokeWidth="1.8" />
            </svg>
          </div>
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight text-slate-900 dark:text-slate-100">系统更新</h1>
            <p className="mt-1 text-[13px] leading-6 text-slate-500 dark:text-slate-300">
              版本更新、更新策略、更新日志和历史记录分开管理。
            </p>
          </div>
        </div>
      </header>

      <nav className="mb-4 flex items-center gap-1 border-b border-slate-200 dark:border-slate-700" aria-label="系统更新页签">
        {([
          ["overview", "版本更新"],
          ["strategy", "更新策略"],
          ["logs", "更新日志"],
          ["history", "历史记录"],
        ] as const).map(([key, label]) => (
          <button
            type="button"
            key={key}
            onClick={() => setActiveTab(key)}
            className={`relative px-4 py-2.5 text-[12px] font-medium transition-colors ${
              activeTab === key
                ? "text-blue-600 dark:text-blue-300"
                : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100"
            }`}
          >
            {label}
            {key === "logs" && status.logs?.length ? <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-300">{status.logs.length}</span> : null}
            {activeTab === key && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-blue-600 dark:bg-blue-400" />}
          </button>
        ))}
      </nav>

      {activeTab === "overview" && (
        <>
      <section className="app-card overflow-hidden rounded-2xl">
        <div className="grid xl:grid-cols-[minmax(0,1fr)_280px]">
          <div className="min-w-0 p-5">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset ${state.tone} dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-600`}>
                {state.label}
              </span>
              {status.updateAvailable && (
                <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset ${levelMeta.tone} dark:bg-blue-500/10 dark:text-blue-200 dark:ring-blue-400/40`}>
                  {levelMeta.label}
                </span>
              )}
              {!isContainer && (
                <span className="text-[11px] text-slate-400 dark:text-slate-400">
                  {status.settings.remote}/{status.settings.branch}
                </span>
              )}
            </div>

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(520px,660px)_minmax(0,1fr)]">
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">更新概览</div>
                <div className="mt-1 text-[11px] text-slate-400 dark:text-slate-400">版本信息与影响范围</div>

                {status.updateAvailable ? (
                  <div className="mt-4 grid items-stretch gap-3 sm:grid-cols-[minmax(0,1fr)_32px_minmax(0,1fr)]">
                    <VersionCard
                      label="当前版本"
                      version={status.currentCommit?.version}
                      sha={currentSha}
                      note={status.currentCommit?.subject || "当前正在运行的版本"}
                      tone="current"
                    />
                    <div className="hidden items-center justify-center text-2xl font-light text-blue-500 sm:flex">→</div>
                    <VersionCard
                      label="待更新版本"
                      version={status.latestCommit?.version}
                      sha={targetSha}
                      note={latestSubject || "已检测到新版本"}
                      tone="target"
                    />
                  </div>
                ) : (
                  <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(280px,420px)_minmax(220px,1fr)]">
                    <VersionCard
                      label="当前版本"
                      version={status.currentCommit?.version}
                      sha={currentSha}
                      note={status.currentCommit?.subject || "当前正在运行的版本"}
                      tone="current"
                    />
                    <div className="flex min-h-[104px] items-center rounded-xl border border-emerald-100 bg-emerald-50/60 px-4 dark:border-emerald-500/25 dark:bg-emerald-500/5">
                      <div>
                        <div className="text-[12px] font-semibold text-emerald-700 dark:text-emerald-300">已是最新版本</div>
                        <div className="mt-1 text-[11px] leading-5 text-slate-500 dark:text-slate-300">远端版本与当前运行版本一致，不重复显示第二张版本卡。</div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4 dark:border-slate-700/70">
                  <span className="mr-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300">影响模块</span>
                  {(status.impactedModules?.length ? status.impactedModules : ["公共代码"]).map((module) => (
                    <span key={module} className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:border-slate-600 dark:bg-slate-800/70 dark:text-slate-200">
                      {module}
                    </span>
                  ))}
                  {status.hasMigration && (
                    <span className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                      包含数据库迁移
                    </span>
                  )}
                </div>
              </div>

              <div className="min-w-0 border-t border-slate-100 pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0 dark:border-slate-700/70">
                <div className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">本次更新内容</div>
                <div className="mt-1 text-[11px] text-slate-400 dark:text-slate-400">
                  {status.updateAvailable ? `共 ${status.changes?.length || 1} 项变更` : "当前版本已与远端一致"}
                </div>
                <div className="mt-3 overflow-hidden rounded-xl border border-slate-100 dark:border-slate-700">
                  {visibleChanges.length ? visibleChanges.map((item, index) => (
                    <div key={item.sha} className={`flex items-start gap-3 px-3 py-2.5 ${index ? "border-t border-slate-100 dark:border-slate-700" : ""}`}>
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12px] font-medium text-slate-700 dark:text-slate-100" title={item.subject}>{item.subject}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-400">
                          <span>{fmtDate(item.committedAt)} · {item.shortSha}</span>
                          {(item.modules || []).slice(0, 2).map((module) => (
                            <span key={module} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                              {module}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )) : (
                    <div className="flex min-h-[104px] items-center px-4 py-4 text-[12px] text-slate-400 dark:text-slate-400">
                      当前没有待安装更新。检测到新版本后，这里会直接列出本次改动。
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-slate-400 dark:text-slate-400">
              <span>最后检查：{fmtDate(status.lastCheckAt)}</span>
              {status.changedFileCount ? (
                <button
                  type="button"
                  onClick={() => setShowChangedFiles((value) => !value)}
                  className="font-medium text-blue-600 hover:text-blue-700 dark:text-blue-300"
                >
                  {showChangedFiles ? "收起变更文件" : `查看变更文件 · ${status.changedFileCount}`}
                </button>
              ) : status.updateAvailable ? (
                <span className="font-medium text-amber-600 dark:text-amber-300">已发现新版本，正在重新识别文件差异</span>
              ) : null}
              {status.lastInstallAt && <span>上次安装：{fmtDate(status.lastInstallAt)}</span>}
            </div>

            {showChangedFiles && status.changedFiles?.length ? (
              <div className="mt-3 overflow-hidden rounded-xl border border-slate-100 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-900/30">
                <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 dark:border-slate-700">
                  <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-100">本次变更文件</span>
                  <span className="text-[10px] text-slate-400">{status.changedFiles.length} 个</span>
                </div>
                <div className="max-h-52 overflow-auto py-1">
                  {status.changedFiles.map((file) => (
                    <div
                      key={file}
                      className="border-b border-slate-100/80 px-3 py-1.5 font-mono text-[10px] leading-5 text-slate-500 last:border-b-0 dark:border-slate-700/70 dark:text-slate-300"
                    >
                      {file}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <aside className="border-t border-slate-100 bg-slate-50/70 p-5 xl:border-l xl:border-t-0 dark:border-slate-700 dark:bg-slate-900/35">
            <div className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">更新操作</div>
            <p className="mt-1 text-[11px] leading-5 text-slate-500 dark:text-slate-300">检查新版本并执行系统更新。</p>

            <div className="mt-5 grid gap-3">
              <button
                type="button"
                onClick={() => void checkNow()}
                disabled={Boolean(busy || status.running || isContainer)}
                className="app-button-secondary h-11 rounded-xl px-4 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-45"
              >
                {busy === "check" ? "正在检查…" : "检查更新"}
              </button>
              <button
                type="button"
                onClick={() => void applyUpdate()}
                disabled={installDisabled}
                className="app-button-primary h-12 rounded-xl px-4 text-[13px] font-semibold shadow-sm disabled:cursor-not-allowed disabled:opacity-40"
              >
                {status.running ? "更新进行中…" : busy === "apply" ? "正在启动…" : status.updateAvailable ? "立即更新到最新版本" : "当前已是最新版本"}
              </button>
              <button
                type="button"
                onClick={() => void refreshRuntime()}
                disabled={Boolean(busy)}
                className="app-button-secondary h-11 rounded-xl px-4 text-[12px] font-medium disabled:opacity-40"
              >
                {busy === "refresh" ? "刷新中…" : "刷新状态"}
              </button>
            </div>

            {reason && !status.running && (
              <div className="mt-4 rounded-xl border border-slate-100 bg-white px-3 py-2.5 text-[11px] leading-5 text-slate-500 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
                {reason}
              </div>
            )}
          </aside>
        </div>
      </section>

      {!isContainer && (
        <section className="mt-4 app-card overflow-hidden rounded-2xl">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-700">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">模块版本总览</h2>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                  10 个模块
                </span>
                {moduleUpdateCount > 0 ? (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-200">
                    {moduleUpdateCount} 个有更新
                  </span>
                ) : moduleVersions.length ? (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                    全部已最新
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-400">
                模块版本表示该中心最近一次代码变更所属的平台版本；系统仍按一个总版本统一安装。
              </p>
            </div>
            {status.impactedModules?.includes("平台公共底层") && (
              <span className="rounded-lg border border-blue-100 bg-blue-50 px-2.5 py-1 text-[10px] font-medium text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-200">
                本次涉及平台公共底层
              </span>
            )}
          </div>

          {moduleVersions.length ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {moduleVersions.map((module, index) => {
                const hasUpdate = module.status === "update";
                const tracked = module.status !== "untracked";
                return (
                  <div
                    key={module.key}
                    className={`min-w-0 px-4 py-4 ${
                      index % 5 ? "xl:border-l xl:border-slate-100 dark:xl:border-slate-700" : ""
                    } ${index >= 5 ? "border-t border-slate-100 dark:border-slate-700" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="truncate text-[12px] font-semibold text-slate-800 dark:text-slate-100">{module.label}</div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        hasUpdate
                          ? "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200"
                          : tracked
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                            : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300"
                      }`}>
                        {hasUpdate ? "有更新" : tracked ? "已最新" : "待建立"}
                      </span>
                    </div>

                    <div className="mt-3 flex min-w-0 items-center gap-2">
                      <span className="truncate font-mono text-[12px] font-semibold text-slate-700 dark:text-slate-100">
                        {module.currentVersion || "—"}
                      </span>
                      {hasUpdate && (
                        <>
                          <span className="shrink-0 text-blue-500">→</span>
                          <span className="truncate font-mono text-[12px] font-semibold text-amber-700 dark:text-amber-200">
                            {module.latestVersion || "—"}
                          </span>
                        </>
                      )}
                    </div>

                    <div
                      className="mt-2 truncate text-[10px] leading-5 text-slate-400 dark:text-slate-400"
                      title={hasUpdate ? module.latestSubject : module.currentSubject}
                    >
                      {hasUpdate ? module.latestSubject : module.currentSubject || "尚未识别到模块独立变更"}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="px-5 py-6 text-[12px] text-slate-400 dark:text-slate-400">
              正在生成模块版本信息；如果没有自动刷新，点击右上角“检查更新”即可重新计算。
            </div>
          )}
        </section>
      )}

      {error && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12px] leading-5 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200">
          <div className="font-semibold">更新服务需要处理</div>
          <div className="mt-1 break-all">{error}</div>
        </div>
      )}
      {notice && !error && (
        <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-[12px] text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-200">
          {notice}
        </div>
      )}

      {!isContainer && (
        <section className="mt-4 app-card overflow-hidden rounded-2xl">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-5 py-4 dark:border-slate-700">
            <div>
              <h2 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">更新进度</h2>
              <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-400">
                {status.running ? "正在执行更新任务，请勿关闭页面。" : status.updateAvailable ? "准备完成后点击“立即更新”开始执行。" : "当前没有正在执行的更新任务。"}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3">
              <div className="flex min-w-[280px] items-center gap-3">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                  <div className="h-full rounded-full bg-blue-500 transition-all duration-500" style={{ width: `${status.running ? Math.max(progress, 4) : status.phase === "success" ? 100 : 0}%` }} />
                </div>
                <span className="min-w-11 text-right font-mono text-[14px] font-semibold text-slate-700 dark:text-slate-100">
                  {showProgressNumber ? (status.running ? `${progress}%` : "100%") : "待命"}
                </span>
                <div className="hidden border-l border-slate-200 pl-4 text-right sm:block dark:border-slate-700">
                  <div className="text-[11px] text-slate-400">当前阶段</div>
                  <div className="mt-0.5 text-[12px] font-semibold text-slate-700 dark:text-slate-100">{stageMessage}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab("logs")}
                className="app-button-secondary h-9 rounded-lg px-3 text-[11px] font-medium"
              >
                查看日志{status.logs?.length ? ` · ${status.logs.length}` : ""}
              </button>
            </div>
          </div>

          <div className="grid md:grid-cols-4">
            <UpdateStep index={1} title="环境检查" desc="系统环境、依赖版本" status={stageStatus(0)} time={stageStatus(0) === "done" ? fmtDate(readiness?.checkedAt) : ""} />
            <UpdateStep index={2} title="自动备份" desc="数据库与业务文件" status={stageStatus(1)} time={status.backupDb ? "备份已生成" : ""} />
            <UpdateStep index={3} title="安装升级" desc={status.phase === "building" ? "正在构建前端资源" : "代码、依赖、数据库迁移"} status={stageStatus(2)} time={status.running && activeStep === 2 ? status.message : ""} />
            <UpdateStep index={4} title="验证 / 回滚" desc="健康检查与服务重启" status={stageStatus(3)} time={status.running && activeStep === 3 ? status.message : ""} last />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 dark:border-slate-700">
            <div className="text-[11px] text-slate-500 dark:text-slate-300">
              {readiness ? (readiness.ready ? "环境检查已通过，可以安全更新。" : `环境自检有 ${readiness.blockingCount} 项阻塞。`) : "正在读取环境自检结果…"}
            </div>
            {checks.length > 0 && (
              <button type="button" onClick={() => setShowAllChecks((value) => !value)} className="text-[11px] font-medium text-blue-600 hover:text-blue-700 dark:text-blue-300">
                {showAllChecks ? "收起环境明细" : "查看环境明细"}
              </button>
            )}
          </div>

          {showAllChecks && (
            <div className="grid gap-px border-t border-slate-100 bg-slate-100 sm:grid-cols-2 xl:grid-cols-3 dark:border-slate-700 dark:bg-slate-700">
              {checks.map((item) => (
                <div key={item.key} className="bg-white px-4 py-3 dark:bg-slate-900">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[11px] font-medium text-slate-700 dark:text-slate-100">{item.label}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${item.status === "ok" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : item.status === "warn" ? "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200" : "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-200"}`}>
                      {item.status === "ok" ? "正常" : item.status === "warn" ? "提醒" : "阻塞"}
                    </span>
                  </div>
                  <div className="mt-1 break-all text-[11px] leading-5 text-slate-400 dark:text-slate-400">{item.detail}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}


        </>
      )}

      {activeTab === "strategy" && (
        <section className="app-card rounded-2xl p-5">
          <div className="mb-4">
            <h2 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">更新策略</h2>
            <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-400">非日常设置；调整检查频率、安装方式和自动安装范围。</p>
          </div>
          {!isContainer ? (
            <section className="rounded-xl border border-slate-100 p-4 dark:border-slate-700">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">自动更新策略</h3>
                  <p className="mt-1 text-[11px] leading-5 text-slate-400 dark:text-slate-400">日常建议保持自动检查，安装由你确认。</p>
                </div>
                <label className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                  <input type="checkbox" checked={draft.enabled} onChange={(event) => patchDraft({ enabled: event.target.checked })} />
                  启用
                </label>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2">
                {(Object.keys(MODE_COPY) as SystemUpdateMode[]).map((mode) => (
                  <button
                    type="button"
                    key={mode}
                    onClick={() => patchDraft({ mode })}
                    className={`rounded-lg border px-2 py-2.5 text-center text-[11px] font-semibold transition ${draft.mode === mode ? "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-400/50 dark:bg-blue-500/10 dark:text-blue-200" : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"}`}
                  >
                    {MODE_COPY[mode].title}
                  </button>
                ))}
              </div>
              <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-5 text-slate-500 dark:bg-slate-800/70 dark:text-slate-300">{MODE_COPY[draft.mode].desc}</div>

              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <label className="text-[11px] text-slate-500 dark:text-slate-300">检查间隔
                  <div className="mt-1 flex items-center gap-1.5"><input type="number" min={5} max={1440} value={draft.checkIntervalMinutes} onChange={(event) => patchDraft({ checkIntervalMinutes: Number(event.target.value || 10) })} className="app-input-control w-full rounded-lg px-3 py-2 text-xs" /><span>分钟</span></div>
                </label>
                <label className="text-[11px] text-slate-500 dark:text-slate-300">自动安装时间
                  <div className="mt-1 flex items-center gap-1.5"><input type="number" min={0} max={23} value={draft.autoUpdateHour} onChange={(event) => patchDraft({ autoUpdateHour: Number(event.target.value || 0) })} className="app-input-control w-full rounded-lg px-3 py-2 text-xs" /><span>点</span></div>
                </label>
                <label className="text-[11px] text-slate-500 dark:text-slate-300">自动安装范围
                  <select value={draft.autoInstallLevel} onChange={(event) => patchDraft({ autoInstallLevel: event.target.value as SystemUpdateLevel })} className="app-input-control mt-1 w-full rounded-lg px-3 py-2 text-xs" disabled={draft.mode !== "auto_update"}>
                    <option value="patch">小版本</option><option value="feature">功能版本</option><option value="major">所有版本</option>
                  </select>
                </label>
              </div>

              <div className="mt-3 text-[11px] text-slate-400 dark:text-slate-400">当前自动安装范围：{autoInstallLevelMeta.label}及以下。</div>
              <button type="button" onClick={() => void saveSettings()} disabled={!saveChanged || Boolean(busy)} className="app-button-primary mt-4 w-full rounded-lg px-3 py-2.5 text-[11px] font-medium disabled:opacity-40">
                {busy === "save" ? "保存中…" : saveChanged ? "保存更新策略" : "更新策略已保存"}
              </button>
            </section>
          ) : (
            <div className="rounded-xl border border-slate-100 p-4 text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-300">
              当前为容器托管模式，版本由 GitHub / GHCR / Compose 管理。
            </div>
          )}
        </section>
      )}

      {activeTab === "logs" && (
        <section className="app-card overflow-hidden rounded-2xl">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">更新日志</h2>
                {status.running && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:bg-blue-500/10 dark:text-blue-200">实时更新</span>}
                {status.backupDb && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">已生成备份</span>}
              </div>
              <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-400">一般无需查看；更新失败或排查问题时再进入此页签。</p>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-300">
                <input type="checkbox" checked={autoScrollLogs} onChange={(event) => setAutoScrollLogs(event.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300" />
                自动滚动
              </label>
              <button type="button" onClick={() => void load(true)} className="app-button-secondary h-8 rounded-lg px-2.5 text-[11px] font-medium">刷新</button>
              <button
                type="button"
                onClick={() => {
                  const text = (status.logs || []).join("\n");
                  if (!text) return;
                  void navigator.clipboard.writeText(text).then(
                    () => setNotice("更新日志已复制。"),
                    () => setNotice("复制失败，请手动选择日志内容。"),
                  );
                }}
                disabled={!status.logs?.length}
                className="app-button-secondary h-8 rounded-lg px-2.5 text-[11px] font-medium disabled:opacity-40"
              >
                复制日志
              </button>
            </div>
          </div>
          <div className="flex items-center gap-4 border-b border-slate-200 bg-slate-50/70 px-5 py-3 text-[11px] text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
            <span>{status.logs?.length || 0} 条记录</span>
            <span>当前阶段：<strong className="font-medium text-slate-700 dark:text-slate-100">{stageMessage}</strong></span>
          </div>
          <pre ref={logRef} className="min-h-[420px] max-h-[68vh] overflow-auto whitespace-pre-wrap break-all bg-slate-950 px-5 py-4 font-mono text-[11px] leading-6 text-slate-300">
            {(status.logs || []).join("\n") || "暂无执行日志。开始更新后，这里会显示环境检查、备份、安装、迁移、构建、重启和验证记录。"}
          </pre>
        </section>
      )}

      {activeTab === "history" && (
        <section className="app-card rounded-2xl p-5">
          <div className="mb-4">
            <h2 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">历史记录</h2>
            <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-400">查看历史安装、回滚和版本切换记录。</p>
          </div>
          <section className="rounded-xl border border-slate-100 dark:border-slate-700">
            <div className="border-b border-slate-100 px-4 py-3 text-[13px] font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100">历史更新记录</div>
            <div className="max-h-[340px] divide-y divide-slate-100 overflow-auto px-4 dark:divide-slate-700">
              {(status.history || []).slice(0, 10).map((item, index) => (
                <div key={item.at + index} className="py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className={`text-[11px] font-medium ${item.result === "success" ? "text-emerald-700 dark:text-emerald-300" : item.result === "rolled_back" ? "text-amber-700 dark:text-amber-200" : "text-rose-700 dark:text-rose-200"}`}>{item.message}</span>
                    <span className="shrink-0 text-[11px] text-slate-400">{fmtDate(item.at)}</span>
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-slate-400">{shortSha(item.fromSha)} → {shortSha(item.toSha)} · {item.actor}</div>
                  {item.error && <div className="mt-1 text-[11px] text-rose-600 dark:text-rose-300">{item.error}</div>}
                </div>
              ))}
              {(!status.history || status.history.length === 0) && <div className="py-10 text-center text-xs text-slate-400">还没有更新记录</div>}
            </div>
          </section>
        </section>
      )}
    </div>
  );
}

function VersionCard({
  label,
  version,
  sha,
  note,
  tone,
}: {
  label: string;
  version?: string | null;
  sha?: string | null;
  note: string;
  tone: "current" | "target";
}) {
  const target = tone === "target";
  return (
    <div className={`rounded-xl border p-4 ${target ? "border-amber-300 bg-amber-50/70 dark:border-amber-500/60 dark:bg-amber-500/10" : "border-blue-300 bg-blue-50/60 dark:border-blue-500/50 dark:bg-blue-500/10"}`}>
      <div className="flex items-center justify-between gap-2">
        <div className={`text-[11px] font-medium ${target ? "text-amber-700 dark:text-amber-200" : "text-blue-700 dark:text-blue-200"}`}>{label}</div>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${target ? "bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-200" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300"}`}>
          {target ? "有新版本" : "当前运行中"}
        </span>
      </div>
      <div className={`mt-2 font-mono text-[19px] font-semibold tracking-tight ${target ? "text-amber-800 dark:text-amber-100" : "text-slate-900 dark:text-slate-100"}`}>
        {version || shortSha(sha)}
      </div>
      <div className="mt-2 flex min-w-0 items-center gap-2 text-[11px] text-slate-500 dark:text-slate-300">
        <span className="shrink-0 font-mono text-slate-400">{shortSha(sha)}</span>
        <span className="truncate" title={note}>{note}</span>
      </div>
    </div>
  );
}

function UpdateStep({
  index,
  title,
  desc,
  status,
  time,
  last = false,
}: {
  index: number;
  title: string;
  desc: string;
  status: "done" | "active" | "pending" | "error";
  time?: string;
  last?: boolean;
}) {
  const circle = status === "done"
    ? "bg-emerald-500 text-white"
    : status === "active"
      ? "bg-blue-600 text-white ring-4 ring-blue-100 dark:ring-blue-500/20"
      : status === "error"
        ? "bg-rose-500 text-white"
        : "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300";
  const statusText = status === "done" ? "已完成" : status === "active" ? "进行中…" : status === "error" ? "需要处理" : "等待中";
  return (
    <div className={`relative px-5 py-4 ${last ? "" : "border-b border-slate-100 md:border-b-0 md:border-r dark:border-slate-700"}`}>
      <div className="flex items-start gap-3">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${circle}`}>
          {status === "done" ? "✓" : index}
        </span>
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-slate-800 dark:text-slate-100">{index}　{title}</div>
          <div className="mt-1 text-[11px] leading-5 text-slate-400 dark:text-slate-400">{desc}</div>
          <div className={`mt-1.5 text-[11px] font-medium ${status === "done" ? "text-emerald-600 dark:text-emerald-300" : status === "active" ? "text-blue-600 dark:text-blue-300" : status === "error" ? "text-rose-600 dark:text-rose-300" : "text-slate-400"}`}>
            {time || statusText}
          </div>
        </div>
      </div>
    </div>
  );
}
