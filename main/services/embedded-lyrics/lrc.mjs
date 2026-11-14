const leadingTime = /^\[(\d{1,4}:[0-5]\d(?:[.:]\d{1,3})?)\]/;
const wordTime = /<\d{1,4}:[0-5]\d(?:[.:]\d{1,3})?>/g;
const inlineBracketTime = /\[\d{1,4}:[0-5]\d(?:[.:]\d{1,3})?\]/g;

export function lrcMilliseconds(time) {
  const [minutes, seconds, fraction = ""] = time.split(/[:.]/);
  return (
    Number(minutes) * 60_000 +
    Number(seconds) * 1000 +
    Number(fraction.padEnd(3, "0"))
  );
}

function records(text) {
  return Array.from(text.matchAll(/([^\r\n]*)(\r\n|\n|\r|$)/g), (match) => ({
    raw: match[1],
    eol: match[2],
  })).filter((record) => record.raw || record.eol);
}

function timedWords(text, offset) {
  const markers = [
    ...text.matchAll(
      /<(\d{1,4}:[0-5]\d(?:[.:]\d{1,3})?)>|\[(\d{1,4}:[0-5]\d(?:[.:]\d{1,3})?)\]/g,
    ),
  ];
  if (!markers.length) return;
  const words = [];
  if (markers[0].index > 0)
    words.push({ text: text.slice(0, markers[0].index) });
  for (const [index, marker] of markers.entries()) {
    const next = markers[index + 1];
    const value = text.slice(
      marker.index + marker[0].length,
      next?.index ?? text.length,
    );
    if (value)
      words.push({
        text: value,
        start: lrcMilliseconds(marker[1] ?? marker[2]) + offset,
        end: next && lrcMilliseconds(next[1] ?? next[2]) + offset,
      });
  }
  return words.some((word) => word.start !== undefined) ? words : undefined;
}

export function readLrc(text) {
  const rows = records(text);
  const offset = Number(
    rows
      .find((row) => /^\s*\[offset:[+-]?\d+\]\s*$/i.test(row.raw))
      ?.raw.match(/[+-]?\d+/)?.[0] ?? 0,
  );
  const parsed = rows.map((row, index) => {
    let content = row.raw.replace(/^\s*/, "");
    const times = [];
    for (
      let match = content.match(leadingTime);
      match;
      match = content.match(leadingTime)
    ) {
      times.push(match[1]);
      content = content.slice(match[0].length);
    }
    const plain = content
      .replace(wordTime, "")
      .replace(inlineBracketTime, "")
      .trim();
    return {
      ...row,
      lines: plain
        ? times.map((time, i) => ({
            id: "l" + (index + 1) + "." + (i + 1),
            time,
            milliseconds: lrcMilliseconds(time) + offset,
            text: plain,
            words: timedWords(
              content,
              offset + lrcMilliseconds(time) - lrcMilliseconds(times[0]),
            ),
          }))
        : [],
    };
  });
  const lines = parsed.flatMap((row) => row.lines);
  const groups = new Map();
  for (const line of lines) {
    const time = line.milliseconds;
    const group = groups.get(time) ?? [];
    group.push(line);
    groups.set(time, group);
  }
  for (const group of groups.values()) {
    if (group.length > 1)
      for (const line of group)
        line.sameTimeCandidates = group
          .filter((item) => item !== line)
          .map((item) => item.id);
  }
  return { lines, rows: parsed, groups };
}

export function writeLrc(text, request) {
  const { rows, groups, lines } = readLrc(text);
  const replacing = new Set(request.lrcReplaceIds);
  const eol = rows.find((row) => row.eol)?.eol ?? "\n";
  if (replacing.size && !request.overwrite)
    throw new Error("请先启用替换已确认的译文。");
  for (const id of replacing) {
    const line = lines.find((item) => item.id === id);
    if (
      !line?.sameTimeCandidates?.some((candidate) => !replacing.has(candidate))
    ) {
      throw new Error("只能替换已确认且有对应原词的同时间戳行。");
    }
  }
  return rows
    .map((row) => {
      const deleted = row.lines.filter((line) => replacing.has(line.id)).length;
      if (deleted > 0) {
        if (deleted !== row.lines.length)
          throw new Error("请为多时间戳的旧译文选中该文本行的全部时间点。");
        return "";
      }
      const added = [];
      for (const line of row.lines) {
        const translation = request.translations[line.id]?.trim();
        if (!translation) continue;
        if (
          leadingTime.test(translation) ||
          /<\d{1,4}:[0-5]\d/.test(translation)
        ) {
          throw new Error("译文应为单行纯文本，时间戳由应用复制。");
        }
        const sameTime = groups.get(line.milliseconds);
        if (
          sameTime.some(
            (item) =>
              item.id !== line.id &&
              !replacing.has(item.id) &&
              item.text === translation,
          )
        )
          continue;
        added.push("[" + line.time + "]" + translation);
      }
      if (!added.length) return row.raw + row.eol;
      return row.raw + (row.eol || eol) + added.join(row.eol || eol) + row.eol;
    })
    .join("");
}
