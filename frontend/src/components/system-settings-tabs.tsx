"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/settings", label: "基础设置", match: (path: string) => path === "/settings" },
  { href: "/settings/update", label: "系统更新", match: (path: string) => path.startsWith("/settings/update") },
  { href: "/automation", label: "自动化任务", match: (path: string) => path.startsWith("/automation") },
];

export default function SystemSettingsTabs() {
  const pathname = usePathname();

  return (
    <nav aria-label="系统设置模块" className="mb-5 flex items-center gap-1 border-b border-slate-200">
      {ITEMS.map((item) => {
        const active = item.match(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            prefetch={false}
            className={
              "relative px-4 py-3 text-[13px] font-medium transition-colors " +
              (active ? "text-blue-600" : "text-slate-500 hover:text-slate-800")
            }
          >
            {item.label}
            {active && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-blue-600" />}
          </Link>
        );
      })}
    </nav>
  );
}
