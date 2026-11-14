import { useEffect, useState } from "react";
import type { API, Item } from "../types";
import { Busy, Modal } from "../ui";
import { localAlignment, readPaste, referenceRows } from "./align";
import { classifyLrc, existingLrcTranslations } from "./source-lines";
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
  deepseek: "DeepSeek 建议，需核对",
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
  const [roles, setRoles] = useState<
    Record<string, "source" | "translation" | "review">
  >({});
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
  const [deepSeekKey, setDeepSeekKey] = useState("");
  const [deepSeekModel, setDeepSeekModel] = useState("deepseek-flash");
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
  const classifications = { ...classifyLrc(field), ...roles };
  const lines =
    field?.lines.filter(
      (line) => (classifications[line.id] ?? "source") === "source",
    ) ?? [];
  const marked = new Set(
    Object.keys(classifications).filter(
      (id) => classifications[id] !== "source",
    ),
  );
  const companions = existingLrcTranslations(
    field?.lines ?? [],
    marked,
    new Set(lines.map((line) => line.id)),
  );
  const existing = (id: string) =>
    field?.lines.find((line) => line.id === id)?.translations?.[
      language.toLowerCase()
    ] ||
    companions
      .get(id)
      ?.map((row) => row.text)
      .join(" / ") ||
    "";
  const writable = (id: string) =>
    !(companions.get(id) ?? []).some(
      (row) => classifications[row.id] === "review",
    ) &&
    (overwrite || !existing(id));
  const dirty = lines.some(
    (line) => writable(line.id) && draft[line.id]?.trim(),
  );
  const hasEdits = Object.values(draft).some((text) => text.trim());
  const hasDraft = hasEdits || !!pasted.trim();
  const requestClose = () => {
    if (busy) return;
    if (hasDraft) setConfirm("close");
    else onClose();
  };
  function selectField(id: string) {
    setFieldId(id);
    setDraft({});
    setRoles({});
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
  function match(text = pasted, prepared = online, deepSeek = false) {
    const rows = prepared.length ? prepared : readPaste(text);
    if (!rows.length || rows.length > 1500 || lines.length > 5000) {
      setError("请提供可匹配文本。每次最多匹配 1500 条片段和 5000 行原词。");
      return;
    }
    setError("");
    const proposals = localAlignment(lines, rows, offset);
    if (!deepSeek) {
      setMatched({ rows, alignments: proposals });
      return;
    }
    const anchors = proposals.filter((row) => row.evidence !== "order");
    const ids = new Set(anchors.map((row) => row.id));
    const used = new Set([
      ...referenceRows(lines, rows),
      ...anchors.flatMap((row) => row.fragments),
    ]);
    const pending = lines.filter((row) => !ids.has(row.id) && writable(row.id));
    const fragments = rows.filter((row) => !used.has(row.index));
    if (!pending.length || !fragments.length) {
      setMatched({ rows, alignments: proposals });
      setStatus("已按本地规则匹配，可继续核对");
      return;
    }
    setMatched({ rows, alignments: anchors });
    void run("正在用 DeepSeek 匹配", async () => {
      const suggested = await window.sonora.tagMatchDeepSeek({
        title: item.title,
        artist: item.artist,
        key: deepSeekKey,
        model: deepSeekModel,
        lines: pending.map(({ id, text }) => ({ id, text })),
        fragments,
      });
      setMatched({ rows, alignments: [...anchors, ...suggested] });
    });
  }
  function addText(text: string) {
    if (!text.trim()) {
      setError("剪贴板没有可匹配的文本");
      return;
    }
    if (text.length > 160000) {
      setError("歌词文本超过 160000 字符");
      return;
    }
    setPasted(text);
    setOnline([]);
    setMatched(null);
    match(text, []);
  }
  function setAlignment(id: string, index: number) {
    if (index < 0) return;
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
                      if (hasEdits) {
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
                      onChange={(e) => setOverwrite(e.target.checked)}
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
                                  !draft[line.id]?.trim() && writable(line.id),
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
                  <section className="embedded-tools" aria-label="粘贴并匹配">
                    <div className="inline-actions">
                      <button
                        className="button primary"
                        onClick={() =>
                          void run("正在读取剪贴板", async () => {
                            addText(await window.sonora.pasteLyrics());
                          })
                        }
                      >
                        粘贴并匹配
                      </button>
                      <button
                        className="button secondary"
                        onClick={() => setSearch(true)}
                      >
                        搜索在线歌词
                      </button>
                    </div>
                    <textarea
                      className="tag-lyrics-editor embedded-paste"
                      aria-label="粘贴歌词或译文"
                      value={pasted}
                      maxLength={160000}
                      onChange={(e) => {
                        setPasted(e.target.value);
                        setOnline([]);
                        setMatched(null);
                      }}
                      onPaste={(e) => {
                        const text = e.clipboardData.getData("text");
                        if (!text) return;
                        e.preventDefault();
                        const target = e.currentTarget;
                        addText(
                          target.value.slice(0, target.selectionStart) +
                            text +
                            target.value.slice(target.selectionEnd),
                        );
                      }}
                      placeholder="粘贴纯译文、双语歌词或带时间戳的 LRC"
                    />
                    <div className="inline-actions">
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
                      <button
                        className="button secondary"
                        onClick={() => match()}
                      >
                        本地匹配
                      </button>
                    </div>
                    <details className="embedded-tools">
                      <summary>DeepSeek API 匹配</summary>
                      <p className="tag-note">
                        将未匹配的原词和候选译文发送给
                        DeepSeek。结果可核对后应用。
                      </p>
                      <div className="inline-actions">
                        <label className="tag-field">
                          DeepSeek API Key
                          <input
                            type="password"
                            autoComplete="off"
                            value={deepSeekKey}
                            onChange={(e) => setDeepSeekKey(e.target.value)}
                          />
                        </label>
                        <label className="tag-field">
                          DeepSeek 模型
                          <input
                            value={deepSeekModel}
                            onChange={(e) => setDeepSeekModel(e.target.value)}
                          />
                        </label>
                        <button
                          className="button secondary"
                          disabled={
                            !pasted.trim() ||
                            !deepSeekKey.trim() ||
                            !deepSeekModel.trim()
                          }
                          onClick={() => match(pasted, online, true)}
                        >
                          使用 DeepSeek 匹配
                        </button>
                      </div>
                    </details>
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
                                  value={
                                    alignment && alignment.fragments.length > 1
                                      ? -1
                                      : (alignment?.fragments[0] ?? 0)
                                  }
                                  onChange={(e) =>
                                    setAlignment(
                                      line.id,
                                      Number(e.target.value),
                                    )
                                  }
                                >
                                  <option value={0}>跳过此行</option>
                                  {alignment &&
                                    alignment.fragments.length > 1 && (
                                      <option value={-1}>
                                        {alignment.fragments
                                          .map(
                                            (index) =>
                                              matched.rows.find(
                                                (row) => row.index === index,
                                              )?.text,
                                          )
                                          .join(" ")}
                                      </option>
                                    )}
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
                                    row.fragments
                                      .map((index) => rows.get(index))
                                      .filter(Boolean)
                                      .join(" "),
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
                  </section>
                  <div className="embedded-review" aria-label="原词与译文草稿">
                    {lines.map((line) => (
                      <div className="embedded-line" key={line.id}>
                        <div>
                          <small>{line.time}</small>
                          <p>{line.text}</p>
                          {existing(line.id) && (
                            <small>已有译文 · {existing(line.id)}</small>
                          )}
                        </div>
                        <input
                          aria-label={`译文 ${line.id}`}
                          value={draft[line.id] ?? ""}
                          disabled={!writable(line.id)}
                          placeholder="译文草稿"
                          onChange={(e) =>
                            setDraft((previous) => ({
                              ...previous,
                              [line.id]: e.target.value,
                            }))
                          }
                        />
                      </div>
                    ))}
                  </div>
                  {field.lines.some(
                    (line) => line.sameTimeCandidates?.length,
                  ) && (
                    <details className="embedded-tools">
                      <summary>
                        核对同时间戳歌词（{marked.size} 行已有译文或待核对）
                      </summary>
                      <div className="embedded-review">
                        {field.lines
                          .filter((line) => line.sameTimeCandidates?.length)
                          .map((line) => (
                            <label key={line.id} className="tag-field">
                              <span>
                                {line.time} · {line.text}
                              </span>
                              <select
                                aria-label={`歌词行角色 ${line.id}`}
                                value={classifications[line.id] ?? "source"}
                                onChange={(e) => {
                                  const role = e.target.value as
                                    "source" | "translation" | "review";
                                  setRoles((previous) => ({
                                    ...previous,
                                    [line.id]: role,
                                  }));
                                  setMatched(null);
                                }}
                              >
                                <option value="source">原词</option>
                                <option value="translation">已有译文</option>
                                <option value="review">待核对，保留原样</option>
                              </select>
                            </label>
                          ))}
                      </div>
                    </details>
                  )}
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
            const combined = [
              ...(online.length ? online : readPaste(pasted)),
              ...rows,
            ].map((row, index) => ({ ...row, index: index + 1 }));
            const visible = combined
              .map((row) =>
                row.milliseconds === null
                  ? row.text
                  : `[${Math.floor(Math.max(0, row.milliseconds) / 60000)}:${((Math.max(0, row.milliseconds) % 60000) / 1000).toFixed(3).padStart(6, "0")}]${row.text}`,
              )
              .join("\n");
            setPasted(visible);
            setOnline(combined);
            match(visible, combined);
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
                        .filter(
                          (line) => writable(line.id) && draft[line.id]?.trim(),
                        )
                        .map((line) => [line.id, draft[line.id]]),
                    ),
                    lrcReplaceIds: overwrite
                      ? lines
                          .filter(
                            (line) =>
                              writable(line.id) && draft[line.id]?.trim(),
                          )
                          .flatMap((line) =>
                            (companions.get(line.id) ?? []).map(
                              (row) => row.id,
                            ),
                          )
                      : [],
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
