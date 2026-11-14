import { DOMParser } from "@xmldom/xmldom";

const stamp = (ms) => {
  const n = Math.max(0, Math.round(ms));
  return `${String(Math.floor(n / 60000)).padStart(2, "0")}:${String(Math.floor(n / 1000) % 60).padStart(2, "0")}.${String(n % 1000).padStart(3, "0")}`;
};
const xml = (s) =>
  String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
export function parseLrc(text = "") {
  const offset = Number(String(text).match(/\[offset:([+-]?\d+)\]/i)?.[1] || 0);
  const rows = String(text)
    .split(/\r?\n/)
    .flatMap((row) => {
      const tags = [...row.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
      const body = row.replace(/\[[^\]]*\]/g, "").trim();
      const marks = [...body.matchAll(/<(\d+):(\d+(?:\.\d+)?)>/g)];
      const base = tags.length ? (+tags[0][1] * 60 + +tags[0][2]) * 1000 : 0;
      return tags.map((m) => {
        const rawStart = (+m[1] * 60 + +m[2]) * 1000;
        const words = marks.flatMap((mark, i) => {
          const next = marks[i + 1],
            value = body.slice(
              mark.index + mark[0].length,
              next?.index ?? body.length,
            );
          if (!value) return [];
          const start =
            (+mark[1] * 60 + +mark[2]) * 1000 + offset + rawStart - base;
          const end = next
            ? (+next[1] * 60 + +next[2]) * 1000 + offset + rawStart - base
            : undefined;
          return [{ start: Math.max(0, start), end, text: value }];
        });
        if (marks.length && marks[0].index > 0)
          words.unshift({
            start: Math.max(0, rawStart + offset),
            end: Math.max(
              0,
              (+marks[0][1] * 60 + +marks[0][2]) * 1000 +
                offset +
                rawStart -
                base,
            ),
            text: body.slice(0, marks[0].index),
          });
        return {
          start: Math.max(0, rawStart + offset),
          text: body.replace(/<\d+:\d+(?:\.\d+)?>/g, ""),
          words,
        };
      });
    })
    .filter((x) => x.text)
    .sort((a, b) => a.start - b.start);
  const starts = [...new Set(rows.map((row) => row.start))],
    nextStart = new Map(starts.map((start, i) => [start, starts[i + 1]]));
  rows.forEach((row) =>
    row.words.forEach((w) => {
      w.end ??= Math.max(w.start, nextStart.get(row.start) ?? w.start + 1500);
    }),
  );
  return rows;
}
// Our bilingual LRC convention uses companion lines at the same timestamp.
export function localLyricDocument(text, source = "本地内嵌歌词") {
  if (/<tt[\s>]/.test(text))
    return lyricDocument({ lines: parseTtml(text), source });
  const groups = new Map();
  for (const row of parseLrc(text)) {
    const first = groups.get(row.start);
    if (!first) groups.set(row.start, { ...row });
    else if (row.text !== first.text) {
      if (row.words.length && !first.words.length) {
        groups.set(row.start, { ...row, translation: first.text });
      } else if (!first.translation) first.translation = row.text;
      else
        first.romanization = [first.romanization, row.text]
          .filter(Boolean)
          .join(" / ");
    }
  }
  const lines = [...groups.values()];
  return lyricDocument({ original: lines.length ? "" : text, lines, source });
}
export function parseTimed(text = "", format = "yrc") {
  return String(text)
    .split(/\r?\n/)
    .flatMap((row) => {
      const m = row.match(/^\[(\d+),(\d+)\](.*)$/);
      if (!m) return [];
      const start = +m[1],
        end = start + +m[2],
        words = [];
      const re =
        format === "krc"
          ? /<(\d+),(\d+),\d+>([^<]*)/g
          : format === "qrc"
            ? /(.*?)\((\d+),(\d+)\)/g
            : /\((\d+),(\d+),\d+\)([^()]*)/g;
      for (const w of m[3].matchAll(re)) {
        const t = format === "qrc" ? w[1] : w[3],
          s =
            (format === "krc" ? start : 0) + +(format === "qrc" ? w[2] : w[1]),
          d = +(format === "qrc" ? w[3] : w[2]);
        words.push({ start: s, end: s + d, text: t });
      }
      return [
        {
          start,
          end,
          words,
          text: words.length ? words.map((w) => w.text).join("") : m[3],
        },
      ];
    });
}
function time(s) {
  if (!s) return NaN;
  if (/^\d+(?:\.\d+)?ms$/.test(s)) return parseFloat(s);
  if (/^\d+(?:\.\d+)?s$/.test(s)) return parseFloat(s) * 1000;
  return s.split(":").reduce((a, x) => a * 60 + Number(x), 0) * 1000;
}
export function parseTtml(text) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw Error("歌词 XML 包含不支持的实体");
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const metadata = "http://www.w3.org/ns/ttml#metadata";
  const apple = "http://music.apple.com/lyric-ttml-internal";
  const translations = Array.from(
    doc.getElementsByTagNameNS(apple, "translation"),
  );
  const preferred =
    translations.find((node) =>
      /^zh(?:-|$)/i.test(node.getAttribute("xml:lang")),
    ) ?? translations[0];
  const translated = new Map(
    Array.from(preferred?.getElementsByTagNameNS(apple, "text") ?? []).map(
      (node) => [
        node.getAttribute("for"),
        Array.from(node.childNodes)
          .filter(
            (child) =>
              child.nodeType === 3 ||
              child.getAttributeNS?.(metadata, "role") !== "x-bg",
          )
          .map((child) => child.textContent)
          .join("")
          .trim(),
      ],
    ),
  );
  return Array.from(doc.getElementsByTagName("p"))
    .map((p) => {
      const words = [];
      let translation = "",
        romanization = "",
        body = "";
      function visit(n) {
        if (n.nodeType === 3) {
          body += n.nodeValue;
          return;
        }
        if (n.nodeType !== 1) return;
        const role =
          n.getAttributeNS(metadata, "role") || n.getAttribute("ttm:role");
        if (role === "x-translation") {
          translation += n.textContent || "";
          return;
        }
        if (role === "x-roman") {
          romanization += n.textContent || "";
          return;
        }
        const start = time(n.getAttribute("begin")),
          end = time(n.getAttribute("end"));
        if (Number.isFinite(start) && Number.isFinite(end)) {
          words.push({ start, end, text: n.textContent || "" });
          body += n.textContent || "";
          return;
        }
        Array.from(n.childNodes).forEach(visit);
      }
      Array.from(p.childNodes).forEach(visit);
      return {
        start: time(p.getAttribute("begin")),
        end: time(p.getAttribute("end")),
        text: body.trim(),
        words,
        translation:
          translation || translated.get(p.getAttributeNS(apple, "key")) || "",
        romanization,
      };
    })
    .filter((x) => Number.isFinite(x.start) && x.text);
}
export function alignTranslation(lines, translated) {
  const rows = parseLrc(translated),
    used = new Set();
  for (const line of lines) {
    if (line.translation) continue;
    let best = -1,
      delta = 1201;
    rows.forEach((r, i) => {
      const d = Math.abs(r.start - line.start);
      if (!used.has(i) && d < delta) {
        best = i;
        delta = d;
      }
    });
    if (best >= 0) {
      line.translation = rows[best].text;
      used.add(best);
    }
  }
  return lines;
}
export function lyricDocument({
  original = "",
  translation = "",
  romanization = "",
  timed = "",
  format = "yrc",
  lines,
  source = "平台歌词",
}) {
  lines = lines?.length
    ? lines
    : timed
      ? parseTimed(timed, format)
      : parseLrc(original);
  alignTranslation(lines, translation);
  if (romanization) {
    const r = alignTranslation(
      lines.map((l) => ({ ...l, translation: "" })),
      romanization,
    );
    lines.forEach((l, i) => (l.romanization ||= r[i].translation));
  }
  const hasWordTiming = lines.some((l) => l.words?.length > 0);
  const doc = {
    lines,
    hasWordTiming,
    source,
    original,
    translation,
    romanization,
  };
  if (lines.length) {
    doc.original =
      original && !timed && !hasWordTiming
        ? original
        : exportLyrics(doc, { format: "lrc", bilingual: false }).text;
    doc.translation = lines
      .filter((l) => l.translation)
      .map((l) => `[${stamp(l.start)}]${l.translation}`)
      .join("\n");
  }
  return doc;
}
export function exportLyrics(doc, options = {}) {
  if (typeof options === "string")
    options = { kind: options, format: "lrc", bilingual: false };
  const { kind = "original", bilingual = true } = options;
  if (kind !== "original") {
    if (!["translation", "romanization"].includes(kind) || !doc[kind])
      throw Error("没有该版本的歌词");
    return { extension: "lrc", text: doc[kind], label: "LRC 歌词" };
  }
  let format = options.format || "lrc";
  if (format === "auto") format = doc.hasWordTiming ? "elrc" : "lrc";
  if (!["lrc", "elrc", "ttml"].includes(format))
    throw Error("不支持的歌词格式");
  if (format === "elrc" && !doc.hasWordTiming)
    throw Error("当前歌词没有真实逐字时间，无法导出逐字格式");
  const lines = doc.lines || parseLrc(doc.original);
  if (!lines.length) {
    if (!doc.original) throw Error("没有可用歌词");
    return { extension: "lrc", text: doc.original, label: "LRC 歌词" };
  }
  if (format === "ttml") {
    const t = (ms) => {
      const n = Math.max(0, Math.round(ms));
      return `${String(Math.floor(n / 3600000)).padStart(2, "0")}:${stamp(n % 3600000)}`;
    };
    const ps = lines
      .map((l, i) => {
        const end = l.end || lines[i + 1]?.start || l.start + 5000;
        const content = l.words?.length
          ? l.words
              .map(
                (w) =>
                  `<span begin="${t(w.start)}" end="${t(w.end)}">${xml(w.text)}</span>`,
              )
              .join("")
          : xml(l.text);
        return `<p begin="${t(l.start)}" end="${t(end)}">${content}${bilingual && l.translation ? `<span ttm:role="x-translation" xml:lang="zh">${xml(l.translation)}</span>` : ""}</p>`;
      })
      .join("\n");
    return {
      extension: "ttml",
      label: "TTML 歌词",
      text: `<?xml version="1.0" encoding="UTF-8"?>\n<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><div>\n${ps}\n</div></body></tt>\n`,
    };
  }
  const output = [];
  for (const l of lines) {
    const s = `[${stamp(l.start)}]`;
    const content =
      format === "elrc" && l.words?.length
        ? l.words
            .map((w) => `<${stamp(w.start)}>${w.text}<${stamp(w.end)}>`)
            .join("")
            .replace(/<([^>]+)><\1>/g, "<$1>")
        : l.text;
    output.push(s + content);
    if (bilingual && l.translation) output.push(s + l.translation);
  }
  return {
    extension: "lrc",
    label: format === "elrc" ? "逐字 LRC 歌词" : "LRC 歌词",
    text: output.join("\r\n") + "\r\n",
  };
}
