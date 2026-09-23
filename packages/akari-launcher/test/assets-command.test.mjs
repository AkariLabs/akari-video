import assert from 'node:assert/strict';
import test from 'node:test';

import { runAssetsCommand } from '../src/assets-command.mjs';

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
