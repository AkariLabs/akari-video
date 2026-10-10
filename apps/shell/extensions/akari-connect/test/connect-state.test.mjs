import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { detectApp, connectSnapshot, connectorStatus, readSettings, writeSettings, saveCredential } = require('../lib/node/connect-state.js');

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-connect-test-'));
  try {
    const home = path.join(root, 'home');
    const apps = path.join(root, 'Applications');
    fs.mkdirSync(home);
    fs.mkdirSync(apps);
    return run({ root, home, apps, env: { AKARI_HOME: path.join(home, '.akari'), AKARI_CREDENTIALS_FILE: path.join(home, '.akari', 'credentials.env') } });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('fake Applications detects nested and versioned apps', () => fixture(({ apps }) => {
  fs.mkdirSync(path.join(apps, 'Blender.app'));
  fs.mkdirSync(path.join(apps, 'Adobe Photoshop 2026', 'Adobe Photoshop 2026.app'), { recursive: true });
  fs.mkdirSync(path.join(apps, 'Adobe After Effects 2025', 'Adobe After Effects 2025.app'), { recursive: true });
  fs.mkdirSync(path.join(apps, 'Ableton Live 12 Suite.app'));
  fs.mkdirSync(path.join(apps, 'DaVinci Resolve', 'DaVinci Resolve.app'), { recursive: true });
  fs.mkdirSync(path.join(apps, 'Final Cut Pro.app'));
  for (const id of ['blender', 'photoshop', 'after-effects', 'ableton-live', 'davinci-resolve', 'final-cut-pro']) {
    assert.equal(detectApp(id, [apps], 'darwin'), true, id);
  }
  assert.equal(detectApp('blender', [], 'darwin'), false);
}));

test('fake credentials change only presence and masked tail', () => fixture(({ home, apps, env }) => {
  fs.mkdirSync(path.dirname(env.AKARI_CREDENTIALS_FILE), { recursive: true });
  fs.writeFileSync(env.AKARI_CREDENTIALS_FILE, 'FAL_KEY=fake-connect-key-1234\n', { mode: 0o600 });
  const snapshot = connectSnapshot({ env, home, roots: [apps], platform: 'darwin' });
  const fal = snapshot.rows.find(row => row.id === 'fal');
  assert.equal(fal.status, 'つながった');
  assert.equal(fal.maskedTail, '1234');
  assert.equal(fal.credentialSource, 'credentials.env');
  assert.equal(snapshot.rows.find(row => row.id === 'fish-audio').status, '準備が要る');
  assert.equal(JSON.stringify(snapshot).includes('fake-connect-key'), false);
}));

test('credential order is env, primary file, then legacy file', () => fixture(({ home, apps, env }) => {
  const primary = env.AKARI_CREDENTIALS_FILE;
  const legacy = path.join(home, '.config', 'akari-video', 'credentials.env');
  fs.mkdirSync(path.dirname(primary), { recursive: true });
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  fs.writeFileSync(primary, 'FAL_KEY=fake-primary-1111\n', { mode: 0o600 });
  fs.writeFileSync(legacy, 'FAL_KEY=fake-legacy-2222\n', { mode: 0o600 });
  const base = { AKARI_HOME: env.AKARI_HOME };
  const get = environment => connectSnapshot({ env: environment, home, roots: [apps], platform: 'darwin' }).rows.find(row => row.id === 'fal');
  assert.equal(get({ ...base, FAL_KEY: 'fake-env-3333' }).maskedTail, '3333');
  assert.equal(get({ ...base, FAL_KEY: 'fake-env-3333' }).credentialSource, 'env');
  assert.equal(get(base).maskedTail, '1111');
  fs.rmSync(primary);
  assert.equal(get(base).maskedTail, '2222');
  assert.equal(get(base).credentialSource, 'credentials.env');
}));

test('Higgsfield stores a combined fake key in the shared credentials file', () => fixture(({ home, apps, env }) => {
  saveCredential('higgsfield', 'fake-id:fake-secret', env, home);
  assert.equal(fs.readFileSync(env.AKARI_CREDENTIALS_FILE, 'utf8'), 'HF_KEY=fake-id:fake-secret\n');
  const row = connectSnapshot({ env, home, roots: [apps], platform: 'darwin' }).rows.find(item => item.id === 'higgsfield');
  assert.equal(row.status, 'つながった');
  assert.equal(row.credentialSource, 'credentials.env');
  assert.equal(row.maskedTail, 'cret');
}));

test('all four statuses and generation order persist without credentials', () => fixture(({ home, apps, env }) => {
  fs.mkdirSync(path.join(apps, 'Blender.app'));
  const file = path.join(env.AKARI_HOME, 'connectors.json');
  writeSettings(file, { version: 1, enabled: { fal: false, 'akari-video': false }, generationOrder: ['runway', 'fal'], fallbackOnFailure: false });
  assert.deepEqual(readSettings(file).generationOrder, ['runway', 'fal']);
  const snapshot = connectSnapshot({ env, home, roots: [apps], platform: 'darwin' });
  assert.deepEqual(snapshot.generationOrder.slice(0, 2), ['runway', 'fal']);
  assert.equal(snapshot.fallbackOnFailure, false);
  assert.equal(snapshot.rows.find(row => row.id === 'fal').enabled, false);
  assert.equal(snapshot.rows.find(row => row.id === 'akari-video').enabled, true);
  assert.equal(snapshot.rows.find(row => row.id === 'blender').status, '見つかった');
  assert.equal(snapshot.rows.find(row => row.id === 'final-cut-xml').status, '準備中');
  assert.equal(snapshot.rows.find(row => row.id === 'akari-video').status, 'つながった');
  assert.equal(connectorStatus({ kind: 'key' }, false, false), '準備が要る');
  assert.equal(fs.readFileSync(file, 'utf8').includes('KEY='), false);
}));
