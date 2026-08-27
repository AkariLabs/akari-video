import { realpathSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function findForbiddenIntermediates(projectRoot) {
  const root = resolve(projectRoot, ".akari", "render-tmp");
  const found = [];
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
      if (error?.code === "ENOENT") return [];
      throw error;
    });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const normalized = entry.name.toLowerCase();
      if (entry.isDirectory()) {
        if (normalized === "frames") found.push(`${relative(root, path).split("\\").join("/")}/`);
        await walk(path);
      } else if (entry.isFile() && (normalized.endsWith(".png") || normalized.endsWith(".mov"))) {
        found.push(relative(root, path).split("\\").join("/"));
      }
    }
  }
  await walk(root);
  return found.sort();
}

async function runCli() {
  const projectRoot = process.argv[2];
  if (!projectRoot) {
    process.stderr.write("Usage: assert-no-intermediates.mjs <projectRoot>\n");
    process.exitCode = 2;
    return;
  }
  const found = await findForbiddenIntermediates(projectRoot);
  if (found.length > 0) {
    process.stderr.write(`forbidden PNG/alpha intermediates:\n${found.map((path) => `  - ${path}`).join("\n")}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("no PNG/alpha intermediates\n");
}

const invoked = (() => {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
})();
if (invoked) await runCli();
