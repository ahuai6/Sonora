import { parentPort, workerData } from "node:worker_threads";
const response = await fetch(workerData.query.url);
await response.text();
parentPort.postMessage({ ok: true, value: "unexpected completion" });
