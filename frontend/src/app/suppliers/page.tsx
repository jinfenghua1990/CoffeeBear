"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supplierApi, SupplierRecord, SupplierInput } from "@/lib/api";

type StatusFilter = "all" | "normal" | "temp";

type FormState = {
  id: number | null;
  name: string;
  platform: string;
  externalShopId: string;
  contact: string;
  taxNo: string;
  phone: string;
  address: string;
  notes: string;
  isTemp: boolean;
};

const EMPTY_FORM: FormState = {
  id: null,
  name: "",
  platform: "1688",
  externalShopId: "",
  contact: "",
  taxNo: "",
  phone: "",
  address: "",
  notes: "",
  isTemp: false,
};

const PLATFORM_OPTIONS = ["1688", "拼多多", "淘宝", "线下", "其他"];

function TempBadge() {
  return (
    <span className="ml-1.5 inline-block shrink-0 rounded bg-amber-100 px-1 py-px align-[1px] text-[10px] font-semibold leading-4 text-amber-700">
      临时
    </span>
  );
}

export default function SuppliersPage() {
  const [rows, setRows] = useState<SupplierRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SupplierRecord | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await supplierApi.list(keyword.trim(), status);
      setRows(data);
    } catch (error) {
      setNotice({ tone: "err", text: error instanceof Error ? error.message : "加载供应商失败" });
    } finally {
      setLoading(false);
    }
  }, [keyword, status]);

  useEffect(() => { void load(); }, [load]);

  const stats = useMemo(() => {
    const temp = rows.filter((r) => r.isTemp).length;
    const withTax = rows.filter((r) => r.taxNo).length;
    return { total: rows.length, temp, withTax };
  }, [rows]);

  function openCreate() {
    setForm({ ...EMPTY_FORM });
    setNotice(null);
  }

  function openEdit(row: SupplierRecord) {
    setForm({
      id: row.id,
      name: row.name,
      platform: row.platform || "1688",
      externalShopId: row.externalShopId,
      contact: row.contact,
      taxNo: row.taxNo,
      phone: row.phone,
      address: row.address,
      notes: row.notes,
      isTemp: row.isTemp,
    });
    setNotice(null);
  }

  async function save() {
    if (!form) return;
    if (!form.name.trim()) {
      setNotice({ tone: "err", text: "供应商名称必填" });
      return;
    }
    setSaving(true);
    try {
      const payload: SupplierInput = {
        name: form.name.trim(),
        platform: form.platform.trim(),
        externalShopId: form.externalShopId.trim(),
        contact: form.contact.trim(),
        taxNo: form.taxNo.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
        notes: form.notes.trim(),
        isTemp: form.isTemp,
      };
      if (form.id == null) {
        await supplierApi.create(payload);
        setNotice({ tone: "ok", text: `已新增供应商「${payload.name}」` });
      } else {
        await supplierApi.update(form.id, payload);
        setNotice({ tone: "ok", text: `已保存供应商「${payload.name}」` });
      }
      setForm(null);
      await load();
    } catch (error) {
      setNotice({ tone: "err", text: error instanceof Error ? error.message : "保存失败" });
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await supplierApi.remove(deleteTarget.id);
      setNotice({ tone: "ok", text: `已删除供应商「${deleteTarget.name}」` });
      setDeleteTarget(null);
      await load();
    } catch (error) {
      setNotice({ tone: "err", text: error instanceof Error ? error.message : "删除失败" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <header className="sticky top-0 z-20 -mx-8 -mt-6 flex flex-wrap items-end justify-between gap-3 border-b border-gray-200 bg-white/95 px-8 py-5 backdrop-blur">
        <div>
          <div className="text-xs font-medium text-violet-600">SUPPLY CHAIN / SUPPLIERS</div>
          <h1 className="mt-0.5 text-xl font-semibold tracking-tight text-slate-900">供应商档案</h1>
          <p className="mt-0.5 text-xs text-slate-500">维护供应商基础信息（税号、联系人等）；税号唯一，后续导入识别以税号自动匹配。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索名称 / 税号 / 联系人 / 电话"
              className="w-60 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none placeholder:text-slate-400 focus:border-violet-400"
            />
            <div className="flex overflow-hidden rounded-lg border border-slate-300 text-sm">
              {([["all", "全部"], ["normal", "正常"], ["temp", "临时"]] as [StatusFilter, string][]).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setStatus(key)}
                  className={status === key ? "bg-violet-600 px-3 py-1.5 font-medium text-white" : "bg-white px-3 py-1.5 text-slate-600 hover:bg-slate-50"}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={openCreate}
              className="rounded-lg bg-violet-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-violet-700"
            >
              + 新增供应商
            </button>
        </div>
      </header>

      {notice && (
        <div className={`rounded-lg px-3 py-2 text-sm ${notice.tone === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
          {notice.text}
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="h-4 w-1.5 rounded bg-violet-600" />
            <h2 className="text-sm font-semibold text-slate-800">供应商列表</h2>
          </div>
          <p className="text-xs text-slate-400">
            共 {stats.total} 家 · 正常 {stats.total - stats.temp} · 临时 {stats.temp} · 已维护税号 {stats.withTax}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-xs text-slate-500">
                <th className="px-4 py-2 font-medium">供应商名称</th>
                <th className="px-4 py-2 font-medium">税号</th>
                <th className="px-4 py-2 font-medium">平台 / 店铺</th>
                <th className="px-4 py-2 font-medium">联系人</th>
                <th className="px-4 py-2 font-medium">电话</th>
                <th className="px-4 py-2 font-medium">地址</th>
                <th className="px-4 py-2 font-medium">备注</th>
                <th className="px-4 py-2 text-right font-medium">采购单数</th>
                <th className="px-4 py-2 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-400">加载中…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-400">暂无供应商，点击右上角「新增供应商」维护基础资料</td></tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                    <td className="px-4 py-2 font-medium text-slate-800">
                      {row.name}
                      {row.isTemp && <TempBadge />}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-600">{row.taxNo}</td>
                    <td className="px-4 py-2 text-slate-600">
                      {row.platform}
                      {row.externalShopId ? ` / ${row.externalShopId}` : ""}
                    </td>
                    <td className="px-4 py-2 text-slate-600">{row.contact}</td>
                    <td className="px-4 py-2 tabular-nums text-slate-600">{row.phone}</td>
                    <td className="max-w-[220px] truncate px-4 py-2 text-slate-500" title={row.address}>{row.address}</td>
                    <td className="max-w-[160px] truncate px-4 py-2 text-slate-500" title={row.notes}>{row.notes}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-700">{row.orderCount ?? 0}</td>
                    <td className="px-4 py-2 text-right">
                      <button type="button" onClick={() => openEdit(row)} className="rounded px-2 py-1 text-xs font-medium text-violet-600 hover:bg-violet-50">编辑</button>
                      <button type="button" onClick={() => setDeleteTarget(row)} className="rounded px-2 py-1 text-xs font-medium text-red-500 hover:bg-red-50">删除</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => !saving && setForm(null)}>
          <div className="max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="h-4 w-1.5 rounded bg-violet-600" />
                <h3 className="text-base font-semibold text-slate-900">{form.id == null ? "新增供应商" : `编辑供应商（ID ${form.id}）`}</h3>
              </div>
              <button type="button" onClick={() => setForm(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="关闭">✕</button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="col-span-2 block">
                <span className="text-xs font-medium text-slate-600">供应商名称 <span className="text-red-500">*</span></span>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-violet-400"
                  placeholder="如：杭州XX食品有限公司"
                />
              </label>
              <label className="col-span-2 block">
                <span className="text-xs font-medium text-slate-600">税号（统一社会信用代码，唯一，用于自动识别）</span>
                <input
                  value={form.taxNo}
                  onChange={(e) => setForm({ ...form, taxNo: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 font-mono text-sm outline-none focus:border-violet-400"
                  placeholder="如：91330100MA27X8888B"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">平台</span>
                <select
                  value={form.platform}
                  onChange={(e) => setForm({ ...form, platform: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-violet-400"
                >
                  {PLATFORM_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">店铺 / 供应商编码</span>
                <input
                  value={form.externalShopId}
                  onChange={(e) => setForm({ ...form, externalShopId: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-violet-400"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">联系人</span>
                <input
                  value={form.contact}
                  onChange={(e) => setForm({ ...form, contact: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-violet-400"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">电话</span>
                <input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-violet-400"
                />
              </label>
              <label className="col-span-2 block">
                <span className="text-xs font-medium text-slate-600">地址</span>
                <input
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-violet-400"
                />
              </label>
              <label className="col-span-2 block">
                <span className="text-xs font-medium text-slate-600">备注</span>
                <input
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-violet-400"
                />
              </label>
              <label className="col-span-2 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2">
                <input
                  type="checkbox"
                  checked={form.isTemp}
                  onChange={(e) => setForm({ ...form, isTemp: e.target.checked })}
                  className="h-4 w-4 accent-amber-600"
                />
                <span className="text-xs text-amber-700">标记为临时供应商（一次性采购，不作为长期合作主档识别）</span>
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setForm(null)} disabled={saving} className="rounded-lg border border-slate-300 px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">取消</button>
              <button type="button" onClick={() => void save()} disabled={saving} className="rounded-lg bg-violet-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50">
                {saving ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => !saving && setDeleteTarget(null)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-slate-900">确认删除供应商？</h3>
            <p className="mt-2 text-sm text-slate-600">
              将删除「{deleteTarget.name}」{deleteTarget.taxNo ? `（税号 ${deleteTarget.taxNo}）` : ""}。
              <span className="text-red-500">此操作不可恢复。</span>
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setDeleteTarget(null)} disabled={saving} className="rounded-lg border border-slate-300 px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">取消</button>
              <button type="button" onClick={() => void confirmDelete()} disabled={saving} className="rounded-lg bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
                {saving ? "删除中…" : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
