import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  Compass,
  Music2,
  Download,
  FolderHeart,
  FileText,
  SlidersHorizontal,
  UserRound,
  ArrowUpRight,
  ArrowLeft,
  ChevronRight,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Shuffle,
  Repeat,
  Repeat1,
  ListMusic,
  PanelRightClose,
  PanelRightOpen,
  Check,
  Plus,
  FolderOpen,
  AlertCircle,
  X,
  Minus,
  Square,
  Loader2,
  RefreshCw,
  Disc3,
  Heart,
  CheckCircle2,
} from "lucide-react";
import type {
  Account,
  Bootstrap,
  Item,
  Platform,
  Provider,
  Quality,
  Result,
  Settings as SettingsType,
  Lyrics,
  Download as Job,
} from "./types";
import {
  Artwork,
  PlatformBadge,
  platformNames,
  qualityNames,
  duration,
  bytes,
  Empty,
  Busy,
  Modal,
  SectionHeading,
  parseLyrics,
  weave,
} from "./ui";
import Accounts from "./Accounts";
import Settings from "./Settings";
import TrackTable from "./TrackTable";
import DownloadView from "./DownloadView";
import TagEditor from "./TagEditor";
type Page =
  | "discover"
  | "search"
  | "lyrics"
  | "library"
  | "downloads"
  | "accounts"
  | "settings";
type SearchKind = "song" | "artist" | "album" | "playlist";
const kinds: { id: SearchKind; name: string }[] = [
  { id: "song", name: "歌曲" },
  { id: "artist", name: "歌手" },
  { id: "album", name: "专辑" },
  { id: "playlist", name: "歌单" },
];
const navs = [
  { id: "discover", label: "发现音乐", Icon: Compass },
  { id: "search", label: "搜索资源", Icon: Search },
  { id: "lyrics", label: "歌词搜索", Icon: FileText },
  { id: "library", label: "本地音乐", Icon: FolderHeart },
  { id: "downloads", label: "下载中心", Icon: Download },
] as const;
export default function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null),
    [fatal, setFatal] = useState("");
  const [page, setPage] = useState<Page>("discover"),
    [platform, setPlatform] = useState<Platform | "all">("all"),
    [query, setQuery] = useState(""),
    [kind, setKind] = useState<SearchKind>("song");
  const [results, setResults] = useState<Result>({
      items: [],
      errors: [],
      hasMore: false,
    }),
    [searchPage, setSearchPage] = useState(1),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState(new Set<string>());
  const [recommendations, setRecommendations] = useState<Item[]>([]),
    [charts, setCharts] = useState<Item[]>([]),
    [discoveryErrors, setDiscoveryErrors] = useState<Result["errors"]>([]),
    [discoveryBusy, setDiscoveryBusy] = useState(false);
  const [collection, setCollection] = useState<Item | null>(null),
    [collectionItems, setCollectionItems] = useState<Result>({
      items: [],
      errors: [],
      hasMore: false,
    }),
    [collectionPage, setCollectionPage] = useState(1),
    [collectionBusy, setCollectionBusy] = useState(false);
  const [current, setCurrent] = useState<Item | null>(null),
    [playing, setPlaying] = useState(false),
    [audioBusy, setAudioBusy] = useState(false),
    [source, setSource] = useState(""),
    [actualQuality, setActualQuality] = useState(""),
    [trial, setTrial] = useState(false),
    [position, setPosition] = useState(0),
    [audioDuration, setAudioDuration] = useState(0),
    [volume, setVolume] = useState(0.7),
    [mode, setMode] = useState<"loop" | "shuffle" | "one">("loop"),
    [showPlayer, setShowPlayer] = useState(true),
    [showQueue, setShowQueue] = useState(false),
    [queue, setQueue] = useState<Item[]>([]),
    [lyric, setLyric] = useState<Lyrics | null>(null);
  const [lyricPreview, setLyricPreview] = useState<{
      item: Item;
      data?: Lyrics;
      error?: string;
    } | null>(null),
    [lyricVersion, setLyricVersion] = useState("original");
  const [lyricFormat, setLyricFormat] = useState("auto"),
    [lyricBilingual, setLyricBilingual] = useState(true);
  const [libraryQuery, setLibraryQuery] = useState(""),
    [favorites, setFavorites] = useState(false),
    [libraryBusy, setLibraryBusy] = useState(false),
    [librarySort, setLibrarySort] = useState("recent");
  const [welcome, setWelcome] = useState(false),
    [toasts, setToasts] = useState<
      { id: number; text: string; error: boolean }[]
    >([]);
  const [tagItem, setTagItem] = useState<Item | null>(null);
  const audio = useRef<HTMLAudioElement>(null),
    searchInput = useRef<HTMLInputElement>(null),
    playGeneration = useRef(0),
    searchGeneration = useRef(0),
    lastSearch = useRef(""),
    discoveryGeneration = useRef(0),
    collectionGeneration = useRef(0),
    resumeAt = useRef(0),
    currentRef = useRef<Item | null>(null);
  const notify = useCallback((text: string, error = false) => {
    text = String(text).replace(
      /^Error invoking remote method '[^']+': Error: /,
      "",
    );
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, error }]);
    setTimeout(
      () => setToasts((t) => t.filter((x) => x.id !== id)),
      error ? 9000 : 4500,
    );
  }, []);
  useEffect(() => {
    window.sonora
      .bootstrap()
      .then((b) => {
        setBoot(b);
        setWelcome(!b.acceptedDisclaimer);
      })
      .catch((e) => setFatal(e.message));
    const off = window.sonora.onDownload((jobs) => {
      setBoot((b) => (b ? { ...b, downloads: jobs } : b));
      if (jobs.some((j) => j.status === "completed"))
        window.sonora
          .bootstrap()
          .then((r) => setBoot((b) => (b ? { ...b, library: r.library } : b)))
          .catch(() => {});
    });
    const offLibrary = window.sonora.onLibrary((items) =>
      setBoot((b) => (b ? { ...b, library: items } : b)),
    );
    return () => {
      off();
      offLibrary();
    };
  }, []);
  useEffect(() => {
    if (!boot) return;
    const setting = boot.settings.theme;
    const m = matchMedia("(prefers-color-scheme: dark)");
    const update = () =>
      (document.documentElement.dataset.theme =
        setting === "system" ? (m.matches ? "dark" : "light") : setting);
    update();
    m.addEventListener("change", update);
    return () => m.removeEventListener("change", update);
  }, [boot?.settings.theme]);
  const setAccounts = (accounts: Account[]) =>
    setBoot((b) => (b ? { ...b, accounts } : b));
  const setSettings = (settings: SettingsType) =>
    setBoot((b) => (b ? { ...b, settings } : b));
  const setProviders = (providers: Provider[]) =>
    setBoot((b) => (b ? { ...b, providers } : b));
  const setJobs = (downloads: Job[]) =>
    setBoot((b) => (b ? { ...b, downloads } : b));
  const changePage = (p: Page) => {
    if ((p === "search" || p === "lyrics") && p !== page)
      setResults({ items: [], errors: [], hasMore: false });
    setPage(p);
    setCollection(null);
    setSelected(new Set());
    if (p === "search" || p === "lyrics")
      setTimeout(() => searchInput.current?.focus(), 60);
  };
  const fetchDiscovery = useCallback(async () => {
    if (!boot) return;
    const gen = ++discoveryGeneration.current;
    setDiscoveryBusy(true);
    setRecommendations([]);
    setCharts([]);
    setDiscoveryErrors([]);
    const platforms = boot.providers.filter(
      (p) => p.enabled && (platform === "all" || p.id === platform),
    );
    await Promise.allSettled(
      platforms.map(async (p) => {
        await Promise.allSettled([
          window.sonora
            .recommend(p.id)
            .then((r) => {
              if (gen === discoveryGeneration.current)
                setRecommendations((x) =>
                  [...x, ...r.items].filter(
                    (x, i, a) => a.findIndex((y) => y.key === x.key) === i,
                  ),
                );
            })
            .catch((e) => {
              if (gen === discoveryGeneration.current)
                setDiscoveryErrors((x) => [
                  ...x,
                  { platform: p.id, message: e.message },
                ]);
            }),
          window.sonora
            .charts(p.id)
            .then((r) => {
              if (gen === discoveryGeneration.current)
                setCharts((x) =>
                  [...x, ...r.items].filter(
                    (x, i, a) => a.findIndex((y) => y.key === x.key) === i,
                  ),
                );
            })
            .catch((e) => {
              if (gen === discoveryGeneration.current)
                setDiscoveryErrors((x) => [
                  ...x,
                  { platform: p.id, message: e.message },
                ]);
            }),
        ]);
      }),
    );
    if (gen === discoveryGeneration.current) setDiscoveryBusy(false);
  }, [
    platform,
    boot?.providers.map((x) => `${x.id}:${x.enabled}:${x.baseUrl}`).join("|"),
  ]);
  useEffect(() => {
    if (boot && page === "discover") fetchDiscovery();
  }, [page, fetchDiscovery]);
  async function doSearch(
    q = query,
    type = kind,
    plat = platform,
    next = 1,
    lyricOnly = page === "lyrics",
  ) {
    if (!q.trim()) {
      searchInput.current?.focus();
      return;
    }
    const signature = JSON.stringify([q.trim(), type, plat, lyricOnly]);
    if (next > 1 && lastSearch.current !== signature) next = 1;
    lastSearch.current = signature;
    const gen = ++searchGeneration.current;
    setBusy(true);
    setSelected(new Set());
    setCollection(null);
    setPage(lyricOnly ? "lyrics" : "search");
    setSearchPage(next);
    if (next === 1) setResults({ items: [], errors: [], hasMore: false });
    try {
      const result = await window.sonora.search({
        query: q,
        kind: lyricOnly ? "lyric" : type,
        platform: plat,
        page: next,
        limit: 30,
      });
      if (gen === searchGeneration.current)
        setResults((prev) => ({
          ...result,
          items:
            next === 1
              ? result.items
              : [
                  ...new Map(
                    [...prev.items, ...result.items].map((x) => [x.key, x]),
                  ).values(),
                ],
        }));
    } catch (e) {
      if (gen === searchGeneration.current) notify((e as Error).message, true);
    } finally {
      if (gen === searchGeneration.current) setBusy(false);
    }
  }
  async function openCollection(item: Item, next = 1) {
    const gen = ++collectionGeneration.current;
    setCollection(item);
    setCollectionBusy(true);
    setCollectionPage(next);
    setSelected(new Set());
    if (next === 1)
      setCollectionItems({ items: [], errors: [], hasMore: false });
    try {
      const r = await window.sonora.collection(item, next);
      if (gen === collectionGeneration.current)
        setCollectionItems((prev) => ({
          ...r,
          items:
            next === 1
              ? r.items
              : [
                  ...new Map(
                    [...prev.items, ...r.items].map((x) => [x.key, x]),
                  ).values(),
                ],
        }));
    } catch (e) {
      if (gen === collectionGeneration.current)
        setCollectionItems((x) => ({
          ...x,
          errors: [{ platform: item.platform, message: (e as Error).message }],
        }));
    } finally {
      if (gen === collectionGeneration.current) setCollectionBusy(false);
    }
  }
  async function accountPlaylists(p: Platform, next = 1) {
    const gen = ++collectionGeneration.current;
    if (next === 1) changePage("accounts");
    setCollection({
      id: "account",
      key: "account:" + p,
      kind: "playlist",
      platform: p,
      title: "我的歌单",
      artist: platformNames[p],
      album: "",
      cover: "",
      duration: 0,
      meta: {},
    });
    setCollectionBusy(true);
    setCollectionPage(next);
    if (next === 1)
      setCollectionItems({ items: [], errors: [], hasMore: false });
    try {
      const result = await window.sonora.accountPlaylists(p, next);
      if (gen === collectionGeneration.current)
        setCollectionItems((previous) => ({
          ...result,
          items:
            next === 1
              ? result.items
              : [
                  ...new Map(
                    [...previous.items, ...result.items].map((x) => [x.key, x]),
                  ).values(),
                ],
        }));
    } catch (e) {
      setCollectionItems({
        items: [],
        hasMore: false,
        errors: [{ platform: p, message: (e as Error).message }],
      });
    } finally {
      if (gen === collectionGeneration.current) setCollectionBusy(false);
    }
  }
  async function playTrack(item: Item, items: Item[] = queue, seek = 0) {
    if (item.kind !== "song") {
      openCollection(item);
      return;
    }
    const gen = ++playGeneration.current;
    currentRef.current = item;
    setCurrent(item);
    setAudioBusy(true);
    setPlaying(false);
    setLyric(null);
    setPosition(0);
    setAudioDuration(0);
    setSource("正在连接音源");
    setActualQuality("");
    setTrial(false);
    setQueue(items.filter((x) => x.kind === "song"));
    resumeAt.current = seek;
    audio.current?.pause();
    try {
      const result = await window.sonora.resolve(
        item,
        boot?.settings.quality || "high",
      );
      if (gen !== playGeneration.current) return;
      setSource(result.source);
      setActualQuality(result.quality);
      setTrial(result.trial);
      const player = audio.current!;
      player.src = result.mediaUrl;
      player.volume = volume;
      await player.play();
      if (gen === playGeneration.current) setPlaying(true);
    } catch (e) {
      if (gen === playGeneration.current) {
        setSource("暂时无法播放");
        notify((e as Error).message, true);
      }
    } finally {
      if (gen === playGeneration.current) setAudioBusy(false);
    }
    window.sonora
      .lyrics(item)
      .then((v) => {
        if (gen === playGeneration.current) setLyric(v);
      })
      .catch(() => {});
  }
  function advance(direction = 1) {
    if (!current) return;
    const index = queue.findIndex((x) => x.key === current.key);
    let next =
      mode === "shuffle"
        ? Math.floor(Math.random() * queue.length)
        : (index + direction + queue.length) % queue.length;
    if (queue.length && queue[next]) playTrack(queue[next], queue);
  }
  const togglePlay = () => {
    if (!current) return;
    if (audio.current?.paused) {
      audio.current
        .play()
        .then(() => setPlaying(true))
        .catch((e) => notify(e.message, true));
    } else {
      audio.current?.pause();
      setPlaying(false);
    }
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
        target.isContentEditable
      )
        return;
      if (e.code === "Space" && current) {
        e.preventDefault();
        togglePlay();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        searchInput.current?.focus();
      }
      if (e.key === "Escape") {
        setLyricPreview(null);
        setShowQueue(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  async function download(items: Item[]) {
    try {
      const r = await window.sonora.download(items, boot!.settings.quality);
      setJobs(r.jobs);
      notify(
        r.added ? `已加入 ${r.added} 个下载任务` : "所选歌曲已在下载队列中",
      );
    } catch (e) {
      notify((e as Error).message, true);
    }
  }
  async function lyrics(item: Item, save = false) {
    if (save) {
      try {
        const file = await window.sonora.saveLyrics(item);
        if (file) notify("LRC 歌词已保存");
      } catch (e) {
        notify((e as Error).message, true);
      }
      return;
    }
    setLyricVersion("original");
    setLyricFormat("auto");
    setLyricPreview({ item });
    try {
      const data = await window.sonora.lyrics(item);
      setLyricPreview((prev) =>
        prev?.item.key === item.key ? { item, data } : prev,
      );
    } catch (e) {
      setLyricPreview((prev) =>
        prev?.item.key === item.key
          ? { item, error: (e as Error).message }
          : prev,
      );
    }
  }
  async function libraryAction(id: string, action: string) {
    if (action === "edit") {
      const item = boot?.library.find((i) => i.id === id);
      if (item) setTagItem(item);
      return;
    }
    try {
      const items = await window.sonora.libraryAction(id, action);
      if (
        currentRef.current?.id === id &&
        ["remove", "trash"].includes(action) &&
        !items.some((x) => x.id === id)
      ) {
        audio.current?.pause();
        setPlaying(false);
      }
      setBoot((b) => (b ? { ...b, library: items } : b));
    } catch (e) {
      notify((e as Error).message, true);
    }
  }
  async function importLibrary(scan = false) {
    setLibraryBusy(true);
    try {
      const result = scan
        ? await window.sonora.scanLibrary()
        : await window.sonora.importMusic();
      if (result) {
        setBoot((b) => (b ? { ...b, library: result.items } : b));
        notify(
          `已更新 ${result.imported} 首本地音乐${result.failures.length ? `，${result.failures.length} 个文件无法读取` : ""}`,
        );
      }
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setLibraryBusy(false);
    }
  }
  const localItems = useMemo(() => {
    let list = (boot?.library || []).filter(
      (x) =>
        (!favorites || x.favorite) &&
        `${x.title} ${x.artist} ${x.album}`
          .toLowerCase()
          .includes(libraryQuery.toLowerCase()),
    );
    return [...list].sort((a, b) =>
      librarySort === "title"
        ? a.title.localeCompare(b.title, "zh-CN")
        : (b.addedAt || 0) - (a.addedAt || 0),
    );
  }, [boot?.library, favorites, libraryQuery, librarySort]);
  const activeDownloads = (boot?.downloads || []).filter((x) =>
    ["queued", "resolving", "downloading", "tagging"].includes(x.status),
  ).length;
  const resultList = collection ? collectionItems.items : results.items;
  const cardGrid = (items: Item[], max?: number) => (
    <div className="card-grid">
      {items.slice(0, max).map((item) => (
        <button
          className="music-card"
          key={item.key}
          onClick={() => openCollection(item)}
        >
          <div className="card-art">
            <Artwork item={item} />
            <span className="card-play">
              <ArrowUpRight size={23} />
            </span>
            <PlatformBadge platform={item.platform} />
          </div>
          <strong title={item.title}>{item.title}</strong>
          <p>
            {item.artist ||
              (item.trackCount
                ? `${item.trackCount} 首歌曲`
                : item.kind === "artist"
                  ? "查看热门歌曲"
                  : "打开聆听")}
          </p>
        </button>
      ))}
    </div>
  );
  const errorNotice = (errors: Result["errors"]) =>
    errors.length > 0 && (
      <details className="error-notice">
        <summary>
          <AlertCircle size={15} />
          {new Set(errors.map((x) => x.platform)).size} 个平台的部分请求未完成
          <span>查看详情</span>
        </summary>
        <div>
          {[
            ...new Set(
              errors.map(
                (x) =>
                  `${platformNames[x.platform] || x.platform}：${x.message.replace(/^Error invoking remote method '[^']+': Error: /, "")}`,
              ),
            ),
          ].map((s) => (
            <p key={s}>{s}</p>
          ))}
        </div>
      </details>
    );
  const table = (items: Item[], isLocal = false) => (
    <TrackTable
      items={items}
      selected={selected}
      onSelect={setSelected}
      current={current?.key}
      onPlay={(item) => playTrack(item, items)}
      onDownload={download}
      onLyrics={lyrics}
      lyricOnly={page === "lyrics"}
      local={isLocal}
      onLocal={libraryAction}
    />
  );
  const batch = (items: Item[]) => (
    <div className="list-toolbar">
      <span>
        {selected.size
          ? `已选择 ${selected.size} 首`
          : `${items.length} 首歌曲`}
      </span>
      <div>
        {page !== "lyrics" && (
          <button
            className="button primary compact"
            disabled={!items.length}
            onClick={() => playTrack(items[0], items)}
          >
            <Play size={14} fill="currentColor" />
            播放本页
          </button>
        )}
        {!items.some((i) => i.platform === "local") && page !== "lyrics" && (
          <button
            className="button secondary compact"
            disabled={!items.length}
            onClick={() =>
              download(
                selected.size
                  ? items.filter((x) => selected.has(x.key))
                  : items,
              )
            }
          >
            <Download size={15} />
            {selected.size ? "下载所选" : "下载本页"}
          </button>
        )}
      </div>
    </div>
  );
  if (!boot)
    return (
      <div className="boot-screen">
        <div className="brand-mark">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        {fatal ? (
          <>
            <h2>暂时无法启动</h2>
            <p>{fatal}</p>
          </>
        ) : (
          <>
            <h2>声屿 Sonora</h2>
            <Loader2 size={20} className="spin" />
          </>
        )}
      </div>
    );
  return (
    <div className="app-shell">
      <audio
        ref={audio}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={() => setPosition(audio.current?.currentTime || 0)}
        onLoadedMetadata={() => {
          const d = audio.current?.duration || 0;
          setAudioDuration(Number.isFinite(d) ? d : 0);
          if (
            current &&
            current.platform !== "local" &&
            current.duration > 60 &&
            d > 0 &&
            d + 15 < current.duration
          )
            setTrial(true);
          if (resumeAt.current && audio.current) {
            audio.current.currentTime = Math.min(resumeAt.current, d || 0);
            resumeAt.current = 0;
          }
        }}
        onEnded={() => {
          if (mode === "one") {
            if (audio.current) {
              audio.current.currentTime = 0;
              audio.current.play().catch(() => {});
            }
          } else advance();
        }}
        onError={() => {
          setPlaying(false);
          if (current)
            notify("音频无法解码或链接已过期，可重新点击播放更换音源。", true);
        }}
      />
      <div className="window-titlebar">
        <span>SONORA — 声音，自有归处</span>
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
      <div className="app-body">
        <aside className="sidebar">
          <button className="brand" onClick={() => changePage("discover")}>
            <div className="brand-mark">
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
            <div>
              <strong>声屿</strong>
              <span>SONORA</span>
            </div>
          </button>
          <div className="nav-label">音乐空间</div>
          <nav>
            {navs.map(({ id, label, Icon }) => (
              <button
                key={id}
                className={page === id ? "active" : ""}
                onClick={() => changePage(id)}
              >
                <Icon size={19} strokeWidth={1.8} />
                <span>{label}</span>
                {id === "downloads" && activeDownloads > 0 && (
                  <em>{activeDownloads}</em>
                )}
              </button>
            ))}
          </nav>
          <div className="sidebar-separator" />
          <div className="nav-label">偏好设置</div>
          <nav>
            <button
              className={page === "accounts" ? "active" : ""}
              onClick={() => changePage("accounts")}
            >
              <UserRound size={19} />
              <span>平台账号</span>
              {boot.accounts.length > 0 && <span className="connection-dot" />}
            </button>
            <button
              className={page === "settings" ? "active" : ""}
              onClick={() => changePage("settings")}
            >
              <SlidersHorizontal size={19} />
              <span>偏好与音源</span>
            </button>
          </nav>
          <div className="sidebar-bottom">
            <div className="source-constellation">
              <span className="netease">云</span>
              <span className="qq">Q</span>
              <span className="kugou">酷</span>
              <span className="constellation-line" />
            </div>
            <strong>音乐，无需来回切换</strong>
            <p>三个世界，一处聆听。</p>
            <button onClick={() => changePage("accounts")}>
              {boot.accounts.length
                ? `${boot.accounts.length} 个账号已保存`
                : "连接你的账号"}
              <ArrowUpRight size={14} />
            </button>
          </div>
          <div className="sidebar-foot">
            SONORA DESKTOP <span>{boot?.version || "1.2.2"}</span>
          </div>
        </aside>
        <main className="workspace">
          <header className="topbar">
            <div className="breadcrumb">
              音乐空间 <ChevronRight size={13} />
              <strong>
                {collection
                  ? "资源详情"
                  : navs.find((x) => x.id === page)?.label ||
                    { accounts: "平台账号", settings: "偏好与音源" }[
                      page as "accounts" | "settings"
                    ]}
              </strong>
            </div>
            <form
              className="global-search"
              onSubmit={(e) => {
                e.preventDefault();
                doSearch();
              }}
            >
              <Search size={17} />
              <input
                ref={searchInput}
                aria-label="搜索音乐资源"
                placeholder={
                  page === "lyrics"
                    ? "输入歌名、歌手或歌词片段"
                    : "搜索歌曲、歌手、专辑或歌单"
                }
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="清空搜索"
                >
                  <X size={14} />
                </button>
              ) : (
                <kbd>Ctrl F</kbd>
              )}
            </form>
            <button
              className="account-button"
              onClick={() => changePage("accounts")}
              title="平台账号"
            >
              <UserRound size={18} />
              <span>{boot.accounts.length ? "我的账号" : "未登录"}</span>
            </button>
          </header>
          <div className="workspace-bottom">
            <div className="page-scroll">
              <div className="page-content">
                {collection ? (
                  <>
                    <button
                      className="text-button back-button"
                      onClick={() => {
                        setCollection(null);
                        setSelected(new Set());
                        collectionGeneration.current++;
                      }}
                    >
                      <ArrowLeft size={16} />
                      返回
                    </button>
                    <div className="collection-hero">
                      <Artwork item={collection} />
                      <div>
                        <PlatformBadge platform={collection.platform} />
                        <h1>{collection.title}</h1>
                        <p>
                          {collection.artist ||
                            {
                              artist: "热门歌曲",
                              album: "专辑曲目",
                              chart: "榜单曲目",
                              playlist: "歌单曲目",
                            }[collection.kind as "artist"]}
                        </p>
                      </div>
                    </div>
                    {collectionItems.items.some(
                      (x) => x.meta.searchDerived,
                    ) && (
                      <p className="result-note">
                        当前展示与歌手匹配的歌曲，可能包含合作曲目。
                      </p>
                    )}
                    {errorNotice(collectionItems.errors)}
                    {collectionBusy && collectionItems.items.length === 0 ? (
                      <Busy text="正在打开音乐资源" />
                    ) : collectionItems.items.length ? (
                      collectionItems.items[0].kind === "song" ? (
                        <>
                          {batch(collectionItems.items)}
                          {table(collectionItems.items)}
                        </>
                      ) : (
                        cardGrid(collectionItems.items)
                      )
                    ) : (
                      <Empty
                        heading="暂时没有可显示的内容"
                        description="可稍后重试，或在偏好与音源中更换接口。"
                      />
                    )}
                    {collectionItems.hasMore && (
                      <button
                        className="button secondary load-more"
                        disabled={collectionBusy}
                        onClick={() =>
                          collection.id === "account"
                            ? accountPlaylists(
                                collection.platform as Platform,
                                collectionPage + 1,
                              )
                            : openCollection(collection, collectionPage + 1)
                        }
                      >
                        {collectionBusy ? (
                          <Loader2 size={15} className="spin" />
                        ) : null}
                        加载更多
                      </button>
                    )}
                  </>
                ) : page === "discover" ? (
                  <>
                    <div className="page-heading discover-heading">
                      <div>
                        <div className="eyebrow">
                          A LITTLE SOUND, A LITTLE ESCAPE
                        </div>
                        <h1>此刻，听见喜欢。</h1>
                        <p>在不同的音乐世界里，遇见同一种心动。</p>
                      </div>
                      <button
                        className="icon-button refresh-discovery"
                        title="刷新推荐与榜单"
                        aria-label="刷新发现"
                        disabled={discoveryBusy}
                        onClick={fetchDiscovery}
                      >
                        <RefreshCw
                          size={19}
                          className={discoveryBusy ? "spin" : ""}
                        />
                      </button>
                    </div>
                    <div className="platform-pills">
                      {(["all", "netease", "qq", "kugou"] as const).map((p) => (
                        <button
                          className={platform === p ? "active" : ""}
                          onClick={() => setPlatform(p)}
                          key={p}
                        >
                          {p === "all" ? (
                            <span className="all-dot" />
                          ) : (
                            <i className={`platform-dot ${p}`} />
                          )}{" "}
                          {p === "all" ? "全部音源" : platformNames[p]}
                        </button>
                      ))}
                    </div>
                    <div className="discovery-hero">
                      <div className="hero-copy">
                        <span className="hero-label">
                          <span />
                          YOUR PERSONAL SOUND ISLAND
                        </span>
                        <h2>
                          喜欢的声音，
                          <br />
                          都在这一座岛。
                        </h2>
                        <p>跨越平台发现音乐，随时试听，悉心收藏。</p>
                        <button
                          onClick={() => {
                            changePage("search");
                            searchInput.current?.focus();
                          }}
                        >
                          开始探索
                          <ArrowUpRight size={16} />
                        </button>
                      </div>
                      <div className="hero-art" aria-hidden="true">
                        <div className="hero-disc">
                          <div className="disc-center">
                            <div className="brand-mark small">
                              <span />
                              <span />
                              <span />
                              <span />
                              <span />
                            </div>
                          </div>
                        </div>
                        <div className="floating-label label-one">
                          <Music2 size={14} />
                          让音乐自由流动
                        </div>
                        <div className="floating-label label-two">
                          <span className="tiny-bars">
                            <i />
                            <i />
                            <i />
                            <i />
                          </span>
                          ON YOUR OWN FREQUENCY
                        </div>
                        <div className="hero-spark s1">✧</div>
                        <div className="hero-spark s2">✦</div>
                      </div>
                    </div>
                    {errorNotice(discoveryErrors)}
                    <SectionHeading
                      label="为你发现"
                      description="来自各平台的公开推荐歌单"
                    />
                    {recommendations.length ? (
                      cardGrid(weave(recommendations), 12)
                    ) : discoveryBusy ? (
                      <div className="skeleton-grid">
                        {[0, 1, 2, 3, 4].map((n) => (
                          <div key={n} className="skeleton-card">
                            <i />
                            <span />
                            <span />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Empty
                        heading="推荐正在路上"
                        description="当前平台暂未返回推荐，搜索仍可独立使用。"
                        action={
                          <button
                            className="button secondary"
                            onClick={() => changePage("search")}
                          >
                            搜索音乐
                            <ArrowUpRight size={15} />
                          </button>
                        }
                      />
                    )}
                    <SectionHeading
                      label="正在流行"
                      description="从榜单里，听见当下"
                    />
                    {charts.length ? (
                      <div className="chart-grid">
                        {weave(charts)
                          .slice(0, 9)
                          .map((item, i) => (
                            <button
                              className="chart-card"
                              key={item.key}
                              onClick={() => openCollection(item)}
                            >
                              <Artwork item={item} />
                              <div>
                                <PlatformBadge platform={item.platform} />
                                <strong>{item.title}</strong>
                                <span>
                                  {item.trackCount
                                    ? `${item.trackCount} 首上榜歌曲`
                                    : "查看完整榜单"}
                                </span>
                              </div>
                              <ArrowUpRight size={18} />
                            </button>
                          ))}
                      </div>
                    ) : discoveryBusy ? (
                      <Busy text="正在获取各平台榜单" />
                    ) : (
                      <Empty
                        heading="暂未取得榜单"
                        description="可尝试其他平台，或在接口设置中查看连接情况。"
                      />
                    )}
                    <div className="page-footer">
                      仅供学习使用，请于下载后24小时自行删除。
                      <span>LISTEN. DISCOVER. KEEP WHAT MOVES YOU.</span>
                    </div>
                  </>
                ) : page === "search" || page === "lyrics" ? (
                  <>
                    <div className="page-heading">
                      <div>
                        <div className="eyebrow">
                          {page === "lyrics"
                            ? "WORDS BEHIND THE MUSIC"
                            : "SEARCH ACROSS YOUR MUSIC WORLD"}
                        </div>
                        <h1>
                          {page === "lyrics"
                            ? "寻找一句，刚好懂你的歌词。"
                            : "所有喜欢，一次找到。"}
                        </h1>
                        <p>
                          {page === "lyrics"
                            ? "单独搜索歌词资源，预览并保存为 LRC 文件。"
                            : "聚合搜索三个平台，或专注于你熟悉的音源。"}
                        </p>
                      </div>
                    </div>
                    <div className="search-control">
                      <div className="platform-pills">
                        {(["all", "netease", "qq", "kugou"] as const).map(
                          (p) => (
                            <button
                              className={platform === p ? "active" : ""}
                              key={p}
                              onClick={() => {
                                setPlatform(p);
                                if (query.trim())
                                  doSearch(
                                    query,
                                    kind,
                                    p,
                                    1,
                                    page === "lyrics",
                                  );
                              }}
                            >
                              {p !== "all" && (
                                <i className={`platform-dot ${p}`} />
                              )}{" "}
                              {p === "all" ? "聚合搜索" : platformNames[p]}
                            </button>
                          ),
                        )}
                      </div>
                      <button
                        className="button primary compact"
                        disabled={busy || !query.trim()}
                        onClick={() => doSearch()}
                      >
                        {busy ? (
                          <Loader2 size={15} className="spin" />
                        ) : (
                          <Search size={15} />
                        )}
                        搜索
                      </button>
                    </div>
                    {page === "search" && (
                      <div className="tabs search-tabs">
                        {kinds.map((k) => (
                          <button
                            key={k.id}
                            className={kind === k.id ? "active" : ""}
                            onClick={() => {
                              setKind(k.id);
                              if (query.trim()) doSearch(query, k.id);
                              else
                                setResults({
                                  items: [],
                                  errors: [],
                                  hasMore: false,
                                });
                            }}
                          >
                            {k.name}
                          </button>
                        ))}
                      </div>
                    )}
                    {results.items.some((x) => x.meta.searchDerived) && (
                      <p className="result-note">
                        QQ
                        部分结果来自歌曲关联，列表可能不完整；登录后可使用完整搜索。
                      </p>
                    )}
                    {errorNotice(results.errors)}
                    {busy && results.items.length === 0 ? (
                      <Busy
                        text={
                          page === "lyrics"
                            ? "正在检索歌词资源"
                            : "正在搜索各平台音乐"
                        }
                      />
                    ) : results.items.length ? (
                      <>
                        {page === "lyrics" || kind === "song" ? (
                          <>
                            {batch(results.items)}
                            {table(results.items)}
                          </>
                        ) : (
                          cardGrid(results.items)
                        )}
                        {results.hasMore && (
                          <button
                            className="button secondary load-more"
                            disabled={busy}
                            onClick={() =>
                              doSearch(query, kind, platform, searchPage + 1)
                            }
                          >
                            {busy && <Loader2 size={15} className="spin" />}
                            加载更多结果
                          </button>
                        )}
                      </>
                    ) : (
                      <Empty
                        icon={
                          page === "lyrics" ? (
                            <FileText size={28} />
                          ) : (
                            <Search size={28} />
                          )
                        }
                        heading={query ? "试试换一个关键词" : "从一个名字开始"}
                        description={
                          page === "lyrics"
                            ? "在顶部输入歌名、歌手或歌词片段，再点击搜索。"
                            : "在顶部输入你想听的歌曲、歌手、专辑或歌单名称。"
                        }
                        action={
                          !query && (
                            <div className="suggested-searches">
                              {["海阔天空", "陈粒", "钢琴"].map((s) => (
                                <button
                                  key={s}
                                  onClick={() => {
                                    setQuery(s);
                                    doSearch(s);
                                  }}
                                >
                                  {s}
                                  <ArrowUpRight size={12} />
                                </button>
                              ))}
                            </div>
                          )
                        }
                      />
                    )}
                  </>
                ) : page === "library" ? (
                  <>
                    <div className="page-heading">
                      <div>
                        <div className="eyebrow">
                          A COLLECTION THAT IS TRULY YOURS
                        </div>
                        <h1>
                          我的本地音乐{" "}
                          <span className="heading-count">
                            {boot.library.length}
                          </span>
                        </h1>
                        <p>把散落的旋律，整理成自己的收藏。</p>
                      </div>
                      <div className="inline-actions">
                        <button
                          className="button secondary"
                          disabled={libraryBusy}
                          onClick={() => importLibrary(true)}
                        >
                          <FolderOpen size={16} />
                          扫描文件夹
                        </button>
                        <button
                          className="button primary"
                          disabled={libraryBusy}
                          onClick={() => importLibrary()}
                        >
                          <Plus size={16} />
                          导入音乐
                        </button>
                      </div>
                    </div>
                    <div className="library-summary">
                      <div>
                        <Music2 size={20} />
                        <strong>{boot.library.length}</strong>
                        <span>本地歌曲</span>
                      </div>
                      <div>
                        <Heart size={20} />
                        <strong>
                          {boot.library.filter((x) => x.favorite).length}
                        </strong>
                        <span>我的收藏</span>
                      </div>
                      <div>
                        <Disc3 size={20} />
                        <strong>
                          {bytes(
                            boot.library.reduce(
                              (n, x) => n + (x.bytes || 0),
                              0,
                            ),
                          )}
                        </strong>
                        <span>音乐占用空间</span>
                      </div>
                    </div>
                    <div className="library-toolbar">
                      <div className="tabs">
                        <button
                          className={!favorites ? "active" : ""}
                          onClick={() => setFavorites(false)}
                        >
                          全部音乐
                        </button>
                        <button
                          className={favorites ? "active" : ""}
                          onClick={() => setFavorites(true)}
                        >
                          我的收藏
                        </button>
                      </div>
                      <div>
                        <div className="small-search">
                          <Search size={15} />
                          <input
                            aria-label="筛选本地音乐"
                            placeholder="筛选本地音乐"
                            value={libraryQuery}
                            onChange={(e) => setLibraryQuery(e.target.value)}
                          />
                        </div>
                        <select
                          value={librarySort}
                          onChange={(e) => setLibrarySort(e.target.value)}
                        >
                          <option value="recent">最近添加</option>
                          <option value="title">名称排序</option>
                        </select>
                      </div>
                    </div>
                    {libraryBusy ? (
                      <Busy text="正在读取音频元数据，请稍候" />
                    ) : localItems.length ? (
                      <>
                        {batch(localItems)}
                        {table(localItems, true)}
                      </>
                    ) : (
                      <Empty
                        icon={<FolderHeart size={28} />}
                        heading="给喜欢的音乐，一个家"
                        description="导入 MP3、FLAC、M4A 等音频，或扫描你的音乐文件夹。下载完成的音乐也会自动出现在这里。"
                        action={
                          <button
                            className="button primary"
                            onClick={() => importLibrary()}
                          >
                            <Plus size={16} />
                            导入第一首音乐
                          </button>
                        }
                      />
                    )}
                  </>
                ) : page === "downloads" ? (
                  <DownloadView
                    jobs={boot.downloads}
                    onChange={setJobs}
                    notify={notify}
                  />
                ) : page === "accounts" ? (
                  <Accounts
                    accounts={boot.accounts}
                    onAccounts={setAccounts}
                    onPlaylists={accountPlaylists}
                    notify={notify}
                  />
                ) : (
                  <Settings
                    settings={boot.settings}
                    onSettings={setSettings}
                    onProviders={setProviders}
                    notify={notify}
                  />
                )}
              </div>
            </div>
            {current && showPlayer && (
              <aside className="now-playing">
                <div className="now-heading">
                  <strong>{showQueue ? "播放队列" : "正在聆听"}</strong>
                  <div>
                    <button
                      className={`icon-button ${showQueue ? "accent" : ""}`}
                      aria-label="切换播放队列"
                      onClick={() => setShowQueue(!showQueue)}
                    >
                      <ListMusic size={17} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label="收起正在播放面板"
                      onClick={() => setShowPlayer(false)}
                    >
                      <PanelRightClose size={16} />
                    </button>
                  </div>
                </div>
                {showQueue ? (
                  <div className="queue-list">
                    <p>{queue.length} 首歌曲</p>
                    {queue.map((item, i) => (
                      <button
                        className={item.key === current.key ? "active" : ""}
                        key={item.key}
                        onClick={() => playTrack(item, queue)}
                      >
                        <span>{i + 1}</span>
                        <div>
                          <strong>{item.title}</strong>
                          <small>{item.artist}</small>
                        </div>
                        {item.key === current.key && <Music2 size={15} />}
                      </button>
                    ))}
                  </div>
                ) : (
                  <>
                    <Artwork
                      key={current.key}
                      item={current}
                      className="now-cover"
                    />
                    <div className="now-meta">
                      <PlatformBadge platform={current.platform} />
                      <h2>{current.title}</h2>
                      <p>{current.artist || "未知歌手"}</p>
                    </div>
                    <LrcPanel
                      lyric={lyric}
                      position={position}
                      onSeek={(t) => {
                        if (audio.current) audio.current.currentTime = t;
                      }}
                    />
                    <div className="now-source">
                      <span className="live-dot" />
                      <span title={source}>{source}</span>
                      {trial && <em>试听片段</em>}
                    </div>
                  </>
                )}
              </aside>
            )}
          </div>
        </main>
      </div>
      <footer className="player">
        <div className="player-track">
          {current ? (
            <>
              <Artwork key={current.key} item={current} size="small" />
              <div>
                <strong title={current.title}>{current.title}</strong>
                <span>{current.artist || "未知歌手"}</span>
              </div>
              {current.platform !== "local" && (
                <button
                  className="icon-button"
                  title="下载当前歌曲"
                  aria-label="下载当前歌曲"
                  onClick={() => download([current])}
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
        <div className="player-center">
          <div className="play-controls">
            <button
              className={`icon-button mode-button ${mode !== "loop" ? "accent" : ""}`}
              aria-label="切换播放模式"
              title={
                mode === "loop"
                  ? "列表循环"
                  : mode === "shuffle"
                    ? "随机播放"
                    : "单曲循环"
              }
              onClick={() =>
                setMode((m) =>
                  m === "loop" ? "shuffle" : m === "shuffle" ? "one" : "loop",
                )
              }
            >
              {mode === "shuffle" ? (
                <Shuffle size={16} />
              ) : mode === "one" ? (
                <Repeat1 size={17} />
              ) : (
                <Repeat size={17} />
              )}
            </button>
            <button
              className="icon-button"
              aria-label="上一首"
              disabled={!current}
              onClick={() => {
                if (position > 3 && audio.current)
                  audio.current.currentTime = 0;
                else advance(-1);
              }}
            >
              <SkipBack size={19} fill="currentColor" />
            </button>
            <button
              className="play-main"
              aria-label={playing ? "暂停" : "播放"}
              disabled={!current || audioBusy}
              onClick={togglePlay}
            >
              {audioBusy ? (
                <Loader2 size={22} className="spin" />
              ) : playing ? (
                <Pause size={20} fill="currentColor" />
              ) : (
                <Play size={21} fill="currentColor" />
              )}
            </button>
            <button
              className="icon-button"
              aria-label="下一首"
              disabled={!current}
              onClick={() => advance()}
            >
              <SkipForward size={19} fill="currentColor" />
            </button>
            <button
              className="icon-button"
              title="歌词与播放面板"
              aria-label="显示歌词面板"
              onClick={() => {
                setShowPlayer(!showPlayer);
                setShowQueue(false);
              }}
            >
              <FileText size={17} />
            </button>
          </div>
          <div className="timeline">
            <span>{duration(position)}</span>
            <input
              type="range"
              aria-label="播放进度"
              min="0"
              max={audioDuration || 1}
              step="0.1"
              value={Math.min(position, audioDuration || 1)}
              disabled={!current || !audioDuration}
              style={
                {
                  "--progress": `${audioDuration ? (position / audioDuration) * 100 : 0}%`,
                } as React.CSSProperties
              }
              onChange={(e) => {
                if (audio.current) {
                  audio.current.currentTime = Number(e.target.value);
                  setPosition(Number(e.target.value));
                }
              }}
            />
            <span>{duration(audioDuration || current?.duration || 0)}</span>
          </div>
        </div>
        <div className="player-right">
          <select
            aria-label="期望音质"
            title={`期望音质；当前：${actualQuality || "未播放"}`}
            value={boot.settings.quality}
            onChange={async (e) => {
              const quality = e.target.value as Quality;
              const s = await window.sonora.saveSettings({ quality });
              setSettings(s);
              if (current && current.platform !== "local")
                notify("音质已更新，下次播放或下载时生效");
            }}
          >
            {Object.entries(qualityNames).map(([v, n]) => (
              <option key={v} value={v}>
                {n}
              </option>
            ))}
          </select>
          <button
            className="icon-button volume-button"
            aria-label={volume ? "静音" : "取消静音"}
            onClick={() => {
              const v = volume ? 0 : 0.7;
              setVolume(v);
              if (audio.current) audio.current.volume = v;
            }}
          >
            {volume ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
          <input
            aria-label="音量"
            className="volume-slider"
            type="range"
            min="0"
            max="1"
            step=".01"
            value={volume}
            style={{ "--progress": `${volume * 100}%` } as React.CSSProperties}
            onChange={(e) => {
              setVolume(Number(e.target.value));
              if (audio.current) audio.current.volume = Number(e.target.value);
            }}
          />
          <button
            className="icon-button queue-button"
            aria-label="打开播放队列"
            onClick={() => {
              setShowPlayer(true);
              setShowQueue(!showQueue);
            }}
          >
            <ListMusic size={20} />
          </button>
        </div>
      </footer>
      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <div className={`toast ${t.error ? "error" : ""}`} key={t.id}>
            {t.error ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
            <span>{t.text}</span>
            <button
              aria-label="关闭提示"
              onClick={() => setToasts((x) => x.filter((v) => v.id !== t.id))}
            >
              <X size={15} />
            </button>
          </div>
        ))}
      </div>
      {lyricPreview && (
        <Modal
          title="歌词预览"
          subtitle={`${lyricPreview.item.title} · ${lyricPreview.item.artist}`}
          onClose={() => setLyricPreview(null)}
          wide
        >
          {lyricPreview.error ? (
            <Empty heading="未取得歌词" description={lyricPreview.error} />
          ) : !lyricPreview.data ? (
            <Busy text="正在读取歌词" />
          ) : (
            <>
              <div className="tabs">
                <button
                  className={lyricVersion === "original" ? "active" : ""}
                  onClick={() => setLyricVersion("original")}
                >
                  原文
                </button>
                {lyricPreview.data.translation && (
                  <button
                    className={lyricVersion === "translation" ? "active" : ""}
                    onClick={() => setLyricVersion("translation")}
                  >
                    翻译
                  </button>
                )}
                {lyricPreview.data.romanization && (
                  <button
                    className={lyricVersion === "romanization" ? "active" : ""}
                    onClick={() => setLyricVersion("romanization")}
                  >
                    罗马音
                  </button>
                )}
              </div>
              <pre className="lyric-preview">
                {String(lyricPreview.data[lyricVersion as keyof Lyrics] || "")}
              </pre>
              <p className="subtle">
                {lyricPreview.data.source} ·{" "}
                {lyricPreview.data.hasWordTiming ? "真实逐字时间" : "逐行时间"}
              </p>
              <div className="inline-actions">
                <select
                  aria-label="歌词导出格式"
                  value={lyricFormat}
                  onChange={(e) => setLyricFormat(e.target.value)}
                  disabled={lyricVersion !== "original"}
                >
                  <option value="auto">自动（优先逐字 LRC）</option>
                  <option value="lrc">逐行 LRC</option>
                  <option
                    value="elrc"
                    disabled={!lyricPreview.data.hasWordTiming}
                  >
                    逐字 LRC（增强格式）
                  </option>
                  <option value="ttml">TTML</option>
                </select>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={lyricBilingual}
                    onChange={(e) => setLyricBilingual(e.target.checked)}
                    disabled={
                      lyricVersion !== "original" ||
                      !lyricPreview.data.translation
                    }
                  />
                  原文与翻译使用相同时间戳
                </label>
              </div>
              <div className="modal-footer">
                <PlatformBadge platform={lyricPreview.item.platform} />
                <button
                  className="button primary"
                  onClick={async () => {
                    try {
                      const p = await window.sonora.saveLyrics(
                        lyricPreview.item,
                        {
                          format: lyricFormat,
                          bilingual: lyricBilingual,
                          kind: lyricVersion,
                        },
                      );
                      if (p) notify("歌词已保存");
                    } catch (e) {
                      notify((e as Error).message, true);
                    }
                  }}
                >
                  <Download size={16} />
                  保存歌词
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
      {tagItem && (
        <TagEditor
          key={tagItem.id}
          item={tagItem}
          onClose={() => setTagItem(null)}
          notify={notify}
          beforeSave={async () => {
            if (
              currentRef.current?.id === tagItem.id &&
              currentRef.current?.platform === "local"
            ) {
              playGeneration.current++;
              audio.current?.pause();
              audio.current?.removeAttribute("src");
              audio.current?.load();
              setPlaying(false);
              await new Promise<void>((resolve) => {
                const player = audio.current;
                if (
                  !player ||
                  player.networkState === HTMLMediaElement.NETWORK_EMPTY
                )
                  return resolve();
                const finish = () => {
                  player.removeEventListener("emptied", finish);
                  resolve();
                };
                player.addEventListener("emptied", finish, { once: true });
                setTimeout(finish, 200);
              });
            }
          }}
          afterSave={async () => {
            const current = currentRef.current;
            if (current?.id !== tagItem.id || current.platform !== "local")
              return;
            try {
              const resolved = await window.sonora.resolve(
                current,
                boot?.settings.quality || "high",
              );
              if (currentRef.current?.id === current.id && audio.current)
                audio.current.src = resolved.mediaUrl;
            } catch (e) {
              notify((e as Error).message, true);
            }
          }}
          onSaved={(result) => {
            setBoot((b) => (b ? { ...b, library: result.items } : b));
            const next = result.editor.item;
            setTagItem(next);
            setQueue((q) =>
              q.map((i) =>
                i.id === next.id && i.platform === "local" ? next : i,
              ),
            );
            if (
              currentRef.current?.id === next.id &&
              currentRef.current?.platform === "local"
            ) {
              currentRef.current = next;
              setCurrent(next);
              window.sonora
                .lyrics(next)
                .then(setLyric)
                .catch(() => {});
            }
          }}
        />
      )}
      {welcome && (
        <Modal
          title="欢迎来到声屿"
          subtitle="三个音乐世界，一处安静的聆听空间。"
          onClose={() => {
            window.sonora.saveSettings({ acceptedDisclaimer: true });
            setWelcome(false);
          }}
        >
          <div className="welcome-art">
            <div className="brand-mark">
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
            <span>SONORA</span>
          </div>
          <p className="disclaimer-text">
            仅供学习使用，请于下载后24小时自行删除。
          </p>
          <p className="welcome-detail">
            应用不会自动删除文件。你可以随时在本地音乐中整理收藏，在偏好与音源中更换接口。
          </p>
          <button
            className="button primary full"
            onClick={() => {
              window.sonora.saveSettings({ acceptedDisclaimer: true });
              setWelcome(false);
            }}
          >
            开始探索
            <ArrowUpRight size={17} />
          </button>
        </Modal>
      )}
    </div>
  );
}
function LrcPanel({
  lyric,
  position,
  onSeek,
}: {
  lyric: Lyrics | null;
  position: number;
  onSeek: (t: number) => void;
}) {
  const lines = useMemo(
    () => parseLyrics(lyric?.original || ""),
    [lyric?.original],
  );
  const active = lines.findLastIndex((x) => x.time <= position);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const target = container.current?.querySelector<HTMLElement>(
      '[data-active="true"]',
    );
    if (target && container.current)
      container.current.scrollTo({
        top:
          target.offsetTop -
          container.current.offsetTop -
          container.current.clientHeight / 2 +
          target.clientHeight / 2,
        behavior: "smooth",
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
            onClick={() => onSeek(l.time)}
          >
            {l.text || "♪"}
          </button>
        ))
      ) : (
        <div className="no-lyrics">
          <Music2 size={22} />
          <p>{lyric?.original ? lyric.original : "旋律已经足够动人"}</p>
          <span>暂无同步歌词</span>
        </div>
      )}
    </div>
  );
}
