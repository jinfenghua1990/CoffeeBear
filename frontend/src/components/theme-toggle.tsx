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
  { mode: "system", label: "跟随系统", desc: "自动跟随 macOS 深浅色" },
  { mode: "light", label: "浅色", desc: "始终使用白天模式" },
  { mode: "dark", label: "深色", desc: "始终使用黑夜模式" },
];

function ThemeGlyph({ theme }: { theme: Theme }) {
  return theme === "dark" ? (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  ) : (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
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
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const choose = (next: ThemeMode) => {
    setMode(next);
    setResolved(setThemeMode(next));
    setOpen(false);
  };

  const currentLabel = OPTIONS.find((item) => item.mode === mode)?.label ?? mode;

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title={"主题：" + currentLabel}
        aria-label="主题设置"
        aria-expanded={open}
        className="app-theme-button flex h-8 w-8 items-center justify-center rounded-lg border text-slate-500 transition"
      >
        <ThemeGlyph theme={resolved} />
      </button>

      {open && (
        <div className="app-popover absolute right-0 top-full z-dropdown mt-1.5 w-52 rounded-xl border p-1.5 shadow-lg">
          <div className="px-3 py-1.5 text-[10px] font-medium tracking-wide text-slate-400">外观</div>
          {OPTIONS.map((item) => {
            const active = item.mode === mode;
            const rowClass = "flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left transition " + (active ? "bg-indigo-50" : "hover:bg-slate-50");
            const dotClass = "mt-1 h-2.5 w-2.5 shrink-0 rounded-full border " + (active ? "border-indigo-600 bg-indigo-600" : "border-slate-300");
            return (
              <button key={item.mode} type="button" onClick={() => choose(item.mode)} className={rowClass}>
                <span className={dotClass} />
                <span className="min-w-0">
                  <span className="block text-[12px] font-medium text-slate-700">{item.label}</span>
                  <span className="mt-0.5 block text-[10px] leading-4 text-slate-400">{item.desc}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
