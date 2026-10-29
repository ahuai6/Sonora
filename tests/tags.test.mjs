import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Store } from "../main/core/store.mjs";
import { MusicLibrary } from "../main/services/files.mjs";
import { TagEditor, readTags } from "../main/services/tag-editor.mjs";
import { MediaService } from "../main/services/media.mjs";

function audioPayload(b, ext) {
  if (ext === "wav") {
    let offset = 12;
    while (offset + 8 <= b.length) {
      const n = b.readUInt32LE(offset + 4);
      if (b.subarray(offset, offset + 4).toString() === "data")
        return b.subarray(offset + 8, offset + 8 + n);
      offset += 8 + n + (n % 2);
    }
    throw Error("No WAV audio");
  }
  if (ext === "flac") {
    let offset = b.indexOf("fLaC") + 4;
    while (offset >= 4) {
      const last = b[offset] & 128,
        n = b.readUIntBE(offset + 1, 3);
      offset += 4 + n;
      if (last) return b.subarray(offset);
    }
    throw Error("No FLAC audio");
  }
  if (ext === "m4a") {
    let offset = 0;
    while (offset + 8 < b.length) {
      const size = b.readUInt32BE(offset),
        name = b.subarray(offset + 4, offset + 8).toString();
      if (name === "mdat") return b.subarray(offset + 8, offset + size);
      if (!size) break;
      offset += size;
    }
    throw Error("No MP4 audio");
  }
  if (ext === "mp3") {
    let start = 0;
    if (b.subarray(0, 3).toString() === "ID3")
      start = 10 + ((b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]);
    let end = b.length;
    if (b.subarray(end - 128, end - 125).toString() === "TAG") end -= 128;
    return b.subarray(start, end);
  }
  const packets = [];
  let offset = 0,
    parts = [];
  while (offset + 27 <= b.length) {
    assert.equal(b.subarray(offset, offset + 4).toString(), "OggS");
    const n = b[offset + 26];
    let p = offset + 27 + n;
    for (let i = 0; i < n; i++) {
      const len = b[offset + 27 + i];
      parts.push(b.subarray(p, p + len));
      p += len;
      if (len < 255) {
        packets.push(Buffer.concat(parts));
        parts = [];
      }
    }
    offset = p;
  }
  return Buffer.concat(packets.slice(ext === "opus" ? 2 : 3));
}
async function setup(ext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sonora-tags-")),
    file = path.join(dir, "Artist - Tone." + ext);
  fs.copyFileSync(path.resolve("tests/fixtures/tag-tone." + ext), file);
  const store = new Store(path.join(dir, "state")),
    library = new MusicLibrary(store);
  await library.importFiles([file]);
  return {
    dir,
    file,
    store,
    library,
    editor: new TagEditor(store, library),
    id: library.list()[0].id,
  };
}
const cover = fs.readFileSync("build/icon.png");
for (const ext of ["wav", "mp3", "flac", "m4a", "ogg", "opus"])
  test(`${ext}: persists Unicode tags, artwork and editable embedded LRC without changing audio payload`, async () => {
    const { file, editor, id, library } = await setup(ext),
      before = fs.readFileSync(file),
      original = await editor.read(id);
    const lyrics = "[00:00.000]测试歌词\n[00:00.000]Translated line";
    const tags = {
      title: "新曲名 🎵",
      artist: "甲; 乙",
      album: "测试专辑",
      albumArtist: "测试艺术家",
      year: 2026,
      track: 2,
      trackCount: 10,
      disc: 1,
      discCount: 2,
      genre: "Pop; 中文",
      composer: "作曲者",
      isrc: "USABC2600001",
      musicBrainzTrackId: "15c3ce62-dbf8-4d9c-bcf3-1e904b696011",
      musicBrainzReleaseId: "8dc38459-b625-4aaf-975c-f2bf302f8b62",
      comment: "自定义备注",
    };
    const saved = await editor.save(id, {
      revision: original.revision,
      tags,
      lyrics,
      artwork: "data:image/png;base64," + cover.toString("base64"),
    });
    assert.equal(saved.editor.tags.title, tags.title);
    assert.equal(saved.editor.tags.artist, tags.artist);
    assert.equal(saved.editor.lyrics, lyrics);
    assert(saved.editor.backupAvailable);
    assert.match(library.known(id).cover, /^sonora-media:\/\/cover\//);
    assert.equal(library.known(id).id, id);
    assert.deepEqual(
      audioPayload(fs.readFileSync(file), ext),
      audioPayload(before, ext),
    );
    const media = new MediaService({ coverDir: library.coverDir }),
      response = await media.handle(new Request(library.known(id).cover));
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), cover);
    await editor.restore(id, saved.editor.revision);
    assert.deepEqual(fs.readFileSync(file), before);
  });
test("stale revisions and malformed cover data do not alter the original file", async () => {
  const { file, editor, id } = await setup("flac");
  const s = await editor.read(id),
    before = fs.readFileSync(file);
  await assert.rejects(
    () =>
      editor.save(id, {
        revision: s.revision,
        tags: { title: "x" },
        artwork: "data:image/png;base64,PHNjcmlwdD4=",
      }),
    /格式/,
  );
  assert.deepEqual(fs.readFileSync(file), before);
  fs.utimesSync(file, new Date(), new Date(Date.now() + 1000));
  await assert.rejects(
    () => editor.save(id, { revision: s.revision, tags: { title: "x" } }),
    /文件已发生变化/,
  );
  assert.deepEqual(fs.readFileSync(file), before);
});
test("a partial tag edit preserves existing artwork and lyrics; explicit removal clears them", async () => {
  const { editor, id } = await setup("mp3");
  let s = await editor.read(id);
  let result = await editor.save(id, {
    revision: s.revision,
    tags: { title: "First" },
    lyrics: "plain lyrics",
    artwork: "data:image/png;base64," + cover.toString("base64"),
  });
  result = await editor.save(id, {
    revision: result.editor.revision,
    tags: { title: "Second" },
  });
  assert.equal(result.editor.lyrics, "plain lyrics");
  assert(result.editor.cover);
  result = await editor.save(id, {
    revision: result.editor.revision,
    tags: {},
    lyrics: "",
    artwork: null,
  });
  assert.equal(result.editor.lyrics, "");
  assert.equal(result.editor.cover, "");
});
test("a failed final file replacement preserves the audio and releases the edit lock", async () => {
  const { editor, id, file, dir } = await setup("flac");
  const snapshot = await editor.read(id),
    original = fs.readFileSync(file),
    rename = fs.promises.rename;
  fs.promises.rename = async (from, to) => {
    if (path.basename(from).startsWith(".sonora-tag-"))
      throw Object.assign(Error("File locked by another player"), {
        code: "EPERM",
      });
    return rename(from, to);
  };
  try {
    await assert.rejects(
      () =>
        editor.save(id, {
          revision: snapshot.revision,
          tags: { title: "Must not replace" },
        }),
      /File locked/,
    );
  } finally {
    fs.promises.rename = rename;
  }
  assert.deepEqual(fs.readFileSync(file), original);
  assert(!fs.readdirSync(dir).some((n) => n.startsWith(".sonora-tag-")));
  const saved = await editor.save(id, {
    revision: (await editor.read(id)).revision,
    tags: { title: "After failure" },
  });
  assert.equal(saved.editor.tags.title, "After failure");
});
