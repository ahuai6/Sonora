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
  name: ["夜航", "慢慢靠近", "Blue Hour", "午後散歩"][n % 4],
  artist: "Sonora Test",
  album: {
    name: "Night Window",
    picUrl: base + "/art?seed=" + (n + ["netease", "qq", "kugou"].indexOf(p)),
  },
  duration: 2,
});
const config = JSON.parse(fs.readFileSync("profiles/providers.json", "utf8"));
const server = http.createServer((req, res) => {
  const u = new URL(req.url, base || "http://localhost");
  const p = u.searchParams.get("platform") || "netease";
  const op = u.pathname;
  if (op === "/art") {
    const palettes = [
      ["#433d78", "#a39bdc"],
      ["#367d8c", "#9ec9bd"],
      ["#b27a68", "#f6d5aa"],
      ["#27445a", "#abc6dd"],
      ["#77627a", "#dcc4d4"],
      ["#445b67", "#88aeb6"],
    ];
    const i = Number(u.searchParams.get("seed") || 0) % 6,
      [a, b] = palettes[i];
    res.setHeader("Content-Type", "image/svg+xml");
    res.end(
      '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="' +
        a +
        '"/><stop offset="1" stop-color="' +
        b +
        '"/></linearGradient></defs><rect width="600" height="600" fill="url(#g)"/><circle cx="430" cy="170" r="240" fill="none" stroke="#ffffff20" stroke-width="70"/><circle cx="120" cy="500" r="190" fill="none" stroke="#ffffff16" stroke-width="30"/><path d="M-50 390Q190 100 660 420" stroke="#ffffff38" stroke-width="2" fill="none"/><text x="42" y="485" fill="#ffffffdc" font-family="sans-serif" font-size="36" letter-spacing="7">' +
        [
          "NIGHTFALL",
          "SOFT FOCUS",
          "AFTERGLOW",
          "BLUE HOUR",
          "IN BLOOM",
          "SLOW WAVES",
        ][i] +
        '</text><text x="45" y="530" fill="#ffffff90" font-family="sans-serif" font-size="13" letter-spacing="5">SONORA · SOUND COLLECTION</text></svg>',
    );
    return;
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
        ...Array.from({ length: op === "/charts" ? 1 : 3 }, (_, n) => ({
          id: p + "-playlist-" + n,
          name:
            op === "/charts"
              ? {
                  netease: "云音乐热歌榜",
                  qq: "流行音乐风向",
                  kugou: "酷狗飙升榜",
                }[p]
              : ["夜色温柔，旋律微醺", "留一点时间给自己", "把日常调成慢速"][n],
          artist: "Sonora Selection",
          picUrl:
            base +
            "/art?seed=" +
            ((n + ["netease", "qq", "kugou"].indexOf(p) * 2) % 6),
        })),
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

const errors = [],
  checks = [];
const shots = path.resolve("test-artifacts/glass-design");
fs.mkdirSync(shots, { recursive: true });
try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1440, 960),
  );
  const shot = async (name) => {
    await page.screenshot({
      path: path.join(shots, name + ".png"),
      animations: "disabled",
      scale: "css",
    });
  };
  await expect(page.locator(".music-card")).toHaveCount(8);
  await expect(page.locator(".chart-card")).toHaveCount(3);
  await expect(page.locator(".studio-header")).toHaveCSS(
    "backdrop-filter",
    /blur/,
  );
  checks.push("glass navigation and discovery shelves");
  await expect(page.locator(".sidebar,.discovery-hero")).toHaveCount(0);
  checks.push("freeform desk without sidebar or large banner");
  await page.getByLabel("换一个灵感歌单", { exact: true }).click();
  await expect(page.locator(".dial-glass")).toHaveAttribute(
    "style",
    /rotate\(73deg\)/,
  );
  checks.push("interactive discovery compass");
  await shot("01-discover-light");
  const stage = page.getByRole("group", { name: "可拖拽的唱片轨道" });
  const activeIndex = () =>
    page
      .locator(".orbit-record")
      .evaluateAll((cards) =>
        cards.findIndex((card) => card.dataset.active === "true"),
      );
  await stage.focus();
  await page.keyboard.press("Home");
  await expect.poll(activeIndex).toBe(0);
  await page.getByLabel("下一张唱片", { exact: true }).click();
  await expect.poll(activeIndex).toBe(1);
  await stage.focus();
  await page.keyboard.press("End");
  await expect.poll(activeIndex).toBe(7);
  await expect(page.getByLabel("下一张唱片", { exact: true })).toBeDisabled();
  await page.keyboard.press("Home");
  checks.push("record controls and keyboard boundaries");
  const bounds = await stage.boundingBox();
  await page.mouse.move(
    bounds.x + bounds.width * 0.65,
    bounds.y + bounds.height * 0.5,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width * 0.65 - 160,
    bounds.y + bounds.height * 0.5,
    { steps: 16 },
  );
  await page.mouse.up();
  await expect.poll(activeIndex).toBeGreaterThan(0);
  await expect(page.locator(".app-shell")).toHaveAttribute(
    "data-page",
    "discover",
  );
  checks.push("record drag selects without opening a playlist");
  await stage.focus();
  await page.keyboard.press("Home");
  await stage.hover();
  await page.mouse.wheel(80, 0);
  await expect.poll(activeIndex).toBe(1);
  checks.push("horizontal trackpad selects a record");
  await page.getByRole("button", { name: "打开歌单", exact: true }).click();
  await expect(page.locator(".track-row")).toHaveCount(2);
  checks.push("focused record opens its real collection");
  await page.getByRole("button", { name: "发现音乐", exact: true }).click();
  await expect(page.locator(".music-card")).toHaveCount(8);
  await page
    .getByRole("button", { name: "切换为深色模式", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(
    page.getByRole("button", { name: "切换为浅色模式", exact: true }),
  ).toBeVisible();
  checks.push("quick theme switch");
  await shot("02-discover-dark");
  await page.getByRole("button", { name: "搜索资源", exact: true }).click();
  await page.getByLabel("搜索音乐资源", { exact: true }).fill("夜航");
  await page.getByLabel("搜索音乐资源", { exact: true }).press("Enter");
  await expect(page.locator(".track-row")).toHaveCount(6);
  checks.push("aggregate search");
  await expect
    .poll(() =>
      page.locator(".navigation-ribbon").evaluate((nav) => {
        const active = nav
            .querySelector('[aria-current="page"]')
            .getBoundingClientRect(),
          lens = nav.querySelector(".navigation-lens").getBoundingClientRect();
        return (
          Math.abs(active.left - lens.left) +
          Math.abs(active.width - lens.width)
        );
      }),
    )
    .toBeLessThan(2);
  checks.push("navigation lens follows active destination");
  await page.locator(".track-index").first().click();
  await expect
    .poll(() => page.locator("audio").evaluate((a) => a.currentTime))
    .toBeGreaterThan(0.05);
  await expect(page.locator(".play-main")).toHaveCSS(
    "animation-name",
    "play-breathe",
  );
  await page.locator(".play-main").click();
  await expect(page.locator(".play-main")).toHaveCSS("animation-name", "none");
  checks.push("playback animation starts and stops with audio");
  await expect(page.getByLabel("当前实际音质")).toContainText("8 kHz");
  checks.push("player and measured quality");
  await shot("03-search-player-dark");
  await page
    .getByRole("button", { name: "切换为浅色模式", exact: true })
    .click();
  await shot("04-search-player-light");
  await page.getByLabel("切换播放队列").click();
  await expect(page.locator(".queue-entry")).toHaveCount(6);
  await shot("05-queue-light");
  await page.getByLabel("切换播放队列").click();
  checks.push("queue inspector");
  await page
    .getByRole("button", { name: "收起正在播放面板", exact: true })
    .click();
  await expect(page.locator(".now-playing")).toHaveCount(0);
  checks.push("inspector collapses without losing dock");
  const files = ["Night Window", "Blue Hour", "Soft Focus"].map((name, i) => {
    const file = path.join(music, name + ".flac");
    fs.copyFileSync("tests/fixtures/tag-tone.flac", file);
    return file;
  });
  await app.evaluate(({ dialog }, files) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files });
  }, files);
  await page.getByRole("button", { name: "本地音乐", exact: true }).click();
  await page.getByRole("button", { name: "导入音乐", exact: true }).click();
  await expect(page.locator(".track-row")).toHaveCount(3);
  await shot("06-library-light");
  checks.push("library import and layout");
  await page
    .getByRole("button", { name: /^编辑 .* 标签$/ })
    .first()
    .click();
  const editor = page.getByRole("dialog", { name: "编辑音乐标签" });
  await expect(editor.getByLabel("标签曲名", { exact: true })).toBeVisible();
  await shot("07-tag-editor-light");
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  checks.push("tag editor remains usable");
  await page.getByRole("button", { name: "平台账号", exact: true }).click();
  await expect(page.locator(".account-platform")).toHaveCount(3);
  await shot("08-accounts-light");
  checks.push("accounts");
  await page.getByRole("button", { name: "偏好与音源", exact: true }).click();
  await page.getByLabel("玻璃效果", { exact: true }).selectOption("reduced");
  await expect(page.locator("html")).toHaveAttribute("data-effects", "reduced");
  await expect(page.locator(".studio-header")).toHaveCSS(
    "backdrop-filter",
    "none",
  );
  checks.push("reduced transparency mode");
  await shot("09-settings-reduced");
  await page.getByLabel("动态效果", { exact: true }).selectOption("reduced");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  await expect(page.locator(".navigation-lens")).toHaveCSS(
    "transition-duration",
    "0s",
  );
  checks.push("user can reduce motion independently of glass");
  await page.getByLabel("动态效果", { exact: true }).selectOption("system");
  await page.getByLabel("玻璃效果", { exact: true }).selectOption("full");
  await page.getByLabel("界面外观", { exact: true }).selectOption("system");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(
    page.getByLabel("切换为浅色模式", { exact: true }),
  ).toBeVisible();
  await page.emulateMedia({ colorScheme: "light" });
  await expect(
    page.getByLabel("切换为深色模式", { exact: true }),
  ).toBeVisible();
  checks.push("system appearance keeps quick toggle synchronized");
  await page.getByLabel("界面外观", { exact: true }).selectOption("dark");
  await shot("10-settings-dark");
  await page
    .getByRole("button", { name: "备份与恢复中心", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "音乐整理与恢复" }),
  ).toContainText("状态备份");
  await shot("11-recovery-dark");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  checks.push("glass modal and recovery");
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1080, 740),
  );
  await page.getByRole("button", { name: "发现音乐", exact: true }).click();
  await expect(page.locator(".music-card")).toHaveCount(8);
  await expect(
    page.locator(".navigation-ribbon button span").first(),
  ).toBeHidden();
  await shot("12-discover-compact-dark");
  const overflow = await page.evaluate(() => ({
    root: document.documentElement.scrollWidth > innerWidth,
    shell: document.querySelector(".app-shell").scrollWidth > innerWidth,
  }));
  assert.equal(overflow.root, false);
  assert.equal(overflow.shell, false);
  checks.push("1080 by 740 adaptive ribbon without page overflow");
  await page.getByLabel("显示歌词面板", { exact: true }).click();
  await expect(page.locator(".now-playing")).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".now-playing")
        .evaluate((panel) => panel.getBoundingClientRect().right <= innerWidth),
    )
    .toBe(true);
  await shot("13-discover-compact-inspector");
  const widgetsOverlap = await page
    .locator(".frequency-body")
    .evaluate((body) => {
      const a = body.querySelector(".frequency-dial").getBoundingClientRect(),
        b = body.querySelector(".frequency-copy").getBoundingClientRect();
      return (
        a.left < b.right &&
        a.right > b.left &&
        a.top < b.bottom &&
        a.bottom > b.top
      );
    });
  assert.equal(widgetsOverlap, false);
  await page.getByLabel("收起正在播放面板", { exact: true }).click();
  await expect(page.locator(".now-playing")).toHaveCount(0);
  checks.push(
    "compact inspector opens and closes without hiding player controls",
  );
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press("Control+f");
  await expect(page.getByLabel("搜索音乐资源", { exact: true })).toBeFocused();
  checks.push("keyboard search shortcut");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".dial-glass")).toHaveCSS(
    "transition-duration",
    "0s",
  );
  await expect(page.locator(".orbit-record").first()).toHaveCSS(
    "transition-duration",
    "0s",
  );
  await stage.focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await expect.poll(activeIndex).toBe(1);
  checks.push("system reduced motion keeps selection functional");
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ok: true,
      checks: checks.length,
      passed: checks,
      rendererErrors: errors,
      screenshots: shots,
    }),
  );
} finally {
  await app.close();
  server.close();
}
