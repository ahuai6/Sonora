import fs from "node:fs";
import { createHash } from "node:crypto";
export async function fileDigest(file) {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
