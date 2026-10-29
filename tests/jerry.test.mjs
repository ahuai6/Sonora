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
