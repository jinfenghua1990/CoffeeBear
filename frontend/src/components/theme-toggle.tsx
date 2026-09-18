"use client";

import { useEffect, useState } from "react";
import { applyThemeClass, getInitialTheme, setStoredTheme, watchSystemTheme } from "@/lib/theme";

/** 顶部导航栏主题切换按钮：点击在白天/黑夜间切换，首次默认跟随系统。 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    setTheme(getInitialTheme());
    applyThemeClass(getInitialTheme());
    return watchSystemTheme((next) => {
      setTheme(next);
      applyThemeClass(next);
    });
  }, []);

  const toggle = () => {
    const next: "light" | "dark" = theme === "dark" ? "light" : "dark";
    setTheme(next);
    setStoredTheme(next);
    applyThemeClass(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      title={theme === "dark" ? "切换到白天模式" : "切换到黑夜模式"}
      aria-label="切换主题"
      className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-slate-500 shadow-sm transition hover:bg-slate-50 hover:text-slate-700"
    >
      {theme === "dark" ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}
