import { chromium, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { once } from "node:events";
fs.mkdirSync("test-artifacts", { recursive: true });
const profile = fs.mkdtempSync(path.resolve("test-artifacts/portable-"));
const listener = net.createServer();
listener.listen(0, "127.0.0.1");
await once(listener, "listening");
const port = listener.address().port;
await new Promise((r) => listener.close(r));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const version = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const exe = path.resolve(`release/Sonora-${version}-Windows-x64.exe`);
const child = spawn(
  exe,
  [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`],
  { env, stdio: "ignore" },
);
let browser;
try {
  const start = Date.now();
  while (Date.now() - start < 45000) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
        timeout: 1500,
      });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  if (!browser) throw Error("Portable executable did not start");
  const page = browser.contexts()[0].pages()[0];
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "开始探索", exact: true })
    .click();
  await page.locator(".chart-card").first().waitFor({ timeout: 30000 });
  const result = {
    ok: true,
    bytes: fs.statSync(exe).size,
    platforms: [],
    rendererErrors: [],
  };
  page.on("pageerror", (e) => result.rendererErrors.push(e.message));
  for (const platform of ["netease", "qq", "kugou"]) {
    const r = await page.evaluate(
      (p) =>
        window.sonora.search({
          query: "Sea",
          kind: "song",
          platform: p,
          page: 1,
          limit: 2,
        }),
      platform,
    );
    if (!r.items.length)
      throw Error(`${platform} search failed in portable exe`);
    result.platforms.push({ platform, count: r.items.length });
  }
  await page.locator(".page-scroll").evaluate((el) => {
    el.style.scrollBehavior = "auto";
    el.scrollTop = 0;
  });
  await page.mouse.move(1000, 60);
  await page.waitForTimeout(200);
  await page.screenshot({ path: "test-artifacts/portable-discover.png" });
  await page.getByRole("button", { name: "搜索资源", exact: true }).click();
  await page.getByRole("textbox", { name: "搜索音乐资源" }).fill("海阔天空");
  await page.getByRole("textbox", { name: "搜索音乐资源" }).press("Enter");
  await page.locator(".track-row").first().waitFor({ timeout: 30000 });
  await page.screenshot({ path: "test-artifacts/portable-search.png" });
  assertClean(result.rendererErrors);
  fs.writeFileSync(
    "test-artifacts/portable-smoke.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
  await page
    .evaluate(() => window.sonora.windowAction("close"))
    .catch(() => {});
} finally {
  await browser?.close().catch(() => {});
  setTimeout(() => {
    if (child.exitCode === null) child.kill();
  }, 2000).unref();
}
function assertClean(errors) {
  if (errors.length) throw Error(errors.join("\n"));
}
