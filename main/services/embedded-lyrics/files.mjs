import { open, readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import { parseContainer, verifyEdit } from "./container.mjs";
import { describeField, renderField } from "./lyrics.mjs";

export const supportsEmbeddedLyrics = (file) =>
  /\.(mp3|flac|m4a|mp4)$/i.test(file);

async function readContainer(file) {
  if (!supportsEmbeddedLyrics(file))
    throw Error("请选择 MP3、FLAC 或 M4A 音频");
  if ((await stat(file)).size > 512 * 1024 ** 2) throw Error("音频超过 512 MB");
  return parseContainer(await readFile(file), extname(file).toLowerCase());
}

export async function readEmbeddedLyrics(file) {
  return (await readContainer(file)).fields.map(describeField);
}

export async function firstEmbeddedLyric(file) {
  const { fields } = await readContainer(file);
  return fields.find((field) => describeField(field).format)?.text ?? "";
}

export async function writeEmbeddedLyrics(file, input) {
  const before = await readContainer(file);
  const field = before.fields.find(({ id }) => id === input.fieldId);
  if (!field) throw Error("找不到选中的歌词字段");
  const text = input.remove ? null : renderField(field, input);
  if (text !== null && text === field.text)
    throw Error("此字段没有需要写回的改动");
  if (text !== null && Buffer.byteLength(text) > 4 * 1024 ** 2)
    throw Error("歌词字段超过 4 MB");
  const edited = before.edit(field.id, text);
  const handle = await open(file, "r+");
  try {
    await handle.truncate(0);
    await handle.writeFile(edited);
    await handle.sync();
  } finally {
    await handle.close();
  }
  verifyEdit(before, await readContainer(file), field.id, text);
}
