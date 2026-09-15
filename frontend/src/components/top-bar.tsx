"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { authenticatedFetch, logout } from "@/lib/api";
import { MODULES, resolveModule } from "@/lib/navigation";

type SearchItem = { label: string; sub: string };
type SearchGroups = {
  products: SearchItem[];
  suppliers: SearchItem[];
  purchases: SearchItem[];
  sales: SearchItem[];
};
type GlobalStatus = {
  pendingExceptions: number;
  lastSyncAt: string | null;
  state: "ok" | "running" | "failed" | "empty";
  sources: { provider: string; label: string; status: string; lastAt: string | null }[];
};

const EMPTY_GROUPS: SearchGroups = { products: [], suppliers: [], purchases: [], sales: [] };
const GROUP_META: { key: keyof SearchGroups; title: string }[] = [
  { key: "products", title: "货品" },
  { key: "suppliers", title: "供应商" },
  { key: "purchases", title: "采购单" },
  { key: "sales", title: "销售单" },
];

function clockOf(iso: string | null) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function ChevronDown() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true">
      <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true">
      <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="m13.5 13.5 3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export default function TopBar() {
  const router = useRouter();
  const pathname = usePathname();
  const active = resolveModule(pathname);
  const [openMenu, setOpenMenu] = useState<"workspace" | "sync" | "account" | null>(null);
  const [keyword, setKeyword] = useState("");
  const [groups, setGroups] = useState<SearchGroups>(EMPTY_GROUPS);
  const [searchOpen, setSearchOpen] = useState(false);
  const [status, setStatus] = useState<GlobalStatus | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);

  const loadStatus = useCallback(() => {
    authenticatedFetch("/api/v1/system/global-status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: GlobalStatus | null) => data && setStatus(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadStatus();
    const timer = window.setInterval(loadStatus, 60_000);
    return () => window.clearInterval(timer);
  }, [loadStatus]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpenMenu(null);
        setSearchOpen(false);
      }
    }
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, []);

  useEffect(() => {
    const trimmed = keyword.trim();
    if (!trimmed) {
      setGroups(EMPTY_GROUPS);
      setSearchOpen(false);
      return;
    }
    const seq = ++seqRef.current;
    const timer = window.setTimeout(() => {
      authenticatedFetch(`/api/v1/search/global?q=${encodeURIComponent(trimmed)}`)
        .then((res) => (res.ok ? res.json() : EMPTY_GROUPS))
        .then((data: SearchGroups) => {
          if (seqRef.current === seq) {
            setGroups(data);
            setSearchOpen(true);
          }
        })
        .catch(() => {});
    }, 250);
    return () => window.clearTimeout(timer);
  }, [keyword]);

  const hasHits = GROUP_META.some(({ key }) => groups[key].length > 0);

  function go(href: string) {
    setOpenMenu(null);
    setSearchOpen(false);
    router.push(href);
  }

  function submitSearch() {
    const trimmed = keyword.trim();
    if (!trimmed) return;
    go(groups.products.length > 0 ? `/products?q=${encodeURIComponent(trimmed)}` : `/sales?q=${encodeURIComponent(trimmed)}`);
  }

  const syncDot =
    status?.state === "failed"
      ? "bg-rose-400"
      : status?.state === "running"
        ? "bg-amber-400 animate-pulse"
        : status?.state === "ok"
          ? "bg-emerald-400"
          : "bg-slate-300";
  const syncText =
    status?.state === "running"
      ? "同步中…"
      : status?.lastSyncAt
        ? `${clockOf(status.lastSyncAt)} 已同步`
        : "暂无同步";

  return (
    <header className="relative z-40 flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 shadow-[0_1px_4px_rgba(15,39,70,0.04)]" ref={rootRef}>
      {/* 品牌 + 工作台切换 */}
      <Link href="/" className="flex shrink-0 items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#112a49] text-white">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
            <path d="M5 8h12v7a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5V8Z" fill="currentColor" />
            <path d="M17 10h1.4a2.6 2.6 0 1 1 0 5.2H17" stroke="currentColor" strokeWidth="1.8" />
          </svg>
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-semibold tracking-[0.06em] text-slate-900">MEI FEI</span>
          <span className="block truncate text-[9px] text-slate-400">Good Coffee Better Life</span>
        </span>
      </Link>

      <div className="relative hidden shrink-0 xl:block">
        <button
          type="button"
          onClick={() => setOpenMenu((menu) => (menu === "workspace" ? null : "workspace"))}
          className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50"
        >
          内销工作台
          <ChevronDown />
        </button>
        {openMenu === "workspace" && (
          <div className="absolute left-0 top-full z-50 mt-1.5 w-52 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-[13px] font-medium text-slate-800">
              内销工作台
              <span className="text-[10px] font-normal text-blue-600">当前</span>
            </div>
            <div className="rounded-lg px-3 py-2 text-[12px] text-slate-400">外贸工作台（规划中）</div>
          </div>
        )}
      </div>

      {/* 一级业务导航 */}
      <nav className="ml-2 flex min-w-0 items-center gap-1" aria-label="一级业务模块">
        {MODULES.map((module) => {
          const isActive = module.key === active.key;
          return (
            <Link
              key={module.key}
              href={module.href}
              aria-current={isActive ? "page" : undefined}
              className={`shrink-0 rounded-lg px-3.5 py-2 text-[13px] font-medium transition-colors ${
                isActive ? "bg-blue-50 text-blue-600" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              {module.label}
            </Link>
          );
        })}
      </nav>

      {/* 全局搜索 */}
      <div className="relative mx-2 hidden min-w-0 flex-1 max-w-[420px] lg:block">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submitSearch();
          }}
          className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 focus-within:border-blue-400 focus-within:bg-white"
        >
          <SearchIcon />
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onFocus={() => hasHits && setSearchOpen(true)}
            placeholder="搜索商品、SKU、订单、供应商…"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-slate-700 outline-none placeholder:text-slate-400"
          />
        </form>
        {searchOpen && hasHits && (
          <div className="absolute left-0 top-full z-50 mt-1.5 max-h-[420px] w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
            {GROUP_META.map(({ key, title }) => {
              const items = groups[key];
              if (items.length === 0) return null;
              return (
                <div key={key} className="mb-1 last:mb-0">
                  <div className="px-2.5 py-1 text-[10px] font-medium tracking-wide text-slate-400">{title}</div>
                  {items.map((item) => (
                    <button
                      key={`${key}-${item.label}`}
                      type="button"
                      onClick={() => {
                        if (key === "products") go(`/products?q=${encodeURIComponent(item.label)}`);
                        else if (key === "sales") go(`/sales?q=${encodeURIComponent(item.label)}`);
                        else go(`/purchase/workbench?q=${encodeURIComponent(item.label)}`);
                      }}
                      className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left hover:bg-slate-50"
                    >
                      <span className="min-w-0 truncate text-[13px] text-slate-700">{item.label}</span>
                      <span className="max-w-[150px] shrink-0 truncate text-[11px] text-slate-400">{item.sub}</span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 右侧：同步 / 异常 / 设置 / 账号 */}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpenMenu((menu) => (menu === "sync" ? null : "sync"))}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] text-slate-600 hover:bg-slate-100"
          >
            <span className={`h-2 w-2 rounded-full ${syncDot}`} />
            {syncText}
          </button>
          {openMenu === "sync" && (
            <div className="absolute right-0 top-full z-50 mt-1.5 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
              <div className="px-2 py-1 text-[10px] font-medium tracking-wide text-slate-400">数据源同步状态</div>
              {(status?.sources ?? []).map((source) => (
                <div key={source.provider} className="flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[12px]">
                  <span className="flex items-center gap-2 text-slate-700">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        source.status === "failed" ? "bg-rose-400" : source.status === "running" ? "bg-amber-400" : "bg-emerald-400"
                      }`}
                    />
                    {source.label}
                  </span>
                  <span className="text-[11px] text-slate-400">{clockOf(source.lastAt)}</span>
                </div>
              ))}
              {(!status || status.sources.length === 0) && (
                <div className="px-2.5 py-2 text-[12px] text-slate-400">还没有同步记录</div>
              )}
              <Link
                href="/data-center-import?tab=alibaba1688"
                onClick={() => setOpenMenu(null)}
                className="mt-1 block rounded-lg px-2.5 py-1.5 text-[12px] text-blue-600 hover:bg-slate-50"
              >
                前往数据接入 →
              </Link>
            </div>
          )}
        </div>

        <Link
          href="/exceptions"
          className="relative flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
          aria-label="异常中心"
        >
          <svg viewBox="0 0 20 20" fill="none" className="h-[18px] w-[18px]" aria-hidden="true">
            <path d="M10 3.2a4.6 4.6 0 0 1 4.6 4.6c0 3 .8 4.3 1.5 5.1H3.9c.7-.8 1.5-2.1 1.5-5.1A4.6 4.6 0 0 1 10 3.2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M8.5 15.6a1.6 1.6 0 0 0 3 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          {(status?.pendingExceptions ?? 0) > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-semibold text-white">
              {status!.pendingExceptions}
            </span>
          )}
        </Link>

        <Link
          href="/settings"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
          aria-label="系统设置"
        >
          <svg viewBox="0 0 20 20" fill="none" className="h-[18px] w-[18px]" aria-hidden="true">
            <circle cx="10" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10 2.8v2m0 10.4v2M2.8 10h2m10.4 0h2M4.9 4.9l1.4 1.4m7.4 7.4 1.4 1.4m0-10.2-1.4 1.4M6.3 13.7l-1.4 1.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </Link>

        <div className="relative">
          <button
            type="button"
            onClick={() => setOpenMenu((menu) => (menu === "account" ? null : "account"))}
            className="flex items-center gap-1.5 rounded-lg py-1.5 pl-1.5 pr-2 hover:bg-slate-100"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#112a49] text-[12px] font-semibold text-white">管</span>
            <span className="text-[13px] font-medium text-slate-700">管理员</span>
            <ChevronDown />
          </button>
          {openMenu === "account" && (
            <div className="absolute right-0 top-full z-50 mt-1.5 w-44 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
              <Link
                href="/settings"
                onClick={() => setOpenMenu(null)}
                className="block rounded-lg px-3 py-2 text-[13px] text-slate-700 hover:bg-slate-50"
              >
                系统设置
              </Link>
              <Link
                href="/automation"
                onClick={() => setOpenMenu(null)}
                className="block rounded-lg px-3 py-2 text-[13px] text-slate-700 hover:bg-slate-50"
              >
                自动化任务
              </Link>
              {process.env.NEXT_PUBLIC_ACCESS_MODE !== "open" && (
                <button
                  type="button"
                  onClick={async () => {
                    setOpenMenu(null);
                    await logout();
                    router.replace("/login");
                  }}
                  className="block w-full rounded-lg px-3 py-2 text-left text-[13px] text-rose-600 hover:bg-rose-50"
                >
                  退出登录
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
