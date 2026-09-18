#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const checks = [
  ['packages/gpu-export', 'packages/gpu-export/scripts/bundle-frame-engine.mjs'],
  ['packages/osr-export', 'packages/osr-export/scripts/bundle-frame-engine.mjs'],
  ['apps/shell/extensions/akari-preview', 'apps/shell/extensions/akari-preview/scripts/bundle-frame-engine.mjs'],
  ['packages/preview-server', 'scripts/ci/check-preview-server-drift.mjs']
];
const failed = [];

// 下請けはいずれも .mjs なので process.execPath で起動する（shebang / .cmd シムを経由しないので
// Windows でも spawn できる。ここは元から node 起動だが、下請け側が esbuild の shebang スクリプトを
// 直接 spawn していて Windows で「検査の起動失敗」を drift として報告していた — 2026-09-19 修正）。
for (const [name, script] of checks) {
  process.stdout.write(`[frame-engine-drift] checking ${name}\n`);
  const result = spawnSync(process.execPath, [path.join(repoRoot, script), '--check'], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) {
    // 「検査が起動できなかった」と「drift があった」を混同しない
    failed.push(name);
    process.stderr.write(`[frame-engine-drift] could not start: ${name}: ${result.error.message}\n`);
  } else if (result.status !== 0) {
    failed.push(name);
    process.stderr.write(`[frame-engine-drift] failed: ${name} (exit ${result.status ?? 'unknown'})\n`);
  }
}

if (failed.length > 0) {
  process.stderr.write(`[frame-engine-drift] drift check failed: ${failed.join(', ')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('[frame-engine-drift] all bundle drift checks passed\n');
}
