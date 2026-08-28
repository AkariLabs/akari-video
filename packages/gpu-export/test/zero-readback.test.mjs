import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("product source contains no frame readback call", async () => {
  const result = await execFileAsync(process.execPath, [join(packageRoot, "scripts", "assert-zero-readback.mjs")]);
  assert.match(result.stdout, /zero readback/);
});
