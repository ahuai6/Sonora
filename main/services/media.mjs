import fs from "node:fs";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
export class MediaService {
  constructor() {
    this.entries = new Map();
  }
  register(source) {
    const id = randomUUID();
    this.entries.set(id, { ...source, createdAt: Date.now() });
    if (this.entries.size > 150) {
      const old = [...this.entries.keys()].slice(0, 50);
      old.forEach((x) => this.entries.delete(x));
    }
    return `sonora-media://audio/${id}`;
  }
  async handle(req) {
    const id = new URL(req.url).pathname.slice(1);
    const item = this.entries.get(id);
    if (!item) return new Response("Media not found", { status: 404 });
    const range = req.headers.get("Range");
    try {
      if (item.path) {
        const stat = await fs.promises.stat(item.path);
        let start = 0,
          end = stat.size - 1,
          status = 200;
        if (range) {
          const m = range.match(/^bytes=(\d*)-(\d*)$/);
          if (!m) return new Response(null, { status: 416 });
          if (!m[1]) start = Math.max(0, stat.size - Number(m[2]));
          else start = Number(m[1]);
          if (m[1] && m[2]) end = Math.min(end, Number(m[2]));
          if (start > end || start >= stat.size)
            return new Response(null, {
              status: 416,
              headers: { "Content-Range": `bytes */${stat.size}` },
            });
          status = 206;
        }
        const headers = {
          "Content-Type": item.mime || "audio/mpeg",
          "Content-Length": String(end - start + 1),
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-store",
        };
        if (status === 206)
          headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
        return new Response(
          Readable.toWeb(fs.createReadStream(item.path, { start, end })),
          { status, headers },
        );
      }
      const response = await fetch(item.url, {
        headers: { ...item.headers, ...(range ? { Range: range } : {}) },
        signal: req.signal,
      });
      const headers = new Headers();
      for (const key of [
        "content-type",
        "content-length",
        "content-range",
        "accept-ranges",
      ])
        if (response.headers.has(key))
          headers.set(key, response.headers.get(key));
      headers.set("Cache-Control", "no-store");
      return new Response(response.body, { status: response.status, headers });
    } catch {
      return new Response("Media unavailable", { status: 502 });
    }
  }
}
