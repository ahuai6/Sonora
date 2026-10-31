import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../main/core/store.mjs";
import { ProviderRegistry } from "../main/providers/registry.mjs";
import { stopSdkWorkers } from "../main/providers/sdk-client.mjs";
import { probeAudio } from "../main/services/audio-info.mjs";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sonora-quality-probe-"));
const store = new Store(dir, { downloadDir: dir });
store.data.settings.preferredResolver = "builtin";
const registry = new ProviderRegistry(
  store,
  path.resolve("profiles/providers.json"),
);
const results = [];
const check = async (platform, tier, track) => {
  const started = Date.now();
  try {
    const resolved = await registry.resolve(track, tier, "download", {
      signal: AbortSignal.timeout(12000),
    });
    const info = await probeAudio(resolved).catch((e) => ({
      error: e.message,
    }));
    results.push({
      platform,
      tier,
      status: "url-returned",
      origin: new URL(resolved.url).origin,
      source: resolved.source,
      info,
      elapsed: Date.now() - started,
    });
  } catch (e) {
    results.push({
      platform,
      tier,
      status: "unavailable-in-anonymous-probe",
      message: e.message,
      elapsed: Date.now() - started,
    });
  }
};
try {
  await Promise.allSettled([
    check("netease", "hires", {
      platform: "netease",
      id: "33894312",
      title: "测试",
      artist: "",
      meta: {},
    }),
    check("netease", "master", {
      platform: "netease",
      id: "33894312",
      title: "测试",
      artist: "",
      meta: {},
    }),
    check("qq", "master", {
      platform: "qq",
      id: "0039MnYb0qxYhV",
      title: "测试",
      artist: "",
      meta: {},
    }),
    (async () => {
      const found = await registry.search(
        { query: "海阔天空", kind: "song", platform: "kugou", limit: 1 },
        { signal: AbortSignal.timeout(12000) },
      );
      const track = found.items[0];
      if (track) await check("kugou", "master", track);
      else
        results.push({
          platform: "kugou",
          tier: "master",
          status: "no-test-track",
          errors: found.errors,
        });
    })(),
  ]);
  fs.mkdirSync("outputs", { recursive: true });
  fs.writeFileSync(
    "outputs/quality-live.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        scope: "anonymous, isolated profile, no credentials",
        results,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(results, null, 2));
} finally {
  stopSdkWorkers();
  fs.rmSync(dir, { recursive: true, force: true });
}
