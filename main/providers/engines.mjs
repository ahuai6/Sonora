import { QQ_FILES } from "./quality.mjs";
import { runSdkRequest } from "./sdk-client.mjs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { jsonRequest, deadline } from "../core/transport.mjs";
import { renderTemplate, unwrap, first } from "../core/models.mjs";
import { errorMessage } from "../core/errors.mjs";
const require = createRequire(import.meta.url);
const engines = new Map();
process.env.DEBUG = "false";
process.env.LOG_LEVEL = "error";
process.env.DOTENV_CONFIG_QUIET = "true";
export async function engine(id) {
  if (engines.has(id)) return engines.get(id);
  let v;
  if (id === "netease") v = require("@neteasecloudmusicapienhanced/api");
  else if (id === "kugou") v = require("kugoumusicapi");
  else if (id === "qq") v = await import("@sansenjian/qq-music-api/services");
  else throw Error(`未注册引擎：${id}`);
  engines.set(id, v);
  return v;
}
export class EngineBridge {
  async qqExtended(track, quality, { signal } = {}) {
    const prefix = QQ_FILES[quality];
    if (!prefix) throw Error("不支持的 QQ 音质");
    const { cookie, uid } = this.store.credential("qq"),
      parsed = parseCookie(cookie);
    const uin = String(uid || parsed.uin || parsed.wxuin || "0").replace(
      /^o/,
      "",
    );
    const filename =
      prefix + track.id + (track.meta?.mediaId || track.id) + ".flac";
    const body = await jsonRequest("https://u.y.qq.com/cgi-bin/musicu.fcg", {
      method: "POST",
      signal,
      headers: {
        Referer: "https://y.qq.com/",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: {
        comm: {
          ct: 24,
          cv: 0,
          uin,
          authst: parsed.qqmusic_key || parsed.p_skey || "",
        },
        req_0: {
          module: "vkey.GetVkeyServer",
          method: "CgiGetVkey",
          param: {
            guid: String(Math.floor(Math.random() * 1e10)),
            filename: [filename],
            songmid: [track.id],
            songtype: [0],
            uin,
            loginflag: 1,
            platform: "20",
          },
        },
      },
    });
    const data = body.req_0?.data,
      row = data?.midurlinfo?.[0];
    if (body.req_0?.code !== 0 || !row?.purl)
      throw Error("此 QQ 音质不可用，请检查歌曲发行规格、地区与账号权益");
    return {
      url: new URL(
        row.purl,
        data.sip?.find((x) => /^https?:/.test(x)) ||
          "https://isure.stream.qqmusic.qq.com/",
      ).href,
      requestedTier: quality,
    };
  }
  async verifyAccount(platform, cookie, uid, signal) {
    const module =
      platform === "netease"
        ? "login_status"
        : platform === "kugou"
          ? "user_detail"
          : "getUserDetail";
    const query =
      platform === "netease"
        ? { cookie, timeout: 16000 }
        : platform === "kugou"
          ? {
              cookie: { ...this.store.data.device, ...parseCookie(cookie) },
              userid: uid,
            }
          : { uin: uid, cookie };
    return runSdkRequest(platform, module, query, { signal, timeout: 18000 });
  }
  constructor(store) {
    this.store = store;
    this.health = new Map();
    this.inflightDevice = null;
  }
  async call(profile, op, vars = {}, { signal } = {}) {
    signal?.throwIfAborted();
    const route = profile.routes[op];
    if (!route) throw Error(`该平台未配置 ${op} 路由`);
    const credential = this.store.credential(profile.id);
    const device = profile.id === "kugou" ? this.store.data.device : {};
    let cookie = credential.cookie || "";
    if (profile.id === "kugou")
      cookie = {
        ...device,
        ...Object.fromEntries(
          cookie
            .split(";")
            .map((x) => x.trim().split(/=(.*)/s))
            .filter((x) => x[0])
            .map(([k, v]) => [k, v]),
        ),
      };
    const params = renderTemplate(route.params || {}, vars);
    const started = Date.now();
    let raw;
    try {
      if (profile.baseUrl) {
        const headers = renderTemplate(route.headers || {}, vars);
        if (credential.cookie && profile.trustRemoteCredentials)
          headers.Cookie = credential.cookie;
        raw = await jsonRequest(
          profile.baseUrl.replace(/\/$/, "") + route.path,
          {
            params:
              route.method === "POST"
                ? undefined
                : { ...params, timestamp: Date.now() },
            method: route.method || "GET",
            body: route.method === "POST" ? params : undefined,
            headers,
            signal,
          },
        );
      } else if (route.gateway) {
        const spec = renderTemplate(route.gateway, vars);
        let uin =
          credential.uid ||
          first(
            Object.fromEntries(
              (credential.cookie || "")
                .split(";")
                .map((x) => x.trim().split(/=(.*)/s)),
            ),
            ["uin", "wxuin"],
            "0",
          );
        uin = String(uin).replace(/^o/, "");
        const root = await jsonRequest(
          "https://u.y.qq.com/cgi-bin/musicu.fcg",
          {
            method: "POST",
            signal,
            headers: {
              Referer: "https://y.qq.com/",
              ...(credential.cookie ? { Cookie: credential.cookie } : {}),
            },
            body: {
              comm: {
                ct: 24,
                cv: 4747474,
                platform: "yqq.json",
                uin,
                format: "json",
                inCharset: "utf-8",
                outCharset: "utf-8",
                notice: 0,
                need_new_code: 1,
              },
              req_0: {
                module: spec.module,
                method: spec.method,
                param: spec.param,
              },
            },
          },
        );
        if (root.req_0?.code !== 0)
          throw Error(
            `QQ 上游拒绝请求 (${root.req_0?.code ?? root.code ?? "未知"})`,
          );
        raw = root.req_0.data;
        if (op === "search" && Number(raw?.meta?.is_filter) < 0)
          throw Error("QQ 搜索需要有效登录态，或当前请求被平台过滤");
      } else {
        const sdk = signal ? null : await engine(profile.engine);
        const fn = signal
          ? (query) =>
              runSdkRequest(profile.engine, route.module, query, { signal })
          : sdk[route.module];
        if (typeof fn !== "function")
          throw Error(`引擎缺少模块 ${route.module}，请检查接口配置`);
        raw = await deadline(
          profile.id === "qq"
            ? fn(
                route.flat
                  ? { ...params, cookie: credential.cookie }
                  : {
                      params,
                      option: {
                        timeout: 16000,
                        headers: credential.cookie
                          ? { Cookie: credential.cookie }
                          : {},
                      },
                      isFormat: false,
                    },
              )
            : fn({ ...params, cookie }),
          20000,
        );
      }
      let body = unwrap(raw);
      if (raw?.status >= 400) throw Error(`上游 HTTP ${raw.status}`);
      if (body?.error)
        throw Error(
          typeof body.error === "string" ? body.error : "平台接口返回错误",
        );
      if (body?.error_code && Number(body.error_code) !== 0)
        throw Error(
          `酷狗接口错误 ${body.error_code}，可能需要登录或刷新设备认证`,
        );
      if (
        body?.code !== undefined &&
        ![0, 1, 200, 800, 801, 802, 803].includes(Number(body.code))
      )
        throw Error(
          `上游错误 ${body.code}: ${String(body.message || body.msg || "请求被拒绝").slice(0, 100)}`,
        );
      this.health.set(profile.id, {
        ok: true,
        latency: Date.now() - started,
        checkedAt: Date.now(),
        message: "连接正常",
      });
      return body;
    } catch (e) {
      this.health.set(profile.id, {
        ok: false,
        latency: Date.now() - started,
        checkedAt: Date.now(),
        message: e.message || "接口暂不可用",
      });
      throw Error(errorMessage(e));
    }
  }
  async native(platform, module, params = {}, { signal } = {}) {
    signal?.throwIfAborted();
    const sdk = signal ? null : await engine(platform);
    const cookie = this.store.credential(platform).cookie;
    const opts =
      platform === "qq"
        ? { params, option: { headers: cookie ? { Cookie: cookie } : {} } }
        : {
            ...params,
            cookie:
              platform === "kugou"
                ? { ...this.store.data.device, ...parseCookie(cookie) }
                : cookie,
          };
    try {
      return signal
        ? await runSdkRequest(platform, module, opts, { signal })
        : await deadline(sdk[module](opts), 22000);
    } catch (e) {
      throw Error(errorMessage(e));
    }
  }
  async ensureKugouDevice({ signal } = {}) {
    if (this.store.data.device.dfid) return;
    if (signal) {
      const r = await this.native("kugou", "register_dev", {}, { signal });
      const dfid = first(unwrap(r), ["data.dfid", "dfid"], "");
      if (dfid) {
        this.store.data.device.dfid = dfid;
        this.store.save();
      }
      return;
    }
    this.inflightDevice ??= this.native("kugou", "register_dev")
      .then((r) => {
        const dfid = first(unwrap(r), ["data.dfid", "dfid"], "");
        if (dfid) {
          this.store.data.device.dfid = dfid;
          this.store.save();
        }
      })
      .catch(() => {})
      .finally(() => {
        this.inflightDevice = null;
      });
    await this.inflightDevice;
  }
}
export function parseCookie(cookie) {
  return Object.fromEntries(
    String(cookie || "")
      .split(";")
      .map((x) => x.trim().split(/=(.*)/s))
      .filter(([k, v]) => k && v !== undefined),
  );
}
export function joinCookies(items) {
  return [
    ...new Map(
      (Array.isArray(items) ? items : String(items || "").split(";"))
        .map((x) => String(x).split(";")[0].trim())
        .filter((x) => x.includes("="))
        .filter((x) => !/^(path|domain|expires|max-age|samesite)=/i.test(x))
        .map((x) => [x.split("=")[0], x]),
    ).values(),
  ].join("; ");
}
