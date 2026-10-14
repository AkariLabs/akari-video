import { after } from 'node:test';
import { setLanguage } from '../../i18n/index.mjs';

setLanguage('ja');
after(() => setLanguage(undefined));
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { runAssetsCommand } from '../src/assets-command.mjs';
import { audioSetupDefaults } from '../../asset-resolver/src/bundled-catalog.mjs';

// `akari assets` は packages/asset-resolver の CLI（bin/akari-assets.mjs）への薄い委譲
// （タスク契約 2026-08-09-agent-assets-discovery）。resolver 側のロジックは呼び出さず、
// spawn の配線と引数転送・resolver 不在時のエラーだけをここで検証する
// （resolver 自体の単体テストは packages/asset-resolver/test/ に既にある）。

function recordingSpawn(status = 0) {
  const calls = [];
  const spawnAssetsCli = (cliPath, args, env) => {
    calls.push({ cliPath, args, env });
    return { status };
  };
  return { calls, spawnAssetsCli };
}

const FAKE_ASSETS = { assetResolverCliPath: '/fake/asset-resolver/bin/akari-assets.mjs' };
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const audioFetchScriptPath = path.join(repo, 'packages/audio-library-setup/bin/fetch-akari-sounds.mjs');

function audioFixture(t, checkout = false) {
  const base = mkdtempSync(path.join(tmpdir(), 'assets-audio-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'catalog');
  mkdirSync(path.join(root, 'audio'), { recursive: true });
  if (checkout) writeFileSync(path.join(base, '.git'), 'worktree');
  const home = path.join(base, 'home');
  const calls = [];
  const options = { env: { AKARI_HOME: home, AKARI_CATALOG_ROOT: root }, assets: { ...FAKE_ASSETS, audioFetchScriptPath },
    audioSetupDefaults,
    spawnAudioCli: (script, args, env) => { calls.push({ script, args, env }); return { status: 7 }; } };
  return { base, root, home, calls, options };
}

test('audio candidates and drop add defaults, preserving caller flags', async t => {
  const f = audioFixture(t);
  const candidates = await runAssetsCommand(['audio', 'candidates', '--out', 'custom.html'], f.options);
  assert.equal(candidates.exitCode, 7);
  assert.equal(path.basename(f.calls[0].script), 'generate-candidates-html.mjs');
  assert.deepEqual(f.calls[0].args, ['--out', 'custom.html', '--candidates', path.join(f.root, 'audio/candidates.json'),
    '--catalog-dir', path.join(f.home, 'catalog/audio')]);
  const drop = await runAssetsCommand(['audio', 'drop', '--catalog-dir', 'chosen', '--drop-dir', 'downloads', '--apply'], f.options);
  assert.equal(drop.exitCode, 7);
  assert.equal(path.basename(f.calls[1].script), 'register-drop-folder.mjs');
  assert.deepEqual(f.calls[1].args, ['--catalog-dir', 'chosen', '--drop-dir', 'downloads', '--apply',
    '--candidates', path.join(f.root, 'audio/candidates.json')]);
  await runAssetsCommand(['audio', 'drop', '--candidates', 'chosen.json'], f.options);
  assert.deepEqual(f.calls[2].args, ['--candidates', 'chosen.json', '--catalog-dir', path.join(f.home, 'catalog/audio')]);
});

test('audio uses checkout catalog for references and forwards gallery args unchanged', async t => {
  const f = audioFixture(t, true);
  await runAssetsCommand(['audio', 'candidates'], f.options);
  assert.ok(f.calls[0].args.includes(path.join(f.root, 'audio')));
  await runAssetsCommand(['audio', 'gallery', '--out', 'gallery.html'], f.options);
  assert.equal(path.basename(f.calls[1].script), 'gallery-helper.mjs');
  assert.deepEqual(f.calls[1].args, ['--out', 'gallery.html']);
});

test('audio help and errors do not start a child', async t => {
  const f = audioFixture(t);
  const logs = [], errors = [];
  const options = { ...f.options, log: value => logs.push(value), logError: value => errors.push(value) };
  assert.equal((await runAssetsCommand(['audio', '--help'], options)).exitCode, 0);
  assert.equal((await runAssetsCommand(['audio'], options)).exitCode, 0);
  assert.match(logs[0], /candidates/);
  assert.equal((await runAssetsCommand(['audio', 'unknown'], options)).exitCode, 1);
  assert.equal(f.calls.length, 0);
  assert.equal((await runAssetsCommand(['audio', 'drop'], { ...options, audioSetupDefaults: () => ({ root: null }) })).exitCode, 1);
  assert.equal((await runAssetsCommand(['audio', 'drop'], { ...options, assets: { audioFetchScriptPath: path.join(f.base, 'missing.mjs') } })).exitCode, 1);
  assert.equal((await runAssetsCommand(['audio', 'drop'], { ...options, assets: {} })).exitCode, 1);
  assert.ok(errors.length >= 3);
});

test('akari assets list: delegates to the resolver CLI and forwards args verbatim', async () => {
  const { calls, spawnAssetsCli } = recordingSpawn(0);
  const result = await runAssetsCommand(['list', '--category', 'still', '--json'], {
    assets: FAKE_ASSETS,
    spawnAssetsCli
  });
  assert.equal(result.exitCode, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cliPath, FAKE_ASSETS.assetResolverCliPath);
  assert.deepEqual(calls[0].args, ['list', '--category', 'still', '--json']);
});

test('akari assets fetch: forwards id + --project verbatim and reports the child exit code', async () => {
  const { calls, spawnAssetsCli } = recordingSpawn(1);
  const result = await runAssetsCommand(['fetch', 'br-typing-laptop', '--project', '/tmp/proj'], {
    assets: FAKE_ASSETS,
    spawnAssetsCli
  });
  assert.equal(result.exitCode, 1, 'locked/失敗時の非 0 exit をそのまま返す');
  assert.deepEqual(calls[0].args, ['fetch', 'br-typing-laptop', '--project', '/tmp/proj']);
});

test('akari assets: passes the injected env through to the resolver CLI (AKARI_HOME 隔離用)', async () => {
  const { calls, spawnAssetsCli } = recordingSpawn(0);
  const env = { AKARI_HOME: '/tmp/fake-home' };
  await runAssetsCommand(['sync'], { assets: FAKE_ASSETS, spawnAssetsCli, env });
  assert.equal(calls[0].env, env);
});

test('akari assets: errors with a Japanese message + exit 1 when the resolver is not bundled', async () => {
  const errors = [];
  const result = await runAssetsCommand(['list'], {
    assets: {},
    logError: (line) => errors.push(line)
  });
  assert.equal(result.exitCode, 1);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /resolver/);
  assert.match(errors[0], /[぀-ヿ一-鿿]/, '日本語エラーであること');
});

test('AKARI Sounds pack id selects the first-party pack fetcher', async () => {
  const calls = [];
  const result = await runAssetsCommand(['fetch', 'akari-sounds-sfx'], {
    assets: { assetResolverCliPath: 'resolver-cli', audioFetchScriptPath: 'sounds-script' },
    spawnSoundsCli: (script, args) => { calls.push([script, args]); return { status: 0 }; },
    spawnAssetsCli: () => { throw new Error('individual resolver must not receive a pack id'); },
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(calls, [['sounds-script', ['--pack', 'akari-sounds-sfx']]]);
});

test('AKARI Sounds jingle pack id reaches the first-party pack fetcher', async () => {
  const calls = [];
  const result = await runAssetsCommand(['fetch', 'akari-sounds-jingle'], {
    assets: { assetResolverCliPath: 'resolver-cli', audioFetchScriptPath: 'sounds-script' },
    spawnSoundsCli: (script, args) => { calls.push([script, args]); return { status: 0 }; },
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(calls, [['sounds-script', ['--pack', 'akari-sounds-jingle']]]);
});

test('catalog pack id fetches every member id', async () => {
  const { calls, spawnAssetsCli } = recordingSpawn(0);
  const result = await runAssetsCommand(['fetch', 'fixture-pack', '--project', 'project'], {
    assets: { assetResolverCliPath: 'resolver-cli', repoRoot: 'repo' },
    loadCatalog: async () => ({ items: [
      { id: 'clip-a', tags: ['pack:fixture-pack'] },
      { id: 'clip-b', tags: ['pack:fixture-pack'] },
      { id: 'clip-c', tags: [] },
    ] }),
    spawnAssetsCli,
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(calls.map(call => call.args), [
    ['fetch', 'clip-a', '--project', 'project'],
    ['fetch', 'clip-b', '--project', 'project'],
  ]);
});
