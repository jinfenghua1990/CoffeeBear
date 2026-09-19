"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
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
    desc: "仅手工检查和安装，适合本机原生部署。",
  },
  auto_download: {
    title: "自动检测",
    desc: "后台检查 Git 新版本，但安装仍需人工确认。",
  },
  auto_update: {
    title: "全自动",
    desc: "维护窗口自动备份、迁移、重启和健康检查。",
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
    if (!status?.running) return;
    const timer = window.setInterval(() => void load(), 2500);
    return () => window.clearInterval(timer);
  }, [load, status?.running]);

  const runtime = status?.runtime;
  const isContainer = runtime?.deploymentMode === "container";
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
    await Promise.all([load(), loadReadiness()]);
    setBusy("");
  }

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

  async function applyUpdate() {
    if (!window.confirm("更新会先备份，再迁移、重启并做健康检查。确认立即更新？")) return;
    setBusy("apply");
    setError("");
    try {
      setStatus(await systemUpdateApi.apply());
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

  if (!status || !draft) {
    return (
      <div className="p-6">
        <div className="app-card rounded-xl p-6 text-sm text-slate-500">
          {error ? "版本中心加载失败：" + error : "正在读取运行版本…"}
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

  return (
    <div className="pb-10">
      <header className="app-page-header -mx-1 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="mb-1 text-xs text-slate-400">
              <Link href="/settings" className="hover:text-indigo-600">系统设置</Link>
              <span className="mx-1.5">/</span>
              版本中心
            </div>
            <h1 className="text-xl font-semibold text-slate-900">版本中心</h1>
            <p className="mt-1 text-sm text-slate-500">
              这里显示当前真正运行的环境、代码、镜像和数据库版本；发布方式根据部署模式自动切换。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void refreshRuntime()}
              disabled={Boolean(busy)}
              className="app-button-secondary rounded-lg px-3.5 py-2 text-[12px] font-medium disabled:opacity-50"
            >
              {busy === "refresh" ? "刷新中…" : "刷新状态"}
            </button>
            {!isContainer && (
              <>
                <button
                  type="button"
                  onClick={() => void checkNow()}
                  disabled={Boolean(busy || status.running)}
                  className="app-button-secondary rounded-lg px-3.5 py-2 text-[12px] font-medium disabled:opacity-50"
                >
                  {busy === "check" ? "检查中…" : "检查更新"}
                </button>
                <button
                  type="button"
                  onClick={() => void applyUpdate()}
                  disabled={installDisabled}
                  className="app-button-primary rounded-lg px-4 py-2 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {status.running ? "更新进行中…" : busy === "apply" ? "启动中…" : "立即更新"}
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {error && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      {isContainer ? (
        <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50/70 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[13px] font-semibold text-blue-900">容器托管模式</div>
              <p className="mt-1 text-[11px] leading-5 text-blue-700">
                版本由 GitHub → GHCR → STAGING / PRODUCTION 发布链管理。容器内禁止 git pull、现场构建和直接覆盖代码。
              </p>
            </div>
            <span className="rounded-full bg-white/80 px-2.5 py-1 text-[10px] font-medium text-blue-700">
              GitHub / GHCR / Compose
            </span>
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-[11px] leading-5 text-amber-800">
          当前为原生部署模式，仍使用 Git + 本地更新执行器。迁移到极空间后将自动切换为容器托管模式。
        </div>
      )}

      <section className="mt-4 app-card overflow-hidden rounded-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className={"rounded-full px-2.5 py-1 text-[10px] font-semibold " + runtimeTone(runtime?.appEnv)}>
              {envLabel(runtime?.appEnv)}
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-medium text-slate-600">
              {channelLabel(runtime?.releaseChannel)}
            </span>
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
          <VersionCell
            label="Docker Image"
            value={runtime?.imageTag || (isContainer ? "—" : "不适用")}
            sub={runtime?.imageRef || (isContainer ? "未注入 APP_IMAGE_REF" : "原生部署无镜像")}
            title={runtime?.imageRef || undefined}
          />
        </div>
      </section>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,.85fr)]">
        <section className="app-card rounded-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">环境自检</div>
              <div className="mt-0.5 text-[10px] text-slate-400">
                {isContainer ? "检查镜像身份、Git Revision 和数据库 Schema。" : "检查 Git、备份、构建和重启依赖。"}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={"rounded-full px-2.5 py-1 text-[10px] font-medium " + (readiness?.ready ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700")}>
                {readiness ? (readiness.ready ? "正常" : readiness.blockingCount + " 项阻塞") : "读取中"}
              </span>
              {checks.length > 0 && (
                <button type="button" onClick={() => setShowAllChecks((value) => !value)} className="text-[10px] text-slate-500 hover:text-indigo-600">
                  {showAllChecks ? "仅看异常" : "查看全部"}
                </button>
              )}
            </div>
          </div>

          <div className="divide-y divide-slate-100 px-4">
            {(displayedChecks.length > 0 ? displayedChecks : checks.slice(0, 3)).map((item) => (
              <div key={item.key} className="flex items-start justify-between gap-4 py-3">
                <div className="min-w-0">
                  <div className="text-[12px] font-medium text-slate-700">{item.label}</div>
                  <div className="mt-0.5 truncate text-[10px] text-slate-400" title={item.detail}>{item.detail}</div>
                </div>
                <span className={"shrink-0 rounded-full px-2 py-0.5 text-[9px] font-medium " + (
                  item.status === "ok" ? "bg-emerald-50 text-emerald-700" : item.status === "warn" ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700"
                )}>
                  {item.status === "ok" ? "正常" : item.status === "warn" ? "提醒" : "阻塞"}
                </span>
              </div>
            ))}
            {checks.length === 0 && <div className="py-8 text-center text-xs text-slate-400">暂无自检结果</div>}
          </div>
        </section>

        {isContainer ? (
          <section className="app-card rounded-xl p-4">
            <div className="text-sm font-semibold text-slate-900">标准发布路径</div>
            <div className="mt-3 space-y-2">
              <FlowStep index="1" title="develop" desc="合并功能后由 CI 自动测试" />
              <FlowStep index="2" title="Candidate Image" desc="生成不可变 sha-<commit> 镜像" />
              <FlowStep index="3" title="STAGING" desc="极空间测试环境验证业务" />
              <FlowStep index="4" title="main / Stable" desc="同一镜像原样晋级，不重新构建" />
              <FlowStep index="5" title="PRODUCTION" desc="人工审批后部署，可按版本回滚" />
            </div>
            <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-[10px] leading-5 text-slate-500">
              当前页面不直接执行生产部署。后续 Deployment Runner 接入后，这里只展示发布状态、审批结果和回滚记录。
            </div>
          </section>
        ) : (
          <NativeUpdateSettings
            draft={draft}
            busy={busy}
            saveChanged={saveChanged}
            onChange={setDraft}
            onSave={() => void saveSettings()}
          />
        )}
      </div>

      {!isContainer && (
        <section className="mt-4 app-card rounded-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">Git 更新状态</div>
              <div className="mt-0.5 text-[10px] text-slate-400">仅原生部署使用；极空间容器模式不会执行这里的 Git 更新逻辑。</div>
            </div>
            <span className="text-[10px] text-slate-400">最后检查 {fmtDate(status.lastCheckAt)}</span>
          </div>
          <div className="grid gap-3 p-4 md:grid-cols-3">
            <SmallStat label="当前 Git" value={shortSha(status.currentSha)} />
            <SmallStat label="远端 Git" value={shortSha(status.latestSha)} />
            <SmallStat label="状态" value={status.running ? (PHASE_LABEL[status.phase || "idle"] || status.phase || "更新中") : status.updateAvailable ? "有新版本" : "已是最新"} />
          </div>
        </section>
      )}
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
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[9px] font-semibold text-white">{index}</span>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold text-slate-700">{title}</div>
        <div className="mt-0.5 text-[10px] text-slate-400">{desc}</div>
      </div>
    </div>
  );
}

function SmallStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2.5">
      <div className="text-[10px] text-slate-400">{label}</div>
      <div className="mt-1 font-mono text-[12px] font-medium text-slate-700">{value}</div>
    </div>
  );
}

function NativeUpdateSettings({
  draft,
  busy,
  saveChanged,
  onChange,
  onSave,
}: {
  draft: SystemUpdateSettings;
  busy: string;
  saveChanged: boolean;
  onChange: (value: SystemUpdateSettings) => void;
  onSave: () => void;
}) {
  return (
    <section className="app-card rounded-xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">原生更新策略</div>
          <p className="mt-1 text-[10px] leading-4 text-slate-400">只对 Mac / 原生部署有效。</p>
        </div>
        <label className="flex items-center gap-2 text-[11px] text-slate-600">
          <input type="checkbox" checked={draft.enabled} onChange={(event) => onChange({ ...draft, enabled: event.target.checked })} />
          后台检查
        </label>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {(Object.keys(MODE_COPY) as SystemUpdateMode[]).map((mode) => {
          const active = draft.mode === mode;
          return (
            <button
              type="button"
              key={mode}
              onClick={() => onChange({ ...draft, mode })}
              className={"rounded-lg border px-2 py-2 text-center transition " + (active ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-600 hover:bg-slate-50")}
              title={MODE_COPY[mode].desc}
            >
              <span className="block text-[11px] font-medium">{MODE_COPY[mode].title}</span>
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
              onChange={(event) => onChange({ ...draft, checkIntervalMinutes: Number(event.target.value || 10) })}
              className="app-input-control w-full rounded-lg px-3 py-2 text-xs"
            />
            <span className="shrink-0 text-[10px] text-slate-400">分钟</span>
          </div>
        </label>
        <label className="text-[11px] text-slate-600">
          自动更新小时
          <input
            type="number"
            min={0}
            max={23}
            value={draft.autoUpdateHour}
            onChange={(event) => onChange({ ...draft, autoUpdateHour: Number(event.target.value || 0) })}
            className="app-input-control mt-1 w-full rounded-lg px-3 py-2 text-xs"
          />
        </label>
      </div>

      <button
        type="button"
        onClick={onSave}
        disabled={!saveChanged || Boolean(busy)}
        className="app-button-primary mt-4 w-full rounded-lg px-3 py-2 text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy === "save" ? "保存中…" : "保存更新策略"}
      </button>
    </section>
  );
}
