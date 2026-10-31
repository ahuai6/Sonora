import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { once } from "node:events";
import { Store } from "../main/core/store.mjs";
import {
  MusicLibrary,
  uniqueCommit,
  sniffAudio,
} from "../main/services/files.mjs";
import { TagEditor, readTags } from "../main/services/tag-editor.mjs";
import { WorkspaceTools, redact } from "../main/services/workspace-tools.mjs";
import { DownloadManager } from "../main/services/downloads.mjs";
import {
  audioInfo,
  inspectAudio,
  probeAudio,
} from "../main/services/audio-info.mjs";
import { localLyricDocument, exportLyrics } from "../main/services/lyrics.mjs";
import { ProviderRegistry } from "../main/providers/registry.mjs";
import { EngineBridge } from "../main/providers/engines.mjs";
import { QUALITY } from "../main/core/models.mjs";
import { fileDigest } from "../main/services/commit-journal.mjs";
import { FileTransactions } from "../main/services/file-transactions.mjs";
import { DownloadMetadata } from "../main/services/download-metadata.mjs";
import { LibraryWatch } from "../main/services/library-watch.mjs";
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sonora-140-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new Store(path.join(dir, "profile"), { downloadDir: dir });
  const library = new MusicLibrary(store),
    tags = new TagEditor(store, library);
  return { dir, store, library, tags };
}
test("corrupt state preserves evidence and restores last valid state; invalid arrays normalize", async (t) => {
  const { store, dir } = setup(t);
  store.data.library = [{ id: "a", path: path.join(dir, "a.flac") }];
  store.save();
  fs.writeFileSync(store.file, '{"broken":');
  const recovered = new Store(store.dir);
  assert.equal(recovered.data.library[0].id, "a");
  assert.match(recovered.recoveryWarning, /损坏/);
  assert(fs.readdirSync(store.dir).some((x) => x.includes(".corrupt-")));
  fs.writeFileSync(
    store.file,
    '{"downloads":null,"accounts":{},"device":null}',
  );
  const clean = new Store(store.dir, { downloadDir: dir });
  const manager = new DownloadManager(clean, {}, {});
  await manager.stop();
  assert.deepEqual(clean.data.downloads, []);
  assert(Array.isArray(clean.data.accounts));
});
test("enhanced lyric prefix survives word display and roundtrip export", () => {
  const doc = localLyricDocument(
    "[00:01.000]Hello <00:01.500>world<00:02.000>",
  );
  assert.equal(doc.lines[0].words.map((x) => x.text).join(""), "Hello world");
  assert.match(exportLyrics(doc, { format: "elrc" }).text, /Hello/);
});
test("committed destination is returned even if temporary cleanup is denied", async (t) => {
  const { dir } = setup(t),
    temp = path.join(dir, "a.part");
  fs.writeFileSync(temp, "audio");
  const original = fs.promises.unlink;
  fs.promises.unlink = async (file) => {
    if (file === temp) throw Object.assign(Error("busy"), { code: "EPERM" });
    return original(file);
  };
  try {
    const output = await uniqueCommit(temp, dir, "song", "mp3");
    assert.equal(fs.readFileSync(output, "utf8"), "audio");
  } finally {
    fs.promises.unlink = original;
  }
});
test("library rejects non-audio; actual format includes measured sample rate and channels", async (t) => {
  const { dir, library } = setup(t),
    bad = path.join(dir, "broken.mp3");
  fs.writeFileSync(bad, "not music");
  const r = await library.importFiles([bad]);
  assert.equal(r.imported, 0);
  assert.equal(r.failures.length, 1);
  const info = await inspectAudio("tests/fixtures/tag-tone.flac");
  assert.equal(info.codec, "FLAC");
  assert(info.sampleRate > 0);
  assert(info.bits > 0);
  assert.match(info.label, /bit.*kHz/);
  assert.equal(audioInfo().label, "音质未识别");
});
test("remote probe bounds bytes and measures the actual stream rather than requested tier", async (t) => {
  const bytes = fs.readFileSync("tests/fixtures/tag-tone.flac");
  let range;
  const server = http.createServer((req, res) => {
    range = req.headers.range;
    res.writeHead(200, { "content-type": "audio/flac" });
    res.end(bytes);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const info = await probeAudio({
    url: `http://127.0.0.1:${server.address().port}/`,
  });
  assert.equal(info.codec, "FLAC");
  assert.equal(info.evidence, "header");
  assert.match(range, /bytes=0-262143/);
});
test("public resolver ignores undecryptable account credentials and never invents quality", async (t) => {
  const { store } = setup(t);
  store.crypto = {
    decryptString() {
      throw Error("bad");
    },
  };
  store.data.accounts = [
    { id: "x", platform: "netease", uid: "123", secret: "bad", active: true },
  ];
  store.data.settings.preferredResolver = "fixture";
  const server = http.createServer((_req, res) =>
    res.end(JSON.stringify({ url: "https://example.org/song.flac" })),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const registry = new ProviderRegistry(
    store,
    path.resolve("profiles/providers.json"),
  );
  registry.config.resolvers = [
    {
      id: "fixture",
      name: "test",
      enabled: true,
      mode: "json",
      platforms: ["netease"],
      url: `http://127.0.0.1:${server.address().port}`,
      params: { id: "{id}" },
    },
  ];
  const result = await registry.resolve(
    { platform: "netease", id: "1", title: "test", artist: "", meta: {} },
    "master",
  );
  assert.equal(result.quality, "音质待音频确认");
});
test("QQ extended quality sends the proper vkey filename without falling back to SDK 128k", async (t) => {
  const { store } = setup(t),
    bridge = new EngineBridge(store),
    original = global.fetch;
  let payload;
  global.fetch = async (_url, options) => {
    payload = JSON.parse(options.body);
    return new Response(
      JSON.stringify({
        req_0: {
          code: 0,
          data: {
            sip: ["https://audio.example/"],
            midurlinfo: [{ purl: "master.flac" }],
          },
        },
      }),
      { headers: { "content-type": "application/json" } },
    );
  };
  try {
    const r = await bridge.qqExtended(
      { id: "song", meta: { mediaId: "media" } },
      "master",
    );
    assert.equal(payload.req_0.param.filename[0], "AI00songmedia.flac");
    assert.equal(r.url, "https://audio.example/master.flac");
    assert.equal(QUALITY.hires.qqQuality, "hires");
    assert.equal(QUALITY.dsd.kgQuality, "super");
  } finally {
    global.fetch = original;
  }
});
test("batch preview is read-only; selectively writes chosen fields and restores audio backup", async (t) => {
  const { dir, store, library, tags } = setup(t),
    file = path.join(dir, "song.flac");
  fs.copyFileSync("tests/fixtures/tag-tone.flac", file);
  await library.importFiles([file]);
  const id = library.list()[0].id,
    original = await fileDigest(file);
  const tools = new WorkspaceTools(store, library, tags, {
    search: async () => ({ items: [{ matchId: "m", sourceName: "Fixture" }] }),
    details: async () => ({
      tags: { title: "新标题", artist: "不写入的歌手" },
      warnings: [],
    }),
  });
  const plan = await tools.plan([id], "all");
  assert.equal(await fileDigest(file), original);
  await tools.apply(plan.planId, [{ id, fields: ["title"] }]);
  assert.equal(readTags(file).tags.title, "新标题");
  assert.notEqual(readTags(file).tags.artist, "不写入的歌手");
  const recovery = await tools.recovery(),
    backup = recovery.files.find((x) => x.kind === "tags");
  assert(backup);
  await tools.restoreBackup(backup.name, id);
  assert.equal(await fileDigest(file), original);
});
test("missing files retain identity and favorites across relink", async (t) => {
  const { dir, store, library, tags } = setup(t),
    file = path.join(dir, "old.flac"),
    target = path.join(dir, "new.flac");
  fs.copyFileSync("tests/fixtures/tag-tone.flac", file);
  await library.importFiles([file]);
  const item = library.list()[0];
  library.toggleFavorite(item.id);
  fs.renameSync(file, target);
  await library.refresh();
  assert.equal(library.list().length, 0);
  assert.equal(store.data.missingLibrary[0].favorite, true);
  const tools = new WorkspaceTools(store, library, tags);
  await tools.relink(item.id, target);
  assert.equal(library.list()[0].id, item.id);
  assert.equal(library.list()[0].favorite, true);
  assert.equal(store.data.missingLibrary.length, 0);
});
test("list JSON/CSV/M3U8 roundtrip handles quoted fields and relative paths", async (t) => {
  const { dir, store, library, tags } = setup(t),
    file = path.join(dir, "song.flac");
  fs.copyFileSync("tests/fixtures/tag-tone.flac", file);
  await library.importFiles([file]);
  const tools = new WorkspaceTools(store, library, tags);
  library.list()[0].title = 'comma, and "quote"';
  for (const format of ["json", "csv", "m3u8"]) {
    const text = tools.exportList(library.list(), format);
    library.removeMany(library.list().map((x) => x.id));
    await tools.importList(text, format, dir);
    assert.equal(library.list().length, 1);
  }
});
test("commit journal recovers already saved audio without duplicate download", async (t) => {
  const { dir, store, library } = setup(t),
    file = path.join(dir, "saved.flac");
  fs.copyFileSync("tests/fixtures/tag-tone.flac", file);
  store.data.downloads = [
    {
      id: "x",
      status: "committing",
      track: { key: "x" },
      pendingCommit: { path: file, sha256: await fileDigest(file) },
    },
  ];
  const manager = new DownloadManager(store, {}, library);
  await manager.recovery;
  assert.equal(manager.jobs[0].status, "completed");
  assert.equal(manager.jobs[0].path, file);
  assert.equal(library.list().length, 1);
  await manager.stop();
});
test("diagnostic redaction removes credentials paths and full URL query", () => {
  const result = redact({
    secret: "sensitive",
    message: "Error C:\\Users\\private\\file.flac",
    url: "https://host/path?cookie=secret",
    nested: { authorization: "x" },
  });
  assert.equal(result.secret, "[已隐藏]");
  assert(!JSON.stringify(result).includes("private"));
  assert(!JSON.stringify(result).includes("cookie="));
  assert.equal(result.nested.authorization, "[已隐藏]");
});
test("file mutation queue serializes aliases and releases ownership", async () => {
  const queue = new FileTransactions(),
    first = await queue.acquire("song.flac");
  let acquired = false;
  const waiting = queue.acquire("SONG.FLAC").then((release) => {
    acquired = true;
    release();
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(acquired, false);
  first();
  await waiting;
  assert.equal(acquired, true);
  assert.equal(queue.pending.size, 0);
});
test("DSD signatures identify containers without accepting encrypted QQ files", () => {
  assert.equal(sniffAudio(Buffer.from("DSD ")), "dsf");
  assert.equal(sniffAudio(Buffer.from("FRM8")), "dff");
  assert.equal(sniffAudio(Buffer.from("QMC encrypted")), "");
});
test("platform quality matrix preserves native parameters including NetEase downloads", async (t) => {
  const { store } = setup(t);
  store.data.settings.preferredResolver = "builtin";
  store.data.device.dfid = "fixture";
  const registry = new ProviderRegistry(
    store,
    path.resolve("profiles/providers.json"),
  );
  let call;
  registry.bridge.call = async (profile, operation, vars) => {
    call = { platform: profile.id, operation, vars };
    return profile.id === "netease"
      ? { data: [{ url: "https://example.org/audio" }] }
      : { url: "https://example.org/audio" };
  };
  for (const [platform, tier, key, value] of [
    ["netease", "master", "level", "jymaster"],
    ["netease", "spatial", "level", "vivid"],
    ["netease", "surround", "level", "sky"],
    ["netease", "clear", "level", "jyeffect"],
    ["kugou", "master", "kgQuality", "viper_tape"],
    ["kugou", "spatial", "kgQuality", "viper_atmos"],
    ["kugou", "clear", "kgQuality", "viper_clear"],
    ["kugou", "dsd", "kgQuality", "super"],
  ]) {
    await registry.resolve(
      { platform, id: "1", title: "fixture", meta: {} },
      tier,
      "download",
    );
    assert.equal(call.vars[key], value);
    if (platform === "netease") assert.equal(call.operation, "resolve");
  }
});
test("automatic resolver order is independent per platform", async (t) => {
  const { store } = setup(t);
  store.data.settings.resolverOrder = {
    netease: ["second", "builtin", "first"],
  };
  store.data.settings.usePublicFallback = true;
  const registry = new ProviderRegistry(
    store,
    path.resolve("profiles/providers.json"),
  );
  registry.config.resolvers = [
    { id: "first", enabled: true, platforms: ["netease"] },
    { id: "second", enabled: true, platforms: ["netease"] },
  ];
  const resolve = registry.resolve.bind(registry),
    calls = [];
  registry.resolve = (track, quality, purpose, options = {}) => {
    if (options.resolver) {
      calls.push(options.resolver);
      if (options.resolver === "second")
        return Promise.resolve({ source: "second" });
      throw Error("down");
    }
    return resolve(track, quality, purpose, options);
  };
  assert.equal(
    (await registry.resolve({ platform: "netease" }, "high")).source,
    "second",
  );
  assert.deepEqual(calls, ["second"]);
});
test("directory automation does not re-add explicitly removed files", async (t) => {
  const { dir, library } = setup(t),
    file = path.join(dir, "a.flac");
  fs.copyFileSync("tests/fixtures/tag-tone.flac", file);
  await library.importFiles([file]);
  library.remove(library.list()[0].id);
  await library.scan(dir, { automatic: true });
  assert.equal(library.list().length, 0);
  await library.scan(dir);
  assert.equal(library.list().length, 1);
});
test("online playlist references survive JSON CSV and M3U8 import without downloading", async (t) => {
  const { dir, store, library, tags } = setup(t),
    tools = new WorkspaceTools(store, library, tags),
    item = {
      platform: "netease",
      id: "33894312",
      title: "Fixture",
      artist: "Test",
      duration: 12,
      meta: { albumId: "1" },
    };
  for (const format of ["json", "csv", "m3u8"]) {
    const imported = await tools.importList(
      tools.exportList([item], format),
      format,
      dir,
    );
    assert.equal(imported.remote[0].id, "33894312");
    assert.equal(imported.remote[0].platform, "netease");
    assert.equal(imported.imported, 0);
  }
});
test("retry of a committed path rebuilds library without invoking a resolver", async (t) => {
  const { dir, store, library } = setup(t),
    file = path.join(dir, "audio.flac");
  fs.copyFileSync("tests/fixtures/tag-tone.flac", file);
  store.data.downloads = [
    { id: "job", status: "failed", track: { key: "fixture" }, path: file },
  ];
  let calls = 0;
  const manager = new DownloadManager(
    store,
    {
      resolve: async () => {
        calls++;
        throw Error("must not download");
      },
    },
    library,
  );
  await manager.recovery;
  manager.action("job", "retry");
  await Promise.all([...manager.tasks.values()]);
  assert.equal(calls, 0);
  assert.equal(manager.jobs[0].status, "completed");
  assert.equal(library.list().length, 1);
  await manager.stop();
});
test("metadata-only retry writes existing audio without contacting a resolver or producing sidecars", async (t) => {
  const { dir, store, library, tags } = setup(t),
    file = path.join(dir, "retry.flac");
  fs.copyFileSync("tests/fixtures/tag-tone.flac", file);
  await library.importFiles([file]);
  store.data.settings.autoLyrics = false;
  store.data.downloads = [
    {
      id: "retry",
      status: "completed",
      track: { key: "n", title: "Original", artist: "Test" },
      path: file,
    },
  ];
  const metadata = new DownloadMetadata(
    {
      forTrack: async () => ({
        tags: { title: "Recovered metadata", year: 2026 },
        warnings: [],
      }),
    },
    tags,
  );
  const manager = new DownloadManager(
    store,
    {
      resolve() {
        throw Error("resolver must not run");
      },
    },
    library,
    { metadata },
  );
  await manager.recovery;
  await manager.retryMetadata(["retry"]);
  assert.equal(readTags(file).tags.title, "Recovered metadata");
  assert.equal(manager.jobs[0].metadata.status, "written");
  assert.deepEqual(
    fs.readdirSync(dir).filter((name) => /retry\./.test(name)),
    ["retry.flac"],
  );
  await manager.stop();
});
test("directory watcher imports newly created audio and publishes the updated library", async (t) => {
  const { dir, library } = setup(t),
    folder = path.join(dir, "music");
  fs.mkdirSync(folder);
  let published = false;
  const watcher = new LibraryWatch(library, () => {
    published = true;
  });
  watcher.watch(folder);
  try {
    fs.copyFileSync(
      "tests/fixtures/tag-tone.flac",
      path.join(folder, "new.flac"),
    );
    const end = Date.now() + 5000;
    while (!published && Date.now() < end)
      await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(library.list().length, 1);
    assert.equal(published, true);
  } finally {
    watcher.close();
  }
});
test("account verification honors cancellation before opening an SDK request", async (t) => {
  const { store } = setup(t),
    bridge = new EngineBridge(store),
    controller = new AbortController();
  controller.abort(Error("fixture cancelled"));
  await assert.rejects(
    bridge.verifyAccount("netease", "fixture", "1", controller.signal),
    /fixture cancelled/,
  );
});
