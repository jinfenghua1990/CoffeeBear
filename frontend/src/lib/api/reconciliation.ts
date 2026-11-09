/** 回款中心：银行流水与结算匹配（由 lib/api.ts 拆分，逻辑未改动） */
import { jsonFetch } from "./client";

export type RuleRow = {
  id: number;
  matchPattern: string;
  matchType: string;
  platform: string;
  enabled: boolean;
  note: string;
};

export type ReconTxn = {
  id: number;
  txnDate: string;
  direction: string;
  amount: string;
  accountNo?: string;
  accountCode?: string;
  accountName?: string;
  bankName?: string;
  counterpartyName: string;
  summary: string;
  serialNo: string;
  voucherNo: string;
  transactionTime?: string | null;
  sourceRowNumber?: number | null;
  importBatchId?: number | null;
  rawAvailable?: boolean;
  accountSource?: "file" | "manual" | string;
  /** 兼容字段：收入=settlementMatched；支出=invoicePaymentMatched。新代码优先使用显式域字段。 */
  matched: boolean;
  settlementMatched?: boolean;
  settlementMatchStatus?: "matched" | "unmatched" | "not_applicable" | string;
  invoiceMatched?: boolean;
  invoiceMatchStatus?: "matched" | "partial" | "unmatched" | "not_applicable" | string;
  invoicePaymentMatched?: boolean;
  invoicePaymentMatchStatus?: "matched" | "partial" | "unmatched" | "not_applicable" | string;
  invoiceMatchedAmount?: string;
  invoiceRemainingAmount?: string;
  invoicePaymentMatchedAmount?: string;
  invoicePaymentRemainingAmount?: string;
  matchStatus?: "matched" | "partial" | "unmatched" | "not_applicable" | string;
  settlementMatchedAt?: string | null;
  invoicePaymentMatchedAt?: string | null;
  /** 兼容时间：收入=settlementMatchedAt；支出=invoicePaymentMatchedAt。 */
  matchedAt?: string | null;
};

export type SettlementRow = {
  id: number;
  platform: string;
  storeName: string;
  period: string;
  expectedAmount: string;
  settledAmount: string;
  status: string;
};

export type Suggestion = {
  txnId: number;
  txnDate: string;
  counterparty: string;
  amount: string;
  settlementId: number;
  platform: string;
  period: string;
  expectedAmount: string;
  score: number;
  confidence: string;
  reasons: string[];
};

export type ReconOverview = {
  receivable: string;
  received: string;
  pending: string;
  byPlatform: Record<string, { expected: string; settled: string }>;
};

export const reconApi = {
  overview: () => jsonFetch<ReconOverview>("/api/v1/reconciliation/overview"),
  rules: () => jsonFetch<RuleRow[]>("/api/v1/reconciliation/rules"),
  createRule: (body: { match_pattern: string; match_type: string; platform: string; note?: string }) =>
    jsonFetch<{ id: number }>("/api/v1/reconciliation/rules", { method: "POST", body: JSON.stringify(body) }),
  deleteRule: (id: number) =>
    jsonFetch<{ ok: boolean }>(`/api/v1/reconciliation/rules/${id}`, { method: "DELETE" }),
  transactions: (limit = 500) => jsonFetch<ReconTxn[]>(`/api/v1/reconciliation/transactions?limit=${limit}`),
  createTxn: (body: Record<string, unknown>) =>
    jsonFetch<{ id: number; created: boolean; fingerprint: string }>("/api/v1/reconciliation/transactions", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  settlements: () => jsonFetch<SettlementRow[]>("/api/v1/reconciliation/settlements"),
  createSettlement: (body: Record<string, unknown>) =>
    jsonFetch<{ id: number }>("/api/v1/reconciliation/settlements", { method: "POST", body: JSON.stringify(body) }),
  suggestions: () => jsonFetch<Suggestion[]>("/api/v1/reconciliation/suggestions"),
  confirm: (txnId: number, settlementId: number) =>
    jsonFetch<{ id: number; score: number; confidence: string }>("/api/v1/reconciliation/confirm", {
      method: "POST",
      body: JSON.stringify({ txn_id: txnId, settlement_id: settlementId }),
    }),
  reject: (txnId: number, settlementId: number) =>
    jsonFetch<{ ok: boolean }>("/api/v1/reconciliation/reject", {
      method: "POST",
      body: JSON.stringify({ txn_id: txnId, settlement_id: settlementId }),
    }),
};
