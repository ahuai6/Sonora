import {
  Download,
  FolderOpen,
  Pause,
  Play,
  RotateCcw,
  X,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import type { Download as Job } from "./types";
import { Artwork, PlatformBadge, Empty, bytes, qualityNames } from "./ui";
const labels: Record<string, string> = {
  queued: "等待中",
  resolving: "获取音源",
  downloading: "下载中",
  completed: "已完成",
  failed: "失败",
  paused: "已暂停",
  cancelled: "已取消",
};
export default function DownloadView({
  jobs,
  onChange,
  notify,
}: {
  jobs: Job[];
  onChange: (j: Job[]) => void;
  notify: (m: string, error?: boolean) => void;
}) {
  const [filter, setFilter] = useState("all");
  const visible = jobs.filter(
    (j) =>
      filter === "all" ||
      (filter === "active" &&
        ["queued", "resolving", "downloading", "paused"].includes(j.status)) ||
      filter === j.status,
  );
  const active = jobs.filter((j) =>
    ["queued", "resolving", "downloading"].includes(j.status),
  ).length;
  const action = (id: string, a: string) =>
    window.sonora
      .downloadAction(id, a)
      .then(onChange)
      .catch((e) => notify(e.message, true));
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR MUSIC, WITH YOU</div>
          <h1>
            下载中心 <span className="heading-count">{jobs.length}</span>
          </h1>
          <p>
            {active ? `${active} 个任务正在处理` : "把喜欢的声音，留在身边。"}
          </p>
        </div>
        <button
          className="button secondary"
          onClick={() =>
            window.sonora.openFolder().catch((e) => notify(e.message, true))
          }
        >
          <FolderOpen size={16} />
          下载目录
        </button>
      </div>
      <div className="tabs download-tabs">
        {[
          ["all", "全部任务"],
          ["active", "进行中"],
          ["completed", "已完成"],
          ["failed", "失败"],
        ].map(([k, n]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={filter === k ? "active" : ""}
          >
            {n}
            <span>
              {
                jobs.filter(
                  (j) =>
                    k === "all" ||
                    (k === "active" &&
                      ["queued", "resolving", "downloading", "paused"].includes(
                        j.status,
                      )) ||
                    k === j.status,
                ).length
              }
            </span>
          </button>
        ))}
      </div>
      {!visible.length ? (
        <Empty
          icon={<Download size={28} />}
          heading="这里暂时很安静"
          description="在搜索结果中点击下载，音乐会在这里有序抵达。"
        />
      ) : (
        <div className="download-list">
          {visible.map((j) => (
            <article key={j.id} className={`download-row ${j.status}`}>
              <Artwork item={j.track} />
              <div className="download-info">
                <div className="download-name">
                  <strong title={j.track.title}>{j.track.title}</strong>
                  <span>{qualityNames[j.quality]}</span>
                </div>
                <div className="download-sub">
                  <span>{j.track.artist}</span>
                  <PlatformBadge platform={j.track.platform} />
                </div>
                <div className="download-progress">
                  <i style={{ width: j.progress + "%" }} />
                </div>
                <div className="download-caption">
                  <span title={j.message}>{j.message}</span>
                  <span>
                    {bytes(j.received)}
                    {j.total ? ` / ${bytes(j.total)}` : ""}
                    {j.speed ? ` · ${bytes(j.speed)}/s` : ""}
                  </span>
                </div>
              </div>
              <span className={`download-state ${j.status}`}>
                {j.status === "completed" ? (
                  <CheckCircle2 size={15} />
                ) : j.status === "failed" ? (
                  <AlertCircle size={15} />
                ) : ["resolving", "downloading"].includes(j.status) ? (
                  <Loader2 size={15} className="spin" />
                ) : null}
                {labels[j.status]}
                {j.status === "downloading" && j.total ? ` ${j.progress}%` : ""}
              </span>
              <div className="row-actions">
                {["queued", "resolving", "downloading"].includes(j.status) && (
                  <button
                    className="icon-button"
                    title="暂停"
                    aria-label="暂停下载"
                    onClick={() => action(j.id, "pause")}
                  >
                    <Pause size={17} />
                  </button>
                )}
                {["paused", "failed", "cancelled"].includes(j.status) && (
                  <button
                    className="icon-button"
                    title="重新获取地址并下载"
                    aria-label="重试下载"
                    onClick={() => action(j.id, "retry")}
                  >
                    <RotateCcw size={17} />
                  </button>
                )}
                {j.status === "completed" ? (
                  <button
                    className="icon-button"
                    title="显示文件"
                    aria-label="显示下载文件"
                    onClick={() => window.sonora.openFolder(j.id)}
                  >
                    <FolderOpen size={18} />
                  </button>
                ) : (
                  j.status !== "cancelled" && (
                    <button
                      className="icon-button"
                      title="取消下载"
                      aria-label="取消下载"
                      onClick={() => action(j.id, "cancel")}
                    >
                      <X size={17} />
                    </button>
                  )
                )}
                {!["resolving", "downloading", "queued"].includes(j.status) && (
                  <button
                    className="icon-button"
                    title="移除任务记录"
                    aria-label="移除任务记录"
                    onClick={() => action(j.id, "remove")}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      <div className="download-footnote">
        仅供学习使用，请于下载后24小时自行删除。暂停后继续会重新下载；已完成文件不会因移除任务记录而删除。
      </div>
    </>
  );
}
