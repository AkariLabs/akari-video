import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function isMainModule(moduleUrl, invokedPath) {
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(resolve(invokedPath));
  } catch {
    return true;
  }
}
