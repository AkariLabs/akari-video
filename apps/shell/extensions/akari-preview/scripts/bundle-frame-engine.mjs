import { existsSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shellRoot = path.resolve(extensionRoot, '../..');
const repoRoot = path.resolve(shellRoot, '../..');
const outputDirectory = path.join(extensionRoot, 'generated');
const require = createRequire(import.meta.url);

function oneLine(value) {
  return String(value ?? 'unknown error').replace(/\s+/gu, ' ').trim();
}

function skip(reason) {
  console.log(`[bundle-frame-engine] skipped: ${oneLine(reason)}`);
}

let esbuild;
try {
  esbuild = require.resolve('esbuild/bin/esbuild');
} catch {
  const candidates = [
    path.join(repoRoot, 'node_modules', 'esbuild', 'bin', 'esbuild'),
    path.join(shellRoot, 'node_modules', 'esbuild', 'bin', 'esbuild')
  ];
  esbuild = candidates.find(candidate => existsSync(candidate));
}

if (!esbuild) {
  skip('esbuild が見つかりません');
  process.exit(0);
}

await mkdir(outputDirectory, { recursive: true });
const banner = '// このファイルは生成物です。正本は packages/frame-engine/src、再生成は npm run bundle:frame-engine。';
const bundles = [
  {
    entry: path.join(repoRoot, 'packages', 'frame-engine', 'src', 'index.ts'),
    output: path.join(outputDirectory, 'frame-engine.js'),
    globalName: 'AkariFrameEngine'
  },
  {
    entry: path.join(repoRoot, 'packages', 'frame-engine', 'src', 'audio', 'pitch-shift-worklet.ts'),
    output: path.join(outputDirectory, 'preview-audio-worklet.js')
  }
];

for (const bundle of bundles) {
  const temporaryOutput = `${bundle.output}.tmp`;
  await rm(temporaryOutput, { force: true });
  const result = spawnSync(process.execPath, [
    esbuild,
    bundle.entry,
    '--bundle',
    '--format=iife',
    ...(bundle.globalName ? [`--global-name=${bundle.globalName}`] : []),
    '--platform=browser',
    '--target=chrome122',
    `--banner:js=${banner}`,
    `--outfile=${temporaryOutput}`
  ], { cwd: repoRoot, encoding: 'utf8' });

  if (result.status !== 0 || !existsSync(temporaryOutput)) {
    await rm(temporaryOutput, { force: true });
    skip(result.stderr || result.error?.message || `esbuild exit ${result.status}`);
    process.exit(0);
  }

  await rename(temporaryOutput, bundle.output);
  console.log(`[bundle-frame-engine] generated ${path.relative(repoRoot, bundle.output)}`);
}
