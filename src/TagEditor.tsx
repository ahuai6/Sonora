import { useEffect, useState, useRef } from "react";
import {
  Search,
  Save,
  ImagePlus,
  FileText,
  Undo2,
  Loader2,
  Check,
  Trash2,
  Music2,
} from "lucide-react";
import type {
  Item,
  MusicTags,
  TagSnapshot,
  TagCandidate,
  TagSaveResult,
} from "./types";
import { Modal, Artwork, Busy, duration } from "./ui";

const fields = [
  ["title", "曲名"],
  ["artist", "歌手"],
  ["album", "专辑"],
  ["albumArtist", "专辑歌手"],
  ["year", "年份"],
  ["genre", "流派"],
  ["track", "曲序"],
  ["trackCount", "总曲数"],
  ["disc", "碟序"],
  ["discCount", "总碟数"],
  ["composer", "作曲"],
  ["isrc", "ISRC"],
];
const numeric = new Set([
  "year",
  "track",
  "trackCount",
  "disc",
  "discCount",
  "bpm",
]);
export default function TagEditor({
  item,
  onClose,
  onSaved,
  beforeSave,
  notify,
}: {
  item: Item;
  onClose: () => void;
  onSaved: (result: TagSaveResult) => void;
  beforeSave: () => void;
  notify: (message: string, error?: boolean) => void;
}) {
  const [snapshot, setSnapshot] = useState<TagSnapshot | null>(null),
    [tags, setTags] = useState<MusicTags>({}),
    [lyrics, setLyrics] = useState(""),
    [writeLyrics, setWriteLyrics] = useState(false),
    [cover, setCover] = useState<string | null | undefined>(undefined),
    [tab, setTab] = useState("tags");
  const [query, setQuery] = useState(`${item.title} ${item.artist}`.trim()),
    [source, setSource] = useState("all"),
    [matches, setMatches] = useState<TagCandidate[]>([]),
    [errors, setErrors] = useState<string[]>([]),
    [busy, setBusy] = useState(""),
    [searching, setSearching] = useState(false),
    [error, setError] = useState(""),
    [dirty, setDirty] = useState(false),
    [format, setFormat] = useState("auto"),
    [bilingual, setBilingual] = useState(true),
    [lyricSource, setLyricSource] = useState(""),
    [coverUrl, setCoverUrl] = useState(""),
    [confirmClose, setConfirmClose] = useState(false);
  const generation = useRef(0),
    mounted = useRef(true),
    editedFields = useRef(new Set<string>());
  useEffect(() => {
    mounted.current = true;
    window.sonora
      .tagRead(item.id)
      .then(load)
      .catch((e) => setError(e.message));
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, [item.id]);
  function load(s: TagSnapshot) {
    editedFields.current.clear();
    setSnapshot(s);
    setTags({
      ...s.tags,
      title: s.tags.title || item.title,
      artist: s.tags.artist || item.artist,
      album: s.tags.album || item.album,
    });
    setLyrics(s.lyrics);
    setWriteLyrics(false);
    setCover(undefined);
    setDirty(false);
    setLyricSource(s.lyrics ? "文件内嵌歌词" : "");
    if (!s.writable)
      setError(
        s.warning || "此文件目前不支持安全写入标签，可先核对文件格式和完整性。",
      );
  }
  function change(key: string, value: string) {
    editedFields.current.add(key);
    setTags((t) => ({
      ...t,
      [key]: numeric.has(key) ? (value === "" ? "" : Number(value)) : value,
    }));
    setDirty(true);
  }
  async function action(name: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(name);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (mounted.current) setBusy("");
    }
  }
  async function search() {
    if (searching) return;
    const gen = ++generation.current;
    setSearching(true);
    setErrors([]);
    try {
      const r = await window.sonora.tagSearch({
        localId: item.id,
        query,
        source,
      });
      if (gen === generation.current) {
        setMatches(r.items);
        setErrors(r.errors.map((e) => e.source + "：" + e.message));
      }
    } catch (e) {
      setErrors([(e as Error).message]);
    } finally {
      if (gen === generation.current) setSearching(false);
    }
  }
  function adopt(c: TagCandidate) {
    Object.entries(c.tags)
      .filter(([, v]) => v !== "" && v !== 0)
      .forEach(([key]) => editedFields.current.add(key));
    setTags((t) => ({
      ...t,
      ...Object.fromEntries(
        Object.entries(c.tags).filter(([, v]) => v !== "" && v !== 0),
      ),
    }));
    setDirty(true);
    notify("已填入候选标签，可继续修改后保存");
  }
  async function artwork(url?: string) {
    const r = await window.sonora.tagArtwork(url);
    if (r) {
      setCover(r.dataUrl);
      setDirty(true);
    }
  }
  async function matchCover(c: TagCandidate) {
    const r = await window.sonora.tagMatchCover(c.matchId);
    if (r) {
      setCover(r.dataUrl);
      setDirty(true);
      notify("封面已载入，保存后写入文件");
    }
  }
  async function matchLyrics(c: TagCandidate) {
    const r = await window.sonora.tagMatchLyrics(c.matchId, {
      format,
      bilingual,
    });
    setLyrics(r.text);
    setWriteLyrics(true);
    setLyricSource(r.source);
    setDirty(true);
    setTab("lyrics");
    notify("歌词已载入，可编辑后内嵌");
  }
  async function save() {
    if (!snapshot) return;
    await action("save", async () => {
      beforeSave();
      const result = await window.sonora.tagSave(item.id, {
        revision: snapshot.revision,
        tags: Object.fromEntries(
          Object.entries(tags).filter(([key]) => editedFields.current.has(key)),
        ),
        ...(writeLyrics ? { lyrics } : {}),
        ...(cover !== undefined ? { artwork: cover } : {}),
      });
      onSaved(result);
      load(result.editor);
      notify("标签、封面和歌词已保存，原文件已备份");
    });
  }
  const requestClose = () => {
    if (busy) return;
    dirty ? setConfirmClose(true) : onClose();
  };
  return (
    <Modal
      title="编辑音乐标签"
      subtitle={`${item.format} · ${duration(item.duration)} · ${item.path}`}
      onClose={requestClose}
      wide
    >
      <div className="tag-editor">
        {!snapshot && !error ? (
          <Busy text="正在读取音频标签" />
        ) : (
          <>
            <div className="tag-editor-layout">
              <aside className="tag-cover-panel">
                <Artwork
                  item={{
                    title: String(tags.title || item.title),
                    cover:
                      cover === undefined ? snapshot?.cover || "" : cover || "",
                  }}
                  className="tag-cover"
                />
                <div className="tag-cover-actions">
                  <button
                    className="button secondary compact"
                    disabled={!!busy}
                    onClick={() => action("cover", () => artwork())}
                  >
                    <ImagePlus size={15} />
                    选择图片
                  </button>
                  <button
                    className="icon-button"
                    title="移除内嵌封面"
                    aria-label="移除内嵌封面"
                    disabled={!!busy}
                    onClick={() => {
                      setCover(null);
                      setDirty(true);
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <label className="tag-field">
                  <span>封面图片地址</span>
                  <input
                    aria-label="封面图片地址"
                    placeholder="https://…"
                    value={coverUrl}
                    onChange={(e) => setCoverUrl(e.target.value)}
                  />
                </label>
                <button
                  className="text-button"
                  disabled={!!busy || !coverUrl.trim()}
                  onClick={() =>
                    action("cover", () => artwork(coverUrl.trim()))
                  }
                >
                  载入网络封面
                </button>
                <p className="tag-note">
                  支持 JPEG / PNG / WebP，可使用在线匹配的专辑封面。
                </p>
                <div className="tag-storage-note">
                  <Music2 size={16} />
                  <span>
                    保存会写入音频文件，不重新编码，并保留可恢复的原文件备份。
                  </span>
                </div>
              </aside>
              <div className="tag-main">
                <div className="tabs tag-tabs">
                  {[
                    ["tags", "基本标签"],
                    ["match", "在线匹配"],
                    ["lyrics", "内嵌歌词"],
                  ].map(([id, name]) => (
                    <button
                      key={id}
                      className={tab === id ? "active" : ""}
                      onClick={() => setTab(id)}
                    >
                      {name}
                    </button>
                  ))}
                </div>
                {tab === "tags" && (
                  <div className="tag-fields">
                    {fields.map(([key, name]) => (
                      <label className="tag-field" key={key}>
                        <span>{name}</span>
                        <input
                          aria-label={`标签${name}`}
                          type={numeric.has(key) ? "number" : "text"}
                          min={0}
                          max={65535}
                          value={tags[key] ?? ""}
                          onChange={(e) => change(key, e.target.value)}
                          disabled={!!busy}
                        />
                      </label>
                    ))}
                    <label className="tag-field tag-span">
                      <span>备注</span>
                      <textarea
                        aria-label="标签备注"
                        rows={3}
                        value={tags.comment || ""}
                        onChange={(e) => change("comment", e.target.value)}
                        disabled={!!busy}
                      />
                    </label>
                    <p className="tag-note tag-span">
                      多个歌手、作曲者或流派使用英文分号分隔。未编辑的其他标签会保留。
                    </p>
                  </div>
                )}
                {tab === "match" && (
                  <div className="tag-match">
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        search();
                      }}
                    >
                      <input
                        aria-label="标签匹配关键词"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="曲名 / 歌手 / 专辑"
                      />
                      <select
                        aria-label="标签匹配来源"
                        value={source}
                        onChange={(e) => setSource(e.target.value)}
                      >
                        <option value="all">聚合匹配</option>
                        <option value="netease">网易云</option>
                        <option value="qq">QQ 音乐</option>
                        <option value="kugou">酷狗</option>
                        <option value="musicbrainz">MusicBrainz</option>
                        <option value="lrclib">LRCLIB 歌词库</option>
                      </select>
                      <button
                        className="button primary compact"
                        disabled={searching || !query.trim()}
                      >
                        {searching ? (
                          <Loader2 size={15} className="spin" />
                        ) : (
                          <Search size={15} />
                        )}
                        搜索
                      </button>
                    </form>
                    <p className="tag-note">
                      先核对曲名、版本和时长，再分别采用标签、封面或歌词。MusicBrainz
                      封面来自 Cover Art Archive。
                    </p>
                    {errors.length > 0 && (
                      <details className="tag-errors">
                        <summary>部分来源未完成</summary>
                        {errors.map((s, i) => (
                          <p key={i}>{s}</p>
                        ))}
                      </details>
                    )}
                    <div className="tag-candidates">
                      {matches.map((c) => (
                        <article className="tag-candidate" key={c.matchId}>
                          <Artwork
                            item={{ cover: c.cover, title: c.title }}
                            size="small"
                          />
                          <div className="tag-candidate-info">
                            <strong>{c.title}</strong>
                            <span>
                              {c.artist} · {c.album || "未提供专辑"}
                            </span>
                            <small>
                              {c.sourceName} · {duration(c.duration)}
                              {c.durationDifference !== null &&
                              c.durationDifference > 3
                                ? ` · 时长相差 ${Math.round(c.durationDifference)} 秒，请核对版本`
                                : ""}
                            </small>
                            <div className="inline-actions">
                              <button
                                className="text-button"
                                disabled={!!busy}
                                onClick={() => adopt(c)}
                              >
                                <Check size={13} />
                                采用标签
                              </button>
                              {(c.cover || c.releaseId) && (
                                <button
                                  className="text-button"
                                  disabled={!!busy}
                                  onClick={() =>
                                    action(c.matchId, () => matchCover(c))
                                  }
                                >
                                  采用封面
                                </button>
                              )}
                              {c.source !== "musicbrainz" && (
                                <button
                                  className="text-button"
                                  disabled={!!busy}
                                  onClick={() =>
                                    action(c.matchId, () => matchLyrics(c))
                                  }
                                >
                                  <FileText size={13} />
                                  获取歌词
                                </button>
                              )}
                            </div>
                          </div>
                        </article>
                      ))}
                      {!matches.length && !searching && (
                        <p className="tag-match-empty">
                          选择来源并搜索，结果会显示在这里。
                        </p>
                      )}
                    </div>
                  </div>
                )}
                {tab === "lyrics" && (
                  <div className="tag-lyrics">
                    <div className="inline-actions">
                      <select
                        aria-label="匹配歌词格式"
                        value={format}
                        onChange={(e) => setFormat(e.target.value)}
                      >
                        <option value="auto">自动（优先逐字 LRC）</option>
                        <option value="lrc">逐行 LRC</option>
                        <option value="elrc">逐字 LRC</option>
                        <option value="ttml">TTML</option>
                      </select>
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={bilingual}
                          onChange={(e) => setBilingual(e.target.checked)}
                        />
                        合并同时间戳翻译
                      </label>
                    </div>
                    <p className="tag-note">
                      从“在线匹配”选择平台结果并获取歌词，或在下方手动编写。格式与翻译选项用于下一次获取。
                    </p>
                    <textarea
                      className="tag-lyrics-editor"
                      aria-label="内嵌歌词内容"
                      spellCheck={false}
                      value={lyrics}
                      placeholder="可填写纯文本、LRC、逐字 LRC 或 TTML…"
                      onChange={(e) => {
                        setLyrics(e.target.value);
                        setWriteLyrics(true);
                        setDirty(true);
                      }}
                      disabled={!!busy}
                    />
                    <div className="tag-lyrics-footer">
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={writeLyrics}
                          onChange={(e) => {
                            setWriteLyrics(e.target.checked);
                            setDirty(true);
                          }}
                        />
                        将此歌词写入音频
                      </label>
                      <button
                        className="text-button"
                        disabled={!!busy}
                        onClick={() => {
                          setLyrics("");
                          setWriteLyrics(true);
                          setDirty(true);
                        }}
                      >
                        清除内嵌歌词
                      </button>
                    </div>
                    <p className="tag-note">
                      {lyricSource || "手动编辑"} ·
                      写入文件的歌词文本标签；播放器是否识别时间轴取决于播放器支持。
                    </p>
                  </div>
                )}
              </div>
            </div>
            {(error || snapshot?.warning) && (
              <p className="tag-error" role="alert">
                {error || snapshot?.warning}
              </p>
            )}
            {confirmClose && (
              <div className="tag-discard">
                <span>尚有未保存的修改。</span>
                <button
                  className="text-button"
                  onClick={() => setConfirmClose(false)}
                >
                  继续编辑
                </button>
                <button className="text-button" onClick={onClose}>
                  放弃修改并关闭
                </button>
              </div>
            )}
            <div className="modal-footer tag-footer">
              <button
                className="button secondary compact"
                disabled={!!busy || !snapshot?.backupAvailable}
                onClick={() =>
                  action("restore", async () => {
                    if (!snapshot) return;
                    beforeSave();
                    const result = await window.sonora.tagRestore(
                      item.id,
                      snapshot.revision,
                    );
                    onSaved(result);
                    load(result.editor);
                    notify("已恢复上一次保存前的文件");
                  })
                }
              >
                <Undo2 size={15} />
                恢复上次备份
              </button>
              <div className="inline-actions">
                <button
                  className="button secondary"
                  disabled={!!busy}
                  onClick={requestClose}
                >
                  取消
                </button>
                <button
                  className="button primary"
                  disabled={!!busy || !snapshot?.writable || !dirty}
                  onClick={save}
                >
                  {busy ? (
                    <Loader2 size={16} className="spin" />
                  ) : (
                    <Save size={16} />
                  )}
                  保存到文件
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
