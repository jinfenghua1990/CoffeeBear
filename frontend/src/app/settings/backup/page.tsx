"use client";

import { useMemo, useState, type ReactNode } from "react";

type TabKey = "overview" | "policy" | "targets" | "restore" | "records";
type TargetKey = "r2" | "b2" | "nas" | "s3";

function Pill({
  children,
  tone = "slate",
}: {
  children: ReactNode;
  tone?: "green" | "blue" | "amber" | "red" | "slate";
}) {
  const cls =
    tone === "green"
      ? "bg-emerald-50 text-emerald-700"
      : tone === "blue"
        ? "bg-blue-50 text-blue-700"
        : tone === "amber"
          ? "bg-amber-50 text-amber-700"
          : tone === "red"
            ? "bg-rose-50 text-rose-700"
            : "bg-slate-100 text-slate-500";
  return <span className={"rounded-full px-2 py-0.5 text-[10px] font-medium " + cls}>{children}</span>;
}

function StatusDot({ tone = "slate" }: { tone?: "green" | "blue" | "amber" | "red" | "slate" }) {
  const cls =
    tone === "green"
      ? "bg-emerald-500"
      : tone === "blue"
        ? "bg-blue-500"
        : tone === "amber"
          ? "bg-amber-500"
          : tone === "red"
            ? "bg-rose-500"
            : "bg-slate-300";
  return <span className={"inline-block h-2 w-2 rounded-full " + cls} />;
}

function SummaryCard({
  label,
  value,
  note,
  tone = "slate",
}: {
  label: string;
  value: string;
  note: string;
  tone?: "green" | "blue" | "amber" | "red" | "slate";
}) {
  return (
    <div className="app-card rounded-xl p-4">
      <div className="flex items-center gap-2 text-[10px] font-medium text-slate-500">
        <StatusDot tone={tone} />
        {label}
      </div>
      <div className="mt-2 text-[17px] font-semibold text-slate-900">{value}</div>
      <div className="mt-1 text-[10px] leading-5 text-slate-400">{note}</div>
    </div>
  );
}

function StrategySummary({
  title,
  badge,
  badgeTone,
  desc,
  rows,
  onOpen,
}: {
  title: string;
  badge: string;
  badgeTone: "green" | "blue" | "amber";
  desc: string;
  rows: Array<[string, string]>;
  onOpen: () => void;
}) {
  return (
    <article className="app-card rounded-xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[13px] font-semibold text-slate-900">{title}</div>
          <div className="mt-1 text-[10px] leading-5 text-slate-500">{desc}</div>
        </div>
        <Pill tone={badgeTone}>{badge}</Pill>
      </div>
      <div className="mt-4 space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3 text-[10px]">
            <span className="text-slate-400">{label}</span>
            <span className="font-medium text-slate-700">{value}</span>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="app-button-secondary mt-4 w-full rounded-lg px-3 py-2 text-[10px] font-medium"
      >
        查看策略
      </button>
    </article>
  );
}

const TARGETS: Record<
  TargetKey,
  {
    title: string;
    role: string;
    status: string;
    tone: "amber" | "slate";
    desc: string;
    fields: Array<[string, string]>;
    notes: string[];
  }
> = {
  r2: {
    title: "Cloudflare R2",
    role: "主备份 / 主容灾",
    status: "待配置",
    tone: "amber",
    desc: "承接每日模块化备份与每 10 天完整容灾，是第一恢复来源。",
    fields: [
      ["Endpoint", "S3 API 端点"],
      ["Bucket", "备份 Bucket"],
      ["Access Key ID", "可替换凭据"],
      ["Secret Access Key", "只保存在部署环境"],
    ],
    notes: ["日常模块化恢复点：30 个", "完整容灾：每 10 天一次", "不把密钥写入 GitHub"],
  },
  b2: {
    title: "Backblaze B2",
    role: "冷备份 / 第二云副本",
    status: "待配置",
    tone: "slate",
    desc: "每天生成一个可完整恢复的快照；底层去重，只上传变化的数据块。",
    fields: [
      ["Endpoint", "B2 S3 兼容端点"],
      ["Bucket", "冷备份 Bucket"],
      ["Key ID", "访问密钥 ID"],
      ["Application Key", "只保存在部署环境"],
    ],
    notes: ["每天 1 个完整恢复点", "底层去重增量", "默认保留 90 个恢复点"],
  },
  nas: {
    title: "本地 NAS",
    role: "本地冷备 / 第三副本",
    status: "接口预留",
    tone: "slate",
    desc: "后续可作为额外冷备目标，和 R2 / B2 完全独立。",
    fields: [
      ["路径", "例如独立共享目录"],
      ["方式", "本地目录 / SFTP / S3 网关"],
      ["保留", "独立保留策略"],
    ],
    notes: ["适合做局域网恢复", "不作为唯一容灾副本"],
  },
  s3: {
    title: "其他 S3 / OSS",
    role: "扩展存储",
    status: "接口预留",
    tone: "slate",
    desc: "以后可接阿里 OSS、AWS S3、Wasabi 或其他 S3 兼容对象存储。",
    fields: [
      ["Provider", "存储服务商"],
      ["Endpoint", "S3 兼容端点"],
      ["Bucket", "目标 Bucket"],
      ["Credentials", "访问凭据"],
    ],
    notes: ["策略与存储解耦", "新增目标不改业务备份逻辑"],
  },
};

export default function BackupSettingsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [selectedTarget, setSelectedTarget] = useState<TargetKey>("r2");

  const tabs = useMemo(
    () =>
      [
        ["overview", "概览"],
        ["policy", "备份策略"],
        ["targets", "存储目标"],
        ["restore", "恢复中心"],
        ["records", "备份记录"],
      ] as Array<[TabKey, string]>,
    [],
  );

  function openTarget(target: TargetKey) {
    setSelectedTarget(target);
    setActiveTab("targets");
  }

  return (
    <div className="pb-10">
      <header className="app-page-header -mx-1 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-slate-900">备份与容灾</h1>
              <Pill tone="amber">待完成云端接入</Pill>
            </div>
            <p className="mt-1.5 text-sm leading-6 text-slate-500">
              平时自动备份，出问题时按恢复点直接还原。复杂配置分开放，不影响日常使用。
            </p>
          </div>
          <button
            type="button"
            onClick={() => openTarget("r2")}
            className="app-button-primary rounded-lg px-4 py-2 text-[11px] font-medium"
          >
            配置 R2 主备份
          </button>
        </div>
      </header>

      <section className="mt-4 max-w-7xl rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[12px] font-semibold text-amber-900">下一步：先把 R2 接通</div>
            <div className="mt-1 text-[10px] leading-5 text-amber-800">
              现有本地备份仍可继续使用；R2 接通后，再启用每日模块化与 10 天全量容灾。冷备份随后接 B2。
            </div>
          </div>
          <button
            type="button"
            onClick={() => openTarget("r2")}
            className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-[10px] font-medium text-amber-800 hover:bg-amber-50"
          >
            查看 R2 配置
          </button>
        </div>
      </section>

      <div className="mt-4 max-w-7xl border-b border-slate-200">
        <div className="flex gap-1 overflow-x-auto">
          {tabs.map(([key, label]) => (
            <button
              type="button"
              key={key}
              onClick={() => setActiveTab(key)}
              className={
                "border-b-2 px-3 py-2.5 text-[11px] font-medium transition " +
                (activeTab === key
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-slate-500 hover:text-slate-800")
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "overview" && (
        <div className="mt-4 max-w-7xl space-y-4">
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              label="本地基础备份"
              value="数据可恢复"
              note="现有脚本覆盖 PostgreSQL + data/，不是整机容灾。"
              tone="green"
            />
            <SummaryCard
              label="R2 主备"
              value="待接入"
              note="接入后承担日常备份与 10 天容灾。"
              tone="amber"
            />
            <SummaryCard
              label="B2 冷备"
              value="待接入"
              note="每天完整恢复点，底层去重增量。"
              tone="slate"
            />
            <SummaryCard
              label="当前恢复能力"
              value="业务数据恢复"
              note="整机容灾恢复需等 R2 全量执行器接通后生效。"
              tone="blue"
            />
          </section>

          <section className="app-card rounded-xl p-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">三层保护</h2>
                <p className="mt-1 text-[10px] leading-5 text-slate-400">
                  你平时只看这一页：有没有备份、最后一次是否成功、下一步要不要处理。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab("policy")}
                className="text-[10px] font-medium text-blue-600 hover:text-blue-700"
              >
                查看全部策略
              </button>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-3">
              <StrategySummary
                title="日常模块化备份"
                badge="每天"
                badgeTone="green"
                desc="每天检测变化，只备份发生变化的数据库、业务文件或配置。"
                rows={[
                  ["恢复点", "最近 30 个"],
                  ["未变化内容", "不重复上传"],
                  ["主要目标", "R2"],
                ]}
                onOpen={() => setActiveTab("policy")}
              />
              <StrategySummary
                title="完整容灾备份"
                badge="每 10 天"
                badgeTone="blue"
                desc="整套系统级恢复包，软件、数据库、文件、配置和恢复脚本都包含。"
                rows={[
                  ["恢复级别", "整机重建"],
                  ["依赖 GitHub", "不依赖"],
                  ["主要目标", "R2"],
                ]}
                onOpen={() => setActiveTab("policy")}
              />
              <StrategySummary
                title="冷备份"
                badge="每天"
                badgeTone="amber"
                desc="每天一个完整可恢复快照，但底层做去重增量，不重复存相同内容。"
                rows={[
                  ["恢复点", "默认 90 个"],
                  ["底层方式", "去重增量"],
                  ["建议目标", "Backblaze B2"],
                ]}
                onOpen={() => setActiveTab("policy")}
              />
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-[1.2fr_.8fr]">
            <div className="app-card rounded-xl p-4">
              <div className="text-[12px] font-semibold text-slate-800">恢复时你只需要做什么</div>
              <div className="mt-4 grid gap-3 md:grid-cols-4">
                {[
                  ["1", "选日期", "选择要恢复到哪一天"],
                  ["2", "系统校验", "检查文件与数据库是否完整"],
                  ["3", "一键恢复", "软件、数据、配置自动还原"],
                  ["4", "自动验证", "启动并检查服务健康"],
                ].map(([step, title, desc]) => (
                  <div key={step} className="rounded-lg bg-slate-50 px-3 py-3">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-50 text-[10px] font-semibold text-blue-700">
                      {step}
                    </span>
                    <div className="mt-2 text-[10px] font-semibold text-slate-700">{title}</div>
                    <div className="mt-1 text-[9px] leading-4 text-slate-400">{desc}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="app-card rounded-xl p-4">
              <div className="text-[12px] font-semibold text-slate-800">存储分工</div>
              <div className="mt-3 space-y-3">
                {[
                  ["R2", "主备份", "日常 + 10 天容灾", "amber"],
                  ["B2", "冷备份", "每日完整恢复点", "slate"],
                  ["NAS", "第三副本", "以后按需启用", "slate"],
                ].map(([name, role, scope, tone]) => (
                  <button
                    type="button"
                    key={name}
                    onClick={() =>
                      openTarget(name === "R2" ? "r2" : name === "B2" ? "b2" : "nas")
                    }
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2.5 text-left hover:bg-slate-50"
                  >
                    <span>
                      <span className="block text-[10px] font-semibold text-slate-700">{name} · {role}</span>
                      <span className="mt-0.5 block text-[9px] text-slate-400">{scope}</span>
                    </span>
                    <Pill tone={tone === "amber" ? "amber" : "slate"}>
                      {name === "R2" ? "待配置" : "预留"}
                    </Pill>
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>
      )}

      {activeTab === "policy" && (
        <div className="mt-4 max-w-7xl space-y-4">
          <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-[10px] leading-5 text-blue-800">
            以下为计划策略，不代表当前已经在自动执行。真正接入执行器后，再开放时间、保留份数和目标位置的可编辑设置。
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <StrategySummary
              title="① 日常模块化备份"
              badge="计划：每日 03:00"
              badgeTone="green"
              desc="检查数据库、data、配置是否变化。只有发生变化的模块才新增备份。"
              rows={[
                ["恢复点", "30 个"],
                ["软件未更新", "不重复备份"],
                ["数据库", "变化检测 / 增量"],
                ["业务文件", "变化检测"],
                ["目标", "R2"],
              ]}
              onOpen={() => openTarget("r2")}
            />
            <StrategySummary
              title="② 全量容灾备份"
              badge="计划：每 10 天 03:00"
              badgeTone="blue"
              desc="完整系统级恢复点，面向电脑 / NAS 损坏或更换设备。"
              rows={[
                ["软件与部署", "包含"],
                ["完整数据库", "包含"],
                ["全部业务文件", "包含"],
                ["配置与恢复脚本", "包含"],
                ["目标", "R2"],
              ]}
              onOpen={() => openTarget("r2")}
            />
            <StrategySummary
              title="③ 冷备份"
              badge="计划：每日 04:00"
              badgeTone="amber"
              desc="每天一个完整恢复点；底层用去重增量方式，减少重复占用。"
              rows={[
                ["恢复点", "90 个"],
                ["恢复体验", "每天都可完整恢复"],
                ["实际上传", "仅变化数据块"],
                ["建议目标", "Backblaze B2"],
                ["以后可加", "NAS / 其他 S3"],
              ]}
              onOpen={() => openTarget("b2")}
            />
          </div>
        </div>
      )}

      {activeTab === "targets" && (
        <div className="mt-4 grid max-w-7xl gap-4 xl:grid-cols-[.78fr_1.22fr]">
          <section className="app-card rounded-xl p-3">
            <div className="px-1 pb-2 text-[10px] font-semibold text-slate-500">存储目标</div>
            <div className="space-y-2">
              {(Object.keys(TARGETS) as TargetKey[]).map((key) => {
                const target = TARGETS[key];
                const selected = selectedTarget === key;
                return (
                  <button
                    type="button"
                    key={key}
                    onClick={() => setSelectedTarget(key)}
                    className={
                      "w-full rounded-lg border px-3 py-3 text-left transition " +
                      (selected
                        ? "border-blue-200 bg-blue-50/70"
                        : "border-slate-100 bg-white hover:bg-slate-50")
                    }
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-semibold text-slate-800">{target.title}</div>
                        <div className="mt-0.5 text-[9px] text-slate-400">{target.role}</div>
                      </div>
                      <Pill tone={target.tone}>{target.status}</Pill>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="app-card rounded-xl p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-[15px] font-semibold text-slate-900">{TARGETS[selectedTarget].title}</div>
                <div className="mt-1 text-[10px] font-medium text-blue-600">{TARGETS[selectedTarget].role}</div>
                <p className="mt-2 max-w-2xl text-[10px] leading-5 text-slate-500">
                  {TARGETS[selectedTarget].desc}
                </p>
              </div>
              <Pill tone={TARGETS[selectedTarget].tone}>{TARGETS[selectedTarget].status}</Pill>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_.8fr]">
              <div className="rounded-xl border border-slate-100">
                <div className="border-b border-slate-100 px-4 py-3 text-[10px] font-semibold text-slate-700">
                  接入需要的配置
                </div>
                <div className="divide-y divide-slate-100 px-4">
                  {TARGETS[selectedTarget].fields.map(([name, desc]) => (
                    <div key={name} className="flex items-center justify-between gap-4 py-3">
                      <span className="text-[10px] font-medium text-slate-600">{name}</span>
                      <span className="text-right text-[9px] text-slate-400">{desc}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl bg-slate-50 p-4">
                <div className="text-[10px] font-semibold text-slate-700">接入后的默认规则</div>
                <div className="mt-3 space-y-2">
                  {TARGETS[selectedTarget].notes.map((note) => (
                    <div key={note} className="flex items-start gap-2 text-[10px] leading-5 text-slate-500">
                      <StatusDot tone="green" />
                      <span className="-mt-1">{note}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2.5 text-[9px] leading-5 text-slate-500">
              凭据不会写入 GitHub。真正接入后会保存到部署环境的安全配置中，并提供“测试连接”与“保存”操作。
            </div>
          </section>
        </div>
      )}

      {activeTab === "restore" && (
        <div className="mt-4 max-w-7xl space-y-4">
          <section className="app-card rounded-xl p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">恢复中心</h2>
                <p className="mt-1 text-[10px] leading-5 text-slate-500">
                  以后这里不让你处理技术文件，只选“恢复到哪一天”和“恢复来源”。
                </p>
              </div>
              <Pill tone="slate">执行器接入后开放</Pill>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-4">
              {[
                ["1", "选择恢复点", "按日期查看可恢复快照"],
                ["2", "选择来源", "R2 / B2 / NAS"],
                ["3", "系统自动校验", "Hash、数据库、文件完整性"],
                ["4", "确认恢复", "自动还原并启动验证"],
              ].map(([step, title, desc]) => (
                <div key={step} className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-50 text-[10px] font-semibold text-blue-700">
                    {step}
                  </span>
                  <div className="mt-2 text-[10px] font-semibold text-slate-700">{title}</div>
                  <div className="mt-1 text-[9px] leading-4 text-slate-400">{desc}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <div className="app-card rounded-xl p-4">
              <div className="text-[11px] font-semibold text-slate-800">日常恢复</div>
              <div className="mt-1 text-[9px] leading-5 text-slate-400">用于误删、错误修改、数据回滚。</div>
              <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                <span className="text-[10px] text-slate-600">默认来源</span>
                <span className="text-[10px] font-medium text-slate-800">R2 · 最近 30 个恢复点</span>
              </div>
            </div>
            <div className="app-card rounded-xl p-4">
              <div className="text-[11px] font-semibold text-slate-800">灾难恢复</div>
              <div className="mt-1 text-[9px] leading-5 text-slate-400">用于电脑 / NAS 损坏、整套迁移到新设备。</div>
              <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                <span className="text-[10px] text-slate-600">恢复顺序</span>
                <span className="text-[10px] font-medium text-slate-800">R2 → B2 → NAS</span>
              </div>
            </div>
          </section>
        </div>
      )}

      {activeTab === "records" && (
        <section className="mt-4 max-w-7xl app-card rounded-xl">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">备份记录</h2>
            <p className="mt-1 text-[10px] text-slate-400">
              接入执行器后，这里按“成功 / 失败 / 不完整”显示每次任务，不需要看原始日志。
            </p>
          </div>
          <div className="px-4 py-12 text-center">
            <div className="text-xs font-medium text-slate-500">还没有云端备份记录</div>
            <div className="mt-1 text-[10px] text-slate-400">完成 R2 配置后会自动开始记录。</div>
            <button
              type="button"
              onClick={() => openTarget("r2")}
              className="app-button-secondary mt-4 rounded-lg px-3 py-2 text-[10px] font-medium"
            >
              去配置 R2
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
