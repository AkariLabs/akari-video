#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const packageRoot = path.join(repoRoot, 'packages', 'preview-server');
const packageJsonPath = path.join(packageRoot, 'package.json');
const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
const buildCommands = packageJson.scripts?.build?.split(/\s*&&\s*/u) ?? [];
const expectedOutputs = new Set([
  'public/pen-visuals.bundle.js',
  'public/overlay-interaction.bundle.js',
  'public/overlay-interaction.css',
  // モーション語彙（イージング名 + 対象別既定尺）。断片の var(--ease-*) の解決先で、
  // 書き出し側は rasterize が同じ 1 枚を埋め込む（プレビューとのパリティ）。
  'public/overlay-motion-vocab.css',
  'public/edit-kernel.bundle.js',
  'public/frame-engine.bundle.js'
]);
const require = createRequire(packageJsonPath);
// esbuild/bin/esbuild は shebang 付きの JS（実体のネイティブ実行ファイルを起こすラッパ）。
// Windows では実行可能ファイルではないので直接 spawn すると status: null になり、
// 「drift 検出」ではなく「検査の起動失敗」で落ちていた（2026-09-19 Windows 実測）。
// node で明示的に読ませれば OS 非依存（macOS / Linux でも同じ JS を同じ node で動かすだけ）。
// .cmd / .bat シムを経由しないので shell: true も不要。
const esbuildBin = require.resolve('esbuild/bin/esbuild');
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'akari-preview-server-drift-'));
const generatedOutputs = new Map();

try {
  for (const command of buildCommands) {
    const args = command.trim().split(/\s+/u);
    if (args.shift() !== 'esbuild') {
      throw new Error(`preview-server build contains an unsupported command: ${command}`);
    }

    const outfileIndex = args.findIndex(argument => argument.startsWith('--outfile='));
    if (outfileIndex === -1) {
      throw new Error(`preview-server build command has no --outfile: ${command}`);
    }

    const relativeOutput = args[outfileIndex].slice('--outfile='.length);
    if (!expectedOutputs.has(relativeOutput) || generatedOutputs.has(relativeOutput)) {
      throw new Error(`unexpected or duplicate preview-server build output: ${relativeOutput}`);
    }

    const temporaryOutput = path.join(temporaryRoot, relativeOutput);
    args[outfileIndex] = `--outfile=${temporaryOutput}`;
    const result = spawnSync(process.execPath, [esbuildBin, ...args], {
      cwd: packageRoot,
      encoding: 'utf8'
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) {
      // 「検査が起動できなかった」を drift と混同させない（Windows で status: null になっていた頃の教訓）
      throw new Error(`preview-server bundle generation could not start for ${relativeOutput}: ${result.error.message}`);
    }
    if (result.status !== 0) {
      throw new Error(`preview-server bundle generation failed for ${relativeOutput} (exit ${result.status ?? 'unknown'})`);
    }
    generatedOutputs.set(relativeOutput, temporaryOutput);
  }

  const missingOutputs = [...expectedOutputs].filter(output => !generatedOutputs.has(output));
  if (missingOutputs.length > 0) {
    throw new Error(`preview-server build does not generate: ${missingOutputs.join(', ')}`);
  }

  const drifted = [];
  for (const [relativeOutput, temporaryOutput] of generatedOutputs) {
    const committedOutput = path.join(packageRoot, relativeOutput);
    if (!existsSync(committedOutput)
      || !Buffer.from(await readFile(committedOutput)).equals(Buffer.from(await readFile(temporaryOutput)))) {
      drifted.push(relativeOutput);
    }
  }

  if (drifted.length > 0) {
    process.stderr.write(`preview-server bundle drift detected: ${drifted.join(', ')}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('preview-server bundles are current\n');
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
