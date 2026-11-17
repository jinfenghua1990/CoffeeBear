/** 自动化任务（由 lib/api.ts 拆分，逻辑未改动） */
import { jsonFetch } from "./client";

export type ScheduleItem = { task: string; args: string; label: string; frequency: string };

export type SyncJobRow = {
  id: number; provider: string; jobType: string; status: string;
  startedAt: string | null; finishedAt: string | null;
  stats: Record<string, unknown>; errorSummary: string;
};

export type SyncLogRow = {
  id: number; provider: string; level: string; message: string; jobId: number | null;
};

export const automationApi = {
  schedule: () => jsonFetch<{ items: ScheduleItem[]; note: string }>("/api/v1/automation/schedule"),
  jobs: (limit = 50) => jsonFetch<SyncJobRow[]>(`/api/v1/automation/jobs?limit=${limit}`),
  logs: (limit = 100) => jsonFetch<SyncLogRow[]>(`/api/v1/automation/logs?limit=${limit}`),
  runJackyun: (jobType: string) =>
    jsonFetch<{ ok: boolean; taskId: string; status: string }>(`/api/v1/automation/run/jackyun/${encodeURIComponent(jobType)}`, { method: "POST" }),
  runJkyOrders: () =>
    jsonFetch<{ ok: boolean; taskId: string; status: string }>("/api/v1/jky-orders/sync", { method: "POST" }),
  run1688: () =>
    jsonFetch<{ ok: boolean; taskId: string; status: string }>("/api/v1/automation/run/1688", { method: "POST" }),
};

export type JkyOrderChannel = {
  provider: string;
  label: string;
  priority: number | null;
  configured: boolean;
  status: string;
  verified: boolean;
  lastTestedAt: string | null;
  lastSuccessAt: string | null;
  errorSummary: string | null;
};

export type JkyOrderStatus = {
  providerPriority: string[];
  priorityWarnings: string[];
  channels: JkyOrderChannel[];
  lastRun: {
    id: number | null;
    status: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    stats: Record<string, unknown>;
    errorSummary: string;
  };
  checkpoint: Record<string, unknown>;
};

export const jkyOrderApi = {
  status: () => jsonFetch<JkyOrderStatus>("/api/v1/jky-orders/status"),
  sync: () => automationApi.runJkyOrders(),
};
