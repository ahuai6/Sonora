import fs from "node:fs";
const packages = [
  "@neteasecloudmusicapienhanced/api",
  "@sansenjian/qq-music-api",
  "kugoumusicapi",
  "music-metadata",
  "qrcode",
  "@xmldom/xmldom",
  "react",
  "react-dom",
  "lucide-react",
  "electron",
];
let text =
  "# Third-party notices\n\nSonora uses the following open-source projects. Platform audio, lyrics and artwork remain with their original rights holders. Public API access does not grant content redistribution rights.\n\n";
for (const name of packages) {
  const dir = "node_modules/" + name;
  const pkg = JSON.parse(fs.readFileSync(dir + "/package.json", "utf8"));
  text += `## ${name} ${pkg.version}\n\n${pkg.homepage || pkg.repository?.url || ""}\n\nLicense: ${pkg.license || "See package"}\n\n`;
  const license = [
    "LICENSE",
    "LICENSE.md",
    "LICENSE.txt",
    "LICENSE-MIT",
    "license",
    "LICENSE.electron.txt",
  ].find((f) => fs.existsSync(dir + "/" + f));
  if (license)
    text +=
      "```text\n" +
      fs.readFileSync(dir + "/" + license, "utf8").trim() +
      "\n```\n\n";
}
text +=
  "## Vendored KuGou API source\n\nMakcRe/KuGouMusicApi, commit `5d6c9f7b180279c9dd08bc6f7159de52a856d587`. The complete source and MIT license are retained in `vendor/kugou/`.\n\nChromium and Electron distribution notices are also included with the packaged executable. Transitive dependencies retain their package licenses.\n";
text +=
  "\n## LRC-GET lyric decoder\n\nhttps://github.com/valenbine/LRC-GET (commit 2cc0e67dcfc567a122ebb953ef696783a6760d17, retrieved 2026-10-29). Files retained in main/vendor/lrc-get.\n\n" +
  fs.readFileSync("main/vendor/lrc-get/LICENSE", "utf8");
fs.writeFileSync("THIRD-PARTY-NOTICES.md", text);
