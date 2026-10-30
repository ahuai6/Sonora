import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { once } from "node:events";
import { Store } from "../main/core/store.mjs";
import { MusicLibrary } from "../main/services/files.mjs";
import { DownloadManager } from "../main/services/downloads.mjs";
import { CollectionActions } from "../main/services/collection-actions.mjs";
import { TagEditor } from "../main/services/tag-editor.mjs";

async function setup(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sonora-collections-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new Store(path.join(dir, "profile"), { downloadDir: dir });
  const library = new MusicLibrary(store);
  const files = ["A", "B", "C"].map((name) => path.join(dir, name + ".flac"));
  for (const file of files)
    fs.copyFileSync("tests/fixtures/tag-tone.flac", file);
  await library.importFiles(files);
  const downloads = new DownloadManager(store, {}, library);
  downloads.stopped = true;
  downloads.jobs = library.list().map((item, i) => ({
    id: `job-${i}`,
    track: { ...item },
    status: "completed",
    path: item.path,
    progress: 100,
  }));
  let confirmations = 0;
  const collections = new CollectionActions(library, downloads, {
    confirmTrash: async () => {
      confirmations++;
      return true;
    },
    trashFile: (file) => fs.promises.rename(file, file + ".recycled"),
    ...options,
  });
  return {
    dir,
    store,
    library,
    downloads,
    collections,
    files,
    confirmations: () => confirmations,
  };
}
test("refresh reconciles external deletions, updates tags and preserves favorites", async (t) => {
  const c = await setup(t),
    item = c.library.list()[1];
  c.library.toggleFavorite(item.id);
  const editor = new TagEditor(c.store, c.library),
    snapshot = await editor.read(item.id);
  await editor.save(item.id, {
    revision: snapshot.revision,
    tags: { title: "External title" },
  });
  // Force the stored index to represent an earlier snapshot from before the external edit.
  const indexed = c.library.known(item.id);
  indexed.title = "Stale title";
  indexed.modifiedAt = 0;
  fs.unlinkSync(c.files[0]);
  const result = await c.collections.refresh();
  assert.equal(result.removed, 1);
  assert.equal(result.items.length, 2);
  assert.equal(
    result.items.find((x) => x.id === item.id).title,
    "External title",
  );
  assert(result.items.find((x) => x.id === item.id).favorite);
  assert.equal(result.jobs.filter((j) => j.status === "missing").length, 1);
  fs.copyFileSync("tests/fixtures/tag-tone.flac", c.files[0]);
  await c.collections.refresh();
  assert.equal(
    c.downloads.jobs.filter((j) => j.status === "completed").length,
    3,
  );
});
test("refresh keeps inaccessible records instead of treating permissions as deletion", async (t) => {
  const c = await setup(t),
    original = fs.promises.stat;
  fs.promises.stat = async (file, ...args) => {
    if (file === c.files[0])
      throw Object.assign(Error("denied"), { code: "EACCES" });
    return original(file, ...args);
  };
  try {
    const result = await c.collections.refresh();
    assert.equal(result.items.length, 3);
    assert.equal(result.removed, 0);
    assert.equal(result.failures.length, 1);
    assert.equal(result.jobs.filter((j) => j.status === "completed").length, 3);
  } finally {
    fs.promises.stat = original;
  }
});
test("batch removing library and completed download records preserves audio files", async (t) => {
  const c = await setup(t),
    ids = c.library
      .list()
      .slice(0, 2)
      .map((x) => x.id);
  const local = await c.collections.batch(
    "library",
    [...ids, ids[0]],
    "remove",
  );
  assert.equal(local.changed, 2);
  assert.equal(local.items.length, 1);
  const jobs = await c.collections.batch(
    "downloads",
    c.downloads.jobs.map((j) => j.id),
    "remove",
  );
  assert.equal(jobs.jobs.length, 0);
  assert(c.files.every((file) => fs.existsSync(file)));
  assert.equal(c.confirmations(), 0);
});
test("declining bulk trash changes neither records nor files", async (t) => {
  const c = await setup(t, { confirmTrash: async () => false });
  const result = await c.collections.batch(
    "library",
    c.library.list().map((x) => x.id),
    "trash",
  );
  assert(result.cancelled);
  assert.equal(result.items.length, 3);
  assert(c.files.every((file) => fs.existsSync(file)));
});
test("library bulk trash confirms once and marks corresponding downloads missing", async (t) => {
  let suspended = 0,
    resumed = 0;
  const c = await setup(t, {
    suspendFile: async () => {
      suspended++;
      return () => resumed++;
    },
  });
  const result = await c.collections.batch(
    "library",
    c.library
      .list()
      .slice(0, 2)
      .map((x) => x.id),
    "trash",
  );
  assert.equal(c.confirmations(), 1);
  assert.equal(result.changed, 2);
  assert.equal(result.items.length, 1);
  assert.equal(result.jobs.filter((j) => j.status === "missing").length, 2);
  assert.equal(suspended, 2);
  assert.equal(resumed, 2);
});
test("download bulk trash cleans library, handles missing files and retains failed items", async (t) => {
  const c = await setup(t, {
    trashFile: async (file) => {
      if (file.endsWith("B.flac"))
        throw Object.assign(Error("file locked"), { code: "EPERM" });
      await fs.promises.rename(file, file + ".recycled");
    },
  });
  fs.unlinkSync(c.files[0]);
  const result = await c.collections.batch(
    "downloads",
    c.downloads.jobs.map((j) => j.id),
    "trash",
  );
  assert.equal(result.changed, 2);
  assert.equal(result.failures.length, 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].path, c.files[1]);
  assert(fs.existsSync(c.files[1]));
});
test("active download removal aborts and awaits cleanup, and skips committing jobs", async (t) => {
  const c = await setup(t),
    job = c.downloads.jobs[0],
    commit = c.downloads.jobs[1];
  job.status = "downloading";
  delete job.path;
  commit.status = "committing";
  const controller = new AbortController();
  c.downloads.running.set(job.id, controller);
  let cleaned = false;
  c.downloads.tasks.set(
    job.id,
    new Promise((resolve) =>
      controller.signal.addEventListener(
        "abort",
        () =>
          setTimeout(() => {
            cleaned = true;
            c.downloads.running.delete(job.id);
            c.downloads.tasks.delete(job.id);
            resolve();
          }, 10),
        { once: true },
      ),
    ),
  );
  const result = await c.collections.batch(
    "downloads",
    [job.id, commit.id],
    "remove",
  );
  assert(cleaned);
  assert.equal(result.changed, 1);
  assert.equal(result.skipped, 1);
  assert(!result.jobs.some((j) => j.id === job.id));
  assert(result.jobs.some((j) => j.id === commit.id));
});
test("bulk pause, cancel and retry respect task states including missing files", async (t) => {
  const c = await setup(t),
    [a, b, d] = c.downloads.jobs;
  a.status = "queued";
  delete a.path;
  b.status = "missing";
  assert.equal(
    (await c.collections.batch("downloads", [a.id, b.id, d.id], "pause"))
      .changed,
    1,
  );
  assert.equal(a.status, "paused");
  assert.equal(b.status, "missing");
  assert.equal(d.status, "completed");
  assert.equal(
    (await c.collections.batch("downloads", [a.id, b.id, d.id], "cancel"))
      .changed,
    1,
  );
  assert.equal(a.status, "cancelled");
  assert.equal(b.status, "missing");
  assert.equal(
    (await c.collections.batch("downloads", [a.id, b.id, d.id], "retry"))
      .changed,
    2,
  );
  assert.equal(a.status, "queued");
  assert.equal(b.status, "queued");
  assert.equal(b.path, undefined);
});
test("refresh and concurrent batch removal cannot resurrect deleted library records", async (t) => {
  const c = await setup(t),
    victim = c.library.list()[0],
    original = fs.promises.stat;
  let entered, resume;
  const paused = new Promise((r) => (entered = r)),
    gate = new Promise((r) => (resume = r));
  fs.promises.stat = async (file, ...args) => {
    if (file === victim.path) {
      entered();
      await gate;
    }
    return original(file, ...args);
  };
  try {
    const refresh = c.collections.refresh();
    await paused;
    await c.collections.batch("library", [victim.id], "remove");
    resume();
    const result = await refresh;
    assert(!result.items.some((x) => x.id === victim.id));
    assert(fs.existsSync(victim.path));
  } finally {
    resume();
    fs.promises.stat = original;
  }
});
test("malformed batch requests are rejected before touching records or files", async (t) => {
  const c = await setup(t);
  await assert.rejects(c.collections.batch("anything", [], "trash"));
  await assert.rejects(c.collections.batch("library", [null], "trash"));
  await assert.rejects(c.collections.batch("library", [], "unlink"));
  assert.equal(c.library.list().length, 3);
  assert.equal(c.confirmations(), 0);
});
test(
  "removing an actual in-flight download closes its stream and removes temporary files",
  { timeout: 5000 },
  async (t) => {
    const c = await setup(t);
    const server = http.createServer((_req, response) => {
      response.writeHead(200, { "Content-Type": "audio/flac" });
      response.write(fs.readFileSync("tests/fixtures/tag-tone.flac"));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(() => {
      server.closeAllConnections();
      server.close();
    });
    c.downloads.jobs = [];
    c.downloads.stopped = false;
    c.downloads.providers = {
      resolve: async () => ({
        url: `http://127.0.0.1:${server.address().port}/audio`,
        quality: "high",
        source: "fixture",
      }),
    };
    let entered;
    const started = new Promise((resolve) => (entered = resolve));
    c.downloads.on("update", (jobs) => {
      if (jobs.some((j) => j.status === "downloading")) entered();
    });
    const added = c.downloads.add(
      [{ ...c.library.list()[0], platform: "netease", key: "netease:stream" }],
      "high",
    );
    await started;
    const result = await c.collections.batch(
      "downloads",
      [added.jobs[0].id],
      "remove",
    );
    assert.equal(result.jobs.length, 0);
    assert.equal(c.downloads.running.size, 0);
    assert.equal(c.downloads.tasks.size, 0);
    assert(
      !fs
        .readdirSync(c.dir, { recursive: true })
        .some((file) => /\.part$/.test(file)),
    );
  },
);
