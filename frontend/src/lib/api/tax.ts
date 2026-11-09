/** 税务系统官方发票清单（由 lib/api.ts 拆分，逻辑未改动） */
import { authenticatedFetch, detailToMessage, jsonFetch, noContentFetch } from "./client";

export type TaxInvoiceImportRow = {
  id: number;
  originalName: string;
  size: number;
  sha256: string;
  sourceSystem: string;
  period: string;
  sheetName: string;
  headers: string[];
  mapping: Record<string, string>;
  status: string;
  lifecycle: string;
  lifecycleChangedAt: string | null;
  rowCount: number;
  recognizedRowCount: number;
  matchedRowCount: number;
  needsReviewCount: number;
  errorSummary: string;
  uploader: string;
  importedAt: string | null;
  createdAt: string | null;
};

export type TaxInvoiceProcessingStatus = "pending" | "required" | "not_required";

/** 进项发票 v2 分类（6 个 key + 空=待判断），与 processing_status 合并后的单一分类字段 */

export type TaxInvoiceCategoryV2 =
  | "goods"
  | "platform_fee"
  | "operating_other"
  | "reimburse_advance"
  | "reimburse_operating"
  | "excluded";

/** 销项发票分类（独立枚举，与进项 6+1 互斥）：空=待判断 */

export type TaxInvoiceCategoryOutput = "buyer_sales" | "platform_service";

export type TaxInvoiceRow = {
  id: number;
  direction: "input" | "output" | "unknown";
  invoiceCode: string;
  invoiceNumber: string;
  invoiceType: string;
  status: "issued" | "void" | "red" | "unknown";
  issueDate: string | null;
  sellerName: string;
  sellerTaxId: string;
  buyerName: string;
  buyerTaxId: string;
  amountExclTax: string | null;
  taxAmount: string | null;
  totalAmount: string | null;
  currency: string;
  /** 兼容字段；新页面使用 businessMatchStatus。 */
  matchStatus: "matched" | "partial" | "unmatched" | "needs_review";
  businessMatchStatus: "matched" | "partial" | "unmatched" | "needs_review";
  businessMatchedAmount: string;
  businessRemainingAmount: string;
  businessOvermatchedAmount: string;
  businessMatchException: string;
  matchNote: string;
  businessMatchNote: string;
  /** 进项发票独立的银行付款核对状态，与 businessMatchStatus 完全无关。 */
  bankPaymentStatus: "matched" | "partial" | "unmatched" | "not_applicable" | "overpaid_after_red" | "red_overpayment_settled";
  bankPaidAmount: string;
  bankRemainingAmount: string;
  bankOverpaidAmount: string;
  bankOverpaidSettledAmount?: string;
  bankOverpaidUnsettledAmount?: string;
  bankEffectiveInvoiceAmount: string;
  processingStatus: TaxInvoiceProcessingStatus;
  /** 分类 key：进项 goods/platform_fee/operating_other/reimburse_advance/reimburse_operating/excluded；销项 buyer_sales/platform_service；空=待判断 */
  category: string;
  /** 分类中文文案（后端权威，与 category 一致） */
  categoryLabel: string;
  sourceImportId: number | null;
  sourceRowIndex: number | null;
  /** 进项发票是否已勾选认证（税务侧抵扣） */
  verified: boolean;
  /** 认证所属月份，如 2026-08 */
  verifiedMonth: string;
  /** 进项发票最终付款方式：corporate=对公；personal=个人垫付；platform_auto_debit=平台自动扣款货款；mixed=对公+个人；空=未设置。销项不适用。 */
  paymentMethod: "corporate" | "personal" | "platform_auto_debit" | "mixed" | "";
  /** 人工补充字段：personal=个人垫付；platform_auto_debit=平台自动扣款货款；空=未设置。 */
  manualPaymentMethod: "personal" | "platform_auto_debit" | "";
  /** 凭证颜色与红冲生命周期分离：blue=蓝字原票，red=红字冲销票。 */
  invoiceColor: "blue" | "red" | "unknown" | string;
  invoiceStatusLabel: string;
  redStatus:
    | "none"
    | "partially_red_offset"
    | "fully_red_offset"
    | "over_red_offset"
    | "blue_red_pending"
    | "red_invoice"
    | "red_invoice_unpaired"
    | "red_invoice_ambiguous"
    | "void"
    | "unknown"
    | string;
  redPairStatus: "none" | "paired" | "paired_manual" | "unpaired" | "ambiguous" | "over_offset" | "counterpart_missing" | string;
  redPairMethod: "" | "official_ref" | "manual" | string;
  redRelatedInvoiceId: number | null;
  redRelatedInvoiceNo: string;
  redRelatedInvoiceIds: number[];
  redRelatedInvoiceNos: string[];
  redNoticeNo: string;
  redRelatedInvoiceDate?: string | null;
  redRelatedInvoicePeriod?: string;
  redCrossPeriod?: boolean;
  redOffsetAmount: string;
  remainingAfterRedAmount: string;
  accountingNetAmount: string;
  accountingNetIncluded: boolean;
  accountingException: string;
  redSettlementStatus?: "not_applicable" | "unsettled" | "partial" | "settled" | "over_settled" | string;
  redSettlementTargetAmount?: string;
  redSettledAmount?: string;
  redSettlementRemainingAmount?: string;
  redSettlementOverAmount?: string;
  redSettlements?: Array<{ linkId: number; type: string; amount: string; note: string; targetId: number | null; targetLabel: string; txnDate?: string | null; voucherNo?: string }>;
  vatDeductibleStatus?: "not_applicable" | "non_deductible" | "deductible" | "verified_pending_tax_filing" | "pending" | string;
  vatDeductibleAmount?: string;
  vatDeductibleManual?: boolean;
  inputVatTransferStatus?: "not_applicable" | "required_confirmation" | "completed" | "not_required_unverified_blue" | string;
  inputVatTransferAmount?: string;
  inputVatTransferManual?: boolean;
  /** 红字票分类由对应蓝字票继承。 */
  categoryInherited?: boolean;
  categoryInheritedFromInvoiceId?: number | null;
  /** 发票池展示用的采购/入库关联摘要 */
  links: Array<{
    /** tax_invoice_links 主键，解除关联时使用 */
    id: number;
    targetType: string;
    targetId: number;
    targetNo: string;
    targetLabel: string;
    allocatedAmount: number | null;
    matchMethod: string;
    confirmed: boolean;
    note: string;
  }>;
  purchaseOrderNos: string[];
  inboundNos: string[];
  /** 当前有效导入批次中解析出的开票明细摘要 */
  lineItems: Array<{
    goodsName: string | null;
    spec: string | null;
    unit: string | null;
    quantity: string | number | null;
    unitPrice: string | number | null;
    amount: string | number | null;
    taxRate: string | number | null;
    taxAmount: string | number | null;
    totalAmount: string | number | null;
    remark: string | null;
  }>;
  lineItemCount: number;
};

/** 发票人工关联候选（销项→销售订单；采购类→1688 文件订单 / 吉客云采购单） */

export type TaxInvoicePurchaseCandidate = {
  targetType: string;
  targetId: number;
  orderNo: string;
  supplier: string;
  /** 销售订单候选：买家/客户（采购候选为空） */
  buyer?: string;
  orderDate: string | null;
  amount: string | null;
  amountDiff: string | null;
  linkedInvoiceId: number | null;
  linkedInvoiceNo: string | null;
};

export type TaxInvoiceRedBlueCandidate = {
  invoiceId: number; invoiceNumber: string; invoiceCode: string; issueDate: string | null;
  sellerName: string; buyerName: string; totalAmount: string; taxPartyMatched: boolean; amountCanCoverRed: boolean;
};

export type TaxInvoiceRefundCandidate = {
  txnId: number; txnDate: string; amount: string; counterpartyName: string; voucherNo: string; summary: string;
  supplierMatched: boolean; amountMatched: boolean;
};

export type TaxInvoiceSummary = {
  total: number;
  byDirection: Record<string, number>;
  byStatus: Record<string, number>;
  byMatchStatus: Record<string, number>;
  byProcessing?: Record<string, number>;
  /** v2 分类计数（进项；key 为 6 个分类 + ""=待判断） */
  byCategory?: Record<string, number>;
  /** 派生组计数：operating=计入运营成本 / reimburse=计入报销成本 / excluded=不计入 / pending=待判断 */
  byCategoryGroup?: Record<string, number>;
  byVerification: Record<string, number>;
  inputVerification: Record<string, number>;
  inputTotalAmount: number;
  rawInputTotalAmount: number;
  /** 兼容字段：蓝字票已显示红冲但对应红字凭证尚未补齐时，被隔离的原票金额。 */
  excludedRedAmount: number;
  byRedStatus?: Record<string, number>;
  redPairExceptionCount?: number;
  redInvoiceCount?: number;
  partiallyRedOffsetBlueCount?: number;
  fullyRedOffsetBlueCount?: number;
  activeBatchCount: number;
  sourceRowCount: number;
  duplicateRowCount: number;
};

/** 发票货物明细行（官方清单导入记录中的一行；解析失败的数字保留原文） */

export type TaxInvoiceLine = {
  goodsName: string | null;
  spec: string | null;
  unit: string | null;
  quantity: string | number | null;
  unitPrice: string | number | null;
  amount: string | number | null;
  taxRate: string | number | null;
  taxAmount: string | number | null;
  totalAmount: string | number | null;
  remark: string | null;
};

export type TaxInvoiceLinesResponse = {
  items: TaxInvoiceLine[];
  total: number;
  sumAmount: number | null;
  sumTax: number | null;
  sumTotal: number | null;
};

export const taxInvoiceApi = {
  imports: (lifecycle?: string) => {
    const q = lifecycle ? `?lifecycle=${encodeURIComponent(lifecycle)}` : "";
    return jsonFetch<TaxInvoiceImportRow[]>(`/api/v1/tax-invoices/imports${q}`);
  },
  summary: () => jsonFetch<TaxInvoiceSummary>("/api/v1/tax-invoices/summary"),
  invoices: (params: { direction?: string; status?: string; matchStatus?: string; processingStatus?: string; category?: string; verified?: boolean; limit?: number; offset?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.direction) q.set("direction", params.direction);
    if (params.status) q.set("status", params.status);
    if (params.matchStatus) q.set("match_status", params.matchStatus);
    if (params.processingStatus) q.set("processing_status", params.processingStatus);
    if (params.category !== undefined) q.set("category", params.category);
    if (params.verified !== undefined) q.set("verified", String(params.verified));
    if (params.limit !== undefined) q.set("limit", String(params.limit));
    if (params.offset !== undefined) q.set("offset", String(params.offset));
    return jsonFetch<TaxInvoiceRow[]>(`/api/v1/tax-invoices${q.toString() ? `?${q}` : ""}`);
  },
  lines: (invoiceId: number) =>
    jsonFetch<TaxInvoiceLinesResponse>(`/api/v1/tax-invoices/${invoiceId}/lines`),
  setProcessingStatus: (invoiceId: number, processingStatus: "pending" | "required" | "not_required") =>
    jsonFetch<TaxInvoiceRow>(`/api/v1/tax-invoices/${invoiceId}/processing-status`, {
      method: "PATCH",
      body: JSON.stringify({ processing_status: processingStatus }),
    }),
  bulkVerify: (invoiceIds: number[], verified: boolean, verifiedMonth: string) =>
    jsonFetch<{ ok: boolean; processed: number; items: unknown[] }>("/api/v1/tax-invoices/bulk-verify", {
      method: "POST",
      body: JSON.stringify({ invoice_ids: invoiceIds, verified, verified_month: verifiedMonth }),
    }),
  bulkSetCategory: (invoiceIds: number[], category: string) =>
    jsonFetch<{ ok: boolean; processed: number }>("/api/v1/tax-invoices/bulk-category", {
      method: "POST",
      body: JSON.stringify({ invoice_ids: invoiceIds, category }),
    }),
  bulkSetPaymentMethod: (invoiceIds: number[], paymentMethod: string) =>
    jsonFetch<{ ok: boolean; processed: number }>("/api/v1/tax-invoices/bulk-payment-method", {
      method: "POST",
      body: JSON.stringify({ invoice_ids: invoiceIds, payment_method: paymentMethod }),
    }),
  redBlueCandidates: (invoiceId: number, keyword = "") => {
    const q = new URLSearchParams();
    if (keyword) q.set("keyword", keyword);
    return jsonFetch<TaxInvoiceRedBlueCandidate[]>(`/api/v1/tax-invoices/${invoiceId}/red-blue-candidates${q.toString() ? `?${q}` : ""}`);
  },
  setRedBlueLink: (redInvoiceId: number, blueInvoiceId: number, note = "") =>
    jsonFetch<Record<string, unknown>>(`/api/v1/tax-invoices/${redInvoiceId}/red-blue-link`, { method: "POST", body: JSON.stringify({ blue_invoice_id: blueInvoiceId, note }) }),
  clearRedBlueLink: (redInvoiceId: number) =>
    jsonFetch<Record<string, unknown>>(`/api/v1/tax-invoices/${redInvoiceId}/red-blue-link`, { method: "DELETE" }),
  refundCandidates: (invoiceId: number, keyword = "") => {
    const q = new URLSearchParams();
    if (keyword) q.set("keyword", keyword);
    return jsonFetch<TaxInvoiceRefundCandidate[]>(`/api/v1/tax-invoices/${invoiceId}/refund-candidates${q.toString() ? `?${q}` : ""}`);
  },
  addRedSettlement: (invoiceId: number, body: { settlementType: string; amount: string | number; targetId?: number | null; note?: string }) =>
    jsonFetch<Record<string, unknown>>(`/api/v1/tax-invoices/${invoiceId}/red-settlements`, {
      method: "POST",
      body: JSON.stringify({ settlement_type: body.settlementType, amount: body.amount, target_id: body.targetId ?? null, note: body.note ?? "" }),
    }),
  removeRedSettlement: (invoiceId: number, linkId: number) =>
    jsonFetch<Record<string, unknown>>(`/api/v1/tax-invoices/${invoiceId}/red-settlements/${linkId}`, { method: "DELETE" }),
  setVatReview: (
    invoiceId: number,
    body: {
      vatDeductibleStatus?: "pending" | "deductible" | "non_deductible";
      inputVatTransferStatus?: "required_confirmation" | "completed" | "not_required_unverified_blue" | "not_applicable";
      inputVatTransferAmount?: string | number | null;
      note?: string;
    },
  ) =>
    jsonFetch<Record<string, unknown>>(`/api/v1/tax-invoices/${invoiceId}/vat-review`, {
      method: "PATCH",
      body: JSON.stringify({
        vat_deductible_status: body.vatDeductibleStatus,
        input_vat_transfer_status: body.inputVatTransferStatus,
        input_vat_transfer_amount: body.inputVatTransferAmount ?? null,
        note: body.note ?? "",
      }),
    }),
  purchaseCandidates: (invoiceId: number, keyword = "") => {
    const q = new URLSearchParams();
    if (keyword) q.set("keyword", keyword);
    return jsonFetch<TaxInvoicePurchaseCandidate[]>(
      `/api/v1/tax-invoices/${invoiceId}/purchase-link-candidates${q.toString() ? `?${q}` : ""}`
    );
  },
  linkPurchase: (
    invoiceId: number,
    body: { targetType: string; targetId: number; allocatedAmount?: string | number | null; note?: string }
  ) =>
    jsonFetch<{ ok: boolean; id: number; orderNo: string }>(`/api/v1/tax-invoices/${invoiceId}/purchase-links`, {
      method: "POST",
      body: JSON.stringify({
        target_type: body.targetType,
        target_id: body.targetId,
        allocated_amount: body.allocatedAmount ?? undefined,
        note: body.note ?? "",
      }),
    }),
  unlinkPurchase: (invoiceId: number, linkId: number) =>
    jsonFetch<{ ok: boolean }>(`/api/v1/tax-invoices/${invoiceId}/purchase-links/${linkId}`, { method: "DELETE" }),
  upload: async (file: File, period?: string, autoConfirm = false) => {
    const form = new FormData();
    form.append("file", file);
    const query = new URLSearchParams();
    if (period) {
      const [year, month] = period.split("-");
      if (year) query.set("period_year", year);
      if (month) query.set("period_month", String(Number(month)));
    }
    query.set("auto_confirm", autoConfirm ? "true" : "false");
    const res = await authenticatedFetch(`/api/v1/tax-invoices/imports${query.toString() ? `?${query}` : ""}`, {
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
      import: TaxInvoiceImportRow;
      automation?: {
        errors?: string[];
        partnerMaster?: {
          bankInvoiceMatchesCreated?: number;
          bankInvoiceAmbiguous?: number;
          bankInvoiceRepaired?: number;
        };
      };
    }>;
  },
  confirm: (id: number) =>
    jsonFetch<TaxInvoiceImportRow>(`/api/v1/tax-invoices/imports/${id}/confirm`, { method: "POST" }),
  softDelete: (id: number) => noContentFetch(`/api/v1/tax-invoices/imports/${id}`),
  restore: (id: number) =>
    jsonFetch<TaxInvoiceImportRow>(`/api/v1/tax-invoices/imports/${id}/restore`, { method: "POST" }),
  records: (id: number) =>
    jsonFetch<TaxInvoiceRecordPreview[]>(`/api/v1/tax-invoices/imports/${id}/records`),
  deleteRow: (id: number, rowIndex: number) =>
    noContentFetch(`/api/v1/tax-invoices/imports/${id}/records/${rowIndex}`),
  restoreRow: (id: number, rowIndex: number) =>
    jsonFetch<{ rowIndex: number; rowStatus: string }>(
      `/api/v1/tax-invoices/imports/${id}/records/${rowIndex}/restore`,
      { method: "POST" }
    ),
};

export type TaxInvoiceRecordPreview = {
  rowIndex: number;
  rowStatus: string;
  recognitionStatus: string;
  invoiceId: number | null;
  errorSummary: string;
  payload: Record<string, string>;
};
