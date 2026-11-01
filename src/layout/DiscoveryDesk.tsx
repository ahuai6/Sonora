import RecordOrbit from "./RecordOrbit";
import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  Disc3,
  FolderHeart,
  RefreshCw,
  Shuffle,
} from "lucide-react";
import type { Item } from "../types";
import { Artwork, Empty, PlatformBadge, platformNames, weave } from "../ui";
import type { Page } from "./AppChrome";
type Props = {
  recommendations: Item[];
  charts: Item[];
  platform: string;
  onPlatform: (platform: "all" | "netease" | "qq" | "kugou") => void;
  onOpen: (item: Item) => void;
  onPage: (page: Page) => void;
  onRefresh: () => void;
  busy: boolean;
  libraryCount: number;
  notice: ReactNode;
};
export default function DiscoveryDesk(p: Props) {
  const [pick, setPick] = useState(3),
    [turn, setTurn] = useState(0);
  const records = weave(p.recommendations).slice(0, 8),
    selected = Math.min(pick, Math.max(0, records.length - 1)),
    chosen = records[selected];
  useEffect(() => setPick(3), [p.platform]);
  const spin = () => {
    setPick(
      (value) =>
        (value +
          1 +
          Math.floor(Math.random() * Math.max(1, records.length - 1))) %
        Math.max(1, records.length),
    );
    setTurn((value) => value + 1);
  };
  return (
    <div className="discovery-desk">
      <div className="desk-titleline">
        <div>
          <span className="desk-kicker">THE SOUND DESK</span>
          <h1>今天，听点不一样的。</h1>
        </div>
        <div className="discovery-filters">
          <div className="platform-pills">
            {(["all", "netease", "qq", "kugou"] as const).map((id) => (
              <button
                key={id}
                className={p.platform === id ? "active" : ""}
                onClick={() => p.onPlatform(id)}
              >
                {id === "all" ? (
                  <span className="all-dot" />
                ) : (
                  <i className={"platform-dot " + id} />
                )}{" "}
                {id === "all" ? "全部音源" : platformNames[id]}
              </button>
            ))}
          </div>
          <button
            className="icon-button"
            aria-label="刷新发现"
            title="刷新推荐与榜单"
            disabled={p.busy}
            onClick={p.onRefresh}
          >
            <RefreshCw size={18} className={p.busy ? "spin" : ""} />
          </button>
        </div>
      </div>
      {p.notice}
      <div className="sound-desk-grid">
        <div className="desk-side">
          <section className="frequency-card glass-surface">
            <div className="widget-label">
              <span className="live-dot" /> 寻音罗盘<span>01 / EXPLORE</span>
            </div>
            <div className="frequency-body">
              <button
                className="frequency-dial"
                aria-label="换一个灵感歌单"
                title="换一个灵感歌单"
                onClick={spin}
              >
                <span className="dial-ticks" />
                <span
                  className="dial-glass"
                  style={{ transform: `rotate(${turn * 73}deg)` }}
                />
                <span className="dial-center">
                  <Disc3 size={40} strokeWidth={0.8} />
                </span>
                <span className="dial-marker" />
              </button>
              <div className="frequency-copy">
                <small>下一站，没有固定路线</small>
                <strong>{chosen?.title || "给耳朵一点新鲜感"}</strong>
                <span>
                  {chosen
                    ? platformNames[chosen.platform]
                    : "从喜欢的名字开始探索"}
                </span>
              </div>
            </div>
            <div className="frequency-actions">
              <button
                className="button primary"
                onClick={() => (chosen ? p.onOpen(chosen) : p.onPage("search"))}
              >
                去听听
                <ArrowUpRight size={15} />
              </button>
              <button
                className="icon-button glass-control"
                aria-label="重新挑选灵感歌单"
                onClick={spin}
              >
                <Shuffle size={17} />
              </button>
            </div>
          </section>
          <button
            className="collection-pocket glass-surface"
            onClick={() => p.onPage("library")}
          >
            <span className="pocket-icon">
              <FolderHeart size={24} strokeWidth={1.4} />
            </span>
            <span>
              <small>属于你的声音</small>
              <strong>
                {p.libraryCount
                  ? `${p.libraryCount} 首，悉心收藏`
                  : "建立自己的音乐收藏"}
              </strong>
            </span>
            <ArrowUpRight size={17} />
          </button>
        </div>
        <section className="record-wall">
          <div className="wall-heading">
            <div>
              <span className="desk-kicker">CURATED FREQUENCIES</span>
              <h2>随手翻翻，都有惊喜。</h2>
            </div>
            <span>
              {records.length
                ? `${Math.min(8, records.length)} 张精选`
                : "来自你的音乐平台"}
            </span>
          </div>
          {records.length ? (
            <RecordOrbit
              items={records}
              index={selected}
              onIndex={setPick}
              onOpen={p.onOpen}
            />
          ) : p.busy ? (
            <div className="skeleton-grid">
              {Array.from({ length: 8 }, (_, i) => (
                <div className="skeleton-card" key={i}>
                  <i />
                  <span />
                  <span />
                </div>
              ))}
            </div>
          ) : (
            <Empty
              heading="新的频率，正在路上"
              description="可以刷新推荐，或搜索喜欢的音乐。"
              action={
                <button
                  className="button secondary"
                  onClick={() => p.onPage("search")}
                >
                  搜索音乐
                </button>
              }
            />
          )}
        </section>
      </div>
      <section className="charts-shelf">
        <div className="wall-heading">
          <div>
            <span className="desk-kicker">ON THE RADAR</span>
            <h2>正在被世界循环。</h2>
          </div>
          <span>三个平台，各有声浪</span>
        </div>
        <div className="chart-grid">
          {weave(p.charts)
            .slice(0, 3)
            .map((item, i) => (
              <button
                className="chart-card"
                key={item.key}
                onClick={() => p.onOpen(item)}
              >
                <span className="chart-position">0{i + 1}</span>
                <Artwork item={item} />
                <div>
                  <PlatformBadge platform={item.platform} />
                  <strong>{item.title}</strong>
                  <span>
                    {item.trackCount
                      ? `${item.trackCount} 首上榜歌曲`
                      : "打开完整榜单"}
                  </span>
                </div>
                <ArrowUpRight size={19} />
              </button>
            ))}
        </div>
      </section>
      <div className="page-footer">
        仅供学习使用，请于下载后24小时自行删除。
        <span>NO FIXED ROUTE. JUST GOOD MUSIC.</span>
      </div>
    </div>
  );
}
