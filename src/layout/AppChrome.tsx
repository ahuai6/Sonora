import { Minus, Square, X } from "lucide-react";
import type { Item } from "../types";

export type Page =
  | "discover"
  | "search"
  | "lyrics"
  | "library"
  | "downloads"
  | "accounts"
  | "settings";
export function AmbientBackdrop({ item }: { item: Item | null }) {
  return (
    <div className="ambient-scene" aria-hidden="true">
      <div className="ambient-wash wash-violet" />
      <div className="ambient-wash wash-blue" />
      <div className="ambient-wash wash-peach" />
      {item?.cover && (
        <img
          className="ambient-art"
          key={item.cover}
          src={item.cover}
          alt=""
          onError={(e) => {
            e.currentTarget.style.visibility = "hidden";
          }}
        />
      )}
      <div className="ambient-grain" />
    </div>
  );
}

export function WindowChrome() {
  return (
    <div className="window-titlebar">
      <span className="window-wordmark">
        SONORA <i /> 音乐，自在流动
      </span>
      <div className="window-controls">
        <button
          aria-label="最小化"
          onClick={() => window.sonora.windowAction("minimize")}
        >
          <Minus size={15} />
        </button>
        <button
          aria-label="最大化"
          onClick={() => window.sonora.windowAction("maximize")}
        >
          <Square size={12} />
        </button>
        <button
          aria-label="关闭窗口"
          className="close-window"
          onClick={() => window.sonora.windowAction("close")}
        >
          <X size={17} />
        </button>
      </div>
    </div>
  );
}
