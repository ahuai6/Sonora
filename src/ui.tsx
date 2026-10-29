import { useState, type ReactNode } from "react";
import { Music2, Loader2, X, ChevronRight } from "lucide-react";
import type { Item } from "./types";
export const platformNames: Record<string, string> = {
  all: "聚合音源",
  netease: "网易云",
  qq: "QQ 音乐",
  kugou: "酷狗",
  local: "本地",
};
export const qualityNames: Record<string, string> = {
  standard: "标准 128K",
  high: "高品 320K",
  lossless: "无损 FLAC",
  hires: "Hi-Res",
};
export const duration = (n: number) =>
  `${Math.floor((n || 0) / 60)}:${String(Math.floor((n || 0) % 60)).padStart(2, "0")}`;
export const bytes = (n = 0) =>
  n >= 1024 ** 3
    ? (n / 1024 ** 3).toFixed(2) + " GB"
    : n >= 1024 ** 2
      ? (n / 1024 ** 2).toFixed(1) + " MB"
      : n >= 1024
        ? (n / 1024).toFixed(0) + " KB"
        : n + " B";
export function weave(items: Item[]) {
  const groups = ["netease", "qq", "kugou", "local"].map((p) =>
    items.filter((x) => x.platform === p),
  );
  const out: Item[] = [];
  for (let i = 0; i < Math.max(0, ...groups.map((x) => x.length)); i++)
    for (const g of groups) if (g[i]) out.push(g[i]);
  return out;
}
export function Artwork({
  item,
  size = "",
  className = "",
}: {
  item: Pick<Item, "cover" | "title">;
  size?: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const color = [...item.title].reduce((a, c) => a + c.charCodeAt(0), 0) % 6;
  return (
    <div className={`artwork color-${color} ${size} ${className}`}>
      {item.cover && !failed ? (
        <img
          src={item.cover}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <>
          <span className="art-orbit" />
          <Music2 size={size === "small" ? 17 : 30} />
        </>
      )}
    </div>
  );
}
export function PlatformBadge({ platform }: { platform: string }) {
  return (
    <span className={`platform-badge ${platform}`}>
      <i />
      {platformNames[platform] || platform}
    </span>
  );
}
export function Empty({
  icon,
  heading,
  description,
  action,
}: {
  icon?: ReactNode;
  heading: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon || <Music2 size={28} />}</div>
      <h3>{heading}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Busy({ text = "正在寻找好声音" }: { text?: string }) {
  return (
    <div className="busy">
      <Loader2 size={20} className="spin" />
      <span>{text}</span>
    </div>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-heading">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭">
            <X size={20} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
export function SectionHeading({
  label,
  description,
  action,
  onAction,
}: {
  label: string;
  description?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="section-heading">
      <div>
        <h2>{label}</h2>
        {description && <p>{description}</p>}
      </div>
      {action && (
        <button className="text-button" onClick={onAction}>
          {action}
          <ChevronRight size={15} />
        </button>
      )}
    </div>
  );
}
export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`toggle ${checked ? "on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}
export function parseLyrics(text: string) {
  const lines: { time: number; text: string }[] = [];
  for (const l of (text || "").split(/\r?\n/)) {
    const word = l.replace(/\[[^\]]*\]/g, "").trim();
    for (const m of l.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g))
      lines.push({ time: Number(m[1]) * 60 + Number(m[2]), text: word });
  }
  return lines.sort((a, b) => a.time - b.time);
}
