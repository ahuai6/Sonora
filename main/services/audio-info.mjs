import { parseFile, parseBuffer } from "music-metadata";
export function audioInfo(format = {}, evidence = "file") {
  const info = {
    codec: format.codec || format.container || "",
    sampleRate: Number(format.sampleRate) || 0,
    bits: Number(format.bitsPerSample) || 0,
    channels: Number(format.numberOfChannels) || 0,
    bitrate: Number(format.bitrate) || 0,
    lossless: format.lossless === true,
    evidence,
  };
  const parts = [info.codec];
  if (info.bits) parts.push(`${info.bits} bit`);
  if (info.sampleRate)
    parts.push(`${+(info.sampleRate / 1000).toFixed(3)} kHz`);
  if (info.channels) parts.push(`${info.channels} ch`);
  if (info.bitrate) parts.push(`${Math.round(info.bitrate / 1000)} kbps`);
  info.label = parts.filter(Boolean).join(" · ") || "音质未识别";
  return info;
}
export async function inspectAudio(file) {
  return audioInfo((await parseFile(file, { skipCovers: true })).format);
}
export async function probeAudio(
  source,
  { signal, maxBytes = 256 * 1024 } = {},
) {
  if (source.path) return inspectAudio(source.path);
  const control = new AbortController(),
    timer = setTimeout(() => control.abort(), 6000);
  let reader;
  try {
    const response = await fetch(source.url, {
      headers: { ...source.headers, Range: `bytes=0-${maxBytes - 1}` },
      signal: signal
        ? AbortSignal.any([signal, control.signal])
        : control.signal,
    });
    if (!response.ok || !response.body) throw Error("无法检测音频规格");
    reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    while (bytes < maxBytes) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value).subarray(0, maxBytes - bytes);
      chunks.push(chunk);
      bytes += chunk.length;
    }
    const prefix = Buffer.concat(chunks);
    try {
      const metadata = await parseBuffer(prefix, undefined, {
        skipCovers: true,
        duration: false,
      });
      if (!metadata.format.codec) throw Error("未识别音频编码");
      return audioInfo(metadata.format, "header");
    } catch (e) {
      // Large artwork can extend beyond the probe. STREAMINFO precedes it.
      if (
        prefix.length >= 42 &&
        prefix.subarray(0, 4).toString() === "fLaC" &&
        (prefix[4] & 127) === 0
      ) {
        const packed = prefix.readBigUInt64BE(18);
        return audioInfo(
          {
            codec: "FLAC",
            lossless: true,
            sampleRate: Number(packed >> 44n),
            numberOfChannels: Number((packed >> 41n) & 7n) + 1,
            bitsPerSample: Number((packed >> 36n) & 31n) + 1,
          },
          "header",
        );
      }
      throw e;
    }
  } finally {
    clearTimeout(timer);
    await reader?.cancel().catch(() => {});
  }
}
