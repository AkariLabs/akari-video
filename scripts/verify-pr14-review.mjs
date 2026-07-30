#!/usr/bin/env node
/**
 * PR #14 review checklist — automated verification with evidence output.
 * Usage: node scripts/verify-pr14-review.mjs
 * Requires: packages/akari-launcher/src/harnesses.mjs (PR2+ branch)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const launcher = path.join(root, 'packages/akari-launcher');
const results = [];

function pass(id, msg, evidence = '') {
  results.push({ id, ok: true, msg, evidence });
  console.log(`PASS  [${id}] ${msg}${evidence ? `\n       ${evidence}` : ''}`);
}
function fail(id, msg, evidence = '') {
  results.push({ id, ok: false, msg, evidence });
  console.error(`FAIL  [${id}] ${msg}${evidence ? `\n       ${evidence}` : ''}`);
}

const harnessesPath = path.join(launcher, 'src/harnesses.mjs');

if (!fs.existsSync(harnessesPath)) {
  console.error('verify-pr14-review: harnesses.mjs がありません（contrib/pr2-launcher-cursor-codex で実行してください）');
  process.exit(2);
}

// P14-1: cursor-agent only (no generic agent)
{
  const src = fs.readFileSync(path.join(launcher, 'src/path-lookup.mjs'), 'utf8');
  const onlyCursorAgent = src.includes("findExecutableByNames(['cursor-agent']")
    && !src.includes("['cursor-agent', 'agent']");
  if (onlyCursorAgent) pass('P14-1', 'findCursorAgentExecutable が cursor-agent のみ');
  else fail('P14-1', '一般名 agent が候補に残存');
}

// P14-1-RT: unit test
{
  const r = spawnSync('node', ['--test', 'test/path-lookup-cursor.test.mjs'], { cwd: launcher, encoding: 'utf8' });
  if (r.status === 0) pass('P14-1-RT', 'path-lookup-cursor.test.mjs', 'agent のみ → null / cursor-agent → 解決');
  else fail('P14-1-RT', 'path-lookup-cursor テスト失敗', (r.stderr || r.stdout).slice(-400));
}

// P14-2: no codex --full-auto mapping
{
  const { buildHarnessArgv } = await import(pathToFileURL(harnessesPath).href);
  const empty = buildHarnessArgv('codex', true, []);
  const withArgs = buildHarnessArgv('codex', true, ['fix lint']);
  const ok = JSON.stringify(empty) === '[]' && JSON.stringify(withArgs) === '["fix lint"]';
  if (ok) pass('P14-2', 'Codex -y で --full-auto を付加しない', `[] / ["fix lint"]`);
  else fail('P14-2', 'Codex --full-auto 残存', `${JSON.stringify(empty)} / ${JSON.stringify(withArgs)}`);
}

// P14-2-RT: harnesses + cli tests
{
  const r = spawnSync('node', ['--test', 'test/harnesses.test.mjs', 'test/cli.test.mjs'], { cwd: launcher, encoding: 'utf8' });
  const m = r.stdout.match(/ℹ pass (\d+)/);
  if (r.status === 0) pass('P14-2-RT', 'harnesses + cli テスト', m ? `${m[1]} pass` : 'ok');
  else fail('P14-2-RT', 'harnesses/cli テスト失敗', (r.stderr || r.stdout).slice(-400));
}

// P14-3: CLI smoke test
{
  const smoke = path.join(launcher, 'test/harness-cli-flags.test.mjs');
  if (!fs.existsSync(smoke)) fail('P14-3', 'harness-cli-flags.test.mjs 未追加');
  else {
    pass('P14-3', 'harness-cli-flags.test.mjs 存在');
    const r = spawnSync('node', ['--test', 'test/harness-cli-flags.test.mjs'], { cwd: launcher, encoding: 'utf8' });
    const summary = [...r.stdout.matchAll(/ℹ (tests|pass|fail|skipped) (\d+)/g)].map((x) => `${x[1]}=${x[2]}`).join(' ');
    if (r.status === 0) pass('P14-3-RT', 'harness-cli-flags 実行', summary || 'ok');
    else fail('P14-3-RT', 'harness-cli-flags 失敗', (r.stderr || r.stdout).slice(-300));
  }
}

// P14-4: full launcher suite
{
  const r = spawnSync('node', ['--test', 'test/*.mjs'], { cwd: launcher, encoding: 'utf8', shell: true });
  const passN = r.stdout.match(/ℹ pass (\d+)/)?.[1];
  const failN = r.stdout.match(/ℹ fail (\d+)/)?.[1];
  if (r.status === 0 && failN === '0') pass('P14-CI', `akari-launcher 全テスト ${passN} pass`);
  else fail('P14-CI', 'launcher テスト失敗', (r.stderr || r.stdout).slice(-400));
}

const failed = results.filter((r) => !r.ok);
console.log('\n---');
console.log(`Total: ${results.length}, PASS: ${results.length - failed.length}, FAIL: ${failed.length}`);
process.exit(failed.length ? 1 : 0);
