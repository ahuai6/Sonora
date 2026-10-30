import { httpUrl, PLATFORMS } from "../core/models.mjs";
const object = (x) => x && typeof x === "object" && !Array.isArray(x);
export function validateProviderConfig(c) {
  if (
    !object(c) ||
    c.schemaVersion !== 1 ||
    !Array.isArray(c.platforms) ||
    !Array.isArray(c.resolvers)
  )
    throw Error("接口配置需要 schemaVersion=1、platforms 和 resolvers");
  const ids = new Set();
  for (const p of c.platforms) {
    if (
      !object(p) ||
      !PLATFORMS.includes(p.id) ||
      ids.has(p.id) ||
      !PLATFORMS.includes(p.engine) ||
      !object(p.routes) ||
      !object(p.searchTypes)
    )
      throw Error("平台 ID、引擎、路由或搜索类型配置不正确");
    ids.add(p.id);
    if (p.baseUrl && !httpUrl(p.baseUrl)) throw Error("接口基础地址不正确");
    for (const key of ["search", "lyrics", "resolve", "download"]) {
      if (!object(p.routes[key]))
        throw Error(`${p.id} 缺少必需路由 routes.${key}`);
    }
    for (const [name, r] of Object.entries(p.routes)) {
      if (
        !object(r) ||
        !(
          typeof r.module === "string" ||
          typeof r.path === "string" ||
          object(r.gateway)
        )
      )
        throw Error(`${p.id} 的 ${name} 路由缺少 module、path 或 gateway`);
      if (r.path && (typeof r.path !== "string" || !r.path.startsWith("/")))
        throw Error("路由 path 必须以 / 开头");
      if (r.method && !["GET", "POST"].includes(r.method))
        throw Error("仅支持 GET/POST 路由");
      for (const key of ["params", "headers", "metadataPaths", "lyricPaths"])
        if (r[key] !== undefined && !object(r[key]))
          throw Error(`${name}.${key} 必须为对象`);
    }
    if (p.searchTypes.song === undefined)
      throw Error(`${p.id} 缺少歌曲搜索类型`);
  }
  for (const r of c.resolvers)
    if (
      !object(r) ||
      !httpUrl(r.url) ||
      !["redirect", "json"].includes(r.mode) ||
      !Array.isArray(r.platforms)
    )
      throw Error("备用取链服务配置不正确");
  for (const s of c.lyricSources || [])
    if (!s.id || !httpUrl(s.url) || !object(s.directories))
      throw Error("社区歌词源配置不正确");
  for (const url of Object.values(c.metadataSources || {}))
    if (typeof url !== "string" || !httpUrl(url))
      throw Error("公开元数据库地址不正确");
}
