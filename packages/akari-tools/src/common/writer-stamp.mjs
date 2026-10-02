import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const { writeSavedByStamp } = createRequire(import.meta.url)("../../../edit-store/lib/write-gate.js");

export const writerVersion = (() => {
  try { return JSON.parse(readFileSync(new URL("../../../akari-launcher/package.json", import.meta.url), "utf8")).version; }
  catch { return undefined; }
})();

export function stampSavedBy(projectRoot) {
  return writeSavedByStamp(projectRoot, writerVersion);
}
