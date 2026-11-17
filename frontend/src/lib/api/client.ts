/** 登录令牌与统一请求层（由 lib/api.ts 拆分，逻辑未改动） */

const TOKEN_KEY = "ecdp_access_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  window.localStorage.removeItem(TOKEN_KEY);
}

export function redirectToLogin() {
  if (typeof window !== "undefined") {
    clearToken();
    window.location.href = "/login";
  }
}

/** 所有业务请求统一携带令牌，并在服务端判定失效时回登录页。 */

export async function authenticatedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(input, { ...init, headers });
  if (res.status === 401 && process.env.NEXT_PUBLIC_ACCESS_MODE !== "open") {
    redirectToLogin();
    throw new Error("登录已过期");
  }
  return res;
}

/**
 * 下载受保护的二进制文件。
 *
 * 归档文件接口属于鉴权 API，不能用普通 <a href> 直接打开，否则浏览器
 * 不会携带 Bearer 令牌，页面看起来像“写入成功但下载失败/401”。
 */

export async function downloadAuthenticatedFile(url: string, filename = "下载文件"): Promise<void> {
  const res = await authenticatedFetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(await readErrorDetail(res, "下载失败"));
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename || "下载文件";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

/** FastAPI 的 detail 可能是字符串（HTTPException）或 422 校验错误数组；统一转成可读文案。 */

export function detailToMessage(detail: unknown, fallback: string): string {
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => {
        const d = item as { msg?: string; loc?: unknown[] };
        const loc = Array.isArray(d.loc) ? d.loc.filter((p) => p !== "body") : [];
        return `${loc.length ? `${loc.join(".")}: ` : ""}${d.msg ?? ""}`.trim();
      })
      .filter(Boolean);
    if (parts.length) return parts.join("；");
  }
  if (detail && typeof detail === "object") {
    try { return JSON.stringify(detail); } catch { /* 退回 fallback */ }
  }
  return fallback;
}

/** 读取带认证请求失败时的 detail 文案。 */

export async function readErrorDetail(res: Response, fallback = "请求失败"): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { detail?: unknown };
  return detailToMessage(body.detail, `${fallback}（${res.status}）`);
}

export async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await authenticatedFetch(url, {
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { detail?: unknown };
    throw new Error(detailToMessage(data.detail, `HTTP ${res.status}`));
  }
  return res.json();
}

/**
 * 创建耗材采购单使用请求标识幂等，因此网络在服务重启窗口短暂中断时可以安全重试一次。
 * 若第二次仍无法连通，给出可操作的中文提示，不把浏览器原始的 Failed to fetch 直接展示给用户。
 */

export async function jsonFetchWithNetworkRetry<T>(url: string, init?: RequestInit): Promise<T> {
  try {
    return await jsonFetch<T>(url, init);
  } catch (caught) {
    if (!(caught instanceof TypeError) || !/fetch|network/i.test(caught.message)) throw caught;
    await new Promise((resolve) => window.setTimeout(resolve, 600));
    try {
      return await jsonFetch<T>(url, init);
    } catch (retryCaught) {
      if (retryCaught instanceof TypeError && /fetch|network/i.test(retryCaught.message)) {
        throw new Error("采购服务暂时无法连接，请稍后重试；系统会自动避免重复建单");
      }
      throw retryCaught;
    }
  }
}

/** 仅校验状态码的 DELETE（软删除接口返回 204 无响应体）。 */

export async function noContentFetch(url: string): Promise<void> {
  const res = await authenticatedFetch(url, { method: "DELETE" });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { detail?: unknown };
    throw new Error(detailToMessage(data.detail, `HTTP ${res.status}`));
  }
}
