import type { EmbeddedLyrics, LyricLine } from "./types";

// LRC does not label translations. Use the word-timed row as the source
// when it is unique; otherwise keep same-time companions for review.
export function classifyLrc(field: EmbeddedLyrics | undefined) {
  const roles: Record<string, "translation" | "review"> = {};
  if (field?.format !== "lrc") return roles;
  const seen = new Set<string>();
  const byId = new Map(field.lines.map((line) => [line.id, line]));
  for (const line of field.lines) {
    if (!line.sameTimeCandidates?.length || seen.has(line.id)) continue;
    const group = [
      line,
      ...line.sameTimeCandidates.flatMap((id) => byId.get(id) ?? []),
    ];
    for (const row of group) seen.add(row.id);
    const timed = group.filter((row) => row.words?.length);
    const source = timed.length === 1 ? timed[0] : group[0];
    for (const row of group) {
      if (row !== source)
        roles[row.id] =
          timed.length === 1 && group.length === 2 ? "translation" : "review";
    }
  }
  return roles;
}

export function existingLrcTranslations(
  lines: LyricLine[],
  marked: Set<string>,
  sources: Set<string>,
) {
  const result = new Map<string, LyricLine[]>();
  const indexes = new Map(lines.map((line, index) => [line.id, index]));
  for (const [index, line] of lines.entries()) {
    if (!marked.has(line.id)) continue;
    const candidates = (line.sameTimeCandidates ?? []).filter((id) =>
      sources.has(id),
    );
    const prior = candidates
      .filter((id) => indexes.get(id)! < index)
      .sort((a, b) => indexes.get(a)! - indexes.get(b)!);
    const parent = prior.at(-1) ?? candidates[0];
    if (parent) result.set(parent, [...(result.get(parent) ?? []), line]);
  }
  return result;
}
