import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { TAG_FIELDS } from "./tag-editor.mjs";
import { localLyricDocument, exportLyrics } from "./lyrics.mjs";

export function redact(value) {
  return JSON.parse(
    JSON.stringify(value, (key, item) => {
      if (/cookie|secret|token|authorization|password/i.test(key))
        return "[已隐藏]";
      if (typeof item !== "string") return item;
      return item
        .replace(/https?:\/\/[^\s"<>]+/g, (url) => {
          try {
            return new URL(url).origin + "/[已隐藏路径与参数]";
          } catch {
            return "[URL]";
          }
        })
        .replace(
          /\b(?:cookie|token|secret|password|authorization)\s*[:=]\s*[^\s;,]+/gi,
          "[已隐藏凭据]",
        )
        .replace(/[A-Z]:[\\/][^\n"<>]+/gi, "[已隐藏本地路径]");
    }),
  );
}
export class WorkspaceTools {
  constructor(store, library, tags, matcher, downloads, artwork) {
    Object.assign(this, { store, library, tags, matcher, downloads, artwork });
    this.plans = new Map();
  }
  async recovery() {
    const files = [];
    for (const [dir, kind] of [
      [this.store.dir, "state"],
      [this.tags.backupDir, "tags"],
    ]) {
      for (const name of await fs.promises.readdir(dir).catch(() => [])) {
        if (kind === "state" && !/^state\.json\.(good|corrupt-\d+)$/.test(name))
          continue;
        const stat = await fs.promises.stat(path.join(dir, name));
        if (stat.isFile())
          files.push({
            name,
            kind,
            bytes: stat.size,
            modifiedAt: stat.mtimeMs,
            localId:
              kind === "tags"
                ? Object.entries(this.store.data.tagBackups || {}).find(
                    ([, v]) => v === name,
                  )?.[0] || name.slice(0, 36)
                : undefined,
          });
      }
    }
    return {
      files,
      totalBytes: files.reduce((n, x) => n + x.bytes, 0),
      warning: this.store.recoveryWarning,
    };
  }
  async cleanup(names) {
    const allowed = (await this.recovery()).files.filter(
      (x) => x.kind === "tags" && names.includes(x.name),
    );
    for (const entry of allowed)
      await fs.promises.unlink(path.join(this.tags.backupDir, entry.name));
    for (const [id, name] of Object.entries(this.store.data.tagBackups || {}))
      if (names.includes(name)) delete this.store.data.tagBackups[id];
    this.store.save();
    return this.recovery();
  }
  async restoreBackup(name, id) {
    const entry = (await this.recovery()).files.find(
      (x) => x.kind === "tags" && x.name === name && x.localId === id,
    );
    if (!entry) throw Error("备份不存在");
    const snapshot = await this.tags.read(id),
      previous = this.store.data.tagBackups?.[id];
    this.store.data.tagBackups ||= {};
    this.store.data.tagBackups[id] = name;
    try {
      return await this.tags.restore(id, snapshot.revision);
    } catch (e) {
      this.store.data.tagBackups[id] = previous;
      throw e;
    }
  }
  async plan(ids, source) {
    const rows = [],
      references = new Map();
    for (const id of [...new Set(ids)].slice(0, 100)) {
      try {
        const old = await this.tags.read(id),
          result = await this.matcher.search({
            localId: id,
            query: old.item.title + " " + old.item.artist,
            source,
          });
        const candidate = result.items[0];
        if (!candidate)
          throw Error(
            result.errors.map((x) => x.message).join("；") || "未找到候选",
          );
        const details = await this.matcher.details(candidate.matchId);
        if (this.matcher.known)
          references.set(
            candidate.matchId,
            this.matcher.known(candidate.matchId),
          );
        rows.push({
          id,
          title: old.item.title,
          revision: old.revision,
          matchId: candidate.matchId,
          source: candidate.sourceName,
          score: candidate.score,
          before: old.tags,
          after: details.tags,
          warnings: details.warnings,
        });
      } catch (e) {
        rows.push({
          id,
          title: this.library.known(id).title,
          error: e.message,
        });
      }
    }
    const planId = randomUUID();
    this.plans.set(planId, { time: Date.now(), rows, references });
    for (const [key, value] of this.plans)
      if (Date.now() - value.time > 30 * 60e3 || this.plans.size > 10)
        this.plans.delete(key);
    return { planId, rows };
  }
  async apply(planId, choices, options = {}) {
    const plan = this.plans.get(planId);
    if (!plan || Date.now() - plan.time > 30 * 60e3)
      throw Error("匹配预览已过期，请重新匹配");
    const results = [];
    for (const choice of choices.slice(0, 100)) {
      if (this.closed) break;
      const row = plan.rows.find((x) => x.id === choice.id);
      if (!row || row.error) continue;
      try {
        const reference = plan.references?.get(row.matchId);
        if (reference && this.matcher.candidates)
          this.matcher.candidates.set(row.matchId, {
            ...reference,
            createdAt: Date.now(),
          });
        const tags = Object.fromEntries(
          (choice.fields || [])
            .filter(
              (key) => TAG_FIELDS.includes(key) && row.after[key] !== undefined,
            )
            .map((key) => [key, row.after[key]]),
        );
        const patch = { tags, revision: row.revision };
        if (options.cover)
          patch.artwork = (
            await this.artwork(await this.matcher.cover(row.matchId))
          )?.dataUrl;
        if (options.lyrics)
          patch.lyrics = (
            await this.matcher.lyrics(row.matchId, {
              format: "auto",
              bilingual: true,
            })
          ).text;
        await this.tags.save(row.id, patch);
        results.push({ id: row.id, ok: true });
      } catch (e) {
        results.push({ id: row.id, ok: false, message: e.message });
      }
    }
    this.plans.delete(planId);
    return { results, items: this.library.list() };
  }
  async relink(id, file) {
    const missing = this.store.data.missingLibrary || [],
      old = missing.find((x) => x.id === id);
    if (!old) throw Error("缺失记录不存在");
    if (
      this.library
        .list()
        .some(
          (x) =>
            path.resolve(x.path).toLowerCase() ===
            path.resolve(file).toLowerCase(),
        )
    )
      throw Error("此文件已在音乐库中，请选择尚未关联的文件");
    const imported = await this.library.importFiles([file], { force: true });
    const target = this.library
      .list()
      .find((x) => path.resolve(x.path) === path.resolve(file));
    if (!target || imported.failures.length) throw Error("无法读取替换文件");
    const targetId = target.id;
    Object.assign(target, {
      id: old.id,
      key: old.key,
      favorite: old.favorite,
      addedAt: old.addedAt,
    });
    this.store.data.library = this.library
      .list()
      .filter((x) => x.id !== targetId || x === target);
    this.store.data.missingLibrary = missing.filter((x) => x.id !== id);
    this.store.save();
    return this.library.list();
  }
  exportList(items, format) {
    if (format === "json")
      return JSON.stringify({ version: 1, items }, null, 2);
    if (format === "csv") {
      const cell = (x) => '"' + String(x ?? "").replaceAll('"', '""') + '"';
      return [
        "title,artist,album,path,platform,id",
        ...items.map((x) =>
          [x.title, x.artist, x.album, x.path, x.platform, x.id]
            .map(cell)
            .join(","),
        ),
      ].join("\r\n");
    }
    return (
      "#EXTM3U\n" +
      items
        .map(
          (x) =>
            "#EXTINF:" +
            Math.round(x.duration || -1) +
            "," +
            x.artist +
            " - " +
            x.title +
            "\n" +
            (x.path ||
              "sonora://" + x.platform + "/" + encodeURIComponent(x.id)),
        )
        .join("\n")
    );
  }
  async importList(text, format, base) {
    let paths = [],
      records = [];
    if (format === "json") {
      const data = JSON.parse(text);
      const items = Array.isArray(data) ? data : data.items;
      if (!Array.isArray(items)) throw Error("列表格式无效");
      records = items;
      paths = items.map((x) => x.path).filter(Boolean);
    } else if (format === "csv") {
      const rows = [];
      let row = [],
        value = "",
        quoted = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '"') {
          if (quoted && text[i + 1] === '"') {
            value += '"';
            i++;
          } else quoted = !quoted;
        } else if (!quoted && (c === "," || c === "\n")) {
          row.push(value.replace(/\r$/, ""));
          value = "";
          if (c === "\n") {
            rows.push(row);
            row = [];
          }
        } else value += c;
      }
      row.push(value);
      rows.push(row);
      const headings = rows.shift() || [],
        index = headings.indexOf("path");
      if (index < 0) throw Error("CSV 缺少 path 列");
      paths = rows.map((x) => x[index]).filter(Boolean);
      records = rows.map((row) =>
        Object.fromEntries(headings.map((key, index) => [key, row[index]])),
      );
    } else
      paths = text.split(/\r?\n/).filter((x) => x.trim() && !x.startsWith("#"));
    for (const entry of paths.filter(
      (x) => typeof x === "string" && x.startsWith("sonora://"),
    )) {
      try {
        const url = new URL(entry);
        records.push({
          platform: url.hostname,
          id: decodeURIComponent(url.pathname.slice(1)),
          title: decodeURIComponent(url.pathname.slice(1)),
        });
      } catch {}
    }
    const remote = records
      .filter(
        (x) =>
          x &&
          ["netease", "qq", "kugou"].includes(x.platform) &&
          x.id &&
          String(x.id).length < 200,
      )
      .slice(0, 5000)
      .map((x) => ({
        id: String(x.id),
        key: x.platform + ":song:" + x.id,
        kind: "song",
        platform: x.platform,
        title: String(x.title || x.id),
        artist: String(x.artist || ""),
        album: String(x.album || ""),
        cover: String(x.cover || ""),
        duration: Number(x.duration) || 0,
        meta: x.meta && typeof x.meta === "object" ? x.meta : {},
      }));
    const result = await this.library.importFiles(
      paths
        .filter((x) => typeof x === "string" && !/^\w+:\/\//.test(x))
        .map((x) => (path.isAbsolute(x) ? x : path.resolve(base, x))),
    );
    return { ...result, remote };
  }
  lyrics(text, format) {
    const doc = localLyricDocument(text, "手动编辑");
    const errors = [];
    let lastStart = -1;
    for (const row of text.split(/\r?\n/)) {
      const line = row.match(/^\[(\d+):(\d+(?:\.\d+)?)\]/);
      if (!line) continue;
      const start = Number(line[1]) * 60000 + Number(line[2]) * 1000;
      if (start < lastStart) errors.push("行时间顺序错误");
      lastStart = start;
      let lastWord = start;
      for (const word of row.matchAll(/<(\d+):(\d+(?:\.\d+)?)>/g)) {
        const time = Number(word[1]) * 60000 + Number(word[2]) * 1000;
        if (time < lastWord) errors.push("逐字时间重叠或倒序");
        lastWord = time;
      }
    }
    for (const [index, line] of (doc.lines || []).entries()) {
      if (index && line.start < doc.lines[index - 1].start)
        errors.push("行时间顺序错误");
      for (let i = 0; i < line.words.length; i++)
        if (
          line.words[i].end < line.words[i].start ||
          (i && line.words[i].start < line.words[i - 1].start)
        )
          errors.push("逐字时间重叠或倒序");
      if (
        line.words.length &&
        line.words.map((w) => w.text).join("") !== line.text
      )
        errors.push("逐字文本与原文不一致");
    }
    if (/[<\[]\d+:/.test(text) && !doc.lines?.length)
      errors.push("未解析到有效时间戳");
    return {
      doc,
      errors: [...new Set(errors)],
      exported: exportLyrics(doc, { format, bilingual: true }),
    };
  }
}
