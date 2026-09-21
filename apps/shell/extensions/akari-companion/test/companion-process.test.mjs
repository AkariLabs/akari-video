import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { CompanionProcess, resolveCompanionBin } from '../lib/node/companion-process.js';
import { CompanionProcessManager } from '../lib/node/companion-process-manager.js';
import { readConfiguredCompanionAddress } from '../lib/node/companion-home.js';

const bin = fileURLToPath(new URL('./fixtures/fake-vibe.mjs', import.meta.url));
const canListen = await new Promise(resolve => {
  const server = createServer();
  server.once('error', () => resolve(false));
  server.listen(0, '127.0.0.1', () => server.close(() => resolve(true)));
});
const network = { skip: !canListen && 'sandbox cannot bind a localhost fixture server' };
const waitFor = async predicate => {
  const deadline = Date.now() + 5000;
  while (!await predicate()) {
    assert.ok(Date.now() < deadline, 'fixture event timed out');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};
async function fixture(t, mode = '') {
  const dir = await fs.mkdtemp(join(tmpdir(), 'companion-process-'));
  const cleanup = [];
  t.after(async () => {
    try { for (const stop of cleanup.reverse()) await stop(); }
    finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
  const report = join(dir, 'events.jsonl');
  const env = { ...process.env, AKARI_VIBE_BIN: bin, FAKE_VIBE_REPORT: report, FAKE_VIBE_MODE: mode };
  delete env.AKARI_COMPANION_CONFIG;
  const rows = async () => (await fs.readFile(report, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(JSON.parse);
  const options = { env, stopTimeoutMs: 300 };
  return { dir, env, options, rows, cleanup };
}
function owner() {
  const states = [], executions = [];
  return { states, executions,
    onConnectionState: (connected, panel) => states.push({ connected, panel }),
    execute: async instruction => { executions.push(instruction); return { id: instruction.id, ok: true }; }
  };
}
async function post(manager, path, value) {
  const address = manager.session.link.address;
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
    method: 'POST', headers: { authorization: `Bearer ${address.token}` }, body: JSON.stringify(value)
  });
  assert.equal(response.status, 200);
  await response.text();
}

test('stdin secret is absent from child argv/env and EOF stops the child', async t => {
  const f = await fixture(t, 'silent');
  const child = new CompanionProcess(f.options);
  f.cleanup.push(() => child.stop());
  const started = child.start(() => {}).catch(error => error);
  await waitFor(async () => (await f.rows()).some(row => row.type === 'input'));
  const input = (await f.rows()).find(row => row.type === 'input');
  assert.equal(input.validToken, true);
  assert.equal(input.tokenInArgv, false);
  assert.equal(input.tokenInEnv, false);
  assert.equal(input.serve, true);
  assert.equal(input.electronNode, true);
  await child.stop();
  assert.ok(await started instanceof Error);
  assert.ok((await f.rows()).some(row => row.type === 'stopped' && row.reason === 'stdin'));
  assert.throws(() => process.kill(input.pid, 0), { code: 'ESRCH' });
});

test('first-line port connects with authenticated manifest HMAC', network, async t => {
  const f = await fixture(t);
  const manager = new CompanionProcessManager(f.options);
  f.cleanup.push(() => manager.onStop());
  const a = owner();
  assert.equal(await manager.start(a), true);
  const rows = await f.rows();
  assert.equal(a.states.at(-1).panel.port, rows.find(row => row.type === 'listening').port);
  assert.ok(rows.some(row => row.type === 'manifest' && row.authenticated));
  assert.ok(rows.some(row => row.type === 'events'));
});

test('A to B ownership stops A before B and drops A state and instructions', network, async t => {
  const f = await fixture(t);
  const manager = new CompanionProcessManager(f.options);
  f.cleanup.push(() => manager.onStop());
  const a = owner(), b = owner();
  assert.equal(await manager.start(a), true);
  const oldLink = manager.session.link;
  assert.equal(await manager.start(b), true);
  assert.equal(a.states.at(-1).connected, false);
  assert.equal(b.states.at(-1).connected, true);
  const rows = await f.rows();
  const inputs = rows.filter(row => row.type === 'input');
  assert.equal(inputs.length, 2);
  assert.ok(rows.findIndex(row => row.type === 'stopped') < rows.findIndex(row => row.pid === inputs[1].pid));
  assert.throws(() => process.kill(inputs[0].pid, 0), { code: 'ESRCH' });
  await manager.sendState(a, { type: 'light', seq: 1, selection: [], panels: [] });
  await manager.sendState(b, { type: 'light', seq: 2, selection: [], panels: [] });
  assert.deepEqual((await f.rows()).filter(row => row.type === '/companion/state').map(row => row.value.seq), [2]);
  assert.equal((await oldLink.deps.execute({ id: 'old', kind: 'getState' })).error, 'stale-session');
  await post(manager, '/fixture/instruct', { id: 'new', kind: 'getState' });
  await waitFor(() => b.executions.length === 1);
  assert.equal(a.executions.length, 0);
  assert.equal(b.executions[0].id, 'new');
  await manager.release(a);
  assert.equal(manager.isOwner(b), true);
  await manager.release(b);
  assert.ok((await f.rows()).some(row => row.pid === inputs[1].pid && row.type === 'stopped' && row.reason === 'stdin'));
});

test('owner disconnect and backend shutdown close stdin and stop owned children', network, async t => {
  const f = await fixture(t);
  const manager = new CompanionProcessManager(f.options);
  f.cleanup.push(() => manager.onStop());
  const a = owner();
  for (const stop of [() => manager.release(a), () => manager.onStop()]) {
    assert.equal(await manager.start(a), true);
    const pid = (await f.rows()).filter(row => row.type === 'input').at(-1).pid;
    await stop();
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    assert.equal(a.states.at(-1).connected, false);
  }
  assert.equal(await manager.start(a), false);
});

test('no explicit config means temporary HOME companion file is never read', async t => {
  const f = await fixture(t, 'invalid');
  const home = join(f.dir, '.akari');
  await fs.mkdir(home);
  const file = join(home, 'companion.json');
  await fs.writeFile(file, '{}', { mode: 0o600 });
  let reads = 0;
  const originalRead = fs.readFile, originalStat = fs.lstat;
  t.mock.method(fs, 'readFile', async (...args) => { if (args[0] === file) reads++; return originalRead(...args); });
  t.mock.method(fs, 'lstat', async (...args) => { if (args[0] === file) reads++; return originalStat(...args); });
  for (const [key, value] of Object.entries({ HOME: f.dir, AKARI_HOME: home, AKARI_COMPANION_CONFIG: undefined })) {
    const previous = process.env[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  f.env.HOME = f.dir;
  f.env.AKARI_HOME = home;
  assert.equal(await readConfiguredCompanionAddress(f.env), undefined);
  const manager = new CompanionProcessManager({ ...f.options, log: () => {} });
  f.cleanup.push(() => manager.onStop());
  assert.equal(await manager.start(owner()), false);
  assert.equal(reads, 0);
});

test('explicit config connects without spawning and retains single owner', network, async t => {
  const f = await fixture(t);
  const child = new CompanionProcess(f.options);
  f.cleanup.push(() => child.stop());
  const address = await child.start(() => {});
  const config = join(f.dir, 'explicit.json');
  await fs.writeFile(config, JSON.stringify(address), { mode: 0o600 });
  const manager = new CompanionProcessManager({ ...f.options,
    env: { ...f.env, AKARI_COMPANION_CONFIG: config, AKARI_VIBE_BIN: join(f.dir, 'missing.mjs') } });
  f.cleanup.push(() => manager.onStop());
  const a = owner(), b = owner();
  assert.equal(await manager.start(a), true);
  assert.equal(await manager.start(b), true);
  assert.equal(a.states.at(-1).connected, false);
  assert.equal((await f.rows()).filter(row => row.type === 'input').length, 1);
  await manager.sendState(a, { type: 'light', seq: 1 });
  await manager.sendState(b, { type: 'light', seq: 2 });
  assert.deepEqual((await f.rows()).filter(row => row.type === '/companion/state').map(row => row.value.seq), [2]);
});

for (const mode of ['invalid', 'wrong-port', 'wrong-protocol', 'wrong-type', 'oversized', 'exit', 'silent']) {
  test(`startup ${mode} returns false with one log line and cleans up`, async t => {
    const f = await fixture(t, mode);
    const logs = [];
    const manager = new CompanionProcessManager({ ...f.options, log: line => logs.push(line) });
    f.cleanup.push(() => manager.onStop());
    assert.equal(await manager.start(owner()), false);
    assert.equal(logs.length, 1);
    assert.doesNotMatch(logs[0], /[\r\n]/);
    for (const row of (await f.rows()).filter(row => row.type === 'input')) {
      assert.throws(() => process.kill(row.pid, 0), { code: 'ESRCH' });
    }
  });
}

test('bad manifest HMAC fails startup and stops the child', network, async t => {
  const f = await fixture(t, 'bad-hmac');
  const logs = [];
  const manager = new CompanionProcessManager({ ...f.options, log: line => logs.push(line) });
  f.cleanup.push(() => manager.onStop());
  assert.equal(await manager.start(owner()), false);
  assert.equal(logs.length, 1);
  assert.ok(!(await f.rows()).some(row => row.type === 'events'));
});

for (const mode of ['ignore-end', 'ignore-term']) {
  test(`shutdown escalates ${mode} after stdin EOF`, async t => {
    const f = await fixture(t, mode);
    const child = new CompanionProcess(f.options);
    f.cleanup.push(() => child.stop());
    const started = child.start(() => {}).catch(error => error);
    await waitFor(async () => (await f.rows()).some(row => row.type === 'input'));
    await child.stop();
    await started;
    const rows = await f.rows();
    assert.ok(rows.some(row => row.type === 'stdin-end'));
    assert.ok(rows.some(row => row.type === 'sigterm'));
    assert.throws(() => process.kill(rows[0].pid, 0), { code: 'ESRCH' });
    if (mode === 'ignore-term') assert.equal(child.child.signalCode, 'SIGKILL');
  });
}

test('missing bundled executable fails without throwing and can retry', async t => {
  const f = await fixture(t);
  const logs = [];
  delete f.env.AKARI_VIBE_BIN;
  const manager = new CompanionProcessManager({ ...f.options, dirnameValue: f.dir, resourcesPath: f.dir, log: line => logs.push(line) });
  f.cleanup.push(() => manager.onStop());
  const a = owner();
  assert.equal(await manager.start(a), false);
  assert.equal(await manager.start(a), false);
  assert.equal(logs.length, 2);
  assert.equal((await f.rows()).length, 0);
});

test('bin resolution prefers override then resources then ancestor package', async t => {
  const f = await fixture(t);
  const relative = join('packages', 'akari-vibe', 'bin', 'akari-vibe.mjs');
  const ancestor = join(f.dir, relative);
  const resource = join(f.dir, 'resources', relative);
  for (const file of [ancestor, resource]) { await fs.mkdir(join(file, '..'), { recursive: true }); await fs.writeFile(file, ''); }
  const options = { env: {}, resourcesPath: join(f.dir, 'resources'), dirnameValue: join(f.dir, 'nested', 'backend') };
  assert.equal(await resolveCompanionBin({ ...options, env: { AKARI_VIBE_BIN: bin } }), bin);
  assert.equal(await resolveCompanionBin(options), resource);
  await fs.rm(resource);
  assert.equal(await resolveCompanionBin(options), ancestor);
});

test('ownership change during startup cancels the earlier child without overlap', async t => {
  const f = await fixture(t, 'silent');
  const logs = [];
  const manager = new CompanionProcessManager({ ...f.options, log: line => logs.push(line) });
  f.cleanup.push(() => manager.onStop());
  const first = manager.start(owner());
  await waitFor(async () => (await f.rows()).some(row => row.type === 'input'));
  f.env.FAKE_VIBE_MODE = 'invalid';
  const second = manager.start(owner());
  assert.equal(await first, false);
  assert.equal(await second, false);
  const rows = await f.rows(), inputs = rows.filter(row => row.type === 'input');
  assert.equal(inputs.length, 2);
  assert.ok(rows.findIndex(row => row.type === 'stopped') < rows.findIndex(row => row.pid === inputs[1].pid));
  assert.equal(logs.length, 1);
});
