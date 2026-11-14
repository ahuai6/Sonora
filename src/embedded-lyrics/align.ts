import type { Alignment, LyricLine, PastedLine } from "./types.js";

export function readPaste(text: string): PastedLine[] {
  const offset = Number(
    text.match(/^\s*\[offset:([+-]?\d+)\]\s*$/im)?.[1] ?? 0,
  );
  return text
    .split(/\r\n|\n|\r/)
    .flatMap((line) => {
      let rest = line.trimStart();
      const times: number[] = [];
      for (;;) {
        const match = rest.match(/^\[(\d{1,4}):([0-5]\d)(?:[.:](\d{1,3}))?\]/);
        if (!match) break;
        times.push(
          Number(match[1]) * 60_000 +
            Number(match[2]) * 1000 +
            Number((match[3] ?? "").padEnd(3, "0")) +
            offset,
        );
        rest = rest.slice(match[0].length);
      }
      const plain = rest
        .replace(/<\d{1,4}:[0-5]\d(?:[.:]\d{1,3})?>/g, "")
        .trim();
      if (!plain || /^\[[a-z]+:.*\]$/i.test(plain)) return [];
      return (times.length ? times : [null]).map((milliseconds) => ({
        index: 0,
        text: plain,
        milliseconds,
      }));
    })
    .map((fragment, index) => ({ ...fragment, index: index + 1 }));
}

export function normalizeLyric(text: string) {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{Z}\s]/gu, "");
}

export function referenceRows(lines: LyricLine[], fragments: PastedLine[]) {
  const originalText = new Set(lines.map((line) => normalizeLyric(line.text)));
  return new Set(
    fragments
      .filter(
        (fragment, index) =>
          !fragment.fromSearch &&
          !fragment.sourceText &&
          originalText.has(normalizeLyric(fragment.text)) &&
          (fragments.length !== lines.length ||
            (fragment.milliseconds !== null &&
              fragments[index + 1]?.milliseconds === fragment.milliseconds)),
      )
      .map((fragment) => fragment.index),
  );
}

export function localAlignment(
  lines: LyricLine[],
  fragments: PastedLine[],
  offset: number,
): Alignment[] {
  const matches = new Map<string, Alignment>();
  const used = new Set<number>();
  const bilingual = referenceRows(lines, fragments);
  const byLine = new Map(lines.map((line, index) => [line.id, index]));
  function put(
    line: LyricLine,
    fragment: PastedLine,
    evidence: Alignment["evidence"],
  ) {
    if (
      used.has(fragment.index) ||
      matches.has(line.id) ||
      bilingual.has(fragment.index)
    )
      return;
    matches.set(line.id, {
      id: line.id,
      fragments: [fragment.index],
      evidence,
    });
    used.add(fragment.index);
  }
  for (const fragment of fragments) {
    if (fragment.milliseconds === null || bilingual.has(fragment.index))
      continue;
    const time = fragment.milliseconds + offset;
    const candidates = lines.filter(
      (line) =>
        line.milliseconds !== null && Math.abs(line.milliseconds - time) <= 25,
    );
    const competing = fragments.filter(
      (other) =>
        other.milliseconds !== null &&
        !bilingual.has(other.index) &&
        Math.abs(other.milliseconds + offset - time) <= 25,
    );
    if (
      candidates.length === 1 &&
      competing.length === 1 &&
      (!fragment.sourceText ||
        normalizeLyric(candidates[0].text) ===
          normalizeLyric(fragment.sourceText))
    )
      put(candidates[0], fragment, "timestamp");
  }
  for (const fragment of fragments) {
    if (!fragment.sourceText) continue;
    const reference = normalizeLyric(fragment.sourceText);
    const candidates = lines.filter(
      (line) => normalizeLyric(line.text) === reference,
    );
    if (
      candidates.length === 1 &&
      fragments.filter(
        (other) =>
          other.sourceText && normalizeLyric(other.sourceText) === reference,
      ).length === 1
    )
      put(candidates[0], fragment, "source");
  }
  let previous = -1;
  for (let i = 0; i < fragments.length - 1; i++) {
    const source = fragments[i];
    const translation = fragments[i + 1];
    if (!bilingual.has(source.index) || bilingual.has(translation.index))
      continue;
    const normalized = normalizeLyric(source.text);
    const candidates = lines.flatMap((line, index) =>
      index > previous && normalized === normalizeLyric(line.text)
        ? [{ line, index }]
        : [],
    );
    const atTime =
      source.milliseconds === null
        ? []
        : candidates.filter(
            ({ line }) =>
              line.milliseconds !== null &&
              Math.abs(line.milliseconds - source.milliseconds! - offset) <= 25,
          );
    const match =
      atTime.length === 1
        ? atTime[0]
        : candidates.length === 1
          ? candidates[0]
          : undefined;
    if (match) {
      put(match.line, translation, "source");
      previous = match.index;
    }
  }
  const ordered = [...matches.values()].sort(
    (a, b) => byLine.get(a.id)! - byLine.get(b.id)!,
  );
  if (
    ordered.every(
      (item, index) =>
        index === 0 || item.fragments[0] > ordered[index - 1].fragments[0],
    )
  ) {
    const points = [
      { line: -1, fragment: 0 },
      ...ordered.map((item) => ({
        line: byLine.get(item.id)!,
        fragment: item.fragments[0],
      })),
      { line: lines.length, fragment: fragments.length + 1 },
    ];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const subset = lines.slice(a.line + 1, b.line);
      const available = fragments.filter(
        (fragment) =>
          a.fragment < fragment.index &&
          fragment.index < b.fragment &&
          !bilingual.has(fragment.index) &&
          fragment.milliseconds === null,
      );
      if (subset.length === available.length)
        subset.forEach((line, index) => put(line, available[index], "order"));
    }
  }
  return [...matches.values()];
}
