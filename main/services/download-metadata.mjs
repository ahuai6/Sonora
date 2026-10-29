import { present, EXTENDED_TAG_FIELDS } from "./metadata-tags.mjs";
import { exportLyrics } from "./lyrics.mjs";

// Only use the exact source identity from the download; never adopt a fuzzy search hit.
export class DownloadMetadata {
  constructor(matcher, tagEditor, { artwork, lyrics, timeout = 20000 } = {}) {
    this.matcher = matcher;
    this.tagEditor = tagEditor;
    this.artwork = artwork;
    this.lyrics = lyrics;
    this.timeout = timeout;
  }
  async prepare(file, extension, track, { signal, settings = {} } = {}) {
    signal?.throwIfAborted();
    const bounded = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(this.timeout)])
      : AbortSignal.timeout(this.timeout);
    const untilAborted = async (promise) => {
      bounded.throwIfAborted();
      let abort;
      try {
        return await Promise.race([
          promise,
          new Promise((_, reject) => {
            abort = () => reject(bounded.reason);
            bounded.addEventListener("abort", abort, { once: true });
          }),
        ]);
      } finally {
        bounded.removeEventListener("abort", abort);
      }
    };
    const matchTags = settings.autoMetadata !== false;
    const embedLyrics = !!settings.autoLyrics;
    let tags = matchTags
      ? present({
          title: track.title,
          artist: track.artist,
          album: track.album,
        })
      : {};
    const warnings = [];
    let cover, lyricText;
    await Promise.all([
      matchTags
        ? untilAborted(this.matcher.forTrack(track))
            .then((details) => {
              tags = { ...tags, ...present(details.tags) };
              warnings.push(...details.warnings);
            })
            .catch(() =>
              warnings.push("歌曲详情未取得，已使用下载信息中的标签"),
            )
        : Promise.resolve(),
      matchTags && track.cover && this.artwork
        ? untilAborted(this.artwork(track.cover, { signal: bounded }))
            .then((r) => {
              cover = r?.dataUrl;
            })
            .catch(() => warnings.push("封面未取得"))
        : Promise.resolve(),
      embedLyrics
        ? untilAborted(
            Promise.resolve().then(() => {
              if (!this.lyrics) throw Error("歌词接口不可用");
              return this.lyrics(track);
            }),
          )
            .then((doc) => {
              const exported = exportLyrics(doc, {
                format: settings.lyricFormat || "auto",
                bilingual: settings.saveTranslation !== false,
              });
              if (!exported.text.trim()) throw Error("没有可用歌词");
              // Text tag containers may trim their final newline; use one canonical form.
              lyricText = exported.text.replace(/\r\n/g, "\n").trimEnd();
            })
            .catch((e) => warnings.push("歌词未内嵌：" + e.message))
        : Promise.resolve(),
    ]);
    signal?.throwIfAborted();
    const staged =
      Object.keys(tags).length || cover || lyricText !== undefined
        ? await this.tagEditor.stageDownload(
            file,
            extension,
            {
              tags,
              ...(cover ? { artwork: cover } : {}),
              ...(lyricText !== undefined ? { lyrics: lyricText } : {}),
            },
            { signal },
          )
        : file;
    return {
      file: staged,
      metadata: {
        status: warnings.length ? "partial" : "written",
        warnings,
        missingFields: EXTENDED_TAG_FIELDS.filter((key) => !tags[key]),
        lyrics: embedLyrics
          ? lyricText !== undefined
            ? "embedded"
            : "unavailable"
          : "disabled",
      },
    };
  }
}
