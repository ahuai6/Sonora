import {
  emptySong,
  imageData,
  isLyricsName,
  readUtf,
  requireRange,
} from "./container.mjs";

function boxes(data, start, end) {
  const result = [];
  for (let at = start; at < end;) {
    requireRange(data, at, 8);
    let size = data.readUInt32BE(at);
    const type = data.toString("latin1", at + 4, at + 8);
    let header = 8;
    if (size === 1) {
      header = 16;
      requireRange(data, at, header);
      size = Number(data.readBigUInt64BE(at + 8));
    } else if (size === 0) {
      size = end - at;
    }
    if (type === "uuid") header += 16;
    if (!Number.isSafeInteger(size) || size < header || size > end - at)
      throw new Error("M4A 的 atom 长度无效。");
    result.push({
      type,
      start: at,
      header,
      end: at + size,
      raw: data.subarray(at, at + size),
      body: data.subarray(at + header, at + size),
    });
    at += size;
  }
  return result;
}

function resized(box, body) {
  const head = Buffer.from(box.raw.subarray(0, box.header));
  const length = head.length + body.length;
  if (head.readUInt32BE(0) === 1) head.writeBigUInt64BE(BigInt(length), 8);
  else head.writeUInt32BE(length, 0);
  return Buffer.concat([head, body]);
}

function freeBox(size) {
  if (size === 0) return Buffer.alloc(0);
  const buffer = Buffer.alloc(size);
  buffer.writeUInt32BE(size, 0);
  buffer.write("free", 4);
  return buffer;
}

function isPadding(box) {
  return box.type === "free" && !box.body.some(Boolean);
}

function textFromData(box) {
  if (box.body.length < 8) return null;
  const kind = box.body.readUInt32BE(0);
  try {
    if (kind === 1) return readUtf(box.body.subarray(8));
    if (kind === 2) return readUtf(box.body.subarray(8), "utf-16be");
  } catch {
    /* unknown bytes can still be preserved or the selected item deleted */
  }
  return null;
}

export function parseMp4(data) {
  const top = boxes(data, 0, data.length);
  const media = top.filter((box) => box.type === "mdat");
  const movies = top.filter((box) => box.type === "moov");
  if (
    !top.some((box) => box.type === "ftyp") ||
    movies.length !== 1 ||
    !media.length ||
    top.some((box) => box.type === "moof" || box.type === "mfra")
  ) {
    throw new Error("只支持本地、非分片的 M4A 容器。");
  }
  const movie = movies[0];
  const tables = new Map();
  const fields = [];
  const lyrics = new Map();
  const song = emptySong();
  let cover;
  let restrictedOffsets = top.some((box) =>
    ["sidx", "ssix", "uuid", "meta"].includes(box.type),
  );
  const containers = new Set([
    "moov",
    "trak",
    "mdia",
    "minf",
    "stbl",
    "udta",
    "meta",
    "ilst",
  ]);

  function readItem(item) {
    const children = boxes(data, item.start + item.header, item.end);
    const values = children.filter((child) => child.type === "data");
    const value = values[0];
    let name = item.type;
    if (name === "----") {
      const mean = children.find((child) => child.type === "mean");
      const key = children.find((child) => child.type === "name");
      if (!mean || !key || mean.body.length < 4 || key.body.length < 4) return;
      const domain = mean.body.toString("utf8", 4);
      const label = key.body.toString("utf8", 4);
      name += ":" + domain + ":" + label;
      if (
        domain === "com.apple.iTunes" &&
        label.toUpperCase() === "ISRC" &&
        value
      )
        song.isrc ||= textFromData(value) ?? "";
      if (
        domain === "com.apple.iTunes" &&
        label.toUpperCase() === "VERSION" &&
        value
      )
        song.version ||= textFromData(value) ?? "";
      if (
        !isLyricsName(label) ||
        (domain !== "com.apple.iTunes" && label.toUpperCase() !== "TTML")
      )
        return;
    } else if (name !== "©lyr") {
      if (name === "covr" && value?.body.length >= 8 && !cover) {
        const imageType = value.body.readUInt32BE(0);
        cover = imageData(
          value.body.subarray(8),
          imageType === 13 ? "image/jpeg" : imageType === 14 ? "image/png" : "",
        );
      }
      const keys = { "©nam": "title", "©ART": "artist", "©alb": "album" };
      const key = keys[name];
      if (key && value) song[key] ||= textFromData(value) ?? "";
      return;
    }
    if (
      values.length !== 1 ||
      children.some(
        (child) =>
          !["data", ...(item.type === "----" ? ["mean", "name"] : [])].includes(
            child.type,
          ),
      )
    )
      return;
    const field = {
      id: "mp4:" + fields.length,
      name,
      text: textFromData(value),
      raw: item.raw,
    };
    fields.push(field);
    lyrics.set(item, { field, value });
  }

  function scan(box, parent = "") {
    if (parent === "ilst") {
      try {
        readItem(box);
      } catch {
        /* unrecognized item is preserved byte for byte */
      }
      return;
    }
    if (["saio", "iloc", "sidx", "uuid", "mvex", "cmov"].includes(box.type))
      restrictedOffsets = true;
    if (box.type === "stco" || box.type === "co64") {
      const width = box.type === "stco" ? 4 : 8;
      requireRange(box.body, 0, 8);
      const count = box.body.readUInt32BE(4);
      if (box.body.length !== 8 + count * width)
        throw new Error("M4A 块偏移表不完整。");
      const positions = Array.from({ length: count }, (_, i) => {
        const at = 8 + width * i;
        const position =
          width === 4
            ? box.body.readUInt32BE(at)
            : Number(box.body.readBigUInt64BE(at));
        const group = media.find(
          (item) => item.start + item.header <= position && position < item.end,
        );
        if (!group) throw new Error("M4A 有音频块指向文件外部或未知区域。");
        return { media: group, offset: position - group.start - group.header };
      });
      tables.set(box, { width, positions });
    } else if (containers.has(box.type)) {
      const prefixLength = box.type === "meta" ? 4 : 0;
      requireRange(box.body, 0, prefixLength);
      box.prefix = box.body.subarray(0, prefixLength);
      box.children = boxes(
        data,
        box.start + box.header + prefixLength,
        box.end,
      );
      for (const child of box.children) scan(child, box.type);
    }
  }
  scan(movie);

  const protectedData = [];
  function protect(box) {
    if (lyrics.has(box) || box.type === "mdat") return;
    const table = tables.get(box);
    if (table) {
      const normalized = Buffer.alloc(table.positions.length * 12);
      table.positions.forEach((position, i) => {
        normalized.writeUInt32BE(media.indexOf(position.media), i * 12);
        normalized.writeBigUInt64BE(BigInt(position.offset), i * 12 + 4);
      });
      protectedData.push(
        box.raw.subarray(4, 8),
        box.body.subarray(0, 8),
        normalized,
      );
    } else if (box.children) {
      protectedData.push(Buffer.from("open:" + box.type, "latin1"), box.prefix);
      box.children.forEach(protect);
      protectedData.push(Buffer.from("close:" + box.type, "latin1"));
    } else {
      protectedData.push(box.raw);
    }
  }
  top.filter((box) => !isPadding(box)).forEach(protect);

  return {
    kind: "M4A",
    song,
    cover,
    fields,
    audio: media.map((box) => box.raw),
    protectedData,
    edit(id, text) {
      const target = [...lyrics.keys()].find(
        (box) => lyrics.get(box).field.id === id,
      );
      if (!target) throw new Error("找不到指定的 M4A 字段。");
      const item = lyrics.get(target);
      let replacement = Buffer.alloc(0);
      if (text !== null) {
        const value = item.value;
        const encoding = value.body.readUInt32BE(0);
        if (encoding !== 1 && encoding !== 2)
          throw new Error("M4A 歌词字段使用未知文本编码。");
        const newText =
          encoding === 1
            ? Buffer.from(text)
            : Buffer.from(text, "utf16le").swap16();
        const modified = resized(
          value,
          Buffer.concat([value.body.subarray(0, 8), newText]),
        );
        const at = value.start - target.start - target.header;
        replacement = resized(
          target,
          Buffer.concat([
            target.body.subarray(0, at),
            modified,
            target.body.subarray(at + value.raw.length),
          ]),
        );
      }
      const movieIndex = top.indexOf(movie);
      const adjacent = top[movieIndex + 1];
      const hasPadding = Boolean(adjacent && isPadding(adjacent));
      const delta = replacement.length - target.raw.length;
      const freeSize = (hasPadding ? adjacent.raw.length : 0) - delta;
      const keepPositions = delta === 0 || freeSize === 0 || freeSize >= 8;
      const padding =
        keepPositions && (hasPadding || delta < 0) ? freeBox(freeSize) : null;
      const newPositions = new Map();
      let nextOffset = 0;
      for (const box of top) {
        if (box === adjacent && hasPadding && padding !== null) continue;
        if (media.includes(box)) newPositions.set(box, nextOffset);
        nextOffset += box.raw.length;
        if (box === movie)
          nextOffset += delta + (padding === null ? 0 : padding.length);
      }
      const movesMedia = media.some(
        (box) => newPositions.get(box) !== box.start,
      );
      if (movesMedia && (restrictedOffsets || tables.size === 0)) {
        throw new Error(
          "该 M4A 含无法安全迁移的偏移信息，已保留原文件。可导出独立歌词。",
        );
      }
      function render(box) {
        if (box === target) return replacement;
        const table = tables.get(box);
        if (table && movesMedia) {
          const body = Buffer.from(box.body);
          table.positions.forEach((position, i) => {
            const address =
              newPositions.get(position.media) +
              position.media.header +
              position.offset;
            const at = 8 + i * table.width;
            if (table.width === 8) body.writeBigUInt64BE(BigInt(address), at);
            else {
              if (address > 0xffffffff)
                throw new Error("M4A 块偏移超过 32 位索引的容量。");
              body.writeUInt32BE(address, at);
            }
          });
          return resized(box, body);
        }
        if (!box.children) return box.raw;
        const children = box.children.map(render);
        if (children.every((child, i) => child === box.children[i].raw))
          return box.raw;
        return resized(box, Buffer.concat([box.prefix, ...children]));
      }
      return Buffer.concat(
        top.flatMap((box) => {
          if (box === adjacent && hasPadding && padding !== null) return [];
          if (box === movie)
            return padding === null ? [render(box)] : [render(box), padding];
          return [box.raw];
        }),
      );
    },
  };
}
