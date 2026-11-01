import { useEffect, useRef, type CSSProperties } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight } from "lucide-react";
import type { Item } from "../types";
import { Artwork, PlatformBadge } from "../ui";
type Props = {
  items: Item[];
  index: number;
  onIndex: (index: number) => void;
  onOpen: (item: Item) => void;
};
export default function RecordOrbit(p: Props) {
  const stage = useRef<HTMLDivElement>(null),
    drag = useRef<{
      x: number;
      y: number;
      lastX: number;
      lastTime: number;
      velocity: number;
    } | null>(null),
    dragged = useRef(false);
  const items = p.items.slice(0, 8),
    index = Math.min(p.index, items.length - 1),
    current = items[index];
  const select = (next: number) =>
    p.onIndex(Math.max(0, Math.min(items.length - 1, next)));
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    let accumulated = 0,
      lastWheel = 0;
    const wheel = (event: WheelEvent) => {
      const horizontal =
        (event.shiftKey ? event.deltaY || event.deltaX : event.deltaX) *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? element.clientWidth
            : 1);
      if (
        event.ctrlKey ||
        !horizontal ||
        (!event.shiftKey && Math.abs(event.deltaX) <= Math.abs(event.deltaY))
      )
        return;
      event.preventDefault();
      const now = performance.now();
      if (now - lastWheel > 180) accumulated = 0;
      accumulated += horizontal;
      lastWheel = now;
      if (Math.abs(accumulated) >= 45) {
        p.onIndex(
          Math.max(
            0,
            Math.min(items.length - 1, index + Math.sign(accumulated)),
          ),
        );
        accumulated = 0;
      }
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [index, items.length, p.onIndex]);
  const finish = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) return;
    const delta = event.clientX - state.x;
    const step = Math.round(
      -delta / 130 -
        (performance.now() - state.lastTime < 80 ? state.velocity * 0.012 : 0),
    );
    if (dragged.current) select(index + (step || Math.sign(-delta)));
    drag.current = null;
    stage.current?.classList.remove("is-dragging");
    stage.current?.style.setProperty("--drag", "0px");
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return (
    <div className="record-orbit">
      <div
        ref={stage}
        className="record-stage"
        onDragStart={(e) => e.preventDefault()}
        role="group"
        aria-label="可拖拽的唱片轨道"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) {
            e.preventDefault();
            select(
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? items.length - 1
                  : index + (e.key === "ArrowRight" ? 1 : -1),
            );
          }
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            lastX: e.clientX,
            lastTime: performance.now(),
            velocity: 0,
          };
          dragged.current = false;
        }}
        onPointerMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          if (
            !matchMedia("(prefers-reduced-motion: reduce)").matches &&
            document.documentElement.dataset.effects !== "reduced" &&
            document.documentElement.dataset.motion !== "reduced"
          ) {
            e.currentTarget.style.setProperty(
              "--camera-x",
              `${((e.clientX - box.left - box.width / 2) / box.width) * 5}deg`,
            );
            e.currentTarget.style.setProperty(
              "--camera-y",
              `${(-(e.clientY - box.top - box.height / 2) / box.height) * 3}deg`,
            );
          }
          const state = drag.current;
          if (!state) return;
          const delta = e.clientX - state.x;
          if (
            Math.abs(delta) > 7 &&
            (dragged.current || Math.abs(delta) > Math.abs(e.clientY - state.y))
          ) {
            dragged.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            e.currentTarget.classList.add("is-dragging");
          }
          const now = performance.now();
          state.velocity =
            ((e.clientX - state.lastX) / Math.max(1, now - state.lastTime)) *
            100;
          state.lastX = e.clientX;
          state.lastTime = now;
          if (dragged.current)
            e.currentTarget.style.setProperty(
              "--drag",
              `${Math.max(-230, Math.min(230, delta))}px`,
            );
        }}
        onPointerUp={finish}
        onPointerCancel={(e) => {
          drag.current = null;
          e.currentTarget.classList.remove("is-dragging");
          e.currentTarget.style.setProperty("--drag", "0px");
        }}
        onPointerLeave={() => {
          if (!drag.current) {
            stage.current?.style.setProperty("--camera-x", "0deg");
            stage.current?.style.setProperty("--camera-y", "0deg");
          }
        }}
      >
        <div className="record-perspective">
          {items.map((item, i) => {
            const offset = i - index,
              depth = Math.abs(offset);
            return (
              <button
                className="music-card orbit-record"
                key={item.key}
                aria-label={item.title}
                aria-current={i === index ? "true" : undefined}
                data-active={i === index}
                style={
                  {
                    "--record-x": `${offset * 132}px`,
                    "--record-y": `${depth * 5}px`,
                    "--record-z": `${-depth * 95}px`,
                    "--record-angle": `${-Math.sign(offset) * Math.min(48, depth * 21)}deg`,
                    "--record-tilt": `${offset * 1.2}deg`,
                    zIndex: 20 - depth,
                    filter: `saturate(${Math.max(0.65, 1 - depth * 0.07)})`,
                  } as CSSProperties
                }
                onClick={(e) => {
                  if (dragged.current && e.detail !== 0) return;
                  i === index ? p.onOpen(item) : select(i);
                }}
              >
                <div className="card-art">
                  <Artwork item={item} />
                  <PlatformBadge platform={item.platform} />
                  <span className="record-index">0{i + 1}</span>
                </div>
                <span className="record-accessible">
                  {item.title} · {item.artist}
                </span>
              </button>
            );
          })}
        </div>
        <div className="orbit-floor" />
      </div>
      {current && (
        <div className="orbit-caption">
          <div className="orbit-title">
            <span className="desk-kicker">
              0{index + 1} / 0{items.length} · DRAG TO DISCOVER
            </span>
            <strong key={current.key}>{current.title}</strong>
            <small>{current.artist || "精选歌单"}</small>
          </div>
          <div className="orbit-controls">
            <button
              className="icon-button glass-control"
              aria-label="上一张唱片"
              disabled={!index}
              onClick={() => select(index - 1)}
            >
              <ArrowLeft size={17} />
            </button>
            <button
              className="icon-button glass-control"
              aria-label="下一张唱片"
              disabled={index === items.length - 1}
              onClick={() => select(index + 1)}
            >
              <ArrowRight size={17} />
            </button>
            <button
              className="button secondary compact"
              onClick={() => p.onOpen(current)}
            >
              打开歌单
              <ArrowUpRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
