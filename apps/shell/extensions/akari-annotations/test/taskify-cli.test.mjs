import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyCliFailure, findTaskifyCli, invokeTaskifyCli } from '../lib/node/taskify/taskify-cli.js';
const fake = fileURLToPath(new URL('./fixtures/taskify/fake-cli.mjs', import.meta.url));
const input = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'taskify-cli-test-'));
  await writeFile(join(dir, 'paper.png'), 'png'); await writeFile(join(dir, 'context.md'), 'memo');
  process.env.FAKE_TASKIFY_CALL = join(dir, 'last-call.json');
  process.env.FAKE_TASKIFY_STATE = join(dir, 'state.txt');
  await chmod(fake, 0o755); return dir;
};
const call = async dir => JSON.parse(await readFile(join(dir, 'last-call.json'), 'utf8'));
const flags = async (record, agent) => {
  assert.equal(record.cwd.startsWith(process.cwd()), false);
  assert.equal(record.stdinEnded, true); assert.equal(record.files.includes('audio.wav'), false);
  assert.ok((await realpath(record.tmpdir)).startsWith(record.cwd));
  if (agent === 'claude') {
    for (const flag of ['--output-format', '--json-schema', '--model', '--tools', '--no-session-persistence', '--setting-sources', '--strict-mcp-config'])
      assert.ok(record.args.includes(flag), flag);
    assert.equal(record.args[record.args.indexOf('--setting-sources') + 1], '');
    assert.equal(record.args[record.args.indexOf('--tools') + 1], 'Read');
    assert.equal(record.args[record.args.indexOf('--output-format') + 1], 'json');
    assert.doesNotMatch(record.args[record.args.indexOf('--json-schema') + 1], /\$schema|prefixItems|uniqueItems/);
  } else {
    for (const flag of ['exec', '--output-schema', '--json', '-o', '-s', '--ephemeral', '--skip-git-repo-check', '--ignore-user-config', '-C', '-m'])
      assert.ok(record.args.includes(flag), flag);
    assert.equal(record.args[record.args.indexOf('-s') + 1], 'read-only');
    assert.ok(record.args.some(arg => arg.startsWith('--image=')));
  }
};
test('fake Claude succeeds with exact isolation flags and closed stdin', async () => {
  const dir = await input(); process.env.FAKE_TASKIFY_MODE = 'success';
  const result = await invokeTaskifyCli({ agent: 'claude', bin: fake, inputDir: dir });
  assert.equal(result.output.tasks.length, 1); await flags(await call(dir), 'claude');
});
test('fake Codex uses the separate output schema and file', async () => {
  const dir = await input(); process.env.FAKE_TASKIFY_MODE = 'success';
  const result = await invokeTaskifyCli({ agent: 'codex', bin: fake, inputDir: dir });
  assert.equal(result.output.tasks.length, 1); await flags(await call(dir), 'codex');
});
test('bad JSON, login, exit, rate limit, schema and timeout are classified', async () => {
  for (const [mode, code] of [['bad', 'bad-json'], ['login', 'login'], ['exit', 'unknown'],
    ['rate', 'rate-limit'], ['schema', 'schema'], ['timeout', 'timeout']]) {
    const dir = await input(); process.env.FAKE_TASKIFY_MODE = mode;
    const result = await invokeTaskifyCli({ agent: 'claude', bin: fake, inputDir: dir, timeoutMs: mode === 'timeout' ? 400 : 1500 });
    assert.equal(result.error?.code, code, mode); await flags(await call(dir), 'claude');
  }
  assert.equal(classifyCliFailure(1, '', 'Bearer secret-token-value').raw.includes('secret-token-value'), false);
});
test('missing executable blocks', async () => {
  const dir = await input(); const result = await invokeTaskifyCli({ agent: 'claude', bin: join(dir, 'missing'), inputDir: dir });
  assert.equal(result.error?.code, 'cli-missing');
});
test('a broken explicit binary never falls back to PATH for either agent', async () => {
  const dir = await input();
  for (const agent of ['claude', 'codex']) {
    const available = join(dir, agent); await writeFile(available, '#!/bin/sh\nexit 0\n'); await chmod(available, 0o755);
    const key = agent === 'claude' ? 'AKARI_TASKIFY_CLAUDE_BIN' : 'AKARI_TASKIFY_CODEX_BIN';
    assert.equal(await findTaskifyCli(agent, { PATH: dir, [key]: join(dir, 'missing') }), undefined);
    assert.equal(await findTaskifyCli(agent, { PATH: dir, [key]: available }), available);
  }
});
