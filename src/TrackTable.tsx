import {
  Play,
  Download,
  FileText,
  Check,
  FolderOpen,
  Heart,
  Trash2,
  ListMinus,
  Tags,
  MoreHorizontal,
} from "lucide-react";
import type { Item } from "./types";
import { useEffect, useState } from "react";
import { Artwork, PlatformBadge, duration, bytes } from "./ui";
export default function TrackTable({
  items,
  current,
  selected,
  onSelect,
  onPlay,
  onDownload,
  onLyrics,
  lyricOnly = false,
  local = false,
  onLocal,
}: {
  items: Item[];
  current?: string;
  selected: Set<string>;
  onSelect: (keys: Set<string>) => void;
  onPlay: (item: Item) => void;
  onDownload: (items: Item[]) => void;
  onLyrics: (item: Item, save?: boolean) => void;
  lyricOnly?: boolean;
  local?: boolean;
  onLocal?: (id: string, action: string) => void;
}) {
  const [page, setPage] = useState(0),
    pageSize = 100;
  useEffect(() => setPage(0), [items.length, items[0]?.key]);
  const visible = items.slice(page * pageSize, (page + 1) * pageSize);
  const all = items.length > 0 && items.every((i) => selected.has(i.key));
  const selectOne = (key: string) => {
    const next = new Set(selected);
    next.has(key) ? next.delete(key) : next.add(key);
    onSelect(next);
  };
  return (
    <div className={`track-table ${local ? "local" : ""}`}>
      <div className="track-head">
        <input
          type="checkbox"
          aria-label="选择当前列表全部歌曲"
          checked={all}
          onChange={() =>
            onSelect(all ? new Set() : new Set(items.map((x) => x.key)))
          }
        />
        <span>#</span>
        <span>歌曲</span>
        <span className="artist-col">歌手 / 专辑</span>
        <span className="source-col">{local ? "格式 / 大小" : "来源"}</span>
        <span className="duration-col">时长</span>
        <span className="actions-col">操作</span>
      </div>
      {visible.map((item, rowIndex) => {
        const index = page * pageSize + rowIndex;
        return (
          <div
            className={`track-row ${current === item.key ? "playing" : ""} ${selected.has(item.key) ? "selected" : ""}`}
            key={item.key}
            onDoubleClick={() => onPlay(item)}
          >
            <input
              type="checkbox"
              checked={selected.has(item.key)}
              aria-label={`选择 ${item.title}`}
              onChange={() => selectOne(item.key)}
            />
            <button
              className="track-index"
              aria-label={`播放 ${item.title}`}
              onClick={() => onPlay(item)}
            >
              {current === item.key ? (
                <span className="equalizer">
                  <i />
                  <i />
                  <i />
                </span>
              ) : (
                <>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <Play size={14} />
                </>
              )}
            </button>
            <div className="track-title">
              <Artwork item={item} size="small" />
              <div>
                <button
                  className="title-link"
                  title={item.title}
                  onClick={() => (lyricOnly ? onLyrics(item) : onPlay(item))}
                >
                  {item.title}
                </button>
                <span>{local ? item.path : item.album || "单曲"}</span>
                {item.variants && (
                  <details className="song-variants">
                    <summary>{item.variants.length} 个平台候选</summary>
                    <div>
                      {item.variants.map((v) => (
                        <button
                          key={v.key}
                          className="text-button"
                          onClick={() => onPlay(v)}
                        >
                          {v.platform} · {v.title} · {v.album}
                        </button>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            </div>
            <div className="artist-col">
              <strong title={item.artist}>{item.artist || "未知歌手"}</strong>
              <span title={item.album}>{item.album || "—"}</span>
            </div>
            <div className="source-col">
              {local ? (
                <div className="local-format">
                  <strong title={item.audioInfo?.label}>
                    {item.missing ? "文件缺失" : item.format}
                  </strong>
                  <span title={item.audioInfo?.label}>
                    {item.audioInfo?.label}
                  </span>
                  <span>{bytes(item.bytes)}</span>
                </div>
              ) : (
                <PlatformBadge platform={item.platform} />
              )}
            </div>
            <span className="duration-col">
              {item.duration ? duration(item.duration) : "—"}
            </span>
            <div
              className="row-actions"
              onDoubleClick={(e) => e.stopPropagation()}
            >
              {local ? (
                <>
                  <button
                    className="icon-button"
                    aria-label={`编辑 ${item.title} 标签`}
                    title="编辑标签、封面和歌词"
                    onClick={() => onLocal?.(item.id, "edit")}
                  >
                    <Tags size={16} />
                  </button>
                  <button
                    className={`icon-button ${item.favorite ? "liked" : ""}`}
                    aria-label="收藏本地歌曲"
                    title="收藏"
                    onClick={() => onLocal?.(item.id, "favorite")}
                  >
                    <Heart
                      size={16}
                      fill={item.favorite ? "currentColor" : "none"}
                    />
                  </button>
                  <details
                    className="row-more"
                    onBlur={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node))
                        e.currentTarget.removeAttribute("open");
                    }}
                  >
                    <summary
                      aria-label={`更多 ${item.title} 操作`}
                      title="更多操作"
                    >
                      <MoreHorizontal size={17} />
                    </summary>
                    <div
                      className="row-more-panel"
                      role="group"
                      aria-label="更多操作"
                    >
                      {[
                        {
                          action: "reveal",
                          label: "在文件夹中显示",
                          Icon: FolderOpen,
                        },
                        {
                          action: "remove",
                          label: "移除音乐库记录",
                          Icon: ListMinus,
                        },
                        {
                          action: "trash",
                          label: "音频移入回收站",
                          Icon: Trash2,
                        },
                      ].map(({ action, label, Icon }) => (
                        <button
                          key={action}
                          className={action === "trash" ? "danger" : ""}
                          onClick={(e) => {
                            e.currentTarget
                              .closest("details")
                              ?.removeAttribute("open");
                            onLocal?.(item.id, action);
                          }}
                        >
                          <Icon size={15} />
                          {label}
                        </button>
                      ))}
                    </div>
                  </details>
                </>
              ) : (
                <>
                  <button
                    className="icon-button"
                    aria-label={`查看 ${item.title} 歌词`}
                    title="查看歌词"
                    onClick={() => onLyrics(item)}
                  >
                    <FileText size={16} />
                  </button>
                  <button
                    className="icon-button download-icon"
                    aria-label={
                      lyricOnly
                        ? `保存 ${item.title} 歌词`
                        : `下载 ${item.title}`
                    }
                    title={lyricOnly ? "保存 LRC 歌词" : "下载音乐"}
                    onClick={() =>
                      lyricOnly ? onLyrics(item, true) : onDownload([item])
                    }
                  >
                    <Download size={17} />
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
      {items.length > pageSize && (
        <div className="list-toolbar">
          <span>
            第 {page + 1} / {Math.ceil(items.length / pageSize)} 页 · 共{" "}
            {items.length} 首
          </span>
          <div>
            <button
              className="button secondary compact"
              disabled={!page}
              onClick={() => setPage(page - 1)}
            >
              上一页
            </button>
            <button
              className="button secondary compact"
              disabled={(page + 1) * pageSize >= items.length}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
