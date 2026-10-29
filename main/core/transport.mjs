import { httpUrl } from "./models.mjs";
export async function request(
  url,
  {
    params,
    method = "GET",
    body,
    headers = {},
    timeout = 16000,
    signal,
    redirect = "follow",
  } = {},
) {
  if (!httpUrl(url)) throw Error("接口地址必须是 HTTP 或 HTTPS URL");
  const u = new URL(url);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== "")
      u.searchParams.set(
        key,
        typeof value === "object" ? JSON.stringify(value) : String(value),
      );
  }
  const abort = AbortSignal.timeout(timeout);
  const res = await fetch(u, {
    method,
    headers: {
      "User-Agent": "Mozilla/5.0 Sonora/1.1",
      ...headers,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: signal ? AbortSignal.any([abort, signal]) : abort,
    redirect,
  });
  return res;
}
export async function jsonRequest(url, options) {
  const r = await request(url, options);
  if (!r.ok) throw Error(`接口 HTTP ${r.status}`);
  const text = await r.text();
  if (text.length > 12 * 1024 * 1024) throw Error("接口响应过大");
  try {
    return JSON.parse(text);
  } catch {
    throw Error("接口未返回有效 JSON");
  }
}
export async function deadline(promise, ms = 18000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error("接口请求超时")), ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
