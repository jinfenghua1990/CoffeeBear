import Link from "next/link";
import ProductionPurchaseBoard from "../production/production-purchase-board";

export default function ReceivingPage() {
  return (
    <div className="space-y-5">
      <header className="sticky top-0 z-20 -mx-8 -mt-6 flex flex-wrap items-end justify-between gap-4 border-b border-gray-200 bg-white/95 px-8 py-5 backdrop-blur">
        <div>
          <div className="text-xs font-medium text-violet-600">SUPPLY CHAIN / RECEIVING</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">到货入库</h1>
          <p className="mt-1 text-sm text-slate-500">默认归档已经到货或已入库的正品采购主单，吉客云入库单号直接沿用现有匹配结果。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/supply-chain/receiving/manual" className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-medium text-violet-700 hover:bg-violet-100">特殊 / 手工关联入库</Link>
        </div>
      </header>
      <ProductionPurchaseBoard initialGroup="receiving" showTabs={false} title="已到货 / 已入库正品" description="直接读取采购主单与吉客云真实入库关联；不在本页伪造正品库存。" />
    </div>
  );
}
