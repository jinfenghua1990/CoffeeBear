import Link from "next/link";
import ProductionPurchaseBoard from "../production/production-purchase-board";

export default function InTransitPage() {
  return (
    <div className="space-y-5">
      <header className="sticky top-0 z-20 -mx-8 -mt-6 flex flex-wrap items-end justify-between gap-4 border-b border-gray-200 bg-white/95 px-8 py-5 backdrop-blur">
        <div>
          <div className="text-xs font-medium text-cyan-600">SUPPLY CHAIN / IN TRANSIT</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">生产执行 / 在途</h1>
          <p className="mt-1 text-sm text-slate-500">默认只看采购主单里已经发货的正品，物流与来源订单保持同一条链路。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/supply-chain/in-transit/manual" className="rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm font-medium text-cyan-700 hover:bg-cyan-100">特殊 / 手工执行</Link>
        </div>
      </header>
      <ProductionPurchaseBoard initialGroup="transit" showTabs={false} title="已发货 / 在途正品" description="直接读取现有采购主单；只有正品且状态已发货的订单会归到这里。" />
    </div>
  );
}
