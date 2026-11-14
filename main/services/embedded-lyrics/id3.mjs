import {
  emptySong,
  imageData,
  isLyricsName,
  readUtf,
  requireRange,
} from "./container.mjs";

function readSyncSafe(bytes, at) {
  const chunk = bytes.subarray(at, at + 4);
  if (chunk.length !== 4 || chunk.some((value) => value > 127))
    throw new Error("无效的 ID3 长度。");
  return (chunk[0] << 21) | (chunk[1] << 14) | (chunk[2] << 7) | chunk[3];
}

function writeSyncSafe(bytes, at, size) {
  if (size > 0xfffffff) throw new Error("ID3 标签超过容量。");
  for (let i = 0; i < 4; i++) bytes[at + i] = (size >>> (21 - i * 7)) & 127;
}

function decode(data, encoding, bigEndian = false) {
  if (encoding === 0) return { text: data.toString("latin1"), bigEndian };
  if (encoding === 3) return { text: readUtf(data), bigEndian };
  if (encoding === 1 || encoding === 2) {
    const bom = data.length >= 2 ? data.readUInt16BE(0) : 0;
    const hasBom = bom === 0xfeff || bom === 0xfffe;
    const big = hasBom ? bom === 0xfeff : encoding === 2 || bigEndian;
    return {
      text: readUtf(
        data.subarray(hasBom ? 2 : 0),
        big ? "utf-16be" : "utf-16le",
      ),
      bigEndian: big,
    };
  }
  throw new Error("无法识别的 ID3 文本编码。");
}

function splitString(data, encoding) {
  const width = encoding === 1 || encoding === 2 ? 2 : 1;
  for (let i = 0; i + width <= data.length; i += width) {
    if (data[i] === 0 && (width === 1 || data[i + 1] === 0)) {
      return [data.subarray(0, i), data.subarray(i + width)];
    }
  }
  throw new Error("ID3 文本标签缺少终止符。");
}

function encode(text, encoding, bigEndian, bom) {
  if (encoding === 0) return Buffer.from(text, "latin1");
  if (encoding === 3) return Buffer.from(text);
  const raw = Buffer.from(text, "utf16le");
  if (bigEndian) raw.swap16();
  return bom
    ? Buffer.concat([Buffer.from(bigEndian ? [0xfe, 0xff] : [0xff, 0xfe]), raw])
    : raw;
}

export function parseId3(data) {
  requireRange(data, 0, 10);
  const version = data[3];
  if (version !== 3 && version !== 4)
    throw new Error("只支持 ID3v2.3 / v2.4。");
  if (data[5] !== 0)
    throw new Error("该 ID3 使用扩展头、全局反同步或尾标，无法保证无损写回。");
  const tagEnd = 10 + readSyncSafe(data, 6);
  requireRange(data, 0, tagEnd);
  const protectedData = [data.subarray(0, 6)];
  const song = emptySong();
  const fields = [];
  const frames = [];
  let cover;
  let offset = 10;
  while (offset < tagEnd && data[offset] !== 0) {
    const tag = data.subarray(0, tagEnd);
    requireRange(tag, offset, 10);
    const name = data.toString("ascii", offset, offset + 4);
    if (!/^[A-Z0-9]{4}$/.test(name))
      throw new Error("发现无法安全写入的 ID3 帧。");
    const length =
      version === 4
        ? readSyncSafe(data, offset + 4)
        : data.readUInt32BE(offset + 4);
    requireRange(tag, offset + 10, length);
    const raw = data.subarray(offset, offset + 10 + length);
    const body = raw.subarray(10);
    const frame = { name, raw };
    if (body.length && raw[8] === 0 && raw[9] === 0) {
      const encoding = body[0];
      try {
        if (name === "USLT" || name === "TXXX") {
          const prefix = name === "USLT" ? 4 : 1;
          const [descriptionBytes, valueBytes] = splitString(
            body.subarray(prefix),
            encoding,
          );
          const { text: description, bigEndian } = decode(
            descriptionBytes,
            encoding,
          );
          if (name === "USLT" || isLyricsName(description)) {
            let text = null;
            let valueSuffix = "";
            try {
              const decoded = decode(valueBytes, encoding, bigEndian).text;
              valueSuffix = decoded.match(/\0+$/)?.[0] ?? "";
              const value = decoded.slice(
                0,
                decoded.length - valueSuffix.length,
              );
              if (!value.includes("\0")) text = value;
            } catch {
              /* allow explicit deletion */
            }
            const field = {
              id: "id3:" + frames.length,
              raw,
              name:
                name === "USLT"
                  ? "USLT · " +
                    body.toString("ascii", 1, 4) +
                    (description ? " · " + description : "")
                  : "TXXX:" + description,
              text,
            };
            frame.field = field;
            frame.text = {
              encoding,
              bigEndian,
              description,
              descriptionBytes,
              valueBytes,
              valueSuffix,
              language: body.subarray(1, prefix),
            };
            fields.push(field);
          }
        } else if (name === "APIC" && !cover) {
          const mimeEnd = body.indexOf(0, 1);
          if (mimeEnd > 0 && mimeEnd + 2 < body.length) {
            const [_, picture] = splitString(
              body.subarray(mimeEnd + 2),
              encoding,
            );
            cover = imageData(picture, body.toString("ascii", 1, mimeEnd));
          }
        } else {
          const keys = {
            TIT2: "title",
            TPE1: "artist",
            TALB: "album",
            TSRC: "isrc",
            TIT3: "version",
          };
          const key = keys[name];
          if (key)
            song[key] ||= decode(body.subarray(1), encoding)
              .text.split("\0")
              .filter(Boolean)
              .join(" / ");
        }
      } catch {
        /* unrecognized frames are copied in their entirety */
      }
    }
    if (!frame.field) protectedData.push(raw);
    frames.push(frame);
    offset += raw.length;
  }
  const padding = tagEnd - offset;
  if (data.subarray(offset, tagEnd).some((value) => value !== 0))
    throw new Error("ID3 填充中存在未知数据。");
  const audio = data.subarray(tagEnd);
  if (!audio.length) throw new Error("MP3 文件没有音频数据。");
  return {
    kind: "MP3",
    song,
    cover,
    fields,
    audio: [audio],
    protectedData,
    edit(id, text) {
      const target = frames.find((frame) => frame.field?.id === id);
      if (!target?.text) throw new Error("找不到指定的 ID3 字段。");
      const updated = frames.flatMap((frame) => {
        if (frame !== target) return [frame.raw];
        if (text === null) return [];
        const original = target.text;
        const needsUnicode =
          original.encoding === 0 && /[^\u0000-\u00ff]/u.test(text);
        const encoding = needsUnicode
          ? version === 3
            ? 1
            : 3
          : original.encoding;
        const big = original.bigEndian || encoding === 2;
        const hasValueBom =
          original.valueBytes.length >= 2 &&
          [0xfeff, 0xfffe].includes(original.valueBytes.readUInt16BE(0));
        const description = needsUnicode
          ? encode(original.description, encoding, big, encoding === 1)
          : original.descriptionBytes;
        const payload = Buffer.concat([
          Buffer.from([encoding]),
          original.language,
          description,
          Buffer.alloc(encoding === 1 || encoding === 2 ? 2 : 1),
          encode(
            text + original.valueSuffix,
            encoding,
            big,
            encoding === 1 && (needsUnicode || hasValueBom),
          ),
        ]);
        const frameHeader = Buffer.from(frame.raw.subarray(0, 10));
        if (version === 4) writeSyncSafe(frameHeader, 4, payload.length);
        else frameHeader.writeUInt32BE(payload.length, 4);
        return [Buffer.concat([frameHeader, payload])];
      });
      const delta =
        updated.reduce((total, frame) => total + frame.length, 0) -
        (offset - 10);
      const restPadding = Math.max(0, padding - delta);
      const header = Buffer.from(data.subarray(0, 10));
      writeSyncSafe(header, 6, offset - 10 + delta + restPadding);
      return Buffer.concat([
        header,
        ...updated,
        Buffer.alloc(restPadding),
        audio,
      ]);
    },
  };
}
