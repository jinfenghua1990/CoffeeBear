/** 采购工作台（由 lib/api.ts 拆分，逻辑未改动） */
import type { ChainAllocation, ChainInbound, ChainInvoice, ChainPurchaseOrder } from "./procurement-chain";
import { jsonFetch } from "./client";

export type BoardOverview = {
  todayNewOrders: number;
  todayDelta: number;
  pendingRefine: number;
  pendingPo: number;
  pendingInbound: number;
  pendingInvoice: number;
  paidRate: number;
  paidAmount: number;
  totalAmount: number;
};

export type BoardStepProgress = { label: string; done: boolean };

export type BoardOrderItem = {
  orderId: number;
  orderNo: string;
  supplier: string;
  amount: number | null;
  orderDate: string | null;
  orderStatus: string;
  firstUndone: string | null;
  firstUndoneLabel: string;
  stepProgress: BoardStepProgress[];
};

export type BoardOrderGroup = { label: string; items: BoardOrderItem[] };

export type BoardOrderList = {
  total: number;
  page: number;
  pageSize: number;
  groups: BoardOrderGroup[];
};

export type BoardFlowStep = { no: number; label: string; done: boolean; detail: string };

export type BoardSupplierProfile = {
  supplierName: string;
  badge: string;
  orderCount30d: number;
  totalPurchase: number;
  lastOrderDate: string | null;
  lastRecentLabel: string;
};

export type BoardOftenSku = {
  skuCode: string;
  goodsName: string;
  purchaseCount: number;
  qty: number;
  unitPrice: number;
  amount: number;
};

export type BoardPaymentBreakdown = {
  goodsAmount: number;
  freight: number;
  extra: number;
  discount: number;
  totalDue: number;
  paidAmount: number;
  unpaidAmount: number;
  diffAmount: number;
};

export type BoardOrder = {
  orderId: number;
  orderNo: string;
  supplier: string | null;
  buyer: string | null;
  amount: number | null;
  orderDate: string | null;
  orderStatus: string | null;
  title: string | null;
  freight: number | null;
  discount: number | null;
  goodsTotal: number | null;
};

export type BoardOrderDetail = {
  order: BoardOrder;
  flowStatus: BoardFlowStep[];
  supplierProfile: BoardSupplierProfile | null;
  oftenSkus: BoardOftenSku[];
  allocations: ChainAllocation[];
  purchaseOrders: ChainPurchaseOrder[];
  inbound: ChainInbound[];
  invoice: ChainInvoice[];
  verified: boolean;
  paymentBreakdown: BoardPaymentBreakdown;
};

export const procurementBoardApi = {
  overview: () => jsonFetch<BoardOverview>("/api/v1/procurement-board/overview"),
  orders: (
    params: {
      status?: "all" | "pending" | "refine" | "po" | "inbound" | "invoice" | "done";
      q?: string;
      page?: number;
      pageSize?: number;
    } = {}
  ) => {
    const sp = new URLSearchParams();
    if (params.status && params.status !== "all") sp.set("status", params.status);
    if (params.q) sp.set("q", params.q);
    if (params.page) sp.set("page", String(params.page));
    if (params.pageSize) sp.set("page_size", String(params.pageSize));
    const qs = sp.toString();
    return jsonFetch<BoardOrderList>(`/api/v1/procurement-board/orders${qs ? "?" + qs : ""}`);
  },
  orderDetail: (orderId: number) =>
    jsonFetch<BoardOrderDetail>(`/api/v1/procurement-board/orders/${orderId}/detail`),
};
