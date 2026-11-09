/** 期初初始化与月结快照（由 lib/api.ts 拆分，逻辑未改动） */
import { jsonFetch } from "./client";

export type OpeningRow = {
  id: number; kind: string; ref: string; amount: string | null; quantity: string | null;
  asOfDate: string | null; note: string; createdAt: string | null;
};

export type OpeningData = {
  summary: { byKind: Record<string, string>; adjustmentCount: number; differencePool: string; skuWithCost: number };
  items: OpeningRow[];
};

export const openingApi = {
  list: () => jsonFetch<OpeningData>("/api/v1/opening"),
  upsert: (body: Record<string, unknown>) =>
    jsonFetch<{ id: number }>("/api/v1/opening", { method: "POST", body: JSON.stringify(body) }),
  remove: (id: number) => jsonFetch<{ ok: boolean }>(`/api/v1/opening/${id}`, { method: "DELETE" }),
  adjust: (id: number, delta: string, reason: string) =>
    jsonFetch<{ id: number; delta: string }>(`/api/v1/opening/${id}/adjust`, {
      method: "POST",
      body: JSON.stringify({ delta, reason }),
    }),
};

export type ClosingRow = {
  id: number; periodId: number; version: number; isCurrent: boolean; period: string;
  calculatedAt: string | null; grossProfit: string | null;
  receivable: string | null; received: string | null; createdAt: string | null;
};

export const closingApi = {
  versions: (year?: number, month?: number) => {
    const q = new URLSearchParams();
    if (year) q.set("year", String(year));
    if (month) q.set("month", String(month));
    return jsonFetch<ClosingRow[]>(`/api/v1/closing/versions${q.toString() ? `?${q}` : ""}`);
  },
  snapshot: (year: number, month: number) =>
    jsonFetch<{ id: number; version: number; period: string; note?: string }>("/api/v1/closing/snapshot", {
      method: "POST",
      body: JSON.stringify({ year, month }),
    }),
  recalc: (year: number, month: number) =>
    jsonFetch<{ id: number; version: number; period: string; note: string }>("/api/v1/closing/recalc", {
      method: "POST",
      body: JSON.stringify({ year, month }),
    }),
};
