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

let buildSync;
try { ({ buildSync } = require("esbuild")); }
catch { ({ buildSync } = require(join(repoRoot, "node_modules", "esbuild"))); }

await mkdir(outputDirectory, { recursive: true });
await rm(temporaryOutput, { force: true });
const banner = "// このファイルは生成物です。正本は packages/frame-engine/src、再生成は npm run bundle:frame-engine。";
try {
  buildSync({
    entryPoints: [entry],
    bundle: true,
    format: "iife",
    globalName: "AkariFrameEngine",
    platform: "browser",
    target: ["chrome122"],
    banner: { js: banner },
    absWorkingDir: repoRoot,
    outfile: temporaryOutput,
    logLevel: "silent",
  });
} catch (error) {
  await rm(temporaryOutput, { force: true });
  throw error;
}
if (!existsSync(temporaryOutput)) {
  throw new Error("esbuild が出力を生成しませんでした");
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
