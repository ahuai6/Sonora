import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const result = spawnSync(
  process.execPath,
  [
    require.resolve("electron-builder/cli.js"),
    "--win",
    ...(process.argv.includes("--dir") ? ["--dir"] : ["portable"]),
    "--x64",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      ELECTRON_BUILDER_COMPRESSION_LEVEL:
        process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL || "5",
    },
  },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
