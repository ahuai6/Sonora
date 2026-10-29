import { first } from "../core/models.mjs";
export const EXTENDED_TAG_FIELDS = [
  "year",
  "genre",
  "track",
  "trackCount",
  "disc",
  "discCount",
  "composer",
  "isrc",
  "albumArtist",
];
export const positive = (v) => {
  const n = Number(String(v ?? "").split("/")[0]);
  return Number.isInteger(n) && n > 0 && n <= 65535 ? n : undefined;
};
export function text(v) {
  if (Array.isArray(v))
    return [...new Set(v.map(text).filter(Boolean))].join("; ");
  if (v && typeof v === "object")
    return text(
      v.name || v.value || v.author_name || v.title || v.base?.author_name,
    );
  return typeof v === "string" ? v.trim() : "";
}
export function year(v) {
  if (typeof v === "number" && v > 1e11) {
    const n = new Date(v).getUTCFullYear();
    return n >= 1000 && n <= 9999 ? n : undefined;
  }
  const m = String(v ?? "").match(/^(\d{4})(?:[-年/.]|$)/);
  return m && +m[1] >= 1000 ? +m[1] : undefined;
}
export function present(tags) {
  return Object.fromEntries(
    Object.entries(tags).filter(
      ([, v]) => v !== undefined && v !== null && v !== "" && v !== 0,
    ),
  );
}
const pick = (b, paths) => first(b, paths, undefined);
const genres = (v) => {
  const s = text(v);
  return s && !/^\d+(; \d+)*$/.test(s) ? s : undefined;
};
export function platformTags(source, song = {}, album = {}, songs = []) {
  const match = songs.find(
    (s) =>
      String(
        s.id ?? s.songid ?? s.mid ?? s.songmid ?? s.hash ?? s.audio_info?.hash,
      ) ==
      String(
        song.id ??
          song.songid ??
          song.mid ??
          song.songmid ??
          song.hash ??
          song.audio_info?.hash,
      ),
  );
  const s = match ? { ...match, ...song } : song;
  const fraction = String(
    pick(s, [
      "no",
      "index_album",
      "track",
      "track_number",
      "trackNumber",
      "base.track",
      "base.track_no",
    ]) || "",
  ).split("/");
  const disc = String(
    pick(s, [
      "cd",
      "index_cd",
      "disc",
      "disc_number",
      "discNumber",
      "base.cd",
    ]) || "",
  ).replace(/^CD\s*/i, "");
  const info = s.info || {};
  const genreValue = pick(s, [
    "genre_name",
    "genreName",
    "genres",
    "genre",
    "style_name",
    "style",
    "styles",
    "base.genre_name",
    "base.style",
  ]);
  const composerValue = pick(s, [
    "composer",
    "composers",
    "composer_name",
    "base.composer",
  ]);
  const composerInfo = Object.entries(info)
    .filter(([key, v]) =>
      /composer|composition|作曲/i.test(key + " " + (v?.title || "")),
    )
    .flatMap(([, v]) => v?.content || v || []);
  let trackCount = positive(
    pick(album, [
      "size",
      "song_count",
      "songcount",
      "total",
      "total_count",
      "totalNum",
      "songNum",
      "song_num",
      "album_info.song_count",
    ]),
  );
  // A complete album list may supply the count; never use an arbitrary search page length.
  if (!trackCount && songs.complete) trackCount = songs.length;
  const discNumbers = songs.complete
    ? songs.map((s) =>
        positive(
          String(s.cd || s.index_cd || s.disc || "").replace(/^CD\s*/i, ""),
        ),
      )
    : [];
  const composerAuthors = (s.authors || [])
    .filter((a) =>
      /作曲|composer/i.test(
        [a.role_name, a.type_name, a.identity, a.author_role].join(" "),
      ),
    )
    .map((a) => a.base?.author_name || a.author_name || a.name);
  return present({
    year:
      year(
        pick(s, [
          "publishTime",
          "publish_date",
          "time_public",
          "releaseDate",
          "pub_time",
          "base.publish_date",
        ]),
      ) ||
      year(
        pick(album, [
          "publishTime",
          "publish_date",
          "time_public",
          "publishDate",
          "releaseDate",
          "aDate",
        ]),
      ),
    genre:
      genres(genreValue) ||
      genres(pick(info, ["genre.content", "genre"])) ||
      genres(
        pick(album, [
          "genres",
          "genre_name",
          "style_name",
          "style",
          "styles",
          "genre",
        ]),
      ),
    track: positive(fraction[0]),
    trackCount: trackCount || positive(fraction[1]),
    disc: positive(disc),
    discCount:
      positive(
        pick(album, [
          "disc_count",
          "discCount",
          "cd_count",
          "cdNum",
          "cd_num",
          "total_discs",
        ]),
      ) ||
      (discNumbers.length && discNumbers.every(Boolean)
        ? Math.max(...discNumbers)
        : undefined),
    composer:
      text(composerValue) || text(composerInfo) || text(composerAuthors),
    isrc: text(
      pick(s, ["isrc", "isrc_code", "isrcCode", "base.isrc", "privilege.isrc"]),
    ),
    albumArtist: text(
      pick(album, [
        "author_name",
        "artists",
        "ar",
        "singers",
        "singerList",
        "singer",
        "authors",
        "artist",
        "albumArtist",
      ]),
    ),
  });
}
export function musicBrainzTags(recording = {}, release = {}) {
  const credit = (c) =>
    (c || [])
      .map((x) => (x.name || x.artist?.name || "") + (x.joinphrase || ""))
      .join("");
  const media = release.media || [];
  let disc, track;
  for (const m of media) {
    const t = (m.tracks || []).find((t) => t.recording?.id === recording.id);
    if (t) {
      disc = m;
      track = t;
      break;
    }
  }
  const composers = [];
  const visit = (r, depth = 0) => {
    if (depth > 3 || !r) return;
    for (const rel of r.relations || []) {
      if (rel.type === "composer" && rel.artist?.name)
        composers.push(rel.artist.name);
      if (rel.work) visit(rel.work, depth + 1);
    }
  };
  visit(recording);
  return present({
    title: track?.title || recording.title,
    artist: credit(track?.["artist-credit"] || recording["artist-credit"]),
    album: release.title,
    albumArtist: credit(release["artist-credit"]),
    year: year(release.date || recording["first-release-date"]),
    genre: text(
      (recording.genres?.length ? recording.genres : release.genres) || [],
    ),
    track: positive(track?.number) || positive(track?.position),
    trackCount:
      positive(disc?.["track-count"]) || positive(disc?.tracks?.length),
    disc: positive(disc?.position),
    discCount: positive(media.length),
    composer: text(composers),
    isrc: recording.isrcs?.[0],
    musicBrainzTrackId: recording.id,
    musicBrainzReleaseId: release.id,
  });
}
export function mappedTags(body, mapping = {}) {
  const out = {};
  for (const [key, paths] of Object.entries(mapping)) {
    const v = first(body, Array.isArray(paths) ? paths : [paths], undefined);
    out[key] =
      key === "year"
        ? year(v)
        : ["track", "trackCount", "disc", "discCount"].includes(key)
          ? positive(v)
          : text(v);
  }
  return present(out);
}
