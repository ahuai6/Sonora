import { request } from "../core/transport.mjs";
import { imageType } from "./tag-editor.mjs";

export function normalizeArtwork(data, nativeImage) {
  const type = imageType(data);
  if (!type) throw Error("请选择有效的 JPEG、PNG、WebP 或 GIF 图片");
  let image = nativeImage.createFromBuffer(data);
  if (image.isEmpty()) throw Error("封面图片无法解码");
  const size = image.getSize();
  if (size.width > 16000 || size.height > 16000) throw Error("封面尺寸过大");
  if (Math.max(size.width, size.height) > 1600)
    image = image.resize(
      size.width >= size.height ? { width: 1600 } : { height: 1600 },
    );
  const jpeg = type.ext === "jpg",
    buffer = jpeg ? image.toJPEG(92) : image.toPNG();
  return {
    dataUrl: `data:image/${jpeg ? "jpeg" : "png"};base64,${buffer.toString("base64")}`,
    bytes: buffer.length,
    ...image.getSize(),
  };
}

export async function fetchArtwork(
  url,
  nativeImage,
  { signal, timeout = 12000 } = {},
) {
  const r = await request(url, { timeout, signal });
  if (!r.ok) {
    await r.body?.cancel();
    throw Error(`封面请求 HTTP ${r.status}`);
  }
  const parts = [],
    reader = r.body.getReader();
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 12 * 1024 * 1024) throw Error("封面不能超过 12 MB");
      parts.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return normalizeArtwork(Buffer.concat(parts), nativeImage);
}
