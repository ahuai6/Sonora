import { exportLyrics } from "./lyrics.mjs";
import fs from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { httpUrl } from "../core/models.mjs";
import { sniffAudio, uniqueCommit } from "./files.mjs";
export class DownloadManager extends EventEmitter {
  constructor(store, providers, library, { metadata } = {}) {
    super();
    this.store = store;
    this.providers = providers;
    this.library = library;
    this.metadata = metadata;
    this.running = new Map();
    this.stopped = false;
    this.jobs = store.data.downloads.map((j) =>
      ["queued", "resolving", "downloading", "tagging"].includes(j.status)
        ? j.path && fs.existsSync(j.path)
          ? {
              ...j,
              status: "completed",
              message: "下载完成 · 上次整理中断，可重新扫描音乐库",
            }
          : { ...j, status: "paused", message: "上次会话已中断，可重新下载" }
        : j,
    );
    for (const job of this.jobs) {
      if (
        !/^[a-f0-9-]{36}$/i.test(job.id) ||
        !job.folder ||
        !path.isAbsolute(job.folder)
      )
        continue;
      for (const sub of ["", "网易云音乐", "QQ音乐", "酷狗音乐"]) {
        for (const suffix of [
          "",
          ".mp3",
          ".flac",
          ".m4a",
          ".aac",
          ".ogg",
          ".opus",
          ".wav",
        ]) {
          try {
            fs.unlinkSync(
              path.join(job.folder, sub, `.sonora-${job.id}.part${suffix}`),
            );
          } catch {}
        }
      }
    }
    this.persist();
  }
  publicJobs() {
    return this.jobs.map((x) => ({ ...x }));
  }
  persist() {
    this.store.data.downloads = this.jobs;
    this.store.save();
  }
  publish() {
    this.emit("update", this.publicJobs());
  }
  add(tracks, quality) {
    let added = 0;
    for (const track of tracks.slice(0, 300)) {
      if (track.platform === "local") continue;
      if (
        this.jobs.some(
          (j) =>
            j.track.key === track.key &&
            j.quality === quality &&
            ["queued", "resolving", "downloading", "tagging"].includes(
              j.status,
            ),
        )
      )
        continue;
      this.jobs.unshift({
        id: randomUUID(),
        track,
        quality,
        status: "queued",
        received: 0,
        total: 0,
        speed: 0,
        progress: 0,
        createdAt: Date.now(),
        message: "等待下载",
        folder: path.resolve(this.store.data.settings.downloadDir),
      });
      added++;
    }
    this.persist();
    this.publish();
    this.pump();
    return { added, jobs: this.publicJobs() };
  }
  action(id, action) {
    const job = this.jobs.find((x) => x.id === id);
    if (!job) throw Error("下载任务不存在");
    // A committed file is already durable; finish sidecars/library without cancelling it.
    if (job.status === "tagging" && job.path) return this.publicJobs();
    if (
      action === "retry" &&
      ["failed", "paused", "cancelled"].includes(job.status)
    ) {
      Object.assign(job, {
        status: "queued",
        message: "重新获取音频地址",
        received: 0,
        total: 0,
        progress: 0,
        path: undefined,
        metadata: undefined,
        completedAt: undefined,
      });
    } else if (
      action === "pause" &&
      ["queued", "resolving", "downloading", "tagging"].includes(job.status)
    ) {
      job.status = "paused";
      job.message = "已暂停，继续时重新下载";
      this.running.get(id)?.abort();
    } else if (action === "cancel" && job.status !== "completed") {
      job.status = "cancelled";
      job.message = "已取消";
      this.running.get(id)?.abort();
    } else if (
      action === "remove" &&
      !["resolving", "downloading", "tagging"].includes(job.status)
    ) {
      this.jobs = this.jobs.filter((j) => j.id !== id);
    }
    this.persist();
    this.publish();
    this.pump();
    return this.publicJobs();
  }
  pump() {
    if (this.stopped) return;
    const max = Math.max(
      1,
      Math.min(4, Number(this.store.data.settings.concurrency) || 2),
    );
    while (this.running.size < max) {
      const job = this.jobs.find(
        (j) => j.status === "queued" && !this.running.has(j.id),
      );
      if (!job) break;
      const controller = new AbortController();
      this.running.set(job.id, controller);
      this.run(job, controller).finally(() => {
        this.running.delete(job.id);
        this.persist();
        this.publish();
        this.pump();
      });
    }
  }
  async run(job, controller) {
    let temp;
    let idleTimer;
    let completedFile;
    try {
      job.status = "resolving";
      job.message = "正在获取音频地址";
      this.publish();
      const audio = await this.providers.resolve(
        job.track,
        job.quality,
        "download",
      );
      controller.signal.throwIfAborted();
      if (audio.trial) throw Error("该音源仅返回试听片段，未下载");
      if (!httpUrl(audio.url)) throw Error("音频 URL 无效");
      const headerControl = new AbortController();
      const headerTimer = setTimeout(
        () => headerControl.abort(Error("音频服务器响应超时")),
        25000,
      );
      let response;
      try {
        response = await fetch(audio.url, {
          headers: { "User-Agent": "Mozilla/5.0", ...audio.headers },
          signal: AbortSignal.any([controller.signal, headerControl.signal]),
        });
      } finally {
        clearTimeout(headerTimer);
      }
      if (!response.ok || !response.body)
        throw Error(`音频服务器返回 HTTP ${response.status}`);
      job.total = Number(response.headers.get("content-length")) || 0;
      if (job.total > 2 * 1024 ** 3) {
        await response.body.cancel();
        throw Error("音频大小超过 2 GB 限制");
      }
      const folder = this.store.data.settings.groupByPlatform
        ? path.join(
            job.folder,
            { netease: "网易云音乐", qq: "QQ音乐", kugou: "酷狗音乐" }[
              job.track.platform
            ] || "音乐",
          )
        : job.folder;
      await fs.promises.mkdir(folder, { recursive: true });
      temp = path.join(folder, `.sonora-${job.id}.part`);
      const stream = fs.createWriteStream(temp, { flags: "wx" });
      let head = Buffer.alloc(0);
      let last = Date.now(),
        lastBytes = 0;
      job.status = "downloading";
      job.message = audio.source;
      job.source = audio.source;
      job.actualQuality = audio.quality;
      this.publish();
      const resetIdle = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(
          () => controller.abort(Error("音频传输超过 45 秒无响应")),
          45000,
        );
      };
      resetIdle();
      const progress = new Transform({
        transform: (chunk, _encoding, callback) => {
          resetIdle();
          if (head.length < 512)
            head = Buffer.concat([head, chunk]).subarray(0, 512);
          job.received += chunk.length;
          if (job.received > 2 * 1024 ** 3)
            return callback(Error("音频大小超过限制"));
          job.progress = job.total
            ? Math.min(99, Math.floor((job.received / job.total) * 100))
            : 0;
          const now = Date.now();
          if (now - last > 350) {
            job.speed = (job.received - lastBytes) / ((now - last) / 1000);
            last = now;
            lastBytes = job.received;
            this.publish();
          }
          callback(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(response.body), progress, stream, {
        signal: controller.signal,
      });
      clearTimeout(idleTimer);
      controller.signal.throwIfAborted();
      if (job.total && job.received !== job.total)
        throw Error("传输未完成：文件大小与服务器声明不符");
      let extension = sniffAudio(head);
      if (!extension)
        throw Error("返回内容不是可识别音频，可能是错误页面或加密文件");
      // Reject obvious previews when the provider cannot label trial URLs.
      const { parseFile } = await import("music-metadata");
      let duration = 0;
      try {
        const meta = await parseFile(temp, {
          duration: true,
          skipCovers: true,
        });
        duration = meta.format.duration || 0;
      } catch {}
      if (
        job.track.duration > 60 &&
        duration > 0 &&
        duration + 15 < job.track.duration
      )
        throw Error("返回音频短于歌曲时长，可能为试听片段，未保存");
      const notes = [];
      job.status = "tagging";
      job.speed = 0;
      if (this.metadata && this.store.data.settings.autoMetadata !== false) {
        job.message = "音频已下载，正在匹配标签与封面";
        this.publish();
        try {
          const result = await this.metadata.prepare(
            temp,
            extension,
            job.track,
            {
              signal: controller.signal,
            },
          );
          const raw = temp;
          temp = result.file;
          if (raw !== temp) await fs.promises.unlink(raw);
          job.metadata = result.metadata;
          notes.push(
            result.metadata.status === "partial"
              ? "标签已写入，部分信息未取得"
              : "标签已写入",
          );
        } catch (e) {
          controller.signal.throwIfAborted();
          job.metadata = {
            status: "failed",
            warnings: [e.message || "标签写入失败"],
          };
          notes.push("标签未写入，可在本地音乐中重试");
        }
      } else {
        job.metadata = { status: "disabled", warnings: [] };
      }
      controller.signal.throwIfAborted();
      job.message = "正在保存音频并更新音乐库";
      this.publish();
      completedFile = await uniqueCommit(
        temp,
        folder,
        `${job.track.artist ? job.track.artist + " - " : ""}${job.track.title}`,
        extension,
      );
      temp = null;
      job.path = completedFile;
      job.progress = 100;
      job.speed = 0;
      this.persist();
      if (this.store.data.settings.autoLyrics) {
        try {
          const lyric = await this.providers.lyrics(job.track);
          const exported = exportLyrics(lyric, {
            format: this.store.data.settings.lyricFormat || "auto",
            bilingual: this.store.data.settings.saveTranslation,
          });
          const lyricPath = completedFile.replace(
            /\.[^.]+$/,
            "." + exported.extension,
          );
          await fs.promises.writeFile(lyricPath, "\ufeff" + exported.text, {
            encoding: "utf8",
            flag: "wx",
          });
          if (lyric.translation && this.store.data.settings.saveTranslation)
            await fs.promises.writeFile(
              completedFile.replace(/\.[^.]+$/, ".translation.lrc"),
              "\ufeff" + lyric.translation,
              { encoding: "utf8", flag: "wx" },
            );
        } catch {
          notes.push("未取得歌词或歌词文件已存在");
        }
      }
      try {
        await this.library.importFiles([completedFile]);
      } catch {
        notes.push("音乐库更新失败，可重新扫描");
      }
      job.completedAt = Date.now();
      job.status = "completed";
      job.message = ["下载完成", ...notes].join(" · ");
    } catch (e) {
      if (
        ["paused", "cancelled", "queued"].includes(job.status) &&
        controller.signal.aborted
      ) {
      } else {
        job.status = "failed";
        job.message =
          e.name === "TimeoutError"
            ? "音频下载超时，请重试"
            : e.message || "下载失败";
      }
      job.speed = 0;
    } finally {
      clearTimeout(idleTimer);
      if (temp) await fs.promises.unlink(temp).catch(() => {});
    }
  }
  stop() {
    this.stopped = true;
    for (const [id, control] of this.running) {
      const job = this.jobs.find((x) => x.id === id);
      if (job) {
        job.status = job.path ? "completed" : "paused";
        job.message = job.path
          ? "下载完成 · 应用已关闭，可重新扫描音乐库"
          : "应用已关闭，可重新下载";
      }
      control.abort();
    }
    this.persist();
  }
}
