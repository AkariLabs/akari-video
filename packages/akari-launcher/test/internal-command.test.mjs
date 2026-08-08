import assert from 'node:assert/strict';
import test from 'node:test';

import { runInternalCommand } from '../src/internal-command.mjs';

const assets = {
  beatmapScript: '/repo/packages/akari-tools/bin/beatmap.mjs',
  probeFrameScript: '/repo/packages/akari-tools/bin/probe-frame.mjs',
  renderWhenIdleScript: '/repo/packages/akari-tools/bin/render-when-idle.sh'
};

async function runAndCapture(args) {
  const calls = [];
  const result = await runInternalCommand(args, {
    assets,
    spawn: (...spawnArgs) => {
      calls.push(spawnArgs);
      return { status: 7 };
    }
  });
  return { result, calls };
}

test('akari internal --help: 3 サブコマンドを自己記述する', async () => {
  const lines = [];
  const result = await runInternalCommand(['--help'], { assets, log: (line) => lines.push(line) });
  assert.equal(result.exitCode, 0);
  for (const command of ['beat-sync-beatmap', 'beat-sync-probe-frame', 'beat-sync-render-when-idle']) {
    assert.match(lines.join('\n'), new RegExp(command));
  }
});

test('akari internal beat-sync-beatmap: node 子プロセスへ引数を転送する', async () => {
  const { result, calls } = await runAndCapture(['beat-sync-beatmap', 'project', 'track']);
  assert.equal(result.exitCode, 7);
  assert.deepEqual(calls[0], [process.execPath, [assets.beatmapScript, 'project', 'track'], { stdio: 'inherit' }]);
});

test('akari internal beat-sync-probe-frame: node 子プロセスへ引数を転送する', async () => {
  const { calls } = await runAndCapture(['beat-sync-probe-frame', 'project', '1.5']);
  assert.deepEqual(calls[0], [process.execPath, [assets.probeFrameScript, 'project', '1.5'], { stdio: 'inherit' }]);
});

test('akari internal beat-sync-render-when-idle: shebang 実行へ引数を転送する', async () => {
  const { calls } = await runAndCapture(['beat-sync-render-when-idle', 'project', '--max-load', '2']);
  assert.deepEqual(calls[0], [assets.renderWhenIdleScript, ['project', '--max-load', '2'], { stdio: 'inherit' }]);
});

test('akari internal: 不明なサブコマンドは一覧を添えて exit 1', async () => {
  const lines = [];
  const errors = [];
  const result = await runInternalCommand(['unknown'], {
    assets,
    log: (line) => lines.push(line),
    logError: (line) => errors.push(line)
  });
  assert.equal(result.exitCode, 1);
  assert.match(errors.join('\n'), /不明な internal サブコマンド/);
  assert.match(lines.join('\n'), /beat-sync-beatmap/);
});

test('akari internal: 実行スクリプトが無ければ日本語エラーで exit 1', async () => {
  const errors = [];
  const result = await runInternalCommand(['beat-sync-beatmap'], {
    assets: { ...assets, beatmapScript: null },
    logError: (line) => errors.push(line),
    spawn: () => {
      throw new Error('spawn は呼ばれてはいけない');
    }
  });
  assert.equal(result.exitCode, 1);
  assert.match(errors.join('\n'), /実行スクリプトが見つかりません/);
});
