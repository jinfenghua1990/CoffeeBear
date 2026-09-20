"use client";

import Link from "next/link";
import { useState } from "react";
import { changePassword } from "@/lib/api";
import SystemSettingsTabs from "@/components/system-settings-tabs";

type InfraItem = {
  key: string;
  name: string;
  desc: string;
  scope: string;
  state: string;
  tone: "ready" | "pending";
};

const INFRA: InfraItem[] = [
  {
    key: "github",
    name: "GitHub 发布",
    desc: "代码、CI、候选镜像与正式版本的统一发布来源。",
    scope: "版本 / CI / Release",
    state: "发布链已建立",
    tone: "ready",
  },
  {
    key: "nas",
    name: "NAS / Deployment Runner",
    desc: "极空间 STAGING / PROD 的部署、心跳、健康检查和回滚通道。",
    scope: "仅 ecommerce 部署目录",
    state: "待 NAS 实机部署",
    tone: "pending",
  },
  {
    key: "tailscale",
    name: "Tailscale",
    desc: "仅供你本人从外网私有访问家里 NAS，不开放 NAS 管理端口到公网。",
    scope: "私人远程访问",
    state: "待配置",
    tone: "pending",
  },
  {
    key: "r2",
    name: "Cloudflare R2",
    desc: "云端异地副本；备份 Bucket 与公网资源 Bucket 分离。",
    scope: "备份 / 公网资源",
    state: "待配置",
    tone: "pending",
  },
];

function InfraIcon({ name }: { name: string }) {
  const common = "h-5 w-5";
  if (name === "github") return <svg viewBox="0 0 24 24" fill="none" className={common}><path d="M8 19c-4 1.2-4-2-5-2.5M13 21v-3.5c0-1 .1-1.4-.5-2 2.5-.3 5.2-1.2 5.2-5.6A4.4 4.4 0 0 0 16.5 7a4 4 0 0 0-.1-2.9S15.4 3.8 13 5a10 10 0 0 0-5 0C5.6 3.8 4.6 4.1 4.6 4.1A4 4 0 0 0 4.5 7a4.4 4.4 0 0 0-1.2 2.9c0 4.4 2.7 5.3 5.2 5.6-.4.4-.6.9-.6 1.8V21" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>;
  if (name === "nas") return <svg viewBox="0 0 24 24" fill="none" className={common}><rect x="4" y="4" width="16" height="6" rx="2" stroke="currentColor" strokeWidth="1.7"/><rect x="4" y="14" width="16" height="6" rx="2" stroke="currentColor" strokeWidth="1.7"/><path d="M8 7h.01M8 17h.01M12 7h4M12 17h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>;
  if (name === "tailscale") return <svg viewBox="0 0 24 24" fill="none" className={common}><circle cx="6" cy="6" r="2" stroke="currentColor" strokeWidth="1.7"/><circle cx="18" cy="6" r="2" stroke="currentColor" strokeWidth="1.7"/><circle cx="12" cy="18" r="2" stroke="currentColor" strokeWidth="1.7"/><path d="m7.7 7.1 3.2 8.8m5.4-8.8-3.2 8.8M8 6h8" stroke="currentColor" strokeWidth="1.7"/></svg>;
  return <svg viewBox="0 0 24 24" fill="none" className={common}><path d="M7 18.5h10a4 4 0 0 0 .7-7.9A6 6 0 0 0 6.2 9.2 4.7 4.7 0 0 0 7 18.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/><path d="M12 11v5m0 0 2-2m-2 2-2-2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

export default function SettingsPage() {
  const [pwOld, setPwOld] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwMsg, setPwMsg] = useState("");

  async function submitPassword() {
    setPwMsg("");
    try {
      await changePassword(pwOld, pwNew);
      setPwOld("");
      setPwNew("");
      setPwMsg("密码已更新");
    } catch (e) {
      setPwMsg("修改失败：" + (e instanceof Error ? e.message : String(e)));
    }
    window.setTimeout(() => setPwMsg(""), 4000);
  }

  return (
    <div className="pb-10">
      <header className="app-page-header -mx-1 pb-4">
        <h1 className="text-xl font-semibold text-slate-900">系统设置</h1>
        <p className="mt-1.5 text-sm leading-6 text-slate-500">
          系统级能力统一放在这里；通过下方 3 个模块切换，不再在左侧重复增加入口。
        </p>
      </header>

      <SystemSettingsTabs />

      <section className="mt-5 max-w-6xl">
        <div className="mb-2.5 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">集成设置 · 基础设施</h2>
            <p className="mt-1 text-[11px] text-slate-400">跨模块共用的发布、远程访问、部署与云存储统一放这里。</p>
          </div>
          <span className="text-[10px] text-slate-400">业务集成不在此重复配置</span>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {INFRA.map((item) => (
            <article key={item.key} className="app-card rounded-xl p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-600">
                  <InfraIcon name={item.key} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-[13px] font-semibold text-slate-900">{item.name}</h3>
                    <span className={"rounded-full px-2 py-0.5 text-[10px] font-medium " + (item.tone === "ready" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500")}>
                      {item.state}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[11px] leading-5 text-slate-500">{item.desc}</p>
                  <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-2.5">
                    <span className="text-[10px] text-slate-400">权限范围</span>
                    <span className="text-[10px] font-medium text-slate-600">{item.scope}</span>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section id="account-security" className="mt-6 max-w-6xl">
        <div className="mb-2.5">
          <h2 className="text-sm font-semibold text-slate-900">账号与安全</h2>
          <p className="mt-1 text-[11px] text-slate-400">这里只处理平台账号安全，不承载业务平台授权。</p>
        </div>
        <div className="app-card rounded-xl p-4">
          <div className="text-[13px] font-semibold text-slate-900">修改管理员密码</div>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="min-w-[210px] flex-1">
              <span className="text-[11px] text-slate-500">原密码</span>
              <input type="password" value={pwOld} onChange={(e) => setPwOld(e.target.value)} className="app-input-control mt-1.5 block h-9 w-full rounded-lg px-3 text-sm" />
            </label>
            <label className="min-w-[210px] flex-1">
              <span className="text-[11px] text-slate-500">新密码（至少 8 位）</span>
              <input type="password" value={pwNew} onChange={(e) => setPwNew(e.target.value)} className="app-input-control mt-1.5 block h-9 w-full rounded-lg px-3 text-sm" />
            </label>
            <button type="button" onClick={submitPassword} disabled={!pwOld || pwNew.length < 8} className="app-button-primary h-9 rounded-lg px-4 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-45">
              修改密码
            </button>
          </div>
          {pwMsg && <div className="mt-2 text-[11px] text-slate-500">{pwMsg}</div>}
        </div>
      </section>

      <section className="mt-6 max-w-6xl">
        <div className="app-card-muted rounded-xl p-4">
          <div className="text-[13px] font-semibold text-slate-900">业务集成入口</div>
          <p className="mt-1.5 text-[11px] leading-5 text-slate-500">
            1688 授权与登录放在 1688 订单导入；吉客云连接与导入放在吉客云数据接入；Shopify 留在外贸工作台。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/data-center-import?tab=alibaba1688" className="app-button-secondary rounded-lg px-3 py-1.5 text-[11px] font-medium">1688 订单导入</Link>
            <Link href="/data-center-import?tab=jackyun" className="app-button-secondary rounded-lg px-3 py-1.5 text-[11px] font-medium">吉客云数据接入</Link>
          </div>
        </div>
      </section>

      <div className="mt-6 max-w-6xl rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-[11px] leading-5 text-amber-800">
        NAS 管理端口、PostgreSQL、Redis 和 Docker API 均不直接暴露公网。个人远程访问走 Tailscale；系统发布走受限 Deployment Runner。
      </div>
    </div>
  );
}
