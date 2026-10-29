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
    try {
      saved = JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch {}
    this.data = {
      settings: {
        downloadDir,
        quality: "high",
        autoLyrics: true,
        saveTranslation: true,
        lyricFormat: "auto",
        lyricSource: "auto",
        preferredResolver: "auto",
        groupByPlatform: true,
        concurrency: 2,
        usePublicFallback: true,
        theme: "light",
        ...saved.settings,
      },
      accounts: saved.accounts || [],
      library: saved.library || [],
      downloads: saved.downloads || [],
      acceptedDisclaimer: false,
      device: saved.device || {
        KUGOU_API_MID: randomBytes(16).toString("hex"),
        KUGOU_API_GUID: randomBytes(16).toString("hex"),
        KUGOU_API_MAC: "00:00:00:00:00:00",
      },
      ...saved,
    };
    this.data.settings = {
      downloadDir,
      quality: "high",
      autoLyrics: true,
      saveTranslation: true,
      lyricFormat: "auto",
      lyricSource: "auto",
      preferredResolver: "auto",
      groupByPlatform: true,
      concurrency: 2,
      usePublicFallback: true,
      theme: "light",
      ...saved.settings,
    };
    this.data.device.KUGOU_API_DEV ||= "Sonora Windows";
  }
  save() {
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), "utf8");
    fs.renameSync(tmp, this.file);
  }
  setSettings(patch) {
    const allowed = [
      "downloadDir",
      "quality",
      "autoLyrics",
      "saveTranslation",
      "lyricFormat",
      "lyricSource",
      "preferredResolver",
      "groupByPlatform",
      "concurrency",
      "usePublicFallback",
      "theme",
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
