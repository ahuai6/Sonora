import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  lyricDocument,
  exportLyrics,
  parseTimed,
  parseTtml,
  parseLrc,
} from "../main/services/lyrics.mjs";
import { errorMessage } from "../main/core/errors.mjs";
import { Store } from "../main/core/store.mjs";
import { ProviderRegistry } from "../main/providers/registry.mjs";

test("YRC keeps absolute word times and bilingual exports share exact line stamps", () => {
  const doc = lyricDocument({
    timed: "[12345,1000](12345,400,0)你(12745,600,0)好",
    translation: "[00:12.400]Hello",
  });
  assert.equal(doc.lines[0].words[1].start, 12745);
  const out = exportLyrics(doc, { format: "elrc", bilingual: true });
  assert.match(out.text, /\[00:12\.345\]<00:12\.345>你/);
  assert.match(out.text, /\[00:12\.345\]Hello/);
  assert.equal(out.extension, "lrc");
});
test("KRC relative word times convert to absolute; JSON metadata is not exported", () => {
  const lines = parseTimed(
    "[language:abc]\n[10000,900]<0,300,0>A<300,600,0>B",
    "krc",
  );
  assert.equal(lines.length, 1);
  assert.deepEqual(
    lines[0].words.map((w) => w.start),
    [10000, 10300],
  );
});
test("plain LRC cannot masquerade as genuine word timing", () => {
  const doc = lyricDocument({ original: "[00:10.00]one line" });
  assert.throws(() => exportLyrics(doc, { format: "elrc" }), /真实逐字/);
  assert.equal(exportLyrics(doc, { format: "auto" }).extension, "lrc");
});
test("TTML round trip preserves Unicode, XML escaping, word timing and translation", () => {
  const doc = lyricDocument({
    timed: "[12345,1000](12345,400,0)你&(12745,600,0)<好>",
    translation: "[00:12.345]Hello & world",
  });
  const out = exportLyrics(doc, { format: "ttml", bilingual: true });
  assert.match(out.text, /begin="00:00:12.345"/);
  const lines = parseTtml(out.text);
  assert.equal(lines[0].words[0].start, 12345);
  assert.equal(lines[0].text, "你&<好>");
  assert.equal(lines[0].translation, "Hello & world");
});
test("translation matching is bounded and never shifts an unrelated line", () => {
  const doc = lyricDocument({
    original: "[00:10]A\n[00:20]B",
    translation: "[00:40]Unrelated",
  });
  assert.equal(
    doc.lines.some((l) => l.translation),
    false,
  );
  const offset = parseLrc("[offset:-100]\n[00:10]A");
  assert.equal(offset[0].start, 9900);
});
test("structured SDK errors become useful text with secrets redacted", () => {
  assert.match(
    errorMessage({ status: 502, body: { data: "参数错误:20006" } }),
    /参数错误/,
  );
  assert.equal(
    errorMessage({ message: { msg: "token=secret failed" } }),
    "token=[已隐藏] failed",
  );
});
test("old settings acquire a stable Kugou dev identifier used for QR polling", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sonora-v110-"));
  fs.writeFileSync(
    path.join(dir, "state.json"),
    JSON.stringify({
      device: { KUGOU_API_MID: "a" },
      settings: { quality: "lossless" },
    }),
  );
  const store = new Store(dir);
  assert.equal(store.data.device.KUGOU_API_DEV, "Sonora Windows");
  assert.equal(store.data.settings.quality, "lossless");
  assert.equal(store.data.settings.lyricFormat, "auto");
});
test("explicit public source skips native engine and never silently switches platforms", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sonora-resolver-"));
  const store = new Store(dir);
  store.data.settings.preferredResolver = "missing";
  const registry = new ProviderRegistry(
    store,
    path.resolve("profiles/providers.json"),
  );
  let called = false;
  registry.bridge.call = async () => {
    called = true;
    return {};
  };
  await assert.rejects(
    () =>
      registry.resolve({ platform: "qq", id: "id", title: "x", artist: "y" }),
    /所选备用音源/,
  );
  assert.equal(called, false);
});
