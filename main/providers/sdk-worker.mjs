import { parentPort, workerData } from "node:worker_threads";
import { engine } from "./engines.mjs";
try {
  const sdk = await engine(workerData.platform),
    fn = sdk[workerData.module];
  if (typeof fn !== "function")
    throw Error(`引擎缺少模块 ${workerData.module}`);
  const value = workerData.inspect
    ? { available: true }
    : await fn(workerData.query);
  parentPort.postMessage({ ok: true, value });
} catch (e) {
  parentPort.postMessage({ ok: false, error: e.message || "平台接口失败" });
}
