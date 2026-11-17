/** 采购全链路（由 lib/api.ts 拆分，逻辑未改动） */
import { jsonFetch } from "./client";

/** 环节数据归属维度：1688 导出 / 本平台采购中心 / 吉客云 / 税务 */

export type ChainDimension = "1688" | "purchase" | "jackyun" | "tax";

/** 漏斗统计里的单个环节 */

export type ChainStageStat = {
  key: string;
  no: number;
  label: string;
  short: string;
  dimension: ChainDimension;
  count: number;
  pct: number;
};

/** 单行订单里单个环节的完成状态 */

export type ChainStageState = {
  key: string;
  no: number;
  label: string;
  short: string;
  dimension: ChainDimension;
  done: boolean;
  detail: string;
  amount: number | null;
};

export type ChainOverview = {
  total: number;
  stageTotal: number;
  stages: ChainStageStat[];
  refined: number;
  jackyunLinked: number;
  inbound: number;
  invoiced: number;
  paid: number;
  verified: number;
  pending: number;
};

export type ChainInbound = {
  linkId: number | null;
  targetId: number;
  goodsdocNo: string;
  source?: string;
  isLocal?: boolean;
  platformPurchaseOrderNo?: string;
  externalReferenceNo?: string;
  date: string | null;
  warehouseName: string;
  supplier: string;
  amount: number | null;
  matchMethod: string;
  confidence: number | null;
  note: string;
  consumableUsageDecided: boolean;
  consumableUsageEnabled: boolean | null;
  consumableUsageItems: Array<{
    id: number;
    consumableId: number;
    consumableCode: string;
    consumableName: string;
    unit: string;
    quantity: string;
    note: string;
  }>;
};

export type ChainSettlement = {
  linkId: number;
  targetId: number;
  settlementNo: string;
  date: string | null;
  amount: number | null;
  paidAmount: number | null;
  paid: boolean;
  status: string;
  matchMethod: string;
  confidence: number | null;
  note: string;
};

export type ChainInvoice = {
  invoiceId: number;
  invoiceNo: string;
  amount: number | null;
  issueDate: string | null;
  verified: boolean;
  verifiedMonth: string;
  confirmed: boolean;
};

export type ChainAllocation = {
  id: number;
  skuId: number | null;
  skuCode: string;
  goodsName: string;
  quantity: number | null;
  unitPrice: number | null;
  amount: number | null;
  note: string;
};

export type ChainExpense = {
  id: number;
  expenseType: string;
  amount: number | null;
  note: string;
};

export type ChainPurchaseOrder = {
  id: number;
  purchNo: string;
  supplierName: string;
  amount: number | null;
  status: string;
  linkId?: number;
  relationKind?: string; // ''=普通 / merged=合并 / split=拆分
  allocAmount?: number | null; // 分摊金额
};

export type ChainOrderRow = {
  orderId: number;
  fileOrderId: number | null;
  externalPoId: number | null;
  source: "file" | "workflow";
  orderNo: string;
  platform?: string;
  supplier: string;
  buyer: string;
  amount: number | null;
  paidAmount: number | null;
  title: string;
  orderStatus: string;
  orderDate: string | null;
  purchaseStatus: string;
  purchaseContentComplete: boolean;
  unallocatedAmount: number | null;
  allocations: ChainAllocation[];
  expenses: ChainExpense[];
  purchaseOrders: ChainPurchaseOrder[];
  inbound: ChainInbound[];
  settlement: ChainSettlement[];
  invoice: ChainInvoice[];
  verified: boolean;
  pendingCount: number;
  /** 7 环节完成状态，顺序即链路顺序 */
  stages: ChainStageState[];
  doneCount: number;
  stageTotal: number;
};

export type PendingLink = {
  kind: "chain" | "settlement" | "invoice";
  linkId: number;
  orderId: number;
  orderNo: string;
  supplier: string;
  targetId: number;
  targetType: string;
  targetNo: string;
  targetAmount: number | null;
  targetDate: string | null;
  targetSupplier: string;
  confidence: number | null;
  note: string;
};

export type ChainWorkspace = {
  overview: ChainOverview;
  orders: { total: number; items: ChainOrderRow[] };
  pending: { items: PendingLink[] };
};

/** 单订单详情内的待确认关联建议。 */

export type ChainSuggestion = {
  kind: "chain" | "settlement" | "invoice";
  linkId: number;
  targetId: number;
  targetType: string;
  targetNo: string;
  targetAmount: number | null;
  targetDate: string | null;
  targetSupplier: string;
  confidence: number | null;
  note: string;
};

export type ChainLinkItemDetail = {
  goodsName: string;
  spec: string;
  quantity: number | null;
  applyQuantity: number | null;
  remainQuantity: number | null;
  barcode: string;
  unitName: string;
  unitPriceTax: number | null;
  amountTax: number | null;
  skuId: number | null;
  matchStatus: string;
};

export type ChainLinkCandidate = {
  targetId: number;
  targetType: "inbound" | "settlement";
  targetNo: string;
  targetAmount: number | null;
  targetDate: string | null;
  targetSupplier: string;
  warehouseName: string;
  score: number;
  reason: string;
  requiredSkuCount: number;
  matchedSkuCount: number;
  skuOverlapRatio: number | null;
  linkId: number | null;
  currentlyLinked: boolean;
  pendingSuggestion: boolean;
  previouslyRejected: boolean;
  linkedOrderNos: string[];
  details: ChainLinkItemDetail[];
};

/** 多因子预关联执行结果。 */

export type PreLinkItem = {
  orderNo: string;
  orderId: number;
  goodsdocNo: string;
  targetId: number;
  score: string;
  reason: string;
  linkId: number;
};

export type PreLinkResult = {
  autoLinked: PreLinkItem[];
  pendingSuggested: PreLinkItem[];
  stats: {
    autoLinked: number;
    pendingSuggested: number;
    fullyLinkedOrders: number;
    noAllocOrders: number;
  };
  autoConfirmed?: {
    confirmedChain?: number;
    resolvedInboundUsage?: number;
    confirmedInvoices?: number;
    skippedOrphans?: number;
    allocSeeded?: number;
    allocSkipped?: number;
    seedError?: string;
  };
};

/** 1688↔RK 对照表预览/应用结果。 */

export type XrefPreview = {
  totalXrefRows: number;
  totalPairs: number;
  stats: {
    to_create: number;
    missing_order: number;
    missing_rk: number;
    already_linked: number;
    combo_skipped: number;
    existing_noise: number;
  };
  toCreate: Array<{
    order_no: string;
    rk_no: string;
    barcodes: string[];
    products: string[];
    qty_boxes: number;
    note_extra: string;
  }>;
  missingOrder: string[];
  missingRk: string[];
  noiseLinkCount: number;
};

export type XrefApplyResult = {
  created: number;
  total_xref_rows: number;
  total_pairs: number;
  missing_order: string[];
  missing_rk: string[];
  combo_skipped_count: number;
  already_linked_count: number;
  noise_links: Array<{ id: number; target_id: number; order_id: number | null }>;
};

export type XrefFile = {
  exists: boolean;
  content: string;
  modifiedAt: number | null;
  size: number;
};

/** 二级页面：单订单链路详情。 */

export type ChainOrderDetail = ChainOrderRow & {
  suggestions: ChainSuggestion[];
  supplierHistory?: ChainSupplierHistory;
};

/** 采购执行中心顶部统计卡。 */

export type ExecutionOverview = {
  totalOrders: number;
  pendingProcess: number;
  pendingRefine: number;
  pendingSku: number;
  pendingPo: number;
  pendingInvoice: number;
};

/** 常购 SKU（供应商维度）。 */

export type OftenSku = {
  skuCode: string;
  goodsName: string;
  count: number;
};

/** 供应商历史（订单详情右侧展示）。 */

export type ChainSupplierHistory = {
  orderCount: number;
  totalPurchase: number;
  uninvoiced: number;
  lastOrderDate: string | null;
  oftenSkus: OftenSku[];
  recentOrders: ChainOrderRow[];
};

/** 供应商聚合列表项。 */

export type SupplierSummary = ChainSupplierHistory & {
  supplierName: string;
  uninbound: number;
};

/** 平铺全量记录：每行一条单据，标记数据维度与环节。 */

export type ChainRecord = {
  recordId: string;
  dimension: "1688" | "jackyun" | "tax";
  stage: "order" | "inbound" | "settlement" | "invoice";
  no: string;
  counterparty: string;
  amount: number | null;
  date: string | null;
  status: string;
  statusTone: "ok" | "warn" | "info" | "muted";
  linkedOrderNos: string[];
  pendingCount: number;
  invoiceId: number | null;
  verified: boolean;
  verifiedMonth: string;
};

export type ChainRecordList = {
  total: number;
  items: ChainRecord[];
};

export const procurementChainApi = {
  workspace: (limit = 500) =>
    jsonFetch<ChainWorkspace>(`/api/v1/procurement-chain/workspace?limit=${limit}`),
  overview: () => jsonFetch<ChainOverview>("/api/v1/procurement-chain/overview"),
  orders: (limit = 500) =>
    jsonFetch<{ total: number; items: ChainOrderRow[] }>(`/api/v1/procurement-chain/orders?limit=${limit}`),
  records: (limit = 2000) =>
    jsonFetch<ChainRecordList>(`/api/v1/procurement-chain/records?limit=${limit}`),
  pending: () => jsonFetch<{ items: PendingLink[] }>("/api/v1/procurement-chain/pending"),
  candidates: (orderId: number, targetType: "inbound" | "settlement", q = "", limit = 100) => {
    const sp = new URLSearchParams({ order_id: String(orderId), target_type: targetType, limit: String(limit) });
    if (q) sp.set("q", q);
    return jsonFetch<{ total: number; items: ChainLinkCandidate[] }>(`/api/v1/procurement-chain/candidates?${sp}`);
  },
  orderDetail: (orderId: number) =>
    jsonFetch<ChainOrderDetail>(`/api/v1/procurement-chain/orders/${orderId}`),
  executionOverview: () => jsonFetch<ExecutionOverview>("/api/v1/procurement-chain/execution-overview"),
  suppliers: (limit = 200) =>
    jsonFetch<{ total: number; items: SupplierSummary[] }>(`/api/v1/procurement-chain/suppliers?limit=${limit}`),
  supplierDetail: (supplierName: string) =>
    jsonFetch<SupplierSummary>(`/api/v1/procurement-chain/suppliers/${encodeURIComponent(supplierName)}`),
  runMatch: (autoConfirm = true) =>
    jsonFetch<{ created: number; skipped: number; requiresConfirmation: boolean; [key: string]: unknown }>(
      `/api/v1/procurement-chain/run-match${autoConfirm ? "" : "?auto_confirm=false"}`,
      { method: "POST" }
    ),
  autoConfirm: () =>
    jsonFetch<{
      confirmedChain: number;
      resolvedInboundUsage: number;
      confirmedInvoices: number;
      skippedOrphans: number;
      allocSeeded: number;
      allocSkipped: number;
      seedError: string;
    }>("/api/v1/procurement-chain/auto-confirm", { method: "POST" }),
  prelink: (auto = true) =>
    jsonFetch<PreLinkResult>("/api/v1/procurement-chain/prelink", {
      method: "POST",
      body: JSON.stringify({ auto }),
    }),
  xrefFile: () => jsonFetch<XrefFile>("/api/v1/procurement-chain/xref/file"),
  xrefPreview: (content: string) =>
    jsonFetch<XrefPreview>("/api/v1/procurement-chain/xref/preview", {
      method: "POST",
      body: JSON.stringify({ content, persist_to_file: false }),
    }),
  xrefApply: (content: string, persistToFile = true) =>
    jsonFetch<XrefApplyResult>("/api/v1/procurement-chain/xref/apply", {
      method: "POST",
      body: JSON.stringify({ content, persist_to_file: persistToFile }),
    }),
  confirmLink: (linkId: number) =>
    jsonFetch<{ id: number; confirmed: boolean }>(`/api/v1/procurement-chain/links/${linkId}/confirm`, { method: "POST" }),
  deleteLink: (linkId: number) =>
    jsonFetch<{ ok: boolean }>(`/api/v1/procurement-chain/links/${linkId}`, { method: "DELETE" }),
  confirmInvoiceLink: (linkId: number) =>
    jsonFetch<{ id: number; confirmed: boolean }>(`/api/v1/procurement-chain/invoice-links/${linkId}/confirm`, { method: "POST" }),
  deleteInvoiceLink: (linkId: number) =>
    jsonFetch<{ ok: boolean }>(`/api/v1/procurement-chain/invoice-links/${linkId}`, { method: "DELETE" }),
  verifyInvoice: (invoiceId: number, verified: boolean, verifiedMonth: string) =>
    jsonFetch<{ invoiceId: number; verified: boolean; verifiedMonth: string }>(
      `/api/v1/procurement-chain/invoices/${invoiceId}/verify`,
      { method: "POST", body: JSON.stringify({ verified, verified_month: verifiedMonth }) }
    ),
  manualLink: (orderId: number, targetType: string, targetId: number, note: string, consumableUsageEnabled?: boolean, consumableUsageItems?: Array<{ consumable_id: number; quantity: string }>) =>
    jsonFetch<{ id: number; confirmed: boolean }>("/api/v1/procurement-chain/links", {
      method: "POST",
      body: JSON.stringify({ order_id: orderId, target_type: targetType, target_id: targetId, note, consumable_usage_enabled: consumableUsageEnabled, consumable_usage_items: consumableUsageItems ?? [] }),
    }),
  autoLinkSettlement: (orderId: number) =>
    jsonFetch<{ linked: boolean; settlementNo?: string; reason?: string }>(`/api/v1/procurement-chain/orders/${orderId}/auto-link-settlement`, { method: "POST" }),
  manualInvoiceLink: (orderId: number, invoiceId: number, note: string) =>
    jsonFetch<{ id: number; confirmed: boolean }>("/api/v1/procurement-chain/invoice-links", {
      method: "POST",
      body: JSON.stringify({ order_id: orderId, invoice_id: invoiceId, note }),
    }),
  replaceLink: (linkId: number, targetId: number, note: string, consumableUsageEnabled?: boolean, consumableUsageItems?: Array<{ consumable_id: number; quantity: string }>) =>
    jsonFetch<{ id: number; confirmed: boolean; targetId: number }>(`/api/v1/procurement-chain/links/${linkId}`, {
      method: "PUT",
      body: JSON.stringify({ target_id: targetId, note, consumable_usage_enabled: consumableUsageEnabled, consumable_usage_items: consumableUsageItems ?? [] }),
    }),
  setInboundConsumableUsage: (linkId: number, enabled: boolean, items: Array<{ consumable_id: number; quantity: string }>, note = "") =>
    jsonFetch<{ linkId: number; decided: boolean; enabled: boolean }>(`/api/v1/procurement-chain/links/${linkId}/consumable-usage`, {
      method: "POST",
      body: JSON.stringify({ enabled, items, note }),
    }),
  correctInboundAmount: (documentId: number, amount: string, note = "") =>
    jsonFetch<{ ok: boolean; documentId: number; amount: string }>(`/api/v1/procurement-chain/inbound-documents/${documentId}/amount`, {
      method: "PATCH",
      body: JSON.stringify({ amount, note }),
    }),
  recalcInboundAmount: (documentId: number) =>
    jsonFetch<{ ok: boolean; before: string | null; after: string }>(`/api/v1/procurement-chain/inbound-documents/${documentId}/recalc-amount`, {
      method: "POST",
    }),
  correctInboundDate: (documentId: number, inboundAt: string, note = "") =>
    jsonFetch<{ ok: boolean; documentId: number; before: string | null; after: string }>(`/api/v1/procurement-chain/inbound-documents/${documentId}/date`, {
      method: "PATCH",
      body: JSON.stringify({ inbound_at: inboundAt, note }),
    }),
  /** 更正入库单号：本系统与吉客云独立运行，单号靠人工在两边保持一致 */
  correctInboundNo: (documentId: number, goodsdocNo: string, note = "") =>
    jsonFetch<{ ok: boolean; documentId: number; before: string | null; after: string; changed: boolean }>(`/api/v1/procurement-chain/inbound-documents/${documentId}/no`, {
      method: "PATCH",
      body: JSON.stringify({ goodsdoc_no: goodsdocNo, note }),
    }),
  correctInboundItemPrice: (documentId: number, itemId: number, unitPriceTax: string, note = "") =>
    jsonFetch<{
      ok: boolean;
      documentId: number;
      itemId: number;
      lineNo: number;
      before: string | null;
      after: string;
      amountTaxAfter: string | null;
      documentAmountAfter: string;
    }>(`/api/v1/procurement-chain/inbound-documents/${documentId}/items/${itemId}/price`, {
      method: "PATCH",
      body: JSON.stringify({ unit_price_tax: unitPriceTax, note }),
    }),
  correctInboundItemQuantity: (documentId: number, itemId: number, quantity: string, note = "") =>
    jsonFetch<{
      ok: boolean;
      documentId: number;
      itemId: number;
      lineNo: number;
      before: string | null;
      after: string;
      amountTaxAfter: string | null;
      documentQuantityAfter: string;
      documentAmountAfter: string;
    }>(`/api/v1/procurement-chain/inbound-documents/${documentId}/items/${itemId}/quantity`, {
      method: "PATCH",
      body: JSON.stringify({ quantity, note }),
    }),
  createLocalInbound: (body: {
    order_id: number;
    inbound_no?: string;
    inbound_at?: string | null;
    warehouse_id?: number | null;
    note?: string;
    items: Array<{ allocation_id: number; quantity: string; unit_price?: string | null }>;
    consumable_usage_enabled?: boolean | null;
    consumable_usage_items?: Array<{ consumable_id: number; quantity: string }>;
  }) => jsonFetch<{
    ok: boolean;
    documentId: number;
    inboundNo: string;
    linkId: number;
    source: string;
    usage: { status: string; items: unknown[] };
  }>("/api/v1/procurement-chain/local-inbounds", { method: "POST", body: JSON.stringify(body) }),
  deleteLocalInbound: (documentId: number) =>
    jsonFetch<{ ok: boolean; documentId: number; inboundNo: string }>(
      `/api/v1/procurement-chain/inbound-documents/${documentId}`,
      { method: "DELETE" },
    ),
};
