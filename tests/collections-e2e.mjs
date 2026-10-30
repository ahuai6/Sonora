import { _electron as electron } from "playwright";
import { expect } from "@playwright/test";
import electronPath from "electron";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { Store } from "../main/core/store.mjs";
import { MusicLibrary } from "../main/services/files.mjs";

fs.mkdirSync("test-artifacts", { recursive: true });
const dir = fs.mkdtempSync(path.resolve("test-artifacts/collections-ui-"));
const profile = path.join(dir, "profile"),
  music = path.join(dir, "music"),
  bin = path.join(dir, "fixture-bin");
fs.mkdirSync(music);
fs.mkdirSync(bin);
const files = ["A", "B", "C"].map((name) => path.join(music, name + ".flac"));
for (const file of files) fs.copyFileSync("tests/fixtures/tag-tone.flac", file);
const store = new Store(profile, { downloadDir: music }),
  library = new MusicLibrary(store);
await library.importFiles(files);
store.data.acceptedDisclaimer = true;
store.data.device = {
  dfid: "fixture",
  KUGOU_API_MID: "fixture",
  KUGOU_API_DEV: "fixture",
};
store.data.downloads = library.list().map((item, i) => ({
  id: `job-${i}`,
  track: { ...item, platform: "netease", key: `netease:${i}` },
  path: item.path,
  status: "completed",
  quality: "high",
  progress: 100,
  received: 0,
  createdAt: Date.now(),
  message: "下载完成",
}));
store.save();
const config = JSON.parse(fs.readFileSync("profiles/providers.json", "utf8"));
config.platforms.forEach((p) => (p.enabled = false));
fs.writeFileSync(path.join(profile, "providers.json"), JSON.stringify(config));
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
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "本地音乐", exact: true }).click();
  await expect(page.locator(".track-row")).toHaveCount(3);
  await expect(
    page.getByRole("button", { name: "刷新本地音乐" }),
  ).toBeEnabled();
  checks++;

  const original = await page.evaluate(
    async () => (await window.sonora.bootstrap()).library,
  );
  await page.locator('.track-row input[type="checkbox"]').nth(0).check();
  await page.locator('.track-row input[type="checkbox"]').nth(1).check();
  await expect(
    page.getByRole("button", { name: "播放所选", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-artifacts/collections-library-selected.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "移除所选记录", exact: true }).click();
  await expect(page.locator(".track-row")).toHaveCount(1);
  assert(files.every((file) => fs.existsSync(file)));
  checks++;

  await app.evaluate(
    ({ dialog }, filePaths) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths });
    },
    original.slice(0, 2).map((x) => x.path),
  );
  await page.getByRole("button", { name: "导入音乐", exact: true }).click();
  await expect(page.locator(".track-row")).toHaveCount(3);
  checks++;
  await app.evaluate(
    ({ dialog, shell }, { bin, music }) => {
      globalThis.__trashAnswer = 0;
      globalThis.__trashPrompts = 0;
      dialog.showMessageBox = async () => {
        globalThis.__trashPrompts++;
        return { response: globalThis.__trashAnswer };
      };
      shell.trashItem = async (file) => {
        const fs = process.getBuiltinModule("node:fs"),
          path = process.getBuiltinModule("node:path");
        assertFixture(file);
        await fs.promises.rename(file, path.join(bin, path.basename(file)));
      };
      function assertFixture(file) {
        if (!file.startsWith(music + process.getBuiltinModule("node:path").sep))
          throw Error("Non-fixture deletion refused");
      }
    },
    { bin, music },
  );
  await page.locator('.track-row input[type="checkbox"]').first().check();
  await page
    .getByRole("button", { name: "所选移入回收站", exact: true })
    .click();
  await expect
    .poll(() => app.evaluate(() => globalThis.__trashPrompts))
    .toBe(1);
  await expect(
    page.getByRole("button", { name: "所选移入回收站", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".track-row")).toHaveCount(3);
  assert(files.every((file) => fs.existsSync(file)));
  checks++;

  await app.evaluate(() => {
    globalThis.__trashAnswer = 1;
  });
  await page
    .getByRole("button", { name: "所选移入回收站", exact: true })
    .click();
  await expect(page.locator(".track-row")).toHaveCount(2);
  assert.equal(fs.readdirSync(bin).length, 1);
  checks++;

  const remaining = await page.evaluate(
    async () => (await window.sonora.bootstrap()).library,
  );
  fs.unlinkSync(remaining[0].path);
  await page.getByRole("button", { name: "刷新本地音乐" }).click();
  await expect(page.locator(".track-row")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "刷新本地音乐" }),
  ).toBeEnabled();
  checks++;
  await page
    .getByRole("button", { name: /下载中心/, exact: false })
    .first()
    .click();
  await expect(page.locator(".download-row.missing")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "刷新下载列表" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "刷新下载列表" }).click();
  await expect(
    page.getByRole("button", { name: "刷新下载列表" }),
  ).toBeEnabled();
  checks++;
  await page.getByRole("button", { name: /^文件已丢失/ }).click();
  await expect(page.locator(".download-row")).toHaveCount(2);
  await page
    .getByRole("checkbox", { name: "选择当前列表全部下载任务" })
    .check();
  await expect(
    page.getByRole("button", { name: "重试所选", exact: true }),
  ).toBeEnabled();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1080, 780),
  );
  await expect
    .poll(() => page.evaluate(() => innerWidth))
    .toBeLessThanOrEqual(1080);
  assert(
    await page.locator(".download-batch").evaluate((toolbar) =>
      [...toolbar.querySelectorAll("button")].every((button) => {
        const box = button.getBoundingClientRect();
        return box.left >= 0 && box.right <= innerWidth;
      }),
    ),
  );
  checks++;
  await page.screenshot({
    path: "test-artifacts/collections-download-selected.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "移除所选记录", exact: true }).click();
  await expect(page.locator(".download-row")).toHaveCount(0);
  checks++;

  await page.getByRole("button", { name: /^全部任务/ }).click();
  await expect(page.locator(".download-row")).toHaveCount(1);
  await page
    .getByRole("checkbox", { name: "选择当前列表全部下载任务" })
    .check();
  await page
    .getByRole("button", { name: "所选移入回收站", exact: true })
    .click();
  await expect(page.locator(".download-row")).toHaveCount(0);
  assert.equal(fs.readdirSync(bin).length, 2);
  checks++;

  await page.getByRole("button", { name: "本地音乐", exact: true }).click();
  await expect(page.locator(".track-row")).toHaveCount(0);
  // Refresh is also available when the list is empty; it does not revive removed records.
  await page.getByRole("button", { name: "刷新本地音乐" }).click();
  await expect(
    page.getByRole("button", { name: "刷新本地音乐" }),
  ).toBeEnabled();
  assert.equal(
    (await page.evaluate(() => window.sonora.bootstrap())).library.length,
    0,
  );
  checks++;
  await page.screenshot({
    path: "test-artifacts/collections-empty.png",
    animations: "disabled",
  });
  assert.deepEqual(errors, []);
  checks++;
  console.log(
    JSON.stringify({
      ok: true,
      targetedDesktopChecks: checks,
      rendererErrors: errors,
    }),
  );
} finally {
  await app.close();
}
