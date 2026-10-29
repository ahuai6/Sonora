import fs from "node:fs";
import zlib from "node:zlib";
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
const crc = (b) => {
  let n = 0xffffffff;
  for (const c of b) n = crcTable[(n ^ c) & 255] ^ (n >>> 8);
  return (n ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const t = Buffer.from(type),
    len = Buffer.alloc(4),
    c = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  c.writeUInt32BE(crc(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, c]);
};
const round = (x, y, cx, cy, w, h, r) => {
  const dx = Math.max(Math.abs(x - cx) - w / 2 + r, 0),
    dy = Math.max(Math.abs(y - cy) - h / 2 + r, 0);
  return dx * dx + dy * dy <= r * r;
};
function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let rr = 0,
        gg = 0,
        bb = 0,
        aa = 0;
      for (let sy = 0; sy < 3; sy++)
        for (let sx = 0; sx < 3; sx++) {
          const xx = ((x + (sx + 0.5) / 3) / size) * 256,
            yy = ((y + (sy + 0.5) / 3) / size) * 256;
          if (!round(xx, yy, 128, 128, 248, 248, 57)) continue;
          let c = [116 + xx / 50, 84 + yy / 35, 193 + xx / 60];
          const heights = [58, 101, 137, 99, 53];
          for (let k = 0; k < 5; k++)
            if (round(xx, yy, 73 + k * 27, 128, 13, heights[k], 6.5))
              c = [247, 240, 255];
          rr += c[0];
          gg += c[1];
          bb += c[2];
          aa += 255;
        }
      const off = y * (size * 4 + 1) + 1 + x * 4;
      raw[off] = aa ? Math.round(rr / (aa / 255)) : 0;
      raw[off + 1] = aa ? Math.round(gg / (aa / 255)) : 0;
      raw[off + 2] = aa ? Math.round(bb / (aa / 255)) : 0;
      raw[off + 3] = Math.round(aa / 9);
    }
  const h = Buffer.alloc(13);
  h.writeUInt32BE(size, 0);
  h.writeUInt32BE(size, 4);
  h[8] = 8;
  h[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", h),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const sizes = [16, 24, 32, 48, 64, 128, 256],
  images = sizes.map(png),
  header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((s, i) => {
  const p = 6 + i * 16;
  header[p] = s === 256 ? 0 : s;
  header[p + 1] = s === 256 ? 0 : s;
  header.writeUInt16LE(1, p + 4);
  header.writeUInt16LE(32, p + 6);
  header.writeUInt32LE(images[i].length, p + 8);
  header.writeUInt32LE(offset, p + 12);
  offset += images[i].length;
});
fs.mkdirSync("build", { recursive: true });
fs.writeFileSync("build/icon.ico", Buffer.concat([header, ...images]));
fs.writeFileSync("build/icon.png", images.at(-1));
