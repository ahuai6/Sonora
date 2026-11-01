import { WorkspaceTools, redact } from "./services/workspace-tools.mjs";
import { FileTransactions } from "./services/file-transactions.mjs";
import { LibraryWatch } from "./services/library-watch.mjs";
import { probeAudio } from "./services/audio-info.mjs";
import { stopSdkWorkers } from "./providers/sdk-client.mjs";
import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  safeStorage,
  protocol,
  session,
  Menu,
  nativeImage,
} from "electron";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { Store } from "./core/store.mjs";
import { ProviderRegistry } from "./providers/registry.mjs";
import { MusicLibrary, writeUniqueText } from "./services/files.mjs";
import { DownloadManager } from "./services/downloads.mjs";
import { MediaService } from "./services/media.mjs";
import { PLATFORMS, QUALITY, safeName, httpUrl } from "./core/models.mjs";
import { joinCookies } from "./providers/engines.mjs";
import { errorMessage } from "./core/errors.mjs";
import {
  exportLyrics,
  lyricDocument,
  parseTtml,
  localLyricDocument,
} from "./services/lyrics.mjs";
import { TagEditor, readTags } from "./services/tag-editor.mjs";
import { MetadataMatcher } from "./services/metadata-match.mjs";
import { fetchArtwork, normalizeArtwork } from "./services/artwork.mjs";
import { DownloadMetadata } from "./services/download-metadata.mjs";
import { CollectionActions } from "./services/collection-actions.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
app.setName("Sonora");
if (!app.isPackaged && process.env.SONORA_DATA_DIR)
  app.setPath("userData", process.env.SONORA_DATA_DIR);
const profileOverride = app.commandLine.getSwitchValue("user-data-dir");
if (profileOverride && path.isAbsolute(profileOverride))
  app.setPath("userData", profileOverride);
protocol.registerSchemesAsPrivileged([
  {
    scheme: "sonora-media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win,
    store,
    providers,
    library,
    downloads,
    media,
    tagEditor,
    metadataMatcher;
  let collections, workspace, watcher;
  const transactions = new FileTransactions(),
    errors = [],
    mutations = new Set();
  async function suspendMutation(file) {
    const unlock = await transactions.acquire(file);
    try {
      const resume = await media.suspendFile(file);
      return () => {
        resume();
        unlock();
      };
    } catch (e) {
      unlock();
      throw e;
    }
  }
  function diagnosticSnapshot() {
    return redact({
      version: app.getVersion(),
      runtime: {
        electron: process.versions.electron,
        node: process.versions.node,
        os: os.release(),
      },
      providers: providers.summary(),
      resolvers: [...providers.resolverHealth.entries()].map(
        ([id, health]) => ({ id, ...health }),
      ),
      errors,
      downloads: downloads.jobs.map((j) => ({
        platform: j.track.platform,
        status: j.status,
        stage: j.failureStage,
        quality: j.audioInfo,
        message: j.message,
        warnings: j.metadata?.warnings,
      })),
    });
  }
  const logins = new Map();
  let shuttingDown = false;
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  const knownTrack = (t) => {
    if (
      !t ||
      !PLATFORMS.includes(t.platform) ||
      !["song"].includes(t.kind) ||
      !t.id ||
      typeof t.title !== "string" ||
      String(t.id).length > 200
    )
      throw Error("歌曲数据不正确");
    return {
      ...t,
      id: String(t.id),
      title: t.title.slice(0, 300),
      artist: String(t.artist || "").slice(0, 300),
      duration: Number(t.duration) || 0,
      meta: t.meta || {},
    };
  };
  function bind(name, fn) {
    ipcMain.handle(`sonora:${name}`, async (event, ...args) => {
      const url = event.senderFrame?.url || "";
      const dev = process.env.SONORA_DEV_URL;
      if (
        event.sender !== win?.webContents ||
        !(dev
          ? url.startsWith(dev + "/")
          : url.startsWith("file://") &&
            decodeURI(url).replaceAll("\\", "/").includes("/dist/index.html"))
      )
        throw Error("无效的调用来源");
      try {
        const task = Promise.resolve(fn(...args));
        const mutating =
          [
            "tagSave",
            "tagSaveCopy",
            "tagRestore",
            "scanLibrary",
            "importMusic",
            "libraryAction",
            "collectionBatch",
            "refreshFiles",
          ].includes(name) ||
          (name === "workspace" &&
            [
              "batchApply",
              "restoreBackup",
              "relink",
              "importList",
              "retryMetadata",
            ].includes(args[0]));
        if (mutating) mutations.add(task);
        try {
          return await task;
        } finally {
          mutations.delete(task);
        }
      } catch (e) {
        errors.push({ at: Date.now(), action: name, message: errorMessage(e) });
        if (errors.length > 200) errors.shift();
        throw Error(errorMessage(e));
      }
    });
  }
  function snapshot() {
    return {
      version: app.getVersion(),
      configWarning: [providers.configWarning, store.recoveryWarning]
        .filter(Boolean)
        .join("；"),
      settings: store.data.settings,
      accounts: store.publicAccounts(),
      downloads: downloads.publicJobs(),
      library: library.list(),
      providers: providers.summary(),
      acceptedDisclaimer: store.data.acceptedDisclaimer,
      platform: process.platform,
    };
  }
  async function pickDirectory(title = "选择音乐目录") {
    const r = await dialog.showOpenDialog(win, {
      title,
      defaultPath: store.data.settings.downloadDir,
      properties: ["openDirectory", "createDirectory"],
    });
    return r.canceled ? null : r.filePaths[0];
  }
  function installIPC() {
    bind("bootstrap", snapshot);
    bind("workspace", async (action, input = {}) => {
      if (!input || typeof input !== "object") throw Error("操作参数不正确");
      if (action === "recovery") return workspace.recovery();
      if (action === "cleanup")
        return workspace.cleanup(Array.isArray(input.names) ? input.names : []);
      if (action === "restoreBackup")
        return workspace.restoreBackup(input.name, input.id);
      if (action === "missing") return store.data.missingLibrary || [];
      if (action === "forgetMissing") {
        store.data.missingLibrary = (store.data.missingLibrary || []).filter(
          (x) => !input.ids.includes(x.id),
        );
        store.save();
        return store.data.missingLibrary;
      }
      if (action === "relink") {
        const r = await dialog.showOpenDialog(win, {
          title: "重新定位音频",
          properties: ["openFile"],
        });
        if (r.canceled) return null;
        const items = await workspace.relink(input.id, r.filePaths[0]);
        win.webContents.send("sonora:library", items);
        return items;
      }
      if (action === "batchPlan")
        return workspace.plan(input.ids, input.source || "all");
      if (action === "batchApply") {
        const r = await workspace.apply(
          input.planId,
          input.choices,
          input.options,
        );
        win.webContents.send("sonora:library", r.items);
        return r;
      }
      if (action === "queueLoad") return store.data.playback || null;
      if (action === "savedLists") return store.data.savedLists;
      if (action === "loadSavedList")
        return (
          store.data.savedLists.find((x) => x.id === input.id)?.items || []
        );
      if (action === "queueSave") {
        if (!Array.isArray(input.queue) || input.queue.length > 5000)
          throw Error("队列最多 5000 首");
        const queue = input.queue
          .filter(
            (t) =>
              t?.platform !== "local" ||
              library.list().some((x) => x.id === t.id),
          )
          .map((t) =>
            t.platform === "local" ? library.known(t.id) : knownTrack(t),
          );
        store.data.playback = {
          queue,
          current: queue.find((x) => x.key === input.current)?.key || "",
          position: Math.max(0, Number(input.position) || 0),
          volume: Math.max(0, Math.min(1, Number(input.volume) || 0)),
          mode: ["loop", "one", "shuffle"].includes(input.mode)
            ? input.mode
            : "loop",
        };
        store.save();
        return store.data.playback;
      }
      if (action === "lyricPreview") {
        if (typeof input.text !== "string" || input.text.length > 1024 * 1024)
          throw Error("歌词过长");
        return workspace.lyrics(input.text, input.format || "auto");
      }
      if (action === "lyricExport") {
        const result = workspace.lyrics(input.text, input.format || "auto");
        if (result.errors.length) throw Error(result.errors.join("；"));
        const r = await dialog.showSaveDialog(win, {
          title: "导出编辑后的歌词",
          defaultPath: "lyrics." + result.exported.extension,
        });
        if (r.canceled) return null;
        await fs.promises.writeFile(r.filePath, result.exported.text, "utf8");
        return r.filePath;
      }
      if (action === "exportList") {
        const items =
          input.scope === "collection"
            ? Array.isArray(input.items)
              ? input.items.slice(0, 5000).map(knownTrack)
              : []
            : input.scope === "queue"
              ? store.data.playback?.queue || []
              : input.scope === "downloads"
                ? downloads.jobs
                    .filter((x) => x.path)
                    .map((x) => ({ ...x.track, path: x.path }))
                : library
                    .list()
                    .filter(
                      (x) => !input.ids?.length || input.ids.includes(x.id),
                    );
        const format = ["json", "csv", "m3u8"].includes(input.format)
          ? input.format
          : "json";
        const r = await dialog.showSaveDialog(win, {
          title: "导出音乐列表",
          defaultPath: "Sonora-list." + format,
        });
        if (r.canceled) return null;
        await fs.promises.writeFile(
          r.filePath,
          "\ufeff" + workspace.exportList(items, format),
          "utf8",
        );
        return r.filePath;
      }
      if (action === "importList") {
        const r = await dialog.showOpenDialog(win, {
          title: "导入音乐列表",
          properties: ["openFile"],
          filters: [
            { name: "音乐列表", extensions: ["json", "csv", "m3u8", "m3u"] },
          ],
        });
        if (r.canceled) return null;
        const file = r.filePaths[0];
        const stat = await fs.promises.stat(file);
        if (stat.size > 10 * 1024 * 1024) throw Error("列表超过 10 MB");
        const result = await workspace.importList(
          (await fs.promises.readFile(file, "utf8")).replace(/^\ufeff/, ""),
          path.extname(file).slice(1),
          path.dirname(file),
        );
        if (result.remote.length) {
          store.data.savedLists.unshift({
            id: randomUUID(),
            name: path.basename(file, path.extname(file)),
            items: result.remote,
            createdAt: Date.now(),
          });
          store.data.savedLists = store.data.savedLists.slice(0, 100);
          store.save();
        }
        win.webContents.send("sonora:library", result.items);
        return result;
      }
      if (action === "retryMetadata") return downloads.retryMetadata(input.ids);
      if (action === "restoreState") {
        const entry = (await workspace.recovery()).files.find(
          (x) => x.kind === "state" && x.name === input.name,
        );
        if (!entry) throw Error("备份不存在");
        const content = await fs.promises.readFile(
            path.join(store.dir, entry.name),
            "utf8",
          ),
          value = JSON.parse(content);
        if (
          !value ||
          typeof value !== "object" ||
          !Array.isArray(value.library)
        )
          throw Error("备份格式无效");
        if (downloads.running.size) throw Error("请先暂停所有下载再恢复状态");
        await downloads.stop();
        await fs.promises.copyFile(
          store.file,
          store.file + ".corrupt-" + Date.now(),
        );
        await fs.promises.writeFile(store.file + ".restore", content);
        await fs.promises.rename(store.file + ".restore", store.file);
        shuttingDown = true;
        watcher.close();
        stopSdkWorkers();
        app.relaunch();
        app.quit();
        return true;
      }
      if (action === "diagnostics") return diagnosticSnapshot();
      throw Error("未知工具操作");
    });
    bind("search", (query) => providers.search(query));
    bind("charts", (platform) => providers.browse(platform, "charts"));
    bind("recommend", (platform) => providers.browse(platform, "recommend"));
    bind("collection", (item, page = 1) => {
      if (
        !PLATFORMS.includes(item?.platform) ||
        !["playlist", "album", "artist", "chart"].includes(item?.kind)
      )
        throw Error("资源类型不正确");
      return providers.browse(item.platform, item.kind, {
        id: item.id,
        query: item.title,
        page,
        limit: 50,
      });
    });
    bind("probeAudio", async (mediaUrl) => {
      const parsed = new URL(mediaUrl);
      if (parsed.protocol !== "sonora-media:" || parsed.hostname !== "audio")
        throw Error("无效音频来源");
      const source = media.entries.get(parsed.pathname.slice(1));
      if (!source) throw Error("音频来源已过期");
      return probeAudio(source);
    });
    bind("resolve", async (track, quality) => {
      quality =
        quality ||
        store.data.settings.qualityPreferences?.[track?.platform] ||
        store.data.settings.quality;
      if (track?.platform === "local") {
        const local = library.known(track.id);
        const mime =
          {
            mp3: "audio/mpeg",
            flac: "audio/flac",
            m4a: "audio/mp4",
            ogg: "audio/ogg",
            wav: "audio/wav",
            opus: "audio/ogg",
            aac: "audio/aac",
          }[local.format.toLowerCase()] || "application/octet-stream";
        return {
          mediaUrl: media.register({ path: local.path, mime }),
          source: "本地音乐",
          quality: local.audioInfo?.label || "音质待音频确认",
          trial: false,
        };
      }
      const result = await providers.resolve(knownTrack(track), quality);
      return {
        mediaUrl: media.register(result),
        source: result.source,
        quality: result.quality,
        trial: result.trial,
      };
    });
    bind("lyrics", async (track) => {
      if (track?.platform === "local") {
        const item = library.known(track.id);
        let embedded = "";
        try {
          embedded = readTags(item.path).lyrics;
        } catch {}
        const file = item.path.replace(/\.[^.]+$/, ".lrc");
        const text =
          embedded ||
          (await fs.promises.readFile(file, "utf8").catch(() => ""));
        const doc = localLyricDocument(
          text,
          embedded ? "本地内嵌歌词" : "本地歌词文件",
        );
        return doc;
      }
      return providers.lyrics(knownTrack(track));
    });
    bind(
      "saveLyrics",
      async (track, kind = { format: "auto", bilingual: true }) => {
        track = knownTrack(track);
        const content = await providers.lyrics(track);
        const exported = exportLyrics(
          content,
          typeof kind === "string" ? kind : kind,
        );
        const text = exported.text;
        const file = await dialog.showSaveDialog(win, {
          title: "保存歌词",
          defaultPath: path.join(
            store.data.settings.downloadDir,
            `${safeName(`${track.artist} - ${track.title}`)}${kind === "translation" ? ".translation" : ""}.${exported.extension}`,
          ),
          filters: [{ name: exported.label, extensions: [exported.extension] }],
        });
        if (file.canceled) return null;
        await fs.promises.mkdir(path.dirname(file.filePath), {
          recursive: true,
        });
        await fs.promises.writeFile(file.filePath, "\ufeff" + text, "utf8");
        return file.filePath;
      },
    );
    bind("download", (tracks, quality) => {
      if (!Array.isArray(tracks) || tracks.length > 300)
        throw Error("一次最多下载 300 首");
      let added = 0;
      for (const track of tracks.map(knownTrack))
        added += downloads.add(
          [track],
          store.data.settings.qualityPreferences?.[track.platform] ||
            quality ||
            store.data.settings.quality,
        ).added;
      return { added, jobs: downloads.publicJobs() };
    });
    bind("downloadAction", (id, action) => downloads.action(id, action));
    bind("refreshFiles", async () => {
      const result = await collections.refresh();
      win.webContents.send("sonora:library", result.items);
      return result;
    });
    bind("collectionBatch", async (scope, ids, action) => {
      const result = await collections.batch(scope, ids, action);
      win.webContents.send("sonora:library", result.items);
      return result;
    });
    bind("chooseDirectory", () => pickDirectory("选择下载目录"));
    bind("scanLibrary", async (folder) => {
      if (!folder) folder = await pickDirectory("扫描本地音乐文件夹");
      if (!folder) return null;
      const result = await library.scan(folder);
      store.data.watchFolders = [
        ...new Set([...(store.data.watchFolders || []), folder]),
      ].slice(0, 30);
      store.save();
      watcher.watch(folder);
      return result;
    });
    bind("importMusic", async () => {
      const r = await dialog.showOpenDialog(win, {
        title: "导入本地音乐",
        properties: ["openFile", "multiSelections"],
        filters: [
          {
            name: "音频文件",
            extensions: [
              "mp3",
              "flac",
              "m4a",
              "aac",
              "ogg",
              "opus",
              "wav",
              "ape",
              "aiff",
              "wma",
              "dsf",
              "dff",
            ],
          },
        ],
      });
      if (r.canceled) return null;
      return library.importFiles(r.filePaths);
    });
    bind("libraryAction", async (id, action) => {
      if (action === "favorite") return library.toggleFavorite(id);
      if (action === "remove") return library.remove(id);
      if (action === "reveal") {
        shell.showItemInFolder(library.known(id).path);
        return library.list();
      }
      if (action === "trash") {
        const item = library.known(id);
        const r = await dialog.showMessageBox(win, {
          type: "warning",
          title: "移入回收站",
          message: `将「${item.title}」的音频文件移入 Windows 回收站？`,
          detail: "此操作会移动磁盘上的音频文件。关联歌词不会自动删除。",
          buttons: ["取消", "移入回收站"],
          defaultId: 0,
          cancelId: 0,
        });
        if (r.response === 1) {
          await shell.trashItem(item.path);
          return library.remove(id);
        }
        return library.list();
      }
      throw Error("未知音乐库操作");
    });
    bind("tagRead", (id) => tagEditor.read(id));
    bind("tagSave", (id, patch) => tagEditor.save(id, patch));
    bind("tagSaveCopy", async (id, patch) => {
      const item = library.known(id),
        extension = path.extname(item.path).slice(1);
      const picked = await dialog.showSaveDialog(win, {
        title: "另存已编辑的音频副本",
        defaultPath: path.join(
          path.dirname(item.path),
          path.basename(item.path, path.extname(item.path)) +
            " - 已编辑." +
            extension,
        ),
        filters: [
          { name: extension.toUpperCase() + " 音频", extensions: [extension] },
        ],
      });
      if (picked.canceled) return null;
      return tagEditor.save(id, patch, { copyTo: picked.filePath });
    });
    bind("tagRestore", (id, revision) => tagEditor.restore(id, revision));
    bind("tagSearch", (input) => metadataMatcher.search(input));
    bind("tagMatchDetails", (id) => metadataMatcher.details(id));
    bind("tagMatchLyrics", (id, options) =>
      metadataMatcher.lyrics(id, options),
    );
    const artwork = async (url) => {
      if (url) return fetchArtwork(url, nativeImage);
      const r = await dialog.showOpenDialog(win, {
        title: "选择歌曲封面",
        properties: ["openFile"],
        filters: [
          {
            name: "封面图片",
            extensions: ["jpg", "jpeg", "png", "webp", "gif"],
          },
        ],
      });
      if (r.canceled) return null;
      const stat = await fs.promises.stat(r.filePaths[0]);
      if (stat.size > 12 * 1024 * 1024) throw Error("封面不能超过 12 MB");
      return normalizeArtwork(
        await fs.promises.readFile(r.filePaths[0]),
        nativeImage,
      );
    };
    bind("tagArtwork", (url) => artwork(url));
    bind("tagMatchCover", async (id) =>
      artwork(await metadataMatcher.cover(id)),
    );
    bind("saveSettings", (patch) => {
      if (
        patch.visualEffects &&
        !["full", "reduced"].includes(patch.visualEffects)
      )
        throw Error("视觉效果设置不正确");
      if (
        patch.motionEffects &&
        !["system", "reduced"].includes(patch.motionEffects)
      )
        throw Error("动态效果设置不正确");
      if (patch.density && !["compact", "comfortable"].includes(patch.density))
        throw Error("信息密度设置不正确");
      if (patch.acceptedDisclaimer !== undefined) {
        store.data.acceptedDisclaimer = !!patch.acceptedDisclaimer;
        store.save();
      }
      if (
        patch.downloadDir &&
        (!path.isAbsolute(patch.downloadDir) ||
          patch.downloadDir.includes("\0"))
      )
        throw Error("下载目录必须为绝对路径");
      if (patch.quality && !Object.hasOwn(QUALITY, patch.quality))
        throw Error("音质设置不正确");
      for (const key of ["qualityPreferences", "resolverPreferences"])
        if (patch[key] !== undefined) {
          if (
            !patch[key] ||
            typeof patch[key] !== "object" ||
            Array.isArray(patch[key])
          )
            throw Error("平台偏好不正确");
          for (const [platform, value] of Object.entries(patch[key]))
            if (
              !PLATFORMS.includes(platform) ||
              typeof value !== "string" ||
              (key === "qualityPreferences" &&
                value &&
                !Object.hasOwn(QUALITY, value))
            )
              throw Error("平台偏好不正确");
        }
      if (patch.resolverOrder !== undefined) {
        if (
          !patch.resolverOrder ||
          typeof patch.resolverOrder !== "object" ||
          Array.isArray(patch.resolverOrder)
        )
          throw Error("音源优先级不正确");
        for (const [platform, order] of Object.entries(patch.resolverOrder))
          if (
            !PLATFORMS.includes(platform) ||
            !Array.isArray(order) ||
            order.length > 30 ||
            order.some(
              (id) =>
                id !== "builtin" &&
                !providers.config.resolvers.some((r) => r.id === id),
            )
          )
            throw Error("音源优先级不正确");
      }
      return store.setSettings(patch);
    });
    bind("saveAccount", async (account) => {
      if (account.activate) return store.activateAccount(account.id);
      if (account.updateDetails) {
        const saved = store.data.accounts.find((x) => x.id === account.id);
        if (!saved) throw Error("账号不存在");
        const uid = String(account.uid || "")
          .trim()
          .slice(0, 100);
        if (saved.uid !== uid) saved.verified = false;
        saved.uid = uid;
        saved.nickname = String(account.nickname || saved.nickname).slice(
          0,
          100,
        );
        store.save();
        return store.publicAccounts();
      }
      if (
        !PLATFORMS.includes(account.platform) ||
        typeof account.cookie !== "string" ||
        !account.cookie.trim() ||
        account.cookie.length > 50000
      )
        throw Error("请填写有效的账号 Cookie");
      const info = await providers.accountInfo(
        account.platform,
        account.cookie,
        account.uid,
      );
      return store.saveAccount({
        ...account,
        cookie: joinCookies(account.cookie),
        uid: info.uid || account.uid,
        nickname: account.nickname || info.nickname,
        verified: info.verified,
      });
    });
    bind("logout", async (id) => {
      const account = store.publicAccounts().find((x) => x.id === id);
      const remaining = store.logout(id);
      if (account && !remaining.some((x) => x.platform === account.platform))
        await session
          .fromPartition(`persist:sonora-login-${account.platform}`)
          .clearStorageData();
      return remaining;
    });
    bind("accountPlaylists", (platform, page = 1) => {
      if (!store.credential(platform).uid)
        throw Error("请在账号设置中补充平台用户 ID");
      return providers.browse(platform, "userPlaylists", { page, limit: 40 });
    });
    bind("auth", (platform, action, id) =>
      providers.auth(platform, action, id),
    );
    bind("openLogin", async (platform, collect = false) => {
      if (!PLATFORMS.includes(platform)) throw Error("平台不正确");
      const partition = `persist:sonora-login-${platform}`;
      const loginSession = session.fromPartition(partition);
      loginSession.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
      if (collect) {
        const origin = {
          netease: "https://music.163.com/",
          qq: "https://y.qq.com/",
          kugou: "https://www.kugou.com/",
        }[platform];
        const cookies = await loginSession.cookies.get({ url: origin });
        const cookie = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
        const required = {
          netease: ["MUSIC_U"],
          qq: ["qqmusic_key", "qm_keyst"],
          kugou: ["token"],
        };
        if (
          !required[platform].some((key) =>
            cookies.some((c) => c.name === key && c.value),
          )
        )
          throw Error(
            "尚未检测到平台登录态，请先在官方页面完成登录，或改用扫码 / Cookie 导入",
          );
        const info = await providers.accountInfo(platform, cookie);
        const accounts = store.saveAccount({ platform, cookie, ...info });
        logins.get(platform)?.close();
        return { accounts };
      }
      if (logins.get(platform) && !logins.get(platform).isDestroyed()) {
        logins.get(platform).focus();
        return {};
      }
      const popup = new BrowserWindow({
        width: 1050,
        height: 780,
        parent: win,
        title: "声屿 · 官方网页登录",
        autoHideMenuBar: true,
        webPreferences: {
          partition,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      logins.set(platform, popup);
      popup.webContents.setWindowOpenHandler(({ url }) => {
        if (httpUrl(url) && new URL(url).protocol === "https:")
          popup.loadURL(url).catch(() => {});
        return { action: "deny" };
      });
      popup.webContents.on("will-navigate", (event, url) => {
        if (!httpUrl(url) || new URL(url).protocol !== "https:")
          event.preventDefault();
      });
      popup.on("closed", () => logins.delete(platform));
      await popup.loadURL(
        {
          netease: "https://music.163.com/",
          qq: "https://y.qq.com/",
          kugou: "https://www.kugou.com/",
        }[platform],
      );
      return {};
    });
    bind("profiles", () => ({
      config: providers.config,
      summary: providers.summary(),
    }));
    bind("saveProfiles", (c) => providers.save(c));
    bind("resetProfiles", () => providers.reset());
    bind("testProvider", async (platform) => {
      const start = Date.now();
      try {
        const r = await providers.search({
          query: "海阔天空",
          kind: "song",
          platform,
          limit: 3,
        });
        return {
          ok: r.items.length > 0,
          latency: Date.now() - start,
          count: r.items.length,
          message:
            r.errors.map((e) => e.message).join("；") ||
            (r.items.length ? "搜索接口正常" : "接口响应为空"),
        };
      } catch (e) {
        return {
          ok: false,
          message: e.message,
          latency: Date.now() - start,
          count: 0,
        };
      }
    });
    bind("openFolder", async (id) => {
      if (id) {
        const j = downloads.jobs.find((x) => x.id === id);
        if (j?.path) {
          shell.showItemInFolder(j.path);
          return;
        }
      }
      await fs.promises.mkdir(store.data.settings.downloadDir, {
        recursive: true,
      });
      await shell.openPath(store.data.settings.downloadDir);
    });
    bind("exportDiagnostics", async () => {
      const r = await dialog.showSaveDialog(win, {
        title: "导出诊断信息",
        defaultPath: "Sonora-diagnostics.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (r.canceled) return null;
      const info = diagnosticSnapshot();
      await fs.promises.writeFile(
        r.filePath,
        JSON.stringify(info, null, 2),
        "utf8",
      );
      return r.filePath;
    });
    bind("windowAction", (action) => {
      if (action === "minimize") win.minimize();
      if (action === "maximize")
        win.isMaximized() ? win.unmaximize() : win.maximize();
      if (action === "close") win.close();
    });
  }
  await app.whenReady();
  Menu.setApplicationMenu(null);
  store = new Store(app.getPath("userData"), {
    crypto: safeStorage,
    downloadDir: path.join(app.getPath("music"), "Sonora"),
  });
  providers = new ProviderRegistry(
    store,
    path.join(root, "profiles/providers.json"),
  );
  library = new MusicLibrary(store);
  tagEditor = new TagEditor(store, library, {
    beforeWrite: suspendMutation,
  });
  metadataMatcher = new MetadataMatcher(providers, library);
  downloads = new DownloadManager(store, providers, library, {
    metadata: new DownloadMetadata(metadataMatcher, tagEditor, {
      artwork: (url, options) => fetchArtwork(url, nativeImage, options),
      lyrics: (track, options) => providers.lyrics(track, options),
    }),
  });
  media = new MediaService({ coverDir: library.coverDir });
  collections = new CollectionActions(library, downloads, {
    confirmTrash: async (count) =>
      (
        await dialog.showMessageBox(win, {
          type: "warning",
          title: "批量移入回收站",
          message: `将所选 ${count} 个音频文件移入 Windows 回收站？`,
          detail:
            "会移动磁盘上的音频，并移除对应音乐库记录。旁置歌词不受影响。",
          buttons: ["取消", "移入回收站"],
          defaultId: 0,
          cancelId: 0,
        })
      ).response === 1,
    trashFile: (file) => shell.trashItem(file),
    suspendFile: suspendMutation,
  });
  workspace = new WorkspaceTools(
    store,
    library,
    tagEditor,
    metadataMatcher,
    downloads,
    async (url) => {
      if (!url) return null;
      const result = await fetchArtwork(url, nativeImage);
      return result;
    },
  );
  watcher = new LibraryWatch(library, (items) => {
    if (win && !win.isDestroyed())
      win.webContents.send("sonora:library", items);
  });
  for (const folder of [
    ...(store.data.watchFolders || []),
    store.data.settings.downloadDir,
  ])
    watcher.watch(folder);
  protocol.handle("sonora-media", (request) => media.handle(request));
  win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1080,
    minHeight: 740,
    frame: false,
    backgroundColor: "#f7f8fa",
    title: "声屿 · Sonora",
    show: false,
    icon: path.join(root, "build/icon.ico"),
    webPreferences: {
      preload: path.join(root, "main/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault();
  });
  win.webContents.session.setPermissionRequestHandler((_wc, _p, cb) =>
    cb(false),
  );
  installIPC();
  downloads.on("update", (jobs) => {
    if (win && !win.isDestroyed())
      win.webContents.send("sonora:download", jobs);
  });
  win.once("ready-to-show", () => win.show());
  if (process.env.SONORA_DEV_URL && !app.isPackaged)
    await win.loadURL(process.env.SONORA_DEV_URL);
  else await win.loadFile(path.join(root, "dist/index.html"));
  const missingCovers = library
    .list()
    .filter((i) => i.meta?.coverVersion !== 1)
    .map((i) => i.path);
  if (missingCovers.length)
    library
      .importFiles(missingCovers)
      .then((r) => {
        if (win && !win.isDestroyed())
          win.webContents.send("sonora:library", r.items);
      })
      .catch(() => {});
  app.on("before-quit", (event) => {
    if (!shuttingDown) {
      event.preventDefault();
      shuttingDown = true;
      watcher.close();
      workspace.closed = true;
      Promise.allSettled([downloads.stop(), ...mutations])
        .then(() => library.importQueue)
        .catch(() => {})
        .finally(() => {
          stopSdkWorkers();
          app.quit();
        });
    }
  });
  app.on("window-all-closed", () => app.quit());
}
