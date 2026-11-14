import { parentPort, workerData } from "node:worker_threads";
import { TagEditor } from "./tag-editor.mjs";
import {
  firstEmbeddedLyric,
  readEmbeddedLyrics,
  writeEmbeddedLyrics,
} from "./embedded-lyrics/files.mjs";
try {
  const { input, file, operation } = workerData;
  if (operation === "readLyrics") {
    parentPort.postMessage({ result: await readEmbeddedLyrics(file) });
  } else if (operation === "readPlaybackLyrics") {
    parentPort.postMessage({ result: await firstEmbeddedLyric(file) });
  } else {
    if (operation === "writeLyrics") await writeEmbeddedLyrics(file, input);
    else {
      if (input.artwork?.data)
        input.artwork.data = Buffer.from(input.artwork.data);
      await TagEditor.prototype.writeTags.call({}, file, input);
    }
    parentPort.postMessage({ ok: true });
  }
} catch (e) {
  parentPort.postMessage({ error: e.message });
}
