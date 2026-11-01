import type { CSSProperties } from "react";
import {
  Download,
  FileText,
  ListMusic,
  Loader2,
  Music2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { Item, Quality } from "../types";
import { Artwork, duration, qualityNames } from "../ui";
export type PlayMode = "loop" | "shuffle" | "one";
type Props = {
  current: Item | null;
  playing: boolean;
  busy: boolean;
  position: number;
  audioDuration: number;
  volume: number;
  mode: PlayMode;
  quality: Quality;
  actualQuality: string;
  showLyrics: boolean;
  showQueue: boolean;
  onDownload: () => void;
  onMode: () => void;
  onPrevious: () => void;
  onToggle: () => void;
  onNext: () => void;
  onLyrics: () => void;
  onSeek: (time: number) => void;
  onQuality: (quality: Quality) => void;
  onVolume: (volume: number) => void;
  onQueue: () => void;
};
export default function PlayerDock(p: Props) {
  return (
    <footer className="player" aria-label="播放控制">
      <div className="player-track glass-surface">
        {p.current ? (
          <>
            <Artwork key={p.current.key} item={p.current} size="small" />
            <div>
              <strong title={p.current.title}>{p.current.title}</strong>
              <span>{p.current.artist || "未知歌手"}</span>
              <span
                className="player-quality"
                title={p.actualQuality}
                aria-label="播放音频规格"
              >
                {p.actualQuality || "音质待检测"}
              </span>
            </div>
            {p.current.platform !== "local" && (
              <button
                className="icon-button"
                title="下载当前歌曲"
                aria-label="下载当前歌曲"
                onClick={p.onDownload}
              >
                <Download size={17} />
              </button>
            )}
          </>
        ) : (
          <>
            <div className="player-idle-art">
              <Music2 size={22} />
            </div>
            <div>
              <strong>让音乐，慢慢靠近</strong>
              <span>选择一首歌，开始聆听</span>
            </div>
          </>
        )}
      </div>
      <div className="player-center glass-surface">
        <div className="play-controls">
          <button
            className={`icon-button mode-button ${p.mode !== "loop" ? "accent" : ""}`}
            aria-label="切换播放模式"
            title={
              p.mode === "loop"
                ? "列表循环"
                : p.mode === "shuffle"
                  ? "随机播放"
                  : "单曲循环"
            }
            onClick={p.onMode}
          >
            {p.mode === "shuffle" ? (
              <Shuffle size={16} />
            ) : p.mode === "one" ? (
              <Repeat1 size={17} />
            ) : (
              <Repeat size={17} />
            )}
          </button>
          <button
            className="icon-button"
            aria-label="上一首"
            disabled={!p.current}
            onClick={p.onPrevious}
          >
            <SkipBack size={19} fill="currentColor" />
          </button>
          <button
            className="play-main"
            aria-label={p.playing ? "暂停" : "播放"}
            disabled={!p.current || p.busy}
            onClick={p.onToggle}
          >
            {p.busy ? (
              <Loader2 size={22} className="spin" />
            ) : p.playing ? (
              <Pause size={20} fill="currentColor" />
            ) : (
              <Play size={21} fill="currentColor" />
            )}
          </button>
          <button
            className="icon-button"
            aria-label="下一首"
            disabled={!p.current}
            onClick={p.onNext}
          >
            <SkipForward size={19} fill="currentColor" />
          </button>
          <button
            className={`icon-button ${p.showLyrics ? "accent" : ""}`}
            title="歌词与播放面板"
            aria-label="显示歌词面板"
            aria-pressed={p.showLyrics}
            onClick={p.onLyrics}
          >
            <FileText size={17} />
          </button>
        </div>
        <div className="timeline">
          <span>{duration(p.position)}</span>
          <input
            type="range"
            aria-label="播放进度"
            min="0"
            max={p.audioDuration || 1}
            step="0.1"
            value={Math.min(p.position, p.audioDuration || 1)}
            disabled={!p.current || !p.audioDuration}
            style={
              {
                "--progress": `${p.audioDuration ? (p.position / p.audioDuration) * 100 : 0}%`,
              } as CSSProperties
            }
            onChange={(e) => p.onSeek(Number(e.target.value))}
          />
          <span>{duration(p.audioDuration || p.current?.duration || 0)}</span>
        </div>
      </div>
      <div className="player-right glass-surface">
        <select
          aria-label="期望音质"
          title={`期望音质；当前：${p.actualQuality || "未播放"}`}
          value={p.quality}
          onChange={(e) => p.onQuality(e.target.value as Quality)}
        >
          {Object.entries(qualityNames).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <button
          className="icon-button volume-button"
          aria-label={p.volume ? "静音" : "取消静音"}
          onClick={() => p.onVolume(p.volume ? 0 : 0.7)}
        >
          {p.volume ? <Volume2 size={18} /> : <VolumeX size={18} />}
        </button>
        <input
          aria-label="音量"
          className="volume-slider"
          type="range"
          min="0"
          max="1"
          step=".01"
          value={p.volume}
          style={{ "--progress": `${p.volume * 100}%` } as CSSProperties}
          onChange={(e) => p.onVolume(Number(e.target.value))}
        />
        <button
          className={`icon-button queue-button ${p.showQueue ? "accent" : ""}`}
          aria-label="打开播放队列"
          aria-pressed={p.showQueue}
          onClick={p.onQueue}
        >
          <ListMusic size={20} />
        </button>
      </div>
    </footer>
  );
}
