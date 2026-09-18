"use client";

import Link from "next/link";
import { JackyunPanel } from "@/app/data-center-import/panels/jackyun";

export default function JackyunReceivingPage() {
  return (
    <div className="space-y-5">
      <header className="sticky top-0 z-20 -mx-8 -mt-6 flex flex-wrap items-end justify-between gap-4 border-b border-gray-200 bg-white/95 px-8 py-5 backdrop-blur">
        <div>
          <div className="text-xs font-medium text-violet-600">SUPPLY CHAIN / RECEIVING / JACKYUN</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">吉客云入库单</h1>
          <p className="mt-1 text-sm text-slate-500">上传吉客云客户端导出的入库文件，自动识别入库单与明细并用于历史核对；当前主入库仍由本系统创建。</p>
        </div>
        <Link href="/supply-chain/receiving" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">返回到仓入库单</Link>
      </header>
      <JackyunPanel />
    </div>
  );
}
