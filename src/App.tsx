import MotionPresence from "./layout/MotionPresence";
import PlayerDock from "./layout/PlayerDock";
import ListeningPanel from "./layout/ListeningPanel";
import { AmbientBackdrop, WindowChrome, type Page } from "./layout/AppChrome";
import StudioHeader from "./layout/StudioHeader";
import DiscoveryDesk from "./layout/DiscoveryDesk";
import WorkspaceTools from "./WorkspaceTools";
import { groupSongs } from "./song-groups";
import { usePlaybackShortcuts } from "./usePlaybackShortcuts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  Music2,
  Download,
  FolderHeart,
  FileText,
  ArrowUpRight,
  ArrowLeft,
  Play,
  Plus,
  FolderOpen,
  AlertCircle,
  X,
  Loader2,
  RefreshCw,
  Disc3,
  Heart,
  CheckCircle2,
  Trash2,
  ListMinus,
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
  CollectionResult,
} from "./types";
import {
  Artwork,
  PlatformBadge,
  platformNames,
  qualityNames,
  bytes,
  Empty,
  Busy,
  Modal,
} from "./ui";
import Accounts from "./Accounts";
import Settings from "./Settings";
import TrackTable from "./TrackTable";
import DownloadView from "./DownloadView";
import TagEditor from "./TagEditor";
type SearchKind = "song" | "artist" | "album" | "playlist";
const kinds: { id: SearchKind; name: string }[] = [
  { id: "song", name: "歌曲" },
  { id: "artist", name: "歌手" },
  { id: "album", name: "专辑" },
  { id: "playlist", name: "歌单" },
];
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
  const [refreshBusy, setRefreshBusy] = useState(false),
    [localActionBusy, setLocalActionBusy] = useState(false);
  const refreshPending = useRef<Promise<void> | null>(null);
  const [welcome, setWelcome] = useState(false),
    [toasts, setToasts] = useState<
      { id: number; text: string; error: boolean }[]
    >([]);
  const [toolsTab, setToolsTab] = useState(""),
    [mergeSongs, setMergeSongs] = useState(false);
  const [tagItem, setTagItem] = useState<Item | null>(null);
  const pageScroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    pageScroll.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [page, collection?.key, collection?.id]);
  const audio = useRef<HTMLAudioElement>(null),
    searchInput = useRef<HTMLInputElement>(null),
    playGeneration = useRef(0),
    searchGeneration = useRef(0),
    lastSearch = useRef(""),
    discoveryGeneration = useRef(0),
    collectionGeneration = useRef(0),
    resumeAt = useRef(0),
    currentRef = useRef<Item | null>(null);
  const volumeRef = useRef(volume),
    playableRef = useRef("");
  volumeRef.current = volume;
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
  const applyCollection = useCallback((result: CollectionResult) => {
    setBoot((b) =>
      b ? { ...b, library: result.items, downloads: result.jobs } : b,
    );
    const local = currentRef.current;
    if (
      local?.platform === "local" &&
      !result.items.some((x) => x.id === local.id)
    ) {
      playGeneration.current++;
      audio.current?.pause();
      audio.current?.removeAttribute("src");
      audio.current?.load();
      setSource("");
      setCurrent(null);
      setPlaying(false);
      setLyric(null);
    }
  }, []);
  const refreshCollections = useCallback(
    (silent = false) => {
      if (refreshPending.current) return refreshPending.current;
      setRefreshBusy(true);
      const work = window.sonora
        .refreshFiles()
        .then((result) => {
          applyCollection(result);
          if (!silent)
            notify(
              `列表已刷新${result.removed ? `，已清理 ${result.removed} 条失效音乐记录` : ""}${result.failures.length ? `，${result.failures.length} 个文件暂时无法读取` : ""}`,
            );
        })
        .catch((e) => notify(e.message, true))
        .finally(() => {
          refreshPending.current = null;
          setRefreshBusy(false);
        });
      refreshPending.current = work;
      return work;
    },
    [applyCollection, notify],
  );
  const playbackSnapshot = useRef<Record<string, unknown>>({});
  playbackSnapshot.current = {
    queue,
    current: current?.key,
    position,
    volume,
    mode,
  };
  const saveQueue = () =>
    window.sonora
      .workspace("queueSave", playbackSnapshot.current)
      .catch((e) => notify(e.message, true));
  useEffect(() => {
    const timer = setInterval(() => {
      if (playbackSnapshot.current.current) void saveQueue();
    }, 5000);
    const persist = () => {
      void saveQueue();
    };
    window.addEventListener("beforeunload", persist);
    return () => {
      clearInterval(timer);
      window.removeEventListener("beforeunload", persist);
    };
  }, []);
  const bootReady = !!boot;
  useEffect(() => {
    if (bootReady && ["library", "downloads"].includes(page))
      void refreshCollections(true);
  }, [page, bootReady, refreshCollections]);
  useEffect(() => {
    if (page !== "library") return;
    const valid = new Set(boot?.library.map((item) => item.key));
    setSelected((old) => {
      const next = new Set([...old].filter((key) => valid.has(key)));
      return next.size === old.size ? old : next;
    });
  }, [page, boot?.library]);
  useEffect(() => {
    window.sonora
      .bootstrap()
      .then((b) => {
        setBoot(b);
        window.sonora
          .workspace("queueLoad")
          .then((saved) => {
            if (!saved) return;
            const restored = saved.queue.filter(
              (x: Item) =>
                x.platform !== "local" || b.library.some((i) => i.id === x.id),
            );
            setQueue(restored);
            const item = restored.find((x: Item) => x.key === saved.current);
            if (item) {
              setCurrent(item);
              currentRef.current = item;
              setPosition(saved.position || 0);
              resumeAt.current = saved.position || 0;
              setSource("上次聆听 · 点击播放继续");
            }
            setVolume(saved.volume ?? 0.7);
            setMode(saved.mode || "loop");
          })
          .catch(() => {});
        setWelcome(!b.acceptedDisclaimer);
        if (b.configWarning) notify(b.configWarning, true);
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
  useEffect(() => {
    document.documentElement.dataset.effects =
      boot?.settings.visualEffects || "full";
  }, [boot?.settings.visualEffects]);
  useEffect(() => {
    document.documentElement.dataset.motion =
      boot?.settings.motionEffects || "system";
  }, [boot?.settings.motionEffects]);
  const setAccounts = (accounts: Account[]) =>
    setBoot((b) => (b ? { ...b, accounts } : b));
  const setSettings = (settings: SettingsType) =>
    setBoot((b) => (b ? { ...b, settings } : b));
  const setProviders = (providers: Provider[]) =>
    setBoot((b) => (b ? { ...b, providers } : b));
  const setJobs = (downloads: Job[]) =>
    setBoot((b) => (b ? { ...b, downloads } : b));
  const changePage = (p: Page) => {
    searchGeneration.current++;
    collectionGeneration.current++;
    setBusy(false);
    setCollectionBusy(false);
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
    if (next === 1) setCollectionPage(1);
    setSelected(new Set());
    if (next === 1)
      setCollectionItems({ items: [], errors: [], hasMore: false });
    try {
      const r = await window.sonora.collection(item, next);
      if (gen === collectionGeneration.current) {
        setCollectionPage(next);
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
      }
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
    if (next === 1) changePage("accounts");
    const gen = ++collectionGeneration.current;
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
    if (next === 1) {
      setCollectionPage(1);
      setCollectionItems({ items: [], errors: [], hasMore: false });
    }
    try {
      const result = await window.sonora.accountPlaylists(p, next);
      if (gen === collectionGeneration.current) {
        setCollectionPage(next);
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
      }
    } catch (e) {
      if (gen === collectionGeneration.current)
        setCollectionItems((previous) => ({
          ...previous,
          errors: [{ platform: p, message: (e as Error).message }],
        }));
    } finally {
      if (gen === collectionGeneration.current) setCollectionBusy(false);
    }
  }
  async function playTrack(
    item: Item,
    items: Item[] = queue,
    seek = 0,
    tier?: Quality,
  ) {
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
    playableRef.current = "";
    audio.current?.removeAttribute("src");
    audio.current?.load();
    try {
      const result = await window.sonora.resolve(
        item,
        tier ||
          boot?.settings.qualityPreferences?.[item.platform as Platform] ||
          boot?.settings.quality ||
          "high",
      );
      if (gen !== playGeneration.current) return;
      setSource(result.source);
      setActualQuality(result.quality);
      setTrial(result.trial);
      const player = audio.current!;
      player.src = result.mediaUrl;
      playableRef.current = item.key;
      player.volume = volumeRef.current;
      window.sonora
        .probeAudio(result.mediaUrl)
        .then((info) => {
          if (gen === playGeneration.current)
            setActualQuality("实测 " + info.label);
        })
        .catch(() => {});
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
    if (audioBusy) return;
    if (playableRef.current !== current.key) {
      void playTrack(current, queue, position);
      return;
    }
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
  usePlaybackShortcuts({
    enabled: !!current && !audioBusy,
    onToggle: togglePlay,
    onSearch: () => searchInput.current?.focus(),
    onEscape: () => {
      setLyricPreview(null);
      setShowQueue(false);
    },
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
  async function libraryBatch(items: Item[], action: string) {
    setLocalActionBusy(true);
    try {
      const result = await window.sonora.collectionBatch(
        "library",
        items.map((x) => x.id),
        action,
      );
      applyCollection(result);
      if (!result.cancelled)
        notify(
          `已处理 ${result.changed} 首${result.failures.length ? `，${result.failures.length} 首失败：${result.failures[0].message}` : ""}`,
          !!result.failures.length,
        );
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setLocalActionBusy(false);
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
    ["queued", "resolving", "downloading", "tagging", "committing"].includes(
      x.status,
    ),
  ).length;
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
        {items.some((x) => selected.has(x.key))
          ? `已选择 ${items.filter((x) => selected.has(x.key)).length} 首`
          : `${items.length} 首歌曲`}
      </span>
      <div>
        {page === "library" && items.some((x) => selected.has(x.key)) && (
          <>
            <button
              className="button secondary compact"
              disabled={localActionBusy || refreshBusy}
              onClick={() =>
                libraryBatch(
                  items.filter((x) => selected.has(x.key)),
                  "remove",
                )
              }
            >
              <ListMinus size={15} />
              移除所选记录
            </button>
            <button
              className="button secondary compact danger"
              disabled={localActionBusy || refreshBusy}
              onClick={() =>
                libraryBatch(
                  items.filter((x) => selected.has(x.key)),
                  "trash",
                )
              }
            >
              <Trash2 size={15} />
              所选移入回收站
            </button>
          </>
        )}
        {page !== "lyrics" && (
          <button
            className="button primary compact"
            disabled={!items.length}
            onClick={() => {
              const play =
                page === "library" && items.some((x) => selected.has(x.key))
                  ? items.filter((x) => selected.has(x.key))
                  : items;
              playTrack(play[0], play);
            }}
          >
            <Play size={14} fill="currentColor" />
            {page === "library" && items.some((x) => selected.has(x.key))
              ? "播放所选"
              : "播放本页"}
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
    <div
      data-page={page}
      data-inspector={current && showPlayer ? "open" : "closed"}
      data-playing={playing ? "true" : "false"}
      className={`app-shell ${boot.settings.density === "compact" ? "compact-density" : ""}`}
    >
      <AmbientBackdrop item={current} />
      {toolsTab && (
        <WorkspaceTools
          items={boot?.library || []}
          selected={(boot?.library || [])
            .filter((x) => selected.has(x.key))
            .map((x) => x.id)}
          initial={toolsTab}
          collection={collectionItems.items}
          onPlayList={(items) => {
            void playTrack(items[0], items);
          }}
          onNavigate={(next) => changePage(next as Page)}
          notify={notify}
          onClose={() => setToolsTab("")}
        />
      )}
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
      <WindowChrome />
      <div className="app-body">
        <main className="workspace">
          <StudioHeader
            page={page}
            onPage={changePage}
            query={query}
            onQuery={setQuery}
            onSearch={() => {
              void doSearch();
            }}
            inputRef={searchInput}
            theme={boot.settings.theme}
            activeDownloads={activeDownloads}
            onTheme={() => {
              window.sonora
                .saveSettings({
                  theme:
                    document.documentElement.dataset.theme === "dark"
                      ? "light"
                      : "dark",
                })
                .then(setSettings)
                .catch((e) => notify(e.message, true));
            }}
          />
          <div className="workspace-bottom">
            <div ref={pageScroll} className="page-scroll">
              <div
                key={collection?.key || collection?.id || page}
                className="page-content"
              >
                {collection ? (
                  <>
                    <button
                      className="text-button back-button"
                      onClick={() => {
                        setCollection(null);
                        setSelected(new Set());
                        collectionGeneration.current++;
                        setCollectionBusy(false);
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
                  <DiscoveryDesk
                    recommendations={recommendations}
                    charts={charts}
                    platform={platform}
                    onPlatform={setPlatform}
                    onOpen={(item) => {
                      void openCollection(item);
                    }}
                    onPage={changePage}
                    onRefresh={fetchDiscovery}
                    busy={discoveryBusy}
                    libraryCount={boot.library.length}
                    notice={errorNotice(discoveryErrors)}
                  />
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
                          {page === "lyrics" ? "歌词工作室" : "找到下一首喜欢"}
                        </h1>
                        <p>
                          {page === "lyrics"
                            ? "搜索、预览并导出逐行或逐字歌词。"
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
                            <label className="checkbox-label">
                              <input
                                type="checkbox"
                                checked={mergeSongs}
                                onChange={(e) =>
                                  setMergeSongs(e.target.checked)
                                }
                              />
                              合并同曲候选（保留版本区别）
                            </label>
                            {table(
                              mergeSongs
                                ? groupSongs(results.items)
                                : results.items,
                            )}
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
                          disabled={
                            refreshBusy || libraryBusy || localActionBusy
                          }
                          onClick={() => refreshCollections()}
                          aria-label="刷新本地音乐"
                        >
                          <RefreshCw
                            size={16}
                            className={refreshBusy ? "spin" : ""}
                          />
                          刷新
                        </button>
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
                    <div className="inline-actions library-tools">
                      <button
                        className="button secondary"
                        onClick={() => setToolsTab("batch")}
                      >
                        批量标签与整理工具
                      </button>
                      <button
                        className="text-button"
                        onClick={() => setToolsTab("missing")}
                      >
                        缺失文件
                      </button>
                      <button
                        className="text-button"
                        onClick={() => setToolsTab("lists")}
                      >
                        导入 / 导出列表
                      </button>
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
                    onCollection={applyCollection}
                    onRefresh={() => refreshCollections()}
                    refreshing={refreshBusy}
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
                    version={boot.version}
                    onTools={setToolsTab}
                    onSettings={setSettings}
                    onProviders={setProviders}
                    notify={notify}
                  />
                )}
              </div>
            </div>
            {current && (
              <MotionPresence visible={showPlayer}>
                <ListeningPanel
                  current={current}
                  queue={queue}
                  showQueue={showQueue}
                  lyric={lyric}
                  position={position}
                  source={source}
                  trial={trial}
                  actualQuality={actualQuality}
                  requestedQuality={
                    current.platform === "local"
                      ? "本地文件"
                      : qualityNames[
                          boot.settings.qualityPreferences?.[
                            current.platform
                          ] || boot.settings.quality
                        ]
                  }
                  onClose={() => setShowPlayer(false)}
                  onToggleQueue={() => setShowQueue(!showQueue)}
                  onQueue={setQueue}
                  onPlay={(item) => {
                    void playTrack(item, queue);
                  }}
                  onSave={() => {
                    void saveQueue().then(() => notify("队列已保存"));
                  }}
                  onSeek={(time) => {
                    if (audio.current) audio.current.currentTime = time;
                  }}
                />
              </MotionPresence>
            )}
          </div>
        </main>
      </div>
      <PlayerDock
        current={current}
        playing={playing}
        busy={audioBusy}
        position={position}
        audioDuration={audioDuration}
        volume={volume}
        mode={mode}
        quality={
          current && current.platform !== "local"
            ? boot.settings.qualityPreferences?.[current.platform] ||
              boot.settings.quality
            : boot.settings.quality
        }
        actualQuality={actualQuality}
        showLyrics={!!current && showPlayer && !showQueue}
        showQueue={!!current && showPlayer && showQueue}
        onDownload={() => {
          if (current) void download([current]);
        }}
        onMode={() =>
          setMode((m) =>
            m === "loop" ? "shuffle" : m === "shuffle" ? "one" : "loop",
          )
        }
        onPrevious={() => {
          if (position > 3 && audio.current) audio.current.currentTime = 0;
          else advance(-1);
        }}
        onToggle={togglePlay}
        onNext={() => advance()}
        onLyrics={() => {
          setShowPlayer(!showPlayer);
          setShowQueue(false);
        }}
        onSeek={(time) => {
          if (audio.current) {
            audio.current.currentTime = time;
            setPosition(time);
          }
        }}
        onQuality={(quality) => {
          window.sonora
            .saveSettings(
              current && current.platform !== "local"
                ? {
                    qualityPreferences: {
                      ...boot.settings.qualityPreferences,
                      [current.platform]: quality,
                    },
                  }
                : { quality },
            )
            .then((settings) => {
              setSettings(settings);
              if (current && current.platform !== "local")
                notify("音质已更新，下次播放或下载时生效");
            })
            .catch((e) => notify(e.message, true));
        }}
        onVolume={(value) => {
          setVolume(value);
          if (audio.current) audio.current.volume = value;
        }}
        onQueue={() => {
          setShowPlayer(true);
          setShowQueue(!showQueue);
        }}
      />
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
