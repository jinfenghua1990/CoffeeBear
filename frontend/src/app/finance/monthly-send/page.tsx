Warning: truncated output (original token count: 33699)
Total output lines: 1825

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { authenticatedFetch } from "@/lib/api";
import BankReconciliationBadge, {
  bankReconciliationBadgeClass,
  bankReconciliationStatusLabel,
} from "@/components/bank-reconciliation-badge";
import { useTabRuntime, useTabScopedState, useTabTitle, useWorkspace } from "@/lib/workspace/tab-store";

type Pkg = { id: number; version: number; status: string; sha256: string; createdAt: string | null };
type LegalEntity = {
  id: number;
  code: string;
  name: string;
  countryCode: string;
  baseCurrency: string;
  isDefault: boolean;
  businessScopes: string[];
};
type Period = {
  company: string;
  year: number;
  month: number;
  status: string;
  missing: Record<string, number>;
  fileCount: number;
  packages: Pkg[];
};
type SalesField = { key: string; label: string; enabled: boolean };
type SalesTemplate = {
  id: number;
  company: string;
  name: string;
  enabled: boolean;
  fields: SalesField[];
  rules: Record<string, string>;
  toAddrs: string[];
  ccAddrs: string[];
  autoSend: boolean;
  sendDay: number;
  sendHour: number;
};
type SalesPreview = {
  year: number;
  month: number;
  rowCount: number;
  fields: SalesField[];
  summary: { orderCount: number; warehouseCount: number; totalQuantity: string; salesAmount: string; costAmount: string; costIncomplete?: boolean; costMissingDetail?: { skuCode: string; skuName: string; quantity: string }[] };
  rows: Array<Record<string, string>>;
};
type Unbilled = {
  period: string;
  version?: number | null;
  adjusted?: boolean;
  selectedKeys?: string[];
  sourceCount?: number;
  selectedCount?: number;
  updatedAt?: string | null;
  salesAmount: string;
  redSalesAdjustmentAmount?: string;
  adjustedSalesAmount?: string;
  invoicedAmount: string;
  unbilledAmount: string;
  rowInvoicedTotal?: string;
  unattributedInvoiced?: string;
  sourceDetails?: Array<{ period: string; taxCode: string; taxName: string; product: string; quantity: string; sales: string; redSalesAdjustment?: string; adjustedSales?: string; invoiced?: string; unbilled?: string; cost: string }>;
  details: Array<{ period: string; taxCode: string; taxName: string; product: string; quantity: string; sales: string; redSalesAdjustment?: string; adjustedSales?: string; invoiced?: string; unbilled?: string; cost: string }>;
};
type FileRow = {
  id: number;
  category: string;
  originalName: string;
  size: number;
  sha256: string;
  version: number;
  uploader: string;
  uploadedAt: string | null;
};
type BusinessStatus = {
  ready: boolean;
  source: string;
  salesSource: string;
  costSource: string;
  salesOrderCount: number;
  warehouseCount: number;
  totalQuantity: string;
  salesAmount: string;
  costAmount: string;
  costIncomplete: boolean;
  costMissingCount: number;
  costMissingDetail: Array<{ skuCode: string; skuName: string; quantity: string }>;
  legalEntityId: number;
  company: string;
  businessScopes: string[];
  domesticSupported: boolean;
  sync: {
    created: number;
    updated: number;
    deleted: number;
    sources: Record<string, number>;
  };
};
type MailStatus = { configured: boolean; host: string; port: number; username: string; from: string };
type PaymentMatchInvoice = {
  linkId: number | null;
  invoiceId: number;
  invoiceNumber: string;
  sellerName: string;
  issueDate: string;
  totalAmount: string;
  allocatedAmount: string | null;
};
type PaymentMatchRow = {
  id: number;
  txnDate: string;
  counterpartyName: string;
  counterpartyAccount?: string;
  amount: string;
  voucherNo: string;
  summary: string;
  accountNo?: string;
  accountName?: string;
  invoices: PaymentMatchInvoice[];
  matchedAmount: string;
  remaining: string;
  status: "matched" | "partial" | "unmatched" | string;
  suggestedInvoiceIds: number[];
};
type PaymentMatchPoolInvoiceLink = PaymentMatchInvoice & {
  txnId: number | null;
  txnDate: string;
  txnAmount: string;
  counterpartyName: string;
  counterpartyAccount: string;
  voucherNo: string;
  summary: string;
  accountNo: string;
  accountName: string;
};
type PaymentMatchPoolInvoice = {
  id: number;
  invoiceNumber: string;
  sellerName: string;
  issueDate: string;
  totalAmount: string;
  bankLinkedAmount: string;
  remaining: string;
  bankMatchStatus: "matched" | "partial" | "unmatched" | "overpaid_after_red" | "red_overpayment_settled" | string;
  overpaidAfterRedAmount?: string;
  overpaidSettledAmount?: string;
  overpaidUnsettledAmount?: string;
  links: PaymentMatchPoolInvoiceLink[];
  suggested: boolean;
  suggestedPaymentIds: number[];
};
type PaymentMatchOverview = {
  year: number;
  month: number;
  payments: PaymentMatchRow[];
  invoicePool: PaymentMatchPoolInvoice[];
  summary: {
    paymentTotal: string;
    matchedTotal: string;
    unmatchedTotal: string;
    txnCount: number;
    matchedCount: number;
    partialCount: number;
    unmatchedCount: number;
    invoiceTotal: string;
    invoiceMatchedTotal: string;
    invoiceOutstandingTotal: string;
    invoiceCount: number;
    invoiceMatchedCount: number;
    invoicePartialCount: number;
    invoiceUnmatchedCount: number;
    invoiceOverpaidAfterRedCount?: number;
    invoiceOverpaidAfterRedTotal?: string;
  };
};

type CorporatePaymentRow = {
  linkId: number;
  paymentId: number;
  paymentDate: string;
  paymentAccount: string;
  paymentAccountName: string;
  supplierName: string;
  supplierTaxId: string;
  counterpartyAccount: string;
  voucherNo: string;
  summary: string;
  paymentAmount: string;
  paymentAllocatedAmount: string;
  paymentMatchedTotal: string;
  paymentStatus: string;
  invoiceId: number;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceType: string;
  invoiceAmountExclTax: string;
  invoiceTaxAmount: string;
  invoiceTotalAmount: string;
  invoiceCorporatePaidTotal: string;
  invoiceOutstandingAmount: string;
  invoiceStatus: string;
  purchaseOrderNos: string[];
};
type CorporateInvoicePayment = {
  linkId: number;
  paymentId: number;
  paymentDate: string;
  paymentAccount: string;
  paymentAccountName: string;
  counterpartyAccount: string;
  voucherNo: string;
  summary: string;
  paymentAmount: string;
  allocatedAmount: string;
  paymentMatchedTotal: string;
  paymentStatus: string;
};
type CorporateInvoiceRow = {
  invoiceId: number;
  invoiceKey: string;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceType: string;
  supplierName: string;
  supplierTaxId: string;
  invoiceAmountExclTax: string;
  invoiceTaxAmount: string;
  invoiceTotalAmount: string;
  invoiceCorporatePaidTotal: string;
  invoiceOutstandingAmount: string;
  invoiceOverpaidAmount?: string;
  invoiceOverpaidSettledAmount?: string;
  invoiceOverpaidUnsettledAmount?: string;
  invoiceEffectiveAmount?: string;
  invoiceStatus: "paid" | "partial" | "unpaid" | "not_applicable" | "overpaid_after_red" | "red_overpayment_settled" | string;
  bankReconciliationStatus?: "paid" | "partial" | "unpaid" | "not_applicable" | "overpaid_after_red" | "red_overpayment_settled" | string;
  bankReconciliationApplicable?: boolean;
  bankReconciliationReason?: string;
  paymentSource: "corporate" | "personal" | "platform_auto_debit" | "mixed" | "not_applicable" | string;
  paymentSourceLabel: string;
  expenseNature: string;
  expenseNatureLabel: string;
  expenseNatureBasis?: string;
  invoiceColor?: "blue" | "red" | "unknown" | string;
  invoiceStatusLabel?: string;
  redStatus?: string;
  redRelatedInvoiceNo?: string;
  redRelatedInvoicePeriod?: string;
  redCrossPeriod?: boolean;
  redSettlementStatus?: string;
  redSettlementRemainingAmount?: string;
  vatDeductibleStatus?: string;
  inputVatTransferStatus?: string;
  inputVatTransferAmount?: string;
  purchaseOrderNos: string[];
  payments: CorporateInvoicePayment[];
};
type CorporatePaymentReport = {
  year: number;
  month: number;
  company: string;
  summary: {
    paymentCount: number;
    invoiceCount: number;
    paymentTotal: string;
    allocatedTotal: string;
    invoiceTotal: string;
    outstandingTotal: string;
    overpaidAfterRedCount?: number;
    overpaidAfterRedAmount?: string;
    historicalOverpaidAfterRedAmount?: string;
    settledOverpaidAfterRedAmount?: string;
    resolvedRedOverpaymentCount?: number;
    redSettlementRemainingAmount?: string;
    companyMismatchInvoiceCount?: number;
    companyMismatchInvoiceAmount?: string;
    companyMismatchInvoiceNos?: string[];
    crossPeriodRedCount?: number;
    crossPeriodRedAmount?: string;
    paidInvoiceCount?: number;
    partialInvoiceCount?: number;
    unpaidInvoiceCount?: number;
    notApplicableInvoiceCount?: number;
    corporateInvoiceCount?: number;
    personalInvoiceCount?: number;
    platformAutoDebitInvoiceCount?: number;
    mixedInvoiceCount?: number;
    notApplicablePaymentCount?: number;
    personalInferredAmount?: string;
    expenseNatureCounts?: Record<string, number>;
  };
  invoiceRows: CorporateInvoiceRow[];
  rows: CorporatePaymentRow[];
  adjusted?: boolean;
  version?: number | null;
  selectedKeys?: string[];
  selectionError?: string;
  selectedCount?: number;
  sourceCount?: number;
  updatedAt?: string | null;
};
type PickerInvoice = { id: number; invoiceNumber: string; sellerName: string; issueDate: string; totalAmount: string; remaining: string; suggested: boolean };

function corporateBankStatus(row: CorporateInvoiceRow) {
  return row.bankReconciliationStatus || row.invoiceStatus;
}

function invoiceColorLabel(row: CorporateInvoiceRow) {
  if (row.invoiceColor === "red") return "红字发票";
  if (row.invoiceColor === "blue") return "蓝字发票";
  return "票据待确认";
}

function invoiceLifecycleLabel(row: CorporateInvoiceRow) {
  if (row.redStatus === "fully_red_offset") return "已全额红冲";
  if (row.redStatus === "partially_red_offset") return "部分红冲";
  if (row.redStatus === "over_red_offset") return "红冲金额异常";
  if (row.redStatus === "blue_red_pending") return "已红冲 · 待关联红字票";
  if (row.redStatus === "red_invoice") return "红冲";
  if (row.redStatus === "red_invoice_unpaired") return "红冲 · 待关联蓝字票";
  if (row.redStatus === "red_invoice_ambiguous") return "红冲 · 蓝字票关联歧义";
  if (row.invoiceColor === "blue") return "有效";
  return row.invoiceStatusLabel || "";
}

function invoiceColorBadgeClass(row: CorporateInvoiceRow) {
  if (row.invoiceColor === "red") return "bg-rose-100 text-rose-700 ring-rose-200";
  if (row.invoiceColor === "blue") return "bg-sky-100 text-sky-700 ring-sky-200";
  return "bg-slate-100 text-slate-500 ring-slate-200";
}

function invoiceLifecycleBadgeClass(row: CorporateInvoiceRow) {
  if (row.invoiceColor === "red" || row.redStatus === "over_red_offset") return "bg-rose-50 text-rose-700 ring-rose-100";
  if (row.redStatus === "fully_red_offset") return "bg-violet-50 text-violet-700 ring-violet-100";
  if (row.redStatus === "partially_red_offset" || row.redStatus === "blue_red_pending") return "bg-amber-50 text-amber-700 ring-amber-100";
  return "bg-slate-50 text-slate-500 ring-slate-100";
}

function previousMonthValue() {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonthValue(value: string, offset: number) {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return value;
  const d = new Date(year, month - 1 + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
}

function formatBytes(value: number) {
  if (!value) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function unbilledDetailKey(detail: { taxCode: string; product: string }) {
  return `${detail.taxCode || ""}\u001f${detail.product || ""}`;
}

function emails(value: string) {
  return value.split(/[\s,;，；]+/).map((x) => x.trim()).filter(Boolean);
}

function money(value: string | number | undefined) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? `¥${n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
}

/** 与交付 xlsx 一致的纯数字格式（无货币符号）。 */
function num(value: string | number | undefined) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
}

/** 行已开票金额；缺失返回 null（展示为 —）。 */
function invoicedValue(detail: { invoiced?: string }): number | null {
  if (detail.invoiced == null || detail.invoiced === "") return null;
  return Number(detail.invoiced);
}

/** 行无票收入：后端缺省但有已开票时，前端按调整后销售金额 − 已开票净额兜底。 */
function unbilledValue(detail: { sales: string; adjustedSales?: string; invoiced?: string; unbilled?: string }): number | null {
  const invoiced = invoicedValue(detail);
  if (invoiced === null) return null;
  if (detail.unbilled != null && detail.unbilled !== "") return Number(detail.unbilled);
  return Math.max(Number(detail.adjustedSales ?? detail.sales) - invoiced, 0);
}

/** 归档文件 → 交付表名（与后端打包映射一致）。 */
function deliveryName(month: number, name: string) {
  if (name.includes("交易明细")) return `${month}月-银行交易明细`;
  if (name.includes("回单详情")) return `${month}月-银行回单详情`;
  return name;
}

const CARD = "rounded-xl border border-slate-200 bg-white shadow-sm";

export default function MonthlySendPage() {
  const runtime = useTabRuntime();
  const workspace = useWorkspace();
  const ownTab = runtime?.tabId ? workspace.tabs.find((tab) => tab.id === runtime.tabId) : null;
  const ownSearch = ownTab?.search || "";

  // 全页唯一的账期选择器：选一次，下面所有卡片都跟着它走。
  const [sendMonth, setSendMonth] = useTabScopedState("monthly.month", previousMonthValue);
  const sel = useMemo(() => {
    const [year, mm] = sendMonth.split("-").map(Number);
    return year && mm ? { year, month: mm } : null;
  }, [sendMonth]);
  useTabTitle(sel ? `月度资料 · ${sendMonth}` : null);

  const [entities, setEntities] = useState<LegalEntity[]>([]);
  const [entityId, setEntityId] = useTabScopedState<number | null>("monthly.entity", () => null);
  const [template, setTemplate] = useState<SalesTemplate | null>(null);
  const [toText, setToText] = useState("");
  const [ccText, setCcText] = useState("");
  const [periods, setPeriods] = useState<Period[]>([]);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [businessStatus, setBusinessStatus] = useState<BusinessStatus | null>(null);
  const [unbilled, setUnbilled] = useState<Unbilled | null>(null);
  const [mailStatus, setMailStatus] = useState<MailStatus | null>(null);
  const [mailOpen, setMailOpen] = useState(false);
  const sendSettingsSnapshot = useRef<{ toText: string; ccText: string; autoSend: boolean; sendDay: number; sendHour: number } | null>(null);
  const [financeTab, setFinanceTab] = useTabScopedState<"monthly" | "records" | "archive" | "ledger" | "corporate" | "match">("monthly.tab", "monthly");
  const [corporateView, setCorporateView] = useState<"adjust" | "preview">("adjust");
  useEffect(() => {
    const params = new URLSearchParams(ownSearch);
    const requestedMonth = params.get("month") || "";
    const requestedTab = params.get("tab") || "";
    if (/^\d{4}-\d{2}$/.test(requestedMonth)) setSendMonth(requestedMonth);
    if (["monthly", "records", "archive", "ledger", "corporate", "match"].includes(requestedTab)) {
      setFinanceTab(requestedTab as "monthly" | "records" | "archive" | "ledger" | "corporate" | "match");
    }
  }, [ownSearch, setFinanceTab, setSendMonth]);

  const [matchData, setMatchData] = useState<PaymentMatchOverview | null>(null);
  const [corporatePayment, setCorporatePayment] = useState<CorporatePaymentReport | null>(null);
  const [matchLoading, setMatchLoading] = useState(false);
  const [pickerTxn, setPickerTxn] = useState<PaymentMatchRow | null>(null);
  const [pickerInvoice, setPickerInvoice] = useState<PaymentMatchPoolInvoice | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerScope, setPickerScope] = useState<"month" | "all">("month");
  const [allInvoices, setAllInvoices] = useState<PickerInvoice[]>([]);
  /** 发送内容勾选：手动打包只包含勾选项；自动发送始终重新生成当前全部月度交付表。 */
  const [includeSel, setIncludeSel] = useState<string[]>(["交易明细", "回单详情", "无票收入", "已收票对公付款明细"]);
  const [showUnbilledDetail, setShowUnbilledDetail] = useState(false);
  const [unbilledDetailMode, setUnbilledDetailMode] = useState<"adjust" | "preview">("adjust");
  const [showCorporateDetail, setShowCorporateDetail] = useState(false);
  const [unbilledSearch, setUnbilledSearch] = useState("");
  const [unbilledSelectedKeys, setUnbilledSelectedKeys] = useState<string[]>([]);
  const [corporateSelectedKeys, setCorporateSelectedKeys] = useState<string[]>([]);
  const [showFields, setShowFields] = useState(false);
  const [preview, setPreview] = useState<SalesPreview | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const templateRequestSeq = useRef(0);
  const periodsRequestSeq = useRef(0);
  const filesRequestSeq = useRef(0);
  const businessRequestSeq = useRef(0);
  const unbilledRequestSeq = useRef(0);
  const corporateRequestSeq = useRef(0);
  const matchRequestSeq = useRef(0);
  const pickerRequestSeq = useRef(0);
  const uploadKind = useRef<"交易明细" | "回单详情">("交易明细");
  const selectAllMaterialsRef = useRef<HTMLInputElement>(null);

  const corporateInvoices = corporatePayment?.invoiceRows || [];
  const corporateDeliveryState = !corporatePayment
    ? { ok: false, text: "计算中" }
    : { ok: true, text: corporatePayment.adjusted ? "已调整" : "已生成" };

  const corporateReviewSummary = corporatePayment
    ? `${corporatePayment.adjusted ? `已选择 ${corporatePayment.selectedCount || 0}/${corporatePayment.sourceCount || 0} 张发票 · ` : ""}对公 ${corporatePayment.summary.corporateInvoiceCount || 0} 张 · 个人 ${corporatePayment.summary.personalInvoiceCount || 0} 张${(corporatePayment.summary.mixedInvoiceCount || 0) > 0 ? ` · 混合 ${corporatePayment.summary.mixedInvoiceCount} 张` : ""}${(corporatePayment.summary.overpaidAfterRedCount || 0) > 0 ? ` · 红冲后超额付款 ${corporatePayment.summary.overpaidAfterRedCount} 张` : ""}${(corporatePayment.summary.companyMismatchInvoiceCount || 0) > 0 ? ` · 主体不符 ${corporatePayment.summary.companyMismatchInvoiceCount} 张` : ""}`
    : "发票号 · 支付方式 · 费用性质";

  const selectedEntity = entities.find((row) => row.id === entityId) ?? null;
  const companyName = selectedEntity?.name ?? "";
  const domesticSupportedByEntity = Boolean(
    selectedEntity?.isDefault && selectedEntity.businessScopes.includes("domestic")
  );
  const period = periods.find((p) => sel && p.year === sel.year && p.month === sel.month) || null;
  const latest = useCallback(
    (keyword: string) =>
      files.filter((f) => f.originalName.includes(keyword)).sort((a, b) => b.version - a.version)[0] || null,
    [files],
  );
  const bankTx = latest("交易明细");
  const bankReceipt = latest("回单详情");
  const otherFiles = files.filter((f) => !f.originalName.includes("交易明细") && !f.originalName.includes("回单详情"));
  const salesFile = [...otherFiles].filter((f) => f.category === "sales_summary").sort((a, b) => b.version - a.version)[0] || null;

  const loadEntities = useCallback(async () => {
    const res = await authenticatedFetch("/api/v1/finance/entities", { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "公司主体加载失败");
    const rows = (data.items || []) as LegalEntity[];
    setEntities(rows);
    setEntityId((current) => current && rows.some((row) => row.id === current)
      ? current
      : (rows.find((row) => row.isDefault)?.id ?? rows[0]?.id ?? null));
  }, [setEntityId]);

  const loadTemplate = useCallback(async () => {
    if (!companyName) {
      templateRequestSeq.current += 1;
      return;
    }
    const seq = ++templateRequestSeq.current;
    const res = await authenticatedFetch(`/api/v1/finance/sales-report/template?company=${encodeURIComponent(companyName)}`, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "加载失败");
    if (seq !== templateRequestSeq.current) return;
    setTemplate(data);
    setToText((data.toAddrs || []).join(", "));
    setCcText((data.ccAddrs || []).join(", "));
  }, [companyName]);

  const loadPeriods = useCallback(() => {
    if (!companyName) {
      periodsRequestSeq.current += 1;
      setPeriods([]);
      return;
    }
    const seq = ++periodsRequestSeq.current;
    authenticatedFetch(`/api/v1/finance/periods?company=${encodeURIComponent(companyName)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((rows) => { if (seq === periodsRequestSeq.current) setPeriods(rows); })
      .catch(() => { if (seq === periodsRequestSeq.current) setPeriods([]); });
  }, [companyName]);

  const loadFiles = useCallback(() => {
    if (!sel || !companyName) return;
    const seq = ++filesRequestSeq.current;
    authenticatedFetch(`/api/v1/finance/${sel.year}/${sel.month}/files?company=${encodeURIComponent(companyName)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((rows) => { if (seq === filesRequestSeq.current) setFiles(rows); })
      .catch(() => { if (seq === filesRequestSeq.current) setMsg("报告档案加载失败，请刷新重试"); });
  }, [companyName, sel]);

  const loadBusiness = useCallback((force = false) => {
    if (!sel || !companyName || !entityId) return;
    const seq = ++businessRequestSeq.current;
    // 服务端对全量业务投影同步有 60 秒节流；只有手动“刷新”才 force 立即全量。
    authenticatedFetch(`/api/v1/finance/${sel.year}/${sel.month}/refresh-business?company=${encodeURIComponent(companyName)}&legal_entity_id=${entityId}${force ? "&force=true" : ""}`, {
      method: "POST",
      cache: "no-store",
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.detail || "业务数据刷新失败");
        return data;
      })
      .then((data) => { if (seq === businessRequestSeq.current) setBusinessStatus(data); })
      .catch(() => { if (seq === businessRequestSeq.current) setBusinessStatus(null); });
  }, [companyName, entityId, sel]);

  const loadUnbilled = useCallback(() => {
    if (!sel || !companyName || !domesticSupportedByEntity) {
      setUnbilled(null);
      return;
    }
    const seq = ++unbilledRequestSeq.current;
    authenticatedFetch(`/api/v1/finance/unbilled/preview?year=${sel.year}&month=${sel.month}&company=${encodeURIComponent(companyName)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (seq === unbilledRequestSeq.current) setUnbilled(data); })
      .catch(() => { if (seq === unbilledRequestSeq.current) setMsg("未结算调整预览加载失败，请刷新重试"); });
  }, [companyName, domesticSupportedByEntity, sel]);

  const loadCorporatePayment = useCallback(() => {
    if (!sel || !compa…21699 tokens truncated…ail);
                        const rowInvoiced = invoicedValue(detail);
                        const rowUnbilled = unbilledValue(detail);
                        return (
                          <tr key={key || index} className={unbilledDetailMode === "adjust" && !unbilledSelectedKeys.includes(key) ? "bg-slate-50/70 text-slate-400" : ""}>
                            {unbilledDetailMode === "adjust" && <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                checked={unbilledSelectedKeys.includes(key)}
                                onChange={() => toggleUnbilledKey(key)}
                                aria-label={"选择 " + detail.product}
                                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                              />
                            </td>}
                            <td className="px-3 py-2 text-slate-600">{detail.period}</td>
                            <td className="px-3 py-2 font-mono text-[11px] text-slate-500">{detail.taxCode || "—"}</td>
                            <td className="px-3 py-2">{detail.taxName || "—"}</td>
                            <td className="max-w-[260px] truncate px-3 py-2">{detail.product}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{Number(detail.quantity).toLocaleString("zh-CN")}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{num(detail.sales)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-rose-700">{num(detail.redSalesAdjustment || 0)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{num(detail.adjustedSales ?? detail.sales)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{rowInvoiced === null ? "—" : num(rowInvoiced)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-amber-700">{rowUnbilled === null ? "—" : num(rowUnbilled)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-amber-700">{num(detail.cost)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-slate-50 font-semibold text-slate-900">
                      <tr>
                        <td colSpan={unbilledDetailMode === "adjust" ? 5 : 4} className="px-3 py-2">合计</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {filteredUnbilledDetails.reduce((sum, detail) => sum + Number(detail.quantity || 0), 0).toLocaleString("zh-CN")}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {num(filteredUnbilledDetails.reduce((sum, detail) => sum + Number(detail.sales || 0), 0))}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-rose-700">
                          {num(filteredUnbilledDetails.reduce((sum, detail) => sum + Number(detail.redSalesAdjustment || 0), 0))}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {num(filteredUnbilledDetails.reduce((sum, detail) => sum + Number(detail.adjustedSales ?? detail.sales ?? 0), 0))}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {num(filteredUnbilledDetails.reduce((sum, detail) => {
                            const v = invoicedValue(detail);
                            return sum + (v === null ? 0 : v);
                          }, 0))}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-amber-700">
                          {num(filteredUnbilledDetails.reduce((sum, detail) => {
                            const v = unbilledValue(detail);
                            return sum + (v === null ? 0 : v);
                          }, 0))}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-amber-700">
                          {num(filteredUnbilledDetails.reduce((sum, detail) => sum + Number(detail.cost || 0), 0))}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/70 px-4 py-3">
              <div className="mr-auto text-xs text-slate-500">
                {unbilledDetailMode === "adjust"
                  ? <>已选择 {unbilledSelectedKeys.length} / {unbilled?.sourceCount ?? unbilledSourceDetails.length} 条 · 当前筛选 {filteredUnbilledDetails.length} 条 · 当前筛选合计{" "}
                    {money(filteredUnbilledDetails.reduce((sum, detail) => sum + Number(detail.sales || 0), 0))}</>
                  : <>当前版本明细 {unbilled?.selectedCount ?? unbilled?.details.length ?? 0} / {unbilled?.sourceCount ?? unbilled?.details.length ?? 0} 条 · 预览合计{" "}
                    {money(filteredUnbilledDetails.reduce((sum, detail) => sum + Number(detail.sales || 0), 0))}</>}
                {Number(unbilled?.unattributedInvoiced || 0) > 0 ? (
                  <span className="ml-2 text-amber-700">
                    已开票净额 {money(unbilled?.invoicedAmount)} 中有 {money(unbilled?.unattributedInvoiced)} 未关联到具体销售订单，仅计入总额、不摊入明细行
                  </span>
                ) : null}
              </div>
              {unbilledDetailMode === "adjust" ? <>
                <button type="button" onClick={closeUnbilledDetail} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs text-slate-600">取消</button>
                <button type="button" onClick={() => void saveUnbilledAdjustment()} disabled={busy || !unbilled || unbilledSelectedKeys.length === 0} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">保存并生成新版</button>
              </> : <>
                <button type="button" onClick={closeUnbilledDetail} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs text-slate-600">关闭</button>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${includeSel.includes("无票收入") ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "bg-amber-50 text-amber-700 ring-1 ring-amber-200"}`}>{includeSel.includes("无票收入") ? "已纳入本次发送" : "未纳入本次发送"}</span>
                <button type="button" onClick={packageAndSend} disabled={busy || !sel || !sendReady || !includeSel.includes("无票收入")} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40">{busy ? "发送中…" : "确认并发送给财务"}</button>
              </>}
            </div>
          </div>
        </div>
      )}

      {showCorporateDetail && (
        <div
          className="fixed inset-0 z-modal flex items-end justify-center bg-slate-950/35 p-3 sm:p-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowCorporateDetail(false);
          }}
          role="dialog"
          aria-modal="true"
          aria-label="已收票对公付款明细调整"
        >
          <div className="flex max-h-[80vh] w-full max-w-[1500px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5">
              <div className="flex min-w-0 items-center gap-3">
                <DataIcon kind="purchase_inbound" />
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold text-slate-900">
                    {sel?.month}月-已收票对公付款明细{" "}
                    <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
                      {corporatePayment?.version ? "v" + corporatePayment.version : "调整"}
                    </span>
                  </h2>
                  <p className="mt-1 text-xs text-slate-400">勾选要纳入本版本的发票；保存后生成新版财务资料，历史版本保留。</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button type="button" onClick={loadCorporatePayment} className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50">刷新</button>
                <button type="button" onClick={() => { setShowCorporateDetail(false); setFinanceTab("match"); void loadMatch(); }} className="rounded-lg border border-blue-200 px-3 py-2 text-xs font-medium text-blue-600 hover:bg-blue-50">核对银行付款</button>
                <button type="button" onClick={() => setShowCorporateDetail(false)} aria-label="关闭对公付款明细弹窗" className="rounded-lg p-2 text-xl leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700">×</button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {corporateAdjustBody(false, () => { setShowCorporateDetail(false); setFinanceTab("match"); void loadMatch(); }, { selected: corporateSelectedKeys, onToggle: toggleCorporateKey, onToggleAll: toggleAllCorporate })}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/70 px-4 py-3">
              <div className="mr-auto text-xs text-slate-500">已选择 {corporateSelectedKeys.length} / {corporatePayment?.sourceCount ?? corporateInvoices.length} 张发票</div>
              <button type="button" onClick={() => setShowCorporateDetail(false)} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs text-slate-600">取消</button>
              <button type="button" onClick={() => void saveCorporateAdjustment()} disabled={busy || !corporatePayment || corporateSelectedKeys.length === 0} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">保存并生成新版</button>
            </div>
          </div>
        </div>
      )}

      {pickerInvoice && (() => {
        const query = pickerQuery.trim().toLowerCase();
        const candidates = (matchData?.payments || [])
          .filter((row) => Number(row.remaining) > 0.01)
          .filter((row) => !query || [row.txnDate, row.counterpartyName, row.voucherNo, row.accountNo, row.accountName].join(" ").toLowerCase().includes(query))
          .sort((a, b) =>
            Number(pickerInvoice.suggestedPaymentIds.includes(b.id)) - Number(pickerInvoice.suggestedPaymentIds.includes(a.id))
            || a.txnDate.localeCompare(b.txnDate)
          );
        return (
          <div
            className="fixed inset-0 z-modal flex items-end justify-center bg-slate-950/35 p-3 sm:p-6"
            onMouseDown={(event) => { if (event.target === event.currentTarget) setPickerInvoice(null); }}
            role="dialog"
            aria-modal="true"
            aria-label="选择银行流水核对发票"
          >
            <div className="flex max-h-[80vh] w-full max-w-[920px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-slate-900">选择银行流水 · 核对发票</h2>
                  <p className="mt-1 text-xs text-slate-400">
                    发票 {pickerInvoice.invoiceNumber || "未记录号码"} · {pickerInvoice.sellerName || "销方未名"} · 价税合计 {money(pickerInvoice.totalAmount)} · 待核对 {money(pickerInvoice.remaining)}
                  </p>
                </div>
                <button type="button" onClick={() => setPickerInvoice(null)} aria-label="关闭银行流水选择" className="rounded-lg p-2 text-xl leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700">×</button>
              </div>
              <div className="border-b border-slate-100 bg-slate-50/60 px-5 py-3">
                <input value={pickerQuery} onChange={(e) => setPickerQuery(e.target.value)} placeholder="搜索付款日期 / 对方户名 / 账号 / 凭证号" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400" />
              </div>
              <div className="min-h-[220px] flex-1 overflow-y-auto">
                {!candidates.length && <div className="px-5 py-10 text-center text-sm text-slate-400">当前账期没有可用于核对的银行支出流水。</div>}
                <div className="divide-y divide-slate-100">
                  {candidates.map((row) => {
                    const suggested = pickerInvoice.suggestedPaymentIds.includes(row.id);
                    return <div key={row.id} className={`grid gap-3 px-5 py-3 sm:grid-cols-[110px_minmax(0,1fr)_130px_110px] sm:items-center ${suggested ? "bg-blue-50/50" : ""}`}>
                      <div className="text-xs text-slate-600">{row.txnDate}</div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-sm"><span className="truncate font-medium text-slate-800">{row.counterpartyName || "对方未名"}</span>{suggested && <span className="rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-medium text-white">同名同金额建议</span>}</div>
                        <div className="mt-0.5 truncate text-[11px] text-slate-400">{row.accountNo || row.accountName || "未记录账户"}{row.voucherNo ? ` · ${row.voucherNo}` : ""}{row.summary ? ` · ${row.summary}` : ""}</div>
                      </div>
                      <div className="text-right"><div className="text-sm font-semibold text-slate-800">{money(row.amount)}</div><div className="text-[10px] text-slate-400">可用 {money(row.remaining)}</div></div>
                      <div className="text-right"><button type="button" onClick={() => void matchInvoiceToPayment(pickerInvoice, row)} disabled={busy} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40">核对这笔</button></div>
                    </div>;
                  })}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {pickerTxn && (() => {
        const query = pickerQuery.trim().toLowerCase();
        const monthRows: PickerInvoice[] = (matchData?.invoicePool || [])
          .filter((row) => Number(row.remaining) > 0.01 || row.suggested)
          .map((row) => ({ id: row.id, invoiceNumber: row.invoiceNumber, sellerName: row.sellerName, issueDate: row.issueDate, totalAmount: row.totalAmount, remaining: row.remaining, suggested: row.suggested }));
        const sourceRows = pickerScope === "month" ? monthRows : allInvoices;
        const rows = sourceRows
          .filter((row) => !query || row.invoiceNumber.toLowerCase().includes(query) || row.sellerName.toLowerCase().includes(query))
          .sort((a, b) => Number(b.suggested) - Number(a.suggested) || Number(b.remaining) - Number(a.remaining));
        return (
          <div
            className="fixed inset-0 z-modal flex items-end justify-center bg-slate-950/35 p-3 sm:p-6"
            onMouseDown={(event) => { if (event.target === event.currentTarget) setPickerTxn(null); }}
            role="dialog"
            aria-modal="true"
            aria-label="选择发票标记已开票"
          >
            <div className="flex max-h-[80vh] w-full max-w-[860px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-slate-900">选择发票 · 标记已开票</h2>
                  <p className="mt-1 text-xs text-slate-400">
                    付款 {pickerTxn.txnDate} · {pickerTxn.counterpartyName || "对方未名"} · {money(pickerTxn.amount)} · 剩余 {money(pickerTxn.remaining)}；分配金额按 min(发票金额, 付款剩余)。
                  </p>
                </div>
                <button type="button" onClick={() => setPickerTxn(null)} aria-label="关闭发票选择" className="rounded-lg p-2 text-xl leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700">×</button>
              </div>
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/60 px-5 py-3">
                <div className="flex overflow-hidden rounded-lg border border-slate-200 text-xs">
                  <button type="button" onClick={() => setPickerScope("month")} className={`px-3 py-1.5 transition ${pickerScope === "month" ? "bg-blue-600 text-white" : "bg-white text-slate-500 hover:text-slate-800"}`}>当月发票</button>
                  <button type="button" onClick={() => setPickerScope("all")} className={`px-3 py-1.5 transition ${pickerScope === "all" ? "bg-blue-600 text-white" : "bg-white text-slate-500 hover:text-slate-800"}`}>全部未配发票</button>
                </div>
                <input value={pickerQuery} onChange={(e) => setPickerQuery(e.target.value)} placeholder="搜索发票号 / 销方名称" className="min-w-[200px] flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-blue-400" />
              </div>
              <div className="min-h-[200px] flex-1 overflow-y-auto">
                {!rows.length && <div className="px-5 py-10 text-center text-sm text-slate-400">{pickerScope === "month" ? "当月没有可用的进项发票；可切「全部未配发票」搜索。" : "没有匹配的未配发票"}</div>}
                <div className="divide-y divide-slate-100">
                  {rows.map((row) => {
                    const suggestedSame = pickerScope === "month" && row.suggested;
                    return (
                      <div key={row.id} className={`flex flex-wrap items-center gap-3 px-5 py-3 ${suggestedSame ? "bg-blue-50/50" : ""}`}>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 text-sm">
                            <span className="font-mono text-slate-700">{row.invoiceNumber}</span>
                            {suggestedSame && <span className="rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-medium text-white">同名同金额</span>}
                            <span className={`rounded px-1.5 py-0.5 text-[10px] ${Number(row.remaining) > 0.01 ? "bg-slate-100 text-slate-500" : "bg-slate-100 text-slate-400"}`}>可分摊 {money(row.remaining)}</span>
                          </div>
                          <div className="mt-0.5 text-xs text-slate-400">{row.sellerName || "销方未名"} · {row.issueDate || "开票日期未知"} · 价税合计 {money(row.totalAmount)}</div>
                        </div>
                        <button type="button" onClick={() => void markInvoiced(pickerTxn, row)} disabled={busy || Number(row.remaining) <= 0.01} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40">选用</button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {mailOpen && <div className="fixed inset-0 z-modal flex items-start justify-center overflow-y-auto bg-slate-950/40 p-4 sm:p-8" onMouseDown={(event) => { if (event.target === event.currentTarget) closeSendSettings(); }} role="dialog" aria-modal="true" aria-label="发送设置"><div className="my-auto w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"><div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4"><div><h2 className="text-base font-semibold text-slate-900">发送设置</h2><p className="mt-0.5 text-[11px] text-slate-500">收件人、抄送和自动发送时间统一在这里维护，手动发送与自动发送共用。</p></div><button type="button" onClick={() => closeSendSettings()} className="rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:border-slate-300">关闭</button></div><div className="space-y-4 p-5"><div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3"><div className="text-[11px] font-medium text-slate-500">发件邮箱（服务器 .env 配置，不支持在此修改）</div><div className="mt-1.5 text-sm text-slate-800">{mailStatus?.from || "未配置"}</div><div className="mt-1 text-[11px] text-slate-400">{mailStatus?.configured ? `SMTP：${mailStatus.host}:${mailStatus.port} · 账号 ${mailStatus.username}` : "SMTP 未配置，发送会失败"}</div></div><label className="block text-xs text-slate-500">财务收件人<input value={toText} onChange={(e) => setToText(e.target.value)} placeholder="finance@example.com" className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" /></label><label className="block text-xs text-slate-500">抄送（可选）<input value={ccText} onChange={(e) => setCcText(e.target.value)} placeholder="多个邮箱用逗号分隔" className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" /></label><div className="rounded-xl border border-slate-200 p-4"><label className="flex items-center gap-2 text-sm font-medium text-slate-700"><input type="checkbox" checked={Boolean(template?.autoSend)} onChange={(e) => setTemplate((t) => t ? { ...t, autoSend: e.target.checked } : t)} className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />启用每月自动发送</label><div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500"><span>每月</span><input type="number" min={1} max={28} value={template?.sendDay ?? 3} onChange={(e) => setTemplate((t) => t ? { ...t, sendDay: Number(e.target.value) } : t)} disabled={!template?.autoSend} className="w-16 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs disabled:bg-slate-50 disabled:text-slate-300" /><span>日</span><select value={template?.sendHour ?? 10} onChange={(e) => setTemplate((t) => t ? { ...t, sendHour: Number(e.target.value) } : t)} disabled={!template?.autoSend} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs disabled:bg-slate-50 disabled:text-slate-300">{Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, "0")}:00</option>)}</select></div></div></div><div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/60 px-5 py-3"><button type="button" onClick={() => closeSendSettings()} className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-600">取消</button><button type="button" onClick={() => { void saveTemplate("send").then((saved) => { if (saved) closeSendSettings(false); }); }} disabled={busy || !template} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40">保存发送设置</button></div></div></div>}
    </div>
  );
}
