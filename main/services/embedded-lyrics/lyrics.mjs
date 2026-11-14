import { readLrc, writeLrc } from "./lrc.mjs";
import { readTtml, writeTtml } from "./ttml.mjs";

export function describeField(field) {
  const base = { id: field.id, name: field.name };
  if (field.text === null)
    return { ...base, format: null, lines: [], error: "字段内容无法解码。" };
  if (/^\s*</.test(field.text) || /(?:^|:)TTML$/i.test(field.name)) {
    try {
      return { ...base, format: "ttml", lines: readTtml(field.text).lines };
    } catch {
      return {
        ...base,
        format: null,
        lines: [],
        error: "TTML 无法解析或使用未支持的结构。",
      };
    }
  }
  const { lines } = readLrc(field.text);
  return lines.length
    ? { ...base, format: "lrc", lines }
    : {
        ...base,
        format: null,
        lines: [],
        error: "字段中没有可识别的 LRC 时间行。",
      };
}

export function renderField(field, request) {
  const info = describeField(field);
  if (!info.format || field.text === null)
    throw new Error(info.error || "无法写入此字段。");
  if (!/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i.test(request.language))
    throw new Error("目标语言代码无效。");
  const ids = new Set(info.lines.map((line) => line.id));
  for (const [id, value] of Object.entries(request.translations)) {
    if (
      !ids.has(id) ||
      typeof value !== "string" ||
      value.length > 6000 ||
      /[\u0000-\u0008\u000a-\u001f\u2028\u2029\ufffe\uffff]/u.test(value) ||
      !value.isWellFormed()
    )
      throw new Error("译文必须为有效的逐行纯文本，且与当前字段匹配。");
  }
  return info.format === "lrc"
    ? writeLrc(field.text, request)
    : writeTtml(field.text, request);
}
