import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "../..");
const outputDirectory = join(packageRoot, "generated");
const output = join(outputDirectory, "frame-engine.js");
const temporaryOutput = `${output}.tmp`;
const entry = join(repoRoot, "packages", "frame-engine", "src", "index.ts");
const check = process.argv.includes("--check");
const require = createRequire(import.meta.url);

let esbuild;
try { esbuild = require.resolve("esbuild/bin/esbuild"); }
catch { esbuild = [join(repoRoot, "node_modules", "esbuild", "bin", "esbuild")].find(existsSync); }
if (!esbuild) throw new Error("esbuild が見つかりません");

await mkdir(outputDirectory, { recursive: true });
await rm(temporaryOutput, { force: true });
const banner = "// このファイルは生成物です。正本は packages/frame-engine/src、再生成は npm run bundle:frame-engine。";
const result = spawnSync(process.execPath, [
  esbuild, entry, "--bundle", "--format=iife", "--global-name=AkariFrameEngine",
  "--platform=browser", "--target=chrome122", `--banner:js=${banner}`, `--outfile=${temporaryOutput}`,
], { cwd: repoRoot, encoding: "utf8" });
if (result.status !== 0 || !existsSync(temporaryOutput)) {
  await rm(temporaryOutput, { force: true });
  throw new Error(result.stderr || result.error?.message || `esbuild exit ${result.status}`);
}
if (check) {
  if (!existsSync(output) || !Buffer.from(await readFile(output)).equals(Buffer.from(await readFile(temporaryOutput)))) {
    await rm(temporaryOutput, { force: true });
    process.stderr.write("frame-engine bundle drift detected\n");
    process.exitCode = 1;
  } else {
    await rm(temporaryOutput, { force: true });
    process.stdout.write("frame-engine bundle is current\n");
  }
} else {
  await rename(temporaryOutput, output);
  process.stdout.write(`[bundle-frame-engine] generated ${relative(repoRoot, output)}\n`);
}
