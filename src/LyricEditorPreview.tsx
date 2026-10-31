import { useEffect, useState } from "react";
import LrcPanel from "./LrcPanel";
import type { Lyrics } from "./types";
export default function LyricEditorPreview({
  text,
  format,
  notify,
}: {
  text: string;
  format: string;
  notify: (s: string, error?: boolean) => void;
}) {
  const [doc, setDoc] = useState<Lyrics | null>(null),
    [errors, setErrors] = useState<string[]>([]),
    [position, setPosition] = useState(0);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(
      () =>
        window.sonora
          .workspace("lyricPreview", { text, format })
          .then((r) => {
            if (active) {
              setDoc(r.doc);
              setErrors(r.errors);
            }
          })
          .catch((e) => {
            if (active) setErrors([e.message]);
          }),
      350,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [text, format]);
  const end = Math.max(
    1,
    ...(doc?.lines || []).map((x) => (x.end || x.start + 5000) / 1000),
  );
  return (
    <div className="lyric-editor-preview">
      <div className="inline-actions">
        <strong>时间轴预览</strong>
        <span>{doc?.hasWordTiming ? "真实逐字时间" : "逐行 / 纯文本"}</span>
        <button
          className="text-button"
          disabled={!!errors.length || !text.trim()}
          onClick={() =>
            window.sonora
              .workspace("lyricExport", { text, format })
              .then((r) => r && notify("歌词已导出"))
              .catch((e) => notify(e.message, true))
          }
        >
          导出编辑歌词
        </button>
      </div>
      {errors.map((x) => (
        <p key={x} className="error-text">
          {x}
        </p>
      ))}
      <input
        aria-label="歌词预览时间"
        type="range"
        min={0}
        max={end}
        step={0.01}
        value={position}
        onChange={(e) => setPosition(Number(e.target.value))}
      />
      <LrcPanel lyric={doc} position={position} onSeek={setPosition} />
    </div>
  );
}
