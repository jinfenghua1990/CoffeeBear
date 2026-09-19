"use client";

import { useEffect, useRef, useState } from "react";
import {
  applyThemeMode,
  getStoredThemeMode,
  setThemeMode,
  watchSystemTheme,
  type Theme,
  type ThemeMode,
} from "@/lib/theme";

const OPTIONS: Array<{ mode: ThemeMode; label: string; desc: string }> = [
  { mode: "system", label: "跟随系统", desc: "自动跟随设备深浅色" },
  { mode: "light", label: "浅色", desc: "固定使用白天模式" },
  { mode: "dark", label: "深色", desc: "固定使用黑夜模式" },
];

function ModeGlyph({ mode, resolved }: { mode: ThemeMode; resolved: Theme }) {
  if (mode === "system") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="13" rx="2" />
        <path d="M8 21h8M12 17v4" />
        <path d={resolved === "dark" ? "M16.8 7.3a3.2 3.2 0 1 0 0 5.4 2.8 2.8 0 1 1 0-5.4Z" : "M16.5 8.2v1M16.5 12.8v1M14.2 11h1M17.8 11h1"} />
      </svg>
    );
  }

  if (mode === "dark") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" />
      </svg>
    );
  }

  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

export default function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>("system");
  const [resolved, setResolved] = useState<Theme>("light");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const initialMode = getStoredThemeMode();
    setMode(initialMode);
    setResolved(applyThemeMode(initialMode));
    return watchSystemTheme((next) => {
      setResolved(next);
      applyThemeMode("system");
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const choose = (next: ThemeMode) => {
    setMode(next);
    setResolved(setThemeMode(next));
    setOpen(false);
  };

  const current = OPTIONS.find((item) => item.mode === mode) ?? OPTIONS[0];

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title={`外观：${current.label}`}
        aria-label={`外观：${current.label}`}
        aria-expanded={open}
        className={`app-theme-button flex h-8 items-center gap-1.5 rounded-lg border px-2 text-slate-500 transition ${open ? "ring-2 ring-indigo-100 text-indigo-600" : ""}`}
      >
        <ModeGlyph mode={mode} resolved={resolved} />
        <span className="hidden text-[11px] font-medium 2xl:inline">{mode === "system" ? "自动" : current.label}</span>
      </button>

      {open && (
        <div className="app-popover absolute right-0 top-full z-dropdown mt-1.5 w-56 rounded-xl border p-1.5 shadow-lg">
          <div className="flex items-center justify-between px-3 py-1.5">
            <span className="text-[10px] font-medium tracking-wide text-slate-400">界面外观</span>
            <span className="text-[10px] text-slate-400">{resolved === "dark" ? "当前深色" : "当前浅色"}</span>
          </div>
          {OPTIONS.map((item) => {
            const active = item.mode === mode;
            return (
              <button
                key={item.mode}
                type="button"
                onClick={() => choose(item.mode)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition ${active ? "bg-indigo-50" : "hover:bg-slate-50"}`}
              >
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${active ? "border-indigo-200 bg-white text-indigo-600" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
                  <ModeGlyph mode={item.mode} resolved={resolved} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-medium text-slate-700">{item.label}</span>
                  <span className="mt-0.5 block text-[10px] leading-4 text-slate-400">{item.desc}</span>
                </span>
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px] font-bold ${active ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 text-transparent"}`}>
                  ✓
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
