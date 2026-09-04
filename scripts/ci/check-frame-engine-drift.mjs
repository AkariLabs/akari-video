#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const checks = [
  ['packages/gpu-export', 'packages/gpu-export/scripts/bundle-frame-engine.mjs'],
  ['packages/osr-export', 'packages/osr-export/scripts/bundle-frame-engine.mjs'],
  ['apps/shell/extensions/akari-preview', 'apps/shell/extensions/akari-preview/scripts/bundle-frame-engine.mjs']
];
const failed = [];

for (const [name, script] of checks) {
  process.stdout.write(`[frame-engine-drift] checking ${name}\n`);
  const result = spawnSync(process.execPath, [path.join(repoRoot, script), '--check'], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    failed.push(name);
    process.stderr.write(`[frame-engine-drift] failed: ${name} (exit ${result.status ?? 'unknown'})\n`);
  }
}

if (failed.length > 0) {
  process.stderr.write(`[frame-engine-drift] drift check failed: ${failed.join(', ')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('[frame-engine-drift] all frame-engine bundles are current\n');
}
