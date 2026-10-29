import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import {
  safeName,
  normalizeEntity,
  renderTemplate,
  extractList,
  parseLrc,
  httpUrl,
} from "../main/core/models.mjs";
import {
  sniffAudio,
  uniqueCommit,
  MusicLibrary,
} from "../main/services/files.mjs";
import { Store } from "../main/core/store.mjs";
import { ProviderRegistry } from "../main/providers/registry.mjs";
import { DownloadManager } from "../main/services/downloads.mjs";
import { MediaService } from "../main/services/media.mjs";
import { EngineBridge, joinCookies } from "../main/providers/engines.mjs";
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sonora-test-"));
test("music can be committed on volumes without hard-link support", async () => {
  const dir = temp();
  const tmp = path.join(dir, "source.part");
  fs.writeFileSync(tmp, "verified-audio");
  fs.writeFileSync(path.join(dir, "Song.wav"), "original");
  const original = fs.promises.link;
  fs.promises.link = async () => {
    const error = Error("unsupported");
    error.code = "ENOTSUP";
    throw error;
  };
  try {
    const target = await uniqueCommit(tmp, dir, "Song", "wav");
    assert.equal(fs.readFileSync(target, "utf8"), "verified-audio");
    assert.equal(
      fs.readFileSync(path.join(dir, "Song.wav"), "utf8"),
      "original",
    );
    assert.match(target, /Song \(1\)\.wav$/);
  } finally {
    fs.promises.link = original;
  }
});
test("Kugou chart uses the current rankid and hash_128 fields", () => {
  const chart = normalizeEntity(
    { id: 2, rankid: 8888, rankname: "TOP500" },
    "kugou",
    "chart",
  );
  assert.equal(chart.id, "8888");
  const song = normalizeEntity(
    {
      songname: "Song",
      audio_info: { hash_128: "ABC", duration_128: 200000 },
      album_info: { sizable_cover: "https://example.com/{size}.jpg" },
    },
    "kugou",
  );
  assert.equal(song.id, "ABC");
  assert.equal(song.duration, 200);
  assert.equal(song.cover, "https://example.com/400.jpg");
});
test("cookie import excludes response attributes and keeps the latest cookie value", () => {
  assert.equal(
    joinCookies(
      "token=old; Path=/; Domain=.example.com; token=new; SameSite=Lax; userid=1",
    ),
    "token=new; userid=1",
  );
});
test("custom field mappings include playback identifiers", () => {
  const x = normalizeEntity(
    {
      song_key: "S",
      label: "Title",
      media: { key: "M", album: "A", audio: 9 },
    },
    "qq",
    "song",
    {
      id: "song_key",
      title: "label",
      mediaId: "media.key",
      albumId: "media.album",
      albumAudioId: "media.audio",
    },
  );
  assert.equal(x.id, "S");
  assert.equal(x.meta.mediaId, "M");
  assert.equal(x.meta.albumId, "A");
  assert.equal(x.meta.albumAudioId, "9");
});
test("audio response paths can be changed entirely through provider configuration", async () => {
  const store = new Store(temp());
  store.data.settings.usePublicFallback = false;
  const reg = new ProviderRegistry(
    store,
    path.resolve("profiles/providers.json"),
  );
  Object.assign(reg.profile("netease").routes.resolve, {
    urlPaths: ["payload.files.0.link"],
    bitratePaths: ["payload.kbps"],
    trialPaths: ["payload.preview"],
  });
  reg.bridge.call = async () => ({
    payload: {
      files: [{ link: "https://example.com/new.flac" }],
      kbps: 900,
      preview: "0",
    },
  });
  const result = await reg.resolve(
    { id: "1", platform: "netease", title: "Title", artist: "", meta: {} },
    "lossless",
  );
  assert.equal(result.url, "https://example.com/new.flac");
  assert.equal(result.quality, "900 kbps");
  assert.equal(result.trial, false);
});
test("lyric JSON paths can be changed without changing platform adapters", async () => {
  const reg = new ProviderRegistry(
    new Store(temp()),
    path.resolve("profiles/providers.json"),
  );
  reg.profile("qq").routes.lyrics.lyricPaths = {
    original: ["payload.lrc"],
    translation: ["payload.translation"],
  };
  reg.bridge.call = async () => ({
    payload: { lrc: "[00:00.00]Original", translation: "[00:00.00]翻译" },
  });
  const result = await reg.lyrics({
    id: "1",
    platform: "qq",
    title: "A",
    artist: "",
    duration: 0,
  });
  assert.equal(result.original, "[00:00.00]Original");
  assert.equal(result.translation, "[00:00.000]翻译");
});
const crypto = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from("encrypted:" + s),
  decryptString: (b) => b.toString().slice(10),
};
function wave(seconds = 2) {
  const sr = 8000,
    n = sr * seconds,
    b = Buffer.alloc(44 + n * 2);
  b.write("RIFF");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++)
    b.writeInt16LE(
      (Math.sin((i / sr) * 440 * Math.PI * 2) * 2000) | 0,
      44 + i * 2,
    );
  return b;
}
async function listen(handler) {
  const s = http.createServer(handler);
  s.listen(0, "127.0.0.1");
  await once(s, "listening");
  return { server: s, url: `http://127.0.0.1:${s.address().port}` };
}
const wait = async (fn, ms = 7000) => {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw Error("condition timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
};
test("Windows filenames cannot traverse paths or use reserved device names", () => {
  for (const input of [
    "../a",
    "..\\b",
    "con",
    "NUL.mp3",
    "LPT1",
    "name. ",
    "a:b?c",
  ]) {
    const v = safeName(input);
    assert(!/[<>:"/\\|?*]/.test(v));
    assert(!/^(con|nul|lpt1)(?:\.|$)/i.test(v));
    assert(!/[. ]$/.test(v));
  }
});
test("templates preserve booleans and numbers without evaluating code", () => {
  assert.deepEqual(
    renderTemplate(
      { id: "{id}", b: false, t: "{page}", s: "x={query}" },
      { id: 42, page: 2, query: "$(danger)" },
    ),
    { id: 42, b: false, t: 2, s: "x=$(danger)" },
  );
});
test("normalizes NetEase artist, cover and milliseconds", () => {
  const x = normalizeEntity(
    {
      id: 1,
      name: "<em>A</em>",
      ar: [{ name: "B" }],
      al: { name: "C", picUrl: "https://example.com/p.png" },
      dt: 180123,
    },
    "netease",
  );
  assert.equal(x.title, "A");
  assert.equal(x.artist, "B");
  assert.equal(x.duration, 180.123);
  assert.equal(x.album, "C");
});
test("normalizes Kugou search FileHash instead of numeric IDs", () => {
  const x = normalizeEntity(
    {
      ID: "9",
      FileHash: "ABCD",
      SongName: "Song",
      SingerName: "Artist",
      Duration: 190,
      FileSize: 1000,
      Image: "https://example.com/{size}.jpg",
    },
    "kugou",
  );
  assert.equal(x.id, "ABCD");
  assert.equal(x.duration, 190);
  assert.equal(x.cover, "https://example.com/400.jpg");
});
test("normalizes nested Kugou album songs without losing audio_info", () => {
  const x = normalizeEntity(
    {
      base: { audio_name: "Song", album_id: 7, album_audio_id: 8 },
      audio_info: { hash: "ABC", duration: 201234 },
      album_info: { album_name: "Album", cover: "https://example.com/a.jpg" },
      authors: [{ author_name: "Artist" }],
    },
    "kugou",
  );
  assert.equal(x.id, "ABC");
  assert.equal(x.title, "Song");
  assert.equal(x.album, "Album");
  assert.equal(x.duration, 201.234);
  assert.equal(x.meta.albumAudioId, "8");
});
test("playlist names are not overwritten by singername", () => {
  const x = normalizeEntity(
    {
      global_collection_id: "collection_a",
      specialname: "Playlist",
      singername: "群星",
    },
    "kugou",
    "playlist",
  );
  assert.equal(x.title, "Playlist");
  assert.equal(x.id, "collection_a");
});
test("QQ media_mid is distinct from song MID", () => {
  const x = normalizeEntity(
    {
      songmid: "song",
      songname: "A",
      strMediaMid: "media",
      singer: [{ name: "Singer" }],
      albummid: "album",
      interval: 200,
    },
    "qq",
  );
  assert.equal(x.meta.mediaId, "media");
  assert.equal(x.duration, 200);
  assert.match(x.cover, /album\.jpg/);
});
test("LRC multiple time tags sort chronologically", () => {
  assert.deepEqual(parseLrc("[00:10.00][00:01.5]hello\n[ar:Artist]"), [
    { time: 1.5, text: "hello" },
    { time: 10, text: "hello" },
  ]);
});
test("rejects unsupported and credential-bearing URLs", () => {
  assert.equal(httpUrl("file:///C:/a"), "");
  assert.equal(httpUrl("https://user:pass@example.com/"), "");
  assert.equal(httpUrl("https://example.com/a"), "https://example.com/a");
});
test("audio signature validation rejects HTML disguised as MP3", () => {
  assert.equal(sniffAudio(Buffer.from("<html>error</html>")), "");
  assert.equal(sniffAudio(wave()), "wav");
  assert.equal(sniffAudio(Buffer.from("fLaC")), "flac");
});
test("atomic commit avoids overwriting an existing music file", async () => {
  const dir = temp();
  fs.writeFileSync(path.join(dir, "A.wav"), "original");
  const part = path.join(dir, "p.part");
  fs.writeFileSync(part, "new");
  const result = await uniqueCommit(part, dir, "A", "wav");
  assert.match(result, /A \(1\)\.wav$/);
  assert.equal(fs.readFileSync(path.join(dir, "A.wav"), "utf8"), "original");
});
test("store only exposes credential summaries and supports account switching", () => {
  const dir = temp(),
    store = new Store(dir, { crypto });
  store.saveAccount({ platform: "qq", cookie: "test-cookie-one", uid: "1" });
  store.saveAccount({ platform: "qq", cookie: "test-cookie-two", uid: "2" });
  assert.equal(store.publicAccounts().filter((x) => x.active).length, 1);
  assert(!JSON.stringify(store.publicAccounts()).includes("test-cookie"));
  assert.equal(store.credential("qq").cookie, "test-cookie-two");
  store.activateAccount(store.publicAccounts()[0].id);
  assert.equal(store.credential("qq").uid, "1");
});
test("credential save fails closed when Windows encryption is unavailable", () => {
  const store = new Store(temp(), {
    crypto: { isEncryptionAvailable: () => false },
  });
  assert.throws(
    () => store.saveAccount({ platform: "qq", cookie: "x" }),
    /加密/,
  );
  assert.equal(store.data.accounts.length, 0);
});
test("remote HTTP engines only send credentials after explicit trust is enabled", async (t) => {
  const seen = [];
  const { server, url } = await listen((req, res) => {
    seen.push(req.headers.cookie || "");
    res.setHeader("Content-Type", "application/json");
    res.end('{"result":{"songs":[]}}');
  });
  t.after(() => server.close());
  const store = new Store(temp(), { crypto });
  store.saveAccount({
    platform: "netease",
    cookie: "private=test-only",
    uid: "1",
  });
  const bridge = new EngineBridge(store);
  const p = {
    id: "netease",
    baseUrl: url,
    routes: { search: { path: "/search" } },
  };
  await bridge.call(p, "search", {});
  await bridge.call({ ...p, trustRemoteCredentials: true }, "search", {});
  assert.deepEqual(seen, ["", "private=test-only"]);
});
test("provider validation rejects invalid engines and unsafe base URLs", () => {
  const reg = new ProviderRegistry(
    new Store(temp()),
    path.resolve("profiles/providers.json"),
  );
  const c = structuredClone(reg.config);
  c.platforms[0].baseUrl = "file:///";
  assert.throws(() => reg.validate(c), /地址/);
  c.platforms[0].baseUrl = "";
  c.platforms[0].engine = "arbitrary-file";
  assert.throws(() => reg.validate(c), /引擎/);
});
test("registry resolves scalar native audio URLs without truncating to first character", async () => {
  const reg = new ProviderRegistry(
    new Store(temp()),
    path.resolve("profiles/providers.json"),
  );
  reg.bridge.call = async () => ({
    data: [{ url: "https://example.com/song.mp3", br: 320000 }],
  });
  const v = await reg.resolve(
    { id: "1", platform: "netease", title: "A", artist: "", meta: {} },
    "high",
  );
  assert.equal(v.url, "https://example.com/song.mp3");
  assert.equal(v.quality, "320 kbps");
});
test("public fallback receives no account cookie", async (t) => {
  let cookie;
  const { server, url } = await listen((req, res) => {
    cookie = req.headers.cookie;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ url: "https://example.com/song.mp3" }));
  });
  t.after(() => server.close());
  const store = new Store(temp(), { crypto });
  store.saveAccount({ platform: "qq", cookie: "private=test-only", uid: "1" });
  const reg = new ProviderRegistry(
    store,
    path.resolve("profiles/providers.json"),
  );
  reg.bridge.call = async () => {
    throw Error("offline");
  };
  reg.config.resolvers = [
    {
      id: "fixture",
      name: "Fixture",
      enabled: true,
      platforms: ["qq"],
      mode: "json",
      url,
      urlPaths: ["url"],
    },
  ];
  assert.equal(
    (
      await reg.resolve(
        { id: "1", platform: "qq", title: "A", artist: "", meta: {} },
        "high",
      )
    ).url,
    "https://example.com/song.mp3",
  );
  assert.equal(cookie, undefined);
});
test("keyword resolver refuses a different recording name", async (t) => {
  const { server, url } = await listen((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        url: "https://example.com/a.mp3",
        name: "Wrong song",
        singer: "Artist",
      }),
    );
  });
  t.after(() => server.close());
  const reg = new ProviderRegistry(
    new Store(temp()),
    path.resolve("profiles/providers.json"),
  );
  reg.bridge.call = async () => {
    throw Error("offline");
  };
  reg.config.resolvers = [
    {
      id: "fixture",
      name: "Fixture",
      enabled: true,
      platforms: ["qq"],
      mode: "json",
      url,
      urlPaths: ["url"],
      titlePaths: ["name"],
      artistPaths: ["singer"],
      strictMatch: true,
    },
  ];
  await assert.rejects(
    reg.resolve(
      {
        id: "1",
        platform: "qq",
        title: "Correct song",
        artist: "Artist",
        meta: {},
      },
      "high",
    ),
    /不匹配/,
  );
});
test("download pipeline writes verified audio, sidecar lyrics and music metadata", async (t) => {
  const data = wave();
  const { server, url } = await listen((_req, res) => {
    res.writeHead(200, {
      "Content-Type": "audio/wav",
      "Content-Length": data.length,
    });
    res.end(data);
  });
  t.after(() => server.close());
  const dir = temp(),
    store = new Store(path.join(dir, "state"), {
      downloadDir: path.join(dir, "music"),
    });
  const lib = new MusicLibrary(store);
  const provider = {
    resolve: async () => ({
      url,
      headers: {},
      source: "Fixture",
      quality: "PCM",
    }),
    lyrics: async () => ({ original: "[00:00.00]Test", translation: "" }),
  };
  const manager = new DownloadManager(store, provider, lib);
  const track = {
    id: "1",
    key: "netease:song:1",
    kind: "song",
    platform: "netease",
    title: "Test / Track",
    artist: "Sonora",
    duration: 2,
    meta: {},
  };
  manager.add([track], "standard");
  await wait(
    () => manager.jobs[0].status === "completed" && lib.list().length === 1,
  );
  assert.deepEqual(fs.readFileSync(manager.jobs[0].path), data);
  assert.equal(path.extname(manager.jobs[0].path), ".wav");
  assert(fs.existsSync(manager.jobs[0].path.replace(".wav", ".lrc")));
  assert.equal(lib.list().length, 1);
  assert.equal(Math.round(lib.list()[0].duration), 2);
  manager.add([track], "standard");
  await wait(() => manager.jobs.every((j) => j.status === "completed"));
  assert.notEqual(manager.jobs[0].path, manager.jobs[1].path);
});
test("download errors do not leave fake audio files or .part files", async (t) => {
  const { server, url } = await listen((_req, res) => {
    res.writeHead(200, { "Content-Type": "audio/mpeg" });
    res.end("<html>access denied</html>");
  });
  t.after(() => server.close());
  const dir = temp(),
    store = new Store(path.join(dir, "state"), {
      downloadDir: path.join(dir, "music"),
    });
  const manager = new DownloadManager(
    store,
    {
      resolve: async () => ({ url, headers: {}, source: "Fixture" }),
      lyrics: async () => ({}),
    },
    new MusicLibrary(store),
  );
  manager.add(
    [
      {
        id: "1",
        key: "x",
        platform: "netease",
        kind: "song",
        title: "A",
        artist: "",
        duration: 0,
        meta: {},
      },
    ],
    "high",
  );
  await wait(() => manager.jobs[0].status === "failed");
  assert.match(manager.jobs[0].message, /不是可识别音频/);
  assert.equal(fs.readdirSync(path.join(dir, "music", "网易云音乐")).length, 0);
});
test("short preview files are rejected even when URL metadata omits trial flag", async (t) => {
  const data = wave();
  const { server, url } = await listen((_req, res) => {
    res.writeHead(200, { "Content-Length": data.length });
    res.end(data);
  });
  t.after(() => server.close());
  const dir = temp(),
    store = new Store(path.join(dir, "state"), {
      downloadDir: path.join(dir, "music"),
    });
  const manager = new DownloadManager(
    store,
    {
      resolve: async () => ({ url, headers: {}, source: "Fixture" }),
      lyrics: async () => ({}),
    },
    new MusicLibrary(store),
  );
  manager.add(
    [
      {
        id: "1",
        key: "x",
        platform: "netease",
        kind: "song",
        title: "Long",
        artist: "",
        duration: 180,
        meta: {},
      },
    ],
    "high",
  );
  await wait(() => manager.jobs[0].status === "failed");
  assert.match(manager.jobs[0].message, /试听片段/);
});
test("paused resolving jobs can be retried without being overwritten by the aborted attempt", async (t) => {
  const data = wave();
  const { server, url } = await listen((_req, res) => res.end(data));
  t.after(() => server.close());
  const dir = temp(),
    store = new Store(path.join(dir, "state"), {
      downloadDir: path.join(dir, "music"),
    });
  let calls = 0;
  const manager = new DownloadManager(
    store,
    {
      resolve: async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 70));
        return { url, headers: {}, source: "Fixture" };
      },
      lyrics: async () => ({}),
    },
    new MusicLibrary(store),
  );
  manager.add(
    [
      {
        id: "1",
        key: "x",
        platform: "qq",
        kind: "song",
        title: "A",
        artist: "",
        duration: 2,
        meta: {},
      },
    ],
    "standard",
  );
  const id = manager.jobs[0].id;
  manager.action(id, "pause");
  manager.action(id, "retry");
  await wait(() => manager.jobs[0].status === "completed");
  assert.equal(calls, 2);
});
test("media registry supports local range requests and rejects unknown IDs", async () => {
  const file = path.join(temp(), "test.wav"),
    data = wave();
  fs.writeFileSync(file, data);
  const media = new MediaService();
  const url = media.register({ path: file, mime: "audio/wav" });
  const res = await media.handle(
    new Request(url, { headers: { Range: "bytes=44-63" } }),
  );
  assert.equal(res.status, 206);
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), data.subarray(44, 64));
  assert.equal(
    (await media.handle(new Request("sonora-media://audio/invalid"))).status,
    404,
  );
});
