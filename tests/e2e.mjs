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
const song = (p, n = 1) => ({
  id: p + "-song-" + n,
  name: "测试音轨 " + n,
  artist: "Sonora Test",
  album: { name: "Validation Album", picUrl: base + "/cover" },
  duration: 2,
});
const config = JSON.parse(fs.readFileSync("profiles/providers.json", "utf8"));
const server = http.createServer((req, res) => {
  const u = new URL(req.url, base || "http://localhost");
  const p = u.searchParams.get("platform") || "netease";
  const op = u.pathname;
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
    r.params = { platform: p.id, id: "{id}", type: "{type}" };
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
const errors = [];
let checks = 0;
try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await expect(page.locator(".chart-card")).toHaveCount(3);
  checks++;
  await page.getByRole("button", { name: "搜索资源", exact: true }).click();
  await page.getByRole("textbox", { name: "搜索音乐资源" }).fill("测试");
  await page.getByRole("textbox", { name: "搜索音乐资源" }).press("Enter");
  await expect(page.locator(".track-row")).toHaveCount(6);
  assert.equal(
    await page.locator(".track-row .platform-badge.netease").count(),
    2,
  );
  assert.equal(await page.locator(".track-row .platform-badge.qq").count(), 2);
  assert.equal(
    await page.locator(".track-row .platform-badge.kugou").count(),
    2,
  );
  checks++;
  await page.getByRole("button", { name: "专辑", exact: true }).click();
  await expect(page.locator(".music-card")).toHaveCount(3);
  await page.locator(".music-card").first().click();
  await expect(page.locator(".track-row")).toHaveCount(2);
  checks++;
  await page
    .locator(".track-row")
    .first()
    .getByRole("button", { name: "播放 测试音轨 1", exact: true })
    .click();
  await expect
    .poll(() => page.locator("audio").evaluate((el) => el.currentTime))
    .toBeGreaterThan(0.05);
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await expect
    .poll(() => page.locator("audio").evaluate((el) => el.paused))
    .toBe(true);
  checks++;
  await page
    .locator(".track-row")
    .first()
    .getByRole("button", { name: "查看 测试音轨 1 歌词" })
    .click();
  await expect(page.locator(".lyric-preview")).toContainText("声屿测试音轨");
  const lyricFile = path.join(dir, "saved.lrc");
  await app.evaluate(({ dialog }, filename) => {
    dialog.showSaveDialog = async () => ({
      canceled: false,
      filePath: filename,
    });
  }, lyricFile);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存歌词", exact: true })
    .click();
  await expect.poll(() => fs.existsSync(lyricFile)).toBe(true);
  assert(fs.readFileSync(lyricFile, "utf8").includes("本地生成"));
  assert.match(fs.readFileSync(lyricFile, "utf8"), /\[00:00.000\]Test track/);
  assert.match(fs.readFileSync(lyricFile, "utf8"), /<00:00.400>/);
  checks++;
  const ttmlFile = path.join(dir, "saved.ttml");
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, ttmlFile);
  await page.getByLabel("歌词导出格式").selectOption("ttml");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存歌词", exact: true })
    .click();
  await expect.poll(() => fs.existsSync(ttmlFile)).toBe(true);
  assert.match(fs.readFileSync(ttmlFile, "utf8"), /ttm:role="x-translation"/);
  assert.match(fs.readFileSync(ttmlFile, "utf8"), /begin="00:00:00.400"/);
  checks++;
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  checks++;
  await page
    .locator(".track-row")
    .first()
    .getByRole("button", { name: "下载 测试音轨 1", exact: true })
    .click();
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const b = await window.sonora.bootstrap();
          return b.downloads.filter((j) => j.status === "completed").length;
        }),
      { timeout: 15000 },
    )
    .toBe(1);
  const state = await page.evaluate(() => window.sonora.bootstrap());
  const downloaded = fs.readFileSync(state.downloads[0].path);
  let dataOffset = 12;
  while (downloaded.subarray(dataOffset, dataOffset + 4).toString() !== "data")
    dataOffset +=
      8 +
      downloaded.readUInt32LE(dataOffset + 4) +
      (downloaded.readUInt32LE(dataOffset + 4) % 2);
  assert.deepEqual(
    downloaded.subarray(dataOffset + 8, dataOffset + 8 + 32000),
    audio.subarray(44),
  );
  assert.equal(state.downloads[0].metadata.status, "written");
  assert.equal(state.library.length, 1);
  assert.match(state.library[0].cover, /^sonora-media:\/\/cover\//);
  const downloadedTags = await page.evaluate(async () => {
    const b = await window.sonora.bootstrap();
    return (await window.sonora.tagRead(b.library[0].id)).tags;
  });
  assert.equal(downloadedTags.title, "测试音轨 1");
  assert.equal(downloadedTags.year, 2020);
  assert.equal(downloadedTags.track, 3);
  assert.equal(downloadedTags.discCount, 2);
  assert.equal(downloadedTags.genre, "J-Pop");
  assert.equal(downloadedTags.composer, "Fixture Composer");
  assert.equal(downloadedTags.isrc, "TEST26000001");
  const localDoc = await page.evaluate(async () => {
    const b = await window.sonora.bootstrap();
    return window.sonora.lyrics(b.library[0]);
  });
  assert(localDoc.hasWordTiming);
  assert.match(localDoc.translation, /Test track/);
  assert(localDoc.lines[0].words.length);
  checks++;
  const embedded = await page.evaluate(async () => {
    const b = await window.sonora.bootstrap();
    return (await window.sonora.tagRead(b.library[0].id)).lyrics;
  });
  assert.equal(state.downloads[0].metadata.lyrics, "embedded");
  assert.match(embedded, /<00:00.400>/);
  assert.match(embedded, /\[00:00.000\]Test track/);
  assert.deepEqual(fs.readdirSync(path.dirname(state.downloads[0].path)), [
    path.basename(state.downloads[0].path),
  ]);
  checks++;
  checks++;
  checks++;
  await page
    .getByRole("button", { name: "下载中心", exact: false })
    .first()
    .click();
  await expect(page.locator(".download-row.completed")).toHaveCount(1);
  checks++;
  await page.getByRole("button", { name: "本地音乐", exact: true }).click();
  await expect(page.locator(".track-row")).toHaveCount(1);
  await page
    .locator(".track-row")
    .first()
    .getByRole("button", { name: "收藏本地歌曲" })
    .click();
  await expect(page.locator(".track-row .liked")).toHaveCount(1);
  checks++;
  await app.evaluate(({ dialog }, filename) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [filename],
    });
  }, fixture);
  await page.getByRole("button", { name: "导入音乐", exact: true }).click();
  await expect(page.locator(".track-row")).toHaveCount(2);
  checks++;
  await page
    .locator(".track-row")
    .first()
    .getByLabel(/^更多 .* 操作$/)
    .click();
  await page
    .locator(".track-row")
    .first()
    .getByRole("button", { name: "移除音乐库记录" })
    .click();
  await expect(page.locator(".track-row")).toHaveCount(1);
  assert(fs.existsSync(fixture));
  checks++;
  await page.locator(".track-row .track-index").first().click();
  await expect
    .poll(() => page.locator("audio").evaluate((a) => a.currentTime))
    .toBeGreaterThan(0.05);
  await page.getByRole("button", { name: /^编辑 .* 标签$/ }).click();
  const editor = page.getByRole("dialog", { name: "编辑音乐标签" });
  await expect(editor.getByLabel("标签曲名", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')),
    )
    .toBe(true);
  await editor.getByRole("button", { name: "取消", exact: true }).focus();
  await page.keyboard.press("Tab");
  assert(
    await page.evaluate(
      () => !!document.activeElement?.closest('[role="dialog"]'),
    ),
  );
  checks++;
  await editor.getByLabel("标签曲名", { exact: true }).fill("本地标签已修改");
  await editor.getByLabel("标签专辑", { exact: true }).fill("手动专辑");
  await editor.getByRole("button", { name: "在线匹配", exact: true }).click();
  for (const source of ["netease", "qq", "kugou", "musicbrainz", "lrclib"]) {
    await editor
      .getByLabel("标签匹配来源", { exact: true })
      .selectOption(source);
    await editor.getByRole("button", { name: "搜索", exact: true }).click();
    await expect(editor.locator(".tag-candidate").first()).toBeVisible();
    await expect(editor.locator(".tag-candidate").first()).toContainText(
      {
        netease: "网易云",
        qq: "QQ 音乐",
        kugou: "酷狗",
        musicbrainz: "MusicBrainz",
        lrclib: "LRCLIB",
      }[source],
    );
    if (source === "musicbrainz")
      await editor
        .getByRole("button", { name: "采用封面", exact: true })
        .first()
        .click();
  }
  await editor
    .getByRole("button", { name: "获取歌词", exact: true })
    .first()
    .click();
  await expect(
    editor.getByLabel("内嵌歌词内容", { exact: true }),
  ).toContainText("LRCLIB fixture lyrics");
  await editor
    .getByLabel("内嵌歌词内容", { exact: true })
    .fill("[00:00.000]手动修改后的内嵌歌词");
  await editor.getByRole("button", { name: "在线匹配", exact: true }).click();
  await editor
    .getByLabel("标签匹配来源", { exact: true })
    .selectOption("netease");
  await editor.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(editor.locator(".tag-candidate").first()).toContainText(
    "网易云",
  );
  await editor
    .getByRole("button", { name: "获取歌词", exact: true })
    .first()
    .click();
  await expect(
    editor.getByLabel("内嵌歌词内容", { exact: true }),
  ).toContainText("Test track");
  await editor.getByRole("button", { name: "在线匹配", exact: true }).click();
  await editor
    .getByRole("button", { name: "采用标签", exact: true })
    .first()
    .click();
  await expect(editor.getByLabel("标签年份", { exact: true })).toHaveValue(
    "2020",
  );
  await expect(editor.getByLabel("标签流派", { exact: true })).toHaveValue(
    "J-Pop",
  );
  await expect(editor.getByLabel("标签曲序", { exact: true })).toHaveValue("3");
  await expect(editor.getByLabel("标签总曲数", { exact: true })).toHaveValue(
    "12",
  );
  await expect(editor.getByLabel("标签碟序", { exact: true })).toHaveValue("2");
  await expect(editor.getByLabel("标签总碟数", { exact: true })).toHaveValue(
    "2",
  );
  await expect(editor.getByLabel("标签作曲", { exact: true })).toHaveValue(
    "Fixture Composer",
  );
  await expect(editor.getByLabel("标签ISRC", { exact: true })).toHaveValue(
    "TEST26000001",
  );
  await editor.getByLabel("标签曲名", { exact: true }).fill("本地标签已修改");
  await editor.getByRole("button", { name: "内嵌歌词", exact: true }).click();
  await editor
    .getByLabel("内嵌歌词内容", { exact: true })
    .fill("[00:00.000]手动修改后的内嵌歌词");
  await page.screenshot({ path: "test-artifacts/tag-editor.png" });
  await editor.getByRole("button", { name: "保存到文件", exact: true }).click();
  await expect(
    editor.getByRole("button", { name: "保存到文件", exact: true }),
  ).toBeDisabled();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const s = await window.sonora.bootstrap();
        return s.library[0].title;
      }),
    )
    .toBe("本地标签已修改");
  const rawTags = await page.evaluate(async () => {
    const s = await window.sonora.bootstrap();
    return (await window.sonora.tagRead(s.library[0].id)).tags;
  });
  assert.equal(rawTags.comment, "");
  assert.equal(rawTags.year, 2020);
  assert.equal(rawTags.genre, "J-Pop");
  assert.equal(rawTags.track, 3);
  assert.equal(rawTags.trackCount, 12);
  assert.equal(rawTags.disc, 2);
  assert.equal(rawTags.discCount, 2);
  assert.equal(rawTags.composer, "Fixture Composer");
  assert.equal(rawTags.isrc, "TEST26000001");
  await editor.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.locator(".track-row .artwork img")).toHaveCount(1);
  await expect
    .poll(() =>
      page
        .locator(".track-row .artwork img")
        .evaluate((img) => img.complete && img.naturalWidth > 0),
    )
    .toBe(true);
  await page
    .getByRole("button", { name: "编辑 本地标签已修改 标签", exact: true })
    .click();
  await editor.getByRole("button", { name: "内嵌歌词", exact: true }).click();
  await expect(editor.getByLabel("内嵌歌词内容", { exact: true })).toHaveValue(
    "[00:00.000]手动修改后的内嵌歌词",
  );
  const originalPath = await page.evaluate(
    async () => (await window.sonora.bootstrap()).library[0].path,
  );
  const originalBytes = fs.readFileSync(originalPath);
  await editor
    .getByLabel("内嵌歌词内容", { exact: true })
    .fill("[00:00.000]锁定后保留的编辑内容");
  if (process.platform === "win32") {
    const reader = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-File",
        path.resolve("tests/fixtures/hold-file.ps1"),
        "-FilePath",
        originalPath,
        "-Milliseconds",
        "15000",
      ],
      { windowsHide: true },
    );
    const closed = once(reader, "exit");
    try {
      const [ready] = await once(reader.stdout, "data");
      assert.match(String(ready), /LOCKED/);
      await editor
        .getByRole("button", { name: "保存到文件", exact: true })
        .click();
      await expect(editor.getByRole("alert")).toContainText("无法替换原文件");
      await expect(
        editor.getByLabel("内嵌歌词内容", { exact: true }),
      ).toHaveValue("[00:00.000]锁定后保留的编辑内容");
      assert(fs.readFileSync(originalPath).equals(originalBytes));
      await expect
        .poll(() => page.locator("audio").getAttribute("src"))
        .toContain("sonora-media:");
    } finally {
      reader.kill();
      await closed;
    }
    checks++;
  }
  const editedCopy = path.join(music, "edited-copy.wav");
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, editedCopy);
  await editor.getByRole("button", { name: "另存为副本", exact: true }).click();
  await expect.poll(() => fs.existsSync(editedCopy)).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        async () => (await window.sonora.bootstrap()).library.length,
      ),
    )
    .toBe(2);
  assert(fs.readFileSync(originalPath).equals(originalBytes));
  await editor.getByRole("button", { name: "内嵌歌词", exact: true }).click();
  await expect(editor.getByLabel("内嵌歌词内容", { exact: true })).toHaveValue(
    "[00:00.000]锁定后保留的编辑内容",
  );
  await expect(
    editor.getByRole("button", { name: "保存到文件", exact: true }),
  ).toBeDisabled();
  checks++;
  await editor.getByRole("button", { name: "关闭", exact: true }).click();
  checks += 6;
  await page.getByRole("button", { name: "偏好与音源", exact: true }).click();
  const autoTags = page.getByRole("switch", {
    name: "自动匹配并写入标签",
    exact: true,
  });
  await expect(autoTags).toHaveAttribute("aria-checked", "true");
  await autoTags.click();
  await expect
    .poll(() =>
      page.evaluate(
        async () => (await window.sonora.bootstrap()).settings.autoMetadata,
      ),
    )
    .toBe(false);
  await page.getByRole("button", { name: "本地音乐", exact: true }).click();
  await page.getByRole("button", { name: "偏好与音源", exact: true }).click();
  await expect(autoTags).toHaveAttribute("aria-checked", "false");
  await autoTags.click();
  await expect
    .poll(() =>
      page.evaluate(
        async () => (await window.sonora.bootstrap()).settings.autoMetadata,
      ),
    )
    .toBe(true);
  checks++;
  await page.getByLabel("使用的音源", { exact: true }).selectOption("builtin");
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          (await window.sonora.bootstrap()).settings.preferredResolver,
      ),
    )
    .toBe("builtin");
  await page.getByLabel("使用的音源", { exact: true }).selectOption("auto");
  await page.getByLabel("默认歌词格式", { exact: true }).selectOption("ttml");
  await expect
    .poll(() =>
      page.evaluate(
        async () => (await window.sonora.bootstrap()).settings.lyricFormat,
      ),
    )
    .toBe("ttml");
  checks++;
  const newFolder = path.join(dir, "chosen");
  fs.mkdirSync(newFolder);
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [folder],
    });
  }, newFolder);
  await page.getByRole("button", { name: "更改目录", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        async () => (await window.sonora.bootstrap()).settings.downloadDir,
      ),
    )
    .toBe(newFolder);
  checks++;
  await page
    .getByRole("combobox")
    .filter({ has: page.locator('option[value="dark"]') })
    .selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  checks++;
  await page.getByRole("button", { name: "平台账号", exact: true }).click();
  await page
    .getByRole("button", { name: "添加账号", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Cookie 导入", exact: true }).click();
  await expect(page.locator("textarea.masked")).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  checks++;
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.getTitle().includes("Sonora"))
      ?.setSize(1080, 780);
  });
  await page.getByRole("button", { name: "本地音乐", exact: true }).click();
  await page.screenshot({ path: "test-artifacts/e2e-narrow-dark.png" });
  checks++;

  await page
    .getByRole("button", { name: /^编辑 .* 标签$/ })
    .first()
    .click();
  const narrowEditor = page.getByRole("dialog", { name: "编辑音乐标签" });
  await expect(
    narrowEditor.getByLabel("标签曲名", { exact: true }),
  ).toBeVisible();
  const footer = await narrowEditor.locator(".tag-footer").boundingBox();
  const view = await page.evaluate(() => ({ h: innerHeight, w: innerWidth }));
  assert(footer && footer.y >= 0 && footer.y + footer.height <= view.h);
  const unobstructed = await page.evaluate(() => {
    const stack = document.querySelector(".toast-stack");
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = "验证提示不会遮挡保存及关闭按钮";
    stack.append(toast);
    const notice = stack.getBoundingClientRect();
    const controls = [
      document.querySelector(".tag-footer"),
      document.querySelector('[role="dialog"] .modal-heading button'),
    ];
    const clear = controls.every((control) => {
      const box = control.getBoundingClientRect();
      return (
        notice.right <= box.left ||
        notice.left >= box.right ||
        notice.bottom <= box.top ||
        notice.top >= box.bottom
      );
    });
    toast.remove();
    return clear;
  });
  assert(unobstructed, "Notifications must not cover dialog controls");
  await page.screenshot({
    path: "test-artifacts/tag-narrow-fixed.png",
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(narrowEditor).toHaveCount(0);
  checks++;
  await page.evaluate(() => document.querySelector("audio").pause());
  const downloadNav = page
    .getByRole("button", { name: "下载中心", exact: false })
    .first();
  await downloadNav.focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("heading", { name: /下载中心/ })).toBeVisible();
  assert(await page.locator("audio").evaluate((a) => a.paused));
  checks++;
  await page.getByRole("button", { name: "搜索资源", exact: true }).click();
  const searchBox = page.getByRole("textbox", {
    name: "搜索音乐资源",
    exact: true,
  });
  await searchBox.fill("慢速审查");
  searchDelay = 350;
  await page.getByRole("button", { name: "专辑", exact: true }).click();
  await page.getByRole("button", { name: "歌词搜索", exact: true }).click();
  await page.waitForTimeout(550);
  searchDelay = 0;
  await expect(page.locator(".track-row")).toHaveCount(0);
  await expect(page.locator(".music-card")).toHaveCount(0);
  checks++;
  await page.getByRole("button", { name: "偏好与音源", exact: true }).click();
  await page
    .getByLabel("信息密度", { exact: true })
    .selectOption("comfortable");
  await expect(page.locator(".app-shell")).not.toHaveClass(/compact-density/);
  await page.getByLabel("信息密度", { exact: true }).selectOption("compact");
  await expect(page.locator(".app-shell")).toHaveClass(/compact-density/);
  checks++;
  assert.deepEqual(errors, []);
  const encrypted = await app.evaluate(({ safeStorage }) => ({
    available: safeStorage.isEncryptionAvailable(),
    protected:
      safeStorage.encryptString("sonora-test-secret").toString("base64") !==
      "sonora-test-secret",
  }));
  assert(encrypted.available && encrypted.protected);
  checks++;
  const sdkProbe = await app.evaluate(async ({ app }) => {
    const require = process
      .getBuiltinModule("node:module")
      .createRequire(app.getAppPath() + "/package.json");
    const { runSdkRequest } = require("./main/providers/sdk-client.mjs");
    return runSdkRequest("netease", "song_detail", {}, { inspect: true });
  });
  assert(sdkProbe.available);
  checks++;
  console.log(
    JSON.stringify({
      ok: true,
      checks,
      rendererErrors: errors,
      downloadBytes: audio.length,
      fixtureProfile: profile,
    }),
  );
} finally {
  await app.close();
  server.close();
}
