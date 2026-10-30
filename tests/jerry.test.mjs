import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import { Store } from "../main/core/store.mjs";
import { ProviderRegistry } from "../main/providers/registry.mjs";

test("Jerry response maps ID, quality and unknown size without sending credentials", async (t) => {
  let body = {
    data: [
      {
        id: 33894312,
        url: "https://example.com/audio.mp3",
        br: 320000,
        size: 0,
        code: 200,
        freeTrialInfo: null,
        source: "unblock",
        sourceType: "byfuns",
      },
    ],
    code: 200,
  };
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ cookie: req.headers.cookie, url: req.url });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(body));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const store = new Store(
    fs.mkdtempSync(path.join(os.tmpdir(), "sonora-jerry-")),
  );
  t.after(() => fs.rmSync(store.dir, { recursive: true, force: true }));
  store.data.settings.preferredResolver = "jerry";
  store.credential = () => ({ cookie: "private=test-only", uid: "1" });
  const r = new ProviderRegistry(
    store,
    path.resolve("profiles/providers.json"),
  );
  const service = r.config.resolvers.find((x) => x.id === "jerry");
  service.url = `http://127.0.0.1:${server.address().port}/api/song/url/v1`;
  r.bridge.call = () => {
    throw Error("Manual selection must skip native engine");
  };
  const track = {
    platform: "netease",
    id: "33894312",
    title: "Test",
    artist: "Artist",
  };
  const result = await r.resolve(track, "high", "download");
  assert.equal(result.quality, "320 kbps");
  assert.equal(result.bytes, 0);
  assert.equal(result.trial, false);
  assert.equal(seen[0].cookie, undefined);
  assert.equal(
    new URL(seen[0].url, "http://localhost").searchParams.get("level"),
    "exhigh",
  );
  body.data[0].freeTrialInfo = { start: 0, end: 30 };
  assert.equal((await r.resolve(track, "high", "play")).trial, true);
  await assert.rejects(() => r.resolve(track, "high", "download"), /试听片段/);
  body.data[0].freeTrialInfo = null;
  body.data[0].id = 42;
  await assert.rejects(() => r.resolve(track), /ID 不匹配/);
  body.data[0].id = 33894312;
  body.data[0].code = 403;
  await assert.rejects(() => r.resolve(track), /未成功返回/);
});

const defaultsFile = path.resolve("profiles/providers.json");
const defaults = () => JSON.parse(fs.readFileSync(defaultsFile, "utf8"));
function profile(t, legacy) {
  const store = new Store(
    fs.mkdtempSync(path.join(os.tmpdir(), "sonora-jerry-upgrade-")),
  );
  t.after(() => fs.rmSync(store.dir, { recursive: true, force: true }));
  if (legacy)
    fs.writeFileSync(
      path.join(store.dir, "providers.json"),
      JSON.stringify(legacy),
    );
  return store;
}
function oldConfig() {
  const config = defaults();
  config.resolvers = config.resolvers.filter((r) => r.id !== "jerry");
  delete config.bundledResolverMigrations;
  return config;
}
test("release defaults include the enabled Jerry entry and complete response mappings", () => {
  const entry = defaults().resolvers.find((r) => r.id === "jerry");
  assert(entry.enabled);
  assert.equal(entry.url, "https://music-api.jerrynis.com/api/song/url/v1");
  assert.deepEqual(entry.platforms, ["netease"]);
  assert.deepEqual(entry.params, { id: "{id}", level: "{level}" });
  assert.deepEqual(entry.urlPaths, ["data.0.url"]);
  assert.deepEqual(entry.codePaths, ["data.0.code"]);
  assert.equal(entry.timeout, 30000);
});
test("older user profiles gain Jerry without replacing custom routes or rewriting the original file", (t) => {
  const legacy = oldConfig();
  legacy.platforms[0].baseUrl = "https://custom.example.com";
  legacy.resolvers[0].enabled = false;
  const store = profile(t, legacy),
    file = path.join(store.dir, "providers.json"),
    original = fs.readFileSync(file);
  const registry = new ProviderRegistry(store, defaultsFile);
  assert.equal(
    registry.config.resolvers.filter((r) => r.id === "jerry").length,
    1,
  );
  assert.deepEqual(registry.config.platforms, legacy.platforms);
  assert.deepEqual(
    registry.config.resolvers.slice(0, legacy.resolvers.length),
    legacy.resolvers,
  );
  assert(fs.readFileSync(file).equals(original));
  registry.save(registry.config);
  const restarted = new ProviderRegistry(store, defaultsFile);
  assert.equal(
    restarted.config.resolvers.filter((r) => r.id === "jerry").length,
    1,
  );
  assert(restarted.config.bundledResolverMigrations.includes("jerry-v1"));
});
test("existing disabled or customized Jerry entries retain their exact settings", (t) => {
  const config = defaults();
  delete config.bundledResolverMigrations;
  const entry = config.resolvers.find((r) => r.id === "jerry");
  Object.assign(entry, {
    enabled: false,
    url: "https://custom.example.com/jerry",
    timeout: 45000,
  });
  const registry = new ProviderRegistry(profile(t, config), defaultsFile);
  assert.deepEqual(
    registry.config.resolvers.find((r) => r.id === "jerry"),
    entry,
  );
});
test("saving an imported legacy configuration immediately makes bundled Jerry available", (t) => {
  const store = profile(t),
    registry = new ProviderRegistry(store, defaultsFile);
  registry.save(oldConfig());
  assert(registry.config.resolvers.some((r) => r.id === "jerry"));
  assert(
    JSON.parse(fs.readFileSync(registry.goodFile)).resolvers.some(
      (r) => r.id === "jerry",
    ),
  );
});
test("an explicit removal after migration remains removed on subsequent launches", (t) => {
  const config = defaults();
  config.resolvers = config.resolvers.filter((r) => r.id !== "jerry");
  const store = profile(t, config),
    registry = new ProviderRegistry(store, defaultsFile);
  registry.save(registry.config);
  assert(
    !new ProviderRegistry(store, defaultsFile).config.resolvers.some(
      (r) => r.id === "jerry",
    ),
  );
});
test("damaged user config can recover an older last-good profile with Jerry available", (t) => {
  const store = profile(t);
  fs.writeFileSync(path.join(store.dir, "providers.json"), "{broken");
  fs.writeFileSync(
    path.join(store.dir, "providers.last-good.json"),
    JSON.stringify(oldConfig()),
  );
  const registry = new ProviderRegistry(store, defaultsFile);
  assert(registry.configWarning);
  assert(registry.config.resolvers.some((r) => r.id === "jerry"));
  assert.equal(fs.readFileSync(registry.file, "utf8"), "{broken");
});
