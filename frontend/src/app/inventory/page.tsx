"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { GoodsInventoryPanel, ConsumableInventoryPanel } from "@/app/products/inventory-panel";

type InventoryTab = "all" | "goods" | "consumables";

const TABS: Array<{ key: InventoryTab; label: string; hint: string }> = [
  { key: "all", label: "全部库存", hint: "正品 + 耗材" },
  { key: "goods", label: "正品库存", hint: "采购 − 出库" },
  { key: "consumables", label: "耗材库存", hint: "本系统台账" },
];

export default function InventoryPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rawTab = searchParams.get("tab");
  const tab: InventoryTab = rawTab === "goods" || rawTab === "consumables" ? rawTab : "all";
  const search = searchParams.get("search") ?? "";

  function changeTab(next: InventoryTab) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "all") params.delete("tab");
    else params.set("tab", next);
    router.replace(`${pathname}${params.toString() ? `?${params}` : ""}`);
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-5">
      <header className="sticky top-0 z-20 -mx-8 -mt-6 border-b border-slate-200 bg-white/95 px-8 py-5 backdrop-blur">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs font-medium text-indigo-600">SUPPLY CHAIN / INVENTORY</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">库存管理</h1>
            <p className="mt-1 text-sm text-slate-500">正品库存由本系统独立运算（采购入库 − 销售出库），按仓库名称分组；耗材走本系统台账。</p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => changeTab(item.key)}
              className={`rounded-lg px-4 py-2 text-sm transition ${tab === item.key ? "bg-white font-medium text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
            >
              {item.label}
              <span className="ml-2 text-[11px] text-slate-400">{item.hint}</span>
            </button>
          ))}
        </div>
      </header>

      {(tab === "all" || tab === "goods") && <GoodsInventoryPanel initialSearch={search} />}
      {(tab === "all" || tab === "consumables") && <ConsumableInventoryPanel initialSearch={search} />}
    </div>
  );
}
