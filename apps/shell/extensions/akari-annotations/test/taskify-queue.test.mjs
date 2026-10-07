import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { TaskifyQueue } from '../lib/node/taskify/taskify-queue.js';
const fake = fileURLToPath(new URL('./fixtures/taskify/fake-cli.mjs', import.meta.url));
const waitFor = async (fn, ms = 3000) => { const end = Date.now() + ms;
  while (Date.now() < end) { const value = fn(); if (value) return value; await new Promise(r => setTimeout(r, 10)); }
  throw new Error('job did not reach expected state'); };
async function fixture(mode = 'success', ports = {}) {
  const root = await mkdtemp(join(tmpdir(), 'taskify-queue-'));
  const memoDir = join(root, 'review', 'canvas', 'c-0001', 'taskify', 'r1');
  const inputDir = await mkdtemp(join(tmpdir(), 'taskify-input-'));
  await mkdir(memoDir, { recursive: true });
  await writeFile(join(inputDir, 'paper.png'), 'paper'); await writeFile(join(inputDir, 'context.md'), 'memo');
  await chmod(fake, 0o755);
  process.env.FAKE_TASKIFY_MODE = mode; process.env.FAKE_TASKIFY_CALL = join(inputDir, 'last-call.json');
  process.env.FAKE_TASKIFY_STATE = join(inputDir, 'state.txt');
  const job = { jobId: 'c-0001-r1', memoId: 'c-0001', projectRootUri: pathToFileURL(root).toString(),
    revision: 1, state: 'queued', attempts: 0, agent: 'claude', model: 'sonnet', inputDir,
    jobDir: memoDir, createdAt: new Date().toISOString() };
  let imported = 0;
  const queue = new TaskifyQueue({ findBin: async () => fake, online: async () => true,
    edit: async () => ({ cuts: [{}], overlays: [] }), importResult: async () => { imported++; return 1; },
    changed: () => {}, timeoutMs: 1000, retryDelays: [0, 0], offlineDelayMs: 20, ...ports });
  return { queue, job, inputDir, memoDir, imports: () => imported };
}
const checkedCall = async inputDir => {
  const record = JSON.parse(await readFile(join(inputDir, 'last-call.json'), 'utf8'));
  for (const flag of ['--setting-sources', '--strict-mcp-config', '--tools', '--no-session-persistence', '--output-format', '--json-schema'])
    assert.ok(record.args.includes(flag), flag);
  assert.equal(record.args[record.args.indexOf('--setting-sources') + 1], '');
  assert.equal(record.stdinEnded, true); assert.equal(record.cwd, await realpath(inputDir));
  assert.equal(record.files.includes('audio.wav'), false);
};
test('success completes once and writes result atomically', async () => {
  const f = await fixture(); await f.queue.enqueue(f.job);
  await waitFor(() => f.job.state === 'done'); assert.equal(f.imports(), 1);
  assert.equal(JSON.parse(await readFile(join(f.memoDir, 'result.json'), 'utf8')).tasks.length, 1);
  await checkedCall(f.inputDir);
});
test('bad JSON repairs once, persistent bad JSON stops after one repair', async () => {
  for (const [mode, state, attempts] of [['repair', 'done', 2], ['bad', 'failed', 2]]) {
    const f = await fixture(mode); await f.queue.enqueue(f.job);
    await waitFor(() => f.job.state === state); assert.equal(f.job.attempts, attempts);
    assert.equal(f.imports(), mode === 'repair' ? 1 : 0); await checkedCall(f.inputDir);
  }
});
test('timeout retries twice and stops; login and missing CLI block without retry', async () => {
  const slow = await fixture('timeout', { timeoutMs: 500 }); await slow.queue.enqueue(slow.job);
  await waitFor(() => slow.job.state === 'failed', 5000); assert.equal(slow.job.attempts, 3); await checkedCall(slow.inputDir);
  const login = await fixture('login'); await login.queue.enqueue(login.job);
  await waitFor(() => login.job.state === 'blocked'); assert.equal(login.job.error.code, 'login'); await checkedCall(login.inputDir);
  const missing = await fixture('success', { findBin: async () => undefined }); await missing.queue.enqueue(missing.job);
  await waitFor(() => missing.job.state === 'blocked'); assert.equal(missing.job.error.code, 'cli-missing');
  assert.equal(missing.job.attempts, 0);
});
test('rate limit retries with wait and ordinary exit is bounded', async () => {
  const rate = await fixture('rate', { retryDelays: [20, 20] }); await rate.queue.enqueue(rate.job);
  await waitFor(() => rate.job.state === 'done'); assert.equal(rate.job.attempts, 2); await checkedCall(rate.inputDir);
  const exit = await fixture('exit'); await exit.queue.enqueue(exit.job);
  await waitFor(() => exit.job.state === 'failed'); assert.equal(exit.job.attempts, 3); await checkedCall(exit.inputDir);
});
test('offline job stays queued and resumes; interrupted job restores', async () => {
  let online = false;
  const f = await fixture('success', { online: async () => online }); await f.queue.enqueue(f.job);
  await waitFor(() => f.job.waiting === 'offline'); assert.equal(f.job.state, 'queued');
  online = true; await waitFor(() => f.job.state === 'done'); await checkedCall(f.inputDir);
  const restored = await fixture(); restored.job.state = 'running';
  await writeFile(join(restored.memoDir, 'job.json'), JSON.stringify(restored.job));
  await restored.queue.restore(fileURLToPath(restored.job.projectRootUri));
  await waitFor(() => restored.job.state === 'done' || restored.queue.list()[0]?.state === 'done');
  await checkedCall(restored.inputDir);
});
test('one active job and ten waiting; cancel kills running child', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture('timeout', { online: async () => gate });
  await f.queue.enqueue(f.job);
  for (let i = 2; i <= 10; i++) await f.queue.enqueue({ ...f.job, jobId: `c-0001-r${i}`, jobDir: join(f.memoDir, `extra-${i}`) });
  await assert.rejects(f.queue.enqueue({ ...f.job, jobId: 'eleventh', jobDir: join(f.memoDir, 'eleventh') }), /あとで/);
  release(true); await waitFor(() => f.job.state === 'running');
  await waitFor(() => existsSync(join(f.inputDir, 'last-call.json')));
  await f.queue.cancel(f.job.jobId);
  await waitFor(() => f.job.state === 'cancelled'); await checkedCall(f.inputDir);
  for (let i = 2; i <= 10; i++) await f.queue.cancel(`c-0001-r${i}`);
});
