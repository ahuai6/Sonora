import fs from "node:fs";
// electron-builder 26 still bundles two consumers of the old callable default.
// Only adapt their import to minimatch 11's public function; do not fork matching.
for (const relative of [
  "@electron/asar/lib/asar.js",
  "dir-compare/build/src/FilterHandler/defaultFilterHandler.js",
]) {
  const file = new URL("../node_modules/" + relative, import.meta.url);
  const before = fs.readFileSync(file, "utf8");
  const old = '__importDefault(require("minimatch"))',
    replacement = '{ default: require("minimatch").minimatch }';
  if (before.includes(replacement)) continue;
  if (!before.includes(old))
    throw Error("构建依赖已变化，请复核 minimatch 导入兼容补丁：" + relative);
  fs.writeFileSync(file, before.replace(old, replacement));
}
console.log(
  "Verified legacy build imports use the patched minimatch public API.",
);
