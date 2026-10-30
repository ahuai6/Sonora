import { Worker } from "node:worker_threads";
const queue = [],
  workers = new Set();
const maxWorkers = 4;
export function runSdkRequest(
  platform,
  module,
  query,
  {
    signal,
    timeout = 22000,
    inspect = false,
    workerUrl = new URL("./sdk-worker.mjs", import.meta.url),
  } = {},
) {
  const bounded = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
    : AbortSignal.timeout(timeout);
  return new Promise((resolve, reject) => {
    const job = {
      platform,
      module,
      query,
      inspect,
      workerUrl,
      bounded,
      resolve,
      reject,
    };
    const abortQueued = () => {
      const i = queue.indexOf(job);
      if (i >= 0) {
        queue.splice(i, 1);
        reject(bounded.reason);
      }
    };
    job.cleanupQueue = () => bounded.removeEventListener("abort", abortQueued);
    if (bounded.aborted) return reject(bounded.reason);
    bounded.addEventListener("abort", abortQueued, { once: true });
    queue.push(job);
    pump();
  });
}
function pump() {
  while (workers.size < maxWorkers && queue.length) {
    const job = queue.shift();
    job.cleanupQueue();
    if (job.bounded.aborted) {
      job.reject(job.bounded.reason);
      continue;
    }
    let worker;
    try {
      worker = new Worker(job.workerUrl, {
        execArgv: [],
        workerData: {
          platform: job.platform,
          module: job.module,
          query: job.query,
          inspect: job.inspect,
        },
      });
    } catch (e) {
      job.reject(e);
      continue;
    }
    workers.add(worker);
    let finished = false;
    const finish = async (error, value) => {
      if (finished) return;
      finished = true;
      job.bounded.removeEventListener("abort", abort);
      await worker.terminate().catch(() => {});
      workers.delete(worker);
      error ? job.reject(error) : job.resolve(value);
      pump();
    };
    const abort = () => void finish(job.bounded.reason);
    job.bounded.addEventListener("abort", abort, { once: true });
    if (job.bounded.aborted) abort();
    worker.once(
      "message",
      (m) => void finish(m.ok ? null : Error(m.error), m.value),
    );
    worker.once("error", (e) => void finish(e));
    worker.once("exit", (code) => {
      if (!finished) void finish(Error(`平台请求进程提前结束 (${code})`));
    });
  }
}
export function stopSdkWorkers() {
  for (const job of queue.splice(0)) {
    job.cleanupQueue();
    job.reject(Error("应用已关闭"));
  }
  for (const worker of workers) void worker.terminate();
}
