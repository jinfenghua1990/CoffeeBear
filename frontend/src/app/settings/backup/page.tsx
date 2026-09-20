"use client";

import { useMemo, useState, type ReactNode } from "react";

type TabKey = "overview" | "policy" | "targets" | "restore" | "records";

type ToggleProps = {
  checked: boolean;
  onChange: (next: boolean) => void;
};

function Toggle({ checked, onChange }: ToggleProps) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      className={"relative h-5 w-9 rounded-full transition " + (checked ? "bg-blue-600" : "bg-slate-200")}
    >
      <span className={"absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition " + (checked ? "left-[18px]" : "left-0.5")} />
    </button>
  );
}

function Dot({ tone = "slate" }: { tone?: "green" | "blue" | "amber" | "slate" }) {
  const color =
    tone === "green" ? "bg-emerald-500" :
    tone === "blue" ? "bg-blue-500" :
    tone === "amber" ? "bg-amber-500" : "bg-slate-300";
  return <span className={"inline-block h-2 w-2 rounded-full " + color} />;
}

function Pill({ children, tone = "slate" }: { children: ReactNode; tone?: "green" | "blue" | "amber" | "slate" }) {
  const cls =
    tone === "green" ? "bg-emerald-50 text-emerald-700" :
    tone === "blue" ? "bg-blue-50 text-blue-700" :
    tone === "amber" ? "bg-amber-50 text-amber-700" :
    "bg-slate-100 text-slate-500";
  return <span className={"rounded-full px-2 py-0.5 text-[10px] font-medium " + cls}>{children}</span>;
}

function StrategyCard({
  title,
  subtitle,
  enabled,
  onEnabledChange,
  children,
  accent = "green",
}: {
  title: string;
  subtitle: string;
  enabled: boolean;
  onEnabledChange: (next: boolean) => void;
  children: ReactNode;
  accent?: "green" | "blue" | "amber";
}) {
  const frame =
    accent === "blue" ? "border-blue-100 bg-blue-50/35" :
    accent === "amber" ? "border-amber-100 bg-amber-50/35" :
    "border-emerald-100 bg-emerald-50/30";
  return (
    <article className={"rounded-xl border p-4 " + frame}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[13px] font-semibold text-slate-900">{title}</div>
          <div className="mt-1 text-[10px] leading-5 text-slate-500">{subtitle}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500">{enabled ? "已启用" : "已关闭"}</span>
          <Toggle checked={enabled} onChange={onEnabledChange} />
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </article>
  );
}

function FieldRow({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100/80 py-2.5 first:border-t-0 first:pt-0">
      <div>
        <div className="text-[10px] font-medium text-slate-600">{label}</div>
        {note ? <div className="mt-0.5 text-[9px] text-slate-400">{note}</div> : null}
      </div>
      <div className="text-[10px] font-medium text-slate-700">{value}</div>
    </div>
  );
}

function TargetCard({
  title,
  desc,
  status,
  tone,
  primary,
}: {
  title: string;
  desc: string;
  status: string;
  tone: "green" | "amber" | "slate";
  primary?: boolean;
}) {
  return (
    <article className={"rounded-xl border p-4 " + (primary ? "border-blue-100 bg-blue-50/25" : "border-slate-100 bg-white")}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className={"mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg " + (primary ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500")}>
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
              <path d="M4 7.5 12 4l8 3.5V17l-8 3-8-3V7.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
              <path d="m4.5 7.7 7.5 3.2 7.5-3.2M12 10.9v9" stroke="currentColor" strokeWidth="1.7" />
            </svg>
          </span>
          <div>
            <div className="text-[12px] font-semibold text-slate-800">{title}</div>
            <div className="mt-1 text-[10px] leading-5 text-slate-500">{desc}</div>
          </div>
        </div>
        <Pill tone={tone}>{status}</Pill>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
        <button type="button" className="app-button-secondary rounded-lg px-3 py-1.5 text-[10px] font-medium">配置</button>
        <button type="button" disabled className="rounded-lg border border-slate-200 px-3 py-1.5 text-[10px] text-slate-400 disabled:cursor-not-allowed">测试连接</button>
      </div>
    </article>
  );
}

export default function BackupSettingsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [dailyEnabled, setDailyEnabled] = useState(true);
  const [disasterEnabled, setDisasterEnabled] = useState(true);
  const [coldEnabled, setColdEnabled] = useState(false);

  const tabs = useMemo(
    () => [
      ["overview", "概览"],
      ["policy", "备份策略"],
      ["targets", "存储目标"],
      ["restore", "恢复中心"],
      ["records", "备份记录"],
    ] as Array<[TabKey, string]>,
    [],
  );

  return (
    <div className="pb-10">
      <header className="app-page-header -mx-1 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-slate-900">备份与容灾</h1>
              <Pill tone="blue">第一版</Pill>
            </div>
            <p className="mt-1.5 text-sm leading-6 text-slate-500">
              日常模块化备份、10 天全量容灾与冷备份统一管理；备份策略与存储目标分离。
            </p>
          </div>
          <button type="button" disabled className="app-button-primary rounded-lg px-4 py-2 text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-45">
            立即执行备份
          </button>
        </div>
      </header>

      <div className="mt-4 max-w-7xl rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-[11px] leading-5 text-blue-800">
        当前为策略与 UI 第一版：现有本地备份脚本保持不变。R2 凭据、10 天全量执行器、冷备份目标与一键恢复将在确认页面后接入。
      </div>

      <div className="mt-4 max-w-7xl border-b border-slate-200">
        <div className="flex gap-1 overflow-x-auto">
          {tabs.map(([key, label]) => (
            <button
              type="button"
              key={key}
              onClick={() => setActiveTab(key)}
              className={"border-b-2 px-3 py-2.5 text-[11px] font-medium transition " + (activeTab === key ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-800")}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "overview" && (
        <div className="mt-4 max-w-7xl space-y-4">
          <section className="app-card rounded-xl p-4">
            <div className="mb-3">
              <h2 className="text-sm font-semibold text-slate-900">备份架构总览</h2>
              <p className="mt-1 text-[10px] text-slate-400">本地数据 → 备份策略 → 存储目标。以后新增存储只增加目标，不改业务备份逻辑。</p>
            </div>

            <div className="grid gap-3 xl:grid-cols-[1fr_1.35fr_1fr]">
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/25 p-3">
                <div className="mb-2 text-[11px] font-semibold text-slate-800">本地系统</div>
                {[
                  ["应用程序", "代码 / Docker / 配置"],
                  ["数据库", "PostgreSQL"],
                  ["业务文件", "data/ 上传文件、附件等"],
                  ["系统配置", ".env / 部署配置 / 其他"],
                ].map(([name, desc]) => (
                  <div key={name} className="mt-2 rounded-lg bg-white px-3 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,.04)]">
                    <div className="text-[11px] font-medium text-slate-700">{name}</div>
                    <div className="mt-0.5 text-[9px] text-slate-400">{desc}</div>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-blue-100 bg-blue-50/25 p-3">
                <div className="mb-2 text-[11px] font-semibold text-slate-800">备份策略</div>
                <div className="space-y-2">
                  <div className="rounded-lg bg-white px-3 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[11px] font-semibold text-slate-800">日常备份 · 模块化</div>
                      <Pill tone="green">每日</Pill>
                    </div>
                    <div className="mt-1.5 text-[9px] leading-4 text-slate-500">检测数据库、业务文件、配置是否变化；只备份发生变化的模块，保留最近 30 个恢复点。</div>
                  </div>
                  <div className="rounded-lg bg-white px-3 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[11px] font-semibold text-slate-800">全量备份 · 容灾级</div>
                      <Pill tone="blue">每 10 天</Pill>
                    </div>
                    <div className="mt-1.5 text-[9px] leading-4 text-slate-500">完整软件 + 数据库 + 业务文件 + 配置 + 恢复脚本，不依赖 GitHub，可独立重建系统。</div>
                  </div>
                  <div className="rounded-lg bg-white px-3 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[11px] font-semibold text-slate-800">冷备份 · 扩展</div>
                      <Pill>预留</Pill>
                    </div>
                    <div className="mt-1.5 text-[9px] leading-4 text-slate-500">可扩展到 NAS、其他 S3、离线设备或后续可自动对接的存储模块。</div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-amber-100 bg-amber-50/25 p-3">
                <div className="mb-2 text-[11px] font-semibold text-slate-800">存储目标</div>
                <div className="space-y-2">
                  <div className="rounded-lg bg-white px-3 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-slate-800">Cloudflare R2</span>
                      <Pill tone="amber">待接入</Pill>
                    </div>
                    <div className="mt-1 text-[9px] text-slate-400">主容灾存储 · S3 兼容</div>
                  </div>
                  <div className="rounded-lg bg-white px-3 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-slate-800">本地 NAS</span>
                      <Pill>预留</Pill>
                    </div>
                    <div className="mt-1 text-[9px] text-slate-400">冷备份 / 第二副本</div>
                  </div>
                  <div className="rounded-lg bg-white px-3 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-slate-800">其他存储</span>
                      <Pill>预留</Pill>
                    </div>
                    <div className="mt-1 text-[9px] text-slate-400">S3 / OSS / 对象存储 / 其他</div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <StrategyCard
              title="日常备份 · 模块化"
              subtitle="每日检测变化内容，只保存变化模块；软件未更新时不重复备份软件。"
              enabled={dailyEnabled}
              onEnabledChange={setDailyEnabled}
              accent="green"
            >
              <FieldRow label="执行时间" value="每天 03:00" />
              <FieldRow label="数据库" value="变化检测 / 增量" />
              <FieldRow label="业务文件" value="变化检测" />
              <FieldRow label="系统配置" value="变化检测" />
              <FieldRow label="保留策略" value="最近 30 个恢复点" />
            </StrategyCard>

            <StrategyCard
              title="全量备份 · 容灾级"
              subtitle="每 10 天生成可独立恢复的完整系统副本，R2 为第一主目标。"
              enabled={disasterEnabled}
              onEnabledChange={setDisasterEnabled}
              accent="blue"
            >
              <FieldRow label="执行周期" value="每 10 天 03:00" />
              <FieldRow label="完整数据库" value="包含" />
              <FieldRow label="全部业务文件" value="包含" />
              <FieldRow label="软件 / Docker / 配置" value="包含" />
              <FieldRow label="恢复脚本 / 校验清单" value="包含" />
            </StrategyCard>
          </section>

          <section className="grid gap-4 xl:grid-cols-[1.3fr_.7fr]">
            <StrategyCard
              title="冷备份 · 扩展策略"
              subtitle="与 R2 主容灾独立，可后续接 NAS、其他云或离线存储。"
              enabled={coldEnabled}
              onEnabledChange={setColdEnabled}
              accent="amber"
            >
              <FieldRow label="建议频率" value="每天 1 次" note="启用后可独立设置" />
              <FieldRow label="备份方式" value="全量容灾副本" />
              <FieldRow label="存储目标" value="待选择" />
              <FieldRow label="接口" value="已预留" />
            </StrategyCard>

            <div className="app-card rounded-xl p-4">
              <div className="text-[12px] font-semibold text-slate-800">当前建设状态</div>
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between gap-3 text-[10px]"><span className="flex items-center gap-2 text-slate-600"><Dot tone="green" />现有本地备份脚本</span><Pill tone="green">已有</Pill></div>
                <div className="flex items-center justify-between gap-3 text-[10px]"><span className="flex items-center gap-2 text-slate-600"><Dot tone="blue" />备份业务 UI</span><Pill tone="blue">本次</Pill></div>
                <div className="flex items-center justify-between gap-3 text-[10px]"><span className="flex items-center gap-2 text-slate-600"><Dot tone="amber" />R2 执行器</span><Pill tone="amber">下一步</Pill></div>
                <div className="flex items-center justify-between gap-3 text-[10px]"><span className="flex items-center gap-2 text-slate-600"><Dot />NAS / 冷备份</span><Pill>预留</Pill></div>
              </div>
            </div>
          </section>
        </div>
      )}

      {activeTab === "policy" && (
        <div className="mt-4 grid max-w-7xl gap-4 xl:grid-cols-3">
          <StrategyCard title="日常模块化备份" subtitle="变化检测后按模块备份。" enabled={dailyEnabled} onEnabledChange={setDailyEnabled}>
            <FieldRow label="频率" value="每日" />
            <FieldRow label="恢复点" value="30 个" />
            <FieldRow label="未变化模块" value="不重复备份" />
          </StrategyCard>
          <StrategyCard title="10 天全量容灾" subtitle="独立可恢复的系统级副本。" enabled={disasterEnabled} onEnabledChange={setDisasterEnabled} accent="blue">
            <FieldRow label="频率" value="每 10 天" />
            <FieldRow label="范围" value="软件 + 数据 + 配置" />
            <FieldRow label="主目标" value="Cloudflare R2" />
          </StrategyCard>
          <StrategyCard title="冷备份" subtitle="第二副本，可落 NAS / 其他存储。" enabled={coldEnabled} onEnabledChange={setColdEnabled} accent="amber">
            <FieldRow label="建议频率" value="每日" />
            <FieldRow label="方式" value="全量" />
            <FieldRow label="状态" value="接口预留" />
          </StrategyCard>
        </div>
      )}

      {activeTab === "targets" && (
        <div className="mt-4 grid max-w-7xl gap-4 xl:grid-cols-3">
          <TargetCard title="Cloudflare R2" desc="S3 兼容对象存储。用于日常模块化备份与 10 天全量容灾。" status="待写入系统" tone="amber" primary />
          <TargetCard title="本地 NAS" desc="可作为冷备份目标；以后允许独立设置目录、频率和保留策略。" status="未配置" tone="slate" />
          <TargetCard title="其他存储" desc="预留通用适配层，后续可接其他 S3 / OSS / 对象存储或新的自动化模块。" status="接口预留" tone="slate" />
        </div>
      )}

      {activeTab === "restore" && (
        <section className="mt-4 max-w-7xl app-card rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-900">恢复中心</h2>
          <p className="mt-1 text-[10px] leading-5 text-slate-500">目标：新设备安装基础运行环境后，可从任意完整容灾点恢复软件、数据库、业务文件和配置。</p>
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            {[
              ["1", "选择恢复点", "日常恢复点 / 全量容灾点"],
              ["2", "完整性校验", "Hash、清单、数据库备份可读性"],
              ["3", "自动恢复", "软件、数据库、data、配置"],
              ["4", "启动验证", "迁移校验 + health check"],
            ].map(([n, title, desc]) => (
              <div key={n} className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-50 text-[10px] font-semibold text-blue-700">{n}</span>
                <div className="mt-2 text-[11px] font-semibold text-slate-700">{title}</div>
                <div className="mt-1 text-[9px] leading-4 text-slate-400">{desc}</div>
              </div>
            ))}
          </div>
          <button type="button" disabled className="mt-4 rounded-lg border border-slate-200 px-4 py-2 text-[10px] text-slate-400 disabled:cursor-not-allowed">恢复功能待执行器接入后开放</button>
        </section>
      )}

      {activeTab === "records" && (
        <section className="mt-4 max-w-7xl app-card rounded-xl">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">备份记录</h2>
            <p className="mt-1 text-[10px] text-slate-400">接入 R2 执行器后，这里显示每次备份的模块、大小、目标、校验结果与恢复点。</p>
          </div>
          <div className="px-4 py-12 text-center text-xs text-slate-400">还没有 R2 备份执行记录</div>
        </section>
      )}
    </div>
  );
}
