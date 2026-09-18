"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// 旧地址兼容：统一进入「财务中心 → 发票管理」；原始导入批次仍可从新页面进入数据中心查看。
export default function TaxInvoicesRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/finance/invoices");
  }, [router]);
  return (
    <div className="py-20 text-center text-sm text-gray-400">正在打开「发票管理」…</div>
  );
}
