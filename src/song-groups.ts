import type { Item } from "./types";
const normalize = (text: string) =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}]/gu, "");
// Keep full version names and album identity; only merge near-identical releases.
export function groupSongs(items: Item[]): Item[] {
  const groups: Item[][] = [];
  for (const item of items) {
    const found = groups.find((rows) => {
      const first = rows[0];
      return (
        first.kind === "song" &&
        item.kind === "song" &&
        normalize(first.title) === normalize(item.title) &&
        normalize(first.artist) === normalize(item.artist) &&
        normalize(first.album) === normalize(item.album) &&
        first.duration > 0 &&
        item.duration > 0 &&
        Math.abs(first.duration - item.duration) <= 2
      );
    });
    found ? found.push(item) : groups.push([item]);
  }
  return groups.map((rows) =>
    rows.length > 1 ? { ...rows[0], variants: rows } : rows[0],
  );
}
