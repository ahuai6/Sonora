import test from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { File } from "node-taglib-sharp";
import {
  parseContainer,
  verifyEdit,
} from "../main/services/embedded-lyrics/container.mjs";
import {
  readEmbeddedLyrics,
  writeEmbeddedLyrics,
} from "../main/services/embedded-lyrics/files.mjs";
import { localLyricDocument } from "../main/services/lyrics.mjs";

const lrc = "[00:00.00]<00:00.00>Leave <00:00.40>the light on\n";
const ttml =
  '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:a="http://music.apple.com/lyric-ttml-internal"><body><div><p begin="0s" end="1s" a:key="L1"><span begin="0s" end="1s">Leave the light on</span></p></div></body></tt>';

for (const [ext, lyrics] of [
  ["mp3", lrc],
  ["flac", lrc],
  ["m4a", ttml],
]) {
  test(`selected ${ext} lyric field can be translated and removed without changing audio or other tags`, async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "sonora-embedded-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const file = join(dir, "tone." + ext);
    await copyFile(
      new URL(`./fixtures/tag-tone.${ext}`, import.meta.url),
      file,
    );
    const tags = File.createFromPath(file);
    try {
      tags.tag.title = "Fixture title";
      tags.tag.comment = "Keep this";
      tags.tag.lyrics = lyrics;
      tags.save();
    } finally {
      tags.dispose();
    }
    const before = parseContainer(await readFile(file), "." + ext);
    const [field] = await readEmbeddedLyrics(file);
    assert.equal(field.lines[0].text, "Leave the light on");
    const input = {
      fieldId: field.id,
      language: "zh-Hans",
      overwrite: false,
      translations: { [field.lines[0].id]: "把灯留着" },
      lrcReplaceIds: [],
    };
    await writeEmbeddedLyrics(file, input);
    const written = parseContainer(await readFile(file), "." + ext);
    assert.equal(
      localLyricDocument(written.fields[0].text).lines[0].translation,
      "把灯留着",
    );
    if (ext === "m4a")
      assert.match(written.fields[0].text, /for="L1">把灯留着/);
    else
      assert.equal(
        written.fields[0].text.trimEnd(),
        lrc + "[00:00.00]把灯留着",
      );
    verifyEdit(before, written, field.id, written.fields[0].text);
    await writeEmbeddedLyrics(file, { ...input, remove: true });
    verifyEdit(
      written,
      parseContainer(await readFile(file), "." + ext),
      field.id,
      null,
    );
  });
}
