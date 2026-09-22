"use client";

import Link from "next/link";

const cards = [
  { title: "供应商主档", value: "检查中", desc: "统一 BusinessPartner 关联状态" },
  { title: "采购关联", value: "检查中", desc: "采购订单供应商匹配" },
  { title: "发票关联", value: "检查中", desc: "发票主体归集状态" },
  { title: "银行流水", value: "检查中", desc: "往来账户匹配状态" },
];

export default function SupplierHealthPage() {
  return (
    <main className="min-h-screen bg-neutral-50 p-8 text-neutral-900">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">供应商数据健康中心</h1>
            <p className="mt-2 text-sm text-neutral-500">
              检查供应商、采购、发票、付款是否统一归集到往来主体。
            </p>
          </div>
          <Link href="/purchase/workbench" className="rounded-lg border bg-white px-4 py-2 text-sm">
            返回采购工作台
          </Link>
        </div>

        <section className="grid gap-4 md:grid-cols-4">
          {cards.map((item) => (
            <div key={item.title} className="rounded-xl border bg-white p-5 shadow-sm">
              <div className="text-sm text-neutral-500">{item.title}</div>
              <div className="mt-3 text-xl font-semibold">{item.value}</div>
              <div className="mt-2 text-xs text-neutral-400">{item.desc}</div>
            </div>
          ))}
        </section>

        <section className="rounded-xl border bg-white p-6">
          <h2 className="font-medium">异常处理入口</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-lg bg-neutral-50 p-4">未关联供应商</div>
            <div className="rounded-lg bg-neutral-50 p-4">重复供应商主体</div>
            <div className="rounded-lg bg-neutral-50 p-4">待确认历史名称</div>
          </div>
        </section>
      </div>
    </main>
  );
}
