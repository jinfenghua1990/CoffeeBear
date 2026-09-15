"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * 财务资料归档（上传 / 账期 / 文件清单 / 检查打包）已整体迁移到「月度资料入库」页：
 * /finance/monthly-send。本路由仅为兼容旧书签与侧边栏跳转保留，直接重定向到新页面。
 */
export default function FinanceArchiveRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/finance/monthly-send");
  }, [router]);

  return (
    <div className="mx-auto max-w-[1500px] px-8 py-10 text-sm text-slate-500">
      财务资料已合并到「月度资料入库」，正在跳转…
    </div>
  );
}
