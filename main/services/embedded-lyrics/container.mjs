import { createHash } from "node:crypto";
import { parseFlac } from "./flac.mjs";
import { parseId3 } from "./id3.mjs";
import { parseMp4 } from "./mp4.mjs";

export function emptySong() {
  return { title: "", artist: "", album: "", version: "", isrc: "" };
}

export function requireRange(data, start, size) {
  if (
    !Number.isSafeInteger(size) ||
    start < 0 ||
    size < 0 ||
    size > data.length - start
  ) {
    throw new Error("文件的标签结构不完整或超出边界。");
  }
}

export function imageData(data, mime) {
  if (data.length > 4 * 1024 * 1024) return;
  if (mime === "image/jpeg" || mime === "image/png" || mime === "image/webp") {
    return "data:" + mime + ";base64," + data.toString("base64");
  }
}

export function readUtf(data, encoding = "utf-8") {
  return new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(
    data,
  );
}

export function hash(data) {
  return createHash("sha256").update(data).digest("hex");
}

export function parseContainer(data, extension) {
  if (data.subarray(0, 4).toString("ascii") === "fLaC") return parseFlac(data);
  if (extension === ".mp3" && data.subarray(0, 3).toString("ascii") === "ID3")
    return parseId3(data);
  if (extension === ".m4a" || extension === ".mp4") return parseMp4(data);
  throw new Error(
    "找不到受支持的内嵌歌词标签。请导入带 ID3v2 的 MP3、FLAC 或 M4A。",
  );
}

export function verifyEdit(before, after, id, text) {
  const same = (left, right) =>
    left.length === right.length &&
    left.every((item, index) => item.equals(right[index]));
  if (before.kind !== after.kind || !same(before.audio, after.audio)) {
    throw new Error("音频数据校验失败，原文件已保留。");
  }
  if (!same(before.protectedData, after.protectedData)) {
    throw new Error("非目标元数据校验失败，原文件已保留。");
  }
  const index = before.fields.findIndex((field) => field.id === id);
  if (index === -1) throw new Error("指定字段不存在。");
  const otherFields = before.fields.filter((_, i) => i !== index);
  const afterOtherFields =
    text === null ? after.fields : after.fields.filter((_, i) => i !== index);
  if (
    otherFields.length !== afterOtherFields.length ||
    otherFields.some(
      (field, i) =>
        field.name !== afterOtherFields[i].name ||
        !field.raw.equals(afterOtherFields[i].raw),
    )
  ) {
    throw new Error("其他歌词字段校验失败，原文件已保留。");
  }
  if (
    text !== null &&
    (after.fields[index]?.text !== text ||
      after.fields[index]?.name !== before.fields[index].name)
  ) {
    throw new Error("写入的歌词读回结果不一致，原文件已保留。");
  }
}

export function isLyricsName(name) {
  return /^(TTML|LRC|LYRICS|UNSYNCEDLYRICS)$/i.test(name);
}
