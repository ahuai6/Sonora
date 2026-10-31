import { useState } from "react";
import type { Item } from "./types";
export default function QueuePanel({
  queue,
  current,
  onChange,
  onPlay,
  onSave,
}: {
  queue: Item[];
  current: string;
  onChange: (v: Item[]) => void;
  onPlay: (v: Item) => void;
  onSave: () => void;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const move = (from: number, to: number) => {
    const next = [...queue];
    next.splice(to, 0, next.splice(from, 1)[0]);
    onChange(next);
  };
  return (
    <div className="queue-list">
      <div className="inline-actions">
        <p>{queue.length} 首歌曲</p>
        <button className="text-button" onClick={onSave}>
          保存队列
        </button>
        <button className="text-button" onClick={() => onChange([])}>
          清空
        </button>
      </div>
      {queue.map((item, i) => (
        <div
          className={"queue-entry " + (item.key === current ? "active" : "")}
          key={item.key}
          draggable
          onDragStart={() => setDrag(i)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (drag !== null) move(drag, i);
            setDrag(null);
          }}
        >
          <button onClick={() => onPlay(item)}>
            <span>{i + 1}</span>
            <div>
              <strong>{item.title}</strong>
              <small>{item.artist}</small>
            </div>
          </button>
          <div className="queue-controls">
            <button
              aria-label={"上移 " + item.title}
              disabled={!i}
              onClick={() => move(i, i - 1)}
            >
              ↑
            </button>
            <button
              aria-label={"下移 " + item.title}
              disabled={i === queue.length - 1}
              onClick={() => move(i, i + 1)}
            >
              ↓
            </button>
            <button
              aria-label={"移除 " + item.title}
              onClick={() => onChange(queue.filter((_, n) => n !== i))}
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
