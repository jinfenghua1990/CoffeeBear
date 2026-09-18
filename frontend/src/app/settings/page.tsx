"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import StatusBadge from "@/components/status-badge";
import { authenticatedFetch, changePassword, getOverview, IntegrationStatus, testJackyun } from "@/lib/api";

type TestState = { loading: boolean; result?: string; tools?: string[]; warning?: boolean };


export default function SettingsPage() {
  const [items, setItems] = useState<IntegrationStatus[]>([]);
  const [jackyun, setJackyun] = useState<TestState>({ loading: false });
  const [pwOld, setPwOld] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwMsg, setPwMsg] = useState("");

  async function submitPassword() {
    setPwMsg("");
    try {
      await changePassword(pwOld, pwNew);
      return;
    } catch (e) {
      setPwMsg(`修改失败：${e instanceof Error ? e.message : String(e)}`);
    }
    setTimeout(() => setPwMsg(""), 4000);
  }

  async function load() {
    const data = await getOverview();
    setItems(data.integrations);
  }
  useEffect(() => {
    load().catch(() => {});
  }, []);

  async function runTest() {
    setJackyun({ loading: true });
    try {
      const res = await testJackyun();
      if (res.ok) {
        setJackyun({
          loading: false,
          result: res.status === "transport_connected"
            ? "MCP 传输连接成功；业务 API 尚未验证，请执行一次商品/SKU同步确认权限"
            : res.businessReady === false
            ? "MCP 传输连接成功；吉客云业务 API 权限仍未开通"
            : "连接与业务接口状态正常",
          tools: res.tools,
          warning: res.businessReady === false,
        });
      } else {
        setJackyun({ loading: false, result: `失败：${res.error}` });
      }
    } catch (e) {
      setJackyun({ loading: false, result: `请求异常：${String(e)}` });
    }
    load();
  }

  return (
    <div>
      <header className="app-page-header -mx-1 bg-[#f4f7fb]/95 pb-3 backdrop-blur">
        <h1 className="text-xl font-semibold text-slate-900">系统设置</h1>
        <p className="mt-2 max-w-5xl text-sm leading-6 text-slate-500">
          这里只保留账号安全、数据连接和系统级参数。仓库、生产、货品等业务配置统一回到各自业务页面维护。
        </p>
      </header>

      <div className="mt-6 max-w-5xl rounded-xl border border-indigo-200 bg-indigo-50/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-slate-900">系统更新</div>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              自动检测 GitHub 新版本，支持自动下载、凌晨自动更新、备份、健康检查和失败回滚。
            </p>
          </div>
          <Link
            href="/settings/update"
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            打开更新中心
          </Link>
        </div>
      </div>

      <div id="account-security" className="mt-6 scroll-mt-24 max-w-5xl rounded-xl border border-slate-200 bg-white p-4">
        <div className="text-sm font-medium">账号安全 · 修改密码</div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <div className="text-xs text-slate-500">原密码</div>
            <input
              type="password"
              value={pwOld}
              onChange={(e) => setPwOld(e.target.value)}
              className="mt-1 block w-52 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <div className="text-xs text-slate-500">新密码（至少 8 位）</div>
            <input
              type="password"
              value={pwNew}
              onChange={(e) => setPwNew(e.target.value)}
              className="mt-1 block w-52 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-indigo-500"
            />
          </div>
          <button
            onClick={submitPassword}
            disabled={!pwOld || pwNew.length < 8}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            修改密码
          </button>
        </div>
        {pwMsg && <div className="mt-2 text-xs text-slate-600">{pwMsg}</div>}
      </div>

      <section className="mt-6 max-w-5xl">
        <div className="mb-2">
          <div className="text-sm font-semibold text-slate-900">数据连接状态</div>
          <div className="mt-0.5 text-[11px] text-slate-400">这里只显示连接健康度；采购、库存、财务等业务参数继续在对应功能区维护。</div>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {items.map((it) => (
          <div key={it.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4">
            <div>
              <div className="text-sm font-medium">{it.name}</div>
              <div className="mt-0.5 text-xs text-slate-400">
                {it.mode} · Phase {it.phase}
                {it.errorSummary ? ` · ${it.errorSummary.slice(0, 80)}` : ""}
              </div>
            </div>
            <StatusBadge status={it.status} />
          </div>
        ))}
        </div>
      </section>

      <section className="mt-6 max-w-5xl">
        <div className="mb-2">
          <div className="text-sm font-semibold text-slate-900">连接与授权</div>
          <div className="mt-0.5 text-[11px] text-slate-400">仅用于验证外部平台连接和授权，不在这里录入业务数据。</div>
        </div>
        <div className="grid gap-3 xl:grid-cols-2">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="text-sm font-medium">吉客云 MCP 连接测试</div>
        <p className="mt-1 text-xs text-slate-400">
          真实调用 MCP：initialize → tools/list，返回已订阅工具清单。失败原因会写入异常中心与同步日志。
        </p>
        <button
          onClick={runTest}
          disabled={jackyun.loading}
          className="mt-3 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {jackyun.loading ? "测试中…" : "立即测试连接"}
        </button>
        {jackyun.result && (
          <div className={`mt-3 text-sm ${jackyun.warning ? "text-amber-700" : jackyun.tools ? "text-emerald-700" : "text-red-600"}`}>
            {jackyun.result}
          </div>
        )}
        {jackyun.tools && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {jackyun.tools.map((t) => (
              <span key={t} className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="text-sm font-medium">1688 采购授权</div>
        <p className="mt-1 text-xs text-slate-400">
          只读同步已发生的买家订单，不下单、不付款。需先在 1688 开放平台创建应用（AppKey/Secret + 回调地址），
          配置到 .env 后点击「连接 1688」跳官方授权。
        </p>
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={async () => {
              try {
                const res = await authenticatedFetch("/api/v1/integrations/alibaba1688/auth-url", { cache: "no-store" });
                const d = await res.json();
                if (res.ok && d.authorizationUrl) {
                  window.location.href = d.authorizationUrl;
                } else {
                  setJackyun({ loading: false, result: `1688：${d.detail ?? "未配置"}` });
                }
              } catch (e) {
                setJackyun({ loading: false, result: `1688：${String(e)}` });
              }
            }}
            className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-indigo-600 ring-1 ring-indigo-200 hover:bg-indigo-50"
          >
            连接 1688
          </button>
          <span className="text-xs text-slate-400">回调地址示例：{typeof window !== "undefined" ? `${window.location.origin}/api/v1/integrations/alibaba1688/callback` : "…"}</span>
        </div>
      </div>

        </div>
      </section>

      <div className="mt-6 max-w-5xl rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-800">
        局域网访问已启用账号密码保护；勾选“记住登录”后，同一浏览器 30 天内免重复输入。
        请勿在路由器做端口转发，勿将 8000 暴露公网；如需公网访问，必须增加 TLS 和更严格的网络边界。
      </div>

    </div>
  );
}
