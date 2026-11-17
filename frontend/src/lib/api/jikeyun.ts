/** 1688 浏览器直采通道与吉客云 Web 连接器（由 lib/api.ts 拆分，逻辑未改动） */
import { jsonFetch } from "./client";

export type Alibaba1688BrowserStatus = {
  enabled: boolean;
  profileDir: string;
  headless: boolean;
  status: string;
  account: string | null;
  lastSyncAt: string | null;
  lastSyncSummary: string | null;
  lastLoginCheckAt: string | null;
  errorSummary: string | null;
  lastSyncJobId: number | null;
  maxPages: number;
  stopAfterKnown: number;
  lookbackDays: number;
};

export type Alibaba1688BrowserJob = {
  id: number;
  jobType: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  stats: Record<string, unknown>;
  errorSummary: string;
};

export type Alibaba1688SyncMode = "incremental" | "range" | "single";

export type Alibaba1688TimeField = "order_time" | "pay_time";

export type Alibaba1688SyncOptions = {
  mode: Alibaba1688SyncMode;
  startDate?: string;
  endDate?: string;
  orderNo?: string;
  supplier?: string;
  keyword?: string;
  onlyUnfinished?: boolean;
  timeField?: Alibaba1688TimeField;
};

export const alibaba1688BrowserApi = {
  status: () => jsonFetch<Alibaba1688BrowserStatus>("/api/v1/alibaba1688-browser/status"),
  login: () =>
    jsonFetch<{ ok: boolean; taskId: string; status: string; message: string }>(
      "/api/v1/alibaba1688-browser/login",
      { method: "POST" }
    ),
  sync: (options: Alibaba1688SyncOptions = { mode: "incremental" }) =>
    jsonFetch<{ ok: boolean; taskId: string; status: string }>(
      "/api/v1/alibaba1688-browser/sync",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(options) }
    ),
  jobs: (limit = 10) =>
    jsonFetch<Alibaba1688BrowserJob[]>(`/api/v1/alibaba1688-browser/jobs?limit=${limit}`),
};

export type JkyWebStatus = {
  adapter: string;
  status: string;
  sessionUpdatedAt: string | null;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSyncStats: Record<string, unknown>;
  errorSummary: string;
  counts: {
    salesOrders: number;
    salesItems: number;
    stockinOrders: number;
    stockinItems: number;
    totalStockSkus: number;
    warehouseStockRows: number;
  };
};

export type JkyWebJob = {
  id: number;
  jobType: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  stats: Record<string, unknown>;
  errorSummary: string;
};

export const jkyWebApi = {
  status: () => jsonFetch<JkyWebStatus>("/api/v1/jky-web/status"),
  updateSession: (curl: string) =>
    jsonFetch<{ ok: boolean; endpoints: string[]; hasCommonVerify: boolean }>(
      "/api/v1/jky-web/session",
      { method: "POST", body: JSON.stringify({ curl }) }
    ),
  sync: () =>
    jsonFetch<{ ok: boolean; taskId: string; status: string; message: string }>(
      "/api/v1/jky-web/sync",
      { method: "POST" }
    ),
  jobs: (limit = 10) => jsonFetch<JkyWebJob[]>(`/api/v1/jky-web/jobs?limit=${limit}`),
};

export type Alibaba1688OrderPreview = {
  id: number;
  rowStatus: string;
  externalOrderId: string;
  buyerCompanyName: string;
  buyerMemberName: string;
  sellerCompanyName: string;
  sellerMemberName: string;
  goodsTotal: string;
  freight: string;
  discount: string;
  actualPayment: string;
  orderStatus: string;
  orderRemark: string;
  orderTime: string | null;
  payTime: string | null;
};
