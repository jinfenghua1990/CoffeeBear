import type { Metadata } from "next";
import "./globals.css";
import AuthShell from "@/components/auth-shell";

export const metadata: Metadata = {
  title: "电商经营数据平台",
  description: "连接吉客云 + 1688 + 浙江农信的经营数据平台",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var s=localStorage.getItem("app-theme");var d=s?s==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;if(d)document.documentElement.classList.add("dark");}catch(e){}})();` }} />
      </head>
      <body>
        <AuthShell>{children}</AuthShell>
      </body>
    </html>
  );
}
