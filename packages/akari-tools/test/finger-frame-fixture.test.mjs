import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// packages/akari-tools/test/fixtures/finger-frame-demo/ -- 合成 hand_pose トラック（実 Vision
// 検出ではない。両手が写る素材が repo/store に見つからなかったため。task report.md 参照）+
// 決定論生成の smptebars/testsrc2 素材による、finger-frame.mjs の実 CLI 一気通貫リグレッション。
// --apply は付けない（コミット済み edit.json を書き換えないため）-- stdout の JSON だけを検証する。
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = join(packageRoot, 'test', 'fixtures', 'finger-frame-demo');
const script = join(packageRoot, 'bin', 'finger-frame.mjs');

test('finger-frame fixture: 合成デモ project に対して既知の 1 レイヤー・1 ジェスチャ区間を再現する', () => {
  const result = spawnSync(process.execPath, [script, fixtureRoot, '--media', 'media/insert.mp4', '--kind', 'video'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.deepEqual(output.warnings, []);
  assert.deepEqual(output.gesture_intervals_source, [{ startT: 1.5, endT: 3.5 }]);
  assert.equal(output.layers.length, 1);

  const layer = output.layers[0];
  assert.equal(layer.kind, 'video');
  assert.equal(layer.src, 'media/insert.mp4');
  assert.equal(layer.t, 1.5);
  assert.equal(layer.duration, 1.9);
  // 手作りの hand_pose は元から TL=(0.25,0.25) 付近の非ねじれ四角形になるよう作ってある --
  // 最初のキーフレームがその通りに [TL,TR,BL,BR] 順で出ることを固定する（回帰ガード）。
  assert.deepEqual(layer.perspective.corners, [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]);
  assert.ok(layer.keyframes.length >= 2);
  assert.equal(layer.keyframes[0].t, 0);
  assert.equal(layer.keyframes[layer.keyframes.length - 1].t, 1.9);
});

test('finger-frame fixture: コミット済み edit.json は layers が空のまま（--apply 無しで書き換わっていない）', async () => {
  const { readFile } = await import('node:fs/promises');
  const edit = JSON.parse(await readFile(join(fixtureRoot, 'edit.json'), 'utf8'));
  assert.deepEqual(edit.layers, []);
});
