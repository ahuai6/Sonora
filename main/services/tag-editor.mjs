import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { File, Picture, PictureType, ByteVector } from "node-taglib-sharp";
import { parseFile } from "music-metadata";

const scalar = {
  title: "title",
  album: "album",
  comment: "comment",
  copyright: "copyright",
  isrc: "isrc",
  musicBrainzTrackId: "musicBrainzTrackId",
  musicBrainzReleaseId: "musicBrainzReleaseId",
};
const arrays = {
  artist: "performers",
  albumArtist: "albumArtists",
  composer: "composers",
  genre: "genres",
};
const numbers = {
  year: "year",
  track: "track",
  trackCount: "trackCount",
  disc: "disc",
  discCount: "discCount",
  bpm: "beatsPerMinute",
};
export const TAG_FIELDS = [
  ...Object.keys(scalar),
  ...Object.keys(arrays),
  ...Object.keys(numbers),
];
const revision = (s) => `${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
export function imageType(b) {
  if (b.subarray(0, 3).equals(Buffer.from([255, 216, 255])))
    return { mime: "image/jpeg", ext: "jpg" };
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return { mime: "image/png", ext: "png" };
  if (
    b.subarray(0, 4).toString() === "RIFF" &&
    b.subarray(8, 12).toString() === "WEBP"
  )
    return { mime: "image/webp", ext: "webp" };
  if (b.subarray(0, 3).toString() === "GIF")
    return { mime: "image/gif", ext: "gif" };
  return null;
}
export async function cacheCover(dir, picture) {
  if (!picture?.data) return "";
  const b = Buffer.from(picture.data),
    type = imageType(b);
  if (!type || b.length > 12 * 1024 * 1024) return "";
  const file = createHash("sha256").update(b).digest("hex") + "." + type.ext;
  await fs.promises.mkdir(dir, { recursive: true });
  try {
    await fs.promises.writeFile(path.join(dir, file), b, { flag: "wx" });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
  return `sonora-media://cover/${file}`;
}
export function readTags(file) {
  const f = File.createFromPath(file);
  try {
    const tags = {};
    for (const [key, prop] of Object.entries(scalar))
      tags[key] = f.tag[prop] || "";
    for (const [key, prop] of Object.entries(arrays))
      tags[key] = (f.tag[prop] || []).join("; ");
    for (const [key, prop] of Object.entries(numbers))
      tags[key] = f.tag[prop] || 0;
    return {
      tags,
      lyrics: f.tag.lyrics || "",
      writable: f.isWritable && !f.isPossiblyCorrupt,
      warning: f.corruptionReasons?.join("；") || "",
      pictures: f.tag.pictures.map((p) => ({
        type: p.type,
        mime: p.mimeType,
        data: Buffer.from(p.data.toByteArray()),
      })),
    };
  } finally {
    f.dispose();
  }
}
export class TagEditor {
  constructor(store, library) {
    this.store = store;
    this.library = library;
    this.locks = new Set();
    this.backupDir = path.join(store.dir, "tag-backups");
  }
  async read(id) {
    const item = this.library.known(id),
      stat = await fs.promises.stat(item.path),
      data = readTags(item.path);
    return {
      item,
      tags: data.tags,
      lyrics: data.lyrics,
      writable: data.writable,
      warning: data.warning,
      revision: revision(stat),
      cover: item.cover,
      backupAvailable: !!this.store.data.tagBackups?.[id],
    };
  }
  validate(patch) {
    if (!patch || typeof patch !== "object") throw Error("标签数据不正确");
    const tags = {};
    for (const key of TAG_FIELDS) {
      if (patch.tags?.[key] === undefined) continue;
      if (key in numbers) {
        const n = Number(patch.tags[key] || 0);
        if (!Number.isInteger(n) || n < 0 || n > 65535)
          throw Error("年份、曲序和碟序必须为有效的非负整数");
        tags[key] = n;
      } else {
        if (
          typeof patch.tags[key] !== "string" ||
          patch.tags[key].length > 16000 ||
          patch.tags[key].includes("\0")
        )
          throw Error("标签文本不正确或过长");
        tags[key] = patch.tags[key];
      }
    }
    if (
      patch.lyrics !== undefined &&
      (typeof patch.lyrics !== "string" ||
        Buffer.byteLength(patch.lyrics) > 1024 * 1024 ||
        patch.lyrics.includes("\0"))
    )
      throw Error("歌词内容过长或包含无效字符");
    let artwork;
    if (patch.artwork === null) artwork = null;
    else if (patch.artwork !== undefined) {
      if (
        typeof patch.artwork !== "string" ||
        patch.artwork.length > 17 * 1024 * 1024
      )
        throw Error("封面过大");
      const m = patch.artwork.match(
        /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=\r\n]+)$/,
      );
      if (!m) throw Error("请选择 JPEG 或 PNG 封面");
      const b = Buffer.from(m[2], "base64"),
        type = imageType(b);
      if (
        !type ||
        !["png", "jpg"].includes(type.ext) ||
        b.length > 12 * 1024 * 1024
      )
        throw Error("封面文件格式不正确");
      artwork = { data: b, mime: type.mime };
    }
    return { tags, lyrics: patch.lyrics, artwork };
  }
  async save(id, patch) {
    const input = this.validate(patch);
    return this.commit(id, patch.revision, async (temp) => {
      const f = File.createFromPath(temp);
      try {
        if (!f.isWritable || f.isPossiblyCorrupt)
          throw Error("此文件不支持安全写入标签，原文件未修改");
        for (const [key, value] of Object.entries(input.tags)) {
          if (key in arrays)
            f.tag[arrays[key]] = value
              .split(/\s*;\s*/)
              .map((x) => x.trim())
              .filter(Boolean);
          else f.tag[scalar[key] || numbers[key]] = value;
        }
        if (input.lyrics !== undefined) f.tag.lyrics = input.lyrics;
        if (input.artwork === null) f.tag.pictures = [];
        else if (input.artwork) {
          const p = Picture.fromData(
            ByteVector.fromByteArray(input.artwork.data),
          );
          p.type = PictureType.FrontCover;
          p.mimeType = input.artwork.mime;
          p.description = "Front cover";
          f.tag.pictures = [
            p,
            ...f.tag.pictures.filter((p) => p.type !== PictureType.FrontCover),
          ];
        }
        f.save();
      } finally {
        f.dispose();
      }
      const saved = readTags(temp);
      for (const [key, value] of Object.entries(input.tags)) {
        const expected =
          key in arrays
            ? value
                .split(/\s*;\s*/)
                .map((x) => x.trim())
                .filter(Boolean)
                .join("; ")
            : value;
        if (saved.tags[key] !== expected)
          throw Error(`此格式未能保存 ${key} 标签，原文件未修改`);
      }
      if (
        input.lyrics !== undefined &&
        saved.lyrics.replace(/\r\n/g, "\n") !==
          input.lyrics.replace(/\r\n/g, "\n")
      )
        throw Error("此格式未能保存内嵌歌词，原文件未修改");
      if (
        input.artwork &&
        !saved.pictures.some((p) => p.data.equals(input.artwork.data))
      )
        throw Error("封面写入验证失败，原文件未修改");
      if (input.artwork === null && saved.pictures.length)
        throw Error("封面移除验证失败，原文件未修改");
    });
  }
  async restore(id, expectedRevision) {
    const backup = this.store.data.tagBackups?.[id];
    if (!backup || path.basename(backup) !== backup)
      throw Error("没有可恢复的标签备份");
    const backupFile = path.join(this.backupDir, backup);
    return this.commit(id, expectedRevision, (temp) =>
      fs.promises.copyFile(backupFile, temp),
    );
  }
  async commit(id, expectedRevision, write) {
    const item = this.library.known(id);
    if (this.locks.has(id)) throw Error("此歌曲正在保存，请稍后重试");
    this.locks.add(id);
    const file = item.path,
      temp = path.join(
        path.dirname(file),
        `.sonora-tag-${randomUUID()}${path.extname(file)}`,
      );
    try {
      const stat = await fs.promises.stat(file);
      if (!expectedRevision || revision(stat) !== expectedRevision)
        throw Error("文件已发生变化，请重新打开编辑器，避免覆盖外部修改");
      await fs.promises.copyFile(file, temp, fs.constants.COPYFILE_EXCL);
      await write(temp);
      const [before, after] = await Promise.all([
        parseFile(file),
        parseFile(temp),
      ]);
      if (
        before.format.codec !== after.format.codec ||
        before.format.numberOfChannels !== after.format.numberOfChannels ||
        Math.abs((before.format.duration || 0) - (after.format.duration || 0)) >
          0.5
      )
        throw Error("标签写入后的音频校验失败，原文件未修改");
      if (revision(await fs.promises.stat(file)) !== expectedRevision)
        throw Error("保存期间文件被其他程序修改，请重新载入");
      await fs.promises.mkdir(this.backupDir, { recursive: true });
      const backup = `${id}-${randomUUID()}${path.extname(file)}`;
      await fs.promises.copyFile(
        file,
        path.join(this.backupDir, backup),
        fs.constants.COPYFILE_EXCL,
      );
      // Keep a recoverable original before replacing the validated temporary file.
      this.store.data.tagBackups ||= {};
      this.store.data.tagBackups[id] = backup;
      this.store.save();
      await fs.promises.rename(temp, file);
      const result = await this.library.importFiles([file], { force: true });
      return { items: result.items, editor: await this.read(id) };
    } finally {
      await fs.promises.unlink(temp).catch(() => {});
      this.locks.delete(id);
    }
  }
}
