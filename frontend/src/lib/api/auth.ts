/** 认证：登录、用户、角色权限（由 lib/api.ts 拆分，逻辑未改动） */
import { authenticatedFetch, clearToken, detailToMessage, jsonFetch, setToken } from "./client";

export type RuntimeAuthConfig = {
  accessMode: "rbac" | "open";
};

export async function getRuntimeAuthConfig(): Promise<RuntimeAuthConfig> {
  const res = await fetch("/api/v1/auth/config", { cache: "no-store" });
  if (!res.ok) throw new Error(`auth config ${res.status}`);
  return res.json();
}

export type AuthUser = {
  id: number;
  username: string;
  displayName: string;
  roles: string[];
  isActive: boolean;
};

export async function login(
  username: string,
  password: string,
  rememberMe = false
): Promise<AuthUser> {
  const res = await fetch("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, remember_me: rememberMe }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { detail?: unknown };
    throw new Error(detailToMessage(data.detail, `登录失败（${res.status}）`));
  }
  const data = (await res.json()) as { accessToken: string; user: AuthUser };
  setToken(data.accessToken);
  return data.user;
}

export async function fetchMe(): Promise<AuthUser> {
  const res = await authenticatedFetch("/api/v1/auth/me");
  if (!res.ok) throw new Error(`me ${res.status}`);
  return res.json();
}

export async function logout(): Promise<void> {
  try {
    await authenticatedFetch("/api/v1/auth/logout", { method: "POST" });
  } finally {
    clearToken();
  }
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  const res = await authenticatedFetch("/api/v1/auth/change-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { detail?: unknown };
    throw new Error(detailToMessage(data.detail, `修改失败（${res.status}）`));
  }
  clearToken();
  window.location.href = "/login?passwordChanged=1";
}

export type IntegrationStatus = {
  id: string;
  name: string;
  mode: string;
  phase: number;
  status: string;
  lastTestedAt: string | null;
  lastSuccessAt: string | null;
  errorSummary: string | null;
};

export type Overview = {
  phase: number;
  phaseName: string;
  accessMode: string;
  dataState: string;
  integrations: IntegrationStatus[];
  pendingExceptions: number;
  nextMilestone: string;
  metrics: Record<string, number | null>;
};

export type SystemHealth = {
  status: "ready" | "degraded" | string;
  components: Record<string, "up" | "down" | string>;
};

let overviewCache: { value: Overview; expiresAt: number } | null = null;

let overviewRequest: Promise<Overview> | null = null;

export async function getOverview(): Promise<Overview> {
  if (overviewCache && overviewCache.expiresAt > Date.now()) {
    return overviewCache.value;
  }
  if (overviewRequest) return overviewRequest;
  overviewRequest = authenticatedFetch("/api/v1/system/overview", {
    cache: "no-store",
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`overview ${res.status}`);
      const value = (await res.json()) as Overview;
      // 页面切换时短时间内会同时挂载状态栏和业务页，共享同一份读取结果。
      overviewCache = { value, expiresAt: Date.now() + 10_000 };
      return value;
    })
    .finally(() => {
      overviewRequest = null;
    });
  return overviewRequest;
}

export async function getSystemHealth(): Promise<SystemHealth> {
  const res = await authenticatedFetch("/api/v1/system/health", {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`health ${res.status}`);
  return res.json();
}

export type SystemUpdateMode = "manual" | "auto_download" | "auto_update";

export type SystemUpdateLevel = "patch" | "feature" | "major";

export type SystemUpdateSettings = {
  enabled: boolean;
  mode: SystemUpdateMode;
  checkIntervalMinutes: number;
  autoUpdateHour: number;
  autoUpdateWindowMinutes: number;
  autoInstallLevel: SystemUpdateLevel;
  branch: string;
  remote: string;
};

export type SystemUpdateCommit = {
  sha: string;
  shortSha: string;
  subject: string;
  committedAt: string;
  version?: string;
  modules?: string[];
};

export type SystemUpdateModuleVersion = {
  key: string;
  label: string;
  status: "latest" | "update" | "untracked";
  currentVersion: string;
  currentSha: string;
  currentSubject: string;
  currentCommittedAt: string;
  latestVersion: string;
  latestSha: string;
  latestSubject: string;
  latestCommittedAt: string;
};

export type SystemUpdateHistory = {
  at: string;
  result: "success" | "failed" | "rolled_back" | string;
  message: string;
  actor: string;
  fromSha: string;
  toSha: string;
  error?: string;
  rollbackErrors?: string[];
};

export type SystemUpdateReadinessCheck = {
  key: string;
  label: string;
  status: "ok" | "warn" | "error";
  detail: string;
  blocking: boolean;
};

export type SystemUpdateReadiness = {
  ready: boolean;
  checks: SystemUpdateReadinessCheck[];
  blockingCount: number;
  warningCount: number;
  branch: string;
  remote: string;
  checkedAt: string;
};

export type SystemRuntimeRelease = {
  appEnv: "production" | "staging" | "development" | string;
  releaseChannel: string;
  deploymentMode: "native" | "container" | string;
  managedBy: "github_ghcr" | "git_native" | string;
  gitSha: string;
  imageRef: string;
  imageTag: string;
  version: string;
  alembicRevision: string;
  inAppUpdateEnabled: boolean;
};

export type SystemUpdateStatus = {
  phase?: string;
  progress?: number;
  message?: string;
  currentSha?: string;
  latestSha?: string;
  downloadedSha?: string;
  previousSha?: string;
  targetSha?: string;
  currentBranch?: string;
  configuredBranch?: string;
  dirty?: boolean;
  updateAvailable?: boolean;
  diverged?: boolean;
  running?: boolean;
  latestCommit?: SystemUpdateCommit | null;
  currentCommit?: SystemUpdateCommit | null;
  changes?: SystemUpdateCommit[];
  lastCheckAt?: string;
  lastCheckError?: string;
  lastAutoError?: string;
  startedAt?: string;
  finishedAt?: string;
  startedBy?: string;
  backupDb?: string;
  backupData?: string;
  error?: string;
  rollbackErrors?: string[];
  lastInstallResult?: "success" | "failed" | "rolled_back" | string;
  lastInstallAt?: string;
  lastInstallFromSha?: string;
  lastInstallToSha?: string;
  logs?: string[];
  history?: SystemUpdateHistory[];
  runtime?: SystemRuntimeRelease;
  updateLevel?: SystemUpdateLevel;
  updateLevelLabel?: string;
  impactedModules?: string[];
  moduleVersions?: SystemUpdateModuleVersion[];
  changedFiles?: string[];
  changedFileCount?: number;
  hasMigration?: boolean;
  updateAgentAvailable?: boolean;
  updateAgentError?: string;
  latestReleaseTag?: string;
  latestReleaseUrl?: string;
  latestImageRef?: string;
  latestUpdaterImageRef?: string;
  currentImageRef?: string;
  classificationReasons?: string[];
  autoInstallEligible?: boolean;
  autoInstallBlockedReason?: string;
  settings: SystemUpdateSettings;
};

export type SystemLocalChangeFile = {
  path: string;
  status: string;
  tracked: boolean;
  eligible: boolean;
  excludedReason?: string;
  added?: number | null;
  deleted?: number | null;
  size?: number;
};

export type SystemLocalHandoffRecord = {
  branch: string;
  commitSha: string;
  shortSha: string;
  baseSha: string;
  uploadedAt: string;
  uploadedBy: string;
  fileCount: number;
  excludedCount: number;
  files: string[];
  worktreePreserved: boolean;
};

export type SystemLocalSyncRecord = {
  branch: string;
  commitSha: string;
  shortSha: string;
  baseSha: string;
  remoteShaBefore: string;
  syncedAt: string;
  syncedBy: string;
  fileCount: number;
  excludedCount: number;
  files: string[];
  worktreePreserved: boolean;
};

export type SystemLocalChanges = {
  dirty: boolean;
  baseSha: string;
  currentBranch: string;
  eligibleCount: number;
  excludedCount: number;
  totalAdded: number;
  totalDeleted: number;
  impactedModules: string[];
  files: SystemLocalChangeFile[];
  excludedFiles: SystemLocalChangeFile[];
  protectedRules: string[];
  diffPreview?: string;
  lastUpload?: SystemLocalHandoffRecord | null;
  lastSync?: SystemLocalSyncRecord | null;
  worktreePreserved: boolean;
  checkedAt: string;
};

export type SystemLocalUploadResult = SystemLocalHandoffRecord & {
  ok: boolean;
  message: string;
  localChanges: SystemLocalChanges;
};

export type SystemLocalSyncResult = SystemLocalSyncRecord & {
  ok: boolean;
  message: string;
  localChanges: SystemLocalChanges;
  status?: SystemUpdateStatus;
};

export const systemUpdateApi = {
  status: () => jsonFetch<SystemUpdateStatus>("/api/v1/system/update/status"),
  readiness: () => jsonFetch<SystemUpdateReadiness>("/api/v1/system/update/readiness"),
  localChanges: (includeDiff = false) =>
    jsonFetch<SystemLocalChanges>(`/api/v1/system/update/local-changes?include_diff=${includeDiff ? "true" : "false"}`),
  uploadLocalChanges: () =>
    jsonFetch<SystemLocalUploadResult>("/api/v1/system/update/local-changes/upload", { method: "POST" }),
  syncLocalChanges: () =>
    jsonFetch<SystemLocalSyncResult>("/api/v1/system/update/local-changes/sync", { method: "POST" }),
  check: () => jsonFetch<SystemUpdateStatus>("/api/v1/system/update/check", { method: "POST" }),
  saveSettings: (body: Partial<Pick<SystemUpdateSettings, "enabled" | "mode" | "checkIntervalMinutes" | "autoUpdateHour" | "autoUpdateWindowMinutes" | "autoInstallLevel">>) =>
    jsonFetch<{ ok: boolean; settings: SystemUpdateSettings }>("/api/v1/system/update/settings", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  apply: () => jsonFetch<SystemUpdateStatus & { started: boolean; reason?: string }>("/api/v1/system/update/apply", { method: "POST" }),
};

export async function testJackyun(): Promise<{
  ok: boolean; status?: string; businessReady?: boolean; tools?: string[]; error?: string;
}> {
  const res = await authenticatedFetch("/api/v1/integrations/jackyun/test", {
    method: "POST",
  });
  return res.json();
}

export type R2BackupConfig = {
  configured: boolean;
  enabled: boolean;
  endpointUrl: string;
  bucket: string;
  prefix: string;
  accessKeyHint: string;
  fullIntervalDays: number;
  mode: "backup" | string;
  readEnabled: true;
  scheduler: { mode: string; managed: boolean; label: string; message: string };
};

export type R2BackupConfigInput = {
  endpointUrl: string;
  bucket: string;
  prefix: string;
  accessKey?: string;
  secretKey?: string;
  enabled: boolean;
  fullIntervalDays: number;
};

export function getR2BackupConfig(): Promise<R2BackupConfig> {
  return jsonFetch<R2BackupConfig>("/api/v1/integrations/r2-backup");
}

export function saveR2BackupConfig(body: R2BackupConfigInput): Promise<R2BackupConfig> {
  return jsonFetch<R2BackupConfig>("/api/v1/integrations/r2-backup", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function testR2BackupConnection(): Promise<{
  ok: boolean;
  status: number;
  bucket: string;
  message: string;
}> {
  return jsonFetch("/api/v1/integrations/r2-backup/test", { method: "POST" });
}

export function runR2Backup(mode: "auto" | "daily" | "full" = "auto"): Promise<{
  started: boolean;
  target: "r2";
  mode: string;
  log: string;
}> {
  return jsonFetch("/api/v1/integrations/r2-backup/run", {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
}

export type BackupRecord = {
  timestamp: string;
  time: string | null;
  type: "local" | "r2_daily" | "r2_full" | "kodo_full" | "webdav_full" | string;
  target: string;
  status: string;
  detail: string;
  snapshotObjectKey?: string;
  recoverable?: boolean;
  verificationLevel?: "local_manifest" | "uploaded" | "restore_ready" | "upload_acknowledged" | string;
  uploadedCount?: number;
  reusedCount?: number;
};

export type BackupStatus = {
  backupDir: string;
  records: BackupRecord[];
  lastLocal: BackupRecord | null;
  lastR2: BackupRecord | null;
  lastR2Full: BackupRecord | null;
  lastKodo: BackupRecord | null;
  lastWebdav: BackupRecord | null;
  lastAttemptR2: BackupJobAttempt | null;
  lastAttemptKodo: BackupJobAttempt | null;
  lastAttemptWebdav: BackupJobAttempt | null;
  health: {
    local: BackupHealth;
    r2: BackupHealth;
    kodo: BackupHealth;
    webdav: BackupHealth;
  };
};

export type BackupJobAttempt = {
  target: "r2" | "kodo" | "webdav" | string;
  status: "running" | "success" | "failed" | "skipped" | string;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  mode?: string;
};

export type BackupHealth = {
  status: "healthy" | "stale" | "failed" | "running" | "never" | string;
  ageHours: number | null;
  message: string;
};

export function getBackupStatus(limit = 50): Promise<BackupStatus> {
  return jsonFetch<BackupStatus>(`/api/v1/integrations/backup-status?limit=${limit}`);
}

export function prepareR2Restore(snapshotObjectKey = ""): Promise<{
  started: boolean;
  target: "r2";
  action: "prepare_restore";
  snapshotObjectKey: string;
  log: string;
}> {
  return jsonFetch("/api/v1/integrations/r2-backup/prepare-restore", {
    method: "POST",
    body: JSON.stringify({ snapshotObjectKey }),
  });
}

export type KodoColdBackupConfig = {
  configured: boolean;
  enabled: boolean;
  bucket: string;
  uploadUrl: string;
  prefix: string;
  accessKeyHint: string;
  mode: "upload_only" | string;
  readEnabled: false;
  scheduler: { mode: string; managed: boolean; label: string; message: string };
};

export type KodoColdBackupConfigInput = {
  bucket: string;
  uploadUrl: string;
  prefix: string;
  accessKey?: string;
  secretKey?: string;
  enabled: boolean;
};

export function getKodoColdBackupConfig(): Promise<KodoColdBackupConfig> {
  return jsonFetch<KodoColdBackupConfig>("/api/v1/integrations/kodo-cold");
}

export function saveKodoColdBackupConfig(
  body: KodoColdBackupConfigInput,
): Promise<KodoColdBackupConfig> {
  return jsonFetch<KodoColdBackupConfig>("/api/v1/integrations/kodo-cold", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function testKodoColdBackupWrite(): Promise<{
  ok: boolean;
  status: number;
  bucket: string;
  message: string;
}> {
  return jsonFetch("/api/v1/integrations/kodo-cold/test-write", { method: "POST" });
}

export function runKodoColdBackup(): Promise<{
  started: boolean;
  target: "kodo";
  mode: "full";
  log: string;
}> {
  return jsonFetch("/api/v1/integrations/kodo-cold/run", { method: "POST" });
}

export type WebdavBackupConfig = {
  configured: boolean;
  enabled: boolean;
  baseUrl: string;
  remotePath: string;
  username: string;
  usernameHint: string;
  connectionStatus: "configured" | "connected" | "error" | string;
  lastTestedAt: string | null;
  lastSuccessAt: string | null;
  errorSummary: string | null;
  mode: "backup" | string;
  readEnabled: true;
  scheduler: { mode: string; managed: boolean; label: string; message: string };
};

export type WebdavBackupConfigInput = {
  baseUrl: string;
  remotePath: string;
  username: string;
  appPassword?: string;
  enabled: boolean;
};

export function getWebdavBackupConfig(): Promise<WebdavBackupConfig> {
  return jsonFetch<WebdavBackupConfig>("/api/v1/integrations/webdav-backup");
}

export function saveWebdavBackupConfig(body: WebdavBackupConfigInput): Promise<WebdavBackupConfig> {
  return jsonFetch<WebdavBackupConfig>("/api/v1/integrations/webdav-backup", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function testWebdavBackupConnection(): Promise<{
  ok: boolean;
  status: number;
  baseUrl: string;
  remotePath: string;
  message: string;
}> {
  return jsonFetch("/api/v1/integrations/webdav-backup/test", { method: "POST" });
}

export function runWebdavBackup(): Promise<{
  started: boolean;
  target: "webdav";
  mode: "full";
  log: string;
}> {
  return jsonFetch("/api/v1/integrations/webdav-backup/run", { method: "POST" });
}

export type ExceptionRow = {
  id: number;
  code: string;
  type: string;
  severity: string;
  title: string;
  detail: Record<string, unknown>;
  status: string;
  createdAt: string | null;
  handledBy: string;
  note: string;
};

export async function getExceptions(): Promise<ExceptionRow[]> {
  const res = await authenticatedFetch("/api/v1/exceptions", {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`exceptions ${res.status}`);
  return res.json();
}

export async function updateExceptionStatus(
  id: number,
  status: string,
  note: string
): Promise<{ ok: boolean; status: string; workflow?: { purchaseStatus?: string; adjustmentAmount?: string } }> {
  const res = await authenticatedFetch(`/api/v1/exceptions/${id}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, note }),
  });
  if (!res.ok) throw new Error(`异常处理失败（${res.status}）`);
  return res.json();
}
