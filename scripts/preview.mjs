import { _electron as electron } from "playwright";
import electronPath from "electron";
import fs from "node:fs";
import path from "node:path";
const env = {
  ...process.env,
  SONORA_DATA_DIR: path.resolve("test-artifacts/preview-profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: electronPath,
  args: ["."],
  env,
});
const page = await app.firstWindow();
page.on("pageerror", (e) => console.error("PAGE ERROR", e.message));
page.on("console", (m) => {
  if (m.type() === "error") console.log("RENDERER", m.text().slice(0, 300));
});
await page
  .getByRole("dialog")
  .getByRole("button", { name: "开始探索", exact: true })
  .click()
  .catch(() => {});
await page.locator(".chart-card").first().waitFor({ timeout: 30000 });
await page.screenshot({ path: "test-artifacts/discover.png" });
console.log("READY", await page.title());
await page.getByRole("button", { name: "搜索资源", exact: true }).click();
await page.getByRole("textbox", { name: "搜索音乐资源" }).fill("海阔天空");
await page.getByRole("textbox", { name: "搜索音乐资源" }).press("Enter");
await page.locator(".track-row").first().waitFor({ timeout: 30000 });
await page.screenshot({ path: "test-artifacts/search.png" });
console.log("ROWS", await page.locator(".track-row").count());
await app.close();
