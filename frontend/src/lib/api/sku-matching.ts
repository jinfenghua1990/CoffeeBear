/** SKU 匹配工作台（由 lib/api.ts 拆分，逻辑未改动） */
import type { CatalogSkuRow } from "./dashboard";
import { jsonFetch } from "./client";

export type InboundMatchAnomaly = {
  itemId: number;
  documentId: number;
  goodsdocNo: string;
  goodsNo: string;
  goodsName: string;
  quantity: number | null;
  amountTax: number | null;
  matchedSkuId: number | null;
  status: string;
  note: string;
};

export type InboundMatchSummary = {
  total: number;
  counts: Record<string, number>;
  anomalies: InboundMatchAnomaly[];
  manualMatches: InboundMatchAnomaly[];
};

export type SkuCandidate = {
  skuId: number;
  skuCode: string;
  skuName: string;
  barcode: string;
  unit: string;
  defaultCost: number | null;
  reason: string;
};

export type PendingAllocation = {
  poId: number;
  fileOrderId: number | null;
  externalOrderId: string;
  supplierName: string;
  orderedAt: string | null;
  paidAmount: number | null;
  allocationCount: number;
  purchaseStatus: string;
  editable: boolean;
  balance: {
    allocated: number;
    paid: number;
    diff: number;
    balanced: boolean;
    abnormalNote: string;
  };
};

export type AllocationBodyInput = {
  sku_id: number;
  quantity: string;
  amount: string;
  unit_price?: string | null;
};

export const skuMatchingApi = {
  inboundSummary: () => jsonFetch<InboundMatchSummary>("/api/v1/purchase/sku-matching/inbound"),
  runInboundAuto: () =>
    jsonFetch<{ ok: boolean; stats: Record<string, number> }>(
      "/api/v1/purchase/sku-matching/inbound-auto",
      { method: "POST" }
    ),
  runOutboundAuto: () =>
    jsonFetch<{ ok: boolean; stats: Record<string, number> }>(
      "/api/v1/purchase/sku-matching/outbound-auto",
      { method: "POST" }
    ),
  pending: (limit = 50) =>
    jsonFetch<PendingAllocation[]>(`/api/v1/purchase/sku-matching/pending?limit=${limit}`),
  candidates: (poId: number) =>
    jsonFetch<{ poId: number; candidates: SkuCandidate[] }>(
      `/api/v1/purchase/sku-matching/${poId}/candidates`
    ),
  manualInbound: (itemId: number, skuId: number) =>
    jsonFetch<{ ok: boolean }>(`/api/v1/purchase/sku-matching/inbound/${itemId}/manual`, {
      method: "POST",
      body: JSON.stringify({ sku_id: skuId }),
    }),
  clearManualInbound: (itemId: number) =>
    jsonFetch<{ ok: boolean }>(`/api/v1/purchase/sku-matching/inbound/${itemId}/manual`, {
      method: "DELETE",
    }),
  acceptCost: (itemId: number) =>
    jsonFetch<{ ok: boolean; oldCost: string | null; newCost: string }>(
      `/api/v1/purchase/sku-matching/inbound/${itemId}/accept-cost`,
      { method: "POST", body: JSON.stringify({ confirm: true }) }
    ),
  batchAcceptCost: (documentId: number) =>
    jsonFetch<{ ok: boolean; documentId: number; accepted: number; failed: { itemId: number; reason: string }[] }>(
      "/api/v1/purchase/sku-matching/inbound/batch-accept-cost",
      { method: "POST", body: JSON.stringify({ document_id: documentId, confirm: true }) }
    ),
  addAllocation: (poId: number, body: AllocationBodyInput) =>
    jsonFetch<{ id: number; amount: string; balance: Record<string, unknown> }>(
      `/api/v1/purchase/orders/${poId}/allocations`,
      { method: "POST", body: JSON.stringify(body) }
    ),
  skus: () =>
    jsonFetch<CatalogSkuRow[]>("/api/v1/dashboard/products?limit=500"),
};
