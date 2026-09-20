"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  getBackupStatus,
  getKodoColdBackupConfig,
  getR2BackupConfig,
  prepareR2Restore,
  runR2Backup,
  saveKodoColdBackupConfig,
  saveR2BackupConfig,
  testR2BackupConnection,
  type BackupStatus,
  type KodoColdBackupConfig,
  type R2BackupConfig,
} from "@/lib/api";

type TabKey = "overview" | "config" | "restore" | "records" | "storage";
type Tone = "green" | "blue" | "amber" | "slate";
type StorageKey = "r2" | "kodo" | "nas" | "other";

function Pill({
  children,
  tone = "slate",
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  const cls =
    tone === "green"
      ? "bg-emerald-50 text-emerald-700"
      : tone === "blue"
        ? "bg-blue-50 text-blue-700"
        : tone === "amber"
          ? "bg-amber-50 text-amber-700"
          : "bg-slate-100 text-slate-500";
  return <span className={"rounded-full px-2 py-0.5 text-[10px] font-medium " + cls}>{children}</span>;
}

function StatusDot({ tone = "slate" }: { tone?: Tone }) {
  const cls =
    tone === "green"
      ? "bg-emerald-500"
      : tone === "blue"
        ? "bg-blue-500"
        : tone === "amber"
          ? "bg-amber-500"
          : "bg-slate-300";
  return <span className={"inline-block h-2.5 w-2.5 rounded-full " + cls} />;
}

function CheckItem({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-[10px] leading-5 text-slate-600">
      <span className="mt-1 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] bg-blue-600 text-[9px] font-bold text-white">
        ✓
      </span>
      <span>{children}</span>
    </div>
  );
}

function ArchitectureItem({
  icon,
  title,
  desc,
  tone = "green",
}: {
  icon: "app" | "db" | "folder" | "settings" | "sync" | "shield" | "cloud" | "nas" | "box";
  title: string;
  desc: string;
  tone?: Tone;
}) {
  const toneCls =
    tone === "green"
      ? "bg-emerald-50 text-emerald-600"
      : tone === "blue"
        ? "bg-blue-50 text-blue-600"
        : tone === "amber"
          ? "bg-amber-50 text-amber-600"
          : "bg-slate-100 text-slate-500";

  const iconNode =
    icon === "db" ? (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
        <ellipse cx="12" cy="5.5" rx="6.5" ry="2.5" stroke="currentColor" strokeWidth="1.8" />
        <path d="M5.5 5.5v6c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-6M5.5 11.5v6c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-6" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    ) : icon === "folder" ? (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
        <path d="M3.5 6.5h6l1.8 2H20a1.5 1.5 0 0 1 1.5 1.5v7.5A2.5 2.5 0 0 1 19 20H5a2.5 2.5 0 0 1-2.5-2.5V8A1.5 1.5 0 0 1 4 6.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    ) : icon === "settings" ? (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
        <path d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M18 6l-1.4 1.4M7.4 16.6 6 18M18 18l-1.4-1.4M7.4 7.4 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ) : icon === "sync" ? (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
        <path d="M18.5 8A7 7 0 0 0 6 7l-1.5 1.5M5.5 4.5v4h4M5.5 16A7 7 0 0 0 18 17l1.5-1.5M18.5 19.5v-4h-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ) : icon === "shield" ? (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
        <path d="M12 3 19 6v5.5c0 4.4-2.9 7.5-7 9.5-4.1-2-7-5.1-7-9.5V6l7-3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="m9 12 2 2 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ) : icon === "cloud" ? (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
        <path d="M7 18.5h10a4 4 0 0 0 .8-7.9A6 6 0 0 0 6.2 9.2 4.7 4.7 0 0 0 7 18.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    ) : icon === "nas" ? (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
        <rect x="4" y="5" width="16" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
        <rect x="4" y="13" width="16" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
        <path d="M8 8h.01M8 16h.01M12 8h4M12 16h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ) : icon === "box" ? (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
        <path d="M4 7.5 12 4l8 3.5V17l-8 3-8-3V7.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="m4.5 7.7 7.5 3.2 7.5-3.2M12 10.9v9" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    ) : (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
        <rect x="5" y="4" width="14" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
        <path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );

  return (
    <div className="flex items-center gap-3 rounded-lg bg-white px-3 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <span className={"flex h-9 w-9 shrink-0 items-center justify-center rounded-lg " + toneCls}>{iconNode}</span>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold text-slate-800">{title}</div>
        <div className="mt-0.5 text-[9px] leading-4 text-slate-400">{desc}</div>
      </div>
    </div>
  );
}

function StrategyOverviewCard({
  icon,
  title,
  tone,
  status,
  children,
}: {
  icon: "sync" | "db";
  title: string;
  tone: "green" | "blue";
  status: string;
  children: ReactNode;
}) {
  const shell =
    tone === "green"
      ? "border-emerald-100 bg-white"
      : "border-blue-100 bg-white";
  const iconCls =
    tone === "green"
      ? "bg-emerald-50 text-emerald-600"
      : "bg-blue-50 text-blue-600";
  return (
    <div className={"rounded-xl border p-3 " + shell}>
      <div className="flex items-start gap-3">
        <span className={"flex h-8 w-8 shrink-0 items-center justify-center rounded-lg " + iconCls}>
          {icon === "sync" ? (
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
              <path d="M18.5 8A7 7 0 0 0 6 7l-1.5 1.5M5.5 4.5v4h4M5.5 16A7 7 0 0 0 18 17l1.5-1.5M18.5 19.5v-4h-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
              <ellipse cx="12" cy="5.5" rx="6.5" ry="2.5" stroke="currentColor" strokeWidth="1.8" />
              <path d="M5.5 5.5v6c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-6M5.5 11.5v6c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-6" stroke="currentColor" strokeWidth="1.8" />
            </svg>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="text-[11px] font-semibold text-slate-900">{title}</div>
            <Pill tone={tone}>{status}</Pill>
          </div>
          <div className="mt-1.5">{children}</div>
        </div>
      </div>
    </div>
  );
}

function ConfigCard({
  title,
  tone,
  enabled,
  enabledText,
  schedule,
  content,
  retention,
  status,
  onEdit,
}: {
  title: string;
  tone: "green" | "blue";
  enabled: boolean;
  enabledText: string;
  schedule: string;
  content: string[];
  retention: string;
  status: string;
  onEdit: () => void;
}) {
  const frame =
    tone === "green"
      ? "border-emerald-200 bg-emerald-50/25"
      : "border-blue-200 bg-blue-50/25";
  const titleCls = tone === "green" ? "text-emerald-700" : "text-blue-700";
  return (
    <article className={"rounded-xl border p-4 " + frame}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div className={"text-[12px] font-semibold " + titleCls}>{title}</div>
        <div className="flex items-center gap-2">
          <span className={"relative inline-flex h-5 w-9 items-center rounded-full transition " + (enabled ? (tone === "green" ? "bg-emerald-500" : "bg-blue-600") : "bg-slate-200")}>
            <span className={"absolute h-4 w-4 rounded-full bg-white shadow-sm transition-all " + (enabled ? "right-0.5" : "left-0.5")} />
          </span>
          <span className="text-[10px] font-medium text-slate-600">{enabledText}</span>
        </div>
      </div>

      <div className="divide-y divide-slate-100">
        <div className="flex items-center justify-between gap-4 py-3">
          <span className="text-[10px] font-medium text-slate-600">执行时间</span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500">{schedule}</span>
            <button type="button" onClick={onEdit} className="rounded-md border border-blue-200 bg-white px-2 py-1 text-[9px] font-medium text-blue-600">
              修改
            </button>
          </div>
        </div>

        <div className="grid gap-2 py-3 sm:grid-cols-[90px_1fr]">
          <span className="text-[10px] font-medium text-slate-600">备份内容</span>
          <div className="space-y-1.5">
            {content.map((item) => (
              <CheckItem key={item}>{item}</CheckItem>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 py-3">
          <span className="text-[10px] font-medium text-slate-600">保留策略</span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500">{retention}</span>
            <button type="button" onClick={onEdit} className="rounded-md border border-blue-200 bg-white px-2 py-1 text-[9px] font-medium text-blue-600">
              修改
            </button>
          </div>
        </div>

        <div className="flex items-start justify-between gap-4 pt-3">
          <div>
            <div className="text-[10px] font-medium text-slate-600">状态</div>
            <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-500">
              <StatusDot tone={enabled ? "green" : "amber"} />
              {status}
            </div>
          </div>
          <button type="button" className="rounded-md border border-blue-200 bg-white px-3 py-1.5 text-[9px] font-medium text-blue-600">
            查看日志
          </button>
        </div>
      </div>
    </article>
  );
}

function StorageRow({
  name,
  subtitle,
  tone,
  state,
  stateTone,
  onConfigure,
  secondary,
  allowConnectionTest = true,
}: {
  name: string;
  subtitle: string;
  tone: Tone;
  state: string;
  stateTone: Tone;
  onConfigure: () => void;
  secondary?: string;
  allowConnectionTest?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-100 bg-white px-3 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className={"flex h-9 w-9 shrink-0 items-center justify-center rounded-lg " + (
          tone === "amber" ? "bg-amber-50 text-amber-600" :
          tone === "blue" ? "bg-blue-50 text-blue-600" :
          tone === "green" ? "bg-emerald-50 text-emerald-600" :
          "bg-slate-100 text-slate-500"
        )}>
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
            <path d="M4 7.5 12 4l8 3.5V17l-8 3-8-3V7.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            <path d="m4.5 7.7 7.5 3.2 7.5-3.2M12 10.9v9" stroke="currentColor" strokeWidth="1.8" />
          </svg>
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-[10px] font-semibold text-slate-800">{name}</div>
            <Pill tone={stateTone}>{state}</Pill>
          </div>
          <div className="mt-0.5 text-[9px] leading-4 text-slate-400">{subtitle}</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onConfigure} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[9px] font-medium text-slate-600">
          配置
        </button>
        {allowConnectionTest ? (
          <button type="button" onClick={onConfigure} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[9px] font-medium text-slate-600">
            测试连接
          </button>
        ) : null}
        {secondary ? (
          <button type="button" onClick={onConfigure} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[9px] font-medium text-slate-600">
            {secondary}
          </button>
        ) : null}
      </div>
    </div>
  );
}

const STORAGE_DETAILS: Record<StorageKey, {
  title: string;
  role: string;
  desc: string;
  fields: string[];
  note: string;
}> = {
  r2: {
    title: "Cloudflare R2",
    role: "主存储",
    desc: "用于日常模块化备份与每 10 天一次的全量容灾备份。",
    fields: ["Endpoint", "Bucket", "Access Key ID", "Secret Access Key"],
    note: "运行配置进入云端前先做客户端加密；独立恢复密钥不上传 R2/Kodo，需另行安全保存。",
  },
  kodo: {
    title: "七牛云 Kodo",
    role: "国内冷备 · 只写入",
    desc: "使用标准存储作为国内冷备目标。系统只负责上传保存，不提供下载、取回、在线预览或远端恢复。",
    fields: ["Bucket", "上传域名（Upload Host）", "Access Key", "Secret Key", "对象前缀"],
    note: "密钥只保存到部署环境，不写入 GitHub。冷备通道不执行 GET / 下载 / 取回 / 远端校验；完整性在上传前本地完成。",
  },
  nas: {
    title: "本地 NAS",
    role: "可选冷备",
    desc: "后续可作为第三副本或本地快速恢复来源；当前尚未接入恢复执行器。",
    fields: ["备份路径", "访问方式", "保留策略"],
    note: "不作为唯一容灾副本。",
  },
  other: {
    title: "其他存储",
    role: "可扩展",
    desc: "预留 AWS S3、阿里云 OSS、Wasabi 或其他 S3 兼容存储。",
    fields: ["Provider", "Endpoint", "Bucket", "Credentials"],
    note: "新增目标不改变备份业务逻辑。",
  },
};

function backupTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function BackupSettingsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [selectedStorage, setSelectedStorage] = useState<StorageKey>("r2");
  const [notice, setNotice] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [r2Config, setR2Config] = useState<R2BackupConfig | null>(null);
  const [r2Loading, setR2Loading] = useState(true);
  const [r2Saving, setR2Saving] = useState(false);
  const [r2Testing, setR2Testing] = useState(false);
  const [r2Running, setR2Running] = useState(false);
  const [restorePreparing, setRestorePreparing] = useState(false);
  const [selectedRestoreKey, setSelectedRestoreKey] = useState("");
  const [backupStatus, setBackupStatus] = useState<BackupStatus | null>(null);
  const [r2Form, setR2Form] = useState({
    endpointUrl: "",
    bucket: "",
    prefix: "ecommerce-workspace/backup",
    accessKey: "",
    secretKey: "",
    enabled: true,
    fullIntervalDays: 10,
  });
  const [kodoConfig, setKodoConfig] = useState<KodoColdBackupConfig | null>(null);
  const [kodoLoading, setKodoLoading] = useState(true);
  const [kodoSaving, setKodoSaving] = useState(false);
  const [kodoForm, setKodoForm] = useState({
    bucket: "",
    uploadUrl: "",
    prefix: "ecommerce-workspace/cold",
    accessKey: "",
    secretKey: "",
    enabled: true,
  });

  const r2FullRestorePoints = useMemo(
    () => (backupStatus?.records || []).filter(
      (row) => row.type === "r2_full" && Boolean(row.snapshotObjectKey),
    ),
    [backupStatus],
  );

  const tabs = useMemo(
    () =>
      [
        ["overview", "概览"],
        ["config", "备份配置"],
        ["restore", "恢复管理"],
        ["records", "备份记录"],
        ["storage", "存储管理"],
      ] as Array<[TabKey, string]>,
    [],
  );

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3200);
  }

  useEffect(() => {
    let cancelled = false;
    const loadStatus = () => {
      getBackupStatus()
        .then((status) => {
          if (!cancelled) setBackupStatus(status);
        })
        .catch(() => {});
    };
    loadStatus();
    const timer = window.setInterval(loadStatus, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getR2BackupConfig()
      .then((config) => {
        if (cancelled) return;
        setR2Config(config);
        setR2Form((current) => ({
          ...current,
          endpointUrl: config.endpointUrl || "",
          bucket: config.bucket || "",
          prefix: config.prefix || "ecommerce-workspace/backup",
          enabled: config.configured ? config.enabled : true,
          fullIntervalDays: config.fullIntervalDays || 10,
          accessKey: "",
          secretKey: "",
        }));
      })
      .catch(() => {
        if (!cancelled) setR2Config(null);
      })
      .finally(() => {
        if (!cancelled) setR2Loading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getKodoColdBackupConfig()
      .then((config) => {
        if (cancelled) return;
        setKodoConfig(config);
        setKodoForm((current) => ({
          ...current,
          bucket: config.bucket || "",
          uploadUrl: config.uploadUrl || "",
          prefix: config.prefix || "ecommerce-workspace/cold",
          enabled: config.configured ? config.enabled : true,
          accessKey: "",
          secretKey: "",
        }));
      })
      .catch(() => {
        if (!cancelled) {
          setKodoConfig(null);
        }
      })
      .finally(() => {
        if (!cancelled) setKodoLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveR2Config() {
    if (!r2Form.endpointUrl.trim() || !r2Form.bucket.trim()) {
      showNotice("请填写 R2 Endpoint 和 Bucket。");
      return;
    }
    if (!r2Config?.configured && (!r2Form.accessKey.trim() || !r2Form.secretKey.trim())) {
      showNotice("首次配置 R2 需要填写 Access Key ID 和 Secret Access Key。");
      return;
    }
    if (Boolean(r2Form.accessKey.trim()) !== Boolean(r2Form.secretKey.trim())) {
      showNotice("R2 Access Key ID 与 Secret Access Key 需要同时填写。");
      return;
    }
    setR2Saving(true);
    try {
      const saved = await saveR2BackupConfig({
        endpointUrl: r2Form.endpointUrl.trim(),
        bucket: r2Form.bucket.trim(),
        prefix: r2Form.prefix.trim() || "ecommerce-workspace/backup",
        accessKey: r2Form.accessKey.trim(),
        secretKey: r2Form.secretKey.trim(),
        enabled: r2Form.enabled,
        fullIntervalDays: Math.max(1, Math.min(365, Number(r2Form.fullIntervalDays) || 10)),
      });
      setR2Config(saved);
      setR2Form((current) => ({
        ...current,
        endpointUrl: saved.endpointUrl,
        bucket: saved.bucket,
        prefix: saved.prefix,
        enabled: saved.enabled,
        fullIntervalDays: saved.fullIntervalDays,
        accessKey: "",
        secretKey: "",
      }));
      showNotice(saved.enabled ? "R2 主备份配置已保存并启用。" : "R2 配置已保存，当前保持停用。");
    } catch (error) {
      showNotice("保存失败：" + (error instanceof Error ? error.message : String(error)));
    } finally {
      setR2Saving(false);
    }
  }

  async function testR2Connection() {
    if (!r2Config?.configured) {
      showNotice("请先保存 R2 配置，再测试连接。");
      return;
    }
    setR2Testing(true);
    try {
      const result = await testR2BackupConnection();
      showNotice(result.message || "R2 连接正常。");
    } catch (error) {
      showNotice("R2 连接失败：" + (error instanceof Error ? error.message : String(error)));
    } finally {
      setR2Testing(false);
    }
  }

  async function runR2(mode: "auto" | "daily" | "full" = "auto") {
    if (!r2Config?.configured || !r2Config.enabled) {
      openStorage("r2");
      showNotice("请先配置并启用 Cloudflare R2。");
      return;
    }
    setR2Running(true);
    try {
      await runR2Backup(mode);
      showNotice(mode === "full" ? "R2 全量容灾备份已启动。" : mode === "daily" ? "R2 日常模块化备份已启动。" : "R2 自动备份已启动。");
    } catch (error) {
      showNotice("启动失败：" + (error instanceof Error ? error.message : String(error)));
    } finally {
      setR2Running(false);
    }
  }

  async function prepareSelectedR2Restore() {
    if (!r2Config?.configured || !r2Config.enabled) {
      openStorage("r2");
      showNotice("请先配置并启用 Cloudflare R2。");
      return;
    }
    setRestorePreparing(true);
    try {
      await prepareR2Restore(selectedRestoreKey);
      showNotice(
        selectedRestoreKey
          ? "已开始下载并校验所选 R2 全量恢复点；只写入 staging，不会覆盖生产环境。"
          : "已开始下载并校验 R2 最新全量恢复点；只写入 staging，不会覆盖生产环境。",
      );
    } catch (error) {
      showNotice("恢复准备启动失败：" + (error instanceof Error ? error.message : String(error)));
    } finally {
      setRestorePreparing(false);
    }
  }

  async function saveKodoConfig() {
    if (!kodoForm.bucket.trim() || !kodoForm.uploadUrl.trim()) {
      showNotice("请填写 Bucket 和上传域名。");
      return;
    }
    if (!kodoConfig?.configured && (!kodoForm.accessKey.trim() || !kodoForm.secretKey.trim())) {
      showNotice("首次配置需要填写 Access Key 和 Secret Key。");
      return;
    }
    if (Boolean(kodoForm.accessKey.trim()) !== Boolean(kodoForm.secretKey.trim())) {
      showNotice("Access Key 与 Secret Key 需要同时填写。");
      return;
    }

    setKodoSaving(true);
    try {
      const saved = await saveKodoColdBackupConfig({
        bucket: kodoForm.bucket.trim(),
        uploadUrl: kodoForm.uploadUrl.trim(),
        prefix: kodoForm.prefix.trim() || "ecommerce-workspace/cold",
        accessKey: kodoForm.accessKey.trim(),
        secretKey: kodoForm.secretKey.trim(),
        enabled: kodoForm.enabled,
      });
      setKodoConfig(saved);
      setKodoForm((current) => ({
        ...current,
        bucket: saved.bucket,
        uploadUrl: saved.uploadUrl,
        prefix: saved.prefix,
        enabled: saved.enabled,
        accessKey: "",
        secretKey: "",
      }));
      showNotice(saved.enabled ? "Kodo 冷备配置已保存；仅允许上传写入。" : "Kodo 冷备配置已保存，当前保持停用。");
    } catch (error) {
      showNotice("保存失败：" + (error instanceof Error ? error.message : String(error)));
    } finally {
      setKodoSaving(false);
    }
  }

  function openStorage(key: StorageKey) {
    setSelectedStorage(key);
    setActiveTab("storage");
  }

  return (
    <div className="pb-10">
      <header className="app-page-header -mx-1 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">备份与容灾</h1>
            <p className="mt-1.5 text-sm leading-6 text-slate-500">
              模块化备份、全量容灾、支持多存储，保障系统数据安全
            </p>
          </div>
          <div className="relative flex items-center gap-2">
            <button
              type="button"
              onClick={() => void runR2("auto")}
              disabled={r2Running || r2Loading}
              className="app-button-primary inline-flex h-9 items-center gap-2 rounded-lg px-4 text-[11px] font-medium disabled:cursor-wait disabled:opacity-50"
            >
              <span className="text-[11px]">▶</span>
              {r2Running ? "启动中…" : "立即备份"}
            </button>
            <button
              type="button"
              aria-label="更多操作"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((value) => !value)}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500"
            >
              •••
            </button>
            {menuOpen ? (
              <div className="absolute right-0 top-11 z-10 w-40 rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg">
                <button type="button" onClick={() => { setMenuOpen(false); setActiveTab("records"); }} className="w-full rounded-md px-3 py-2 text-left text-[10px] text-slate-600 hover:bg-slate-50">
                  查看备份记录
                </button>
                <button type="button" onClick={() => { setMenuOpen(false); setActiveTab("storage"); }} className="w-full rounded-md px-3 py-2 text-left text-[10px] text-slate-600 hover:bg-slate-50">
                  存储管理
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {notice ? (
        <div className="mt-3 max-w-7xl rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-[10px] text-blue-700">
          {notice}
        </div>
      ) : null}

      <div className="mt-4 max-w-7xl border-b border-slate-200">
        <div className="flex gap-1 overflow-x-auto">
          {tabs.map(([key, label]) => (
            <button
              type="button"
              key={key}
              onClick={() => setActiveTab(key)}
              className={
                "border-b-2 px-5 py-2.5 text-[11px] font-medium transition " +
                (activeTab === key
                  ? "border-blue-600 bg-blue-50/50 text-blue-700"
                  : "border-transparent text-slate-500 hover:text-slate-800")
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "overview" ? (
        <div className="mt-4 max-w-7xl space-y-4">
          <section className="app-card rounded-xl p-4">
            <div className="mb-3 text-[13px] font-semibold text-slate-900">备份架构总览</div>
            <div className="relative grid gap-4 xl:grid-cols-[1fr_1.2fr_1fr]">
              <span className="pointer-events-none absolute left-[31.8%] top-1/2 z-[1] hidden -translate-x-1/2 -translate-y-1/2 text-2xl font-light text-slate-400 xl:block">→</span>
              <span className="pointer-events-none absolute left-[69.1%] top-1/2 z-[1] hidden -translate-x-1/2 -translate-y-1/2 text-2xl font-light text-slate-400 xl:block">→</span>
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/35 p-3">
                <div className="mb-3 text-center text-[11px] font-semibold text-slate-800">本地系统</div>
                <div className="space-y-2">
                  <ArchitectureItem icon="app" title="应用程序" desc="代码 / Docker / 配置" tone="green" />
                  <ArchitectureItem icon="db" title="数据库" desc="PostgreSQL" tone="green" />
                  <ArchitectureItem icon="folder" title="业务文件" desc="data/ 上传文件、附件等" tone="green" />
                  <ArchitectureItem icon="settings" title="系统配置" desc=".env / 部署配置 / 其他" tone="green" />
                </div>
              </div>

              <div className="rounded-xl border border-blue-100 bg-blue-50/35 p-3">
                <div className="mb-3 text-center text-[11px] font-semibold text-slate-800">备份策略</div>
                <div className="space-y-3">
                  <StrategyOverviewCard icon="sync" title="日常备份（模块化）" tone="green" status="策略已定义">
                    <ul className="space-y-0.5 text-[9px] leading-4 text-slate-500">
                      <li>• 每日检测有更新内容</li>
                      <li>• 模块化增量备份</li>
                      <li>• 未变化内容不重复上传</li>
                      <li>• 远端保留策略待配置；当前不自动删除 R2 恢复点</li>
                    </ul>
                  </StrategyOverviewCard>

                  <StrategyOverviewCard icon="db" title="全量备份（容灾级）" tone="blue" status="策略已定义">
                    <ul className="space-y-0.5 text-[9px] leading-4 text-slate-500">
                      <li>• 每 10 天执行一次</li>
                      <li>• 完整系统备份（软件 + 数据 + 配置）</li>
                      <li>• 运行配置客户端加密，恢复密钥独立保存</li>
                      <li>• 用于灾难恢复</li>
                      <li>• 不依赖 GitHub 即可重建</li>
                    </ul>
                  </StrategyOverviewCard>
                </div>
              </div>

              <div className="rounded-xl border border-amber-100 bg-amber-50/35 p-3">
                <div className="mb-3 text-center text-[11px] font-semibold text-slate-800">存储目标</div>
                <div className="space-y-2">
                  <ArchitectureItem
                    icon="cloud"
                    title="Cloudflare R2（主存储）"
                    desc={r2Loading ? "正在读取配置" : r2Config?.configured && r2Config.enabled ? "每日模块化 + 周期全量 · 已启用" : r2Config?.configured ? "已配置 · 当前停用" : "S3 兼容对象存储 · 待配置"}
                    tone={r2Config?.configured && r2Config.enabled ? "green" : "amber"}
                  />
                  <ArchitectureItem
                    icon="box"
                    title="七牛云 Kodo（国内冷备）"
                    desc={kodoLoading ? "正在读取配置" : kodoConfig?.configured && kodoConfig.enabled ? "标准存储 · 只写入 · 已启用" : kodoConfig?.configured ? "已配置 · 当前停用" : "标准存储 · 只写入 · 待密钥"}
                    tone={kodoConfig?.configured && kodoConfig.enabled ? "green" : "amber"}
                  />
                  <ArchitectureItem icon="nas" title="本地 NAS（可选）" desc="本地冷备 / 第三副本" tone="slate" />
                  <ArchitectureItem icon="box" title="其他存储（可扩展）" desc="AWS S3 / 阿里云 / 本地硬盘等" tone="slate" />
                </div>
              </div>
            </div>
          </section>

          <section className="app-card rounded-xl p-4">
            <div className="mb-3 text-[13px] font-semibold text-slate-900">备份策略配置</div>
            <div className="grid gap-4 xl:grid-cols-2">
              <ConfigCard
                title="日常备份 · 模块化"
                tone="green"
                enabled={Boolean(r2Config?.configured && r2Config.enabled)}
                enabledText={r2Config?.configured && r2Config.enabled ? "已启用" : "待配置"}
                schedule="计划：每天 03:00"
                content={["数据库（增量 / 变化检测）", "业务文件（变更检测）", "系统配置（变更检测）"]}
                retention="远端保留：当前不自动删除 · 后续可配置"
                status={r2Loading ? "读取 R2 配置" : r2Config?.configured && r2Config.enabled ? "R2 已启用" : "R2 待配置"}
                onEdit={() => setActiveTab("config")}
              />
              <ConfigCard
                title="全量备份 · 容灾级"
                tone="blue"
                enabled={Boolean(r2Config?.configured && r2Config.enabled)}
                enabledText={r2Config?.configured && r2Config.enabled ? "已启用" : "待配置"}
                schedule={`计划：每 ${r2Config?.fullIntervalDays || 10} 天 03:00`}
                content={["完整数据库", "全部业务文件", "系统配置（客户端加密）", "应用程序 / Docker 配置 / 必要文件", "恢复脚本 / 完整性清单", "独立恢复密钥不进入云端备份"]}
                retention="计划：保留容灾恢复点"
                status={r2Loading ? "读取 R2 配置" : r2Config?.configured && r2Config.enabled ? "R2 已启用" : "R2 待配置"}
                onEdit={() => setActiveTab("config")}
              />
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-[1.65fr_.75fr]">
            <div className="app-card rounded-xl p-4">
              <div className="mb-3 text-[13px] font-semibold text-slate-900">存储目标配置</div>
              <div className="space-y-2">
                <StorageRow
                  name="Cloudflare R2（主存储）"
                  subtitle="每日模块化 + 周期全量容灾；支持恢复读取"
                  tone="amber"
                  state={r2Loading ? "读取配置" : r2Config?.configured ? (r2Config.enabled ? "已配置" : "已配置 · 停用") : "待配置"}
                  stateTone={r2Config?.configured && r2Config.enabled ? "green" : "amber"}
                  onConfigure={() => openStorage("r2")}
                  allowConnectionTest={false}
                />
                <StorageRow
                  name="七牛云 Kodo（国内冷备）"
                  subtitle="标准存储；只上传保存，不下载、不取回、不在线预览"
                  tone="blue"
                  state={kodoLoading ? "读取配置" : kodoConfig?.configured ? (kodoConfig.enabled ? "已配置" : "已配置 · 停用") : "待填写密钥"}
                  stateTone={kodoConfig?.configured && kodoConfig.enabled ? "green" : "amber"}
                  onConfigure={() => openStorage("kodo")}
                  allowConnectionTest={false}
                />
                <StorageRow
                  name="本地 NAS（可选）"
                  subtitle="用于本地冷备 / 第三副本"
                  tone="slate"
                  state="未配置"
                  stateTone="slate"
                  onConfigure={() => openStorage("nas")}
                />
                <StorageRow
                  name="其他存储（可扩展）"
                  subtitle="AWS S3 / 阿里云 / 本地硬盘，可作为冷备目标"
                  tone="slate"
                  state="未配置"
                  stateTone="slate"
                  onConfigure={() => openStorage("other")}
                />
              </div>
            </div>

            <div className="app-card rounded-xl p-4">
              <div className="mb-3 text-[13px] font-semibold text-slate-900">备份状态</div>
              <div className="rounded-lg bg-slate-50 px-3 py-3">
                <div className="flex items-center gap-3">
                  <span className={`flex h-8 w-8 items-center justify-center rounded-full ${backupStatus?.lastLocal ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                    {backupStatus?.lastLocal ? "✓" : "!"}
                  </span>
                  <div>
                    <div className="text-[11px] font-semibold text-slate-800">
                      {backupStatus?.lastLocal ? "本地基础备份已有成功恢复点" : "等待首次本地基础备份"}
                    </div>
                    <div className="mt-0.5 text-[9px] text-slate-400">
                      {backupStatus?.lastLocal ? `最近成功：${backupTime(backupStatus.lastLocal.time)} · PostgreSQL + data/` : "尚未发现成功 manifest；不预判恢复演练结果"}
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-3 divide-y divide-slate-100 text-[10px]">
                <div className="flex items-center justify-between gap-3 py-2">
                  <span className="text-slate-500">最近 R2 备份</span>
                  <span className="font-medium text-slate-700">{backupStatus?.lastR2 ? backupTime(backupStatus.lastR2.time) : r2Loading ? "读取配置" : r2Config?.configured ? "尚无成功记录" : "待配置"}</span>
                </div>
                <div className="flex items-center justify-between gap-3 py-2">
                  <span className="text-slate-500">最近 Kodo 冷备</span>
                  <span className="font-medium text-slate-700">{backupStatus?.lastKodo ? backupTime(backupStatus.lastKodo.time) : kodoLoading ? "读取配置" : kodoConfig?.configured ? "尚无成功记录" : "待配置"}</span>
                </div>
                <div className="flex items-center justify-between gap-3 py-2">
                  <span className="text-slate-500">R2 日常计划</span>
                  <span className="font-medium text-slate-700">{r2Config?.configured && r2Config.enabled ? "每天 03:00" : "配置后启用"}</span>
                </div>
                <div className="flex items-center justify-between gap-3 py-2">
                  <span className="text-slate-500">R2 全量周期</span>
                  <span className="font-medium text-slate-700">{r2Config?.configured && r2Config.enabled ? `每 ${r2Config.fullIntervalDays || 10} 天 · 03:00` : "配置后启用"}</span>
                </div>
              </div>
              <button type="button" onClick={() => setActiveTab("records")} className="app-button-secondary mt-4 w-full rounded-lg px-3 py-2 text-[10px] font-medium">
                查看完整备份日志 →
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === "config" ? (
        <div className="mt-4 max-w-7xl space-y-4">
          <section className="app-card rounded-xl p-4">
            <div className="mb-1 text-[13px] font-semibold text-slate-900">备份配置</div>
            <p className="text-[10px] leading-5 text-slate-400">这里集中管理三个备份业务策略；R2 与 Kodo 已接入真实配置和执行器，NAS 保留扩展口。</p>
          </section>

          <div className="grid gap-4 xl:grid-cols-2">
            <ConfigCard
              title="日常备份 · 模块化"
              tone="green"
              enabled={Boolean(r2Config?.configured && r2Config.enabled)}
              enabledText={r2Config?.configured && r2Config.enabled ? "已启用" : "待配置"}
              schedule="每天 03:00"
              content={["数据库：内容 Hash 变化检测", "业务文件：文件变化检测", "系统配置：Hash 变化检测", "应用未更新时不重复上传"]}
              retention="最近 30 个本地恢复点 + R2 模块快照"
              status={r2Config?.configured && r2Config.enabled ? "R2 自动执行" : "R2 待配置"}
              onEdit={() => openStorage("r2")}
            />
            <ConfigCard
              title="全量备份 · 容灾级"
              tone="blue"
              enabled={Boolean(r2Config?.configured && r2Config.enabled)}
              enabledText={r2Config?.configured && r2Config.enabled ? "已启用" : "待配置"}
              schedule={`每 ${r2Config?.fullIntervalDays || 10} 天 03:00`}
              content={["应用源码 / 锁定依赖", "可用时 Docker 镜像", "完整 PostgreSQL", "全部业务文件", "运行配置 / manifest / Hash 校验"]}
              retention="独立完整容灾恢复点"
              status={r2Config?.configured && r2Config.enabled ? "R2 自动执行" : "R2 待配置"}
              onEdit={() => openStorage("r2")}
            />
          </div>

          <article className="app-card rounded-xl p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-[12px] font-semibold text-amber-700">冷备份 · 每日恢复点</div>
                <div className="mt-1 text-[10px] leading-5 text-slate-500">
                  每天生成应用、运行配置、数据库、业务文件等完整容灾恢复点，再上传到七牛云 Kodo 标准存储；冷备通道只写入，不执行下载、取回、在线预览或远端恢复。
                </div>
              </div>
              <Pill tone={kodoConfig?.configured && kodoConfig.enabled ? "green" : "amber"}>{kodoConfig?.configured && kodoConfig.enabled ? "已启用" : "待配置"}</Pill>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-4">
              {[
                ["执行时间", "每天 04:00"],
                ["默认目标", "七牛云 Kodo"],
                ["启用条件", "填写密钥后启用"],
                ["访问规则", "只写入 · 禁止取回"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg bg-slate-50 px-3 py-3">
                  <div className="text-[9px] text-slate-400">{label}</div>
                  <div className="mt-1 text-[10px] font-medium text-slate-700">{value}</div>
                </div>
              ))}
            </div>
          </article>
        </div>
      ) : null}

      {activeTab === "restore" ? (
        <div className="mt-4 max-w-7xl">
          <section className="app-card rounded-xl p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-[13px] font-semibold text-slate-900">恢复管理</div>
                <p className="mt-1 text-[10px] leading-5 text-slate-400">当前恢复执行器仅接入 Cloudflare R2。NAS 为后续扩展；七牛云 Kodo 冷备按“只存不取”执行，不提供下载、取回、预览或恢复入口。</p>
              </div>
              <Pill tone={r2Config?.configured && r2Config.enabled ? "green" : "amber"}>{r2Config?.configured && r2Config.enabled ? "R2 可准备恢复" : "R2 待配置"}</Pill>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-4">
              {[
                ["1", "选择恢复点", "按日期选择目标版本"],
                ["2", "选择来源", "当前仅 R2；NAS 后续接入"],
                ["3", "自动校验", "manifest / Hash / 数据库"],
                ["4", "恢复准备完成", "人工确认后再执行生产恢复"],
              ].map(([step, title, desc]) => (
                <div key={step} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-50 text-[10px] font-semibold text-blue-700">{step}</span>
                  <div className="mt-2 text-[10px] font-semibold text-slate-700">{title}</div>
                  <div className="mt-1 text-[9px] leading-4 text-slate-400">{desc}</div>
                </div>
              ))}
            </div>
            <div className="mt-5 border-t border-slate-100 pt-4">
              <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
                <label className="space-y-1.5">
                  <span className="text-[10px] font-medium text-slate-600">R2 全量恢复点</span>
                  <select
                    value={selectedRestoreKey}
                    onChange={(event) => setSelectedRestoreKey(event.target.value)}
                    disabled={!r2Config?.configured || !r2Config.enabled}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[10px] text-slate-700 outline-none focus:border-blue-400 disabled:bg-slate-50 disabled:text-slate-400"
                  >
                    <option value="">最新 R2 全量恢复点（灾难恢复默认）</option>
                    {r2FullRestorePoints.map((row) => (
                      <option key={row.snapshotObjectKey} value={row.snapshotObjectKey}>
                        {backupTime(row.time)} · {row.timestamp}
                      </option>
                    ))}
                  </select>
                  <div className="text-[9px] leading-4 text-slate-400">
                    历史选项来自本机成功上传回执；新机器没有本地记录时仍可直接选择“最新 R2 全量恢复点”。
                  </div>
                </label>
                <button
                  type="button"
                  disabled={restorePreparing || !r2Config?.configured || !r2Config.enabled}
                  onClick={() => void prepareSelectedR2Restore()}
                  className="app-button-primary h-9 rounded-lg px-4 text-[10px] font-medium disabled:opacity-40"
                >
                  {restorePreparing ? "准备中…" : "准备所选恢复点"}
                </button>
              </div>
              <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[9px] leading-5 text-slate-500">
                安全流程：下载到 staging → SHA256 校验 → 临时数据库恢复演练。运行配置为客户端加密密文，真正恢复配置时必须提供独立恢复密钥；这里不会直接覆盖 PostgreSQL、data/、应用代码或 .env，Kodo 冷备不参与取回。
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === "records" ? (
        <div className="mt-4 max-w-7xl">
          <section className="app-card rounded-xl overflow-hidden">
            <div className="border-b border-slate-100 px-4 py-3">
              <div className="text-[13px] font-semibold text-slate-900">备份记录</div>
              <div className="mt-1 text-[11px] text-slate-400">来自本地 manifest、R2 成功回执和 Kodo 本地上传回执；不通过 Kodo 远端读取校验。</div>
            </div>
            <div className="grid grid-cols-[1.1fr_.9fr_.8fr_1.2fr_.7fr] border-b border-slate-100 bg-slate-50 px-4 py-2 text-[11px] font-medium text-slate-500">
              <span>时间</span><span>类型</span><span>目标</span><span>说明</span><span>状态</span>
            </div>
            <div className="divide-y divide-slate-100">
              {(backupStatus?.records || []).map((row) => (
                <div key={`${row.type}-${row.timestamp}-${row.target}`} className="grid grid-cols-[1.1fr_.9fr_.8fr_1.2fr_.7fr] items-center px-4 py-3 text-[11px]">
                  <span className="text-slate-600">{backupTime(row.time)}</span>
                  <span className="font-medium text-slate-700">{row.type === "r2_full" ? "全量容灾" : row.type === "r2_daily" ? "日常模块化" : row.type === "kodo_full" ? "冷备全量" : "本地基础"}</span>
                  <span className="text-slate-600">{row.target}</span>
                  <span className="text-slate-500">{row.detail}</span>
                  <span className="text-emerald-700">成功</span>
                </div>
              ))}
              {!backupStatus?.records.length ? <div className="px-4 py-12 text-center text-[11px] text-slate-400">暂无成功备份记录</div> : null}
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === "storage" ? (
        <div className="mt-4 grid max-w-7xl gap-4 xl:grid-cols-[.8fr_1.2fr]">
          <section className="app-card rounded-xl p-3">
            <div className="px-1 pb-2 text-[11px] font-semibold text-slate-800">存储管理</div>
            <div className="space-y-2">
              {([
                ["r2", "Cloudflare R2", "主存储"],
                ["kodo", "七牛云 Kodo", "国内冷备 · 只写入"],
                ["nas", "本地 NAS", "可选冷备"],
                ["other", "其他存储", "可扩展"],
              ] as Array<[StorageKey, string, string]>).map(([key, title, role]) => (
                <button
                  type="button"
                  key={key}
                  onClick={() => setSelectedStorage(key)}
                  className={
                    "w-full rounded-lg border px-3 py-3 text-left " +
                    (selectedStorage === key ? "border-blue-200 bg-blue-50/70" : "border-slate-100 bg-white hover:bg-slate-50")
                  }
                >
                  <div className="text-[10px] font-semibold text-slate-800">{title}</div>
                  <div className="mt-0.5 text-[9px] text-slate-400">{role}</div>
                </button>
              ))}
            </div>
          </section>

          <section className="app-card rounded-xl p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-[15px] font-semibold text-slate-900">{STORAGE_DETAILS[selectedStorage].title}</div>
                <div className="mt-1 text-[10px] font-medium text-blue-600">{STORAGE_DETAILS[selectedStorage].role}</div>
                <p className="mt-2 text-[10px] leading-5 text-slate-500">{STORAGE_DETAILS[selectedStorage].desc}</p>
              </div>
              <Pill tone={
                selectedStorage === "r2" && r2Config?.configured && r2Config.enabled
                  ? "green"
                  : selectedStorage === "kodo" && kodoConfig?.configured && kodoConfig.enabled
                    ? "green"
                    : selectedStorage === "r2" || selectedStorage === "kodo"
                      ? "amber"
                      : "slate"
              }>
                {selectedStorage === "r2"
                  ? r2Loading
                    ? "读取配置"
                    : r2Config?.configured
                      ? r2Config.enabled ? "已配置" : "已配置 · 停用"
                      : "待配置"
                  : selectedStorage === "kodo"
                    ? kodoLoading
                      ? "读取配置"
                      : kodoConfig?.configured
                        ? kodoConfig.enabled ? "已配置" : "已配置 · 停用"
                        : "待填写密钥"
                    : "待配置"}
              </Pill>
            </div>

            {selectedStorage === "r2" ? (
              <>
                <div className="mt-5 rounded-xl border border-slate-100">
                  <div className="border-b border-slate-100 px-4 py-3">
                    <div className="text-[11px] font-semibold text-slate-700">R2 主备份配置</div>
                    <div className="mt-1 text-[11px] leading-5 text-slate-400">
                      密钥加密保存在服务端，不回显到页面。每日 03:00 自动执行模块化备份，并按全量间隔自动生成完整容灾恢复点；Mac 原生运行会自动维护对应 launchd 计划。
                    </div>
                  </div>
                  <div className="grid gap-3 p-4 md:grid-cols-2">
                    <label className="space-y-1.5 md:col-span-2">
                      <span className="text-[11px] font-medium text-slate-600">Endpoint</span>
                      <input value={r2Form.endpointUrl} onChange={(event) => setR2Form((current) => ({ ...current, endpointUrl: event.target.value }))} placeholder="https://<account-id>.r2.cloudflarestorage.com" className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[11px] text-slate-700 outline-none focus:border-blue-400" />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-[11px] font-medium text-slate-600">Bucket</span>
                      <input value={r2Form.bucket} onChange={(event) => setR2Form((current) => ({ ...current, bucket: event.target.value }))} placeholder="R2 Bucket 名称" className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[11px] text-slate-700 outline-none focus:border-blue-400" />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-[11px] font-medium text-slate-600">对象前缀</span>
                      <input value={r2Form.prefix} onChange={(event) => setR2Form((current) => ({ ...current, prefix: event.target.value }))} placeholder="ecommerce-workspace/backup" className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[11px] text-slate-700 outline-none focus:border-blue-400" />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-[11px] font-medium text-slate-600">Access Key ID {r2Config?.accessKeyHint ? <span className="font-normal text-slate-400">（已保存 {r2Config.accessKeyHint}）</span> : null}</span>
                      <input type="password" autoComplete="new-password" value={r2Form.accessKey} onChange={(event) => setR2Form((current) => ({ ...current, accessKey: event.target.value }))} placeholder={r2Config?.configured ? "留空保持现有密钥" : "待填写"} className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[11px] text-slate-700 outline-none focus:border-blue-400" />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-[11px] font-medium text-slate-600">Secret Access Key</span>
                      <input type="password" autoComplete="new-password" value={r2Form.secretKey} onChange={(event) => setR2Form((current) => ({ ...current, secretKey: event.target.value }))} placeholder={r2Config?.configured ? "已保存且不回显；留空保持" : "待填写"} className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[11px] text-slate-700 outline-none focus:border-blue-400" />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-[11px] font-medium text-slate-600">全量容灾间隔（天）</span>
                      <input type="number" min={1} max={365} value={r2Form.fullIntervalDays} onChange={(event) => setR2Form((current) => ({ ...current, fullIntervalDays: Number(event.target.value) || 10 }))} className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[11px] text-slate-700 outline-none focus:border-blue-400" />
                    </label>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
                    <label className="flex items-center gap-2 text-[11px] text-slate-600">
                      <input type="checkbox" checked={r2Form.enabled} onChange={(event) => setR2Form((current) => ({ ...current, enabled: event.target.checked }))} />
                      保存后启用每日 03:00 自动备份
                    </label>
                    <span className="text-[11px] text-slate-400">全量周期：每 {r2Form.fullIntervalDays || 10} 天</span>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button type="button" disabled={r2Saving || r2Loading} onClick={() => void saveR2Config()} className="app-button-primary rounded-lg px-4 py-2 text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-50">{r2Saving ? "保存中…" : "保存 R2 配置"}</button>
                  <button type="button" disabled={r2Testing || !r2Config?.configured} onClick={() => void testR2Connection()} className="app-button-secondary rounded-lg px-4 py-2 text-[11px] font-medium disabled:opacity-40">{r2Testing ? "测试中…" : "测试连接"}</button>
                  <button type="button" disabled={r2Running || !r2Config?.configured || !r2Config.enabled} onClick={() => void runR2("daily")} className="app-button-secondary rounded-lg px-4 py-2 text-[11px] font-medium disabled:opacity-40">立即日常备份</button>
                  <button type="button" disabled={r2Running || !r2Config?.configured || !r2Config.enabled} onClick={() => void runR2("full")} className="app-button-secondary rounded-lg px-4 py-2 text-[11px] font-medium disabled:opacity-40">立即全量容灾</button>
                </div>
              </>
            ) : selectedStorage === "kodo" ? (
              <>
                <div className="mt-5 rounded-xl border border-slate-100">
                  <div className="border-b border-slate-100 px-4 py-3">
                    <div className="text-[10px] font-semibold text-slate-700">Kodo 上传配置</div>
                    <div className="mt-1 text-[9px] leading-4 text-slate-400">
                      后续只需要把 Bucket、上传域名、Access Key、Secret Key 填进来即可。密钥保存后加密存储，不会在页面回显；Mac 原生运行会自动维护每日 04:00 的冷备计划。
                    </div>
                  </div>
                  <div className="grid gap-3 p-4 md:grid-cols-2">
                    <label className="space-y-1.5">
                      <span className="text-[10px] font-medium text-slate-600">Bucket</span>
                      <input
                        value={kodoForm.bucket}
                        onChange={(event) => setKodoForm((current) => ({ ...current, bucket: event.target.value }))}
                        placeholder="七牛空间名称"
                        className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[10px] text-slate-700 outline-none focus:border-blue-400"
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-[10px] font-medium text-slate-600">上传域名（Upload Host）</span>
                      <input
                        value={kodoForm.uploadUrl}
                        onChange={(event) => setKodoForm((current) => ({ ...current, uploadUrl: event.target.value }))}
                        placeholder="https://..."
                        className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[10px] text-slate-700 outline-none focus:border-blue-400"
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-[10px] font-medium text-slate-600">
                        Access Key {kodoConfig?.accessKeyHint ? <span className="font-normal text-slate-400">（已保存 {kodoConfig.accessKeyHint}）</span> : null}
                      </span>
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={kodoForm.accessKey}
                        onChange={(event) => setKodoForm((current) => ({ ...current, accessKey: event.target.value }))}
                        placeholder={kodoConfig?.configured ? "留空则保持现有密钥" : "待填写"}
                        className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[10px] text-slate-700 outline-none focus:border-blue-400"
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-[10px] font-medium text-slate-600">Secret Key</span>
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={kodoForm.secretKey}
                        onChange={(event) => setKodoForm((current) => ({ ...current, secretKey: event.target.value }))}
                        placeholder={kodoConfig?.configured ? "已保存且不回显；留空保持现有密钥" : "待填写"}
                        className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[10px] text-slate-700 outline-none focus:border-blue-400"
                      />
                    </label>
                    <label className="space-y-1.5 md:col-span-2">
                      <span className="text-[10px] font-medium text-slate-600">对象前缀</span>
                      <input
                        value={kodoForm.prefix}
                        onChange={(event) => setKodoForm((current) => ({ ...current, prefix: event.target.value }))}
                        placeholder="ecommerce-workspace/cold"
                        className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[10px] text-slate-700 outline-none focus:border-blue-400"
                      />
                    </label>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
                    <label className="flex items-center gap-2 text-[10px] text-slate-600">
                      <input
                        type="checkbox"
                        checked={kodoForm.enabled}
                        onChange={(event) => setKodoForm((current) => ({ ...current, enabled: event.target.checked }))}
                      />
                      保存后启用每日 04:00 冷备上传
                    </label>
                    <span className="text-[9px] text-slate-400">读取权限：关闭且不提供</span>
                  </div>
                </div>

                <div className="mt-4 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2.5 text-[9px] leading-5 text-amber-700">
                  只存不取：不会调用 GET、List、Head、下载、在线预览、远端校验或远端恢复。备份完整性在本地完成校验后再上传。Kodo 空间请保持“标准存储”，不要配置自动转低频/归档的生命周期规则。
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={kodoSaving || kodoLoading}
                    onClick={saveKodoConfig}
                    className="app-button-primary rounded-lg px-4 py-2 text-[10px] font-medium disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {kodoSaving ? "保存中…" : "保存 Kodo 配置"}
                  </button>
                  <span className="text-[9px] text-slate-400">不提供“测试连接”按钮，避免读取远端对象。</span>
                </div>
              </>
            ) : (
              <>
                <div className="mt-5 rounded-xl border border-slate-100">
                  <div className="border-b border-slate-100 px-4 py-3 text-[10px] font-semibold text-slate-700">配置字段</div>
                  <div className="divide-y divide-slate-100 px-4">
                    {STORAGE_DETAILS[selectedStorage].fields.map((field) => (
                      <div key={field} className="flex items-center justify-between gap-4 py-3">
                        <span className="text-[10px] font-medium text-slate-600">{field}</span>
                        <span className="text-[9px] text-slate-400">待接入真实配置</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2.5 text-[9px] leading-5 text-slate-500">
                  {STORAGE_DETAILS[selectedStorage].note}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={() => showNotice("该扩展存储尚未接入真实执行器。")} className="app-button-primary rounded-lg px-4 py-2 text-[10px] font-medium">
                    保存配置
                  </button>
                  <button type="button" onClick={() => showNotice("该扩展存储当前尚未接入真实连接器。")} className="app-button-secondary rounded-lg px-4 py-2 text-[10px] font-medium">
                    测试连接
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
