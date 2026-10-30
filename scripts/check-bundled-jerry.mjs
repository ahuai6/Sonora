import path from "node:path";
import assert from "node:assert/strict";
import { extractFile } from "@electron/asar";
const archive = path.resolve(
  process.argv[2] || "release/win-unpacked/resources/app.asar",
);
const read = (file) =>
  extractFile(archive, path.normalize(file)).toString("utf8");
const config = JSON.parse(read("profiles/providers.json"));
const entries = config.resolvers.filter((r) => r.id === "jerry");
assert.equal(
  entries.length,
  1,
  "Release must contain exactly one Jerry resolver",
);
const jerry = entries[0];
assert(jerry.enabled);
assert.equal(jerry.url, "https://music-api.jerrynis.com/api/song/url/v1");
assert.deepEqual(jerry.platforms, ["netease"]);
assert.deepEqual(jerry.params, { id: "{id}", level: "{level}" });
assert.deepEqual(jerry.urlPaths, ["data.0.url"]);
assert.deepEqual(jerry.codePaths, ["data.0.code"]);
assert.equal(jerry.timeout, 30000);
assert(config.bundledResolverMigrations.includes("jerry-v1"));
assert(read("main/providers/migrations.mjs").includes('resolver: "jerry"'));
assert(read("main/providers/registry.mjs").includes("mergeBundledResolvers"));
const { version } = JSON.parse(read("package.json"));
console.log(
  JSON.stringify({
    ok: true,
    version,
    jerryBundled: true,
    legacyProfileUpgradeBundled: true,
  }),
);
