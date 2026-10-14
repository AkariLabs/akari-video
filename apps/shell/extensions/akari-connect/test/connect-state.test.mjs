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

test('Blender だけを検出する', () => fixture(({ apps }) => {
  fs.mkdirSync(path.join(apps, 'Blender.app'));
  fs.mkdirSync(path.join(apps, 'Adobe Photoshop 2026.app'));
  assert.equal(detectApp('blender', [apps], 'darwin'), true);
  assert.equal(detectApp('photoshop', [apps], 'darwin'), false);
  assert.equal(detectApp('blender', [], 'darwin'), false);
}));

test('Blender コマンドが PATH にあれば 3D レシピを使える', () => fixture(({ root, home, env }) => {
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'blender'), '', { mode: 0o755 });
  const snapshot = connectSnapshot({ env: { ...env, PATH: bin }, home, platform: 'darwin' });
  assert.equal(snapshot.rows.find(row => row.id === '3d-recipes').status, 'ready');
}));

test('素材を作る五行はメーカー印のロゴと色を持つ', () => fixture(({ home, apps, env }) => {
  const rows = connectSnapshot({ env, home, roots: [apps], platform: 'darwin' }).rows.filter(row => row.group === 'generate');
  assert.deepEqual(rows.map(row => row.maker), ['fal', 'fish', 'google', 'elevenlabs', 'groq']);
  assert.equal(rows.length, 5);
  for (const row of rows) {
    assert.match(row.logo, /^data:image\//);
    assert.ok(row.background);
    assert.ok(row.color);
    assert.ok(row.initials);
  }
}));

test('メーカー印が読めなくても一覧と頭文字を維持する', () => fixture(({ root, home, apps, env }) => {
  const snapshot = connectSnapshot({ env, home, roots: [apps], platform: 'darwin', makerRoots: [root] });
  assert.equal(snapshot.rows.length, 7);
  for (const row of snapshot.rows.filter(item => item.group === 'generate')) {
    assert.equal(row.logo, undefined);
    assert.ok(row.icon);
  }
}));

test('配布時の resources 構成からメーカー印を読む', () => fixture(({ root, home, apps, env }) => {
  const resources = path.join(root, 'resources');
  const file = path.join(resources, 'packages', 'schemas', 'ai-makers.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ fal: { logo: 'data:image/png;base64,fixture', initials: 'f', background: '#111111', color: '#ffffff' } }));
  const row = connectSnapshot({ env, home, roots: [apps], platform: 'darwin', makerRoots: [resources] }).rows.find(item => item.id === 'fal');
  assert.equal(row.logo, 'data:image/png;base64,fixture');
  assert.equal(row.background, '#111111');
}));

test('fake credentials change only presence and masked tail', () => fixture(({ home, apps, env }) => {
  fs.mkdirSync(path.dirname(env.AKARI_CREDENTIALS_FILE), { recursive: true });
  fs.writeFileSync(env.AKARI_CREDENTIALS_FILE, 'FAL_KEY=fake-connect-key-1234\n', { mode: 0o600 });
  const snapshot = connectSnapshot({ env, home, roots: [apps], platform: 'darwin' });
  const fal = snapshot.rows.find(row => row.id === 'fal');
  assert.equal(fal.status, 'ready');
  assert.equal(fal.maskedTail, '1234');
  assert.equal(fal.credentialSource, 'credentials.env');
  assert.equal(snapshot.rows.find(row => row.id === 'fish-audio').status, 'needs-key');
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

test('偽の鍵は現行サービスだけに保存できる', () => fixture(({ home, apps, env }) => {
  saveCredential('fish-audio', 'fake-fish-1234', env, home);
  assert.equal(fs.readFileSync(env.AKARI_CREDENTIALS_FILE, 'utf8'), 'FISH_AUDIO_API_KEY=fake-fish-1234\n');
  const row = connectSnapshot({ env, home, roots: [apps], platform: 'darwin' }).rows.find(item => item.id === 'fish-audio');
  assert.equal(row.status, 'ready');
  assert.equal(row.maskedTail, '1234');
  assert.throws(() => saveCredential('higgsfield', 'unused', env, home));
}));

test('旧 id を無視して二群の順序と設定を維持する', () => fixture(({ home, apps, env }) => {
  fs.mkdirSync(path.join(apps, 'Blender.app'));
  const file = path.join(env.AKARI_HOME, 'connectors.json');
  writeSettings(file, { version: 1, enabled: { fal: false, 'akari-video': false, higgsfield: true }, generationOrder: ['runway', 'fal', 'fish-audio'], fallbackOnFailure: true });
  assert.deepEqual(readSettings(file).generationOrder, ['fal', 'fish-audio']);
  assert.equal(readSettings(file).enabled.higgsfield, undefined);
  const snapshot = connectSnapshot({ env, home, roots: [apps], platform: 'darwin' });
  assert.deepEqual([...new Set(snapshot.rows.map(row => row.group))], ['tools', 'generate']);
  assert.deepEqual(snapshot.generationOrder.slice(0, 2), ['fal', 'fish-audio']);
  assert.equal(snapshot.fallbackOnFailure, true);
  assert.equal(snapshot.rows.find(row => row.id === 'fal').enabled, false);
  assert.equal(snapshot.rows.find(row => row.id === 'akari-video').enabled, true);
  assert.equal(snapshot.rows.find(row => row.id === '3d-recipes').status, 'ready');
  assert.equal(connectSnapshot({ env, home, roots: [], platform: 'darwin' }).rows.find(row => row.id === '3d-recipes').status, 'needs-blender');
  assert.equal(snapshot.rows.find(row => row.id === 'akari-video').status, 'ready');
  assert.equal(connectorStatus({ kind: 'key' }, false, false), 'needs-key');
  assert.deepEqual(snapshot.rows.filter(row => row.group === 'generate').map(row => row.id), ['fal', 'fish-audio', 'google-ai', 'elevenlabs', 'groq']);
  assert.equal(fs.readFileSync(file, 'utf8').includes('KEY='), false);
}));

test('登録した鍵は削除でき、接続設定には値を残さない', () => fixture(({ home, apps, env }) => {
  const { deleteCredential } = require('../lib/node/connect-state.js');
  saveCredential('fal', 'fake-remove-WXYZ', env, home);
  deleteCredential('fal', env, home);
  const file = env.AKARI_CREDENTIALS_FILE;
  assert.equal(fs.readFileSync(file, 'utf8').includes('fake-remove-WXYZ'), false);
  assert.equal(connectSnapshot({ env, home, roots: [apps], platform: 'darwin' }).rows.find(row => row.id === 'fal').status, 'needs-key');
}));
