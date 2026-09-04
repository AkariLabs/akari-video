import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shellRoot = path.resolve(extensionRoot, '../..');
const repoRoot = path.resolve(shellRoot, '../..');
const outputDirectory = path.join(extensionRoot, 'generated');
const output = path.join(outputDirectory, 'frame-engine.js');
const temporaryOutput = path.join(outputDirectory, 'frame-engine.js.tmp');
const entry = path.join(repoRoot, 'packages', 'frame-engine', 'src', 'index.ts');
const check = process.argv.includes('--check');
const require = createRequire(import.meta.url);

function oneLine(value) {
  return String(value ?? 'unknown error').replace(/\s+/gu, ' ').trim();
}

function skip(reason) {
  console.log(`[bundle-frame-engine] skipped: ${oneLine(reason)}`);
}

let buildSync;
try {
  ({ buildSync } = require('esbuild'));
} catch {
  const candidates = [
    path.join(repoRoot, 'node_modules', 'esbuild'),
    path.join(shellRoot, 'node_modules', 'esbuild')
  ];
  for (const candidate of candidates) {
    try {
      ({ buildSync } = require(candidate));
      break;
    } catch {}
  }
}

if (!buildSync) {
  if (check) throw new Error('esbuild が見つかりません');
  skip('esbuild が見つかりません');
  process.exit(0);
}

await mkdir(outputDirectory, { recursive: true });
await rm(temporaryOutput, { force: true });
const banner = '// このファイルは生成物です。正本は packages/frame-engine/src、再生成は npm run bundle:frame-engine。';
try {
  buildSync({
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    globalName: 'AkariFrameEngine',
    platform: 'browser',
    target: ['chrome122'],
    banner: { js: banner },
    absWorkingDir: repoRoot,
    outfile: temporaryOutput,
    logLevel: 'silent'
  });
} catch (error) {
  await rm(temporaryOutput, { force: true });
  if (check) throw error;
  skip(error?.message);
  process.exit(0);
}
if (!existsSync(temporaryOutput)) {
  if (check) throw new Error('esbuild が出力を生成しませんでした');
  skip('esbuild が出力を生成しませんでした');
  process.exit(0);
}

if (check) {
  if (!existsSync(output) || !Buffer.from(await readFile(output)).equals(Buffer.from(await readFile(temporaryOutput)))) {
    await rm(temporaryOutput, { force: true });
    process.stderr.write('frame-engine bundle drift detected\n');
    process.exitCode = 1;
  } else {
    await rm(temporaryOutput, { force: true });
    process.stdout.write('frame-engine bundle is current\n');
  }
} else {
  await rename(temporaryOutput, output);
  console.log(`[bundle-frame-engine] generated ${path.relative(repoRoot, output)}`);
}
