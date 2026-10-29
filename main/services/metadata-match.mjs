import { randomUUID } from "node:crypto";
import { jsonRequest } from "../core/transport.mjs";
import { httpUrl } from "../core/models.mjs";
import { lyricDocument, exportLyrics } from "./lyrics.mjs";
const names = (credits) =>
  (credits || [])
    .map((c) => (c.name || c.artist?.name || "") + (c.joinphrase || ""))
    .join("");
const quoted = (s) => '"' + String(s).replace(/["\\]/g, " ").trim() + '"';
const ua = {
  "User-Agent":
    "Sonora/1.1 (music-tag-editor; https://github.com/ahuai6/Sonora)",
};
export class MetadataMatcher {
  constructor(providers, library) {
    this.providers = providers;
    this.library = library;
    this.candidates = new Map();
    this.mbQueue = Promise.resolve();
    this.lastMb = 0;
  }
  source(id) {
    const overrides = this.providers.config.metadataSources || {};
    return (
      overrides[id] ||
      {
        musicbrainz: "https://musicbrainz.org/ws/2",
        coverart: "https://coverartarchive.org",
        lrclib: "https://lrclib.net/api",
      }[id]
    );
  }
  async mb(route, params) {
    const job = this.mbQueue
      .catch(() => {})
      .then(async () => {
        const wait = 1100 - (Date.now() - this.lastMb);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        this.lastMb = Date.now();
        return jsonRequest(this.source("musicbrainz") + route, {
          params: { fmt: "json", ...params },
          headers: ua,
          timeout: 16000,
        });
      });
    this.mbQueue = job;
    return job;
  }
  keep(candidate) {
    const matchId = randomUUID();
    this.candidates.set(matchId, { ...candidate, createdAt: Date.now() });
    while (this.candidates.size > 200)
      this.candidates.delete(this.candidates.keys().next().value);
    const { track, record, createdAt, ...publicData } = candidate;
    return { ...publicData, matchId };
  }
  known(id) {
    const c = this.candidates.get(id);
    if (!c || Date.now() - c.createdAt > 20 * 60000)
      throw Error("匹配结果已过期，请重新搜索");
    return c;
  }
  async search({ localId, query = "", source = "all" }) {
    const local = this.library.known(localId);
    query =
      String(query).trim().slice(0, 200) ||
      `${local.title} ${local.artist}`.trim();
    if (!query) throw Error("请输入曲名或歌手");
    const sources =
      source === "all" ? ["netease", "qq", "kugou", "musicbrainz"] : [source];
    if (
      sources.some(
        (s) => !["netease", "qq", "kugou", "musicbrainz", "lrclib"].includes(s),
      )
    )
      throw Error("不支持的元数据来源");
    const results = await Promise.allSettled(
      sources.map(async (s) => {
        if (["netease", "qq", "kugou"].includes(s)) {
          const r = await this.providers.search({
            query,
            platform: s,
            kind: "song",
            limit: 12,
          });
          if (!r.items.length && r.errors.length)
            throw Error(r.errors.map((e) => e.message).join("；"));
          return r.items.map((track) => ({
            source: s,
            sourceName: { netease: "网易云", qq: "QQ 音乐", kugou: "酷狗" }[s],
            title: track.title,
            artist: track.artist,
            album: track.album,
            duration: track.duration,
            cover: track.cover,
            tags: {
              title: track.title,
              artist: track.artist,
              album: track.album,
            },
            track,
          }));
        }
        if (s === "lrclib") {
          const rows = await jsonRequest(this.source("lrclib") + "/search", {
            params: { q: query },
            headers: ua,
            timeout: 12000,
          });
          return (Array.isArray(rows) ? rows : []).slice(0, 15).map((r) => ({
            source: s,
            sourceName: "LRCLIB 歌词库",
            title: r.trackName,
            artist: r.artistName,
            album: r.albumName,
            duration: r.duration,
            cover: "",
            tags: {
              title: r.trackName,
              artist: r.artistName,
              album: r.albumName,
            },
            record: r,
          }));
        }
        const defaultQuery = `${local.title} ${local.artist}`.trim();
        const mbQuery =
          query === defaultQuery
            ? `recording:${quoted(local.title)}${local.artist ? ` AND artist:${quoted(local.artist)}` : ""}`
            : query;
        const b = await this.mb("/recording", { query: mbQuery, limit: 12 });
        return (b.recordings || []).flatMap((r) => {
          const releases = (r.releases || []).slice(0, 2);
          if (!releases.length) releases.push({});
          return releases.map((release) => ({
            source: s,
            sourceName: "MusicBrainz",
            title: r.title,
            artist: names(r["artist-credit"]),
            album: release.title || "",
            duration: (r.length || 0) / 1000,
            score: r.score,
            releaseId: release.id || "",
            cover: "",
            tags: {
              title: r.title,
              artist: names(r["artist-credit"]),
              ...(release.title ? { album: release.title } : {}),
              ...(release.date
                ? { year: Number(release.date.slice(0, 4)) || 0 }
                : {}),
              ...(release["artist-credit"]
                ? { albumArtist: names(release["artist-credit"]) }
                : {}),
              ...(r.isrcs?.[0] ? { isrc: r.isrcs[0] } : {}),
              musicBrainzTrackId: r.id,
              ...(release.id ? { musicBrainzReleaseId: release.id } : {}),
            },
          }));
        });
      }),
    );
    const items = [],
      errors = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled")
        items.push(
          ...r.value.map((c) =>
            this.keep({
              ...c,
              durationDifference:
                local.duration && c.duration
                  ? Math.abs(local.duration - c.duration)
                  : null,
            }),
          ),
        );
      else
        errors.push({
          source: sources[i],
          message: r.reason?.message || "请求失败",
        });
    });
    return { items, errors };
  }
  async cover(id) {
    const c = this.known(id);
    if (httpUrl(c.cover)) return c.cover;
    if (c.source !== "musicbrainz" || !c.releaseId)
      throw Error("此结果没有可用封面");
    const b = await jsonRequest(
      `${this.source("coverart")}/release/${encodeURIComponent(c.releaseId)}`,
      { headers: ua, timeout: 12000 },
    );
    const image = b.images?.find((i) => i.front) || b.images?.[0];
    const url = httpUrl(
      image?.thumbnails?.large || image?.thumbnails?.["500"] || image?.image,
    );
    if (!url) throw Error("此发行版本没有收录封面");
    c.cover = url;
    return url;
  }
  async lyrics(id, { format = "auto", bilingual = true } = {}) {
    const c = this.known(id);
    let doc;
    if (c.track) doc = await this.providers.lyrics(c.track);
    else if (c.source === "lrclib")
      doc = lyricDocument({
        original: c.record.syncedLyrics || c.record.plainLyrics || "",
        source: "LRCLIB",
      });
    else
      throw Error(
        "MusicBrainz 不提供歌词，请选择网易云、QQ、酷狗或 LRCLIB 的结果",
      );
    const out = exportLyrics(doc, { format, bilingual });
    return {
      text: out.text,
      format: out.extension,
      source: doc.source,
      hasWordTiming: !!doc.hasWordTiming,
    };
  }
}
