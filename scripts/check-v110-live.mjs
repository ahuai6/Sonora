import fs from "node:fs";
import path from "node:path";
import { Store } from "../main/core/store.mjs";
import { ProviderRegistry } from "../main/providers/registry.mjs";
import { exportLyrics } from "../main/services/lyrics.mjs";
const registry = new ProviderRegistry(
  new Store(path.resolve("test-artifacts/v110-live")),
  path.resolve("profiles/providers.json"),
);
registry.store.data.settings.lyricSource = "platform";
for (const track of [
  {
    platform: "netease",
    id: "1824020871",
    title: "群青",
    artist: "YOASOBI",
    duration: 248,
  },
  {
    platform: "qq",
    id: "97773",
    title: "海阔天空",
    artist: "Beyond",
    meta: { songId: "97773" },
  },
  {
    platform: "kugou",
    id: "F8A7B1097086D5872EB4123B4F63A1B9",
    title: "海阔天空",
    artist: "BEYOND",
  },
]) {
  try {
    let song = track;
    if (track.platform === "kugou")
      song = (
        await registry.search({
          query: "海阔天空 Beyond",
          platform: "kugou",
          limit: 1,
        })
      ).items[0];
    const doc = await registry.lyrics(song),
      out = exportLyrics(doc, { format: "auto", bilingual: true });
    console.log(
      "lyrics",
      song.platform,
      JSON.stringify({
        lines: doc.lines.length,
        wordTiming: doc.hasWordTiming,
        translations: doc.lines.filter((x) => x.translation).length,
        extension: out.extension,
      }),
    );
  } catch (e) {
    console.log("lyrics", track.platform, e.message);
  }
}
for (const [name, url] of [
  [
    "Meting",
    "https://meting.imlam.com/api?server=netease&type=url&id=33894312&quality=standard",
  ],
  [
    "JerryMusicAPI",
    "https://music-api.jerrynis.com/api/song/url/v1?id=33894312&level=exhigh",
  ],
  [
    "Injahow",
    "https://api.injahow.cn/meting/?server=netease&type=url&id=33894312",
  ],
  ["Mxin", "https://meting.qjqq.cn/?server=netease&type=url&id=33894312"],
]) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) }),
      text = await r.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {}
    const audio =
      body?.data?.[0]?.url || body?.data?.url || body?.url || body?.[0]?.url;
    let valid = false;
    if (audio) {
      const a = await fetch(audio, {
        headers: { Range: "bytes=0-63" },
        signal: AbortSignal.timeout(10000),
      });
      const reader = a.body.getReader();
      const data = await reader.read();
      await reader.cancel();
      const bytes = Buffer.from(data.value || []);
      valid =
        bytes.subarray(0, 3).toString() === "ID3" ||
        bytes.subarray(0, 4).toString() === "fLaC" ||
        bytes.subarray(0, 4).toString() === "OggS" ||
        bytes[0] === 255;
    }
    console.log(
      "public",
      name,
      JSON.stringify({
        http: r.status,
        validAudio: valid,
        keys: body ? Object.keys(body) : [],
        code: body?.code,
      }),
    );
  } catch (e) {
    console.log("public", name, e.message);
  }
}
