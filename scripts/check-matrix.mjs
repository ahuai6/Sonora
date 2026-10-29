import path from "node:path";
import fs from "node:fs";
import { Store } from "../main/core/store.mjs";
import { ProviderRegistry } from "../main/providers/registry.mjs";
const store = new Store(path.resolve("test-artifacts/live"), {
  downloadDir: path.resolve("test-artifacts/music"),
});
const registry = new ProviderRegistry(
  store,
  path.resolve("profiles/providers.json"),
);
const report = [];
for (const platform of ["netease", "qq", "kugou"]) {
  for (const kind of ["song", "artist", "album", "playlist"]) {
    try {
      const r = await registry.search({
        platform,
        kind,
        query: "周杰伦",
        limit: 3,
      });
      const result = {
        platform,
        kind,
        count: r.items.length,
        sample: r.items[0],
        errors: r.errors,
      };
      if (r.items[0] && kind !== "song") {
        try {
          const c = await registry.browse(platform, kind, {
            id: r.items[0].id,
            limit: 3,
          });
          result.collectionCount = c.items.length;
          result.collectionSample = c.items[0];
          if (!c.items.length) {
            const raw = await registry.bridge.call(
              registry.profile(platform),
              kind,
              registry.variables(platform, { id: r.items[0].id, limit: 3 }),
            );
            fs.writeFileSync(
              `test-artifacts/${platform}-${kind}-collection.json`,
              JSON.stringify(raw, null, 2),
            );
          }
        } catch (e) {
          result.collectionError = e.message;
        }
      }
      report.push(result);
      console.log(JSON.stringify(result));
    } catch (e) {
      console.log(platform, kind, e.message);
    }
  }
}
fs.writeFileSync("test-artifacts/matrix.json", JSON.stringify(report, null, 2));
