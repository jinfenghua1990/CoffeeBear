/** 采购执行中心（5 步骤任务视角）（由 lib/api.ts 拆分，逻辑未改动） */
import { jsonFetch } from "./client";

export type WorkbenchDimension = "1688" | "purchase" | "jackyun" | "tax";

export type WorkbenchStep = {
  key: string;
  no: number;
  label: string;
  short: string;
  dimension: WorkbenchDimension;
  href: string;
  act: string;
  count?: number;
  pct?: number;
};

export type WorkbenchStepState = {
  done: boolean;
  detail: string;
  amount: number | null;
};

export type WorkbenchFunnel = {
  total: number;
  stepTotal: number;
  steps: (WorkbenchStep & { count: number; pct: number })[];
};

export type WorkbenchTodo = {
  total: number;
  pending: number;
  items: (WorkbenchStep & { count: number })[];
};

export type WorkbenchSummary = {
  totalOrders: number;
  newOrders: number;
  pendingSku: number;
  pendingPo: number;
  pendingInbound: number;
  pendingInvoice: number;
  exceptionCount: number;
  goodsOrders: number;
  consumableOrders: number;
  goodsProducing: number;
  goodsInbound: number;
  consumableTransit: number;
  consumableInbound: number;
  transitOrders: number;
  completedOrders: number;
  paidRate: number;
  paidAmount: number;
  totalAmount: number;
  funnel: WorkbenchFunnel;
  todos: WorkbenchTodo;
};

/** 采购工作台异常摘要：由异常中心记录压缩而来，message 为可直接展示的原因。 */

export type WorkbenchExceptionInfo = {
  type: string;
  title: string;
  status: string;
  severity: string;
  reason: string;
  actionRequired: string;
  paidAmount: number | null;
  inboundAmount: number | null;
  difference: number | null;
  suggestedAdjustment: number | null;
  message: string;
  createdAt: string | null;
};

export type WorkbenchOrderItem = {
  orderId: number;
  externalPoId: number | null;
  orderNo: string;
  /** 采购渠道：1688 / pdd（拼多多）/ taobao（淘宝）。后端暂未下发时兜底为 1688。 */
  platform?: string;
  /** 订单类型：goods=正常货品 / consumable=耗材（包材）采购 */
  orderKind?: "goods" | "consumable";
  /** 人工覆盖的类型（goods/consumable/空=自动判定） */
  orderKindOverride?: string;
  supplier: string;
  supplierPartnerId?: number | null;
  amount: number | null;
  paidAmount?: number | null;
  freight: number | null;
  orderDate: string | null;
  orderStatus: string;
  purchaseStatus: string;
  hasException: boolean;
  /** 命中的异常摘要（报错原因，供界面直接展示）。 */
  exceptionInfo?: WorkbenchExceptionInfo[];
  firstUndone: string | null;
  firstUndoneLabel: string;
  firstUndoneShort: string;
  firstUndoneDimension: WorkbenchDimension;
  stepStates: Record<string, WorkbenchStepState>;
  inboundDone: boolean;
  invoiceDone: boolean;
  /** 收尾环节卡点：awaiting_inbound / awaiting_invoice / awaiting_payment / awaiting_verification / done / open */
  closeoutStage?: string | null;
  /** 供应商待开发票：pending=完全未开票 / partial=部分 / done=已开够 / none=无实付可比 */
  invoiceStatus?: "pending" | "partial" | "done" | "none" | string;
  /** 已收票金额（正式税票优先；红冲按有效蓝字净额；旧手工票仅兼容兜底） */
  invoicedAmount?: number | null;
  /** 未开票金额 = 应开票目标 - 有效已收票（负数归 0） */
  invoiceOutstanding?: number | null;
  /** 发票事实是否存在冲突/歧义，需要财务或采购人工复核。 */
  invoiceNeedsReview?: boolean;
  /** 需复核原因；例如一票多单红冲后无法自动判断重新分摊。 */
  invoiceReviewReasons?: string[];
  /** 供应链工作台表格：由已确认 SKU / 原始商品行汇总得到。 */
  productName?: string;
  productQuantity?: number | null;
  productUnit?: string;
  itemCount?: number;
  warehouseName?: string;
  logisticsNo?: string;
  logisticsCompany?: string;
  expectedArrival?: string;
  shipAt?: string;
  jackyunInboundNo?: string;
  remark?: string;
};

export type WorkbenchOrderGroup = { label: string; items: WorkbenchOrderItem[] };

export type WorkbenchOrderList = {
  total: number;
  page: number;
  pageSize: number;
  /** 当前筛选结果合计未开票金额（催票总额） */
  invoiceOutstandingTotal?: number;
  groups: WorkbenchOrderGroup[];
};

export type WorkbenchOrder = {
  orderId: number;
  fileOrderId: number | null;
  externalPoId: number | null;
  orderNo: string;
  inboundReferenceNo?: string;
  /** 采购渠道：1688 / pdd（拼多多）/ taobao（淘宝）。后端暂未下发时兜底为 1688。 */
  platform?: string;
  /** 订单类型：goods=正常货品 / consumable=耗材（包材）采购 */
  orderKind?: "goods" | "consumable";
  /** 人工覆盖的类型（goods/consumable/空=自动判定） */
  orderKindOverride?: string;
  supplier: string | null;
  supplierPartnerId?: number | null;
  buyer: string | null;
  amount: number | null;
  goodsTotal: number | null;
  freight: number | null;
  discount: number | null;
  paidAmount: number | null;
  /** 1688 源单实付大于 0，表示平台付款事实已确认；付款时间可能因导入字段缺失而为空。 */
  paidOn1688?: boolean;
  paidOn1688At?: string | null;
  /** 1688 微调金额：红包等导致开票金额与订单实付的零头差；平衡目标 = 实付 + 微调 */
  adjustmentAmount?: number | null;
  adjustmentNote?: string;
  orderDate: string | null;
  orderStatus: string | null;
  purchaseStatus: string;
  /** 后端根据入库/发票/付款事实计算出的收尾卡点。 */
  closeoutStage?: string | null;
  /** 发票池自动匹配结果：采购订单详情只读展示，不在订单弹窗内人工维护。 */
  invoiceStatus?: "pending" | "partial" | "done" | "needs_review" | "none" | string;
  invoicedAmount?: number | null;
  invoiceOutstanding?: number | null;
  invoiceNeedsReview?: boolean;
  invoiceReviewReasons?: string[];
  /** 采购单步骤按 Excel 口径跳过（吉客云未建采购单、入库闭环即放行） */
  jackyunPoBypassed?: boolean;
  title: string | null;
  hasException: boolean;
  /** 命中的异常摘要（报错原因，供界面直接展示）。 */
  exceptionInfo?: WorkbenchExceptionInfo[];
  logistics?: Record<string, unknown>;
  shipStatus?: string;
  /** 采购订单计划入库仓库；实际入库后以入库单仓库为准。 */
  warehouseId?: number | null;
  warehouseName?: string;
};

export type WorkbenchDetail = {
  order: WorkbenchOrder;
  stepStates: Record<string, WorkbenchStepState>;
  detail: {
    allocations: unknown[];
    orderItems?: unknown[];
    consumable?: unknown | null;
    expenses: unknown[];
    purchaseOrders: unknown[];
    poAmountClosure?: { relevant: boolean; allocTotal: number | null; gap: number | null; closed: boolean } | null;
    inbound: unknown[];
    invoice: unknown[];
    settlement: unknown[];
    unallocatedAmount: number | null;
  };
  stepTotal: number;
  warehouse?: {
    warehouseName: string;
    warehouseId?: number | null;
    targetWarehouseId?: number | null;
    targetWarehouseName?: string;
    jackyunWarehouseId: string;
    isSellable: boolean | null;
    currentStock: number | null;
    inTransitQty: number;
  } | null;
  /** 供应商输入框的联想候选（后端用 supplier_name 索引去重，不再为下拉做全量订单聚合）。 */
  supplierSuggestions?: string[];
  supplierHistory: {
    orderCount: number;
    totalPurchase: number;
    uninvoiced: number;
    lastOrderDate: string | null;
    oftenSkus: { skuCode: string; goodsName: string; count: number }[];
    recentOrders: WorkbenchOrder[];
  } | null;
};

export type WorkbenchSupplierSummary = {
  partnerId: number | null;
  supplierName: string;
  orderCount: number;
  totalPurchase: number;
  uninvoiced: number;
  uninbound: number;
  lastOrderDate: string | null;
  oftenSkus: { skuCode: string; goodsName: string; count: number }[];
};

export type WorkbenchSupplierDetail = WorkbenchSupplierSummary & {
  recentOrders: WorkbenchOrder[];
};

export type InvoiceReconciliation = {
  tolerance: number;
  matchingRule: "invoice_issue_date_cutoff_then_order_date_fifo" | string;
  skippedZeroOrders: number;
  suppliers: Array<{
    partnerId?: number | null; identityKey?: string;
    supplier: string; supplierNorm: string; hasOrders: boolean;
    orderCount: number; orderTotal: number; invoiceCount: number; invoiceTotal: number;
    matchedTotal: number; remainingOrders: number; remainingOrderTotal: number;
    pendingOrders: Array<{ orderId: number; orderNo: string; platform: string; date: string | null;
      orderAmount: number; remaining: number; partial: boolean }>;
    orders: Array<{ orderId: number; orderNo: string; platform: string; date: string | null;
      orderAmount: number; remaining: number }>;
    months: Array<{ month: string; invoices: Array<{
      invoiceId: number; invoiceNo: string; issueDate: string | null; seller: string;
      amount: number; originalAmount?: number; redOffsetAmount?: number; redStatus?: string; invoiceStatusLabel?: string;
      coveredTotal: number; diff: number; status: "matched" | "short";
      shortReason?: "date_cutoff" | "insufficient_orders" | "explicit_link_issue" | null;
      futureOrderCount?: number;
      manualLinked: boolean;
      explicitLinked?: boolean;
      explicitIssues?: string[];
      covered: Array<{ orderId: number; orderNo: string; platform: string; date: string | null;
        orderAmount: number; allocatedAmount?: number; consumed: number; partial: boolean;
        allocationIssue?: boolean;
        source: "manual" | "source_ref" | "auto"; linkId?: number }>;
    }> }>;
  }>;
  expenseSellers: Array<{ partnerId?: number | null; seller: string; invoiceCount: number; invoiceTotal: number }>;
};

export const procurementWorkbenchApi = {
  funnel: () => jsonFetch<WorkbenchFunnel>("/api/v1/procurement-workbench/funnel"),
  todos: () => jsonFetch<WorkbenchTodo>("/api/v1/procurement-workbench/todos"),
  summary: () => jsonFetch<WorkbenchSummary>("/api/v1/procurement-workbench/summary"),
  orders: (
    params: {
      status?: "all" | "pending" | "done" | "order" | "content" | "sku" | "jackyun_po" | "closeout" | "refine" | "po" | "inbound" | "transit" | "invoice" | "exception";
      q?: string;
      sortBy?: "date" | "amount" | "status";
      page?: number;
      pageSize?: number;
      startDate?: string;
      endDate?: string;
      channel?: "all" | "1688" | "pdd" | "taobao" | "other";
      kind?: "all" | "goods" | "consumable";
      warehouse?: string;
    } = {}
  ) => {
    const sp = new URLSearchParams();
    if (params.status && params.status !== "all") sp.set("status", params.status);
    if (params.q) sp.set("q", params.q);
    if (params.sortBy && params.sortBy !== "date") sp.set("sort_by", params.sortBy);
    if (params.page) sp.set("page", String(params.page));
    if (params.pageSize) sp.set("page_size", String(params.pageSize));
    if (params.startDate) sp.set("start_date", params.startDate);
    if (params.endDate) sp.set("end_date", params.endDate);
    if (params.channel && params.channel !== "all") sp.set("channel", params.channel);
    if (params.kind && params.kind !== "all") sp.set("kind", params.kind);
    if (params.warehouse) sp.set("warehouse", params.warehouse);
    const qs = sp.toString();
    return jsonFetch<WorkbenchOrderList>(`/api/v1/procurement-workbench/orders${qs ? "?" + qs : ""}`);
  },
  workbench: (orderId: number) =>
    jsonFetch<WorkbenchDetail>(`/api/v1/procurement-workbench/orders/${orderId}/workbench`),
  softDeleteOrder: (orderId: number) =>
    jsonFetch<{
      ok: boolean;
      orderId: number;
      orderNo: string;
      removedPoIds?: number[];
      removedInboundIds?: number[];
      recoverable?: boolean;
    }>(`/api/v1/procurement-workbench/orders/${orderId}/soft-delete`, { method: "POST" }),
  /** 编辑订单主档（供应商/标题/金额等）：1688 单改源单事实并同步副本，独有单改副本；后端留审计 */
  editOrderMain: (
    orderId: number,
    body: Partial<{
      supplier_name: string;
      title: string;
      external_order_id: string;
      ordered_at: string;
      goods_total: string;
      freight: string;
      discount: string;
      actual_payment: string;
      order_amount: string;
      paid_amount: string;
      platform: string;
      warehouse_id: number | null;
      inbound_no_reference: string;
    }>
  ) =>
    jsonFetch<{ ok: boolean; mode: "file" | "external"; orderNo: string }>(
      `/api/v1/procurement-workbench/orders/${orderId}/main-fields`,
      { method: "PATCH", body: JSON.stringify(body) }
    ),
  /** 人工覆盖订单类型（正品/耗材）：goods / consumable / 空串=恢复自动判定 */
  setOrderKindOverride: (orderId: number, kind: "goods" | "consumable" | "") =>
    jsonFetch<{ orderId: number; orderKindOverride: string }>(
      `/api/v1/procurement-workbench/orders/${orderId}/kind-override`,
      { method: "PATCH", body: JSON.stringify({ kind }) }
    ),
  /** 发票维度对账：V2 以 canonical partnerId 为主，supplier 仅作历史兼容。 */
  invoiceReconciliation: (params?: { partnerId?: number; supplier?: string }) => {
    const q = new URLSearchParams();
    if (params?.partnerId != null) q.set("partner_id", String(params.partnerId));
    if (params?.supplier) q.set("supplier", params.supplier);
    return jsonFetch<InvoiceReconciliation>(
      `/api/v1/procurement-workbench/invoice-reconciliation${q.toString() ? `?${q}` : ""}`
    );
  },
  /** 供应商画像手工微调：把采购订单挂到进项发票（manual 关联，落库） */
  createInvoiceMatch: (invoiceId: number, poId: number) =>
    jsonFetch<{ ok: boolean; id: number }>("/api/v1/procurement-workbench/invoice-match", {
      method: "POST",
      body: JSON.stringify({ invoice_id: invoiceId, po_id: poId }),
    }),
  /** 解除供应商画像里的手工发票匹配 */
  deleteInvoiceMatch: (linkId: number) =>
    jsonFetch<{ ok: boolean }>(`/api/v1/procurement-workbench/invoice-match/${linkId}`, { method: "DELETE" }),
  suppliers: (limit = 200) =>
    jsonFetch<{ total: number; items: WorkbenchSupplierSummary[] }>(
      `/api/v1/procurement-workbench/suppliers?limit=${limit}`
    ),
  supplierDetail: (supplierName: string) =>
    jsonFetch<WorkbenchSupplierDetail>(
      `/api/v1/procurement-workbench/suppliers/${encodeURIComponent(supplierName)}`
    ),
  supplierDetailByPartner: (partnerId: number) =>
    jsonFetch<WorkbenchSupplierDetail>(
      `/api/v1/procurement-workbench/suppliers/by-partner/${partnerId}`
    ),
  /** 供应商改名/归一：该供应商全部订单统一改为新名称，同名自动合并（双副本同步+审计） */
  renameSupplier: (oldName: string, newName: string) =>
    jsonFetch<{ ok: boolean; oldName: string; newName: string; renamedOrders: number; renamedFileOrders: number; merged: boolean }>(
      "/api/v1/procurement-workbench/suppliers/rename",
      { method: "POST", body: JSON.stringify({ old_name: oldName, new_name: newName }) }
    ),
};
