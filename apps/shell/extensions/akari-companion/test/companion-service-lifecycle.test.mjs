import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import loader from './fixtures/load-browser.cjs';
import { CompanionProcessManager } from '../lib/node/companion-process-manager.js';

const require = createRequire(import.meta.url);
require('reflect-metadata');
const inversify = require('@theia/core/shared/inversify');
const connectionModule = require('@theia/core/lib/node/messaging/connection-container-module');
const { ConnectionHandler } = require('@theia/core/lib/common/messaging');
const BackendApplicationContribution = Symbol('BackendApplicationContribution');
const serviceModule = loader.load('node/akari-companion-service.js', {
  '@theia/core/shared/inversify': inversify,
  '@akari-video/edit-store/lib/write-gate': { lintProjectCandidates: async () => ({ pass: true }) }
});
const backend = loader.load('node/akari-companion-backend-module.js', {
  '@theia/core/shared/inversify': inversify,
  '@theia/core/lib/node/backend-application': { BackendApplicationContribution },
  '@theia/core/lib/node/messaging/connection-container-module': connectionModule,
  './akari-companion-service': serviceModule
}).default;
const waitFor = async predicate => {
  const deadline = Date.now() + 5000;
  while (!await predicate()) {
    assert.ok(Date.now() < deadline, 'fixture event timed out');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};

async function setup(t) {
  const dir = await fs.mkdtemp(join(tmpdir(), 'companion-lifecycle-'));
  const cleanup = [];
  t.after(async () => {
    try { for (const stop of cleanup.reverse()) await stop(); }
    finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
  const report = join(dir, 'events.jsonl');
  const env = { ...process.env,
    AKARI_VIBE_BIN: fileURLToPath(new URL('./fixtures/fake-vibe.mjs', import.meta.url)),
    FAKE_VIBE_REPORT: report, FAKE_VIBE_MODE: 'silent'
  };
  delete env.AKARI_COMPANION_CONFIG;
  const logs = [];
  const manager = new CompanionProcessManager({ env, log: line => logs.push(line) });
  cleanup.push(() => manager.onStop());
  const root = new inversify.Container();
  root.load(backend);
  root.rebind(CompanionProcessManager).toConstantValue(manager);
  const makeConnection = () => {
    const container = root.createChild();
    container.load(...root.getAll(connectionModule.ConnectionContainerModule));
    let close;
    const client = {
      onDidCloseConnection: callback => { close = callback; },
      onConnectionState() {}, executeInstruction: async instruction => ({ id: instruction.id, ok: true })
    };
    const handler = container.getAll(ConnectionHandler).find(candidate => candidate.path === '/services/akari-companion');
    const service = handler.targetFactory(client);
    return { container, service, close: () => close() };
  };
  const rows = async () => (await fs.readFile(report, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(JSON.parse);
  return { root, manager, makeConnection, rows, logs };
}

test('connection containers isolate services and share one backend process manager', async t => {
  const f = await setup(t);
  const a = f.makeConnection(), b = f.makeConnection();
  assert.notEqual(a.service, b.service);
  assert.equal(a.service.manager, b.service.manager);
  assert.equal(f.root.get(BackendApplicationContribution), f.manager);
  assert.throws(() => f.root.get(serviceModule.AkariCompanionServiceImpl));
  await a.service.setEnabled(true);
  assert.equal((await f.rows()).length, 0, 'enabling does not launch a child');
});

test('owner connection close cancels startup and stops its child through stdin EOF', async t => {
  const f = await setup(t);
  const a = f.makeConnection(), b = f.makeConnection();
  const start = a.service.start();
  await waitFor(async () => (await f.rows()).some(row => row.type === 'input'));
  b.close();
  assert.equal(f.manager.isOwner(a.service.owner), true);
  a.close();
  assert.equal(await start, false);
  const rows = await f.rows();
  assert.ok(rows.some(row => row.type === 'stopped' && row.reason === 'stdin'));
  assert.throws(() => process.kill(rows[0].pid, 0), { code: 'ESRCH' });
  assert.equal(f.logs.length, 0);
  assert.equal(await a.service.start(), false);
});

test('disabling owner or stopping backend cancels startup and reaps its child', async t => {
  const f = await setup(t);
  const a = f.makeConnection();
  for (const stop of [() => a.service.setEnabled(false), () => f.root.get(BackendApplicationContribution).onStop()]) {
    await a.service.setEnabled(true);
    const previous = (await f.rows()).filter(row => row.type === 'input').length;
    const start = a.service.start();
    await waitFor(async () => (await f.rows()).filter(row => row.type === 'input').length > previous);
    await stop();
    assert.equal(await start, false);
    const pid = (await f.rows()).filter(row => row.type === 'input').at(-1).pid;
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  }
  assert.equal(f.logs.length, 0);
});

test('ownership revoked during edit validation cannot dispatch to the old client', async () => {
  let finish;
  const { AkariCompanionServiceImpl } = loader.load('node/akari-companion-service.js', {
    '@akari-video/edit-store/lib/write-gate': {},
    './companion-apply-edit-gate': { gateCompanionApplyEdit: () => new Promise(resolve => { finish = resolve; }) }
  });
  const service = new AkariCompanionServiceImpl();
  let owner = true, executed = 0;
  service.manager = { isOwner: () => owner };
  service.client = { executeInstruction: async () => { executed++; } };
  const result = service.executeGated({ id: 'old-edit', kind: 'applyEdit' });
  owner = false;
  finish(undefined);
  assert.equal((await result).error, 'stale-session');
  assert.equal(executed, 0);
});
