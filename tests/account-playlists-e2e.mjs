import { _electron as electron } from "playwright";
import { expect } from "@playwright/test";
import electronPath from "electron";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import assert from "node:assert/strict";
fs.mkdirSync("test-artifacts", { recursive: true });
const profile = fs.mkdtempSync(
  path.resolve("test-artifacts/account-playlists-"),
);
let mode = "success";
const requests = [],
  held = [];
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  res.setHeader("Content-Type", "application/json");
  if (url.pathname !== "/user-playlists") return res.end('{"items":[]}');
  const platform = url.searchParams.get("platform"),
    offset = Number(url.searchParams.get("offset"));
  requests.push({ platform, offset });
  const requestMode = mode;
  const items = Array.from(
    { length: platform === "netease" ? (offset ? 1 : 40) : 2 },
    (_, i) => ({
      id: `${platform}-${offset + i}`,
      name: `${platform} fixture playlist ${offset + i}`,
      creator: { nickname: "Fixture" },
    }),
  );
  const respond = (status = 200) => {
    res.statusCode = status;
    res.end(JSON.stringify({ items: requestMode === "empty" ? [] : items }));
  };
  if (requestMode === "delayed-error" || requestMode === "delayed-success")
    held.push(() => respond(requestMode === "delayed-error" ? 503 : 200));
  else respond(requestMode === "error" ? 403 : 200);
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;
const config = JSON.parse(fs.readFileSync("profiles/providers.json", "utf8"));
for (const p of config.platforms) {
  p.baseUrl = base;
  p.routes.userPlaylists = {
    path: "/user-playlists",
    params: {
      platform: p.id,
      uid: "{uid}",
      offset: "{offset}",
      limit: "{limit}",
    },
    items: ["items"],
  };
}
const accounts = ["netease", "qq", "kugou"].map((platform) => ({
  id: `fixture-${platform}`,
  platform,
  uid: `uid-${platform}`,
  nickname: `Fixture ${platform}`,
  active: true,
  verified: false,
  secret: Buffer.from("fixture-only").toString("base64"),
}));
accounts.push({
  ...accounts[0],
  id: "fixture-inactive",
  nickname: "Inactive fixture",
  active: false,
});
fs.writeFileSync(path.join(profile, "providers.json"), JSON.stringify(config));
fs.writeFileSync(
  path.join(profile, "state.json"),
  JSON.stringify({
    acceptedDisclaimer: true,
    accounts,
    settings: { downloadDir: profile },
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
let checks = 0;
const errors = [];
try {
  await app.evaluate(({ safeStorage }) => {
    safeStorage.decryptString = (data) => {
      if (data.toString() !== "fixture-only")
        throw Error("Unexpected non-fixture credential");
      return "fixture=true";
    };
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  const open = async (platform) => {
    await page.getByRole("button", { name: "平台账号", exact: true }).click();
    await page
      .locator(".account-row")
      .filter({ has: page.locator(`.platform-badge.${platform}`) })
      .first()
      .getByRole("button", { name: "我的歌单", exact: true })
      .click();
  };
  await open("netease");
  await expect(page.locator(".music-card")).toHaveCount(40, { timeout: 2500 });
  await expect(page.getByText("正在打开音乐资源", { exact: true })).toHaveCount(
    0,
  );
  checks++;
  mode = "error";
  await page.getByRole("button", { name: "加载更多", exact: true }).click();
  await expect(page.locator(".error-notice")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "加载更多", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".music-card")).toHaveCount(40);
  checks++;
  mode = "success";
  await page.getByRole("button", { name: "加载更多", exact: true }).click();
  await expect(page.locator(".music-card")).toHaveCount(41);
  await expect(
    page.getByRole("button", { name: "加载更多", exact: true }),
  ).toHaveCount(0);
  assert.deepEqual(
    requests.filter((x) => x.platform === "netease").map((x) => x.offset),
    [0, 40, 40],
  );
  checks++;
  for (const p of ["qq", "kugou"]) {
    await open(p);
    await expect(page.locator(".music-card")).toHaveCount(2);
    await expect(
      page.getByText("正在打开音乐资源", { exact: true }),
    ).toHaveCount(0);
    checks++;
  }
  mode = "empty";
  await open("netease");
  await expect(
    page.getByRole("heading", { name: "暂时没有可显示的内容" }),
  ).toBeVisible();
  await expect(page.getByText("正在打开音乐资源", { exact: true })).toHaveCount(
    0,
  );
  checks++;
  mode = "error";
  await open("netease");
  await expect(page.locator(".error-notice")).toHaveCount(1);
  await expect(page.getByText("正在打开音乐资源", { exact: true })).toHaveCount(
    0,
  );
  await page.locator(".error-notice summary").click();
  await expect(page.locator(".error-notice")).toContainText("403");
  checks++;
  mode = "success";
  await open("netease");
  await expect(page.locator(".music-card")).toHaveCount(40);
  checks++;
  for (const delayed of ["delayed-error", "delayed-success"]) {
    mode = delayed;
    await open("netease");
    await expect.poll(() => held.length).toBe(1);
    await page.getByRole("button", { name: "返回", exact: true }).click();
    mode = "success";
    await open("qq");
    await expect(page.locator(".music-card")).toHaveCount(2);
    held.shift()();
    await page.waitForTimeout(150); // Allow the deliberately delayed IPC response to reach the renderer.
    await expect(page.locator(".music-card")).toHaveCount(2);
    await expect(page.locator(".error-notice")).toHaveCount(0);
    assert(
      (await page.locator(".music-card").allTextContents()).every((text) =>
        text.includes("qq fixture"),
      ),
    );
    checks++;
  }
  await page.evaluate(() =>
    window.sonora.saveAccount({
      updateDetails: true,
      id: "fixture-netease",
      uid: "",
      nickname: "Fixture netease",
    }),
  );
  await open("netease");
  await expect(page.locator(".error-notice")).toHaveCount(1);
  await expect(page.getByText("正在打开音乐资源", { exact: true })).toHaveCount(
    0,
  );
  checks++;
  await page.getByRole("button", { name: "平台账号", exact: true }).click();
  await page.evaluate(() => window.sonora.logout("fixture-inactive"));
  await page
    .locator(".account-row")
    .filter({ hasText: "Inactive fixture" })
    .getByRole("button", { name: "我的歌单", exact: true })
    .click();
  await expect(page.locator(".toast.error").last()).toContainText("账号不存在");
  await expect(page.locator(".account-list")).toBeVisible();
  assert.deepEqual(errors, []);
  checks++;
  console.log(
    JSON.stringify({
      ok: true,
      targetedDesktopChecks: checks,
      rendererErrors: errors,
      personalPlaylistsComplete: true,
      staleResultsIgnored: true,
    }),
  );
} finally {
  for (const respond of held) respond();
  await app.close();
  server.closeAllConnections();
  server.close();
}
