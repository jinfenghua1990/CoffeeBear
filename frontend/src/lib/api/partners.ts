/** 财务中心：统一往来单位档案（由 lib/api.ts 拆分，逻辑未改动） */
import type { JackyunFileImportRow } from "./jikeyun-import";
import type { JackyunRecordPreview } from "./purchase-orders";
import { authenticatedFetch, detailToMessage, jsonFetch, noContentFetch } from "./client";

export type BusinessPartnerRole = "supplier" | "customer" | "counterparty";

export type BusinessPartnerBankAccount = {
  bankName: string;
  accountNo: string;
  accountName: string;
  isPrimary: boolean;
};

export type BusinessPartnerIdentifier = {
  id: number;
  kind: "name" | "alias" | "tax_no" | "bank_account" | "customer_code" | string;
  value: string;
  isPrimary: boolean;
  source: string;
};

export type BusinessPartnerSummary = {
  purchaseOrderCount: number;
  purchaseAmount: number;
  inboundCount: number;
  inboundAmount: number;
  invoiceCount: number;
  invoiceAmount: number;
  bankTransactionCount: number;
  bankPaidAmount: number;
  bankReceivedAmount: number;
  purchasePaymentDifference: number;
  invoicePaymentDifference: number;
  salesOrderCount: number;
  salesReceivedAmount: number;
  needsReviewCount: number;
};

export type BusinessPartnerListItem = {
  id: number;
  name: string;
  taxNo: string;
  roles: BusinessPartnerRole[];
  status: string;
  identifiers: BusinessPartnerIdentifier[];
  formerNames: string[];
  legacySupplierId: number | null;
  summary: BusinessPartnerSummary;
  possibleDuplicateCount: number;
};

export type BusinessPartnerDuplicate = {
  id: number;
  name: string;
  taxNo: string;
};

export type BusinessPartnerDetail = BusinessPartnerListItem & {
  possibleDuplicates: BusinessPartnerDuplicate[];
  contact: string;
  phone: string;
  address: string;
  bankName: string;
  bankAccountNo: string;
  bankAccountName: string;
  bankAccounts: BusinessPartnerBankAccount[];
  notes: string;
  createdAt: string | null;
  updatedAt: string | null;
  purchases: Array<{
    sourceType: string; id: number; no: string; platform: string; title: string; date: string | null;
    amount: number; paidAmount: number; status: string;
  }>;
  inbounds: Array<{
    sourceType: string; id: number; no: string; date: string | null; warehouse: string;
    quantity: number; amount: number;
  }>;
  invoices: Array<{
    id: number; no: string; date: string | null; direction: string; status: string;
    sellerName: string; buyerName: string; amount: number; effectiveAmount?: number; bankPaidAmount: number;
    bankRemainingAmount: number; matchStatus: string; category: string; verified: boolean;
    invoiceColor?: "blue" | "red" | "unknown" | string;
    invoiceStatusLabel?: string;
    redStatus?: string;
    redOffsetAmount?: number;
    redRelatedInvoiceNo?: string;
    accountingException?: string;
  }>;
  payments: Array<{
    id: number; date: string | null; transactionTime: string | null; direction: string; amount: number;
    counterpartyName: string; counterpartyAccount: string; summary: string; serialNo: string;
    voucherNo: string; sourceRowNumber: number | null; rawAvailable: boolean; rawUrl: string;
    invoices: Array<{ invoiceId: number; invoiceNo: string; allocatedAmount: number }>;
  }>;
  sales: Array<{
    id: number; no: string; sourceNo: string; date: string | null; paidAt: string | null;
    platform: string; customerCode: string; amount: number; paidAmount: number; status: string;
  }>;
  reviewItems: Array<{
    linkId: number; sourceType: string; sourceLabel: string; sourceId: number; relationRole: string;
    rawName: string; rawTaxNo: string; rawAccountNo: string; candidatePartnerIds: number[];
    evidence: Record<string, unknown>; no: string; date: string | null; amount: number;
  }>;
};

export type PartnerReferenceCoverage = {
  sources: Record<string, {
    total: number;
    linked: number;
    unlinked: number;
    coverage: number;
  }>;
  totalFacts: number;
  linkedFacts: number;
  unlinkedFacts: number;
  coverage: number;
};

export type BusinessPartnerInput = {
  name: string;
  roles: BusinessPartnerRole[];
  taxNo?: string;
  contact?: string;
  phone?: string;
  address?: string;
  bankName?: string;
  bankAccountNo?: string;
  bankAccountName?: string;
  formerNames?: string[];
  bankAccounts?: BusinessPartnerBankAccount[];
  notes?: string;
};

export const businessPartnerApi = {
  list: (keyword = "", role: "all" | BusinessPartnerRole = "all") =>
    jsonFetch<{ total: number; items: BusinessPartnerListItem[] }>(
      `/api/v1/finance/partners?keyword=${encodeURIComponent(keyword)}&role=${encodeURIComponent(role)}`,
    ),
  detail: (id: number) => jsonFetch<BusinessPartnerDetail>(`/api/v1/finance/partners/${id}`),
  coverage: () =>
    jsonFetch<PartnerReferenceCoverage>("/api/v1/finance/partners/coverage"),
  recheck: (id: number) => jsonFetch<{
    ok: boolean;
    partnerId: number;
    createdLinks: number;
    updatedLinks: number;
    needsReview: number;
    partnerMatchesAdded: number;
    partnerInvoicePaidBefore: number;
    partnerInvoicePaidAfter: number;
    bankInvoiceMatchesCreated: number;
    bankInvoiceRepaired: number;
    bankInvoiceAmbiguous: number;
    detail: BusinessPartnerDetail;
  }>(`/api/v1/finance/partners/${id}/recheck`, { method: "POST" }),
  sync: () => jsonFetch<{
    ok: boolean;
    createdPartners: number;
    updatedPartners: number;
    createdLinks: number;
    updatedLinks: number;
    needsReview: number;
    bankInvoicePeriods: number;
    bankInvoiceMatchesCreated: number;
    bankInvoiceRepaired: number;
    bankInvoiceAmbiguous: number;
  }>(
    "/api/v1/finance/partners/sync", { method: "POST" },
  ),
  create: (body: BusinessPartnerInput) =>
    jsonFetch<BusinessPartnerDetail>("/api/v1/finance/partners", { method: "POST", body: JSON.stringify(body) }),
  update: (id: number, body: BusinessPartnerInput) =>
    jsonFetch<BusinessPartnerDetail>(`/api/v1/finance/partners/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  addIdentifier: (id: number, kind: BusinessPartnerIdentifier["kind"], value: string) =>
    jsonFetch<BusinessPartnerDetail>(`/api/v1/finance/partners/${id}/identifiers`, {
      method: "POST", body: JSON.stringify({ kind, value }),
    }),
  decideDuplicate: (id: number, otherId: number, body: { same: boolean; note?: string }) =>
    jsonFetch<BusinessPartnerDetail>(`/api/v1/finance/partners/${id}/duplicates/${otherId}/decide`, {
      method: "POST", body: JSON.stringify(body),
    }),
  claimReview: (id: number, linkId: number, note = "") =>
    jsonFetch<BusinessPartnerDetail>(`/api/v1/finance/partners/${id}/review-links/${linkId}/claim`, {
      method: "POST", body: JSON.stringify({ note }),
    }),
};

export const jackyunFileApi = {
  imports: (lifecycle?: string) => {
    const q = lifecycle ? `?lifecycle=${encodeURIComponent(lifecycle)}` : "";
    return jsonFetch<JackyunFileImportRow[]>(`/api/v1/jackyun-files/imports${q}`);
  },
  upload: async (file: File, autoConfirm = false) => {
    const form = new FormData();
    form.append("file", file);
    const query = `?auto_confirm=${autoConfirm ? "true" : "false"}`;
    const res = await authenticatedFetch(`/api/v1/jackyun-files/imports${query}`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { detail?: unknown };
      throw new Error(detailToMessage(body.detail, `上传失败（${res.status}）`));
    }
    return res.json() as Promise<{ duplicate: boolean; lifecycle: string; import: JackyunFileImportRow }>;
  },
  confirm: (id: number) =>
    jsonFetch<JackyunFileImportRow>(`/api/v1/jackyun-files/imports/${id}/confirm`, { method: "POST" }),
  softDelete: (id: number) => noContentFetch(`/api/v1/jackyun-files/imports/${id}`),
  restore: (id: number) =>
    jsonFetch<JackyunFileImportRow>(`/api/v1/jackyun-files/imports/${id}/restore`, { method: "POST" }),
  records: (id: number) =>
    jsonFetch<JackyunRecordPreview[]>(`/api/v1/jackyun-files/imports/${id}/records`),
  deleteRow: (id: number, rowIndex: number) =>
    noContentFetch(`/api/v1/jackyun-files/imports/${id}/records/${rowIndex}`),
  restoreRow: (id: number, rowIndex: number) =>
    jsonFetch<{ rowIndex: number; rowStatus: string }>(
      `/api/v1/jackyun-files/imports/${id}/records/${rowIndex}/restore`,
      { method: "POST" }
    ),
};

export type MasterDataImportResult = {
  ok: boolean;
  dataset: string;
  sheet: string;
  rows: number;
  skipped?: number;
  created: number;
  updated: number;
  mappingsCreated?: number;
  mappingsRemoved?: number;
  linkedProducts?: number;
  linkedConsumables?: number;
  ignoredInventoryFields?: string[];
};

export const masterDataApi = {
  importXlsx: async (dataset: "catalog" | "bundles" | "tax_rules" | "warehouses" | "suppliers" | "external_orders", file: File) => {
    const form = new FormData();
    form.append("file", file);
    const res = await authenticatedFetch(`/api/v1/data/import/${dataset}`, { method: "POST", body: form });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { detail?: unknown };
      throw new Error(detailToMessage(body.detail, `回导失败（${res.status}）`));
    }
    return res.json() as Promise<MasterDataImportResult>;
  },
};
