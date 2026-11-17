/** 吉客云客户端文件导入（由 lib/api.ts 拆分，逻辑未改动） */
import { authenticatedFetch, jsonFetch, readErrorDetail } from "./client";

export type JackyunFileImportRow = {
  id: number;
  originalName: string;
  size: number;
  sha256: string;
  reportType: string;
  status: string;
  lifecycle: string;
  lifecycleChangedAt: string | null;
  sheetName: string;
  headers: string[];
  rowCount: number;
  stagedRowCount: number;
  errorSummary: string;
  uploader: string;
  parsedAt: string | null;
  createdAt: string | null;
  /** 确认时后端按表头自动映射的结果（采购单 / 入库申请单货品 / 无匹配则仅存档）。 */
  mapResult?: {
    ok: boolean;
    mapper?: string;
    skipped?: boolean;
    reason?: string;
    documents?: number;
    matched?: number;
    matchedItems?: number;
    filledFields?: number;
    sourceRows?: number;
    relationshipRows?: number;
    uniqueRelationships?: number;
    createdLinks?: number;
    alreadyLinked?: number;
    pendingLinks?: number;
    rejectedLinks?: number;
    createdExternalOrders?: number;
    externalOrderNos?: string[];
    allocSeeded?: number;
    missingRk?: string[];
    mapped?: number;
    updated?: number;
    error?: string;
  };
  /** 采购报表确认时后端自动映射为业务采购单的结果（其他类型无此字段）。 */
  mapPurchase?: {
    ok: boolean;
    detailReport?: boolean;
    groups?: number;
    mapped?: number;
    updated?: number;
    skipped?: { row: number; reason: string }[];
    error?: string;
  };
};

export type SupplierRecord = {
  id: number;
  partnerId: number | null;
  name: string;
  platform: string;
  externalShopId: string;
  contact: string;
  taxNo: string;
  phone: string;
  address: string;
  notes: string;
  isTemp: boolean;
  purchaseType: "regular" | "temporary";
  orderCount?: number;
  formerNames: string[];
  createdAt: string | null;
};

export type SupplierInput = {
  name: string;
  platform?: string;
  externalShopId?: string;
  contact?: string;
  taxNo?: string;
  phone?: string;
  address?: string;
  notes?: string;
  isTemp?: boolean;
};

export const supplierApi = {
  list: (keyword = "", status = "all") =>
    jsonFetch<SupplierRecord[]>(
      `/api/v1/suppliers?keyword=${encodeURIComponent(keyword)}&status=${encodeURIComponent(status)}`,
    ),
  create: async (payload: SupplierInput) => {
    const res = await authenticatedFetch("/api/v1/suppliers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(await readErrorDetail(res));
    return (await res.json()) as SupplierRecord;
  },
  update: async (id: number, payload: SupplierInput) => {
    const res = await authenticatedFetch(`/api/v1/suppliers/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(await readErrorDetail(res));
    return (await res.json()) as SupplierRecord;
  },
  remove: async (id: number) => {
    const res = await authenticatedFetch(`/api/v1/suppliers/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(await readErrorDetail(res));
    return (await res.json()) as { ok: boolean };
  },
  resolve: (taxNos: string[]) =>
    jsonFetch<{ matched: Record<string, { id: number; name: string; isTemp: boolean }>; unmatched: string[] }>(
      "/api/v1/suppliers/resolve",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taxNos }) },
    ),
};
