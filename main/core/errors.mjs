export function errorMessage(value, fallback = "接口请求失败，请稍后重试") {
  const seen = new Set();
  function read(v) {
    if (typeof v === "string" && v.trim() && v !== "[object Object]") return v;
    if (!v || typeof v !== "object" || seen.has(v)) return "";
    seen.add(v);
    for (const k of ["message", "msg", "error", "body", "data", "cause"]) {
      const s = read(v[k]);
      if (s) return s;
    }
    const code = v.error_code || v.code || v.status;
    return code ? `上游接口返回错误 (${code})` : "";
  }
  return (read(value) || fallback)
    .replace(
      /((?:cookie|token|accesskey|qrsig|password)\s*[=:]\s*)[^\s;,]+/gi,
      "$1[已隐藏]",
    )
    .slice(0, 500);
}
