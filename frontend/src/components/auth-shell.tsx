"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Sidebar from "@/components/sidebar";
import SystemStatusBar from "@/components/system-status-bar";
import TopBar from "@/components/top-bar";
import WorkspaceHost from "@/components/workspace/workspace-host";
import { fetchMe, getToken, redirectToLogin } from "@/lib/api";

/**
 * 路由守卫 + 全局外壳。
 *
 * V1.6.4 起主内容区由「工作区（Workspace Tabs）」接管渲染：
 * 页面内容不再由 Next 路由直接渲染，而是由工作区按 Tab 挂载并保活，
 * 地址栏只负责与「激活 Tab 的 URL」保持一致（识别与深链）。
 */
export default function AuthShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const openAccess = process.env.NEXT_PUBLIC_ACCESS_MODE === "open";
  // 令牌只校验一次：工作区下切换 Tab 也会改地址栏，不能因此把整个工作区卸载重建
  const validatedRef = useRef(false);

  useEffect(() => {
    if (pathname === "/login") {
      setReady(true);
      return;
    }
    if (openAccess) {
      validatedRef.current = true;
      setReady(true);
      return;
    }
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    if (validatedRef.current) return;

    let cancelled = false;
    fetchMe()
      .then(() => {
        if (cancelled) return;
        validatedRef.current = true;
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) redirectToLogin();
      });
    return () => {
      cancelled = true;
    };
  }, [openAccess, pathname, router]);

  if (pathname === "/login") return <>{children}</>;
  if (!ready) return null;

  return (
    <div className="app-shell flex h-screen w-full min-w-0 flex-col overflow-hidden">
      <TopBar />
      <div className="flex min-h-0 w-full flex-1">
        <div className="relative h-full w-[208px] shrink-0">
          <Sidebar />
          <SystemStatusBar />
        </div>
        <main data-app-main className="flex h-full min-h-0 w-0 min-w-0 flex-1 flex-col overflow-hidden">
          <WorkspaceHost />
        </main>
      </div>
    </div>
  );
}