#!/usr/bin/env node
/**
 * レビュー指摘の統合検証 — PR12 + PR14（存在する場合）を順に実行。
 * Usage: node scripts/verify-review-checklist.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scripts = path.join(root, 'scripts');

function run(label, script) {
  console.log(`\n========== ${label} ==========\n`);
  const r = spawnSync('node', [script], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  return r.status ?? 1;
}

let exitCode = 0;
exitCode |= run('PR #12 レビュー検証', path.join(scripts, 'verify-pr12-review.mjs'));

const hasPr14 = fs.existsSync(path.join(root, 'packages/akari-launcher/src/harnesses.mjs'));
if (hasPr14) {
  exitCode |= run('PR #14 レビュー検証', path.join(scripts, 'verify-pr14-review.mjs'));
} else {
  console.log('\n========== PR #14 レビュー検証 ==========\n');
  console.log('SKIP  harnesses.mjs なし（contrib/pr2-launcher-cursor-codex で実行）\n');
}

console.log('========== 統合結果 ==========');
console.log(exitCode === 0 ? 'ALL PASS' : 'SOME FAILED');
process.exit(exitCode);
