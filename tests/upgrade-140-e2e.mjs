import { _electron as electron } from "playwright";
import { expect } from "@playwright/test";
import electronPath from "electron";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
fs.mkdirSync("test-artifacts", { recursive: true });
const dir = fs.mkdtempSync(path.resolve("test-artifacts/e2e-"));
const music = path.join(dir, "music");
fs.mkdirSync(music, { recursive: true });
const audio = Buffer.alloc(44 + 16000 * 2);
audio.write("RIFF");
audio.writeUInt32LE(audio.length - 8, 4);
audio.write("WAVEfmt ", 8);
audio.writeUInt32LE(16, 16);
audio.writeUInt16LE(1, 20);
audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(8000, 24);
audio.writeUInt32LE(16000, 28);
audio.writeUInt16LE(2, 32);
audio.writeUInt16LE(16, 34);
audio.write("data", 36);
audio.writeUInt32LE(32000, 40);
for (let i = 0; i < 16000; i++)
  audio.writeInt16LE(
    (Math.sin((i / 8000) * 440 * Math.PI * 2) * 1500) | 0,
    44 + i * 2,
  );
const fixture = path.join(dir, "fixture.wav");
fs.writeFileSync(fixture, audio);
const lrc = "[00:00.00]声屿测试音轨\n[00:01.00]本地生成的验证音频";
let base;
let searchDelay = 0;
let resolveMode = "success",
  resolvePending = false,
  releaseResolve;
let collectionProbe = false,
  collectionError = false;
const collectionPages = [];
const song = (p, n = 1) => ({
  id: p + "-song-" + n,
  name: "测试音轨 " + n,
  artist: "Sonora Test",
  album: { name: "Validation Album", picUrl: base + "/cover" },
  duration: 2,
});
const config = JSON.parse(fs.readFileSync("profiles/providers.json", "utf8"));
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, base || "http://localhost");
  const p = u.searchParams.get("platform") || "netease";
  const op = u.pathname;
  if (op === "/resolve" && resolveMode === "error") {
    res.statusCode = 503;
    return res.end("{}");
  }
  if (op === "/resolve" && resolveMode === "delay") {
    resolvePending = true;
    await new Promise((r) => (releaseResolve = r));
    resolvePending = false;
  }
  if (op === "/collection" && collectionProbe) {
    const n = Number(u.searchParams.get("page") || 1);
    collectionPages.push(n);
    if (n === 2 && collectionError) {
      res.statusCode = 503;
      return res.end("{}");
    }
    res.setHeader("Content-Type", "application/json");
    return res.end(
      JSON.stringify({
        items: Array.from({ length: n === 1 ? 50 : 1 }, (_, i) =>
          song(p, (n - 1) * 50 + i + 1),
        ),
      }),
    );
  }

  if (op === "/search" && searchDelay) {
    const end = res.end.bind(res),
      delay = searchDelay;
    res.end = (...args) => {
      setTimeout(() => end(...args), delay);
      return res;
    };
  }
  if (op === "/metadataDetail") {
    const song = {
      id: p + "-song-1",
      no: 3,
      cd: "02",
      publishTime: 1577836800000,
      genre: "J-Pop",
      composer: "Fixture Composer",
      isrc: "TEST26000001",
      al: { id: 9 },
    };
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ songs: [song], track_info: song, data: [song] }));
    return;
  }
  if (op === "/metadataAlbum") {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        album: {
          size: 12,
          disc_count: 2,
          publishTime: 1577836800000,
          artists: [{ name: "Fixture Album Artist" }],
        },
        songs: [],
      }),
    );
    return;
  }
  if (op === "/cover") {
    res.setHeader("Content-Type", "image/png");
    res.end(fs.readFileSync("build/icon.png"));
    return;
  }
  if (op === "/mb/recording") {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        recordings: [
          {
            id: "mb-recording",
            title: "公开数据库匹配",
            length: 2000,
            "artist-credit": [{ name: "Public Artist" }],
            releases: [
              { id: "mb-release", title: "Public Album", date: "2025-01-01" },
            ],
          },
        ],
      }),
    );
    return;
  }
  if (op === "/ca/release/mb-release") {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        images: [{ front: true, thumbnails: { large: base + "/cover" } }],
      }),
    );
    return;
  }
  if (op === "/lr/search") {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify([
        {
          id: 1,
          trackName: "公共歌词",
          artistName: "Public Artist",
          albumName: "Public Album",
          duration: 2,
          syncedLyrics: "[00:00]LRCLIB fixture lyrics",
        },
      ]),
    );
    return;
  }
  if (op === "/audio") {
    let start = 0,
      end = audio.length - 1,
      status = 200;
    const m = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
    if (m) {
      start = Number(m[1]);
      end = m[2] ? Math.min(end, Number(m[2])) : end;
      status = 206;
    }
    res.writeHead(status, {
      "Content-Type": "audio/wav",
      "Accept-Ranges": "bytes",
      "Content-Length": end - start + 1,
      ...(status === 206
        ? { "Content-Range": `bytes ${start}-${end}/${audio.length}` }
        : {}),
    });
    res.end(audio.subarray(start, end + 1));
    return;
  }
  let body = {};
  if (op === "/search") {
    const q = config.platforms.find((x) => x.id === p);
    const type = u.searchParams.get("type");
    const kind =
      Object.entries(q.searchTypes).find(
        ([k, v]) => String(v) === type && k !== "lyric",
      )?.[0] || "song";
    body = {
      items:
        kind === "song"
          ? [song(p), song(p, 2)]
          : [
              {
                id: p + "-" + kind,
                name:
                  "测试" +
                  { artist: "歌手", album: "专辑", playlist: "歌单" }[kind],
                artist: "Sonora Test",
              },
            ],
    };
  } else if (op === "/charts" || op === "/recommend")
    body = {
      items: [
        { id: p + "-playlist", name: p + " 测试歌单", artist: "Sonora Test" },
      ],
    };
  else if (op === "/collection") body = { items: [song(p), song(p, 2)] };
  else if (op === "/lyrics")
    body =
      p === "netease"
        ? {
            lrc: { lyric: lrc },
            yrc: {
              lyric:
                "[0,900](0,400,0)声屿(400,500,0)测试音轨\n[1000,900](1000,400,0)本地生成的(1400,500,0)验证音频",
            },
            ytlrc: { lyric: "[00:00]Test track\n[00:01]Generated audio" },
          }
        : { lyric: lrc };
  else if (op === "/resolve") {
    const url = base + "/audio";
    body =
      p === "netease"
        ? { data: [{ url, br: 128000 }] }
        : p === "qq"
          ? { playUrl: { [u.searchParams.get("id")]: { url } } }
          : { url: [url] };
  }
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
base = `http://127.0.0.1:${server.address().port}`;
config.metadataSources = {
  musicbrainz: base + "/mb",
  coverart: base + "/ca",
  lrclib: base + "/lr",
};
for (const p of config.platforms) {
  p.baseUrl = base;
  p.trustRemoteCredentials = false;
  for (const [op, r] of Object.entries(p.routes)) {
    r.path =
      op === "search"
        ? "/search"
        : op.startsWith("metadata")
          ? op === "metadataCredits"
            ? "/lyrics"
            : "/" + op
          : op === "charts"
            ? "/charts"
            : op === "recommend"
              ? "/recommend"
              : ["lyrics", "lyricsWord"].includes(op)
                ? "/lyrics"
                : ["resolve", "download"].includes(op)
                  ? "/resolve"
                  : "/collection";
    r.params = { platform: p.id, id: "{id}", type: "{type}", page: "{page}" };
    r.items = ["items"];
    delete r.fallbacks;
  }
}
const profile = path.join(dir, "profile");
fs.mkdirSync(profile);
fs.writeFileSync(path.join(profile, "providers.json"), JSON.stringify(config));
fs.writeFileSync(
  path.join(profile, "state.json"),
  JSON.stringify({
    acceptedDisclaimer: true,
    settings: { downloadDir: music, quality: "standard" },
    device: { dfid: "fixture", KUGOU_API_MID: "fixture" },
  }),
);
const env = { ...process.env, SONORA_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: process.env.SONORA_TEST_EXECUTABLE || electronPath,
  args: process.env.SONORA_TEST_EXECUTABLE
    ? [`--user-data-dir=${profile}`]
    : ["."],
  env,
});

const errors = [],
  passed = [];
try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await expect(page.locator(".chart-card")).toHaveCount(3);
  await page.evaluate(() =>
    window.sonora.saveSettings({
      preferredResolver: "builtin",
      usePublicFallback: false,
    }),
  );
  await page.getByRole("button", { name: "搜索资源", exact: true }).click();
  await page
    .getByRole("textbox", { name: "搜索音乐资源", exact: true })
    .fill("fixture");
  await page
    .getByRole("textbox", { name: "搜索音乐资源", exact: true })
    .press("Enter");
  await expect(page.locator(".track-row")).toHaveCount(6);
  const rows = page
    .locator(".track-row")
    .filter({ has: page.locator(".platform-badge.netease") });
  await rows
    .first()
    .getByRole("button", { name: "播放 测试音轨 1", exact: true })
    .click();
  await expect
    .poll(() => page.locator("audio").evaluate((a) => !a.paused))
    .toBe(true);
  await expect(page.getByLabel("当前实际音质")).toContainText("8 kHz");
  passed.push("measured quality visible");
  await page.locator("audio").evaluate((a) => {
    a.loop = true;
    a.pause();
  });
  resolveMode = "error";
  await rows
    .nth(1)
    .getByRole("button", { name: "播放 测试音轨 2", exact: true })
    .click();
  await expect(page.locator(".now-source")).toContainText("暂时无法播放");
  await page.locator(".play-main").click();
  await expect(page.locator(".play-main")).toBeEnabled();
  assert(
    await page
      .locator("audio")
      .evaluate((a) => a.paused && !a.getAttribute("src")),
  );
  passed.push("failed switch cannot replay old source");
  resolveMode = "delay";
  await rows
    .nth(1)
    .getByRole("button", { name: "播放 测试音轨 2", exact: true })
    .click();
  await expect.poll(() => resolvePending).toBe(true);
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press("Space");
  assert(await page.locator("audio").evaluate((a) => a.paused));
  passed.push("keyboard blocked during resolve");
  const volume = page.getByLabel("音量", { exact: true });
  await volume.focus();
  await page.keyboard.press("Home");
  for (let i = 0; i < 20; i++) await page.keyboard.press("ArrowRight");
  const requested = Number(await volume.inputValue());
  resolveMode = "success";
  releaseResolve();
  await expect(page.locator(".play-main")).toBeEnabled();
  assert(
    Math.abs(
      (await page.locator("audio").evaluate((a) => a.volume)) - requested,
    ) < 0.001,
  );
  passed.push("volume preserved across resolve");
  await page.locator("audio").evaluate((a) => a.pause());
  await page.getByLabel("切换播放队列").click();
  await expect(page.locator(".queue-entry")).toHaveCount(6);
  await page.getByLabel("下移 测试音轨 1").first().click();
  await page.getByRole("button", { name: "保存队列", exact: true }).click();
  const saved = await page.evaluate(() => window.sonora.workspace("queueLoad"));
  assert.equal(saved.queue.length, 6);
  assert.equal(saved.queue[1].title, "测试音轨 1");
  passed.push("queue reorder and save");
  await page.getByLabel("移除 测试音轨 1").first().click();
  await expect(page.locator(".queue-entry")).toHaveCount(5);
  passed.push("queue remove");
  await page.getByLabel("切换播放队列").click();
  collectionProbe = true;
  collectionError = true;
  await page.getByRole("button", { name: "发现音乐", exact: true }).click();
  await expect(page.locator(".chart-card")).toHaveCount(3);
  await page.locator(".chart-card").first().click();
  await expect(page.locator(".track-row")).toHaveCount(50);
  await page.getByRole("button", { name: "加载更多", exact: true }).click();
  await expect(page.locator(".error-notice")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "加载更多", exact: true }),
  ).toBeEnabled();
  collectionError = false;
  await page.getByRole("button", { name: "加载更多", exact: true }).click();
  await expect(page.locator(".track-row")).toHaveCount(51);
  assert.deepEqual(collectionPages, [1, 2, 2]);
  passed.push("collection failed page retries same page");
  await app.evaluate(({ session, app }) => {
    const require = process
      .getBuiltinModule("node:module")
      .createRequire(app.getAppPath() + "/package.json");
    require("./main/providers/engines.mjs").EngineBridge.prototype.verifyAccount =
      async () => ({ data: { nickname: "Fixture" } });
    const cookies = session.fromPartition("persist:sonora-login-qq").cookies;
    globalThis.originalCookies = cookies.get;
    cookies.get = async (options) => {
      globalThis.cookieFilter = options;
      return [
        { domain: ".qq.com", name: "qqmusic_key", value: "fixture" },
        { domain: ".qq.com", name: "uin", value: "123" },
      ];
    };
  });
  const login = await page.evaluate(() => window.sonora.openLogin("qq", true));
  assert.equal(login.accounts[0].verified, true);
  assert.equal(
    (await app.evaluate(() => globalThis.cookieFilter)).url,
    "https://y.qq.com/",
  );
  passed.push("parent-domain login cookies accepted");
  await app.evaluate(({ session }) => {
    session.fromPartition("persist:sonora-login-qq").cookies.get =
      globalThis.originalCookies;
  });
  await page.getByRole("button", { name: "偏好与音源", exact: true }).click();
  await page.getByLabel("网易云独立音质").selectOption("master");
  assert.equal(
    (await page.evaluate(() => window.sonora.bootstrap())).settings
      .qualityPreferences.netease,
    "master",
  );
  passed.push("extended quality persists");
  await page.getByLabel("网易云独立音质").selectOption("");
  passed.push("per-platform quality can follow default");
  await page
    .getByRole("button", { name: "备份与恢复中心", exact: true })
    .click();
  const tool = page.getByRole("dialog", { name: "音乐整理与恢复" });
  await expect(tool).toContainText("状态备份");
  await page.screenshot({
    path: path.join(dir, "recovery-light.png"),
    animations: "disabled",
  });
  passed.push("recovery center opens");
  await tool.getByRole("button", { name: "诊断预览", exact: true }).click();
  await expect(tool.locator("pre")).toContainText(
    JSON.parse(fs.readFileSync("package.json", "utf8")).version,
  );
  assert(!(await tool.locator("pre").innerText()).includes("qqmusic_key"));
  passed.push("redacted diagnostic preview");
  await tool.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "本地音乐", exact: true }).click();
  const local = path.join(music, "fixture.flac");
  fs.copyFileSync("tests/fixtures/tag-tone.flac", local);
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, local);
  await page.getByRole("button", { name: "导入音乐", exact: true }).click();
  await expect(page.locator(".track-row")).toHaveCount(1);
  await page
    .getByRole("button", { name: "批量标签与整理工具", exact: true })
    .click();
  await tool.getByLabel("批量匹配来源").selectOption("netease");
  await tool.getByRole("button", { name: "生成匹配预览", exact: true }).click();
  await expect(tool.locator(".tag-diff-grid")).toBeVisible();
  const prior = fs.readFileSync(local);
  assert.equal(
    (
      await page.evaluate(async () =>
        window.sonora.tagRead((await window.sonora.bootstrap()).library[0].id),
      )
    ).tags.title,
    "",
  );
  passed.push("batch preview does not write");
  await tool
    .locator(".tag-diff-grid label")
    .filter({ hasText: "title" })
    .getByRole("checkbox")
    .check();
  await tool
    .getByRole("button", { name: "写入所勾选的信息", exact: true })
    .click();
  await expect(tool).toContainText("已保存");
  assert.notDeepEqual(fs.readFileSync(local), prior);
  passed.push("selective batch write");
  await tool.getByRole("button", { name: "恢复中心", exact: true }).click();
  await expect(tool).toContainText("音频备份");
  await tool
    .locator(".tool-card")
    .filter({ hasText: "音频备份" })
    .getByRole("button", { name: "恢复", exact: true })
    .click();
  await tool
    .getByRole("button", { name: "确认恢复原音频", exact: true })
    .click();
  await expect.poll(() => fs.readFileSync(local).equals(prior)).toBe(true);
  passed.push("restore selected backup");
  await tool.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: /^编辑 .* 标签$/ }).click();
  const editor = page.getByRole("dialog", { name: "编辑音乐标签" });
  await editor.getByRole("button", { name: "内嵌歌词", exact: true }).click();
  await editor
    .getByLabel("内嵌歌词内容")
    .fill(
      "[00:00.000]<00:00.000>Hello <00:00.500>world<00:01.000>\n[00:00.000]你好世界",
    );
  await expect(editor.locator(".lyric-editor-preview")).toContainText(
    "真实逐字时间",
  );
  passed.push("lyric timeline preview");
  await editor
    .getByLabel("内嵌歌词内容")
    .fill("[00:02.000]later\n[00:01.000]earlier");
  await expect(editor.locator(".lyric-editor-preview")).toContainText(
    "行时间顺序错误",
  );
  passed.push("lyric timing validation");
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  await editor
    .getByRole("button", { name: "放弃修改并关闭", exact: true })
    .click();
  await page.getByRole("button", { name: "偏好与音源", exact: true }).click();
  await page.getByLabel("界面外观").selectOption("dark");
  await page
    .getByRole("button", { name: "备份与恢复中心", exact: true })
    .click();
  await page.screenshot({
    path: path.join(dir, "recovery-dark.png"),
    animations: "disabled",
  });
  passed.push("workbench dark theme");
  await tool.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "本地音乐", exact: true }).click();
  await page.locator(".track-row .track-index").first().click();
  await expect
    .poll(() => page.locator("audio").evaluate((a) => a.currentTime))
    .toBeGreaterThan(0.3);
  await page.locator(".play-main").click();
  await page.getByLabel("音量", { exact: true }).focus();
  await page.keyboard.press("Home");
  for (let i = 0; i < 25; i++) await page.keyboard.press("ArrowRight");
  await page.getByLabel("切换播放队列").click();
  await page.getByRole("button", { name: "保存队列", exact: true }).click();
  await page.reload();
  await expect(page.locator(".player-track strong")).toHaveText("fixture");
  assert(await page.locator("audio").evaluate((a) => a.paused));
  await page.locator(".play-main").click();
  await expect
    .poll(() => page.locator("audio").evaluate((a) => a.currentTime))
    .toBeGreaterThan(0.3);
  assert(
    Math.abs((await page.locator("audio").evaluate((a) => a.volume)) - 0.25) <
      0.001,
  );
  passed.push("saved queue and playback position restore without autoplay");
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ok: true,
      checks: passed.length,
      passed,
      rendererErrors: errors,
      artifacts: dir,
    }),
  );
} finally {
  if (resolvePending) releaseResolve();
  await app.close();
  server.close();
}
