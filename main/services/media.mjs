import fs from "node:fs";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import path from "node:path";
export class MediaService {
  constructor({ coverDir } = {}) {
    this.entries = new Map();
    this.coverDir = coverDir;
    this.readers = new Map();
    this.suspended = new Map();
  }
  fileKey(file) {
    const value = path.resolve(file);
    return process.platform === "win32" ? value.toLowerCase() : value;
  }
  async suspendFile(file) {
    const key = this.fileKey(file);
    this.suspended.set(key, (this.suspended.get(key) || 0) + 1);
    try {
      await Promise.all(
        [...(this.readers.get(key) || [])].map(
          (stream) =>
            new Promise((resolve) => {
              if (stream.closed) return resolve();
              stream.once("close", resolve);
              stream.destroy();
            }),
        ),
      );
    } catch (e) {
      this.resumeFile(key);
      throw e;
    }
    return () => this.resumeFile(key);
  }
  resumeFile(key) {
    const n = (this.suspended.get(key) || 1) - 1;
    n ? this.suspended.set(key, n) : this.suspended.delete(key);
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
    const target = new URL(req.url);
    if (target.hostname === "cover") {
      const name = target.pathname.slice(1);
      if (!this.coverDir || !/^[a-f0-9]{64}\.(jpg|png|webp|gif)$/.test(name))
        return new Response(null, { status: 404 });
      try {
        return new Response(
          await fs.promises.readFile(path.join(this.coverDir, name)),
          {
            headers: {
              "Content-Type": {
                jpg: "image/jpeg",
                png: "image/png",
                webp: "image/webp",
                gif: "image/gif",
              }[name.split(".").pop()],
              "Cache-Control": "public, max-age=31536000, immutable",
            },
          },
        );
      } catch {
        return new Response(null, { status: 404 });
      }
    }
    const id = target.pathname.slice(1);
    const item = this.entries.get(id);
    if (!item) return new Response("Media not found", { status: 404 });
    const range = req.headers.get("Range");
    try {
      if (item.path) {
        const key = this.fileKey(item.path);
        if (this.suspended.has(key))
          return new Response("File is being edited", { status: 423 });
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
        if (this.suspended.has(key))
          return new Response("File is being edited", { status: 423 });
        const stream = fs.createReadStream(item.path, { start, end });
        if (!this.readers.has(key)) this.readers.set(key, new Set());
        this.readers.get(key).add(stream);
        const abort = () => stream.destroy();
        req.signal?.addEventListener("abort", abort, { once: true });
        stream.on("error", () => {});
        stream.once("close", () => {
          req.signal?.removeEventListener("abort", abort);
          const readers = this.readers.get(key);
          readers?.delete(stream);
          if (!readers?.size) this.readers.delete(key);
        });
        if (req.signal?.aborted) abort();
        return new Response(Readable.toWeb(stream), { status, headers });
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
