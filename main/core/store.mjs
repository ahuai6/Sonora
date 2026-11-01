import fs from "node:fs";
import path from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
export class Store {
  constructor(dir, { crypto, downloadDir } = {}) {
    this.dir = dir;
    this.crypto = crypto;
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, "state.json");
    let saved = {};
    this.recoveryWarning = "";
    const valid = (value) =>
      value && typeof value === "object" && !Array.isArray(value);
    try {
      saved = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (!valid(saved)) throw Error("状态格式无效");
    } catch (e) {
      if (e.code !== "ENOENT") {
        const preserved = this.file + ".corrupt-" + Date.now();
        fs.copyFileSync(this.file, preserved);
        try {
          saved = JSON.parse(fs.readFileSync(this.file + ".good", "utf8"));
          if (!valid(saved)) saved = {};
        } catch {
          saved = {};
        }
        this.recoveryWarning =
          "上次状态损坏，已保留原文件并尝试恢复最近备份；可在恢复中心查看。";
      }
    }
    this.data = {
      ...saved,
      schemaVersion: 2,
      acceptedDisclaimer: saved.acceptedDisclaimer === true,
      accounts: Array.isArray(saved.accounts)
        ? saved.accounts.filter(valid)
        : [],
      library: Array.isArray(saved.library)
        ? saved.library.filter(
            (x) => valid(x) && typeof x.path === "string" && x.id,
          )
        : [],
      downloads: Array.isArray(saved.downloads)
        ? saved.downloads.filter((x) => valid(x) && valid(x.track) && x.id)
        : [],
      device: valid(saved.device)
        ? saved.device
        : {
            KUGOU_API_MID: randomBytes(16).toString("hex"),
            KUGOU_API_GUID: randomBytes(16).toString("hex"),
            KUGOU_API_MAC: "00:00:00:00:00:00",
          },
      settings: {
        downloadDir,
        quality: "high",
        autoLyrics: true,
        autoMetadata: true,
        density: "compact",
        saveTranslation: true,
        lyricFormat: "auto",
        lyricSource: "auto",
        preferredResolver: "auto",
        resolverPreferences: {},
        qualityPreferences: {},
        groupByPlatform: true,
        concurrency: 2,
        usePublicFallback: true,
        theme: "light",
        visualEffects: "full",
        motionEffects: "system",
        ...(valid(saved.settings) ? saved.settings : {}),
      },
    };
    for (const key of [
      "resolverPreferences",
      "qualityPreferences",
      "resolverOrder",
    ])
      if (!valid(this.data.settings[key])) this.data.settings[key] = {};
    this.data.missingLibrary = Array.isArray(saved.missingLibrary)
      ? saved.missingLibrary.filter(
          (x) => valid(x) && typeof x.path === "string" && x.id,
        )
      : [];
    this.data.watchFolders = Array.isArray(saved.watchFolders)
      ? saved.watchFolders.filter(
          (x) => typeof x === "string" && path.isAbsolute(x),
        )
      : [];
    this.data.ignoredLibraryPaths = Array.isArray(saved.ignoredLibraryPaths)
      ? saved.ignoredLibraryPaths.filter((x) => typeof x === "string")
      : [];
    this.data.savedLists = Array.isArray(saved.savedLists)
      ? saved.savedLists.filter(
          (x) =>
            valid(x) && typeof x.name === "string" && Array.isArray(x.items),
        )
      : [];
    if (this.data.tagBackups !== undefined && !valid(this.data.tagBackups))
      this.data.tagBackups = {};
    if (!valid(this.data.playback) || !Array.isArray(this.data.playback.queue))
      delete this.data.playback;
    if (
      typeof this.data.settings.downloadDir !== "string" ||
      !path.isAbsolute(this.data.settings.downloadDir)
    )
      this.data.settings.downloadDir = downloadDir || path.join(dir, "music");
    this.data.device.KUGOU_API_DEV ||= "Sonora Windows";
  }
  save() {
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), "utf8");
    fs.renameSync(tmp, this.file);
    // Keep a last known valid snapshot, independent of a potentially corrupt input.
    const good = this.file + ".good.tmp";
    try {
      fs.copyFileSync(this.file, good);
      fs.renameSync(good, this.file + ".good");
    } catch {
      this.recoveryWarning =
        "状态已保存，但最近有效备份更新失败，请检查磁盘空间与权限。";
    }
  }
  setSettings(patch) {
    const allowed = [
      "downloadDir",
      "quality",
      "autoLyrics",
      "autoMetadata",
      "density",
      "saveTranslation",
      "lyricFormat",
      "lyricSource",
      "preferredResolver",
      "resolverPreferences",
      "qualityPreferences",
      "resolverOrder",
      "groupByPlatform",
      "concurrency",
      "usePublicFallback",
      "theme",
      "visualEffects",
      "motionEffects",
    ];
    for (const key of allowed)
      if (patch[key] !== undefined) this.data.settings[key] = patch[key];
    this.save();
    return this.data.settings;
  }
  publicAccounts() {
    return this.data.accounts.map(({ secret, ...rest }) => ({
      ...rest,
      hasCredential: !!secret,
    }));
  }
  account(platform) {
    const item = this.data.accounts.find(
      (x) => x.platform === platform && x.active,
    );
    if (!item) return { uid: "" };
    const { secret, ...publicData } = item;
    return publicData;
  }
  credential(platform) {
    const account = this.data.accounts.find(
      (x) => x.platform === platform && x.active,
    );
    if (!account) return { cookie: "", uid: "" };
    try {
      return {
        ...account,
        cookie: this.crypto.decryptString(
          Buffer.from(account.secret, "base64"),
        ),
      };
    } catch {
      throw Error("本机账号凭据无法解密，请重新登录");
    }
  }
  saveAccount({
    platform,
    cookie,
    uid = "",
    nickname = "",
    id,
    verified = false,
  }) {
    if (!this.crypto?.isEncryptionAvailable())
      throw Error("Windows 凭据加密暂不可用，未保存账号");
    const account = {
      id: id || randomUUID(),
      platform,
      uid: String(uid),
      nickname: nickname || `${platform} 用户`,
      verified,
      active: true,
      updatedAt: Date.now(),
      secret: this.crypto.encryptString(cookie).toString("base64"),
    };
    this.data.accounts = this.data.accounts
      .filter((x) => x.id !== account.id)
      .map((x) => (x.platform === platform ? { ...x, active: false } : x));
    this.data.accounts.push(account);
    this.save();
    return this.publicAccounts();
  }
  activateAccount(id) {
    const selected = this.data.accounts.find((x) => x.id === id);
    if (!selected) throw Error("账号不存在");
    this.data.accounts = this.data.accounts.map((x) =>
      x.platform === selected.platform ? { ...x, active: x.id === id } : x,
    );
    this.save();
    return this.publicAccounts();
  }
  logout(id) {
    this.data.accounts = this.data.accounts.filter((x) => x.id !== id);
    this.save();
    return this.publicAccounts();
  }
}
