import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url),
  asar = require("@electron/asar");
const file = path.resolve("release/win-unpacked/resources/app.asar"),
  entries = asar
    .listPackage(file)
    .map((x) => x.replaceAll("\\", "/").replace(/^\//, ""));
const extract = (name) =>
  asar.extractFile(file, name.replaceAll("/", path.sep));
const metadata = JSON.parse(asar.extractFile(file, "package.json").toString());
assert.equal(
  metadata.version,
  JSON.parse(fs.readFileSync("package.json")).version,
);
const unexpected = entries.filter(
  (x) =>
    /^(?:outputs|test-artifacts|\.audit|\.git|tests)(?:\/|$)/.test(x) ||
    /^(?:state\.json(?:\..*)?|\.env|providers\.last-good\.json)$/.test(x),
);
assert.deepEqual(unexpected, []);
const ownFiles = entries.filter(
  (x) =>
    /^(main|dist|profiles)\//.test(x) &&
    /\.(?:js|mjs|cjs|json|html|css)$/.test(x),
);
assert(ownFiles.length > 20, "packaged source inventory is unexpectedly empty");
const suspicious = [];
for (const name of ownFiles) {
  const content = extract(name).toString("utf8");
  if (
    /C:[\\/]Users[\\/]33318|"accounts"\s*:\s*\[\s*\{\s*"id"|"secret"\s*:\s*"[A-Za-z0-9+/=]{24,}"/.test(
      content,
    )
  )
    suspicious.push(name);
  if (name.startsWith("main/") || name.startsWith("profiles/"))
    assert.equal(
      createHash("sha256").update(extract(name)).digest("hex"),
      createHash("sha256").update(fs.readFileSync(name)).digest("hex"),
      "stale packaged source: " + name,
    );
}
assert.deepEqual(suspicious, []);
const result = {
  ok: true,
  version: metadata.version,
  ownSourceFilesChecked: ownFiles.length,
  excludedPersonalFiles: true,
  packagedSourceMatchesWorkspace: true,
};
fs.mkdirSync("outputs", { recursive: true });
fs.writeFileSync(
  "outputs/release-contents.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result));
