import { parentPort, workerData } from "node:worker_threads";
import { TagEditor } from "./tag-editor.mjs";
try {
  const input = workerData.input;
  if (input.artwork?.data) input.artwork.data = Buffer.from(input.artwork.data);
  await TagEditor.prototype.writeTags.call({}, workerData.file, input);
  parentPort.postMessage({ ok: true });
} catch (e) {
  parentPort.postMessage({ error: e.message });
}
