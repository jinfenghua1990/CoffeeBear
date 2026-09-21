"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "@/components/workspace/workspace-link";
import {
  authenticatedFetch,
  businessPartnerApi,
  type BusinessPartnerDetail,
  type BusinessPartnerInput,
  type BusinessPartnerListItem,
  type BusinessPartnerRole,
} from "@/lib/api";
import { useTabScopedState, useTabTitle } from "@/lib/workspace/tab-store";

type RoleFilter = "all" | BusinessPartnerRole;
type DetailTab = "overview" | "purchases" | "inbounds" | "invoices" | "payments" | "sales" | "review" | "profile";

type BankRawDetail = {
  id: number;
  txnDate: string;
  transactionTime: string | null;
  accountNo: string;
  accountCode?: string;
  serialNo: string;
  voucherNo: string;
  sourceRowNumber: number | null;
  raw: { fields?: Record<string, unknown>; rowNumber?: number; sourceHistory?: unknown[]; [key: string]: unknown };
  sourceFile: { fileName: string; sha256: string; downloadUrl?: string } | null;
};

const roleLabels: Record<BusinessPartnerRole, string> = {
  supplier: "供应商",
  customer: "客户",
  counterparty: "其他往来",
};

const emptyForm: BusinessPartnerInput = {
  name: "",
  roles: ["counterparty"],
  taxNo: "",
  contact: "",
  phone: "",
  address: "",
  bankName: "",
  bankAccountNo: "",
  bankAccountName: "",
  notes: "",
};

function money(value: number | null | undefined) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount)
    ? `¥${amount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "—";
}

function dateText(value: string | null | undefined) {
  return value ? value.slice(0, 10) : "—";
}

function rawValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  try { return JSON.stringify(value); } catch { return String(value); }
}

function RoleBadges({ roles }: { roles: BusinessPartnerRole[] }) {
  if (!roles.length) return <span className="text-xs text-slate-400">未分类</span>;
  return <span className="flex flex-wrap gap-1">{roles.map((role) => (
    <span key={role} className={role === "supplier" ? "rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700" : role === "customer" ? "rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700" : "rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600"}>
      {roleLabels[role]}
    </span>
  ))}</span>;
}

function Metric({ label, value, hint, tone = "slate" }: { label: string; value: string; hint?: string; tone?: "slate" | "blue" | "amber" | "emerald" }) {
  const tones = {
    slate: "border-slate-200 bg-white",
    blue: "border-blue-100 bg-blue-50/50",
    amber: "border-amber-100 bg-amber-50/50",
    emerald: "border-emerald-100 bg-emerald-50/50",
  };
  return <div className={`rounded-xl border px-3 py-2.5 ${tones[tone]}`}>
    <div className="text-[11px] text-slate-500">{label}</div>
    <div className="mt-1 text-base font-semibold tabular-nums text-slate-900">{value}</div>
    {hint && <div className="mt-1 text-[10px] leading-4 text-slate-400">{hint}</div>}
  </div>;
}

function partnerToForm(detail: BusinessPartnerDetail): BusinessPartnerInput {
  return {
    name: detail.name,
    roles: detail.roles.length ? detail.roles : ["counterparty"],
    taxNo: detail.taxNo,
    contact: detail.contact,
    phone: detail.phone,
    address: detail.address,
    bankName: detail.bankName,
    bankAccountNo: detail.bankAccountNo,
    bankAccountName: detail.bankAccountName,
    notes: detail.notes,
  };
}

export default function BusinessPartnersPage() {
  const [items, setItems] = useState<BusinessPartnerListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [keywordInput, setKeywordInput] = useTabScopedState("finance.partners.keywordInput", "");
  const [keyword, setKeyword] = useTabScopedState("finance.partners.keyword", "");
  const [role, setRole] = useTabScopedState<RoleFilter>("finance.partners.role", "all");
  const [selectedId, setSelectedId] = useTabScopedState<number | null>("finance.partners.selectedId", null);
  const [tab, setTab] = useTabScopedState<DetailTab>("finance.partners.tab", "overview");
  const [detail, setDetail] = useState<BusinessPartnerDetail | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [form, setForm] = useState<BusinessPartnerInput | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [alias, setAlias] = useState("");
  const [rawDetail, setRawDetail] = useState<BankRawDetail | null>(null);
  const [rawLoading, setRawLoading] = useState(false);
  const initialSelection = useRef(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await businessPartnerApi.list(keyword.trim(), role);
      setItems(response.items);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "加载往来单位失败");
    } finally {
      setLoading(false);
    }
  }, [keyword, role]);

  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => {
    const timer = window.setTimeout(() => setKeyword(keywordInput), 280);
    return () => window.clearTimeout(timer);
  }, [keywordInput, setKeyword]);

  useEffect(() => {
    if (initialSelection.current && selectedId != null && items.some((row) => row.id === selectedId)) return;
    initialSelection.current = true;
    setSelectedId(items[0]?.id ?? null);
  }, [items, selectedId, setSelectedId]);

  const loadDetail = useCallback(async (id: number | null) => {
    setDetail(null);
    if (id == null) return;
    setDetailLoading(true);
    try {
      setDetail(await businessPartnerApi.detail(id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "加载往来明细失败");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => { void loadDetail(selectedId); }, [loadDetail, selectedId]);
  useTabTitle(detail ? `往来单位 · ${detail.name}` : "往来单位档案");

  const totalReview = useMemo(
    () => items.reduce((total, item) => total + item.summary.needsReviewCount, 0),
    [items],
  );

  async function syncAll() {
    setSyncing(true);
    setMessage("");
    setError("");
    try {
      const result = await businessPartnerApi.sync();
      setMessage(`已核对全部来源：新增 ${result.createdPartners} 个档案，新增 ${result.createdLinks} 条关联，待确认 ${result.needsReview} 条。`);
      await loadList();
      await loadDetail(selectedId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "同步失败");
    } finally {
      setSyncing(false);
    }
  }

  async function saveForm() {
    if (!form) return;
    setSaving(true);
    setError("");
    try {
      const next = editingId == null
        ? await businessPartnerApi.create(form)
        : await businessPartnerApi.update(editingId, form);
      setForm(null);
      setEditingId(null);
      setSelectedId(next.id);
      setDetail(next);
      setMessage(editingId == null ? `已新建往来单位「${next.name}」。` : `已保存「${next.name}」，历史来源已重新核对。`);
      await loadList();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function addAlias() {
    if (!detail || !alias.trim()) return;
    setSaving(true);
    try {
      const next = await businessPartnerApi.addIdentifier(detail.id, "alias", alias.trim());
      setDetail(next);
      setAlias("");
      setMessage("已补充别名并重新核对历史来源。匹配到的记录已归入当前档案；仍有歧义的保留待确认。");
      await loadList();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存别名失败");
    } finally {
      setSaving(false);
    }
  }

  async function claimReview(linkId: number, rawName: string) {
    if (!detail) return;
    if (!window.confirm(`确认将「${rawName || "该来源记录"}」归入「${detail.name}」？\n系统会保留原始名称，并把它作为已确认别名。`)) return;
    setSaving(true);
    try {
      const next = await businessPartnerApi.claimReview(detail.id, linkId, "财务中心人工确认往来单位归属");
      setDetail(next);
      setMessage("已人工确认归属，并保留来源名称作为别名和审计记录。");
      await loadList();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "确认关联失败");
    } finally {
      setSaving(false);
    }
  }

  async function openRaw(url: string) {
    setRawLoading(true);
    try {
      const response = await authenticatedFetch(url, { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as BankRawDetail & { detail?: string };
      if (!response.ok) throw new Error(payload.detail || `读取原始流水失败（${response.status}）`);
      setRawDetail(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "读取原始流水失败");
    } finally {
      setRawLoading(false);
    }
  }

  const tabs: Array<[DetailTab, string, number?]> = detail ? [
    ["overview", "往来概览"],
    ["purchases", `采购 ${detail.purchases.length}`],
    ["inbounds", `入库 ${detail.inbounds.length}`],
    ["invoices", `发票 ${detail.invoices.length}`],
    ["payments", `银行 ${detail.payments.length}`],
    ["sales", `销售 ${detail.sales.length}`],
    ["review", "待确认", detail.reviewItems.length],
    ["profile", "档案资料"],
  ] : [];

  return (
    <div className="mx-auto max-w-[1680px] space-y-4">
      <header className="sticky top-0 z-20 -mx-8 -mt-6 border-b border-slate-200 bg-white/95 px-8 py-4 backdrop-blur">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold tracking-wide text-blue-600">财务中心 / 往来单位档案</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">往来单位档案</h1>
            <p className="mt-1 text-sm text-slate-500">一个档案串联采购、入库、发票、银行支付和销售；来源原始记录保持不变。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => { setForm({ ...emptyForm }); setEditingId(null); }} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">新增往来单位</button>
            <button type="button" onClick={() => void syncAll()} disabled={syncing} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60">{syncing ? "正在核对…" : "核对全部来源"}</button>
          </div>
        </div>
      </header>

      {(message || error) && <div className={`rounded-lg border px-3 py-2 text-xs ${error ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>{error || message}</div>}

      <div className="grid gap-4 xl:grid-cols-[370px_minmax(0,1fr)]">
        <aside className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-3">
            <div className="flex items-center justify-between gap-2"><div className="text-sm font-semibold text-slate-800">全部往来单位</div><span className={totalReview ? "rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700" : "rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500"}>{totalReview ? `${totalReview} 条待确认` : `${items.length} 个档案`}</span></div>
            <input value={keywordInput} onChange={(event) => setKeywordInput(event.target.value)} placeholder="名称、税号、账号或别名" className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-blue-400" />
            <div className="mt-2 flex flex-wrap gap-1">
              {(["all", "supplier", "customer", "counterparty"] as RoleFilter[]).map((key) => <button key={key} type="button" onClick={() => setRole(key)} className={`rounded-md px-2 py-1 text-[11px] ${role === key ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{key === "all" ? "全部" : roleLabels[key]}</button>)}
            </div>
          </div>
          <div className="max-h-[calc(100vh-250px)] overflow-y-auto p-1.5">
            {loading && <div className="px-3 py-8 text-center text-sm text-slate-400">正在建立来源关联…</div>}
            {!loading && items.length === 0 && <div className="px-3 py-8 text-center text-sm text-slate-400">暂无匹配的往来单位</div>}
            {items.map((item) => <button key={item.id} type="button" onClick={() => { setSelectedId(item.id); setTab("overview"); }} className={`mb-1 w-full rounded-lg px-3 py-2.5 text-left transition ${selectedId === item.id ? "bg-blue-50 ring-1 ring-blue-200" : "hover:bg-slate-50"}`}>
              <div className="flex gap-2"><div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-slate-800">{item.name}</div><div className="mt-1"><RoleBadges roles={item.roles} /></div></div>{item.summary.needsReviewCount > 0 && <span className="mt-0.5 h-fit rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">待确认 {item.summary.needsReviewCount}</span>}</div>
              <div className="mt-2 grid grid-cols-3 gap-1 text-[10px] text-slate-500"><span>采购 {money(item.summary.purchaseAmount)}</span><span>发票 {money(item.summary.invoiceAmount)}</span><span>付款 {money(item.summary.bankPaidAmount)}</span></div>
            </button>)}
          </div>
        </aside>

        <main className="min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm">
          {!selectedId && <div className="flex min-h-[560px] flex-col items-center justify-center text-slate-400"><div className="text-base">选择一个往来单位</div><div className="mt-1 text-sm">查看它的采购、发票、银行支付和销售往来</div></div>}
          {selectedId && detailLoading && <div className="flex min-h-[560px] items-center justify-center text-sm text-slate-400">正在汇总往来数据…</div>}
          {detail && !detailLoading && <>
            <div className="border-b border-slate-100 px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="max-w-[650px] truncate text-xl font-semibold text-slate-900">{detail.name}</h2><RoleBadges roles={detail.roles} /></div><div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500"><span>税号：{detail.taxNo || "待补充"}</span><span>主账号：{detail.bankAccountNo || "待补充"}</span>{detail.legacySupplierId && <span>已承接原供应商档案</span>}</div></div><div className="flex gap-2"><button type="button" onClick={() => { setForm(partnerToForm(detail)); setEditingId(detail.id); }} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">编辑档案</button><Link href="/finance/bank-transactions?view=transactions" className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50">银行流水</Link></div></div>
              <div className="mt-4 flex gap-1 overflow-x-auto border-b border-slate-100 -mb-4"><div className="flex min-w-max gap-1">{tabs.map(([key, label, count]) => <button key={key} type="button" onClick={() => setTab(key)} className={`relative px-3 py-2.5 text-xs font-medium ${tab === key ? "text-blue-600" : "text-slate-500 hover:text-slate-700"}`}>{label}{count ? <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] text-amber-700">{count}</span> : null}{tab === key && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded bg-blue-600" />}</button>)}</div></div>
            </div>

            <div className="p-5">
              {tab === "overview" && <Overview detail={detail} onTab={setTab} />}
              {tab === "purchases" && <Purchases rows={detail.purchases} />}
              {tab === "inbounds" && <Inbounds rows={detail.inbounds} />}
              {tab === "invoices" && <Invoices rows={detail.invoices} />}
              {tab === "payments" && <Payments rows={detail.payments} rawLoading={rawLoading} onRaw={openRaw} />}
              {tab === "sales" && <Sales rows={detail.sales} />}
              {tab === "review" && <Review rows={detail.reviewItems} saving={saving} onClaim={claimReview} />}
              {tab === "profile" && <Profile detail={detail} alias={alias} setAlias={setAlias} saving={saving} onAddAlias={addAlias} />}
            </div>
          </>}
        </main>
      </div>

      {form && <PartnerForm form={form} setForm={setForm} editing={editingId != null} saving={saving} onClose={() => { setForm(null); setEditingId(null); }} onSave={() => void saveForm()} />}
      {rawDetail && <RawDialog detail={rawDetail} onClose={() => setRawDetail(null)} />}
    </div>
  );
}

function Overview({ detail, onTab }: { detail: BusinessPartnerDetail; onTab: (tab: DetailTab) => void }) {
  const s = detail.summary;
  return <div className="space-y-5">
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="采购实付" value={money(s.purchaseAmount)} hint={`${s.purchaseOrderCount} 张采购单`} tone="blue" />
      <Metric label="实际入库金额" value={money(s.inboundAmount)} hint={`${s.inboundCount} 张入库单`} />
      <Metric label="已收/关联发票" value={money(s.invoiceAmount)} hint={`${s.invoiceCount} 张发票`} tone="amber" />
      <Metric label="银行对公付款" value={money(s.bankPaidAmount)} hint={`${s.bankTransactionCount} 笔银行流水`} tone="emerald" />
      <Metric label="采购与付款差额" value={money(s.purchasePaymentDifference)} hint="用于核对，不替代会计应付余额" />
      <Metric label="发票与付款差额" value={money(s.invoicePaymentDifference)} hint="按当前已关联发票和付款计算" />
      <Metric label="销售实收" value={money(s.salesReceivedAmount)} hint={`${s.salesOrderCount} 张销售订单`} tone="emerald" />
      <Metric label="待人工确认" value={`${s.needsReviewCount} 条`} hint="名称相近、税号或账号证据不足时保留待确认" tone={s.needsReviewCount ? "amber" : "slate"} />
    </div>
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><div className="text-sm font-semibold text-slate-800">本档案的关联原则</div><p className="mt-1 text-xs leading-5 text-slate-600">优先按税号、银行账号、精确名称和已确认别名关联；相似名称不会自动合并。采购、发票、银行流水的原始记录仍保留在各自来源中，可随时回查。</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => onTab("review")} className="rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-50">处理待确认记录</button><button type="button" onClick={() => onTab("profile")} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100">补充税号、账号或别名</button></div></div>
  </div>;
}

function Empty({ text }: { text: string }) { return <div className="rounded-xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">{text}</div>; }

function Purchases({ rows }: { rows: BusinessPartnerDetail["purchases"] }) {
  if (!rows.length) return <Empty text="暂无已关联采购记录" />;
  return <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="min-w-[880px] w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2.5">采购单号</th><th className="px-3 py-2.5">渠道 / 摘要</th><th className="px-3 py-2.5">日期</th><th className="px-3 py-2.5 text-right">订单金额</th><th className="px-3 py-2.5 text-right">实付金额</th><th className="px-3 py-2.5">状态</th></tr></thead><tbody className="divide-y divide-slate-100">{rows.map((row) => <tr key={`${row.sourceType}-${row.id}`}><td className="px-3 py-2.5 font-mono text-slate-700">{row.no || "—"}</td><td className="max-w-[300px] px-3 py-2.5"><div className="text-slate-700">{row.platform || "—"}</div><div className="mt-0.5 truncate text-[10px] text-slate-400">{row.title || "—"}</div></td><td className="px-3 py-2.5 text-slate-600">{dateText(row.date)}</td><td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{money(row.amount)}</td><td className="px-3 py-2.5 text-right tabular-nums font-medium text-slate-800">{money(row.paidAmount)}</td><td className="px-3 py-2.5 text-slate-500">{row.status || "—"}</td></tr>)}</tbody></table></div>;
}

function Inbounds({ rows }: { rows: BusinessPartnerDetail["inbounds"] }) {
  if (!rows.length) return <Empty text="暂无已关联入库记录" />;
  return <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="min-w-[760px] w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2.5">入库单号</th><th className="px-3 py-2.5">日期</th><th className="px-3 py-2.5">仓库</th><th className="px-3 py-2.5 text-right">入库数量</th><th className="px-3 py-2.5 text-right">入库金额</th></tr></thead><tbody className="divide-y divide-slate-100">{rows.map((row) => <tr key={`${row.sourceType}-${row.id}`}><td className="px-3 py-2.5 font-mono text-slate-700">{row.no || "—"}</td><td className="px-3 py-2.5 text-slate-600">{dateText(row.date)}</td><td className="px-3 py-2.5 text-slate-600">{row.warehouse || "—"}</td><td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{row.quantity.toLocaleString("zh-CN", { maximumFractionDigits: 4 })}</td><td className="px-3 py-2.5 text-right tabular-nums font-medium text-slate-800">{money(row.amount)}</td></tr>)}</tbody></table></div>;
}

function Invoices({ rows }: { rows: BusinessPartnerDetail["invoices"] }) {
  if (!rows.length) return <Empty text="暂无已关联发票" />;
  return <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="min-w-[980px] w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2.5">发票号码</th><th className="px-3 py-2.5">日期</th><th className="px-3 py-2.5">开票双方</th><th className="px-3 py-2.5 text-right">价税合计</th><th className="px-3 py-2.5 text-right">银行已关联</th><th className="px-3 py-2.5 text-right">待核对</th><th className="px-3 py-2.5">状态</th></tr></thead><tbody className="divide-y divide-slate-100">{rows.map((row) => <tr key={row.id}><td className="px-3 py-2.5 font-mono text-slate-700">{row.no || "—"}</td><td className="px-3 py-2.5 text-slate-600">{dateText(row.date)}</td><td className="max-w-[330px] px-3 py-2.5"><div className="truncate text-slate-700">销方：{row.sellerName || "—"}</div><div className="mt-0.5 truncate text-[10px] text-slate-400">购方：{row.buyerName || "—"}</div></td><td className="px-3 py-2.5 text-right tabular-nums text-slate-800">{money(row.amount)}</td><td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">{money(row.bankPaidAmount)}</td><td className="px-3 py-2.5 text-right tabular-nums text-amber-700">{money(row.bankRemainingAmount)}</td><td className="px-3 py-2.5 text-slate-500">{row.verified ? "已认证" : row.matchStatus || "待核对"}</td></tr>)}</tbody></table></div>;
}

function Payments({ rows, rawLoading, onRaw }: { rows: BusinessPartnerDetail["payments"]; rawLoading: boolean; onRaw: (url: string) => void }) {
  if (!rows.length) return <Empty text="暂无已关联银行流水" />;
  return <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="min-w-[1080px] w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2.5">交易日期</th><th className="px-3 py-2.5">收支</th><th className="px-3 py-2.5">对方信息</th><th className="px-3 py-2.5 text-right">金额</th><th className="px-3 py-2.5">已关联发票</th><th className="px-3 py-2.5">原始流水</th></tr></thead><tbody className="divide-y divide-slate-100">{rows.map((row) => <tr key={row.id}><td className="px-3 py-2.5"><div className="text-slate-700">{dateText(row.transactionTime || row.date)}</div><div className="mt-0.5 font-mono text-[10px] text-slate-400">{row.serialNo || row.voucherNo || "—"}</div></td><td className="px-3 py-2.5"><span className={row.direction === "out" ? "rounded bg-rose-50 px-1.5 py-0.5 text-rose-700" : "rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700"}>{row.direction === "out" ? "支付" : "收款"}</span></td><td className="max-w-[280px] px-3 py-2.5"><div className="truncate text-slate-700">{row.counterpartyName || "—"}</div><div className="mt-0.5 truncate text-[10px] text-slate-400">{row.counterpartyAccount || row.summary || "—"}</div></td><td className="px-3 py-2.5 text-right font-medium tabular-nums text-slate-800">{money(row.amount)}</td><td className="max-w-[250px] px-3 py-2.5">{row.invoices.length ? <div className="space-y-1">{row.invoices.map((invoice) => <div key={invoice.invoiceId} className="truncate text-[10px] text-blue-700">{invoice.invoiceNo} · {money(invoice.allocatedAmount)}</div>)}</div> : <span className="text-slate-400">未关联发票</span>}</td><td className="px-3 py-2.5">{row.rawAvailable ? <button type="button" disabled={rawLoading} onClick={() => onRaw(row.rawUrl)} className="rounded border border-blue-200 px-2 py-1 text-[10px] font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50">查看原始记录</button> : <span className="text-[10px] text-slate-400">历史无原始行</span>}</td></tr>)}</tbody></table></div>;
}

function Sales({ rows }: { rows: BusinessPartnerDetail["sales"] }) {
  if (!rows.length) return <Empty text="暂无已关联销售记录" />;
  return <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="min-w-[800px] w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2.5">销售单号</th><th className="px-3 py-2.5">渠道</th><th className="px-3 py-2.5">日期</th><th className="px-3 py-2.5 text-right">应收</th><th className="px-3 py-2.5 text-right">实收</th><th className="px-3 py-2.5">状态</th></tr></thead><tbody className="divide-y divide-slate-100">{rows.map((row) => <tr key={row.id}><td className="px-3 py-2.5 font-mono text-slate-700">{row.no || "—"}<div className="mt-0.5 text-[10px] text-slate-400">{row.sourceNo || row.customerCode || ""}</div></td><td className="px-3 py-2.5 text-slate-600">{row.platform || "—"}</td><td className="px-3 py-2.5 text-slate-600">{dateText(row.date)}</td><td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{money(row.amount)}</td><td className="px-3 py-2.5 text-right tabular-nums font-medium text-emerald-700">{money(row.paidAmount)}</td><td className="px-3 py-2.5 text-slate-500">{row.status || "—"}</td></tr>)}</tbody></table></div>;
}

function Review({ rows, saving, onClaim }: { rows: BusinessPartnerDetail["reviewItems"]; saving: boolean; onClaim: (id: number, name: string) => void }) {
  if (!rows.length) return <Empty text="没有待确认记录。系统没有把相似名称自动串账。" />;
  return <div className="space-y-2">{rows.map((row) => <div key={row.linkId} className="rounded-xl border border-amber-200 bg-amber-50/40 p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="text-sm font-medium text-slate-800">{row.sourceLabel} · {row.no || "未编号"}</div><div className="mt-1 text-xs text-slate-600">来源名称：{row.rawName || "—"}　税号：{row.rawTaxNo || "—"}　账号：{row.rawAccountNo || "—"}</div><div className="mt-1 text-[11px] text-slate-500">日期 {dateText(row.date)} · 金额 {money(row.amount)} · 系统发现当前档案是候选，但没有足够证据自动确认。</div></div><button type="button" disabled={saving} onClick={() => onClaim(row.linkId, row.rawName)} className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50">确认归入此档案</button></div></div>)}</div>;
}

function Profile({ detail, alias, setAlias, saving, onAddAlias }: { detail: BusinessPartnerDetail; alias: string; setAlias: (value: string) => void; saving: boolean; onAddAlias: () => void }) {
  const grouped = detail.identifiers.reduce<Record<string, string[]>>((result, row) => { (result[row.kind] ||= []).push(row.value); return result; }, {});
  const labels: Record<string, string> = { name: "主名称", alias: "已确认别名", tax_no: "税号", bank_account: "银行账号", customer_code: "客户编码" };
  return <div className="space-y-5"><div className="grid gap-3 md:grid-cols-2"><Info label="联系人" value={detail.contact} /><Info label="电话" value={detail.phone} /><Info label="地址" value={detail.address} /><Info label="开户行" value={detail.bankName} /><Info label="主银行账号" value={detail.bankAccountNo} /><Info label="开户名称" value={detail.bankAccountName} /></div><div className="rounded-xl border border-slate-200 p-4"><div className="text-sm font-semibold text-slate-800">名称、税号和账号证据</div><div className="mt-3 space-y-3">{Object.entries(grouped).map(([kind, values]) => <div key={kind}><div className="text-[11px] text-slate-500">{labels[kind] || kind}</div><div className="mt-1 flex flex-wrap gap-1.5">{values.map((value) => <span key={`${kind}-${value}`} className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700">{value}</span>)}</div></div>)}</div><div className="mt-4 border-t border-slate-100 pt-4"><div className="text-xs font-medium text-slate-700">补充已确认名称别名</div><p className="mt-1 text-[11px] leading-4 text-slate-500">例如银行户名、发票卖方名称或带“个体工商户”的完整名称。保存后系统会重新核对待确认来源。</p><div className="mt-2 flex gap-2"><input value={alias} onChange={(event) => setAlias(event.target.value)} placeholder="输入已确认的完整名称" className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400" /><button type="button" disabled={saving || !alias.trim()} onClick={onAddAlias} className="rounded-lg border border-blue-200 px-3 py-2 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50">保存别名</button></div></div></div><div className="rounded-xl border border-slate-200 p-4"><div className="text-sm font-semibold text-slate-800">备注</div><div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">{detail.notes || "暂无备注"}</div></div></div>;
}

function Info({ label, value }: { label: string; value: string }) { return <div className="rounded-lg bg-slate-50 px-3 py-2.5"><div className="text-[11px] text-slate-400">{label}</div><div className="mt-1 break-all text-sm text-slate-700">{value || "—"}</div></div>; }

function PartnerForm({ form, setForm, editing, saving, onClose, onSave }: { form: BusinessPartnerInput; setForm: (next: BusinessPartnerInput) => void; editing: boolean; saving: boolean; onClose: () => void; onSave: () => void }) {
  const formInput = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-400";
  function set<K extends keyof BusinessPartnerInput>(key: K, value: BusinessPartnerInput[K]) { setForm({ ...form, [key]: value }); }
  function toggleRole(role: BusinessPartnerRole) { const roles = form.roles.includes(role) ? form.roles.filter((item) => item !== role) : [...form.roles, role]; set("roles", roles.length ? roles : ["counterparty"]); }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-4"><div className="max-h-[calc(100vh-40px)] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl"><div className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4"><div><h3 className="text-base font-semibold text-slate-900">{editing ? "编辑往来单位" : "新增往来单位"}</h3><p className="mt-1 text-xs text-slate-500">主档资料只维护一次，采购、发票和银行流水共同使用。</p></div><button type="button" onClick={onClose} className="text-xl text-slate-400 hover:text-slate-700">×</button></div><div className="grid gap-3 p-5 sm:grid-cols-2"><Field label="单位名称 *"><input value={form.name} onChange={(event) => set("name", event.target.value)} className={formInput} /></Field><Field label="税号"><input value={form.taxNo || ""} onChange={(event) => set("taxNo", event.target.value)} className={formInput} /></Field><div className="sm:col-span-2"><div className="mb-1 text-xs font-medium text-slate-600">角色</div><div className="flex flex-wrap gap-2">{(["supplier", "customer", "counterparty"] as BusinessPartnerRole[]).map((role) => <label key={role} className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-700"><input type="checkbox" checked={form.roles.includes(role)} onChange={() => toggleRole(role)} />{roleLabels[role]}</label>)}</div></div><Field label="联系人"><input value={form.contact || ""} onChange={(event) => set("contact", event.target.value)} className={formInput} /></Field><Field label="电话"><input value={form.phone || ""} onChange={(event) => set("phone", event.target.value)} className={formInput} /></Field><Field label="开户行"><input value={form.bankName || ""} onChange={(event) => set("bankName", event.target.value)} className={formInput} /></Field><Field label="银行账号"><input value={form.bankAccountNo || ""} onChange={(event) => set("bankAccountNo", event.target.value)} className={formInput} /></Field><Field label="开户名称" wide><input value={form.bankAccountName || ""} onChange={(event) => set("bankAccountName", event.target.value)} className={formInput} /></Field><Field label="地址" wide><input value={form.address || ""} onChange={(event) => set("address", event.target.value)} className={formInput} /></Field><Field label="备注" wide><textarea value={form.notes || ""} onChange={(event) => set("notes", event.target.value)} rows={3} className={`${formInput} resize-y`} /></Field></div><div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4"><button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">取消</button><button type="button" disabled={saving || !form.name.trim()} onClick={onSave} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{saving ? "保存中…" : "保存并核对来源"}</button></div></div></div>;
}

function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) { return <label className={wide ? "sm:col-span-2" : ""}><span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>{children}</label>; }

function RawDialog({ detail, onClose }: { detail: BankRawDetail; onClose: () => void }) { return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/35 p-4"><div className="max-h-[calc(100vh-40px)] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl"><div className="sticky top-0 flex items-start justify-between border-b border-slate-100 bg-white px-5 py-4"><div><h3 className="text-base font-semibold text-slate-900">银行原始流水记录</h3><p className="mt-1 text-xs text-slate-500">第 {detail.sourceRowNumber ?? detail.raw.rowNumber ?? "—"} 行 · 流水号 {detail.serialNo || "—"}</p></div><button type="button" onClick={onClose} className="text-xl text-slate-400 hover:text-slate-700">×</button></div><div className="grid gap-2 p-5 sm:grid-cols-4"><Info label="交易日期" value={detail.txnDate} /><Info label="交易时间" value={detail.transactionTime || ""} /><Info label="凭证号码" value={detail.voucherNo} /><Info label="我方账号" value={detail.accountNo} /></div><div className="px-5 pb-5"><div className="rounded-xl border border-slate-200"><div className="border-b border-slate-100 px-3 py-2 text-xs font-medium text-slate-700">完整原始字段</div><div className="grid gap-px bg-slate-100 sm:grid-cols-2">{Object.entries(detail.raw.fields || {}).map(([key, value]) => <div key={key} className="bg-white px-3 py-2"><div className="text-[10px] text-slate-400">{key}</div><div className="mt-1 break-all text-xs text-slate-700">{rawValue(value)}</div></div>)}{!Object.keys(detail.raw.fields || {}).length && <pre className="overflow-x-auto bg-white p-3 text-xs text-slate-600">{JSON.stringify(detail.raw, null, 2)}</pre>}</div></div>{detail.sourceFile && <div className="mt-3 text-xs text-slate-500">来源文件：{detail.sourceFile.fileName} · SHA256：{detail.sourceFile.sha256}{detail.sourceFile.downloadUrl && <a className="ml-2 font-medium text-blue-600" href={detail.sourceFile.downloadUrl}>下载原文件</a>}</div>}</div></div></div>; }
