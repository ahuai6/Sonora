import {
  emptySong,
  imageData,
  isLyricsName,
  readUtf,
  requireRange,
} from "./container.mjs";

export function parseFlac(data) {
  const song = emptySong();
  const fields = [];
  const protectedData = [data.subarray(0, 4)];
  let cover;
  let offset = 4;
  let blockStart = -1;
  let blockEnd = -1;
  let blockFlags = 0;
  let vendor = Buffer.alloc(0);
  const entries = [];
  for (;;) {
    requireRange(data, offset, 4);
    const flags = data[offset];
    const length = data.readUIntBE(offset + 1, 3);
    const start = offset + 4;
    requireRange(data, start, length);
    const end = start + length;
    const type = flags & 127;
    if (type === 4) {
      if (blockStart !== -1)
        throw new Error("FLAC 中存在重复的 Vorbis 注释区。");
      blockStart = offset;
      blockEnd = end;
      blockFlags = flags;
      const body = data.subarray(start, end);
      requireRange(body, 0, 4);
      const vendorLength = body.readUInt32LE(0);
      requireRange(body, 4, vendorLength + 4);
      vendor = body.subarray(0, 4 + vendorLength);
      protectedData.push(vendor);
      const count = body.readUInt32LE(vendor.length);
      let position = vendor.length + 4;
      if (count > (body.length - position) / 4)
        throw new Error("FLAC 注释数超出边界。");
      for (let index = 0; index < count; index++) {
        requireRange(body, position, 4);
        const size = body.readUInt32LE(position);
        requireRange(body, position + 4, size);
        const raw = body.subarray(position, position + 4 + size);
        const item = raw.subarray(4);
        const separator = item.indexOf(61);
        const key =
          separator > 0 ? item.subarray(0, separator).toString("latin1") : "";
        let value = null;
        if (separator > 0) {
          try {
            value = readUtf(item.subarray(separator + 1));
          } catch {
            /* keep opaque bytes */
          }
        }
        if (isLyricsName(key)) {
          const id = "flac:" + index;
          entries.push({ raw, id, keyBytes: item.subarray(0, separator + 1) });
          fields.push({ id, raw, name: key, text: value });
        } else {
          protectedData.push(raw);
          entries.push({ raw });
          switch (key.toUpperCase()) {
            case "TITLE":
              song.title ||= value ?? "";
              break;
            case "ARTIST":
              song.artist ||= value ?? "";
              break;
            case "ALBUM":
              song.album ||= value ?? "";
              break;
            case "VERSION":
              song.version ||= value ?? "";
              break;
            case "ISRC":
              song.isrc ||= value ?? "";
              break;
          }
        }
        position += raw.length;
      }
      if (position !== body.length)
        throw new Error("FLAC 注释区包含未识别的尾部数据。");
    } else {
      protectedData.push(data.subarray(offset, end));
      if (type === 6 && !cover) {
        try {
          const picture = data.subarray(start, end);
          requireRange(picture, 0, 8);
          const mimeSize = picture.readUInt32BE(4);
          requireRange(picture, 8, mimeSize + 4);
          const mime = picture.toString("ascii", 8, 8 + mimeSize);
          const descriptionSize = picture.readUInt32BE(8 + mimeSize);
          const imageLength = 12 + mimeSize + descriptionSize + 16;
          requireRange(picture, imageLength, 4);
          const size = picture.readUInt32BE(imageLength);
          requireRange(picture, imageLength + 4, size);
          cover = imageData(
            picture.subarray(imageLength + 4, imageLength + 4 + size),
            mime,
          );
        } catch {
          /* picture remains opaque and protected */
        }
      }
    }
    offset = end;
    if (flags & 128) break;
  }
  const audio = data.subarray(offset);
  if (!audio.length) throw new Error("FLAC 文件没有音频帧。");
  return {
    kind: "FLAC",
    song,
    cover,
    fields,
    audio: [audio],
    protectedData,
    edit(id, text) {
      const target = entries.find((entry) => entry.id === id);
      if (!target?.keyBytes) throw new Error("找不到指定的 FLAC 字段。");
      const updated = entries.flatMap((entry) => {
        if (entry !== target) return [entry.raw];
        if (text === null) return [];
        const payload = Buffer.concat([target.keyBytes, Buffer.from(text)]);
        const length = Buffer.alloc(4);
        length.writeUInt32LE(payload.length);
        return [Buffer.concat([length, payload])];
      });
      const count = Buffer.alloc(4);
      count.writeUInt32LE(updated.length);
      const body = Buffer.concat([vendor, count, ...updated]);
      if (body.length > 0xffffff) throw new Error("FLAC 注释超过容器容量。");
      const header = Buffer.alloc(4);
      header[0] = blockFlags;
      header.writeUIntBE(body.length, 1, 3);
      return Buffer.concat([
        data.subarray(0, blockStart),
        header,
        body,
        data.subarray(blockEnd),
      ]);
    },
  };
}
