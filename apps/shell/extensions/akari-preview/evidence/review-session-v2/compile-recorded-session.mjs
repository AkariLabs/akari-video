#!/usr/bin/env node
// run-l1.mjs が実機録音した v2 セッションを compile-review-session へ通し、
// review.json 着地と address-review list までを 1 本で確認する。
// STT は決定論のため fixture transcript を置いて回避する（本票の検証対象は
// cut 写像であって音声認識精度ではない）。
//
// usage: compile-recorded-session.mjs <repo-root> <recorded-project-dir> <work-dir> [session-id]
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const [repoRootArg, recordedArg, workDirArg, sessionArg] = process.argv.slice(2);
if (!repoRootArg || !recordedArg || !workDirArg) {
  throw new Error('usage: compile-recorded-session.mjs <repo-root> <recorded-project-dir> <work-dir> [session-id]');
}
const repoRoot = path.resolve(repoRootArg);
const workDir = path.resolve(workDirArg);
await rm(workDir, { recursive: true, force: true });
await mkdir(path.dirname(workDir), { recursive: true });
await cp(path.resolve(recordedArg), workDir, { recursive: true });

const sessionsRoot = path.join(workDir, 'review', 'sessions');
const sessionId = sessionArg ?? (await readdir(sessionsRoot)).sort().at(-1);
assert.ok(sessionId, 'no recorded session found');
await writeFile(path.join(sessionsRoot, sessionId, 'transcript.json'), `${JSON.stringify({
  version: 1,
  backend: 'fixture',
  provenance: { backend: 'fixture' },
  segments: [{
    start: 1, end: 2, text: 'このカットを削除してください',
    words: [{ start: 1, end: 2, text: 'このカットを削除してください' }]
  }]
})}\n`);

const compile = await execFileAsync(process.execPath, [
  path.join(repoRoot, 'skills/compile-review-session/bin/compile-review-session.mjs'),
  workDir, '--session', sessionId, '--json'
]);
const result = JSON.parse(compile.stdout).results[0];
console.log('[compile]', JSON.stringify(result));
assert.equal(result.status, 'compiled');

const listed = await execFileAsync(process.execPath, [
  path.join(repoRoot, 'skills/address-review/bin/list.mjs'), workDir, '--all-open', '--json'
]);
const targets = JSON.parse(listed.stdout).targets;
console.log('[address-review]', JSON.stringify({
  open: targets.length,
  ids: targets.map(target => target.id),
  sourceT: targets.map(target => target.sourceT),
  target: targets.map(target => target.target)
}));
assert.equal(targets.length, 1);

const session = JSON.parse(await readFile(path.join(sessionsRoot, sessionId, 'session.json'), 'utf8'));
console.log('[session]', JSON.stringify({ status: session.status, compiled: session.compiledAnnotations }));
assert.equal(session.status, 'compiled');
