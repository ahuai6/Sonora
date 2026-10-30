import { _electron as electron } from "playwright";
import { expect } from "@playwright/test";
import electronPath from "electron";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
fs.mkdirSync("test-artifacts", { recursive: true });
const profile = fs.mkdtempSync(path.resolve("test-artifacts/jerry-ui-"));
const legacy = JSON.parse(fs.readFileSync("profiles/providers.json", "utf8"));
legacy.resolvers = legacy.resolvers.filter((r) => r.id !== "jerry");
delete legacy.bundledResolverMigrations;
legacy.platforms.forEach((p) => (p.enabled = false));
fs.writeFileSync(path.join(profile, "providers.json"), JSON.stringify(legacy));
fs.writeFileSync(
  path.join(profile, "state.json"),
  JSON.stringify({
    acceptedDisclaimer: true,
    settings: { downloadDir: profile },
    device: { dfid: "fixture", KUGOU_API_MID: "fixture" },
  }),
);
const env = { ...process.env, SONORA_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.SONORA_TEST_EXECUTABLE || electronPath;
const args = process.env.SONORA_TEST_EXECUTABLE
  ? [`--user-data-dir=${profile}`]
  : ["."];
const errors = [];
let checks = 0;
for (let launch = 0; launch < 2; launch++) {
  const app = await electron.launch({ executablePath, args, env });
  try {
    const page = await app.firstWindow();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.getByRole("button", { name: "偏好与音源", exact: true }).click();
    const select = page.getByLabel("使用的音源", { exact: true });
    await expect(select.locator('option[value="jerry"]')).toHaveCount(1);
    await expect(select.locator('option[value="jerry"]')).toBeEnabled();
    checks++;
    if (!launch) {
      await select.selectOption("jerry");
      await expect
        .poll(() =>
          page.evaluate(
            async () =>
              (await window.sonora.bootstrap()).settings.preferredResolver,
          ),
        )
        .toBe("jerry");
      checks++;
      await page
        .getByRole("button", { name: "保存备用音源", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "保存备用音源", exact: true }),
      ).toBeEnabled();
      assert(
        JSON.parse(
          fs.readFileSync(path.join(profile, "providers.json")),
        ).resolvers.some((r) => r.id === "jerry"),
      );
      checks++;
      await select.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: "test-artifacts/jerry-bundled-settings.png",
        animations: "disabled",
      });
    } else {
      await expect(select).toHaveValue("jerry");
      checks++;
    }
  } finally {
    await app.close();
  }
}
assert.deepEqual(errors, []);
checks++;
console.log(
  JSON.stringify({
    ok: true,
    targetedDesktopChecks: checks,
    legacyProfileUpgraded: true,
    manualSelectionPersists: true,
    rendererErrors: errors,
  }),
);
