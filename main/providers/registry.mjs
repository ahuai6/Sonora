import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import QRCode from "qrcode";
import {
  PLATFORMS,
  QUALITY,
  renderTemplate,
  normalizeEntity,
  unwrap,
  first,
  arrayAt,
  extractList,
  httpUrl,
  clean,
} from "../core/models.mjs";
import { EngineBridge, parseCookie, joinCookies } from "./engines.mjs";
import { jsonRequest, request } from "../core/transport.mjs";
import { lyricDocument, parseTtml } from "../services/lyrics.mjs";
import { decryptQrc, parseQrcXml } from "../vendor/lrc-get/qrc2lrc.js";
import { errorMessage } from "../core/errors.mjs";
export class ProviderRegistry {
  constructor(store, defaults) {
    this.store = store;
    this.defaults = defaults;
    this.file = path.join(store.dir, "providers.json");
    this.bridge = new EngineBridge(store);
    this.authSessions = new Map();
    this.lyricCache = new Map();
    this.reload();
  }
  reload() {
    this.config = JSON.parse(
      fs.readFileSync(
        fs.existsSync(this.file) ? this.file : this.defaults,
        "utf8",
      ),
    );
    this.validate(this.config);
    const n = this.config.platforms.find((p) => p.id === "netease");
    if (
      n &&
      !n.baseUrl &&
      !n.routes.lyrics.lyricPaths &&
      n.routes.lyrics.module === "lyric" &&
      !n.routes.lyricsWord
    )
      n.routes.lyricsWord = {
        module: "lyric_new",
        path: "/lyric/new",
        params: { id: "{id}" },
      };
  }
  validate(c) {
    if (
      c?.schemaVersion !== 1 ||
      !Array.isArray(c.platforms) ||
      !Array.isArray(c.resolvers)
    )
      throw Error(
        "接口配置格式不正确：需要 schemaVersion=1、platforms 和 resolvers",
      );
    const ids = new Set();
    for (const p of c.platforms) {
      if (
        !PLATFORMS.includes(p.id) ||
        ids.has(p.id) ||
        !["netease", "qq", "kugou"].includes(p.engine) ||
        !p.routes ||
        !p.searchTypes
      )
        throw Error("平台 ID、引擎或路由配置不正确");
      ids.add(p.id);
      if (p.baseUrl && !httpUrl(p.baseUrl)) throw Error("接口基础地址不正确");
      for (const r of Object.values(p.routes)) {
        if (r.path && !r.path.startsWith("/"))
          throw Error("路由 path 必须以 / 开头");
        if (r.method && !["GET", "POST"].includes(r.method))
          throw Error("仅支持 GET/POST 路由");
      }
    }
    for (const r of c.resolvers) {
      if (
        !httpUrl(r.url) ||
        !["redirect", "json"].includes(r.mode) ||
        !Array.isArray(r.platforms)
      )
        throw Error("备用取链服务配置不正确");
    }
    for (const source of c.lyricSources || []) {
      if (
        !source.id ||
        !httpUrl(source.url) ||
        typeof source.directories !== "object"
      )
        throw Error("社区歌词源配置不正确");
    }
  }
  save(c) {
    if (typeof c === "string") c = JSON.parse(c);
    this.validate(c);
    fs.writeFileSync(this.file + ".tmp", JSON.stringify(c, null, 2), "utf8");
    fs.renameSync(this.file + ".tmp", this.file);
    this.config = c;
    this.lyricCache.clear();
    return this.summary();
  }
  reset() {
    this.config = JSON.parse(fs.readFileSync(this.defaults, "utf8"));
    return this.save(this.config);
  }
  summary() {
    return this.config.platforms.map((p) => ({
      id: p.id,
      name: p.name,
      enabled: p.enabled,
      baseUrl: p.baseUrl,
      trustRemoteCredentials: p.trustRemoteCredentials,
      health: this.bridge.health.get(p.id),
    }));
  }
  profile(id) {
    const p = this.config.platforms.find((x) => x.id === id && x.enabled);
    if (!p) throw Error("该平台已停用或不存在");
    return p;
  }
  variables(id, input = {}) {
    return {
      query: "",
      id: "",
      page: 1,
      limit: 30,
      offset: 0,
      uid: this.store.credential(id).uid || "",
      duration: 0,
      albumId: "",
      albumAudioId: "",
      mediaId: "",
      freePart: 1,
      ...input,
      numericId: Number(input.id) || 0,
      metingPlatform: id === "qq" ? "tencent" : id,
      ...(QUALITY[input.quality || this.store.data.settings.quality] ||
        QUALITY.high),
    };
  }
  async search({
    query,
    kind = "song",
    platform = "all",
    page = 1,
    limit = 30,
  }) {
    if (!String(query).trim()) return { items: [], errors: [], hasMore: false };
    if (!["song", "artist", "album", "playlist", "lyric"].includes(kind))
      throw Error("搜索类型不正确");
    limit = Math.min(60, Math.max(1, Number(limit) || 30));
    page = Math.min(100, Math.max(1, Number(page) || 1));
    const selected = this.config.platforms.filter(
      (p) => p.enabled && (platform === "all" || platform === p.id),
    );
    const results = await Promise.allSettled(
      selected.map(async (p) => {
        const vars = this.variables(p.id, {
          query: String(query).slice(0, 200),
          page,
          limit,
          offset: (page - 1) * limit,
          type: p.searchTypes[kind],
        });
        if (p.id === "kugou") await this.bridge.ensureKugouDevice();
        let primaryError;
        try {
          const body = await this.bridge.call(p, "search", vars);
          return extractList(
            body,
            p,
            "search",
            kind === "lyric" ? "song" : kind,
          );
        } catch (e) {
          primaryError = e;
        }
        for (const fallback of p.routes.search.fallbacks || []) {
          if (!fallback.kinds?.includes(kind)) continue;
          try {
            const profile = { ...p, routes: { ...p.routes, search: fallback } };
            const body = await this.bridge.call(profile, "search", vars);
            if (fallback.deriveRelated && ["artist", "album"].includes(kind)) {
              const rows = arrayAt(body, fallback.items);
              const related = rows.flatMap((r) =>
                kind === "artist"
                  ? r.singer || r.singers || []
                  : [
                      {
                        id: r.albummid || r.album?.mid,
                        name: r.albumname || r.album?.name,
                        cover:
                          r.album?.picUrl ||
                          `https://y.gtimg.cn/music/photo_new/T002R300x300M000${r.albummid || r.album?.mid}.jpg`,
                        singer: r.singer,
                      },
                    ],
              );
              return related
                .map((r) => {
                  const entity = normalizeEntity(r, p.id, kind);
                  entity.meta.searchDerived = true;
                  return entity;
                })
                .filter((x) => x.id && x.id !== "undefined");
            }
            const items = extractList(body, profile, "search", "song");
            if (items.length) return items;
          } catch {}
        }
        throw primaryError;
      }),
    );
    const items = [],
      errors = [];
    let hasMore = false;
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === "fulfilled") {
        items.push(...r.value);
        if (r.value.length >= limit) hasMore = true;
      } else
        errors.push({
          platform: selected[i].id,
          message: r.reason?.message || "请求失败",
        });
    }
    const unique = [...new Map(items.map((x) => [x.key, x])).values()];
    const mixed = [];
    const groups = selected.map((p) =>
      unique.filter((x) => x.platform === p.id),
    );
    for (let n = 0; n < Math.max(0, ...groups.map((g) => g.length)); n++)
      for (const group of groups) if (group[n]) mixed.push(group[n]);
    return { items: mixed, errors, hasMore };
  }
  async browse(
    platform,
    op,
    { id, page = 1, limit = 40, kind, query = "" } = {},
  ) {
    const p = this.profile(platform);
    const vars = this.variables(platform, {
      id,
      page,
      limit,
      query,
      offset: (page - 1) * limit,
    });
    if (platform === "kugou") await this.bridge.ensureKugouDevice();
    let body,
      used = p,
      derived = false;
    try {
      body = await this.bridge.call(p, op, vars);
    } catch (primary) {
      let success = false;
      for (const fallback of p.routes[op]?.fallbacks || []) {
        if (!query) continue;
        try {
          used = { ...p, routes: { ...p.routes, [op]: fallback } };
          body = await this.bridge.call(used, op, vars);
          derived = !!fallback.derived;
          success = true;
          break;
        } catch {}
      }
      if (!success) throw primary;
    }
    const items = extractList(
      body,
      used,
      op,
      kind ||
        (["charts"].includes(op)
          ? "chart"
          : ["recommend", "userPlaylists"].includes(op)
            ? "playlist"
            : "song"),
    );
    if (derived) items.forEach((x) => (x.meta.searchDerived = true));
    return {
      items,
      hasMore:
        !(op === "album" && platform !== "kugou") && items.length >= limit,
      errors: [],
    };
  }
  async platformLyrics(track) {
    const p = this.profile(track.platform);
    let b;
    try {
      b = await this.bridge.call(
        p,
        p.routes.lyricsWord && !p.routes.lyrics.lyricPaths
          ? "lyricsWord"
          : "lyrics",
        this.variables(track.platform, {
          id: track.id,
          query: `${track.title} ${track.artist}`,
          duration: Math.round(track.duration * 1000),
        }),
      );
    } catch (e) {
      if (track.platform === "qq" && !p.baseUrl) b = {};
      else
        b = await this.bridge.call(
          p,
          "lyrics",
          this.variables(track.platform, {
            id: track.id,
            query: `${track.title} ${track.artist}`,
            duration: Math.round(track.duration * 1000),
          }),
        );
    }
    if (
      track.platform === "netease" &&
      !p.routes.lyrics.lyricPaths &&
      !b.yrc?.lyric &&
      !b.lrc?.lyric
    )
      b = await this.bridge.call(
        p,
        "lyrics",
        this.variables(track.platform, { id: track.id }),
      );
    let original = "",
      translation = "",
      romanization = "",
      timed = "",
      format = "yrc",
      lines;
    const mapping = p.routes.lyrics.lyricPaths;
    if (mapping) {
      original = first(b, mapping.original || [], "");
      translation = first(b, mapping.translation || [], "");
      romanization = first(b, mapping.romanization || [], "");
      timed = first(b, mapping.timed || [], "");
      format = p.routes.lyrics.lyricFormat || "yrc";
      const ttml = first(b, mapping.ttml || [], "");
      if (ttml) lines = parseTtml(ttml);
    } else if (track.platform === "netease") {
      original = b.lrc?.lyric || "";
      translation = b.tlyric?.lyric || "";
      romanization = b.yromalrc?.lyric || b.romalrc?.lyric || "";
      timed = b.yrc?.lyric || "";
      translation = b.ytlrc?.lyric || translation;
    } else if (track.platform === "qq") {
      original = first(b, ["lyric", "data.lyric"], "");
      translation = first(b, ["trans", "translyric", "data.trans"], "");
      const decode = (v) => {
        if (!v || String(v).includes("[") || String(v).includes("\n")) return v;
        try {
          return Buffer.from(v, "base64").toString("utf8");
        } catch {
          return v;
        }
      };
      original = decode(original);
      translation = decode(translation);
      if (!p.baseUrl)
        try {
          let songID = Number(
            track.meta?.songId || (/^\d+$/.test(track.id) ? track.id : 0),
          );
          if (!songID) {
            const d = await jsonRequest(
              "https://u.y.qq.com/cgi-bin/musicu.fcg",
              {
                method: "POST",
                body: {
                  req: {
                    module: "music.pf_song_detail_svr",
                    method: "get_song_detail_yqq",
                    param: { song_mid: track.id },
                  },
                },
              },
            );
            songID = Number(d.req?.data?.track_info?.id);
          }
          if (songID) {
            const d = await jsonRequest(
              "https://u.y.qq.com/cgi-bin/musicu.fcg",
              {
                method: "POST",
                headers: { Referer: "https://y.qq.com/" },
                body: {
                  comm: { ct: 19, cv: 1859, uin: "0" },
                  req: {
                    module: "music.musichallSong.PlayLyricInfo",
                    method: "GetPlayLyricInfo",
                    param: { songID, qrc: 1, trans: 1, roma: 1, crypt: 1 },
                  },
                },
              },
            );
            const q = d.req?.data;
            if (q?.lyric) {
              lines = parseQrcXml(decryptQrc(q.lyric)).filter((l) =>
                Number.isFinite(l.start),
              );
              if (q.trans)
                try {
                  translation = decryptQrc(q.trans);
                } catch {}
              if (q.roma)
                try {
                  romanization = decryptQrc(q.roma);
                } catch {}
            }
          }
        } catch {}
    } else {
      const candidate = first(b, ["candidates.0", "data.candidates.0"], null);
      if (candidate) {
        let raw = await this.bridge.native("kugou", "lyric", {
          id: candidate.id,
          accesskey: candidate.accesskey,
          fmt: "krc",
          decode: true,
        });
        const body = unwrap(raw);
        timed = body.decodeContent || "";
        format = "krc";
        if (!/^\[\d+,\d+\]/m.test(timed)) {
          timed = "";
          raw = await this.bridge.native("kugou", "lyric", {
            id: candidate.id,
            accesskey: candidate.accesskey,
            fmt: "lrc",
            decode: true,
          });
        }
        if (timed) {
          try {
            const language = JSON.parse(
              Buffer.from(
                timed.match(/\[language:([^\]]+)\]/)?.[1] || "",
                "base64",
              ).toString("utf8"),
            );
            const trans = language.content?.find(
              (x) => x.type === 1,
            )?.lyricContent;
            if (trans) {
              const starts = [...timed.matchAll(/^\[(\d+),\d+\]/gm)];
              translation = trans
                .map((x, i) => {
                  const n = Number(starts[i]?.[1] || 0);
                  return `[${Math.floor(n / 60000)}:${((n % 60000) / 1000).toFixed(3)}]${x.join(" ")}`;
                })
                .join("\n");
            }
          } catch {}
        }
        original =
          unwrap(raw).decodeContent ||
          (unwrap(raw).content
            ? Buffer.from(unwrap(raw).content, "base64").toString("utf8")
            : "");
      } else original = first(b, ["lyric", "data.lyric"], "");
    }
    const doc = lyricDocument({
      original,
      translation,
      romanization,
      timed,
      format,
      lines,
      source: p.name + " · 平台歌词",
    });
    if (!doc.original) throw Error("当前歌曲没有可用歌词");
    return { ...doc, platform: track.platform };
  }
  async lyrics(track) {
    const source = this.store.data.settings.lyricSource || "auto";
    const key = source + ":" + track.platform + ":" + track.id,
      cached = this.lyricCache.get(key);
    if (cached && Date.now() - cached.time < 300000) return cached.doc;
    let doc, error;
    if (source !== "amll")
      try {
        doc = await this.platformLyrics(track);
      } catch (e) {
        error = e;
      }
    const custom = this.profile(track.platform).routes.lyrics.lyricPaths;
    if (
      source !== "platform" &&
      !custom &&
      ["netease", "qq"].includes(track.platform) &&
      (source === "amll" || !doc?.hasWordTiming)
    ) {
      try {
        const spec = this.config.lyricSources?.find((s) => s.id === "amll");
        const dir =
          spec?.directories?.[track.platform] ||
          (track.platform === "netease" ? "ncm-lyrics" : "qq-lyrics");
        const endpoint = spec
          ? renderTemplate(spec.url, {
              directory: dir,
              id: encodeURIComponent(track.id),
            })
          : `https://raw.githubusercontent.com/amll-dev/amll-ttml-db/refs/heads/main/${dir}/${encodeURIComponent(track.id)}.ttml`;
        const response = await request(endpoint, {
          timeout: Math.min(
            15000,
            Math.max(1000, Number(spec?.timeout) || 5000),
          ),
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw Error("AMLL 没有收录此歌曲");
        }
        const text = await response.text();
        if (text.length > 2 * 1024 * 1024) throw Error("歌词响应过大");
        const lines = parseTtml(text);
        if (!lines.length) throw Error("社区歌词没有可用时间信息");
        doc = {
          ...lyricDocument({ lines, source: "AMLL TTML DB · 社区逐字歌词" }),
          platform: track.platform,
        };
      } catch (e) {
        if (source === "amll") throw Error(errorMessage(e));
        error ||= e;
      }
    }
    if (!doc) throw Error(errorMessage(error, "当前歌曲没有可用歌词"));
    if (this.lyricCache.size > 100)
      this.lyricCache.delete(this.lyricCache.keys().next().value);
    this.lyricCache.set(key, { time: Date.now(), doc });
    return doc;
  }
  async resolve(track, quality = "high", purpose = "play") {
    const p = this.profile(track.platform);
    const errors = [];
    const vars = this.variables(track.platform, {
      ...track.meta,
      id: track.id,
      query: `${track.title} ${track.artist}`.trim(),
      quality,
      freePart: purpose === "play" ? 1 : 0,
    });
    let b;
    const route = p.routes[purpose === "download" ? "download" : "resolve"];
    const selected = this.store.data.settings.preferredResolver || "auto";
    if (["auto", "builtin"].includes(selected))
      try {
        if (track.platform === "kugou") await this.bridge.ensureKugouDevice();
        b = await this.bridge.call(
          p,
          purpose === "download" ? "download" : "resolve",
          vars,
        );
        const source =
          track.platform === "netease"
            ? Array.isArray(b.data)
              ? b.data[0]
              : b.data
            : b;
        let url =
          track.platform === "qq"
            ? first(
                b,
                [
                  `playUrl.${track.id}.url`,
                  `data.playUrl.${track.id}.url`,
                  "url",
                  "data.url",
                ],
                "",
              )
            : first(
                source,
                ["url.0", "url", "data.url.0", "data.url", "backup_url.0"],
                "",
              );
        if (route.urlPaths) url = first(b, route.urlPaths, "");
        if (Array.isArray(url)) url = url.find(httpUrl);
        if (!httpUrl(url) && !route.urlPaths) {
          for (const value of [
            source?.url,
            source?.data?.url,
            source?.backup_url,
          ]) {
            const candidate = Array.isArray(value)
              ? value.find(httpUrl)
              : value;
            if (httpUrl(candidate)) {
              url = candidate;
              break;
            }
          }
        }
        if (httpUrl(url)) {
          const detectedTrial =
            !!source?.freeTrialInfo ||
            Boolean(source?.is_free_part) ||
            Boolean(source?.data?.is_free_part);
          const flag = route.trialPaths
            ? first(b, route.trialPaths, false)
            : detectedTrial;
          const trial =
            !!flag && !["0", "false", "null"].includes(String(flag));
          if (purpose === "download" && trial)
            throw Error("当前仅提供试听片段");
          const br = Number(
            route.bitratePaths
              ? first(b, route.bitratePaths, 0)
              : first(
                  source,
                  ["br", "bitrate", "bitrate_in", "data.bitrate"],
                  0,
                ),
          );
          return {
            url: httpUrl(url),
            headers:
              track.platform === "qq" ? { Referer: "https://y.qq.com/" } : {},
            source: p.name + (p.baseUrl ? " · 自建接口" : " · 内置接口"),
            trial,
            quality: br
              ? `${Math.round(br > 5000 ? br / 1000 : br)} kbps`
              : QUALITY[quality]?.label || "源站音质",
            bytes: Number(
              route.sizePaths
                ? first(b, route.sizePaths, 0)
                : source?.size || 0,
            ),
          };
        }
        throw Error("音频地址为空，可能需要账号权限或接口已变化");
      } catch (e) {
        errors.push(`${p.name}：${e.message}`);
      }
    if (
      selected !== "builtin" &&
      (selected !== "auto" || this.store.data.settings.usePublicFallback)
    ) {
      for (const r of this.config.resolvers.filter(
        (x) =>
          x.enabled &&
          x.platforms.includes(track.platform) &&
          (selected === "auto" || selected === x.id),
      )) {
        try {
          const params = renderTemplate(r.params, vars);
          let url,
            size = 0,
            br = 0,
            trial = false;
          const timeout = Math.min(
            60000,
            Math.max(1000, Number(r.timeout) || 10000),
          );
          if (r.mode === "json") {
            const body = await jsonRequest(r.url, {
              params,
              headers: r.headers || {},
              timeout,
            });
            if (r.codePaths) {
              const code = first(body, r.codePaths, undefined);
              if (
                code === undefined ||
                !(r.successCodes || [200]).map(String).includes(String(code))
              )
                throw Error(`备用接口未成功返回 (${code ?? "无状态码"})`);
            }
            if (
              r.idPaths &&
              String(first(body, r.idPaths, "")) !== String(track.id)
            )
              throw Error("备用接口返回的歌曲 ID 不匹配");
            const flag = r.trialPaths
              ? first(body, r.trialPaths, false)
              : false;
            trial = !!flag && !["0", "false", "null"].includes(String(flag));
            if (purpose === "download" && trial)
              throw Error("当前备用接口仅提供试听片段");
            url = first(body, r.urlPaths || ["url"], "");
            size = Number(first(body, r.sizePaths || [], 0));
            br = Number(first(body, r.bitratePaths || [], 0));
            if (r.strictMatch) {
              const title = clean(first(body, r.titlePaths || [], ""));
              const artist = clean(first(body, r.artistPaths || [], ""));
              const match = (s) =>
                s.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
              if (
                match(title) !== match(track.title) ||
                match(artist) !== match(track.artist)
              )
                throw Error("候选音源名称或歌手不匹配，已拒绝");
            }
          } else {
            const response = await request(r.url, {
              params,
              headers: r.headers || {},
              timeout,
              redirect: "manual",
            });
            if (response.status >= 300 && response.status < 400)
              url = response.headers.get("location");
            await response.body?.cancel();
          }
          if (!httpUrl(url)) throw Error("没有返回音频地址");
          return {
            url: httpUrl(url),
            headers: {},
            source: r.name,
            trial,
            quality: br
              ? `${Math.round(br > 5000 ? br / 1000 : br)} kbps`
              : "音质待音频确认",
            bytes: size,
            unverifiedDuration: true,
          };
        } catch (e) {
          errors.push(`${r.name}：${e.message}`);
        }
      }
    }
    throw Error(
      errors.join("\n") || "所选备用音源不支持此平台或已停用，请在设置中切换",
    );
  }
  async auth(platform, action, sessionId) {
    if (action === "create") {
      const id = randomUUID();
      let state = { platform, createdAt: Date.now() },
        image;
      if (platform === "netease") {
        const key = first(
          unwrap(await this.bridge.native(platform, "login_qr_key")),
          ["data.unikey", "data.data.unikey", "unikey"],
          "",
        );
        if (!key) throw Error("未取得网易云登录二维码");
        state.key = key;
        image = await QRCode.toDataURL(
          `https://music.163.com/login?codekey=${key}`,
        );
      } else if (platform === "qq") {
        const b = unwrap(await this.bridge.native(platform, "getQQLoginQr"));
        if (!b.img) throw Error(b.error || "未取得 QQ 登录二维码");
        state.qrsig = b.qrsig;
        state.ptqrtoken = b.ptqrtoken;
        image = b.img;
      } else {
        await this.bridge.ensureKugouDevice();
        const b = unwrap(await this.bridge.native(platform, "login_qr_key"));
        state.key = first(b, ["data.qrcode", "qrcode", "data.key"], "");
        if (typeof state.key !== "string" || !state.key)
          throw Error(errorMessage(b, "未取得酷狗登录二维码"));
        image = await QRCode.toDataURL(
          `https://h5.kugou.com/apps/loginQRCode/html/index.html?appid=1005&qrcode=${encodeURIComponent(state.key)}`,
        );
      }
      this.authSessions.set(id, state);
      return { sessionId: id, image, message: "请使用对应平台 App 扫码" };
    }
    if (action === "cancel") {
      this.authSessions.delete(sessionId);
      return { done: false };
    }
    const state = this.authSessions.get(sessionId);
    if (
      !state ||
      state.platform !== platform ||
      Date.now() - state.createdAt > 180000
    )
      throw Error("二维码已过期，请刷新");
    let b,
      cookie = "",
      uid = "",
      nickname = "";
    if (platform === "netease") {
      b = unwrap(
        await this.bridge.native(platform, "login_qr_check", {
          key: state.key,
        }),
      );
      if (Number(b.code) === 800) {
        this.authSessions.delete(sessionId);
        throw Error("二维码已失效");
      }
      if (Number(b.code) === 803) cookie = joinCookies(b.cookie || "");
    } else if (platform === "qq") {
      b = unwrap(
        await this.bridge.native(platform, "checkQQLoginQr", {
          qrsig: state.qrsig,
          ptqrtoken: state.ptqrtoken,
        }),
      );
      if (b.refresh) throw Error("二维码已失效，请刷新");
      if (b.isOk) cookie = b.session?.cookie || "";
    } else {
      const raw = await this.bridge.native(platform, "login_qr_check", {
        key: state.key,
      });
      b = unwrap(raw);
      if (Number(b.data?.status) === 0) throw Error("二维码已失效");
      if (Number(b.data?.status) === 4) {
        cookie = joinCookies(
          raw.cookie?.length
            ? raw.cookie
            : [`token=${b.data.token}`, `userid=${b.data.userid}`],
        );
        uid = String(b.data.userid || "");
        nickname = b.data.nickname || "";
      }
    }
    if (cookie) {
      this.authSessions.delete(sessionId);
      const info = await this.accountInfo(platform, cookie, uid);
      const accounts = this.store.saveAccount({
        platform,
        cookie,
        uid: info.uid || uid,
        nickname: info.nickname || nickname,
        verified: info.verified,
      });
      return {
        done: true,
        accounts,
        message: info.verified
          ? "登录成功"
          : "已保存登录凭据，可在账号中补充用户 ID",
      };
    }
    return {
      done: false,
      message:
        typeof b?.message === "string"
          ? b.message
          : Number(b?.data?.status) === 2
            ? "扫码成功，请在酷狗 App 确认登录"
            : "等待扫码或手机确认",
    };
  }
  async accountInfo(platform, cookie, uid = "") {
    const c = parseCookie(cookie);
    let nickname = "";
    let verified = false;
    uid = String(uid || c.userid || c.uin || c.wxuin || "").replace(/^o/, "");
    try {
      const sdk = await import("./engines.mjs").then((x) => x.engine(platform));
      let b;
      if (platform === "netease") {
        b = unwrap(await sdk.login_status({ cookie }));
        const profile = b.data?.profile || b.profile;
        if (profile) {
          uid = String(profile.userId);
          nickname = profile.nickname;
          verified = true;
        }
      } else if (platform === "kugou") {
        b = unwrap(
          await sdk.user_detail({
            cookie: { ...this.store.data.device, ...c },
            userid: uid,
          }),
        );
        if (b.status === 1 && b.data) {
          nickname = first(
            b,
            ["data.nickname", "data.user_name", "data.nick_name"],
            "",
          );
          verified = !!nickname;
        }
      } else {
        b = unwrap(await sdk.getUserDetail({ uin: uid, cookie }));
        nickname = first(b, ["data.nickname", "nickname", "creator.nick"], "");
        verified = !!nickname;
      }
    } catch {}
    return {
      uid,
      nickname:
        nickname ||
        `${platform === "netease" ? "网易云" : platform === "qq" ? "QQ 音乐" : "酷狗"}用户 ${uid}`,
      verified,
    };
  }
}
