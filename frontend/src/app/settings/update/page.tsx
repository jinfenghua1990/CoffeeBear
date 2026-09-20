"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SystemSettingsTabs from "@/components/system-settings-tabs";
import {
  systemUpdateApi,
  type SystemUpdateMode,
  type SystemUpdateReadiness,
  type SystemUpdateSettings,
  type SystemUpdateStatus,
} from "@/lib/api";

const MODE_COPY: Record<SystemUpdateMode, { title: string; desc: string }> = {
  manual: {
    title: "手动更新",
    desc: "不做后台检查；需要时由你手动检查并确认安装。",
  },
  auto_download: {
    title: "自动检测",
    desc: "后台按间隔检查并下载 Git 对象；发现新版本后由你确认安装。",
  },
  auto_update: {
    title: "全自动",
    desc: "后台检查新版本，并仅在维护窗口内自动备份、迁移、构建、重启与健康检查。",
  },
};

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

function fmtDate(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("zh-CN", { hour12: false });
}

function shortSha(value?: string | null) {
  return value ? value.slice(0, 12) : "—";
}

function envLabel(value?: string | null) {
  if (value === "production") return "PRODUCTION";
  if (value === "staging") return "STAGING";
  if (value === "development") return "DEVELOPMENT";
  return value?.toUpperCase() || "—";
}

function channelLabel(value?: string | null) {
  if (value === "stable") return "Stable";
  if (value === "candidate") return "Candidate";
  return value || "—";
}

function runtimeTone(env?: string) {
  if (env === "production") return "bg-emerald-50 text-emerald-700";
  if (env === "staging") return "bg-blue-50 text-blue-700";
  return "bg-slate-100 text-slate-600";
}

function updateState(status: SystemUpdateStatus) {
  if (status.running) return { label: PHASE_LABEL[status.phase || "idle"] || "更新中", tone: "bg-blue-50 text-blue-700 ring-blue-200" };
  if (status.lastCheckError || status.lastAutoError || status.phase === "failed") return { label: "需要处理", tone: "bg-rose-50 text-rose-700 ring-rose-200" };
  if (status.updateAvailable) return { label: "发现新版本", tone: "bg-amber-50 text-amber-700 ring-amber-200" };
  if (status.phase === "success") return { label: "更新完成", tone: "bg-emerald-50 text-emerald-700 ring-emerald-200" };
  if (status.phase === "rolled_back") return { label: "已自动回滚", tone: "bg-amber-50 text-amber-700 ring-amber-200" };
  return { label: "已是最新", tone: "bg-emerald-50 text-emerald-700 ring-emerald-200" };
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

  const load = useCallback(async (preserveDraft = false) => {
    try {
      const next = await systemUpdateApi.status();
      setStatus(next);
      if (!preserveDraft) setDraft(next.settings);
      setError(next.lastCheckError || next.lastAutoError || "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  const loadReadiness = useCallback(async () => {
    try {
      setReadiness(await systemUpdateApi.readiness());
    } catch (caught) {
      setReadiness(null);
      setError((current) => current || (caught instanceof Error ? caught.message : String(caught)));
    }
  }, []);

  useEffect(() => {
    void Promise.all([load(), loadReadiness()]);
  }, [load, loadReadiness]);

  useEffect(() => {
    if (!status?.running) return;
    const timer = window.setInterval(() => void load(true), 2000);
    return () => window.clearInterval(timer);
  }, [load, status?.running]);

  const runtime = status?.runtime;
  const isContainer = runtime?.deploymentMode === "container";

  useEffect(() => {
    if (!status || isContainer || firstCheckRef.current) return;
    if (status.lastCheckAt) {
      firstCheckRef.current = true;
      return;
    }
    firstCheckRef.current = true;
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
      || source.autoUpdateWindowMinutes !== draft.autoUpdateWindowMinutes;
  }, [draft, status]);

  async function refreshRuntime() {
    setBusy("refresh");
    setNotice("");
    await Promise.all([load(), loadReadiness()]);
    setBusy("");
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
      setNotice(next.lastCheckError ? "" : (next.updateAvailable ? "已发现新版本，可以查看待更新内容后安装。" : "检查完成，当前已经是最新版本。"));
      await loadReadiness();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy("");
    }
  }

  async function applyUpdate() {
    if (!window.confirm("更新会先备份，再迁移、构建、重启并执行健康检查；失败会自动尝试回滚。确认立即更新？")) return;
    setBusy("apply");
    setError("");
    setNotice("");
    try {
      const next = await systemUpdateApi.apply();
      setStatus(next);
      setNotice(next.started === false ? "当前已经是最新版本，无需安装。" : "更新任务已启动，下面会实时显示进度与日志。");
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
    setNotice("");
    try {
      const result = await systemUpdateApi.saveSettings({
        enabled: draft.enabled,
        mode: draft.mode,
        checkIntervalMinutes: draft.checkIntervalMinutes,
        autoUpdateHour: draft.autoUpdateHour,
        autoUpdateWindowMinutes: draft.autoUpdateWindowMinutes,
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
          <h1 className="text-xl font-semibold text-slate-900">系统设置</h1>
          <p className="mt-1.5 text-sm text-slate-500">系统设置统一入口。</p>
        </header>
        <SystemSettingsTabs />
        <div className="app-card rounded-xl p-6 text-sm text-slate-500">
          {error ? "系统更新加载失败：" + error : "正在读取运行版本和更新状态…"}
        </div>
      </div>
    );
  }

  const displaySha = runtime?.gitSha || status.currentSha || "";
  const displayVersion = runtime?.version || shortSha(displaySha);
  const containerReady = Boolean(runtime?.imageRef && runtime?.gitSha);
  const installDisabled = Boolean(
    busy
      || status.running
      || !status.updateAvailable
      || status.dirty
      || status.diverged
      || !readiness?.ready
  );
  const state = updateState(status);
  const progress = Math.max(0, Math.min(100, Number(status.progress || 0)));

  return (
    <div className="pb-10">
      <header className="app-page-header -mx-1 pb-4">
        <h1 className="text-xl font-semibold text-slate-900">系统设置</h1>
        <p className="mt-1.5 text-sm leading-6 text-slate-500">
          系统级能力统一放在这里；系统更新是其中一个模块，不再单独占用顶部或左侧入口。
        </p>
      </header>

      <SystemSettingsTabs />

      <section className="app-card overflow-hidden rounded-xl">
        <div className="flex flex-wrap items-start justify-between gap-4 px-4 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-slate-900">系统更新</h2>
              <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-medium ring-1 ring-inset ${state.tone}`}>{state.label}</span>
            </div>
            <p className="mt-1.5 text-[12px] text-slate-500">
              {status.message || (isContainer ? "由 GitHub / GHCR 发布链管理。" : "自动检查、备份、安装、迁移、重启、健康检查和失败回滚均在此管理。")}
            </p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-400">
              <span>最后检查：{fmtDate(status.lastCheckAt)}</span>
              <span>当前：{shortSha(status.currentSha || displaySha)}</span>
              <span>远端：{shortSha(status.latestSha)}</span>
              {!isContainer && <span>跟踪：{status.settings.remote}/{status.settings.branch}</span>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void refreshRuntime()} disabled={Boolean(busy)} className="app-button-secondary rounded-lg px-3.5 py-2 text-[12px] font-medium disabled:opacity-50">
              {busy === "refresh" ? "刷新中…" : "刷新状态"}
            </button>
            {!isContainer && (
              <>
                <button type="button" onClick={() => void checkNow()} disabled={Boolean(busy || status.running)} className="app-button-secondary rounded-lg px-3.5 py-2 text-[12px] font-medium disabled:opacity-50">
                  {busy === "check" ? "检查中…" : "检查更新"}
                </button>
                <button type="button" onClick={() => void applyUpdate()} disabled={installDisabled} className="app-button-primary rounded-lg px-4 py-2 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-40">
                  {status.running ? "更新进行中…" : busy === "apply" ? "启动中…" : "立即更新"}
                </button>
              </>
            )}
          </div>
        </div>
        {status.running && (
          <div className="border-t border-slate-100 px-4 py-3">
            <div className="mb-1.5 flex items-center justify-between text-[10px] text-slate-500">
              <span>{PHASE_LABEL[status.phase || "idle"] || status.phase || "执行中"}</span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}
      </section>

      {error && <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
      {notice && <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">{notice}</div>}

      {isContainer ? (
        <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50/70 px-4 py-3">
          <div className="text-[13px] font-semibold text-blue-900">容器托管模式</div>
          <p className="mt-1 text-[11px] leading-5 text-blue-700">
            版本由 GitHub → GHCR → STAGING → PRODUCTION 发布链管理。容器内不执行 git pull 或现场构建。
          </p>
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-[11px] leading-5 text-slate-600">
          当前是原生部署：更新器会先检查环境与工作区，再备份数据库和资料；安装失败会自动尝试恢复上一版本。
        </div>
      )}

      <section className="mt-4 app-card overflow-hidden rounded-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className={"rounded-full px-2.5 py-1 text-[10px] font-semibold " + runtimeTone(runtime?.appEnv)}>{envLabel(runtime?.appEnv)}</span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-medium text-slate-600">{channelLabel(runtime?.releaseChannel)}</span>
          </div>
          <span className={"text-[11px] font-medium " + (containerReady || !isContainer ? "text-emerald-600" : "text-amber-600")}>
            {isContainer ? (containerReady ? "运行身份完整" : "运行身份待补全") : "原生运行"}
          </span>
        </div>
        <div className="grid md:grid-cols-2 xl:grid-cols-3">
          <VersionCell label="应用版本" value={displayVersion} mono strong />
          <VersionCell label="Git Revision" value={shortSha(displaySha)} mono title={displaySha || undefined} />
          <VersionCell label="数据库版本" value={runtime?.alembicRevision || "—"} mono title={runtime?.alembicRevision || undefined} />
          <VersionCell label="运行环境" value={envLabel(runtime?.appEnv)} sub={"Channel · " + channelLabel(runtime?.releaseChannel)} />
          <VersionCell label="部署方式" value={isContainer ? "Docker / Compose" : "Native / Git"} sub={runtime?.managedBy === "github_ghcr" ? "GitHub + GHCR 管理" : "应用内 Git 更新"} />
          <VersionCell label="Docker Image" value={runtime?.imageTag || (isContainer ? "—" : "不适用")} sub={runtime?.imageRef || (isContainer ? "未注入 APP_IMAGE_REF" : "原生部署无镜像")} title={runtime?.imageRef || undefined} />
        </div>
      </section>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {!isContainer ? (
          <section className="app-card rounded-xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">自动更新策略</h3>
                <p className="mt-1 text-[10px] leading-4 text-slate-400">选择模式后保存；保存立即生效，不需要重启服务。</p>
              </div>
              <label className="flex items-center gap-2 text-[11px] text-slate-600">
                <input type="checkbox" checked={draft.enabled} onChange={(event) => patchDraft({ enabled: event.target.checked })} />
                启用后台更新器
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
                    className={"rounded-lg border px-2 py-2.5 text-center transition " + (active ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50")}
                  >
                    <span className="block text-[11px] font-semibold">{MODE_COPY[mode].title}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-[10px] leading-5 text-slate-500">{MODE_COPY[draft.mode].desc}</div>

            <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-3">
              <label className="text-[11px] text-slate-600">
                检查间隔
                <div className="mt-1 flex items-center gap-1.5">
                  <input type="number" min={5} max={1440} value={draft.checkIntervalMinutes} onChange={(event) => patchDraft({ checkIntervalMinutes: Number(event.target.value || 10) })} className="app-input-control w-full rounded-lg px-3 py-2 text-xs" />
                  <span className="shrink-0 text-[10px] text-slate-400">分钟</span>
                </div>
              </label>
              <label className="text-[11px] text-slate-600">
                自动更新时间
                <div className="mt-1 flex items-center gap-1.5">
                  <input type="number" min={0} max={23} value={draft.autoUpdateHour} onChange={(event) => patchDraft({ autoUpdateHour: Number(event.target.value || 0) })} className="app-input-control w-full rounded-lg px-3 py-2 text-xs" />
                  <span className="shrink-0 text-[10px] text-slate-400">点</span>
                </div>
              </label>
              <label className="text-[11px] text-slate-600">
                维护窗口
                <div className="mt-1 flex items-center gap-1.5">
                  <input type="number" min={15} max={360} value={draft.autoUpdateWindowMinutes} onChange={(event) => patchDraft({ autoUpdateWindowMinutes: Number(event.target.value || 60) })} className="app-input-control w-full rounded-lg px-3 py-2 text-xs" />
                  <span className="shrink-0 text-[10px] text-slate-400">分钟</span>
                </div>
              </label>
            </div>

            <div className="mt-3 rounded-lg border border-slate-100 px-3 py-2 text-[10px] leading-5 text-slate-500">
              <div>代码源：<span className="font-mono text-slate-700">{draft.remote}/{draft.branch}</span></div>
              <div>全自动模式仅在 {String(draft.autoUpdateHour).padStart(2, "0")}:00 起的 {draft.autoUpdateWindowMinutes} 分钟维护窗口内安装；其他时间只检查，不会重启业务。</div>
            </div>

            <button type="button" onClick={() => void saveSettings()} disabled={!saveChanged || Boolean(busy)} className="app-button-primary mt-4 w-full rounded-lg px-3 py-2.5 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-40">
              {busy === "save" ? "保存中…" : saveChanged ? "保存并立即生效" : "更新策略已保存"}
            </button>
          </section>
        ) : (
          <section className="app-card rounded-xl p-4">
            <h3 className="text-sm font-semibold text-slate-900">标准发布路径</h3>
            <div className="mt-3 space-y-2">
              <FlowStep index="1" title="develop" desc="合并代码并通过 CI" />
              <FlowStep index="2" title="Candidate Image" desc="生成不可变 sha 镜像" />
              <FlowStep index="3" title="STAGING" desc="测试环境验证" />
              <FlowStep index="4" title="main / Stable" desc="同一镜像晋级" />
              <FlowStep index="5" title="PRODUCTION" desc="人工审批后部署，可回滚" />
            </div>
          </section>
        )}

        <section className="app-card rounded-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">环境自检</div>
              <div className="mt-0.5 text-[10px] text-slate-400">{isContainer ? "检查镜像、Revision 与数据库版本。" : "自动更新前必须通过的环境条件。"}</div>
            </div>
            <div className="flex items-center gap-2">
              <span className={"rounded-full px-2.5 py-1 text-[10px] font-medium " + (readiness?.ready ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700")}>
                {readiness ? (readiness.ready ? "全部通过" : readiness.blockingCount + " 项阻塞") : "读取中"}
              </span>
              {checks.length > 0 && <button type="button" onClick={() => setShowAllChecks((value) => !value)} className="text-[10px] text-slate-500 hover:text-blue-600">{showAllChecks ? "仅看异常" : "查看全部"}</button>}
            </div>
          </div>
          <div className="divide-y divide-slate-100 px-4">
            {(displayedChecks.length > 0 ? displayedChecks : checks.slice(0, 4)).map((item) => (
              <div key={item.key} className="flex items-start justify-between gap-4 py-3">
                <div className="min-w-0">
                  <div className="text-[12px] font-medium text-slate-700">{item.label}</div>
                  <div className="mt-0.5 break-all text-[10px] text-slate-400" title={item.detail}>{item.detail}</div>
                </div>
                <span className={"shrink-0 rounded-full px-2 py-0.5 text-[9px] font-medium " + (item.status === "ok" ? "bg-emerald-50 text-emerald-700" : item.status === "warn" ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700")}>
                  {item.status === "ok" ? "正常" : item.status === "warn" ? "提醒" : "阻塞"}
                </span>
              </div>
            ))}
            {checks.length === 0 && <div className="py-8 text-center text-xs text-slate-400">暂无自检结果</div>}
          </div>
        </section>
      </div>

      {!isContainer && status.changes && status.changes.length > 0 && (
        <section className="mt-4 app-card rounded-xl">
          <div className="border-b border-slate-100 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-900">待更新内容</h3>
            <p className="mt-0.5 text-[10px] text-slate-400">当前版本到远端 develop 之间的提交，安装前可以先看清楚。</p>
          </div>
          <div className="divide-y divide-slate-100 px-4">
            {status.changes.map((item) => (
              <div key={item.sha} className="flex items-start gap-3 py-2.5">
                <span className="mt-0.5 font-mono text-[10px] text-slate-400">{item.shortSha}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-medium text-slate-700">{item.subject}</div>
                  <div className="mt-0.5 text-[9px] text-slate-400">{fmtDate(item.committedAt)}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {!isContainer && (status.logs?.length || status.history?.length) ? (
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <section className="app-card rounded-xl">
            <div className="border-b border-slate-100 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-900">执行日志</h3>
              <p className="mt-0.5 text-[10px] text-slate-400">最近一次更新执行器日志；更新过程中自动刷新。</p>
            </div>
            <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap break-all px-4 py-3 text-[10px] leading-5 text-slate-500">{(status.logs || []).join("\n") || "暂无执行日志"}</pre>
          </section>
          <section className="app-card rounded-xl">
            <div className="border-b border-slate-100 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-900">最近更新记录</h3>
              <p className="mt-0.5 text-[10px] text-slate-400">成功、失败与自动回滚都会保留记录。</p>
            </div>
            <div className="divide-y divide-slate-100 px-4">
              {(status.history || []).slice(0, 10).map((item, index) => (
                <div key={item.at + index} className="py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className={"text-[11px] font-medium " + (item.result === "success" ? "text-emerald-700" : item.result === "rolled_back" ? "text-amber-700" : "text-rose-700")}>{item.message}</span>
                    <span className="shrink-0 text-[9px] text-slate-400">{fmtDate(item.at)}</span>
                  </div>
                  <div className="mt-1 font-mono text-[9px] text-slate-400">{shortSha(item.fromSha)} → {shortSha(item.toSha)} · {item.actor}</div>
                  {item.error && <div className="mt-1 text-[10px] text-rose-600">{item.error}</div>}
                </div>
              ))}
              {(!status.history || status.history.length === 0) && <div className="py-8 text-center text-xs text-slate-400">暂无更新记录</div>}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function VersionCell({ label, value, sub, mono = false, strong = false, title }: { label: string; value: string; sub?: string; mono?: boolean; strong?: boolean; title?: string }) {
  return (
    <div className="min-w-0 border-b border-slate-100 px-4 py-3 md:border-r xl:[&:nth-child(3n)]:border-r-0">
      <div className="text-[10px] text-slate-400">{label}</div>
      <div title={title} className={"mt-1 truncate text-[13px] " + (strong ? "font-semibold " : "font-medium ") + (mono ? "font-mono " : "") + "text-slate-800"}>{value}</div>
      {sub && <div title={sub} className="mt-0.5 truncate text-[9px] text-slate-400">{sub}</div>}
    </div>
  );
}

function FlowStep({ index, title, desc }: { index: string; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg bg-slate-50 px-3 py-2.5">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[9px] font-semibold text-white">{index}</span>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold text-slate-700">{title}</div>
        <div className="mt-0.5 text-[10px] text-slate-400">{desc}</div>
      </div>
    </div>
  );
}
