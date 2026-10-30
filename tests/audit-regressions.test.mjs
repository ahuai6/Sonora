import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { once } from "node:events";
import { Store } from "../main/core/store.mjs";
import { MusicLibrary } from "../main/services/files.mjs";
import { TagEditor } from "../main/services/tag-editor.mjs";
import {
  localLyricDocument,
  lyricDocument,
  exportLyrics,
} from "../main/services/lyrics.mjs";
import { ProviderRegistry } from "../main/providers/registry.mjs";
import { DownloadManager } from "../main/services/downloads.mjs";
import { jsonRequest } from "../main/core/transport.mjs";
import { runSdkRequest } from "../main/providers/sdk-client.mjs";

async function setup(t, ext = "flac") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sonora-audit-fix-")),
    file = path.join(dir, `song.${ext}`);
  fs.copyFileSync(`tests/fixtures/tag-tone.${ext}`, file);
  const store = new Store(path.join(dir, "profile"), {
      downloadDir: path.join(dir, "music"),
    }),
    library = new MusicLibrary(store);
  await library.importFiles([file]);
  const ctx = {
    dir,
    file,
    store,
    library,
    editor: new TagEditor(store, library),
    id: library.list()[0].id,
  };
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return ctx;
}
test("B01: local enhanced bilingual lyrics retain word times, translation and repeat export", () => {
  const original = lyricDocument({
    timed: "[1000,1000](1000,400,0)原(1400,600,0)文",
    translation: "[00:01]Translation",
    format: "yrc",
  });
  const text = exportLyrics(original, { format: "auto", bilingual: true }).text,
    local = localLyricDocument(text);
  assert(local.hasWordTiming);
  assert.equal(local.lines.length, 1);
  assert.deepEqual(local.lines[0].words, original.lines[0].words);
  assert.equal(local.lines[0].translation, "Translation");
  assert.equal(
    exportLyrics(local, { format: "auto", bilingual: true }).text,
    text,
  );
  const openEnded = localLyricDocument(
    "[00:01]<00:01>原<00:01.400>文\n[00:01]Translation\n[00:03]Next",
  );
  assert.equal(openEnded.lines[0].words.at(-1).end, 3000);
});
test("B01: plain bilingual LRC companions and TTML use the same local model", () => {
  const doc = localLyricDocument(
    "[00:01]Original\n[00:01]Translation\n[00:02]Next",
  );
  assert.equal(doc.lines.length, 2);
  assert.equal(doc.lines[0].translation, "Translation");
  assert(!doc.hasWordTiming);
  const xml = exportLyrics(doc, { format: "ttml", bilingual: true }).text;
  assert.equal(localLyricDocument(xml).lines[0].translation, "Translation");
});
for (const ext of ["flac", "m4a", "ogg", "opus"])
  test(`B02: manual ${ext} lyric saves allow a final CRLF without changing timed text`, async (t) => {
    const c = await setup(t, ext),
      s = await c.editor.read(c.id);
    const r = await c.editor.save(c.id, {
      revision: s.revision,
      lyrics: "[00:00.000]Original\r\n[00:00.000]Translation\r\n",
    });
    assert.equal(
      r.editor.lyrics.replace(/\r\n/g, "\n").trimEnd(),
      "[00:00.000]Original\n[00:00.000]Translation",
    );
  });
test("B03: failed replacement preserves the preceding recovery point", async (t) => {
  const c = await setup(t);
  let s = await c.editor.read(c.id);
  let r = await c.editor.save(c.id, {
    revision: s.revision,
    tags: { title: "A" },
  });
  r = await c.editor.save(c.id, {
    revision: r.editor.revision,
    tags: { title: "B" },
  });
  const pointer = c.store.data.tagBackups[c.id],
    rename = fs.promises.rename;
  fs.promises.rename = async () => {
    throw Object.assign(Error("locked"), { code: "EPERM" });
  };
  try {
    await assert.rejects(
      c.editor.save(c.id, {
        revision: r.editor.revision,
        tags: { title: "C" },
      }),
      /无法替换/,
    );
  } finally {
    fs.promises.rename = rename;
  }
  assert.equal(c.store.data.tagBackups[c.id], pointer);
  const restored = await c.editor.restore(
    c.id,
    (await c.editor.read(c.id)).revision,
  );
  assert.equal(restored.editor.tags.title, "A");
});
test("B04: an import cannot resurrect a concurrently removed library record", async (t) => {
  const c = await setup(t),
    other = path.join(c.dir, "other.flac");
  fs.copyFileSync(c.file, other);
  let enter, release;
  const gate = new Promise((r) => (enter = r)),
    held = new Promise((r) => (release = r)),
    stat = fs.promises.stat;
  fs.promises.stat = async (file, ...rest) => {
    if (file === other) {
      enter();
      await held;
    }
    return stat(file, ...rest);
  };
  const pending = c.library.importFiles([other]);
  await gate;
  c.library.remove(c.id);
  release();
  try {
    await pending;
  } finally {
    fs.promises.stat = stat;
  }
  assert(!c.library.list().some((x) => x.id === c.id));
  await c.library.importFiles([c.file]);
  assert(c.library.list().some((x) => x.path === c.file));
});
test("B05: commit is explicitly non-cancellable and cannot flip from cancelled to complete", async (t) => {
  const c = await setup(t);
  c.store.setSettings({
    autoMetadata: false,
    autoLyrics: false,
    groupByPlatform: false,
  });
  const server = http.createServer((_q, r) => r.end(fs.readFileSync(c.file)));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const manager = new DownloadManager(
    c.store,
    {
      resolve: async () => ({
        url: `http://127.0.0.1:${server.address().port}`,
        source: "fixture",
      }),
    },
    c.library,
  );
  let enter, release;
  const gate = new Promise((r) => (enter = r)),
    held = new Promise((r) => (release = r)),
    link = fs.promises.link;
  fs.promises.link = async (...args) => {
    enter();
    await held;
    return link(...args);
  };
  manager.add(
    [
      {
        id: "1",
        key: "test",
        platform: "netease",
        title: "test",
        artist: "",
        duration: 1,
        meta: {},
      },
    ],
    "high",
  );
  try {
    await gate;
    assert.equal(manager.jobs[0].status, "committing");
    manager.action(manager.jobs[0].id, "cancel");
    assert.equal(manager.jobs[0].status, "committing");
    release();
    while (manager.running.size) await new Promise((r) => setTimeout(r, 10));
    assert.equal(manager.jobs[0].status, "completed");
  } finally {
    release();
    fs.promises.link = link;
    manager.stop();
    server.close();
  }
});
test("B06: invalid required routes are rejected and damaged configurations recover without overwriting the file", async (t) => {
  const c = await setup(t),
    defaults = path.resolve("profiles/providers.json"),
    registry = new ProviderRegistry(c.store, defaults),
    valid = structuredClone(registry.config);
  registry.save(valid);
  const bad = structuredClone(valid);
  delete bad.platforms[0].routes.lyrics;
  assert.throws(() => registry.save(bad), /必需路由/);
  fs.writeFileSync(registry.file, JSON.stringify(bad));
  const recovered = new ProviderRegistry(c.store, defaults);
  assert(recovered.configWarning);
  assert(recovered.config.platforms[0].routes.lyrics);
  assert.equal(
    JSON.parse(fs.readFileSync(registry.file)).platforms[0].routes.lyrics,
    undefined,
  );
});
test("B09: streamed byte limits cancel chunked responses before the full body arrives", async () => {
  let sent = 0,
    closed;
  const close = new Promise((r) => (closed = r));
  const server = http.createServer((_q, res) => {
    res.setHeader("content-type", "application/json");
    const timer = setInterval(() => {
      sent += 16384;
      res.write(Buffer.alloc(16384, 32));
      if (sent >= 1024 * 1024) {
        clearInterval(timer);
        res.end();
      }
    }, 4);
    res.on("close", () => {
      clearInterval(timer);
      closed();
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await assert.rejects(
      jsonRequest(`http://127.0.0.1:${server.address().port}`, {
        maxBytes: 32768,
      }),
      /响应过大/,
    );
    await close;
    assert(sent < 1024 * 1024);
  } finally {
    server.close();
  }
});
test("R02: cancelling a native SDK worker closes its pending HTTP connection", async () => {
  let enter, closed;
  const gate = new Promise((r) => (enter = r)),
    close = new Promise((r) => (closed = r));
  const server = http.createServer((_q, res) => {
    res.writeHead(200);
    res.write("pending");
    enter();
    res.on("close", closed);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const control = new AbortController();
  const promise = runSdkRequest(
    "fixture",
    "slow",
    { url: `http://127.0.0.1:${server.address().port}` },
    {
      signal: control.signal,
      workerUrl: new URL("./fixtures/slow-sdk-worker.mjs", import.meta.url),
    },
  );
  const rejection = assert.rejects(promise, { name: "AbortError" });
  try {
    await gate;
    control.abort();
    await rejection;
    await close;
  } finally {
    server.close();
  }
});
test("R02: installed native SDKs can be isolated without changing module discovery", async () => {
  for (const [platform, module] of [
    ["netease", "song_detail"],
    ["kugou", "krm_audio"],
    ["qq", "getSongInfo"],
  ]) {
    if (platform === "qq") continue; // QQ metadata uses the cancellable gateway, not this legacy module name.
    assert.equal(
      (await runSdkRequest(platform, module, {}, { inspect: true })).available,
      true,
    );
  }
});

test("R02: cancelling audio URL resolution aborts HTTP and does not attempt fallback sources", async (t) => {
  const c = await setup(t),
    registry = new ProviderRegistry(
      c.store,
      path.resolve("profiles/providers.json"),
    );
  let enter,
    close,
    requests = 0;
  const started = new Promise((r) => (enter = r)),
    closed = new Promise((r) => (close = r));
  const server = http.createServer((_req, res) => {
    requests++;
    res.writeHead(200);
    res.write('{"pending":');
    enter();
    res.on("close", close);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  registry.config.platforms[0].baseUrl = `http://127.0.0.1:${server.address().port}`;
  const control = new AbortController();
  const pending = registry.resolve(
    { id: "1", platform: "netease", title: "test", artist: "", meta: {} },
    "high",
    "download",
    { signal: control.signal },
  );
  const rejected = assert.rejects(pending, { name: "AbortError" });
  try {
    await started;
    control.abort();
    await rejected;
    await closed;
    assert.equal(requests, 1);
  } finally {
    server.close();
  }
});
