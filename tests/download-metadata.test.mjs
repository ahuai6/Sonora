import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { once } from "node:events";
import { parseFile } from "music-metadata";
import { Store } from "../main/core/store.mjs";
import { MusicLibrary } from "../main/services/files.mjs";
import { TagEditor, readTags } from "../main/services/tag-editor.mjs";
import { MetadataMatcher } from "../main/services/metadata-match.mjs";
import { DownloadMetadata } from "../main/services/download-metadata.mjs";
import { DownloadManager } from "../main/services/downloads.mjs";

const artwork =
  "data:image/png;base64," +
  fs.readFileSync("build/icon.png").toString("base64");
const tags = {
  title: "对应歌曲",
  artist: "对应歌手",
  album: "对应专辑",
  year: 2020,
  genre: "J-Pop",
  track: 3,
  trackCount: 12,
  disc: 2,
  discCount: 2,
  composer: "Composer",
  isrc: "TEST26000001",
};
const track = (platform = "netease") => ({
  id: "123",
  key: platform + ":song:123",
  platform,
  title: tags.title,
  artist: tags.artist,
  album: tags.album,
  kind: "song",
  duration: 1,
  cover: "https://example.com/cover.png",
  meta: { albumId: "456" },
});
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sonora-auto-tags-"));
  const store = new Store(path.join(dir, "profile"), {
    downloadDir: path.join(dir, "music"),
  });
  store.setSettings({ autoLyrics: false, groupByPlatform: false });
  const library = new MusicLibrary(store),
    editor = new TagEditor(store, library);
  const ctx = { dir, store, library, editor };
  t.after(() => {
    ctx.manager?.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return ctx;
}
async function wait(fn) {
  const deadline = Date.now() + 5000;
  while (!fn()) {
    if (Date.now() > deadline) throw Error("Timed out waiting for download");
    await new Promise((r) => setTimeout(r, 10));
  }
}
async function pipeline(t, options = {}) {
  const ctx = setup(t),
    data = fs.readFileSync("tests/fixtures/tag-tone.flac");
  const server = http.createServer((_req, res) => res.end(data));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const metadata =
    options.metadata ||
    new DownloadMetadata(
      { forTrack: async () => ({ tags, warnings: [] }) },
      ctx.editor,
      { artwork: async () => ({ dataUrl: artwork }) },
    );
  const manager = new DownloadManager(
    ctx.store,
    {
      resolve: async () => ({
        url: `http://127.0.0.1:${server.address().port}`,
        source: "Fixture",
        quality: "FLAC",
      }),
    },
    ctx.library,
    { metadata },
  );
  ctx.manager = manager;
  return { ...ctx, manager, data };
}

for (const extension of ["mp3", "flac", "m4a", "ogg", "opus", "wav"]) {
  test(`automatic download tags: ${extension} stages verified metadata and cover without modifying the input`, async (t) => {
    const { dir, editor, store } = setup(t),
      file = path.join(dir, "download.part");
    const original = fs.readFileSync(`tests/fixtures/tag-tone.${extension}`);
    fs.writeFileSync(file, original);
    const metadata = new DownloadMetadata(
      { forTrack: async () => ({ tags, warnings: [] }) },
      editor,
      { artwork: async () => ({ dataUrl: artwork }) },
    );
    const result = await metadata.prepare(file, extension, track());
    const saved = readTags(result.file);
    assert.deepEqual(saved.tags.title, tags.title);
    for (const key of [
      "year",
      "track",
      "trackCount",
      "disc",
      "discCount",
      "genre",
      "composer",
      "isrc",
    ])
      assert.equal(saved.tags[key], tags[key], key);
    assert(
      saved.pictures.some((p) =>
        p.data.equals(fs.readFileSync("build/icon.png")),
      ),
    );
    assert(fs.readFileSync(file).equals(original));
    const [before, after] = await Promise.all([
      parseFile(file),
      parseFile(result.file),
    ]);
    assert.equal(after.format.codec, before.format.codec);
    assert.equal(after.format.duration, before.format.duration);
    assert.equal(store.data.tagBackups, undefined);
  });
}

test("download resolves exact source identity, writes tags before import and finishes with the local cover available", async (t) => {
  const ctx = await pipeline(t),
    phases = [];
  ctx.manager.on("update", (jobs) => phases.push(jobs[0].status));
  ctx.manager.add([track()], "high");
  await wait(() => ctx.manager.jobs[0].status === "completed");
  const job = ctx.manager.jobs[0],
    local = ctx.library.list()[0];
  assert(phases.includes("tagging"));
  assert.equal(job.metadata.status, "written");
  assert.match(job.message, /标签已写入/);
  assert.equal(local.title, tags.title);
  assert.match(local.cover, /^sonora-media:\/\/cover\//);
  assert.equal(readTags(job.path).tags.year, 2020);
  assert.deepEqual(fs.readdirSync(path.dirname(job.path)), [
    path.basename(job.path),
  ]);
});

test("detail and artwork failures still write search metadata and preserve existing embedded lyrics", async (t) => {
  const { dir, editor } = setup(t),
    raw = path.join(dir, "download.part");
  const first = path.join(dir, "first.part");
  fs.copyFileSync("tests/fixtures/tag-tone.flac", first);
  const withLyrics = await editor.stageDownload(first, "flac", {
    tags: { composer: "Existing composer" },
    lyrics: "[00:00]Existing lyrics",
  });
  fs.renameSync(withLyrics, raw);
  const metadata = new DownloadMetadata(
    {
      forTrack: async () => {
        throw Error("offline");
      },
    },
    editor,
    {
      artwork: async () => {
        throw Error("offline");
      },
    },
  );
  const result = await metadata.prepare(raw, "flac", track()),
    saved = readTags(result.file);
  assert.equal(result.metadata.status, "partial");
  assert.equal(saved.tags.title, tags.title);
  assert.equal(saved.tags.composer, "Existing composer");
  assert.equal(saved.lyrics, "[00:00]Existing lyrics");
});

test("bounded metadata timeout uses basic tags and late responses cannot mutate the saved file", async (t) => {
  const { dir, editor } = setup(t),
    raw = path.join(dir, "download.part");
  fs.copyFileSync("tests/fixtures/tag-tone.flac", raw);
  const metadata = new DownloadMetadata(
    {
      forTrack: () =>
        new Promise((r) =>
          setTimeout(
            () => r({ tags: { title: "Late title" }, warnings: [] }),
            100,
          ),
        ),
    },
    editor,
    { timeout: 10 },
  );
  const result = await metadata.prepare(raw, "flac", track());
  assert.equal(readTags(result.file).tags.title, tags.title);
  const bytes = fs.readFileSync(result.file);
  await new Promise((r) => setTimeout(r, 120));
  assert(fs.readFileSync(result.file).equals(bytes));
});

test("turning off automatic metadata preserves downloaded bytes and skips the matcher", async (t) => {
  let called = false;
  const ctx = await pipeline(t, {
    metadata: {
      prepare: async () => {
        called = true;
      },
    },
  });
  ctx.store.setSettings({ autoMetadata: false });
  ctx.manager.add([track()], "high");
  await wait(() => ctx.manager.jobs[0].status === "completed");
  assert(!called);
  assert(fs.readFileSync(ctx.manager.jobs[0].path).equals(ctx.data));
  assert.equal(ctx.manager.jobs[0].metadata.status, "disabled");
});

test("a tag write failure leaves downloaded audio usable and does not turn the task into a failed download", async (t) => {
  const ctx = await pipeline(t, {
    metadata: {
      prepare: async () => {
        throw Error("unsupported tags");
      },
    },
  });
  ctx.manager.add([track()], "high");
  await wait(() => ctx.manager.jobs[0].status === "completed");
  assert(fs.readFileSync(ctx.manager.jobs[0].path).equals(ctx.data));
  assert.equal(ctx.manager.jobs[0].metadata.status, "failed");
  assert.match(ctx.manager.jobs[0].message, /标签未写入/);
  assert.equal(ctx.library.list().length, 1);
});

test("cancelling during metadata lookup removes staged files and allows retry", async (t) => {
  const ctx = await pipeline(t);
  ctx.manager.metadata = new DownloadMetadata(
    { forTrack: () => new Promise(() => {}) },
    ctx.editor,
  );
  ctx.manager.add([track()], "high");
  await wait(() => ctx.manager.jobs[0].status === "tagging");
  const id = ctx.manager.jobs[0].id;
  ctx.manager.action(id, "cancel");
  await wait(() => ctx.manager.running.size === 0);
  assert.equal(ctx.manager.jobs[0].status, "cancelled");
  assert.deepEqual(fs.readdirSync(ctx.store.data.settings.downloadDir), []);
  assert.equal(ctx.library.list().length, 0);
  ctx.manager.metadata = new DownloadMetadata(
    { forTrack: async () => ({ tags, warnings: [] }) },
    ctx.editor,
  );
  ctx.manager.action(id, "retry");
  await wait(() => ctx.manager.jobs[0].status === "completed");
  assert.equal(readTags(ctx.manager.jobs[0].path).tags.year, 2020);
});

test("failed staging cleans the copy while leaving the audio input byte-exact", async (t) => {
  const { dir, editor } = setup(t),
    raw = path.join(dir, "download.part");
  const data = fs.readFileSync("tests/fixtures/tag-tone.flac");
  fs.writeFileSync(raw, data);
  editor.writeTags = async (file) => {
    fs.writeFileSync(file, "partial write");
    throw Error("write error");
  };
  await assert.rejects(
    editor.stageDownload(raw, "flac", { tags }),
    /write error/,
  );
  assert(fs.readFileSync(raw).equals(data));
  assert(!fs.existsSync(raw + ".flac"));
});

test("an already cancelled download never starts metadata requests or creates a staged file", async (t) => {
  const { dir, editor } = setup(t),
    raw = path.join(dir, "download.part");
  fs.copyFileSync("tests/fixtures/tag-tone.flac", raw);
  let calls = 0;
  const metadata = new DownloadMetadata(
    {
      forTrack: async () => {
        calls++;
        throw Error("must not request");
      },
    },
    editor,
  );
  const control = new AbortController();
  control.abort();
  await assert.rejects(
    metadata.prepare(raw, "flac", track(), { signal: control.signal }),
    { name: "AbortError" },
  );
  assert.equal(calls, 0);
  assert(!fs.existsSync(raw + ".flac"));
});

for (const platform of ["netease", "qq", "kugou"]) {
  test(`${platform}: automatic metadata lookup uses the downloaded ID without a keyword search`, async () => {
    const seen = [],
      matcher = new MetadataMatcher(
        {
          config: {},
          profile: () => ({ routes: { metadataDetail: {} } }),
          variables: (_id, vars) => vars,
          bridge: {
            call: async (_profile, op, vars) => {
              seen.push([op, vars.id]);
              return {};
            },
          },
        },
        {
          known: () => {
            throw Error("Local lookup is not needed");
          },
        },
      );
    const details = await matcher.forTrack(track(platform));
    assert.deepEqual(seen, [["metadataDetail", "123"]]);
    assert.equal(details.tags.title, tags.title);
  });
}

test("restart cleans interrupted download tag staging without deleting unrelated files", (t) => {
  const ctx = setup(t),
    id = "11111111-1111-4111-8111-111111111111";
  const folder = ctx.store.data.settings.downloadDir;
  fs.mkdirSync(folder, { recursive: true });
  for (const suffix of ["", ".flac"])
    fs.writeFileSync(
      path.join(folder, `.sonora-${id}.part${suffix}`),
      "partial",
    );
  fs.writeFileSync(path.join(folder, "unrelated.flac"), "keep");
  ctx.store.data.downloads = [
    { id, folder, track: track(), status: "tagging" },
  ];
  ctx.manager = new DownloadManager(ctx.store, {}, ctx.library);
  assert.equal(ctx.manager.jobs[0].status, "paused");
  assert.deepEqual(fs.readdirSync(folder), ["unrelated.flac"]);
});

test("restart preserves already committed audio when the library update was interrupted", (t) => {
  const ctx = setup(t),
    folder = ctx.store.data.settings.downloadDir;
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, "已保存.flac"),
    data = fs.readFileSync("tests/fixtures/tag-tone.flac");
  fs.writeFileSync(file, data);
  ctx.store.data.downloads = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      folder,
      path: file,
      track: track(),
      status: "tagging",
    },
  ];
  ctx.manager = new DownloadManager(ctx.store, {}, ctx.library);
  assert.equal(ctx.manager.jobs[0].status, "completed");
  assert(fs.readFileSync(file).equals(data));
});
