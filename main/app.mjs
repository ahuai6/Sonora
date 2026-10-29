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
} from "electron";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { Store } from "./core/store.mjs";
import { ProviderRegistry } from "./providers/registry.mjs";
import { MusicLibrary, writeUniqueText } from "./services/files.mjs";
import { DownloadManager } from "./services/downloads.mjs";
import { MediaService } from "./services/media.mjs";
import { PLATFORMS, safeName, httpUrl } from "./core/models.mjs";
import { joinCookies } from "./providers/engines.mjs";
import { errorMessage } from "./core/errors.mjs";
import { exportLyrics } from "./services/lyrics.mjs";
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
  let win, store, providers, library, downloads, media;
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
        return await fn(...args);
      } catch (e) {
        throw Error(errorMessage(e));
      }
    });
  }
  function snapshot() {
    return {
      version: app.getVersion(),
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
    bind("resolve", async (track, quality) => {
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
          quality: local.bitrate
            ? Math.round(local.bitrate / 1000) + " kbps"
            : local.format,
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
        const file = item.path.replace(/\.[^.]+$/, ".lrc");
        return {
          original: await fs.promises.readFile(file, "utf8").catch(() => ""),
          translation: "",
          romanization: "",
        };
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
      return downloads.add(
        tracks.map(knownTrack),
        quality || store.data.settings.quality,
      );
    });
    bind("downloadAction", (id, action) => downloads.action(id, action));
    bind("chooseDirectory", () => pickDirectory("选择下载目录"));
    bind("scanLibrary", async (folder) => {
      if (!folder) folder = await pickDirectory("扫描本地音乐文件夹");
      if (!folder) return null;
      return library.scan(folder);
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
    bind("saveSettings", (patch) => {
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
      if (
        patch.quality &&
        !["standard", "high", "lossless", "hires"].includes(patch.quality)
      )
        throw Error("音质设置不正确");
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
        const domains = {
          netease: "music.163.com",
          qq: "y.qq.com",
          kugou: "kugou.com",
        };
        const cookies = (await loginSession.cookies.get({})).filter(
          (c) =>
            c.domain.replace(/^\./, "") === domains[platform] ||
            c.domain.endsWith("." + domains[platform]),
        );
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
      const info = {
        version: app.getVersion(),
        runtime: {
          electron: process.versions.electron,
          node: process.versions.node,
          os: os.release(),
          arch: process.arch,
        },
        at: new Date().toISOString(),
        providers: providers.summary().map((p) => ({
          ...p,
          baseUrl: p.baseUrl ? new URL(p.baseUrl).origin : "",
        })),
        downloads: downloads.jobs.map((j) => ({
          platform: j.track.platform,
          status: j.status,
          received: j.received,
          total: j.total,
        })),
      };
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
  downloads = new DownloadManager(store, providers, library);
  media = new MediaService();
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
  app.on("before-quit", () => {
    if (!shuttingDown) {
      shuttingDown = true;
      downloads.stop();
    }
  });
  app.on("window-all-closed", () => app.quit());
}
