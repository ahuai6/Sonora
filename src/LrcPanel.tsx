import { useMemo, useRef, useEffect } from "react";
import { Music2 } from "lucide-react";
import { parseLyrics } from "./ui";
import type { Lyrics, LyricLine } from "./types";
export default function LrcPanel({
  lyric,
  position,
  onSeek,
}: {
  lyric: Lyrics | null;
  position: number;
  onSeek: (t: number) => void;
}) {
  const lines = useMemo<LyricLine[]>(
    () =>
      lyric?.lines ||
      parseLyrics(lyric?.original || "").map((l) => ({
        start: l.time * 1000,
        text: l.text,
        words: [],
      })),
    [lyric],
  );
  const active = lines.findLastIndex((l) => l.start <= position * 1000),
    container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const target = container.current?.querySelector<HTMLElement>(
      '[data-active="true"]',
    );
    target?.scrollIntoView({
      block: "center",
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }, [active]);
  return (
    <div className="lyric-scroll" ref={container}>
      {lines.length ? (
        lines.map((l, i) => (
          <button
            key={i}
            className={active === i ? "active" : ""}
            data-active={active === i}
            onClick={() => onSeek(l.start / 1000)}
          >
            <span className="lyric-original">
              {l.words?.length
                ? l.words.map((w, k) => (
                    <span
                      key={k}
                      className={`lyric-word ${active === i && position * 1000 >= w.start ? "sung" : ""}`}
                      data-word-active={
                        active === i &&
                        position * 1000 >= w.start &&
                        position * 1000 < w.end
                      }
                    >
                      {w.text}
                    </span>
                  ))
                : l.text || "♪"}
            </span>
            {l.translation && (
              <span className="lyric-translation">{l.translation}</span>
            )}
          </button>
        ))
      ) : (
        <div className="no-lyrics">
          <Music2 size={22} />
          <p>{lyric?.original || "旋律已经足够动人"}</p>
          <span>暂无同步歌词</span>
        </div>
      )}
    </div>
  );
}
