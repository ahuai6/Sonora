import { audioInfo } from "./audio-info.mjs";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { safeName } from "../core/models.mjs";
import { cacheCover } from "./tag-editor.mjs";
export const AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".flac",
  ".m4a",
  ".aac",
  ".ogg",
  ".opus",
  ".wav",
  ".aiff",
  ".aif",
  ".ape",
  ".wma",
  ".dsf",
  ".dff",
]);
export function sniffAudio(b) {
  if (
    b.subarray(0, 3).toString() === "ID3" ||
    (b[0] === 255 && (b[1] & 224) === 224)
  )
    return (b[1] & 0xf6) === 0xf0 ? "aac" : "mp3";
  if (b.subarray(0, 4).toString() === "fLaC") return "flac";
  if (b.subarray(0, 4).toString() === "OggS") return "ogg";
  if (
    b.subarray(0, 4).toString() === "RIFF" &&
    b.subarray(8, 12).toString() === "WAVE"
  )
    return "wav";
  if (b.subarray(4, 8).toString() === "ftyp") return "m4a";
  if (b.subarray(0, 4).toString() === "MAC ") return "ape";
  if (b.subarray(0, 4).toString() === "FORM") return "aiff";
  if (b.subarray(0, 4).toString() === "DSD ") return "dsf";
  if (b.subarray(0, 4).toString() === "FRM8") return "dff";
  return "";
}
export async function uniqueCommit(
  temp,
  folder,
  base,
  extension,
  { onIntent } = {},
) {
  for (let n = 0; n < 10000; n++) {
    const target = path.join(
      folder,
      `${safeName(base)}${n ? " (" + n + ")" : ""}.${extension}`,
    );
    try {
      // Persist intended ownership before creating the final name. Existing names
      // are never overwritten and are verified by content when recovering.
      if (fs.existsSync(target)) continue;
      await onIntent?.(target);
      try {
        await fs.promises.link(temp, target);
      } catch (error) {
        if (!["ENOTSUP", "EOPNOTSUPP", "EPERM", "EXDEV"].includes(error.code))
          throw error;
        // Removable / network volumes may not support hard links.
        await fs.promises.copyFile(temp, target, fs.constants.COPYFILE_EXCL);
      }
      // The destination is durable. Failure to remove staging must not hide it.
      await fs.promises.unlink(temp).catch(() => {});
      return target;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
  }
  throw Error("同名文件过多，请调整命名或目录");
}
export async function writeUniqueText(folder, name, content) {
  await fs.promises.mkdir(folder, { recursive: true });
  const tmp = path.join(folder, `.sonora-${randomUUID()}.part`);
  try {
    await fs.promises.writeFile(tmp, "\ufeff" + String(content), "utf8");
    return await uniqueCommit(tmp, folder, name, "lrc");
  } catch (e) {
    await fs.promises.unlink(tmp).catch(() => {});
    throw e;
  }
}
export class MusicLibrary {
  constructor(store) {
    this.store = store;
    this.coverDir = path.join(store.dir, "covers");
    this.importQueue = Promise.resolve();
    this.removedPaths = new Set();
  }
  list() {
    return this.store.data.library;
  }
  refresh() {
    const job = this.importQueue
      .catch(() => {})
      .then(async () => {
        const missing = [],
          files = [],
          failures = [];
        for (const item of [...this.list()]) {
          try {
            const stat = await fs.promises.stat(item.path);
            if (stat.isFile()) files.push(item.path);
            else missing.push(item.id);
          } catch (e) {
            if (["ENOENT", "ENOTDIR"].includes(e.code)) missing.push(item.id);
            else
              failures.push({
                file: path.basename(item.path),
                message: e.message,
              });
          }
        }
        this.store.data.missingLibrary ||= [];
        const retained = new Map(
          this.store.data.missingLibrary.map((x) => [x.id, x]),
        );
        for (const item of this.list())
          if (missing.includes(item.id))
            retained.set(item.id, { ...item, missing: true });
        this.store.data.missingLibrary = [...retained.values()];
        this.removeMany(missing, { remember: false });
        const result = await this.importFilesNow(files);
        return {
          ...result,
          removed: missing.length,
          failures: [...failures, ...result.failures],
        };
      });
    this.importQueue = job;
    return job;
  }
  async scan(folder, { automatic = false } = {}) {
    folder = path.resolve(folder);
    const found = [];
    const walk = async (dir, depth) => {
      if (depth > 12 || found.length >= 15000) return;
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const item of entries) {
        if (item.isSymbolicLink()) continue;
        const full = path.join(dir, item.name);
        if (item.isDirectory()) {
          if (
            !item.name.startsWith(".") &&
            ![
              "node_modules",
              "$RECYCLE.BIN",
              "System Volume Information",
              "tag-backups",
            ].includes(item.name)
          )
            await walk(full, depth + 1).catch(() => {});
        } else if (
          item.isFile() &&
          !item.name.startsWith(".sonora-") &&
          AUDIO_EXTENSIONS.has(path.extname(item.name).toLowerCase())
        )
          found.push(full);
      }
    };
    await walk(folder, 0);
    const ignored = new Set(this.store.data.ignoredLibraryPaths || []);
    return this.importFiles(
      automatic
        ? found.filter((file) => !ignored.has(path.resolve(file).toLowerCase()))
        : found,
    );
  }
  async importFiles(files, { force = false } = {}) {
    // An explicit later import can re-add a removed item; an in-flight import cannot.
    for (const file of files)
      this.removedPaths.delete(path.resolve(file).toLowerCase());
    const importedPaths = new Set(
      files.map((file) => path.resolve(file).toLowerCase()),
    );
    this.store.data.ignoredLibraryPaths = (
      this.store.data.ignoredLibraryPaths || []
    ).filter((file) => !importedPaths.has(file));
    const job = this.importQueue
      .catch(() => {})
      .then(() => this.importFilesNow(files, { force }));
    this.importQueue = job;
    return job;
  }
  async importFilesNow(files, { force = false } = {}) {
    const { parseFile } = await import("music-metadata");
    const existing = new Map(
      this.store.data.library.map((x) => [
        path.resolve(x.path).toLowerCase(),
        x,
      ]),
    );
    let imported = 0;
    const failures = [];
    for (const file of files.slice(0, 15000)) {
      const resolved = path.resolve(file);
      if (!AUDIO_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
      try {
        const stat = await fs.promises.stat(resolved);
        if (!stat.isFile()) continue;
        const old = existing.get(resolved.toLowerCase());
        if (
          !force &&
          old &&
          old.audioInfo &&
          old.modifiedAt === stat.mtimeMs &&
          old.meta?.coverVersion === 1
        )
          continue;
        const filename = path.basename(file, path.extname(file));
        const split = filename.includes(" - ") ? filename.split(" - ") : [];
        const guessedArtist = split.length ? split.shift() : "";
        const guessedTitle = split.length ? split.join(" - ") : filename;
        let metadata;
        try {
          metadata = await parseFile(resolved, {
            duration: true,
            skipCovers: false,
          });
          if (!metadata.format.codec || !metadata.format.sampleRate)
            throw Error("未找到可解码的音频流");
        } catch (e) {
          failures.push({
            file: path.basename(file),
            message: "音频或元数据无法读取：" + e.message,
          });
          const head = Buffer.alloc(512),
            handle = await fs.promises.open(resolved, "r");
          try {
            await handle.read(head, 0, head.length, 0);
          } finally {
            await handle.close();
          }
          if (!sniffAudio(head)) continue;
        }
        const x = {
          id: old?.id || randomUUID(),
          key: old?.key || `local:${randomUUID()}`,
          platform: "local",
          kind: "song",
          title: metadata?.common.title || guessedTitle,
          artist: metadata?.common.artist || guessedArtist || "",
          album: metadata?.common.album || "",
          cover: await cacheCover(
            this.coverDir,
            metadata?.common.picture?.find((p) =>
              /front/i.test(p.type || ""),
            ) || metadata?.common.picture?.[0],
          ),
          duration: metadata?.format.duration || 0,
          path: resolved,
          format: path.extname(file).slice(1).toUpperCase(),
          bytes: stat.size,
          bitrate: metadata?.format.bitrate || 0,
          sampleRate: metadata?.format.sampleRate || 0,
          audioInfo: audioInfo(metadata?.format),
          missing: false,
          modifiedAt: stat.mtimeMs,
          addedAt: old?.addedAt || Date.now(),
          favorite: old?.favorite || false,
          meta: {
            coverVersion: 1,
            year: metadata?.common.year || 0,
            genre: metadata?.common.genre || [],
            hasEmbeddedLyrics: !!metadata?.common.lyrics?.length,
          },
        };
        const absent = this.store.data.missingLibrary?.find(
          (item) => item.path.toLowerCase() === resolved.toLowerCase(),
        );
        if (absent) {
          Object.assign(x, {
            id: absent.id,
            key: absent.key,
            favorite: absent.favorite,
            addedAt: absent.addedAt,
          });
          this.store.data.missingLibrary =
            this.store.data.missingLibrary.filter(
              (item) => item.id !== absent.id,
            );
        }
        existing.set(resolved.toLowerCase(), x);
        imported++;
      } catch (e) {
        failures.push({ file: path.basename(file), message: e.message });
      }
    }
    const current = new Map(
      this.list().map((x) => [path.resolve(x.path).toLowerCase(), x]),
    );
    for (const [key, item] of existing) {
      if (this.removedPaths.has(key)) existing.delete(key);
      else if (current.has(key)) item.favorite = current.get(key).favorite;
    }
    this.store.data.library = [...existing.values()].sort(
      (a, b) => b.addedAt - a.addedAt,
    );
    this.store.save();
    return { items: this.list(), imported, failures };
  }
  known(id) {
    const item = this.list().find((x) => x.id === id);
    if (!item) throw Error("音乐库中没有此文件");
    return item;
  }
  remove(id) {
    return this.removeMany([id]);
  }
  removeMany(ids, { remember = true } = {}) {
    const selected = new Set(ids);
    for (const item of this.list())
      if (selected.has(item.id))
        this.removedPaths.add(path.resolve(item.path).toLowerCase());
    if (remember)
      this.store.data.ignoredLibraryPaths = [
        ...new Set([
          ...(this.store.data.ignoredLibraryPaths || []),
          ...this.list()
            .filter((item) => selected.has(item.id))
            .map((item) => path.resolve(item.path).toLowerCase()),
        ]),
      ];
    this.store.data.library = this.list().filter((x) => !selected.has(x.id));
    this.store.save();
    return this.list();
  }
  toggleFavorite(id) {
    const x = this.known(id);
    x.favorite = !x.favorite;
    this.store.save();
    return this.list();
  }
}
