import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shellRoot = path.resolve(extensionRoot, '../..');
const repoRoot = path.resolve(shellRoot, '../..');
const outputDirectory = path.join(extensionRoot, 'generated');
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
const banner = '// このファイルは生成物です。正本は packages/frame-engine/src、再生成は npm run bundle:frame-engine。';
// 2 本とも同じ手順（tmp へ build → --check なら byte 比較・通常は rename）。
// preview-audio-worklet.js は AudioWorklet 専用エントリなので global-name を持たない。
const bundles = [
  {
    entry: path.join(repoRoot, 'packages', 'frame-engine', 'src', 'index.ts'),
    output: path.join(outputDirectory, 'frame-engine.js'),
    globalName: 'AkariFrameEngine',
    label: 'frame-engine bundle'
  },
  {
    entry: path.join(repoRoot, 'packages', 'frame-engine', 'src', 'audio', 'pitch-shift-worklet.ts'),
    output: path.join(outputDirectory, 'preview-audio-worklet.js'),
    label: 'preview-audio-worklet bundle'
  }
];

for (const bundle of bundles) {
  const temporaryOutput = `${bundle.output}.tmp`;
  await rm(temporaryOutput, { force: true });
  try {
    buildSync({
      entryPoints: [bundle.entry],
      bundle: true,
      format: 'iife',
      ...(bundle.globalName ? { globalName: bundle.globalName } : {}),
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
    if (!existsSync(bundle.output)
      || !Buffer.from(await readFile(bundle.output)).equals(Buffer.from(await readFile(temporaryOutput)))) {
      await rm(temporaryOutput, { force: true });
      process.stderr.write(`${bundle.label} drift detected\n`);
      process.exitCode = 1;
    } else {
      await rm(temporaryOutput, { force: true });
      process.stdout.write(`${bundle.label} is current\n`);
    }
  } else {
    await rename(temporaryOutput, bundle.output);
    console.log(`[bundle-frame-engine] generated ${path.relative(repoRoot, bundle.output)}`);
  }
}
