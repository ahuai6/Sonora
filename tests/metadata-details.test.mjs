import test from "node:test";
import assert from "node:assert/strict";
import { MetadataMatcher } from "../main/services/metadata-match.mjs";
import {
  platformTags,
  musicBrainzTags,
} from "../main/services/metadata-tags.mjs";
test("NetEase detail and complete album data include track, disc, release year and credits", () => {
  const songs = [
    { id: 1, no: 1, cd: "01" },
    { id: 2, no: 2, cd: "01" },
  ];
  songs.complete = true;
  const tags = platformTags(
    "netease",
    {
      id: 2,
      no: 2,
      cd: "01",
      publishTime: 1573826400000,
      isrc: "JPA123456789",
      composer: "Ayase",
    },
    { size: 2, artists: [{ name: "YOASOBI" }] },
    songs,
  );
  assert.deepEqual(tags, {
    year: 2019,
    track: 2,
    trackCount: 2,
    disc: 1,
    discCount: 1,
    composer: "Ayase",
    isrc: "JPA123456789",
    albumArtist: "YOASOBI",
  });
});
test("QQ named genre and composer values are retained without treating numeric genre IDs as names", () => {
  const tags = platformTags(
    "qq",
    {
      index_album: 3,
      index_cd: 1,
      time_public: "2020-01-01",
      isrc: "CODE",
      info: {
        genre: { content: [{ value: "J-Pop" }] },
        composer: { content: [{ value: "Ayase" }] },
      },
    },
    { totalNum: 10, cdNum: 1, singerList: [{ name: "YOASOBI" }] },
  );
  assert.equal(tags.track, 3);
  assert.equal(tags.trackCount, 10);
  assert.equal(tags.genre, "J-Pop");
  assert.equal(tags.composer, "Ayase");
  assert.equal(platformTags("qq", { genre: 37 }, {}).genre, undefined);
});
test("Kugou explicit metadata fields are mapped without inventing missing metadata", () => {
  const tags = platformTags(
    "kugou",
    {
      base: { track_no: 1, publish_date: "2019-12-15", isrc: "CODE" },
      authors: [{ role_name: "作曲", base: { author_name: "Ayase" } }],
    },
    { author_name: "YOASOBI", song_count: 1, style: "J-Pop" },
  );
  assert.equal(tags.track, 1);
  assert.equal(tags.trackCount, 1);
  assert.equal(tags.year, 2019);
  assert.equal(tags.composer, "Ayase");
  assert.equal(tags.genre, "J-Pop");
  assert.equal(tags.discCount, undefined);
});
test("MusicBrainz uses the selected album edition for track and disc counts and work relationships for composers", () => {
  const tags = musicBrainzTags(
    {
      id: "r",
      title: "Title",
      genres: [{ name: "j-pop" }],
      isrcs: ["ISRC"],
      relations: [
        {
          work: {
            relations: [{ type: "composer", artist: { name: "Ayase" } }],
          },
        },
      ],
    },
    {
      id: "release",
      title: "Album",
      date: "2021-01-06",
      media: [
        {
          position: 1,
          "track-count": 12,
          tracks: [{ number: "7", recording: { id: "r" } }],
        },
        { position: 2, "track-count": 8, tracks: [] },
      ],
    },
  );
  assert.equal(tags.track, 7);
  assert.equal(tags.trackCount, 12);
  assert.equal(tags.disc, 1);
  assert.equal(tags.discCount, 2);
  assert.equal(tags.composer, "Ayase");
  assert.equal(tags.year, 2021);
});
test("adopting a native search result loads detail routes instead of returning only search metadata", async () => {
  const calls = [];
  const p = {
    id: "netease",
    routes: { metadataDetail: {}, metadataAlbum: {}, metadataCredits: {} },
  };
  const registry = {
    config: {},
    profile: () => p,
    variables: (_id, x) => x,
    bridge: {
      call: async (_p, op, vars) => {
        calls.push(op);
        if (op === "metadataDetail")
          return { songs: [{ id: 1, no: 1, cd: "01", al: { id: 9 } }] };
        if (op === "metadataAlbum")
          return {
            album: {
              size: 1,
              publishTime: 1573826400000,
              artists: [{ name: "YOASOBI" }],
            },
            songs: [{ id: 1, no: 1, cd: "01" }],
          };
        return { lrc: { lyric: "[00:00]作曲：Ayase" } };
      },
    },
  };
  const matcher = new MetadataMatcher(registry, { known: () => ({}) });
  const c = matcher.keep({
    source: "netease",
    tags: { title: "Song" },
    track: { id: "1", meta: {} },
  });
  const result = await matcher.details(c.matchId);
  assert.deepEqual(calls, [
    "metadataDetail",
    "metadataAlbum",
    "metadataCredits",
  ]);
  assert.equal(result.tags.year, 2019);
  assert.equal(result.tags.composer, "Ayase");
  assert(result.missingFields.includes("genre"));
  assert(!result.missingFields.includes("discCount"));
  await matcher.details(c.matchId);
  assert.equal(calls.length, 3);
});
