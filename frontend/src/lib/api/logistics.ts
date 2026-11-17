/** 快递物流成本管理（由 lib/api.ts 拆分，逻辑未改动） */
import { authenticatedFetch, detailToMessage, jsonFetch } from "./client";

export type LogisticsMonthRow = {
  type: "month" | "bill";
  period: string;
  periodLabel: string;
  carrier: string;
  billId: number | null;
  shippedCount: number;
  unitPrice: string | null;
  unitPriceSource?: "smart" | "default";
  estimatedAmount: string;
  actualAmount: string | null;
  actualUnitPrice: string | null;
  difference: string | null;
  status: string;
  statusLabel: string;
  invoiceStatus: string;
};

export type LogisticsRegionalModel = {
  month: string;
  province: string;
  carrier: string;
  weightBand: string;
  sampleCount: number;
  avgFee: string;
  medianFee: string;
  confidence: "high" | "medium" | "low";
};

export type LogisticsSmartEstimate = {
  available: boolean;
  sampleCount: number;
  averageFee: string | null;
  suggestedUnitPrice: string | null;
  confidence: "high" | "medium" | "low" | "none";
  method: string;
};

export type LogisticsWorkbench = {
  cards: {
    monthShippedCount: number;
    monthEstimatedAmount: string;
    pendingEstimatedAmount: string;
    latestActualUnitPrice: string | null;
    annualLogisticsCost: string;
    estimateUnitPrice?: string;
    estimateUnitPriceSource?: "smart" | "default";
  };
  months: LogisticsMonthRow[];
  settings: { defaultUnitPrice: string };
  smartEstimate?: LogisticsSmartEstimate;
  regionalModels?: LogisticsRegionalModel[];
};

export type LogisticsBill = {
  id: number;
  periodLabel: string;
  periodStart: string | null;
  periodEnd: string | null;
  carrier: string;
  waybillCount: number | null;
  estimatedAmount: string | null;
  actualAmount: string | null;
  actualUnitPrice: string | null;
  difference: string | null;
  status: string;
  statusLabel: string;
  invoiceStatus: string;
  invoiceStatusLabel: string;
  note: string;
  attachmentName?: string;
  importSource?: string | null;
  importSummary?: {
    summaryWarehouse?: string;
    detailWarehouse?: string;
    shippingAmount?: string;
    pickupAmount?: string;
    valueAddedAmount?: string;
    grossAmount?: string;
    adjustmentAmount?: string;
    actualAmount?: string;
    directChargeAmount?: string;
    overheadFactor?: string;
  } | null;
  matchedCount: number | null;
  unmatchedCount: number | null;
  duplicateCount: number | null;
  abnormalCount: number | null;
  createdAt: string | null;
};

export type LogisticsBillImportPreview = {
  fileName: string;
  fileHash: string;
  duplicateBillId: number | null;
  periodLabel: string;
  periodStart: string | null;
  periodEnd: string | null;
  summaryWarehouse: string;
  detailWarehouse: string;
  carrier: string;
  carriers: Array<{ name: string; count: number }>;
  shipmentCount: number;
  pickupCount: number;
  waybillCount: number;
  shippingAmount: string;
  pickupAmount: string;
  valueAddedAmount: string;
  grossAmount: string;
  adjustmentAmount: string;
  actualAmount: string;
  directChargeAmount: string;
  overheadFactor: string;
  matchedCount: number;
  unmatchedCount: number;
  duplicateCount: number;
  abnormalCount: number;
  warnings: string[];
  regionalModels: LogisticsRegionalModel[];
  sampleRows: Array<Record<string, unknown>>;
};

export const logisticsApi = {
  workbench: () => jsonFetch<LogisticsWorkbench>("/api/v1/logistics/workbench"),
  settings: () => jsonFetch<{ defaultUnitPrice: string }>("/api/v1/logistics/settings"),
  updateSetting: (defaultUnitPrice: string) =>
    jsonFetch<{ defaultUnitPrice: string }>("/api/v1/logistics/settings", {
      method: "PUT",
      body: JSON.stringify({ default_unit_price: defaultUnitPrice }),
    }),
  bills: () => jsonFetch<{ items: LogisticsBill[] }>("/api/v1/logistics/bills"),
  bill: (id: number) => jsonFetch<LogisticsBill>(`/api/v1/logistics/bills/${id}`),
  importBillXlsx: async (file: File, confirm = false) => {
    const form = new FormData();
    form.append("file", file);
    const res = await authenticatedFetch(`/api/v1/logistics/bills/import-xlsx?confirm=${confirm ? "true" : "false"}`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { detail?: unknown };
      throw new Error(detailToMessage(body.detail, `物流账单导入失败（${res.status}）`));
    }
    return res.json() as Promise<{ ok: boolean; preview: LogisticsBillImportPreview; bill?: LogisticsBill }>;
  },
  createBill: (body: Record<string, unknown>) =>
    jsonFetch<LogisticsBill>("/api/v1/logistics/bills", { method: "POST", body: JSON.stringify(body) }),
  settleBill: (id: number) =>
    jsonFetch<LogisticsBill>(`/api/v1/logistics/bills/${id}/settle`, { method: "POST" }),
  deleteBill: (id: number) =>
    jsonFetch<{ ok: boolean }>(`/api/v1/logistics/bills/${id}`, { method: "DELETE" }),
};
