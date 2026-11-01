import { ListMusic, PanelRightClose } from "lucide-react";
import type { Item, Lyrics } from "../types";
import { Artwork, PlatformBadge } from "../ui";
import LrcPanel from "../LrcPanel";
import QueuePanel from "../QueuePanel";
type Props = {
  current: Item;
  queue: Item[];
  showQueue: boolean;
  lyric: Lyrics | null;
  position: number;
  source: string;
  trial: boolean;
  actualQuality: string;
  requestedQuality: string;
  onClose: () => void;
  onToggleQueue: () => void;
  onQueue: (items: Item[]) => void;
  onPlay: (item: Item) => void;
  onSave: () => void;
  onSeek: (time: number) => void;
};
export default function ListeningPanel(p: Props) {
  return (
    <aside
      className="now-playing glass-surface"
      aria-label={p.showQueue ? "播放队列" : "聆听面板"}
    >
      <div className="now-heading">
        <strong>{p.showQueue ? "播放队列" : "正在聆听"}</strong>
        <div>
          <button
            className={`icon-button ${p.showQueue ? "accent" : ""}`}
            aria-label="切换播放队列"
            aria-pressed={p.showQueue}
            onClick={p.onToggleQueue}
          >
            <ListMusic size={17} />
          </button>
          <button
            className="icon-button"
            aria-label="收起正在播放面板"
            onClick={p.onClose}
          >
            <PanelRightClose size={16} />
          </button>
        </div>
      </div>
      {p.showQueue ? (
        <QueuePanel
          queue={p.queue}
          current={p.current.key}
          onChange={p.onQueue}
          onPlay={p.onPlay}
          onSave={p.onSave}
        />
      ) : (
        <>
          <Artwork key={p.current.key} item={p.current} className="now-cover" />
          <div className="now-meta">
            <PlatformBadge platform={p.current.platform} />
            <h2>{p.current.title}</h2>
            <p>{p.current.artist || "未知歌手"}</p>
          </div>
          <LrcPanel lyric={p.lyric} position={p.position} onSeek={p.onSeek} />
          <div className="now-source">
            <span className="live-dot" />
            <span title={p.source}>{p.source}</span>
            {p.trial && <em>试听片段</em>}
          </div>
          <div className="audio-specification" aria-label="当前实际音质">
            <strong>实际音质</strong>
            <span>{p.actualQuality || "等待检测"}</span>
            {p.current.platform !== "local" && (
              <small>请求：{p.requestedQuality}</small>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
