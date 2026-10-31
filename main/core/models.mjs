import { EXTENDED_QUALITY } from "../providers/quality.mjs";
export const PLATFORMS = ["netease", "qq", "kugou"];
export const QUALITY = {
  standard: {
    level: "standard",
    br: 128000,
    kbps: 128,
    qqQuality: "128",
    kgQuality: "128",
    label: "标准 128K",
  },
  high: {
    level: "exhigh",
    br: 320000,
    kbps: 320,
    qqQuality: "320",
    kgQuality: "320",
    label: "高品 320K",
  },
  lossless: {
    level: "lossless",
    br: 999000,
    kbps: 999,
    qqQuality: "flac",
    kgQuality: "flac",
    label: "无损 FLAC",
  },
  hires: {
    level: "hires",
    br: 1999000,
    kbps: 1999,
    qqQuality: "hires",
    kgQuality: "high",
    label: "Hi-Res",
  },
  ...EXTENDED_QUALITY,
};
export const get = (o, path) => path.split(".").reduce((v, k) => v?.[k], o);
export const first = (o, paths, fallback = "") => {
  for (const p of paths) {
    const v = get(o, p);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return fallback;
};
export const arrayAt = (o, paths) => {
  for (const p of paths || []) {
    const v = get(o, p);
    if (Array.isArray(v)) return v;
  }
  return Array.isArray(o) ? o : [];
};
export const clean = (v) =>
  String(v ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
export function httpUrl(value) {
  try {
    const u = new URL(value);
    return ["http:", "https:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : "";
  } catch {
    return "";
  }
}
export const imageUrl = (v) =>
  httpUrl(String(v || "").replace(/\{size\}/g, "400"));
export function unwrap(value) {
  let b = value?.body ?? value;
  if (b?.response && typeof b.response === "object") b = b.response;
  return b;
}
export function renderTemplate(value, vars) {
  if (typeof value === "string") {
    const m = value.match(/^\{([A-Za-z0-9_]+)\}$/);
    if (m) return vars[m[1]] ?? "";
    return value.replace(/\{([A-Za-z0-9_]+)\}/g, (_, key) =>
      String(vars[key] ?? ""),
    );
  }
  if (Array.isArray(value)) return value.map((v) => renderTemplate(v, vars));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, renderTemplate(v, vars)]),
    );
  return value;
}
function names(items) {
  return Array.isArray(items)
    ? items
        .map((x) => clean(x.name || x.singername || x.author_name || x))
        .filter(Boolean)
        .join(" / ")
    : clean(items);
}
export function normalizeEntity(raw, platform, kind = "song", mapping = {}) {
  const source = raw.musicData || raw.songInfo || raw.song_info || raw;
  const r = source.base ? { ...source, ...source.base } : source;
  const pick = (key, paths, def = "") =>
    first(r, [...(mapping[key] ? [mapping[key]] : []), ...paths], def);
  const kg = platform === "kugou";
  const qq = platform === "qq";
  const id = pick(
    "id",
    kind === "song"
      ? [
          "mid",
          "songmid",
          "hash",
          "Hash",
          "FileHash",
          "audio_info.hash",
          "audio_info.hash_128",
          "deprecated.hash",
          "filehash",
          "id",
          "songid",
        ]
      : kind === "artist"
        ? [
            "mid",
            "singer_mid",
            "singermid",
            "AuthorId",
            "author_id",
            "id",
            "singerid",
          ]
        : kind === "album"
          ? [
              "mid",
              "albumMID",
              "albummid",
              "album_mid",
              "AlbumID",
              "albumid",
              "album_id",
              "id",
            ]
          : kind === "chart"
            ? ["rankid", "rank_id", "id", "topId"]
            : [
                "gid",
                "global_collection_id",
                "globalCollectionId",
                "id",
                "dissid",
                "disstid",
                "tid",
                "specialid",
                "special_id",
                "listid",
              ],
  );
  const titlePaths =
    kind === "song"
      ? [
          "name",
          "title",
          "songname",
          "SongName",
          "song_name",
          "audio_name",
          "filename",
          "FileName",
        ]
      : kind === "artist"
        ? [
            "name",
            "singerName",
            "singer_name",
            "singername",
            "AuthorName",
            "author_name",
            "title",
          ]
        : kind === "album"
          ? [
              "name",
              "albumName",
              "album_name",
              "albumname",
              "AlbumName",
              "title",
            ]
          : kind === "chart"
            ? ["name", "rankname", "topTitle", "title"]
            : [
                "name",
                "dissname",
                "specialname",
                "special_name",
                "listname",
                "title",
              ];
  const title = clean(pick("title", titlePaths));
  let artist = names(
    pick("artist", [
      "ar",
      "artists",
      "singer",
      "singers",
      "authors",
      "author",
      "singername",
      "SingerName",
      "author_name",
      "AuthorName",
      "artist",
      "creator.nickname",
      "creator.name",
      "creator.nick",
      "nick",
      "username",
    ]),
  );
  let actualTitle = title;
  if (kind === "song" && kg && !artist && title.includes(" - ")) {
    const split = title.split(" - ");
    artist = split.shift();
    actualTitle = split.join(" - ");
  }
  let cover = pick("cover", [
    "al.picUrl",
    "album.picUrl",
    "picUrl",
    "coverImgUrl",
    "blurPicUrl",
    "Image",
    "Avatar",
    "flexible_cover",
    "trans_param.union_cover",
    "headPicUrl",
    "frontPicUrl",
    "pic",
    "picurl",
    "pic_mid",
    "imgurl",
    "ImgUrl",
    "sizable_cover",
    "cover",
    "cover_url",
    "coverurl",
    "coverURL",
    "album.sizable_cover",
    "album.pic",
    "album_info.sizable_cover",
    "image",
    "img",
    "singer_pic",
    "AuthorPic",
    "img1v1Url",
    "creator.avatarUrl",
  ]);
  if (!cover) cover = first(r, ["album_info.cover"], "");
  const albumId = String(
    pick(
      "albumId",
      ["al.id", "album.id", "albumid", "album_id", "AlbumID"],
      "",
    ),
  );
  if (qq && !httpUrl(cover)) {
    const mid = first(
      r,
      kind === "artist"
        ? ["mid", "singermid", "singer_mid"]
        : ["album.mid", "albummid", "album_mid", "albumMID", "mid"],
      "",
    );
    if (mid)
      cover = `https://y.gtimg.cn/music/photo_new/${kind === "artist" ? "T001" : "T002"}R300x300M000${mid}.jpg`;
  }
  let duration = Number(
    pick(
      "duration",
      [
        "dt",
        "duration",
        "audio_info.duration",
        "audio_info.duration_128",
        "timelen",
        "time_length",
        "timelength",
        "interval",
        "Duration",
        "duration_s",
      ],
      0,
    ),
  );
  if (r.FileSize && !r.Duration && !r.duration && !r.timelength) duration = 0;
  if (
    r.dt !== undefined ||
    r.timelength !== undefined ||
    r.timelen !== undefined ||
    duration > 18000
  )
    duration /= 1000;
  const album = clean(
    pick("album", [
      "al.name",
      "album.name",
      "album.title",
      "albumname",
      "album_name",
      "album_info.album_name",
      "AlbumName",
    ]),
  );
  return {
    id: String(id),
    platform,
    kind,
    title: actualTitle || "未命名",
    artist: artist || "",
    album,
    cover: imageUrl(cover),
    duration: Number.isFinite(duration) ? duration : 0,
    trackCount: Number(
      pick(
        "trackCount",
        [
          "trackCount",
          "song_count",
          "songnum",
          "song_count",
          "songcount",
          "song_cnt",
          "total",
        ],
        0,
      ),
    ),
    meta: {
      albumId,
      songId: String(r.songid || r.song_id || r.id || ""),
      albumAudioId: String(
        pick(
          "albumAudioId",
          [
            "album_audio_id",
            "AlbumAudioID",
            "album_audio.audio_id",
            "mixsongid",
            "MixSongID",
            "album.audio_id",
            "album_audio_id",
          ],
          "",
        ),
      ),
      mediaId: String(
        pick(
          "mediaId",
          [
            "file.media_mid",
            "file.mediaMid",
            "strMediaMid",
            "strMediaId",
            "media_mid",
          ],
          "",
        ),
      ),
      fee: Number(r.fee || 0),
    },
    key: `${platform}:${kind}:${id}`,
  };
}
export function extractList(body, profile, operation, kind) {
  const route = profile.routes[operation];
  let rows = arrayAt(body, route?.items);
  if (profile.id === "qq" && operation === "charts")
    rows = rows.flatMap((x) => (Array.isArray(x.toplist) ? x.toplist : [x]));
  if (profile.id === "kugou" && operation === "recommend" && !rows.length)
    rows = arrayAt(body, [
      "data.special_recommend.special_list",
      "data.0.special_list",
    ]);
  return rows
    .map((r) => normalizeEntity(r, profile.id, kind, route?.mapping))
    .filter((x) => x.id && x.id !== "undefined");
}
export function parseLrc(text) {
  const result = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const tags = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    const words = line.replace(/\[[^\]]*\]/g, "").trim();
    for (const tag of tags)
      result.push({ time: Number(tag[1]) * 60 + Number(tag[2]), text: words });
  }
  return result.sort((a, b) => a.time - b.time);
}
export function safeName(name) {
  let text = String(name ?? "")
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 110);
  if (!text) text = "未命名";
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(text))
    text = "_" + text;
  return text;
}
