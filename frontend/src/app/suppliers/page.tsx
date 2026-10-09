"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// 供应商档案已并入「财务中心 → 往来单位档案」；本页仅保留旧书签跳转。
export default function SuppliersRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/finance/partners");
  }, [router]);
  return null;
}
