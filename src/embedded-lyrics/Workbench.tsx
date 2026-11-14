import { useEffect, useState } from "react";
import type { API, Item } from "../types";
import { Busy, Modal } from "../ui";
import { localAlignment, readPaste } from "./align";
import OnlineLyrics from "./OnlineLyrics";
import type { Alignment, PastedLine, WriteRequest } from "./types";

type Snapshot = Awaited<ReturnType<API["tagReadEmbedded"]>>;
type Patch = WriteRequest & {
  revision: string;
  remove: boolean;
};
const message = (e: unknown) =>
  (e as Error).message.replace(
    /^Error invoking remote method '[^']+': (?:Error: )?/,
    "",
  );
const evidence = {
  timestamp: "时间戳",
  source: "原句",
  order: "顺序推测，需核对",
  manual: "手动",
};

export default function Workbench({
  item,
  onClose,
  onSave,
}: {
  item: Item;
  onClose: () => void;
  onSave: (patch: Patch) => Promise<void>;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [fieldId, setFieldId] = useState("");
  const [language, setLanguage] = useState("zh-Hans");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [replaceIds, setReplaceIds] = useState<string[]>([]);
  const [overwrite, setOverwrite] = useState(false);
  const [pasted, setPasted] = useState("");
  const [online, setOnline] = useState<PastedLine[]>([]);
  const [matched, setMatched] = useState<{
    rows: PastedLine[];
    alignments: Alignment[];
  } | null>(null);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState(false);
  const [confirm, setConfirm] = useState<
    "write" | "remove" | "close" | "switch" | null
  >(null);
  const [nextField, setNextField] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [baseURL, setBaseURL] = useState("https://api.openai.com/v1");
  const [protocol, setProtocol] = useState("responses");
  const [model, setModel] = useState("");
  const [key, setKey] = useState("");
  useEffect(() => {
    let active = true;
    window.sonora.tagReadEmbedded(item.id).then(
      (result) => {
        if (!active) return;
        setSnapshot(result);
        setFieldId(
          result.fields.find((field) => field.format)?.id ??
            result.fields[0]?.id ??
            "",
        );
      },
      (reason) => {
        if (active) setError(message(reason));
      },
    );
    return () => {
      active = false;
    };
  }, [item.id]);

  const field = snapshot?.fields.find((value) => value.id === fieldId);
  const lines =
    field?.lines.filter((line) => !replaceIds.includes(line.id)) ?? [];
  const dirty =
    Object.values(draft).some((text) => text.trim()) || !!replaceIds.length;
  const hasDraft = dirty || !!(pasted.trim() || online.length);
  const requestClose = () => {
    if (busy) return;
    if (hasDraft) setConfirm("close");
    else onClose();
  };
  function selectField(id: string) {
    setFieldId(id);
    setDraft({});
    setReplaceIds([]);
    setMatched(null);
    setOverwrite(false);
    setError("");
    setStatus("");
    setConfirm(null);
  }
  async function run(action: string, task: () => Promise<void>) {
    setBusy(action);
    setError("");
    setStatus("");
    try {
      await task();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy("");
    }
  }
  function match() {
    const rows = [...readPaste(pasted), ...online].map((row, index) => ({
      ...row,
      index: index + 1,
    }));
    if (!rows.length || rows.length > 1500 || lines.length > 5000) {
      setError("请提供可匹配文本。每次最多匹配 1500 条片段和 5000 行原词。");
      return;
    }
    setError("");
    setMatched({ rows, alignments: localAlignment(lines, rows, offset) });
  }
  function setAlignment(id: string, index: number) {
    setMatched(
      (previous) =>
        previous && {
          rows: previous.rows,
          alignments: [
            ...previous.alignments.filter(
              (item) =>
                item.id !== id && (!index || !item.fragments.includes(index)),
            ),
            ...(index
              ? [{ id, fragments: [index], evidence: "manual" as const }]
              : []),
          ],
        },
    );
  }

  return (
    <>
      <Modal
        title="内嵌歌词翻译"
        subtitle={`${item.title} · ${item.artist}`}
        onClose={requestClose}
        wide
      >
        {error && (
          <p className="tag-error" role="alert">
            {error}
          </p>
        )}
        {!snapshot && !error && <Busy text="正在读取原文件的歌词字段" />}
        {snapshot && !field && (
          <p className="tag-note">
            此文件没有可用的内嵌歌词字段。可先在「内嵌歌词」中写入歌词。
          </p>
        )}
        {snapshot && field && (
          <>
            <fieldset className="embedded-fields" disabled={!!busy}>
              <div className="inline-actions">
                <label className="tag-field">
                  内嵌字段
                  <select
                    value={fieldId}
                    onChange={(e) => {
                      if (dirty) {
                        setNextField(e.target.value);
                        setConfirm("switch");
                      } else selectField(e.target.value);
                    }}
                  >
                    {snapshot.fields.map((value, index) => (
                      <option key={value.id} value={value.id}>
                        {index + 1}. {value.name}
                        {value.format ? ` · ${value.format.toUpperCase()}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="tag-field">
                  目标语言
                  <input
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    placeholder="zh-Hans"
                  />
                </label>
              </div>
              {field.error && <p className="tag-note">{field.error}</p>}
              {field.format && (
                <>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={overwrite}
                      onChange={(e) => {
                        setOverwrite(e.target.checked);
                        if (!e.target.checked) {
                          setReplaceIds([]);
                          setMatched(null);
                        }
                      }}
                    />
                    替换已确认的旧译文
                  </label>
                  <details className="embedded-tools">
                    <summary>AI 翻译</summary>
                    <p className="tag-note">
                      所选服务会收到歌曲名称、歌手和逐行原词。请核对译文后写回。
                    </p>
                    <form
                      className="embedded-ai"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void run("正在翻译", async () => {
                          const result = await window.sonora.tagTranslateLyrics(
                            {
                              baseURL,
                              protocol,
                              model,
                              key,
                              language,
                              song: { title: item.title, artist: item.artist },
                              lines: lines.map((line) => ({
                                id: line.id,
                                text: line.text,
                                wanted:
                                  !draft[line.id]?.trim() &&
                                  (overwrite ||
                                    !line.translations?.[
                                      language.toLowerCase()
                                    ]),
                              })),
                            },
                          );
                          setDraft((previous) => ({ ...previous, ...result }));
                          setStatus("译文已加入草稿，请核对后写回");
                        });
                      }}
                    >
                      <label className="tag-field">
                        API Base URL
                        <input
                          required
                          value={baseURL}
                          onChange={(e) => setBaseURL(e.target.value)}
                        />
                      </label>
                      <label className="tag-field">
                        协议
                        <select
                          value={protocol}
                          onChange={(e) => setProtocol(e.target.value)}
                        >
                          <option value="responses">Responses</option>
                          <option value="chat">Chat Completions</option>
                        </select>
                      </label>
                      <label className="tag-field">
                        模型 ID
                        <input
                          required
                          value={model}
                          onChange={(e) => setModel(e.target.value)}
                        />
                      </label>
                      <label className="tag-field">
                        API Key
                        <input
                          type="password"
                          autoComplete="off"
                          value={key}
                          onChange={(e) => setKey(e.target.value)}
                        />
                      </label>
                      <button className="button primary">生成译文草稿</button>
                    </form>
                  </details>
                  <details className="embedded-tools">
                    <summary>粘贴并匹配</summary>
                    <textarea
                      className="tag-lyrics-editor embedded-paste"
                      aria-label="粘贴歌词或译文"
                      value={pasted}
                      maxLength={160000}
                      onChange={(e) => {
                        setPasted(e.target.value);
                        setMatched(null);
                      }}
                      placeholder="粘贴纯译文、双语歌词或带时间戳的 LRC"
                    />
                    <div className="inline-actions">
                      <button
                        className="button secondary"
                        onClick={() => setSearch(true)}
                      >
                        搜索在线歌词
                      </button>
                      {online.length > 0 && (
                        <button
                          className="text-button"
                          onClick={() => {
                            setOnline([]);
                            setMatched(null);
                          }}
                        >
                          清除在线片段（{online.length} 行）
                        </button>
                      )}
                      <label className="tag-field">
                        时间偏移（毫秒）
                        <input
                          className="embedded-offset"
                          type="number"
                          value={offset}
                          onChange={(e) => {
                            setOffset(Number(e.target.value) || 0);
                            setMatched(null);
                          }}
                        />
                      </label>
                      <button className="button primary" onClick={match}>
                        本地匹配
                      </button>
                    </div>
                    {matched && (
                      <>
                        <p className="tag-note">
                          已匹配 {matched.alignments.length} / {lines.length}{" "}
                          行。可手动选择对应片段。
                        </p>
                        <div className="embedded-review">
                          {lines.map((line) => {
                            const alignment = matched.alignments.find(
                              (row) => row.id === line.id,
                            );
                            return (
                              <label className="tag-field" key={line.id}>
                                <span>
                                  {line.time} · {line.text}
                                  {alignment
                                    ? ` · ${evidence[alignment.evidence]}`
                                    : ""}
                                </span>
                                <select
                                  aria-label={`匹配片段 ${line.id}`}
                                  value={alignment?.fragments[0] ?? 0}
                                  onChange={(e) =>
                                    setAlignment(
                                      line.id,
                                      Number(e.target.value),
                                    )
                                  }
                                >
                                  <option value={0}>跳过此行</option>
                                  {matched.rows.map((row) => (
                                    <option key={row.index} value={row.index}>
                                      {row.index}. {row.text}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            );
                          })}
                        </div>
                        {matched.alignments.length > 0 && (
                          <button
                            className="button secondary"
                            onClick={() => {
                              const rows = new Map(
                                matched.rows.map((row) => [
                                  row.index,
                                  row.text,
                                ]),
                              );
                              setDraft((previous) => ({
                                ...previous,
                                ...Object.fromEntries(
                                  matched.alignments.map((row) => [
                                    row.id,
                                    rows.get(row.fragments[0]) ?? "",
                                  ]),
                                ),
                              }));
                              setMatched(null);
                              setStatus("匹配译文已加入草稿");
                            }}
                          >
                            应用到译文草稿
                          </button>
                        )}
                      </>
                    )}
                  </details>
                  <div className="embedded-review" aria-label="原词与译文草稿">
                    {field.lines.map((line) => (
                      <div className="embedded-line" key={line.id}>
                        <div>
                          <small>{line.time}</small>
                          <p>{line.text}</p>
                          {line.translations?.[language.toLowerCase()] && (
                            <small>
                              已有译文 ·{" "}
                              {line.translations[language.toLowerCase()]}
                            </small>
                          )}
                        </div>
                        {replaceIds.includes(line.id) ? (
                          <small>已标记为旧译文</small>
                        ) : (
                          <input
                            aria-label={`译文 ${line.id}`}
                            value={draft[line.id] ?? ""}
                            placeholder="译文草稿"
                            onChange={(e) =>
                              setDraft((previous) => ({
                                ...previous,
                                [line.id]: e.target.value,
                              }))
                            }
                          />
                        )}
                        {overwrite && !!line.sameTimeCandidates?.length && (
                          <label className="checkbox-label">
                            <input
                              type="checkbox"
                              checked={replaceIds.includes(line.id)}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setReplaceIds((previous) =>
                                  checked
                                    ? [...previous, line.id]
                                    : previous.filter((id) => id !== line.id),
                                );
                                setMatched(null);
                              }}
                            />
                            此行是旧译文
                          </label>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </fieldset>
            <p className="tag-note" role="status">
              {busy || status}
            </p>
            <div className="modal-footer">
              <button
                className="button secondary"
                disabled={!!busy}
                onClick={() => setConfirm("remove")}
              >
                删除此字段
              </button>
              <button
                className="button primary"
                disabled={!!busy || !field.format || !dirty}
                onClick={() => setConfirm("write")}
              >
                写回原字段
              </button>
            </div>
          </>
        )}
      </Modal>
      {search && (
        <OnlineLyrics
          item={item}
          onClose={() => setSearch(false)}
          onAdd={(rows) => {
            setOnline((previous) => [...previous, ...rows]);
            setMatched(null);
            setSearch(false);
            setStatus(`已加入 ${rows.length} 行在线歌词，可继续匹配`);
          }}
        />
      )}
      {confirm && (
        <Modal
          title={
            confirm === "remove"
              ? "删除选中的歌词字段？"
              : confirm === "write"
                ? "写回选中的歌词字段？"
                : "放弃当前译文草稿？"
          }
          onClose={() => setConfirm(null)}
        >
          {(confirm === "write" || confirm === "remove") && (
            <p className="tag-note">
              {item.title} · {field?.name}
            </p>
          )}
          <div className="modal-footer">
            <button
              className="button secondary"
              onClick={() => setConfirm(null)}
            >
              返回编辑
            </button>
            <button
              className="button primary"
              onClick={() => {
                const action = confirm;
                setConfirm(null);
                if (action === "close") {
                  onClose();
                  return;
                }
                if (action === "switch") {
                  selectField(nextField);
                  return;
                }
                if (!snapshot || !field) return;
                void run("正在校验并保存", async () => {
                  await onSave({
                    revision: snapshot.revision,
                    fieldId,
                    language,
                    overwrite,
                    translations: Object.fromEntries(
                      lines
                        .filter((line) => draft[line.id]?.trim())
                        .map((line) => [line.id, draft[line.id]]),
                    ),
                    lrcReplaceIds: replaceIds,
                    remove: action === "remove",
                  });
                });
              }}
            >
              {confirm === "write"
                ? "确认写回"
                : confirm === "remove"
                  ? "确认删除"
                  : "放弃草稿"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
