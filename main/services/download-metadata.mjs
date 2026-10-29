import { present, EXTENDED_TAG_FIELDS } from "./metadata-tags.mjs";

// Only use the exact source identity from the download; never adopt a fuzzy search hit.
export class DownloadMetadata {
  constructor(matcher, tagEditor, { artwork, timeout = 20000 } = {}) {
    this.matcher = matcher;
    this.tagEditor = tagEditor;
    this.artwork = artwork;
    this.timeout = timeout;
  }
  async prepare(file, extension, track, { signal } = {}) {
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
    let tags = present({
      title: track.title,
      artist: track.artist,
      album: track.album,
    });
    const warnings = [];
    let cover;
    await Promise.all([
      untilAborted(this.matcher.forTrack(track))
        .then((details) => {
          tags = { ...tags, ...present(details.tags) };
          warnings.push(...details.warnings);
        })
        .catch(() => warnings.push("歌曲详情未取得，已使用下载信息中的标签")),
      track.cover && this.artwork
        ? untilAborted(this.artwork(track.cover, { signal: bounded }))
            .then((r) => {
              cover = r?.dataUrl;
            })
            .catch(() => warnings.push("封面未取得"))
        : Promise.resolve(),
    ]);
    signal?.throwIfAborted();
    const staged = await this.tagEditor.stageDownload(
      file,
      extension,
      {
        tags,
        ...(cover ? { artwork: cover } : {}),
      },
      { signal },
    );
    return {
      file: staged,
      metadata: {
        status: warnings.length ? "partial" : "written",
        warnings,
        missingFields: EXTENDED_TAG_FIELDS.filter((key) => !tags[key]),
      },
    };
  }
}
