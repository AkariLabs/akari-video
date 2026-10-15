import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { runConnectCommand, listConnectors, createSecretRedactor } from '../src/connect-command.mjs';
import { run } from '../src/cli.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const canonical = path.resolve(here, '../../../apps/shell/extensions/akari-connect/src/common/connectors.json');
const mirror = path.resolve(here, '../src/connect/connectors.json');
const extensionLib = path.resolve(here, '../../../apps/shell/extensions/akari-connect/lib/node/connect-state.js');

test('CLI catalog mirrors only the two supported groups', () => {
  const rows = JSON.parse(fs.readFileSync(mirror, 'utf8'));
  assert.deepEqual(rows, JSON.parse(fs.readFileSync(canonical, 'utf8')));
  assert.deepEqual([...new Set(rows.map(row => row.group))], ['tools', 'generate']);
  assert.deepEqual(rows.map(row => row.id), ['akari-video', '3d-recipes', 'fal', 'fish-audio', 'google-ai', 'elevenlabs', 'groq']);
});

test('plain list prints only the two groups and current status words', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-connect-list-'));
  try {
    const lines = [];
    const result = await runConnectCommand(['list'], { home: root, env: { AKARI_HOME: path.join(root, '.akari') }, roots: [], platform: 'darwin', log: line => lines.push(line) });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(lines.filter(line => !line.startsWith('  ')), ['AKARI の道具', '素材を作る']);
    assert.ok(lines.some(line => line.includes('Blender が必要')));
    assert.ok(lines.some(line => line.includes('鍵が必要')));
    assert.ok(lines.some(line => line.includes('使える')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('CLI sees a Blender command for 3D recipes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-connect-blender-'));
  try {
    const bin = path.join(root, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'blender'), '', { mode: 0o755 });
    const row = listConnectors({ env: { AKARI_HOME: path.join(root, '.akari'), PATH: bin }, home: root, platform: 'darwin' }).rows.find(item => item.id === '3d-recipes');
    assert.equal(row.status, 'ready');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('connect exec passes a fake key only through child env and redacts output', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-connect-cli-'));
  try {
    const home = path.join(root, 'home');
    const env = { AKARI_HOME: path.join(home, '.akari'), AKARI_CREDENTIALS_FILE: path.join(home, '.akari', 'credentials.env') };
    fs.mkdirSync(env.AKARI_HOME, { recursive: true });
    const secret = 'fake-connect-secret-9012';
    fs.writeFileSync(env.AKARI_CREDENTIALS_FILE, `FAL_KEY=${secret}\n`, { mode: 0o600 });
    const output = [];
    const errors = [];
    const script = 'process.stdout.write(process.env.FAL_KEY + "\\n");process.stderr.write(process.env.FAL_KEY + "\\n");process.exit(7)';
    const result = await runConnectCommand(['exec', 'fal', '--', process.execPath, '-e', script], {
      env, home, stdoutWrite: chunk => output.push(chunk), stderrWrite: chunk => errors.push(chunk)
    });
    assert.equal(result.exitCode, 7);
    assert.equal(output.join('').includes(secret), false);
    assert.equal(errors.join('').includes(secret), false);
    assert.match(output.join(''), /REDACTED/);
    assert.match(errors.join(''), /REDACTED/);
    assert.equal(listConnectors({ env, home, roots: [], platform: 'darwin' }).rows.find(row => row.id === 'fal').credential, true);
    assert.equal(listConnectors({ env, home, roots: [], platform: 'darwin' }).rows.find(row => row.id === 'fal').credentialSource, 'credentials.env');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('streaming output redacts a key split across child chunks', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-connect-chunks-'));
  try {
    const home = path.join(root, 'home');
    const env = { AKARI_HOME: path.join(home, '.akari'), AKARI_CREDENTIALS_FILE: path.join(home, '.akari', 'credentials.env') };
    fs.mkdirSync(env.AKARI_HOME, { recursive: true });
    const secret = 'fake-stream-key-6742';
    fs.writeFileSync(env.AKARI_CREDENTIALS_FILE, `FAL_KEY=${secret}\n`, { mode: 0o600 });
    const output = [];
    const script = 'const s=process.env.FAL_KEY;let i=0;const timer=setInterval(()=>{if(i===s.length){clearInterval(timer);return}process.stdout.write(s[i++])},2)';
    const result = await runConnectCommand(['exec', 'fal', '--', process.execPath, '-e', script], {
      env, home, stdoutWrite: chunk => output.push(chunk)
    });
    assert.equal(result.exitCode, 0);
    assert.equal(output.join('').includes(secret), false);
    assert.equal(output.join(''), '[REDACTED]');
    const chunks = [];
    const redactor = createSecretRedactor(secret, chunk => chunks.push(chunk));
    for (const character of secret) redactor.write(Buffer.from(character));
    redactor.end();
    assert.equal(chunks.join(''), '[REDACTED]');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('CLI credential source prefers env, then primary, then legacy', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-connect-source-'));
  try {
    const home = path.join(root, 'home');
    const primary = path.join(home, '.akari', 'credentials.env');
    const legacy = path.join(home, '.config', 'akari-video', 'credentials.env');
    fs.mkdirSync(path.dirname(primary), { recursive: true });
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(primary, 'FAL_KEY=fake-primary-1111\n', { mode: 0o600 });
    fs.writeFileSync(legacy, 'FAL_KEY=fake-legacy-2222\n', { mode: 0o600 });
    const base = { AKARI_HOME: path.join(home, '.akari') };
    const row = env => listConnectors({ env, home, roots: [], platform: 'darwin' }).rows.find(item => item.id === 'fal');
    assert.equal(row({ ...base, FAL_KEY: 'fake-env-3333' }).credentialSource, 'env');
    assert.equal(row(base).credentialSource, 'credentials.env');
    fs.rmSync(primary);
    assert.equal(row(base).credentialSource, 'credentials.env');
    assert.equal(JSON.stringify(listConnectors({ env: base, home, roots: [], platform: 'darwin' })).includes('fake-legacy-2222'), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('connect exec prefers env and removes other connector keys from child env', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-connect-exec-source-'));
  try {
    const home = path.join(root, 'home');
    const env = { AKARI_HOME: path.join(home, '.akari'), AKARI_CREDENTIALS_FILE: path.join(home, '.akari', 'credentials.env'),
      FAL_KEY: 'fake-preferred-1234', RUNWAYML_API_SECRET: 'fake-other-5678' };
    fs.mkdirSync(env.AKARI_HOME, { recursive: true });
    fs.writeFileSync(env.AKARI_CREDENTIALS_FILE, 'FAL_KEY=fake-file-9999\n', { mode: 0o600 });
    const output = [];
    const script = 'process.stdout.write(process.env.FAL_KEY + "|" + Boolean(process.env.RUNWAYML_API_SECRET))';
    const result = await runConnectCommand(['exec', 'fal', '--', process.execPath, '-e', script], {
      env, home, stdoutWrite: chunk => output.push(chunk)
    });
    assert.equal(result.exitCode, 0);
    assert.equal(output.join(''), '[REDACTED]|false');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('connect exec reports signal termination as a nonzero status', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-connect-signal-'));
  try {
    const home = path.join(root, 'home');
    const env = { AKARI_HOME: path.join(home, '.akari'), AKARI_CREDENTIALS_FILE: path.join(home, '.akari', 'credentials.env') };
    fs.mkdirSync(env.AKARI_HOME, { recursive: true });
    fs.writeFileSync(env.AKARI_CREDENTIALS_FILE, 'FAL_KEY=fake-signal-1234\n', { mode: 0o600 });
    const result = await runConnectCommand(['exec', 'fal', '--', process.execPath, '-e', 'process.kill(process.pid, "SIGTERM")'], { env, home });
    assert.ok(result.exitCode === 143 || result.exitCode === 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('CLI and extension agree on all connector statuses and ordering', { skip: !fs.existsSync(extensionLib) ? 'extension lib requires build:ext' : undefined }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-connect-parity-'));
  try {
    const home = path.join(root, 'home');
    const apps = path.join(root, 'Applications');
    const akariHome = path.join(home, '.akari');
    fs.mkdirSync(apps, { recursive: true });
    fs.mkdirSync(akariHome, { recursive: true });
    fs.mkdirSync(path.join(apps, 'Blender.app'));
    fs.mkdirSync(path.join(apps, 'Adobe Photoshop 2026', 'Adobe Photoshop 2026.app'), { recursive: true });
    fs.writeFileSync(path.join(akariHome, 'credentials.env'), 'FISH_AUDIO_API_KEY=fake-fish-4444\n', { mode: 0o600 });
    fs.writeFileSync(path.join(akariHome, 'connectors.json'), JSON.stringify({ version: 1, enabled: { fal: false }, generationOrder: ['runway', 'fish-audio'], fallbackOnFailure: false }));
    const env = { AKARI_HOME: akariHome, FAL_KEY: 'fake-env-5555' };
    const options = { env, home, roots: [apps], platform: 'darwin' };
    const require = createRequire(import.meta.url);
    const extension = require(extensionLib).connectSnapshot(options);
    const cli = listConnectors(options);
    assert.deepEqual(cli.generationOrder.slice(0, 1), ['fish-audio']);
    assert.equal(cli.rows.some(row => row.id === 'runway'), false);
    assert.deepEqual(cli.rows.map(({ id, status, enabled }) => ({ id, status, enabled })),
      extension.rows.map(({ id, status, enabled }) => ({ id, status, enabled })));
    assert.deepEqual(cli.rows.map(({ id, credentialSource }) => ({ id, credentialSource })),
      extension.rows.map(({ id, credentialSource }) => ({ id, credentialSource })));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('top-level run dispatches connect before project startup', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-connect-route-'));
  try {
    const home = path.join(root, 'home');
    const env = { AKARI_HOME: path.join(home, '.akari'), AKARI_CREDENTIALS_FILE: path.join(home, '.akari', 'credentials.env') };
    fs.mkdirSync(home);
    const lines = [];
    const result = await run(['connect', 'list', '--json'], { env, home, roots: [], platform: 'darwin', log: line => lines.push(line) });
    assert.equal(result.exitCode, 0);
    assert.equal(JSON.parse(lines.join('')).rows[0].id, 'akari-video');
    assert.equal(fs.existsSync(env.AKARI_HOME), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Japanese CLI list keeps its exact displayed lines after group and status IDs change', async () => {
  const previous = process.env.AKARI_LANG;
  process.env.AKARI_LANG = 'ja';
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-connect-copy-'));
  try {
    const lines = [];
    await runConnectCommand(['list'], { home: root, env: { AKARI_HOME: path.join(root, '.akari') }, roots: [],
      platform: 'darwin', log: line => lines.push(line) });
    assert.equal(`${lines.join('\n')}\n`, 'AKARI の道具\n  AKARI Video: 使える\n  3D レシピ: Blender が必要\n素材を作る\n  fal: 鍵が必要\n  Fish Audio: 鍵が必要\n  Google AI: 鍵が必要\n  ElevenLabs: 鍵が必要\n  Groq: 鍵が必要\n');
    const jsonLines = [];
    await runConnectCommand(['list', '--json'], { home: root, env: { AKARI_HOME: path.join(root, '.akari') }, roots: [],
      platform: 'darwin', log: line => jsonLines.push(line) });
    const rows = JSON.parse(jsonLines.join('')).rows;
    assert.deepEqual([...new Set(rows.map(row => row.group))], ['AKARI の道具', '素材を作る']);
    assert.deepEqual(rows.map(row => row.status), ['使える', 'Blender が必要', '鍵が必要', '鍵が必要', '鍵が必要', '鍵が必要', '鍵が必要']);
  } finally {
    if (previous === undefined) delete process.env.AKARI_LANG; else process.env.AKARI_LANG = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
