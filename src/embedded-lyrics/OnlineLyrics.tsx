import { useEffect, useRef, useState } from "react";
import type { Item, Lyrics, TagCandidate } from "../types";
import { Busy, Modal, duration } from "../ui";
import { readPaste } from "./align";
import type { PastedLine } from "./types";

export default function OnlineLyrics({
  item,
  onAdd,
  onClose,
}: {
  item: Item;
  onAdd: (rows: PastedLine[]) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(`${item.title} ${item.artist}`.trim());
  const [source, setSource] = useState("all-lyrics");
  const [results, setResults] = useState<TagCandidate[]>([]);
  const [candidate, setCandidate] = useState<TagCandidate | null>(null);
  const [document, setDocument] = useState<Lyrics | null>(null);
  const [variant, setVariant] = useState("translation");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );

  async function run(task: (isCurrent: () => boolean) => Promise<void>) {
    const token = ++generation.current;
    const isCurrent = () => generation.current === token;
    setError("");
    setBusy(true);
    try {
      await task(isCurrent);
    } catch (e) {
      if (isCurrent()) setError((e as Error).message);
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }

  const preview =
    variant === "translation"
      ? document?.translation
      : variant === "original"
        ? document?.original
        : document?.lines?.length
          ? document.lines
              .map((line) =>
                [line.text, line.translation].filter(Boolean).join("\n"),
              )
              .join("\n")
          : document?.original;
  function append() {
    if (!document || !preview) return;
    const rows: PastedLine[] = document.lines?.length
      ? document.lines.flatMap((line) => {
          const text = variant === "original" ? line.text : line.translation;
          return text
            ? [
                {
                  index: 0,
                  text,
                  milliseconds: line.start,
                  sourceText: line.text,
                  fromSearch: true,
                },
              ]
            : [];
        })
      : readPaste(preview).map((row) => ({ ...row, fromSearch: true }));
    if (rows.length) onAdd(rows);
  }

  return (
    <Modal title="搜索在线歌词" onClose={onClose} wide>
      <form
        className="inline-actions"
        onSubmit={(e) => {
          e.preventDefault();
          setResults([]);
          setCandidate(null);
          setDocument(null);
          void run(async (current) => {
            const result = await window.sonora.tagSearch({
              localId: item.id,
              query,
              source,
            });
            if (!current()) return;
            setResults(result.items);
            setError(
              result.errors
                .map((e) => `${e.source}：${e.message}`)
                .join("；") || (result.items.length ? "" : "未找到歌词候选"),
            );
          });
        }}
      >
        <input
          aria-label="在线歌词关键词"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="在线歌词来源"
          value={source}
          onChange={(e) => setSource(e.target.value)}
        >
          <option value="all-lyrics">全部来源</option>
          <option value="netease">网易云</option>
          <option value="qq">QQ 音乐</option>
          <option value="kugou">酷狗</option>
          <option value="lrclib">LRCLIB</option>
        </select>
        <button className="button primary" disabled={busy || !query.trim()}>
          搜索歌词
        </button>
      </form>
      {error && (
        <p className="tag-error" role="alert">
          {error}
        </p>
      )}
      {busy && <Busy text="正在查询歌词" />}
      {!candidate || !document ? (
        <div className="tag-candidates">
          {results.map((row) => (
            <button
              key={row.matchId}
              className="embedded-candidate"
              disabled={busy}
              onClick={() => {
                setCandidate(row);
                setDocument(null);
                void run(async (current) => {
                  const result = await window.sonora.tagLyricDocument(
                    row.matchId,
                  );
                  if (!current()) return;
                  setDocument(result);
                  setVariant(result.translation ? "translation" : "original");
                });
              }}
            >
              <strong>
                {row.title} · {row.artist}
              </strong>
              <small>
                {row.sourceName} · {row.album || "未知专辑"} ·{" "}
                {duration(row.duration)}
              </small>
            </button>
          ))}
        </div>
      ) : (
        <>
          <p className="tag-note">
            {candidate.sourceName} · {candidate.title} · {candidate.artist}
          </p>
          <div className="inline-actions">
            <button
              className="button secondary"
              onClick={() => {
                setCandidate(null);
                setDocument(null);
              }}
            >
              返回候选
            </button>
            <select
              aria-label="歌词预览内容"
              value={variant}
              onChange={(e) => setVariant(e.target.value)}
            >
              <option value="translation" disabled={!document.translation}>
                译文
              </option>
              <option value="original">原词</option>
              <option value="bilingual" disabled={!document.translation}>
                双语预览
              </option>
            </select>
          </div>
          {preview ? (
            <textarea
              className="tag-lyrics-editor"
              readOnly
              aria-label="在线歌词预览文本"
              value={preview}
            />
          ) : (
            <p className="tag-note">该候选没有可用歌词。</p>
          )}
          <button
            className="button primary"
            disabled={!preview}
            onClick={append}
          >
            {variant === "original"
              ? "加入原词作为匹配文本"
              : "加入译文用于匹配"}
          </button>
        </>
      )}
    </Modal>
  );
}
