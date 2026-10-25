export const API_BASE = ((import.meta.env.REACT_APP_BACKEND_URL as string | undefined) || "").replace(/\/$/, "");

const TOKEN_KEY = "handoff.token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Absolute URL for API-served assets like `/api/files/...`. */
export function assetUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  if (/^(https?:|data:|blob:)/.test(path)) return path;
  return `${API_BASE}${path}`;
}

async function parse(res: Response) {
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const detail = body && typeof body === "object" && body.detail ? body.detail : null;
    const msg =
      typeof detail === "string"
        ? detail
        : res.status >= 500
          ? "Something went wrong on our side. Try again."
          : `Request failed (${res.status}).`;
    if (res.status === 401) window.dispatchEvent(new CustomEvent("handoff:unauthorized"));
    throw new ApiError(res.status, msg);
  }
  return body;
}

export async function api<T = any>(path: string, opts: { method?: string; body?: any; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api${path}`, { method: opts.method || (body ? "POST" : "GET"), headers, body });
  } catch {
    throw new ApiError(0, "Can't reach Handoff. Check your connection and retry.");
  }
  return parse(res);
}

export const post = <T = any>(path: string, body?: any) => api<T>(path, { method: "POST", body: body ?? {} });
export const patch = <T = any>(path: string, body: any) => api<T>(path, { method: "PATCH", body });
export const del = <T = any>(path: string) => api<T>(path, { method: "DELETE" });
export const upload = <T = any>(path: string, form: FormData) => api<T>(path, { method: "POST", form });
