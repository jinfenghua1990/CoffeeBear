/** 其他渠道采购订单主档与 1688 订单导入（由 lib/api.ts 拆分，逻辑未改动） */
import type { Alibaba1688OrderPreview } from "./jikeyun";
import { authenticatedFetch, detailToMessage, jsonFetch, noContentFetch } from "./client";

export type ExternalPurchaseOrderRow = {
  id: number;
  externalOrderId: string;
  platform: "pdd" | "taobao" | "other" | "1688" | string;
  buyerAccount: string;
  supplierName: string;
  title: string;
  orderAmount: string | null;
  paidAmount: string | null;
  orderedAt: string | null;
  orderStatus: string;
  purchaseStatus: string;
  unallocated: string;
  balanced: boolean;
  source: string;
  sourceImportId: number | null;
};

export const externalPurchaseOrderApi = {
  list: (query = "") => {
    const qs = new URLSearchParams({ platform: "non_1688" });
    if (query.trim()) qs.set("q", query.trim());
    return jsonFetch<ExternalPurchaseOrderRow[]>(`/api/v1/purchase/orders?${qs}`);
  },
  create: (body: {
    external_order_id: string;
    platform: string;
    supplier_name: string;
    title?: string;
    ordered_at?: string | null;
    order_amount?: string | null;
    paid_amount?: string | null;
  }) => jsonFetch<{ id: number; workbenchOrderId: number; externalOrderId: string }>(
    "/api/v1/purchase/orders",
    { method: "POST", body: JSON.stringify(body) }
  ),
  update: (id: number, body: {
    platform?: string;
    supplier_name?: string;
    title?: string;
    ordered_at?: string | null;
    order_amount?: string;
    paid_amount?: string;
  }) => jsonFetch<{ ok: boolean; id: number; externalOrderId: string; platform: string }>(
    `/api/v1/purchase/orders/${id}`,
    { method: "PATCH", body: JSON.stringify(body) }
  ),
};

export type JackyunRecordPreview = {
  rowIndex: number;
  rowStatus: string;
  payload: Record<string, string>;
};

export type Alibaba1688ImportRow = {
  id: number;
  fileName: string;
  fileHash: string;
  fileSize: number;
  orderCount: number;
  status: string;
  lifecycle: string;
  lifecycleChangedAt: string | null;
  errorMessage: string | null;
  uploader: string;
  createdAt: string | null;
};

export const alibaba1688Api = {
  imports: (lifecycle?: string) => {
    const q = lifecycle ? `?lifecycle=${encodeURIComponent(lifecycle)}` : "";
    return jsonFetch<Alibaba1688ImportRow[]>(`/api/v1/alibaba1688-imports/imports${q}`);
  },
  upload: async (file: File, autoConfirm = false) => {
    const form = new FormData();
    form.append("file", file);
    const query = `?auto_confirm=${autoConfirm ? "true" : "false"}`;
    const res = await authenticatedFetch(`/api/v1/alibaba1688-imports/upload${query}`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { detail?: unknown };
      throw new Error(detailToMessage(body.detail, `上传失败（${res.status}）`));
    }
    return res.json() as Promise<{
      duplicate: boolean;
      lifecycle: string;
      import: Alibaba1688ImportRow;
      message?: string;
      import_id?: number;
      order_count?: number;
    }>;
  },
  confirm: (id: number) =>
    jsonFetch<Alibaba1688ImportRow>(`/api/v1/alibaba1688-imports/imports/${id}/confirm`, { method: "POST" }),
  softDelete: (id: number) => noContentFetch(`/api/v1/alibaba1688-imports/imports/${id}`),
  restore: (id: number) =>
    jsonFetch<Alibaba1688ImportRow>(`/api/v1/alibaba1688-imports/imports/${id}/restore`, { method: "POST" }),
  orders: (id: number) =>
    jsonFetch<Alibaba1688OrderPreview[]>(`/api/v1/alibaba1688-imports/imports/${id}/orders`),
  deleteRow: (id: number, orderId: number) =>
    noContentFetch(`/api/v1/alibaba1688-imports/imports/${id}/orders/${orderId}`),
  restoreRow: (id: number, orderId: number) =>
    jsonFetch<Alibaba1688OrderPreview>(
      `/api/v1/alibaba1688-imports/imports/${id}/orders/${orderId}/restore`,
      { method: "POST" }
    ),
};
