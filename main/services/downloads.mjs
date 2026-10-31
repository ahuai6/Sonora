import { audioInfo } from "./audio-info.mjs";
import { fileDigest } from "./commit-journal.mjs";
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
    this.tasks = new Map();
    this.maintenance = new Set();
    this.batchDepth = 0;
    this.stopped = false;
    this.jobs = store.data.downloads.map((j) =>
      ["queued", "resolving", "downloading", "tagging", "committing"].includes(
        j.status,
      )
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
    this.recovering = this.jobs.some((j) => j.pendingCommit);
    this.recovery = this.recoverCommitted().finally(() => {
      this.recovering = false;
      this.pump();
    });
  }
  async recoverCommitted() {
    for (const job of this.jobs.filter((j) => j.pendingCommit)) {
      try {
        if (
          (await fileDigest(job.pendingCommit.path)) !==
          job.pendingCommit.sha256
        )
          throw Error("保存内容校验不一致");
        job.path = job.pendingCommit.path;
        job.status = "completed";
        job.progress = 100;
        job.message = "已恢复上次保存的音频";
        try {
          await this.library.importFiles([job.path]);
        } catch {
          job.message = "音频已恢复，音乐库未能更新，请刷新本地音乐";
        }
      } catch {
        job.status = "paused";
        job.message = "上次保存未完成，可重试下载";
      }
      delete job.pendingCommit;
    }
    if (!this.stopped) {
      this.persist();
      this.publish();
    }
  }
  publicJobs() {
    return this.jobs.map((x) => ({ ...x }));
  }
  retryMetadata(ids) {
    const task = this.retryMetadataNow(ids);
    this.maintenance.add(task);
    task.finally(() => this.maintenance.delete(task)).catch(() => {});
    return task;
  }
  async retryMetadataNow(ids) {
    if (!Array.isArray(ids) || ids.length > 100)
      throw Error("每次最多处理 100 首");
    if (!this.metadata) throw Error("标签服务不可用");
    const paths = new Set();
    for (const job of this.jobs.filter(
      (x) => ids.includes(x.id) && x.status === "completed" && x.path,
    )) {
      if (paths.has(job.path)) continue;
      paths.add(job.path);
      const editor = this.metadata.tagEditor;
      const item = this.library.list().find((x) => x.path === job.path);
      if (!item) throw Error("请先刷新本地音乐");
      job.status = "tagging";
      this.publish();
      let staged;
      try {
        const snapshot = await editor.read(item.id);
        const result = await this.metadata.prepare(
          job.path,
          path.extname(job.path).slice(1),
          job.track,
          { settings: { ...this.store.data.settings, autoMetadata: true } },
        );
        staged = result.file !== job.path ? result.file : null;
        if (staged)
          await editor.commit(item.id, snapshot.revision, (temp) =>
            fs.promises.copyFile(staged, temp),
          );
        job.metadata = result.metadata;
        job.message =
          result.metadata.status === "written"
            ? "内嵌信息已补全"
            : "内嵌信息已更新，部分字段未取得";
      } catch (e) {
        job.message = "内嵌信息重试失败：" + e.message;
        job.metadata = { status: "failed", warnings: [e.message] };
      } finally {
        if (staged) await fs.promises.unlink(staged).catch(() => {});
        job.status = "completed";
        this.persist();
        this.publish();
      }
    }
    return this.publicJobs();
  }
  async refresh() {
    for (const job of [...this.jobs]) {
      if (!["completed", "missing"].includes(job.status)) continue;
      const status = job.status;
      let exists = false;
      try {
        exists = !!job.path && (await fs.promises.stat(job.path)).isFile();
      } catch (e) {
        if (!["ENOENT", "ENOTDIR"].includes(e.code)) continue;
      }
      if (!this.jobs.includes(job) || job.status !== status) continue;
      if (!exists)
        Object.assign(job, {
          status: "missing",
          message: "文件已不存在，可重试下载或移除记录",
          speed: 0,
          progress: 0,
        });
      else if (status === "missing")
        Object.assign(job, {
          status: "completed",
          message: "已重新找到下载文件",
          progress: 100,
        });
    }
    this.persist();
    this.publish();
    return this.publicJobs();
  }
  async batchAction(ids, action) {
    const selected = new Set(ids),
      jobs = this.jobs.filter((j) => selected.has(j.id));
    let changed = 0;
    this.batchDepth++;
    try {
      if (action === "remove") {
        const waiting = [];
        for (const job of jobs) {
          if (
            job.status === "committing" ||
            (job.status === "tagging" && job.path)
          )
            continue;
          if (this.running.has(job.id)) {
            this.action(job.id, "cancel");
            waiting.push(this.tasks.get(job.id));
          }
        }
        await Promise.allSettled(waiting.filter(Boolean));
      }
      for (const job of jobs) {
        if (
          action === "cancel" &&
          !["queued", "resolving", "downloading", "tagging", "paused"].includes(
            job.status,
          )
        )
          continue;
        if (action === "pause" && job.path) continue;
        const before = job.status;
        this.action(job.id, action);
        if (!this.jobs.includes(job) || job.status !== before) changed++;
      }
    } finally {
      this.batchDepth--;
      this.persist();
      this.publish();
      this.pump();
    }
    return { changed, skipped: jobs.length - changed };
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
            [
              "queued",
              "resolving",
              "downloading",
              "tagging",
              "committing",
            ].includes(j.status),
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
    // A committed file is already durable; finish the library update without cancelling it.
    if (job.status === "committing" || (job.status === "tagging" && job.path))
      return this.publicJobs();
    if (
      action === "retry" &&
      ["failed", "paused", "cancelled", "missing"].includes(job.status)
    ) {
      const reusePath =
        job.path && fs.existsSync(job.path) ? job.path : undefined;
      Object.assign(job, {
        reusePath,
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
      ["queued", "resolving", "downloading", "tagging", "committing"].includes(
        job.status,
      )
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
      !["resolving", "downloading", "tagging", "committing"].includes(
        job.status,
      )
    ) {
      this.jobs = this.jobs.filter((j) => j.id !== id);
    }
    if (!this.batchDepth) {
      this.persist();
      this.publish();
      this.pump();
    }
    return this.publicJobs();
  }
  pump() {
    if (this.stopped || this.batchDepth || this.recovering) return;
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
      const task = this.run(job, controller).finally(() => {
        this.running.delete(job.id);
        this.tasks.delete(job.id);
        this.persist();
        this.publish();
        this.pump();
      });
      this.tasks.set(job.id, task);
    }
  }
  async run(job, controller) {
    let temp;
    let idleTimer;
    let completedFile;
    try {
      const previous = job.reusePath || job.pendingCommit?.path;
      if (previous && fs.existsSync(previous)) {
        const valid = job.pendingCommit
          ? (await fileDigest(previous)) === job.pendingCommit.sha256
          : true;
        if (valid) {
          const { inspectAudio } = await import("./audio-info.mjs");
          job.audioInfo = await inspectAudio(previous);
          job.actualQuality = job.audioInfo.label;
          job.path = previous;
          job.status = "committing";
          job.progress = 100;
          delete job.reusePath;
          delete job.pendingCommit;
          this.persist();
          try {
            await this.library.importFiles([previous]);
            job.message = "已恢复现有音频，无需重复下载";
          } catch {
            job.message = "音频已保留，请刷新本地音乐";
          }
          job.status = "completed";
          return;
        }
      }
      job.status = "resolving";
      job.message = "正在获取音频地址";
      this.publish();
      job.failureStage = "resolve";
      const audio = await this.providers.resolve(
        job.track,
        job.quality,
        "download",
        { signal: controller.signal },
      );
      controller.signal.throwIfAborted();
      if (audio.trial) throw Error("该音源仅返回试听片段，未下载");
      if (!httpUrl(audio.url)) throw Error("音频 URL 无效");
      job.failureStage = "transfer";
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
      job.failureStage = "validation";
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
        job.audioInfo = audioInfo(meta.format);
        job.actualQuality = job.audioInfo.label;
      } catch {}
      if (
        job.track.duration > 60 &&
        duration > 0 &&
        duration + 15 < job.track.duration
      )
        throw Error("返回音频短于歌曲时长，可能为试听片段，未保存");
      const notes = [];
      job.failureStage = "metadata";
      job.status = "tagging";
      job.speed = 0;
      const settings = { ...this.store.data.settings };
      if (
        this.metadata &&
        (settings.autoMetadata !== false || settings.autoLyrics)
      ) {
        job.message = "音频已下载，正在写入内嵌信息";
        this.publish();
        try {
          const result = await this.metadata.prepare(
            temp,
            extension,
            job.track,
            {
              signal: controller.signal,
              settings,
            },
          );
          const raw = temp;
          temp = result.file;
          if (raw !== temp) await fs.promises.unlink(raw);
          job.metadata = result.metadata;
          if (settings.autoMetadata !== false) notes.push("标签已写入");
          if (result.metadata.lyrics === "embedded") notes.push("歌词已内嵌");
          if (result.metadata.status === "partial")
            notes.push("部分信息未取得");
        } catch (e) {
          controller.signal.throwIfAborted();
          job.metadata = {
            status: "failed",
            warnings: [e.message || "标签写入失败"],
          };
          notes.push("内嵌信息未写入，可在本地音乐中重试");
        }
      } else {
        job.metadata = { status: "disabled", warnings: [] };
      }
      controller.signal.throwIfAborted();
      job.failureStage = "commit";
      job.status = "committing";
      job.message = "正在保存音频并更新音乐库";
      this.publish();
      completedFile = await uniqueCommit(
        temp,
        folder,
        `${job.track.artist ? job.track.artist + " - " : ""}${job.track.title}`,
        extension,
        {
          onIntent: async (target) => {
            job.pendingCommit = {
              path: target,
              sha256: await fileDigest(temp),
            };
            this.persist();
          },
        },
      );
      temp = null;
      job.path = completedFile;
      delete job.pendingCommit;
      job.progress = 100;
      job.speed = 0;
      this.persist();
      try {
        await this.library.importFiles([completedFile]);
      } catch {
        notes.push("音乐库更新失败，可重新扫描");
      }
      job.failureStage = undefined;
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
  async stop() {
    this.stopped = true;
    for (const [id, control] of this.running) {
      const job = this.jobs.find((x) => x.id === id);
      if (job?.status === "committing") continue;
      if (job) {
        job.status = job.path ? "completed" : "paused";
        job.message = job.path
          ? "下载完成 · 应用已关闭，可重新扫描音乐库"
          : "应用已关闭，可重新下载";
      }
      control.abort();
    }
    this.persist();
    await Promise.allSettled([
      ...this.tasks.values(),
      ...this.maintenance,
      this.recovery,
    ]);
  }
}
