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
      "User-Agent": "Mozilla/5.0 Sonora/1.2",
      ...headers,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: signal ? AbortSignal.any([abort, signal]) : abort,
    redirect,
  });
  return res;
}
export async function readBytesLimited(response, maxBytes = 12 * 1024 * 1024) {
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    throw Error("接口响应过大");
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader(),
    chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw Error("接口响应过大");
      chunks.push(value);
    }
    return Buffer.concat(chunks, size);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export async function textRequest(url, { maxBytes, ...options } = {}) {
  const r = await request(url, options);
  if (!r.ok) {
    await r.body?.cancel();
    throw Error(`接口 HTTP ${r.status}`);
  }
  return (await readBytesLimited(r, maxBytes)).toString("utf8");
}
export async function jsonRequest(url, options) {
  const text = await textRequest(url, options);
  try {
    return JSON.parse(text);
  } catch {
    throw Error("接口未返回有效 JSON");
  }
}
export async function deadline(promise, ms = 18000, signal) {
  let timer, abort;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error("接口请求超时")), ms);
        timer.unref?.();
        if (signal) {
          abort = () => reject(signal.reason || Error("请求已取消"));
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
        }
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (abort) signal.removeEventListener("abort", abort);
  }
}
