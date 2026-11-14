import { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import type { API, TagCandidate } from "./types";
import { Busy, Modal } from "./ui";

export default function MatchedLyricsPreview({
  candidate,
  format,
  bilingual,
  onClose,
}: {
  candidate: TagCandidate;
  format: string;
  bilingual: boolean;
  onClose: () => void;
}) {
  const [result, setResult] = useState<Awaited<
    ReturnType<API["tagMatchLyrics"]>
  > | null>(null);
  const [error, setError] = useState("");
  const [copyState, setCopyState] = useState<
    "idle" | "copying" | "copied" | "failed"
  >("idle");

  useEffect(() => {
    let closed = false;
    window.sonora.tagMatchLyrics(candidate.matchId, { format, bilingual }).then(
      (lyrics) => {
        if (!closed) setResult(lyrics);
      },
      (reason: Error) => {
        if (!closed)
          setError(
            reason.message.replace(
              /^Error invoking remote method '[^']+': (?:Error: )?/,
              "",
            ),
          );
      },
    );
    return () => {
      closed = true;
    };
  }, [candidate.matchId, format, bilingual]);

  async function copy() {
    if (!result) return;
    setCopyState("copying");
    try {
      await window.sonora.copyLyrics(result.text);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <Modal
      title="匹配歌词预览"
      subtitle={`${candidate.sourceName} · ${candidate.title} · ${candidate.artist}`}
      onClose={onClose}
      wide
    >
      {error ? (
        <p className="tag-error" role="alert">
          {error}
        </p>
      ) : result ? (
        <>
          <p className="tag-note">
            {result.source} · {result.format.toUpperCase()}
          </p>
          <textarea
            className="tag-lyrics-editor"
            aria-label="匹配歌词内容"
            value={result.text}
            readOnly
            spellCheck={false}
          />
          {copyState === "failed" && (
            <p className="tag-error" role="alert">
              复制失败，可以重试或手动选中文字复制。
            </p>
          )}
          <div className="modal-footer">
            <span className="tag-note" role="status">
              {copyState === "copied" ? "已复制到剪贴板" : ""}
            </span>
            <button
              className="button primary"
              disabled={copyState === "copying"}
              onClick={() => void copy()}
            >
              <Copy size={15} />
              复制歌词
            </button>
          </div>
        </>
      ) : (
        <Busy text="正在获取匹配歌词" />
      )}
    </Modal>
  );
}
