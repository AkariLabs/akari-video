// 回帰（2026-09-04 実機報告「3D モデルがずっと画面に残る」）:
// tick() の 3D 分岐が CSS アニメ同期の**手前**で continue していたため、3D 宣言を含む断片の
// CSS アニメが 1 本も pause / currentTime されず、壁時計で走り切って animation-fill-mode の
// 最終姿勢へ張り付いていた。実測した S4 断片は 3D ステージの出入りを 45 秒の CSS アニメだけで
// 持っているので、最終姿勢 = 画面中央に居座る絵になっていた。
//
// 書き出し（render-cut の rasterize.mjs）は __akariSyncAnimations を 3D コンテナにも等しく
// 掛けている。飛ばすとプレビューと書き出しで絵が食い違うため、ここは両者のパリティ条件。
// shell 側（packages/overlay-runtime）の同じ不具合は
// overlay-runtime/test-harness/overlay-runtime-tick.test.mjs が挙動で押さえている。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const read = name => readFile(path.resolve(import.meta.dirname, '..', name), 'utf8');
const [app, rasterize] = await Promise.all([
  read('public/app.js'),
  readFile(path.resolve(import.meta.dirname, '../../render-cut/src/rasterize.mjs'), 'utf8'),
]);

const tickBody = app.slice(app.indexOf('  function tick(t) {'), app.indexOf('  function applyProps(s) {'));

test('tick: CSS アニメ同期を 3D 分岐より先に通す（3D 断片を同期から外さない）', () => {
  const syncAt = tickBody.indexOf('for (const a of o._anims) { a.pause(); a.currentTime = ms; }');
  const threeAt = tickBody.indexOf('if (o.is3d) {');
  assert.ok(syncAt > 0, 'CSS アニメ同期のループが tick に無い');
  assert.ok(threeAt > 0, '3D 分岐が tick に無い');
  assert.ok(
    syncAt < threeAt,
    '3D 分岐が CSS アニメ同期より前にあると、3D 宣言を含む断片の CSS アニメが壁時計で走る',
  );
});

test('tick: CSS 同期を通したうえで three の描画も従来どおり呼ぶ', () => {
  const threeBranch = tickBody.slice(tickBody.indexOf('if (o.is3d) {'));
  assert.match(threeBranch, /threeRuntime\?\.render\(o\.el, ms \/ 1000, \{/u);
  assert.match(threeBranch, /maxRenderSize: PREVIEW_3D_MAX_RENDER_SIZE/u);
});

test('tick: three ランタイム読み込み待ちでも CSS 同期は止めない', () => {
  // 旧実装の `if (!o.threeReady) continue;` は、ランタイムが揃うまで断片ごと素通しにしていた。
  const threeBranch = tickBody.slice(tickBody.indexOf('if (o.is3d) {'));
  assert.doesNotMatch(threeBranch, /if \(!o\.threeReady\) continue;/u);
  assert.match(threeBranch, /if \(o\.threeReady\)/u);
});

test('書き出し側は 3D コンテナも同じ __akariSyncAnimations に掛ける（パリティの根拠）', () => {
  const seek = rasterize.slice(rasterize.indexOf('window.__akariSeek = async function(seconds)'));
  const loopEnd = seek.indexOf('window.__akariSyncAnimations(seconds);');
  assert.ok(loopEnd > 0, '__akariSeek が __akariSyncAnimations を呼んでいない');
  // 3D コンテナは pendingThreeDraws へ積むだけで、continue も除外もしない
  assert.doesNotMatch(seek.slice(0, loopEnd), /continue;/u);
});
