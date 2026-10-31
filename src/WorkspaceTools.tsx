import { useEffect, useState } from "react";
import type { Item } from "./types";
import { Modal, Busy, bytes } from "./ui";

export default function WorkspaceTools({
  items = [],
  selected = [],
  notify,
  onClose,
  initial = "batch",
  collection = [],
  onPlayList,
  onNavigate,
}: {
  items?: Item[];
  selected?: string[];
  notify: (text: string, error?: boolean) => void;
  onClose: () => void;
  initial?: string;
  collection?: Item[];
  onPlayList?: (items: Item[]) => void;
  onNavigate?: (page: string) => void;
}) {
  const [tab, setTab] = useState(initial),
    [busy, setBusy] = useState(false),
    [data, setData] = useState<any>(null),
    [plan, setPlan] = useState<any>(null);
  const [choices, setChoices] = useState<Record<string, string[]>>({}),
    [cover, setCover] = useState(false),
    [lyrics, setLyrics] = useState(false),
    [source, setSource] = useState("all");
  const [format, setFormat] = useState("m3u8"),
    [scope, setScope] = useState("library"),
    [confirm, setConfirm] = useState("");
  const run = async (fn: () => Promise<any>) => {
    setBusy(true);
    try {
      return await fn();
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  const load = () =>
    run(async () => {
      if (["recovery", "missing", "diagnostics"].includes(tab))
        setData(await window.sonora.workspace(tab));
      if (tab === "lists") setData(await window.sonora.workspace("savedLists"));
    });
  useEffect(() => {
    setData(null);
    setConfirm("");
    void load();
  }, [tab]);
  const ids = selected.length ? selected : items.map((x) => x.id);
  return (
    <Modal
      title="音乐整理与恢复"
      subtitle="所有写入前都可核对，原文件修改会保留备份。"
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <div className="tabs tool-tabs">
        {[
          ["batch", "批量标签"],
          ["missing", "缺失文件"],
          ["lists", "列表交换"],
          ["recovery", "恢复中心"],
          ["diagnostics", "诊断预览"],
        ].map(([id, label]) => (
          <button
            key={id}
            disabled={busy}
            className={tab === id ? "active" : ""}
            onClick={() => {
              setData(null);
              setTab(id);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {busy && <Busy text="正在处理，请稍候" />}
      {tab === "batch" && (
        <div className="tool-section">
          <p>
            已选择 {ids.length} 首（每批最多 100
            首）。候选需要逐项核对，预览不会修改文件。
          </p>
          <div className="inline-actions">
            <select
              aria-label="批量匹配来源"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            >
              {[
                ["all", "全部来源"],
                ["netease", "网易云"],
                ["qq", "QQ 音乐"],
                ["kugou", "酷狗"],
                ["musicbrainz", "MusicBrainz"],
                ["lrclib", "LRCLIB"],
              ].map(([v, n]) => (
                <option key={v} value={v}>
                  {n}
                </option>
              ))}
            </select>
            <button
              className="button primary"
              disabled={busy || !ids.length}
              onClick={() =>
                run(async () => {
                  const p = await window.sonora.workspace("batchPlan", {
                    ids,
                    source,
                  });
                  setPlan(p);
                  setChoices({});
                })
              }
            >
              生成匹配预览
            </button>
          </div>
          {plan?.rows.map((row: any) => (
            <section className="tool-card" key={row.id}>
              <strong>{row.title}</strong>
              <small>
                {row.source} {row.score != null ? " · 相似度 " + row.score : ""}
              </small>
              {row.error ? (
                <p className="error-text">{row.error}</p>
              ) : (
                <>
                  <p>{row.warnings?.join("；")}</p>
                  <div className="tag-diff-grid">
                    {Object.entries(row.after)
                      .filter(([, value]) => value !== "" && value !== 0)
                      .map(([field, value]) => (
                        <label key={field}>
                          <input
                            type="checkbox"
                            checked={!!choices[row.id]?.includes(field)}
                            onChange={(e) =>
                              setChoices((old) => ({
                                ...old,
                                [row.id]: e.target.checked
                                  ? [...(old[row.id] || []), field]
                                  : (old[row.id] || []).filter(
                                      (x) => x !== field,
                                    ),
                              }))
                            }
                          />
                          <strong>{field}</strong>
                          <del>{String(row.before[field] || "—")}</del>
                          <span>{String(value)}</span>
                        </label>
                      ))}
                  </div>
                </>
              )}
            </section>
          ))}
          {plan && (
            <>
              <div className="inline-actions">
                <label>
                  <input
                    type="checkbox"
                    checked={cover}
                    onChange={(e) => setCover(e.target.checked)}
                  />
                  写入候选封面
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={lyrics}
                    onChange={(e) => setLyrics(e.target.checked)}
                  />
                  写入候选歌词
                </label>
              </div>
              <button
                className="button primary"
                disabled={
                  busy ||
                  (!Object.keys(choices).some((id) => choices[id].length) &&
                    !cover &&
                    !lyrics)
                }
                onClick={() =>
                  run(async () => {
                    const r = await window.sonora.workspace("batchApply", {
                      planId: plan.planId,
                      choices: plan.rows
                        .filter(
                          (r: any) =>
                            !r.error &&
                            (choices[r.id]?.length || cover || lyrics),
                        )
                        .map((r: any) => ({
                          id: r.id,
                          fields: choices[r.id] || [],
                        })),
                      options: { cover, lyrics },
                    });
                    notify(
                      `已保存 ${r.results.filter((x: any) => x.ok).length} 首；失败 ${r.results.filter((x: any) => !x.ok).length} 首`,
                    );
                    setData(r.results);
                    setPlan(null);
                  })
                }
              >
                写入所勾选的信息
              </button>
            </>
          )}
          {Array.isArray(data) &&
            data.map((r: any) => (
              <p key={r.id}>
                {r.ok ? "已保存" : "未保存"}：{r.message || r.id}
              </p>
            ))}
        </div>
      )}
      {tab === "missing" && (
        <div className="tool-section">
          <p>刷新发现的缺失文件会保留收藏和原记录，可重新定位或忘记。</p>
          {data?.length === 0 && <p>没有缺失文件。</p>}
          {(Array.isArray(data) ? data : []).map((item: Item) => (
            <div className="tool-card" key={item.id}>
              <strong>{item.title}</strong>
              <p className="path-text">{item.path}</p>
              <div className="inline-actions">
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await window.sonora.workspace("relink", { id: item.id });
                      setData(await window.sonora.workspace("missing"));
                    })
                  }
                >
                  重新定位
                </button>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    run(async () =>
                      setData(
                        await window.sonora.workspace("forgetMissing", {
                          ids: [item.id],
                        }),
                      ),
                    )
                  }
                >
                  忘记记录
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {tab === "lists" && (
        <div className="tool-section">
          <p>
            JSON、CSV 与 M3U8
            可导出本地音乐、下载文件、队列和当前已加载的歌单。导入在线歌曲后可在这里载入播放；本地路径会添加到音乐库。
          </p>
          <div className="inline-actions">
            <select
              aria-label="导出列表范围"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="library">本地音乐</option>
              <option value="downloads">下载文件</option>
              <option value="queue">已保存队列</option>
              <option value="collection">
                当前已加载的歌单（{collection.length} 首）
              </option>
            </select>
            <select
              aria-label="导出列表格式"
              value={format}
              onChange={(e) => setFormat(e.target.value)}
            >
              {["m3u8", "csv", "json"].map((x) => (
                <option key={x} value={x}>
                  {x.toUpperCase()}
                </option>
              ))}
            </select>
            <button
              className="button primary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const file = await window.sonora.workspace("exportList", {
                    scope,
                    format,
                    ids: selected,
                    items: collection,
                  });
                  if (file) notify("列表已导出");
                })
              }
            >
              导出列表
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const r = await window.sonora.workspace("importList");
                  if (r)
                    notify(
                      `导入本地 ${r.imported} 首、在线 ${r.remote.length} 首，${r.failures.length} 个文件不可读`,
                    );
                  setData(await window.sonora.workspace("savedLists"));
                })
              }
            >
              导入列表
            </button>
          </div>
          {Array.isArray(data) &&
            data.map((list: any) => (
              <div className="tool-card" key={list.id}>
                <strong>{list.name}</strong>
                <span>{list.items.length} 首在线歌曲</span>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const items = await window.sonora.workspace(
                        "loadSavedList",
                        { id: list.id },
                      );
                      if (items.length) {
                        onClose();
                        onPlayList?.(items);
                      }
                    })
                  }
                >
                  播放此列表
                </button>
              </div>
            ))}
        </div>
      )}
      {tab === "recovery" && (
        <div className="tool-section">
          <p>
            备份占用 {bytes(data?.totalBytes)}
            。标签备份保存修改前的完整音频；状态恢复会重启应用。
          </p>
          {data?.warning && <p>{data.warning}</p>}
          {data?.files?.map((entry: any) => (
            <div className="tool-card" key={entry.name}>
              <strong>{entry.kind === "tags" ? "音频备份" : "状态备份"}</strong>
              <small>{entry.name}</small>
              <p>
                {bytes(entry.bytes)} ·{" "}
                {new Date(entry.modifiedAt).toLocaleString()}
              </p>
              <div className="inline-actions">
                <button
                  className="button secondary"
                  disabled={busy || (entry.kind === "tags" && !entry.localId)}
                  onClick={() => setConfirm(entry.name)}
                >
                  恢复
                </button>
                {entry.kind === "tags" && (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => setConfirm("delete:" + entry.name)}
                  >
                    清理此备份
                  </button>
                )}
                {confirm === entry.name && (
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await window.sonora.workspace(
                          entry.kind === "tags"
                            ? "restoreBackup"
                            : "restoreState",
                          { name: entry.name, id: entry.localId },
                        );
                        notify("已恢复");
                        setData(await window.sonora.workspace("recovery"));
                        setConfirm("");
                      })
                    }
                  >
                    确认{entry.kind === "state" ? "恢复并重启" : "恢复原音频"}
                  </button>
                )}
                {confirm === "delete:" + entry.name && (
                  <button
                    className="button danger"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        setData(
                          await window.sonora.workspace("cleanup", {
                            names: [entry.name],
                          }),
                        );
                        setConfirm("");
                      })
                    }
                  >
                    确认删除备份
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {tab === "diagnostics" && (
        <div className="tool-section">
          <div className="inline-actions">
            <button
              className="button secondary"
              onClick={() => {
                onClose();
                onNavigate?.("accounts");
              }}
            >
              处理账号与用户 ID
            </button>
            <button
              className="button secondary"
              onClick={() => {
                onClose();
                onNavigate?.("settings");
              }}
            >
              检查音源与接口配置
            </button>
            <button
              className="button secondary"
              onClick={() => {
                onClose();
                onNavigate?.("downloads");
              }}
            >
              处理失败下载
            </button>
          </div>
          <p>以下内容已隐藏凭据、本地路径和 URL 参数；核对后再导出。</p>
          <pre className="diagnostics-preview">
            {data ? JSON.stringify(data, null, 2) : "正在读取…"}
          </pre>
          <button
            className="button primary"
            disabled={busy || !data}
            onClick={() =>
              run(async () => {
                const file = await window.sonora.exportDiagnostics();
                if (file) notify("已导出脱敏诊断");
              })
            }
          >
            导出此诊断
          </button>
        </div>
      )}
    </Modal>
  );
}
