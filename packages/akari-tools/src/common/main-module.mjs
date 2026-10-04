import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function isMainModule(moduleUrl) {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}
