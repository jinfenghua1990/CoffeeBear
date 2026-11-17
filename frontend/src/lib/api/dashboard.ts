/** 经营看板（由 lib/api.ts 拆分，逻辑未改动） */
import { authenticatedFetch, detailToMessage, jsonFetch, jsonFetchWithNetworkRetry } from "./client";

export type TrendPoint = { date: string; orders: number; salesAmount: string | null; costAmount?: string | null; grossProfit?: string | null; costIncomplete?: boolean };

export type PlatformRow = { platform: string; orders: number; salesAmount: string | null; costAmount?: string | null; grossProfit?: string | null; costIncomplete?: boolean };

export type SkuRow = { skuCode: string; goodsName: string; orders: number; salesAmount: string | null };

export type InventorySummary = {
  skuCount: number;
  lastDocumentAt: string | null;
  totalQuantity: string | null;
  byWarehouse: { warehouseId: number | null; warehouseName?: string; quantity: string | null; skus: number }[];
  positionSource?: string;
  appliedDocumentCount?: number;
  note?: string;
};

/** 正品 SKU 逐笔出入库流水行：来自吉客云入库/出库单明细的真实单据事实。 */

export type SkuTransactionRow = {
  occurredAt: string | null;
  direction: "inbound" | "outbound";
  documentNo: string;
  warehouseId: number | null;
  warehouseName: string;
  quantity: number;
  balanceBefore: number;
  balanceAfter: number;
  supplierName: string;
  companyName: string;
  matchedSkuId: number | null;
  matchStatus: string;
};

export type SkuTransactionPayload = {
  sku: {
    skuId: number;
    skuCode: string;
    skuName: string;
    barcode: string;
    unit: string;
    goodsName: string;
  };
  total: number;
  rows: SkuTransactionRow[];
  balance: number;
};

export type InventorySkuRow = {
  skuId: number;
  jackyunSkuId: string;
  skuCode: string;
  productType: "single" | "bundle" | "virtual_bundle";
  skuName: string;
  goodsName: string;
  barcode: string;
  unit: string;
  status: string;
  quantity: string | null;
  hasMovement: boolean;
  warehouses: { warehouseId: number | null; warehouseName: string; quantity: string | null }[];
  lastDocumentAt: string | null;
};

export type SalesOrderRow = {
  id: number; orderNo: string; platform: string; storeName: string;
  orderStatus: string; payStatus: string;
  orderAmount: string | null; paidAmount: string | null; orderedAt: string | null;
  itemName: string; quantity: string | null; itemCount: number;
};

export type AftersaleRow = {
  id: number; aftersaleNo: string; orderNo: string; type: string; status: string;
  refundAmount: string | null; reason: string; createdAt: string | null;
};

export type CatalogSkuRow = {
  id: number; jackyunSkuId: string; skuCode: string; skuName: string; goodsName: string;
  productType: "single" | "bundle" | "virtual_bundle";
  barcode: string; unit: string; salePrice: string | null; defaultCost: string | null;
  costMode: "fixed" | "dynamic"; costTolerancePct: string; taxCode: string;
  taxCategoryRuleId: number | null; taxCategoryRuleName: string; status: string;
  consumablePolicy?: "auto" | "none";
};

export type TaxCategoryRule = {
  id: number; pattern: string; categoryName: string; itemName: string; taxCode: string;
  matchKeyword: string; matchMode: "contains" | "exact" | "prefix";
  priority: number; enabled: boolean; note: string;
};

export type LinkedSkuRef = { skuId: number; skuCode: string; skuName: string };

export type BundleBulkDeleteResult = {
  ok: boolean;
  dryRun: boolean;
  requested: number;
  deleted: number;
  deletedIds: number[];
  blocked: Array<{
    id: number;
    skuCode: string;
    reason: string;
    references: Array<{ label: string; count: number }>;
  }>;
  invalid: Array<{ id: number; skuCode: string; reason: string }>;
  notFound: number[];
};

export type CatalogBulkDeleteItem = { kind: "goods" | "consumable"; id: number };

export type CatalogBulkDeleteResult = {
  ok: boolean;
  dryRun: boolean;
  requested: number;
  deleted: number;
  deletedItems: Array<{ kind: "goods" | "consumable"; id: number; code: string }>;
  blocked: Array<{
    kind: "goods" | "consumable";
    id: number;
    code: string;
    reason: string;
    references: Array<{ label: string; count: number; numbers?: string[] }>;
  }>;
  invalid: Array<{ kind: "goods" | "consumable"; id: number; code: string; reason: string }>;
  notFound: Array<{ kind: "goods" | "consumable"; id: number }>;
};

export type CatalogBulkStatusResult = {
  updated: number;
  items: Array<{ kind: "goods" | "consumable"; id: number; code: string; status: string }>;
  notFound: Array<{ kind: "goods" | "consumable"; id: number }>;
};

/** 统一货品档案行：kind=goods（正品，库存读吉客云快照）/ kind=consumable（耗材，库存本系统三仓维护）。 */

export type UnifiedCatalogRow = {
  kind: "goods" | "consumable";
  id: number; code: string; name: string; goodsName: string;
  jackyunSkuId?: string;
  barcode: string; unit: string; category: string; goodsCategory: string; status: string;
  stockOwn: string | null;   // 正品=独立运算库存；耗材=自有仓
  stockFactory: string | null; // 仅耗材：工厂仓
  stockTransit: string | null; // 仅耗材：在途
  minStock: string | null;   // 仅耗材：安全库存
  lowStock: boolean;         // 仅耗材：可用≤安全库存或负库存
  hasMovement?: boolean;     // 仅正品：是否存在已纳入运算的出入库单据
  linkedSkus: LinkedSkuRef[];
  costMode: "fixed" | "dynamic" | null;
  costTolerancePct: string | null;
  taxCode: string;
  taxCategoryRuleId: number | null;
  taxCategoryRuleName: string;
  salePrice: string | null;
  defaultCost: string | null;
  purchaseUnitCost?: string | null;
};

export type ConsumableRow = {
  id: number; code: string; name: string; barcode: string; category: string; unit: string;
  purchaseUnitCost: string | null; purchasedQty: string; usedQty: string;
  stockQty: string; factoryQty: string; transitQty: string; availableQty: string;
  minStockQty: string; usageRate: string; taxCode: string;
  taxCategoryRuleId: number | null; taxCategoryRuleName: string;
  status: string; mappingCount: number; linkedSkus: LinkedSkuRef[]; lowStock: boolean;
  mappingDetails?: Array<LinkedSkuRef & { usagePerUnit: string | null }>;
  totalStockQty?: string; totalUsedQty?: string; currentStockQty?: string;
  lossQty?: string; adjustmentQty?: string; pendingProductionQty?: string;
  usagePerUnit?: string | null; supportQty?: string | null; coveragePct?: string | null;
  gapQty?: string | null; inventoryStatus?: "正常" | "偏低" | "缺货";
};

export type ConsumableMappingRow = {
  id: number; skuId: number; skuCode: string; skuName: string;
  consumableId: number; consumableCode: string; consumableName: string;
  usagePerUnit: string; note: string;
};

export type ConsumableTransactionRow = {
  id: number; transactionType: string; quantity: string; unitCost: string | null;
  location: string | null; warehouseId: number | null; warehouseCode: string; warehouseName: string;
  stockBefore: string | null; stockAfter: string | null;
  factoryBefore: string | null; factoryAfter: string | null;
  sourceType: string; sourceId: number | null; note: string; occurredAt: string | null;
  purchaseId: number | null; orderId: number | null;
  inboundDocumentId: number | null; inboundDocumentNo: string; inboundDocumentAt: string | null; inboundWarehouseName: string;
};

export type ConsumablePurchaseItem = {
  id: number; consumableId: number; code: string; name: string; unit: string;
  quantity: string; receivedQty: string; unitCost: string;
};

export type ConsumablePurchaseRow = {
  id: number; number: string; supplierName: string; orderedOn: string;
  sourceOrderId: number | null; sourceOrderNo: string | null; referenceNo: string;
  status: "ordered" | "partial" | "received" | "cancelled";
  note: string; amount: string; receivedAmount: string; items: ConsumablePurchaseItem[];
};

export type ConsumablePurchaseDetail = ConsumablePurchaseRow & {
  receipts: Array<{ id: number; number: string; receivedOn: string; note: string; createdBy: string; location: string;
    warehouseId?: number | null; warehouseCode?: string; warehouseName?: string;
    items: Array<{ consumableId: number; name: string; quantity: string; unit: string }> }>;
};

export type ConsumablePurchaseSource = { id: number; orderNo: string; supplierName: string };

export type WarehouseRow = {
  id: number; code: string; name: string; warehouseType: "factory" | "b2c" | "other";
  purpose: "goods" | "consumable" | "both"; isSellable: boolean; status: "active" | "inactive";
  note: string; jackyunWarehouseId: string | null;
};

export const dashboardApi = {
  salesTrend: (days = 30, start?: string, end?: string) =>
    jsonFetch<TrendPoint[]>(`/api/v1/dashboard/sales-trend?days=${days}${start ? `&start=${start}` : ""}${end ? `&end=${end}` : ""}`),
  platformRanking: (start?: string, end?: string) =>
    jsonFetch<PlatformRow[]>(`/api/v1/dashboard/platform-ranking${start ? `?start=${start}${end ? `&end=${end}` : ""}` : end ? `?end=${end}` : ""}`),
  skuRanking: (limit = 20, start?: string, end?: string) =>
    jsonFetch<SkuRow[]>(`/api/v1/dashboard/sku-ranking?limit=${limit}${start ? `&start=${start}` : ""}${end ? `&end=${end}` : ""}`),
  inventory: () => jsonFetch<InventorySummary>("/api/v1/dashboard/inventory"),
  inventorySkus: (search = "", limit = 1000) => {
    const q = new URLSearchParams({ search, limit: String(limit) });
    return jsonFetch<InventorySkuRow[]>(`/api/v1/dashboard/inventory/skus?${q}`);
  },
  /** 正品 SKU 逐笔出入库流水（本地吉客云单据事实，口径与库存运算一致）。 */
  skuTransactions: (skuId: number, limit = 500) =>
    jsonFetch<SkuTransactionPayload>(`/api/v1/dashboard/inventory/sku-transactions?sku_id=${skuId}&limit=${limit}`),
  products: (search = "", limit = 200) => {
    const q = new URLSearchParams({ search, limit: String(limit) });
    return jsonFetch<CatalogSkuRow[]>(`/api/v1/dashboard/products?${q}`);
  },
  updateCostPolicy: (skuId: number, costMode: "fixed" | "dynamic", costTolerancePct?: string) =>
    jsonFetch<{ id: number; costMode: string; costTolerancePct: string }>(`/api/v1/dashboard/products/${skuId}/cost-policy`, {
      method: "POST", body: JSON.stringify({ cost_mode: costMode, cost_tolerance_pct: costTolerancePct }),
    }),
  updateConsumablePolicy: (skuId: number, policy: "auto" | "none") =>
    jsonFetch<{ id: number; consumablePolicy: "auto" | "none" }>(`/api/v1/dashboard/products/${skuId}/consumable-policy`, {
      method: "POST", body: JSON.stringify({ policy }),
    }),
  saveProduct: (body: Record<string, unknown>) =>
    jsonFetch<{ id: number; skuCode: string; jackyunSkuId: string }>("/api/v1/dashboard/products/save", { method: "POST", body: JSON.stringify(body) }),
  catalogUnified: (kind: "all" | "goods" | "consumable" = "all", search = "", limit = 500) => {
    const q = new URLSearchParams({ kind, search, limit: String(limit) });
    return jsonFetch<UnifiedCatalogRow[]>(`/api/v1/dashboard/catalog-unified?${q}`);
  },
  bulkSetTaxCode: (items: { kind: "goods" | "consumable"; id: number }[], taxCode: string, overwrite: boolean) =>
    jsonFetch<{ updated: number; skipped: number; missing: number }>("/api/v1/dashboard/catalog/tax-code/bulk", {
      method: "POST", body: JSON.stringify({ items, tax_code: taxCode, overwrite }),
    }),
  bulkDeleteBundles: (ids: number[], dryRun = false) =>
    jsonFetch<BundleBulkDeleteResult>("/api/v1/dashboard/catalog/bundles/bulk-delete", {
      method: "POST", body: JSON.stringify({ ids, dry_run: dryRun }),
    }),
  bulkDeleteCatalog: (items: CatalogBulkDeleteItem[], dryRun = false) =>
    jsonFetch<CatalogBulkDeleteResult>("/api/v1/dashboard/catalog/bulk-delete", {
      method: "POST", body: JSON.stringify({ items, dry_run: dryRun }),
    }),
  bulkCatalogStatus: (items: CatalogBulkDeleteItem[], status: "active" | "inactive") =>
    jsonFetch<CatalogBulkStatusResult>("/api/v1/dashboard/catalog/bulk-status", {
      method: "POST", body: JSON.stringify({ items, status }),
    }),
  updateCategory: (kind: "goods" | "consumable", id: number, category: string) =>
    jsonFetch<{ ok: boolean; category: string }>("/api/v1/dashboard/catalog/category", {
      method: "POST", body: JSON.stringify({ kind, id, category }),
    }),
  orders: (status?: string) =>
    jsonFetch<SalesOrderRow[]>(`/api/v1/dashboard/orders${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  aftersales: () => jsonFetch<AftersaleRow[]>("/api/v1/dashboard/aftersales"),
};

export const taxAccountingApi = {
  categoryRules: () => jsonFetch<{ items: TaxCategoryRule[] }>("/api/v1/tax-accounting/category-rules?include_disabled=true"),
};

export type FinanceLegalEntity = {
  id: number;
  code: string;
  name: string;
  countryCode: string;
  baseCurrency: string;
  taxId: string;
  status: string;
  isDefault: boolean;
  businessScopes: string[];
  note: string;
};

export type FinanceVoucherLine = {
  seq: number;
  accountCode: string;
  accountName: string;
  direction: "debit" | "credit" | string;
  amount: number;
  taxAmount: number;
  summary: string;
  entryId: number | null;
};

export type FinanceVoucher = {
  id: number;
  voucherNo: string;
  year: number;
  month: number;
  voucherDate: string | null;
  currency: string;
  source: string;
  status: "draft" | "posted" | string;
  note: string;
  debitTotal: number;
  creditTotal: number;
  balanced: boolean;
  lines: FinanceVoucherLine[];
};

export const financeEntityApi = {
  list: () => jsonFetch<{ items: FinanceLegalEntity[] }>("/api/v1/finance/entities"),
};

export const financeVoucherApi = {
  list: (params: { legalEntityId: number; year: number; month: number }) => {
    const query = new URLSearchParams({
      legal_entity_id: String(params.legalEntityId),
      year: String(params.year),
      month: String(params.month),
    });
    return jsonFetch<FinanceVoucher[]>(`/api/v1/finance/vouchers?${query.toString()}`);
  },
  generate: (params: { legalEntityId: number; year: number; month: number }) =>
    jsonFetch<{ legalEntityId: number; year: number; month: number; generated: number; skipped: number; source: string }>(
      "/api/v1/finance/vouchers",
      {
        method: "POST",
        body: JSON.stringify({
          legal_entity_id: params.legalEntityId,
          year: params.year,
          month: params.month,
        }),
      },
    ),
  post: (voucherId: number) =>
    jsonFetch<{ id: number; status: string }>(`/api/v1/finance/vouchers/${voucherId}/post`, { method: "POST" }),
};

export const consumablesApi = {
  list: (search = "") => jsonFetch<ConsumableRow[]>(`/api/v1/consumables?search=${encodeURIComponent(search)}`),
  save: (body: Record<string, unknown>) => jsonFetch<ConsumableRow>("/api/v1/consumables", { method: "POST", body: JSON.stringify(body) }),
  importXlsx: async (file: File) => {
    const form = new FormData(); form.append("file", file);
    const res = await authenticatedFetch("/api/v1/consumables/import-xlsx", { method: "POST", body: form });
    if (!res.ok) { const data = await res.json().catch(() => ({})) as { detail?: unknown }; throw new Error(detailToMessage(data.detail, `导入失败（${res.status}）`)); }
    return res.json() as Promise<{ ok: boolean; created: number; updated: number; skipped: number; mappings: number }>;
  },
  transactions: (id: number) => jsonFetch<ConsumableTransactionRow[]>(`/api/v1/consumables/${id}/transactions`),
  addTransaction: (id: number, body: Record<string, unknown>) => jsonFetch<{ id: number }>(`/api/v1/consumables/${id}/transactions`, { method: "POST", body: JSON.stringify(body) }),
  mappings: (consumableId?: number) => jsonFetch<ConsumableMappingRow[]>(`/api/v1/consumables/mappings/list${consumableId ? `?consumable_id=${consumableId}` : ""}`),
  saveMapping: (body: Record<string, unknown>) => jsonFetch<{ id: number }>("/api/v1/consumables/mappings", { method: "POST", body: JSON.stringify(body) }),
  deleteMapping: (id: number) => jsonFetch<{ ok: boolean }>(`/api/v1/consumables/mappings/${id}`, { method: "DELETE" }),
  purchases: (search = "", sourceOrderId?: number, orderNo?: string) => jsonFetch<ConsumablePurchaseRow[]>(`/api/v1/consumables/purchases?search=${encodeURIComponent(search)}${sourceOrderId ? `&source_order_id=${sourceOrderId}` : ""}${orderNo ? `&order_no=${encodeURIComponent(orderNo)}` : ""}`),
  purchase: (id: number) => jsonFetch<ConsumablePurchaseDetail>(`/api/v1/consumables/purchases/${id}`),
  purchaseSources: (search = "") => jsonFetch<ConsumablePurchaseSource[]>(`/api/v1/consumables/purchases/source-orders?search=${encodeURIComponent(search)}`),
  createPurchase: (body: Record<string, unknown>) => jsonFetchWithNetworkRetry<ConsumablePurchaseDetail>("/api/v1/consumables/purchases", { method: "POST", body: JSON.stringify(body) }),
  receivePurchase: (id: number, body: Record<string, unknown>) => jsonFetch<ConsumablePurchaseDetail>(`/api/v1/consumables/purchases/${id}/receipts`, { method: "POST", body: JSON.stringify(body) }),
  cancelPurchase: (id: number) => jsonFetch<ConsumablePurchaseDetail>(`/api/v1/consumables/purchases/${id}/cancel`, { method: "POST" }),
  reopenPurchase: (id: number) => jsonFetch<ConsumablePurchaseDetail>(`/api/v1/consumables/purchases/${id}/reopen`, { method: "POST" }),
  updatePurchase: (id: number, body: Record<string, unknown>) => jsonFetch<ConsumablePurchaseDetail>(`/api/v1/consumables/purchases/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deletePurchase: (id: number) => jsonFetch<{ ok: boolean; purchaseId: number }>(`/api/v1/consumables/purchases/${id}`, { method: "DELETE" }),
};

export type InventoryStocktakeCandidate = {
  kind: "goods" | "consumable";
  id: number;
  code: string;
  name: string;
  goodsName: string;
  category: string;
  unit: string;
  bookQty: string;
  warehouseId: number;
  warehouseName: string;
};

export type InventoryStocktakeItem = {
  id: number;
  kind: "goods" | "consumable";
  refId: number;
  code: string;
  name: string;
  goodsName: string;
  category: string;
  unit: string;
  bookQty: string;
  actualQty: string | null;
  differenceQty: string | null;
  reason: string;
};

export type InventoryStocktakeTask = {
  id: number;
  number: string;
  scope: "all" | "partial";
  scopeLabel: string;
  status: "pending" | "counting" | "review" | "completed" | "cancelled";
  statusLabel: string;
  warehouseId: number;
  warehouseName: string;
  itemKinds: Array<"goods" | "consumable">;
  searchText: string;
  categoryFilter: string;
  note: string;
  createdBy: string;
  confirmedBy: string;
  confirmedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  itemCount: number;
  countedCount: number;
  differenceCount: number;
  differenceAbsQty: string;
  items?: InventoryStocktakeItem[];
};

export const inventoryStocktakeApi = {
  list: (status = "") =>
    jsonFetch<InventoryStocktakeTask[]>(`/api/v1/inventory/stocktakes${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  candidates: (warehouseId: number, kinds: Array<"goods" | "consumable">, search = "", category = "") => {
    const q = new URLSearchParams({
      warehouse_id: String(warehouseId),
      kinds: kinds.join(","),
      search,
      category,
    });
    return jsonFetch<InventoryStocktakeCandidate[]>(`/api/v1/inventory/stocktakes/candidates?${q}`);
  },
  create: (body: {
    scope: "all" | "partial";
    warehouse_id: number;
    item_kinds: Array<"goods" | "consumable">;
    selected_items?: Array<{ kind: "goods" | "consumable"; id: number }>;
    search?: string;
    category?: string;
    note?: string;
  }) =>
    jsonFetch<InventoryStocktakeTask>("/api/v1/inventory/stocktakes", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  detail: (id: number) =>
    jsonFetch<InventoryStocktakeTask>(`/api/v1/inventory/stocktakes/${id}`),
  saveCounts: (id: number, items: Array<{ id: number; actual_qty: string | null; reason: string }>) =>
    jsonFetch<InventoryStocktakeTask>(`/api/v1/inventory/stocktakes/${id}/counts`, {
      method: "POST",
      body: JSON.stringify({ items }),
    }),
  confirm: (id: number) =>
    jsonFetch<InventoryStocktakeTask>(`/api/v1/inventory/stocktakes/${id}/confirm`, { method: "POST" }),
  cancel: (id: number) =>
    jsonFetch<InventoryStocktakeTask>(`/api/v1/inventory/stocktakes/${id}/cancel`, { method: "POST" }),
};

export const warehousesApi = {
  list: (includeInactive = false) =>
    jsonFetch<WarehouseRow[]>(`/api/v1/warehouses?include_inactive=${includeInactive ? "true" : "false"}`),
  receiveConsumablePurchase: (purchaseId: number, body: Record<string, unknown>) =>
    jsonFetch<ConsumablePurchaseDetail>(`/api/v1/warehouses/consumable-purchases/${purchaseId}/receipts`, {
      method: "POST", body: JSON.stringify(body),
    }),
};
