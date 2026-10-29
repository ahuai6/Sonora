import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "../main/core/store.mjs";
import { ProviderRegistry } from "../main/providers/registry.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const store = new Store(path.join(root, "test-artifacts/live"), {
  downloadDir: path.join(root, "test-artifacts/music"),
});
const registry = new ProviderRegistry(
  store,
  path.join(root, "profiles/providers.json"),
);
const results = [];
for (const platform of ["netease", "qq", "kugou"]) {
  for (const operation of ["search", "charts", "recommend"]) {
    const t = Date.now();
    try {
      const result =
        operation === "search"
          ? await registry.search({
              query: "海阔天空",
              kind: "song",
              platform,
              limit: 3,
            })
          : await registry.browse(platform, operation, { limit: 3 });
      const out = {
        platform,
        operation,
        elapsed: Date.now() - t,
        count: result.items.length,
        samples: result.items.slice(0, 2),
        errors: result.errors,
      };
      results.push(out);
      console.log(JSON.stringify(out));
    } catch (e) {
      const out = {
        platform,
        operation,
        elapsed: Date.now() - t,
        error: e.message,
      };
      results.push(out);
      console.log(JSON.stringify(out));
    }
  }
}
fs.mkdirSync(path.join(root, "test-artifacts"), { recursive: true });
fs.writeFileSync(
  path.join(root, "test-artifacts/live-results.json"),
  JSON.stringify(results, null, 2),
);
