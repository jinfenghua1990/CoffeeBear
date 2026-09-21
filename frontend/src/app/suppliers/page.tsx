"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** 旧书签兼容：供应商已并入财务中心的统一往来单位档案。 */
export default function SuppliersRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/finance/partners?role=supplier");
  }, [router]);

  return (
    <div className="flex min-h-[320px] items-center justify-center text-sm text-slate-400">
      正在打开财务中心的往来单位档案…
    </div>
  );
}
