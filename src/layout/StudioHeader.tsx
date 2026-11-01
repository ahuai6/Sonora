import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  Compass,
  Download,
  FileText,
  FolderHeart,
  Moon,
  Search,
  SlidersHorizontal,
  Sun,
  UserRound,
  X,
} from "lucide-react";
import type { Page } from "./AppChrome";
const destinations = [
  { id: "discover", label: "发现音乐", short: "发现", Icon: Compass },
  { id: "search", label: "搜索资源", short: "搜索", Icon: Search },
  { id: "lyrics", label: "歌词搜索", short: "歌词", Icon: FileText },
  { id: "library", label: "本地音乐", short: "乐库", Icon: FolderHeart },
  { id: "downloads", label: "下载中心", short: "下载", Icon: Download },
  { id: "accounts", label: "平台账号", short: "账号", Icon: UserRound },
  {
    id: "settings",
    label: "偏好与音源",
    short: "设置",
    Icon: SlidersHorizontal,
  },
] as const;
type Props = {
  page: Page;
  onPage: (page: Page) => void;
  query: string;
  onQuery: (query: string) => void;
  onSearch: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
  theme: string;
  onTheme: () => void;
  activeDownloads: number;
};
export default function StudioHeader(p: Props) {
  const [systemDark, setSystemDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    const query = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const nav = useRef<HTMLElement>(null),
    [lens, setLens] = useState({ left: 0, width: 0, height: 0 });
  useLayoutEffect(() => {
    const measure = () => {
      const active = nav.current?.querySelector<HTMLElement>(
        '[aria-current="page"]',
      );
      if (active)
        setLens((old) =>
          old.left === active.offsetLeft &&
          old.width === active.offsetWidth &&
          old.height === active.offsetHeight
            ? old
            : {
                left: active.offsetLeft,
                width: active.offsetWidth,
                height: active.offsetHeight,
              },
        );
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (nav.current) observer.observe(nav.current);
    return () => observer.disconnect();
  }, [p.page]);
  const dark = p.theme === "dark" || (p.theme === "system" && systemDark);
  return (
    <header className="studio-header glass-surface">
      <button
        className="studio-brand"
        aria-label="声屿首页"
        onClick={() => p.onPage("discover")}
      >
        <div className="brand-mark">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        <div>
          <strong>
            Sonora<span>.</span>
          </strong>
          <small>声音，自有轨迹</small>
        </div>
      </button>
      <nav ref={nav} className="navigation-ribbon" aria-label="主导航">
        <span
          className="navigation-lens"
          aria-hidden="true"
          style={{
            transform: `translateX(${lens.left}px)`,
            width: lens.width,
            height: lens.height,
            opacity: lens.width ? 1 : 0,
          }}
        />
        {destinations.map(({ id, label, short, Icon }) => (
          <button
            key={id}
            aria-label={label}
            title={label}
            aria-current={p.page === id ? "page" : undefined}
            className={p.page === id ? "active" : ""}
            onClick={() => p.onPage(id)}
          >
            <Icon size={17} strokeWidth={1.7} />
            <span>{short}</span>
            {id === "downloads" && p.activeDownloads > 0 && (
              <em>{p.activeDownloads}</em>
            )}
          </button>
        ))}
      </nav>
      <form
        className="global-search glass-control"
        onSubmit={(event) => {
          event.preventDefault();
          p.onSearch();
        }}
      >
        <Search size={17} />
        <input
          ref={p.inputRef}
          aria-label="搜索音乐资源"
          value={p.query}
          onChange={(e) => p.onQuery(e.target.value)}
          placeholder={p.page === "lyrics" ? "搜索一句歌词…" : "搜索你想听的…"}
        />
        {p.query ? (
          <button
            type="button"
            aria-label="清空搜索"
            onClick={() => p.onQuery("")}
          >
            <X size={14} />
          </button>
        ) : (
          <kbd>Ctrl F</kbd>
        )}
      </form>
      <button
        className="appearance-button icon-button glass-control"
        aria-label={dark ? "切换为浅色模式" : "切换为深色模式"}
        title="切换外观"
        onClick={p.onTheme}
      >
        {dark ? <Sun size={18} /> : <Moon size={18} />}
      </button>
    </header>
  );
}
