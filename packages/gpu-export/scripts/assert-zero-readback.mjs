import { realpathSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const roots = [join(packageRoot, "src"), join(packageRoot, "bin")];
const excluded = resolve(packageRoot, "src", "verify-readback.js");
const patterns = [
  ["WebGL pixel read", /readPixels/u],
  ["2D pixel read", /getImageData/u],
  ["bitmap creation", /createImageBitmap/u],
  ["data URL export", /toDataURL/u],
  ["blob export", /toBlob/u],
  ["frame copy", /\.copyTo\s*\(/u],
];
const failures = [];
for (const root of roots) {
  for (const path of await files(root)) {
    if (resolve(path) === excluded || !/\.(?:m?js)$/u.test(path)) continue;
    const lines = (await readFile(path, "utf8")).split("\n");
    for (const [index, line] of lines.entries()) {
      for (const [label, pattern] of patterns) {
        if (pattern.test(line)) failures.push(`${relative(packageRoot, path)}:${index + 1}: ${label}: ${line.trim()}`);
      }
    }
  }
}
if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("GPU product path has zero readback calls\n");
}

async function files(root) {
  const output = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) output.push(...await files(path));
    else if (entry.isFile()) output.push(path);
  }
  return output;
}

const invoked = (() => {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
})();
void invoked;
