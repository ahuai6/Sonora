import { _electron as electron } from "playwright";
import { expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
fs.mkdirSync("test-artifacts", { recursive: true });
const profile = fs.mkdtempSync(path.resolve("test-artifacts/packaged-"));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const executable = path.resolve(
  process.argv[2] || "release/win-unpacked/Sonora.exe",
);
const app = await electron.launch({
  executablePath: executable,
  args: [`--user-data-dir=${profile}`],
  env,
  timeout: 30000,
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "开始探索", exact: true })
    .click();
  await page.locator(".chart-card").first().waitFor({ timeout: 30000 });
  const result = {
    executable,
    profile,
    charts: await page.locator(".chart-card").count(),
    errors,
    engines: [],
    qr: [],
  };
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
    result.engines.push({ platform, count: r.items.length, errors: r.errors });
    if (!r.items.length)
      throw Error(platform + " packaged engine search failed");
    const a = await page.evaluate(
      ({ track }) => window.sonora.resolve(track, "standard"),
      { track: r.items[0] },
    );
    if (!a.mediaUrl.startsWith("sonora-media://"))
      throw Error("Missing playback URL");
    await page.locator("audio").evaluate((audio, src) => {
      audio.src = src;
      audio.volume = 0;
      return audio.play();
    }, a.mediaUrl);
    await expect
      .poll(() => page.locator("audio").evaluate((a) => a.currentTime), {
        timeout: 15000,
      })
      .toBeGreaterThan(0.05);
    await page.locator("audio").evaluate((a) => a.pause());
  }
  await page.screenshot({ path: "test-artifacts/packaged-discover.png" });
  result.rendererErrors = errors;
  fs.writeFileSync(
    "test-artifacts/packaged-smoke.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await app.close();
}
