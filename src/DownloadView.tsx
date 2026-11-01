import {
  Download,
  FolderOpen,
  Pause,
  RotateCcw,
  X,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Trash2,
  RefreshCw,
  ListMinus,
} from "lucide-react";
import { useState, useEffect } from "react";
import type { Download as Job, CollectionResult } from "./types";
import { Artwork, PlatformBadge, Empty, bytes, qualityNames } from "./ui";
const labels: Record<string, string> = {
  queued: "等待中",
  resolving: "获取音源",
  downloading: "下载中",
  tagging: "写入标签",
  committing: "正在保存",
  completed: "已完成",
  failed: "失败",
  paused: "已暂停",
  cancelled: "已取消",
  missing: "文件已丢失",
};
const activeStates = [
  "queued",
  "resolving",
  "downloading",
  "tagging",
  "committing",
];
const can = (job: Job, action: string) => {
  if (action === "retry")
    return ["failed", "paused", "cancelled", "missing"].includes(job.status);
  if (action === "pause")
    return (
      activeStates.includes(job.status) &&
      job.status !== "committing" &&
      !job.path
    );
  if (action === "cancel")
    return (
      (activeStates.includes(job.status) || job.status === "paused") &&
      job.status !== "committing" &&
      !job.path
    );
  if (action === "trash")
    return !!job.path && !activeStates.includes(job.status);
  return job.status !== "committing" && !(job.status === "tagging" && job.path);
};
export default function DownloadView({
  jobs,
  onChange,
  notify,
  onCollection,
  onRefresh,
  refreshing,
}: {
  jobs: Job[];
  onChange: (j: Job[]) => void;
  notify: (m: string, error?: boolean) => void;
  onCollection: (result: CollectionResult) => void;
  onRefresh: () => Promise<void>;
  refreshing: boolean;
}) {
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState(new Set<string>()),
    [batchBusy, setBatchBusy] = useState(false);
  useEffect(() => {
    const valid = new Set(jobs.map((j) => j.id));
    setSelected((old) => {
      const next = new Set([...old].filter((id) => valid.has(id)));
      return next.size === old.size ? old : next;
    });
  }, [jobs]);
  const visible = jobs.filter(
    (j) =>
      filter === "all" ||
      (filter === "active" &&
        [
          "queued",
          "resolving",
          "downloading",
          "tagging",
          "committing",
          "paused",
        ].includes(j.status)) ||
      filter === j.status,
  );
  const active = jobs.filter((j) =>
    ["queued", "resolving", "downloading", "tagging", "committing"].includes(
      j.status,
    ),
  ).length;
  const action = (id: string, a: string) =>
    window.sonora
      .downloadAction(id, a)
      .then(onChange)
      .catch((e) => notify(e.message, true));
  const chosen = visible.filter((j) => selected.has(j.id));
  const all = !!visible.length && chosen.length === visible.length;
  const batch = async (a: string) => {
    setBatchBusy(true);
    try {
      const result = await window.sonora.collectionBatch(
        "downloads",
        chosen.map((j) => j.id),
        a,
      );
      onCollection(result);
      if (!result.cancelled)
        notify(
          `已处理 ${result.changed} 个任务${result.skipped ? `，${result.skipped} 个当前状态不可操作` : ""}${result.failures.length ? `，${result.failures.length} 个失败：${result.failures[0].message}` : ""}`,
          !!result.failures.length,
        );
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBatchBusy(false);
    }
  };
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
        <div className="inline-actions">
          <button
            className="button secondary"
            disabled={refreshing || batchBusy}
            onClick={onRefresh}
            aria-label="刷新下载列表"
          >
            <RefreshCw size={16} className={refreshing ? "spin" : ""} />
            刷新
          </button>
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
      </div>
      <div className="tabs download-tabs">
        {[
          ["all", "全部任务"],
          ["active", "进行中"],
          ["completed", "已完成"],
          ["failed", "失败"],
          ["missing", "文件已丢失"],
        ].map(([k, n]) => (
          <button
            key={k}
            onClick={() => {
              setFilter(k);
              setSelected(new Set());
            }}
            className={filter === k ? "active" : ""}
          >
            {n}
            <span>
              {
                jobs.filter(
                  (j) =>
                    k === "all" ||
                    (k === "active" &&
                      [
                        "queued",
                        "resolving",
                        "downloading",
                        "tagging",
                        "committing",
                        "paused",
                      ].includes(j.status)) ||
                    k === j.status,
                ).length
              }
            </span>
          </button>
        ))}
      </div>
      {!!visible.length && (
        <div className="list-toolbar download-batch">
          <label className="batch-selection">
            <input
              type="checkbox"
              aria-label="选择当前列表全部下载任务"
              checked={all}
              ref={(node) => {
                if (node) node.indeterminate = chosen.length > 0 && !all;
              }}
              disabled={batchBusy}
              onChange={() =>
                setSelected(all ? new Set() : new Set(visible.map((j) => j.id)))
              }
            />
            {chosen.length
              ? `已选择 ${chosen.length} 个任务`
              : `${visible.length} 个任务`}
          </label>
          {!!chosen.length && (
            <div>
              {(
                [
                  ["pause", "暂停所选", Pause],
                  ["retry", "重试所选", RotateCcw],
                  ["cancel", "取消所选下载", X],
                  ["remove", "移除所选记录", ListMinus],
                  ["trash", "所选移入回收站", Trash2],
                ] as const
              ).map(([a, label, Icon]) => (
                <button
                  key={a}
                  className={`button secondary compact ${a === "trash" ? "danger" : ""}`}
                  disabled={
                    batchBusy || refreshing || !chosen.some((j) => can(j, a))
                  }
                  onClick={() => batch(a)}
                >
                  <Icon size={14} />
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
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
              <input
                type="checkbox"
                aria-label={`选择下载任务 ${j.track.title}`}
                checked={selected.has(j.id)}
                disabled={batchBusy}
                onChange={() =>
                  setSelected((old) => {
                    const next = new Set(old);
                    next.has(j.id) ? next.delete(j.id) : next.add(j.id);
                    return next;
                  })
                }
              />
              <Artwork item={j.track} />
              <div className="download-info">
                <div className="download-name">
                  <strong title={j.track.title}>{j.track.title}</strong>
                  <span>请求：{qualityNames[j.quality]}</span>
                  <span className="download-quality" title={j.actualQuality}>
                    实际：
                    {j.audioInfo?.label || j.actualQuality || "等待音频检测"}
                  </span>
                </div>
                <div className="download-sub">
                  <span>{j.track.artist}</span>
                  <PlatformBadge platform={j.track.platform} />
                </div>
                <div className="download-progress">
                  <i style={{ width: j.progress + "%" }} />
                </div>
                <div className="download-caption">
                  <span
                    title={[j.message, ...(j.metadata?.warnings || [])].join(
                      "\n",
                    )}
                  >
                    {j.message}
                  </span>
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
                ) : ["failed", "missing"].includes(j.status) ? (
                  <AlertCircle size={15} />
                ) : [
                    "resolving",
                    "downloading",
                    "tagging",
                    "committing",
                  ].includes(j.status) ? (
                  <Loader2 size={15} className="spin" />
                ) : null}
                {labels[j.status]}
                {j.status === "downloading" && j.total ? ` ${j.progress}%` : ""}
              </span>
              <div
                className={`row-actions ${batchBusy ? "batch-disabled" : ""}`}
                inert={batchBusy}
              >
                {["queued", "resolving", "downloading", "tagging"].includes(
                  j.status,
                ) &&
                  !j.path && (
                    <button
                      className="icon-button"
                      title="暂停"
                      aria-label="暂停下载"
                      onClick={() => action(j.id, "pause")}
                    >
                      <Pause size={17} />
                    </button>
                  )}
                {["paused", "failed", "cancelled", "missing"].includes(
                  j.status,
                ) && (
                  <button
                    className="icon-button"
                    title="重新获取地址并下载"
                    aria-label="重试下载"
                    onClick={() => action(j.id, "retry")}
                  >
                    <RotateCcw size={17} />
                  </button>
                )}
                {j.status === "completed" && (
                  <button
                    className="icon-button"
                    title="只重试标签和歌词，不重复下载"
                    aria-label="重试内嵌信息"
                    disabled={batchBusy}
                    onClick={async () => {
                      setBatchBusy(true);
                      try {
                        onChange(
                          await window.sonora.workspace("retryMetadata", {
                            ids: [j.id],
                          }),
                        );
                        notify("内嵌信息已重新处理");
                      } catch (e) {
                        notify((e as Error).message, true);
                      } finally {
                        setBatchBusy(false);
                      }
                    }}
                  >
                    <RotateCcw size={16} />
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
                  j.status !== "cancelled" &&
                  j.status !== "committing" &&
                  j.status !== "missing" &&
                  !j.path && (
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
                {![
                  "resolving",
                  "downloading",
                  "tagging",
                  "committing",
                  "queued",
                ].includes(j.status) && (
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
        仅供学习使用，请于下载后24小时自行删除。移除记录保留文件；移入回收站会移动音频并清理音乐库记录。刷新会核对文件是否存在；重新下载不支持断点续传。
      </div>
    </>
  );
}
