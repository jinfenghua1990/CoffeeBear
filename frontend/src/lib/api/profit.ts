/** 利润中心（由 lib/api.ts 拆分，逻辑未改动） */
import { jsonFetch } from "./client";

export type CostRow = {
  id: number;
  skuId: number;
  skuCode: string;
  skuName: string;
  period: string;
  values: { actual: string | null; purchOrder: string | null; default: string | null; estimated: string | null };
  effectiveCost: string | null;
  effectiveSource: string | null;
  version: number;
};

export type ProfitOverview = {
  skuCount: number;
  snapshotCount: number;
  coverage: Record<string, number>;
  contributionProfitEnabled: boolean;
};

export type ProfitCompute = {
  period: string;
  netSales: string | null;
  goodsCost: string | null;
  grossProfit: string | null;
  costMissingSkus: number[];
  costMissingDetail?: { skuId: number; skuCode: string; skuName: string; quantity: string }[];
  unmappedItems: number[];
  quantityMissingItems: number[];
  costMissing: boolean;
  warning?: string | null;
  error?: string | null;
  note: string;
};

export const profitApi = {
  overview: () => jsonFetch<ProfitOverview>("/api/v1/profit/overview"),
  costs: (year?: number, month?: number) => {
    const q = new URLSearchParams();
    if (year) q.set("period_year", String(year));
    if (month) q.set("period_month", String(month));
    return jsonFetch<CostRow[]>(`/api/v1/profit/costs${q.toString() ? `?${q}` : ""}`);
  },
  upsertCost: (body: Record<string, unknown>) =>
    jsonFetch<{ id: number; version: number }>("/api/v1/profit/costs", { method: "POST", body: JSON.stringify(body) }),
  compute: (year: number, month: number) =>
    jsonFetch<ProfitCompute>(`/api/v1/profit/compute?period_year=${year}&period_month=${month}`),
};
