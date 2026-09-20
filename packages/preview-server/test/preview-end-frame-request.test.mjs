// 課題B（不具合メモ 第16項）: 最終フレームの次の終端位置で右の人物だけ消える。
//
// 再現条件（実機 2026-09-18）: 総尺 158682 フレーム / 30fps = 5289.4 秒。
// `bookend-outro-left` / `bookend-outro-right` はどちらも 158401 開始・281 フレームで
// 終了位置 158682 = 総尺と一致する（右素材が 1 フレーム短いわけではない）。
// 有効な最終フレーム 158681 では左右とも出るが、終端 158682 を要求すると追加映像
// （layers[]）の可視判定 `frame >= startFrame && frame < endFrame`（半開区間。
// packages/frame-engine/src/timeline/plan.ts の isLayerActiveAt）からちょうど外れ、
// ベース映像は最後の画を保持するため「左は残って右だけ黒くなる」に見えた。
//
// 半開区間の判定は frame-engine の正本なので触らない。**要求側（app.js）で描画要求を
// 最後の有効フレームへ揃える**のがこの検査の対象。尺（totalDuration・シークバー上限）は
// 1 フレームも変えない。
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const plan = readFileSync(
  new URL('../../frame-engine/src/timeline/plan.ts', import.meta.url), 'utf8');
const client = readFileSync(new URL('../src/frame-engine-client.ts', import.meta.url), 'utf8');

const FPS = 30;
const TOTAL_FRAMES = 158682;
const TOTAL_DURATION = TOTAL_FRAMES / FPS; // 5289.4
const LAST_VALID_FRAME = TOTAL_FRAMES - 1; // 158681
// 第16項の実機データ。左右どちらも同じ開始・長さで、終了位置が総尺と一致する。
const BOOKEND_LAYERS = [
  { id: 'bookend-outro-left', t: 158401 / FPS, duration: 281 / FPS },
  { id: 'bookend-outro-right', t: 158401 / FPS, duration: 281 / FPS },
];

function section(start, end) {
  const from = app.indexOf(start);
  assert.ok(from >= 0, `見つからない: ${start}`);
  const to = app.indexOf(end, from);
  assert.ok(to > from, `見つからない: ${end}`);
  return app.slice(from, to);
}

// app.js の実装そのものを動かす（totalDuration / fps はモジュール変数なので context へ入れる）。
function clampers(totalDuration = TOTAL_DURATION, fps = FPS) {
  const context = vm.createContext({ totalDuration, fps });
  vm.runInContext(section('function lastRenderableFrame()', '\nfunction applyFrameEngineSnapshot('), context);
  return {
    lastRenderableFrame: vm.runInContext('lastRenderableFrame', context),
    engineRenderTime: vm.runInContext('engineRenderTime', context),
  };
}

/** frame-engine の正本と同じ可視判定（plan.ts の isLayerActiveAt の本体をそのまま動かす）。 */
const isLayerActiveAt = (() => {
  const signature = 'export function isLayerActiveAt(layer: Pick<FrameEngineLayer, \'t\' | \'duration\'>,'
    + ' timeUs: TimelineTimeUs, fps: number): boolean {';
  const start = plan.indexOf(signature);
  assert.ok(start >= 0, 'isLayerActiveAt の署名が見つからない（frame-engine 側の drift）');
  const bodyStart = start + signature.length;
  const end = plan.indexOf('\n}', bodyStart);
  assert.ok(end > bodyStart);
  const body = plan.slice(bodyStart, end);
  const finite = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
  const fn = new Function('layer', 'timeUs', 'fps', 'finite', body);
  return (layer, timeUs, fps) => fn(layer, timeUs, fps, finite);
})();

/**
 * frame-engine-client.ts の renderFrame が要求時刻をフレームへ落とす規則。
 * seek: `Math.round(clamped * fps)` → `renderFrame(frameNumber / fps)`
 * renderFrame: `timeUs = Math.round(clamp(seconds) * 1e6)`
 */
function requestedFrameAndTimeUs(seconds, totalDuration = TOTAL_DURATION, fps = FPS) {
  const frameNumber = Math.round(Math.max(0, Math.min(seconds, totalDuration)) * fps);
  const timeUs = Math.round(Math.max(0, Math.min(frameNumber / fps, totalDuration)) * 1e6);
  return { frameNumber, timeUs };
}

test('要求時刻→フレームの規則が frame-engine-client の実装と一致している（drift 検知）', () => {
  assert.match(client, /const clamped = Math\.max\(0, Math\.min\(seconds, this\.totalDuration\)\);/u);
  assert.match(client, /const frameNumber = Math\.round\(clamped \* this\.fps\);/u);
  assert.match(client, /const frameNumber = Math\.round\(audioClockSeconds \* this\.fps\);/u);
  assert.match(
    client,
    /const timeUs = Math\.round\(Math\.max\(0, Math\.min\(seconds, this\.totalDuration\)\) \* 1e6\);/u,
  );
});

// 編集適用（rebuild）で尺が縮むと、復元位置のクランプ先が新しい終端位置そのものになる。
// この経路は app.js から触れない（prime() が先に 1 枚描く）ため、client 側でも同じ規律で揃える。
test('尺が縮んだ再構築の復元位置も最後の有効フレームへ揃える', () => {
  const renderableSeconds = (() => {
    const signature = 'function renderableSeconds(seconds: number, totalDuration: number, fps: number): number {';
    const start = client.indexOf(signature);
    assert.ok(start >= 0, 'renderableSeconds の署名が見つからない');
    const end = client.indexOf('\n}', start);
    return new Function('seconds', 'totalDuration', 'fps', client.slice(start + signature.length, end));
  })();

  assert.match(client, /start = renderableSeconds\(start, timeline\.totalDuration, fps\);/u);
  assert.equal(renderableSeconds(TOTAL_DURATION, TOTAL_DURATION, FPS), LAST_VALID_FRAME / FPS);
  // 尺が縮んだ場合（復元位置が新しい終端を超える）。
  const shorter = 100 / FPS;
  assert.equal(renderableSeconds(TOTAL_DURATION, shorter, FPS), 99 / FPS);
  assert.equal(renderableSeconds(1234.5, TOTAL_DURATION, FPS), 1234.5);
  assert.equal(renderableSeconds(-1, TOTAL_DURATION, FPS), 0);
  assert.equal(renderableSeconds(5, 0, FPS), 0, '尺が未確定なら丸めない（0 へクランプのみ）');

  // app.js 側と同じ値になること（規律が 2 箇所で食い違わないこと）。
  const { engineRenderTime } = clampers();
  assert.equal(renderableSeconds(TOTAL_DURATION, TOTAL_DURATION, FPS), engineRenderTime(TOTAL_DURATION));
});

test('第16項の再現: 終端位置（総尺）をそのまま要求すると追加映像だけが消える', () => {
  const { timeUs } = requestedFrameAndTimeUs(TOTAL_DURATION);
  for (const layer of BOOKEND_LAYERS) {
    assert.equal(isLayerActiveAt(layer, timeUs, FPS), false,
      `${layer.id}: 終端位置では半開区間から外れる（これが不具合の姿）`);
  }
});

test('最後の有効フレームへ揃える（総尺は 1 フレームも変えない）', () => {
  const { lastRenderableFrame, engineRenderTime } = clampers();

  assert.equal(lastRenderableFrame(), LAST_VALID_FRAME);
  assert.equal(engineRenderTime(TOTAL_DURATION), LAST_VALID_FRAME / FPS);
  assert.equal(requestedFrameAndTimeUs(engineRenderTime(TOTAL_DURATION)).frameNumber, LAST_VALID_FRAME);
  // 尺そのものは不変（丸めるのは描画要求だけ）。
  assert.equal(TOTAL_DURATION, 5289.4);
  assert.ok(engineRenderTime(TOTAL_DURATION) < TOTAL_DURATION);
});

test('最終有効フレームと終端位置で追加レイヤーの可視性が一致する', () => {
  const { engineRenderTime } = clampers();
  const visibilityAt = (seconds) => {
    const { timeUs } = requestedFrameAndTimeUs(engineRenderTime(seconds));
    return BOOKEND_LAYERS.map(layer => isLayerActiveAt(layer, timeUs, FPS));
  };

  const atLastValidFrame = visibilityAt(LAST_VALID_FRAME / FPS);
  const atTerminalPosition = visibilityAt(TOTAL_DURATION);

  assert.deepEqual(atLastValidFrame, [true, true], '最終有効フレームでは左右とも出る');
  assert.deepEqual(atTerminalPosition, atLastValidFrame,
    '終端位置の要求でも最終有効フレームと同じ可視性になる（左だけ残らない）');
});

test('再生の末尾（丸めで終端フレームへ飛ぶ半フレーム手前）でも消えない', () => {
  // renderPlayback は `Math.round(sec * fps)` でフレームを決めるため、丸めずに渡すと
  // 158681.5 フレーム相当（= 5289.383…秒）から終端フレームを要求してしまう。
  const { engineRenderTime } = clampers();
  const halfFrameBeforeEnd = (LAST_VALID_FRAME + 0.5) / FPS;
  assert.equal(requestedFrameAndTimeUs(halfFrameBeforeEnd).frameNumber, TOTAL_FRAMES,
    '素のまま渡すと終端フレームを要求する（これが停止直前の症状）');

  for (const seconds of [
    halfFrameBeforeEnd,
    (LAST_VALID_FRAME + 0.9) / FPS,
    TOTAL_DURATION,
    TOTAL_DURATION + 1,
  ]) {
    const { frameNumber, timeUs } = requestedFrameAndTimeUs(engineRenderTime(seconds));
    assert.ok(frameNumber <= LAST_VALID_FRAME, `${seconds}s の要求が ${frameNumber} フレーム`);
    for (const layer of BOOKEND_LAYERS) {
      assert.equal(isLayerActiveAt(layer, timeUs, FPS), true, `${layer.id} が ${seconds}s で消える`);
    }
  }
});

test('末尾以外・境界値は素通し（尺や途中のフレームを動かさない）', () => {
  const { engineRenderTime } = clampers();

  assert.equal(engineRenderTime(0), 0);
  assert.equal(engineRenderTime(-5), 0);
  assert.equal(engineRenderTime(1234.5), 1234.5);
  assert.equal(engineRenderTime(LAST_VALID_FRAME / FPS), LAST_VALID_FRAME / FPS);
  assert.equal(engineRenderTime(Number.NaN), 0);
  assert.equal(engineRenderTime(undefined), 0);

  // 尺が未確定（0）のときは何も丸めない（起動直後に 0 秒以外を要求しないため）。
  const empty = clampers(0, FPS);
  assert.equal(empty.engineRenderTime(0), 0);
  // fps が壊れている場合もクランプだけ行う。
  const noFps = clampers(TOTAL_DURATION, 0);
  assert.equal(noFps.engineRenderTime(TOTAL_DURATION), TOTAL_DURATION);

  // 1 フレームだけの尺でも負のフレームを要求しない。
  const single = clampers(1 / FPS, FPS);
  assert.equal(single.lastRenderableFrame(), 0);
  assert.equal(single.engineRenderTime(1 / FPS), 0);
});

test('配線: engine 面の描画要求はすべて engineRenderTime を通り、尺の公開は素のまま', () => {
  // シーク（End キー・シークバー右端・波形末尾・再構築後の復元はすべて seekTo を通る）。
  assert.match(app, /frameEngineRequestedTime = engineRenderTime\(outputTime\);/u);
  // 再生ループ（停止判定は素の壁時計、描画要求だけ丸める）。
  assert.match(app, /if \(frameEngineRequestedTime >= totalDuration\) \{ outputTime = engineRenderTime\(totalDuration\); pause\(\); return; \}/u);
  assert.match(app, /const frameEngineRenderTime = engineRenderTime\(frameEngineRequestedTime\);/u);
  assert.match(app, /renderPlayback\(frameEngineRenderTime\) \?\? frameEngineRenderTime;/u);
  // 起動時の初回シークと、スナップショット適用後の位置復元。
  assert.match(app, /frameEnginePreview\.seek\(engineRenderTime\(outputTime\)\)/u);
  assert.match(app, /outputTime = engineRenderTime\(outputTime\);\n\s+frameEngineRequestedTime = outputTime;/u);
  // 生の totalDuration を engine へ渡す経路が残っていない。
  assert.doesNotMatch(app, /seek\(frameEngineRequestedTime\) \?\? frameEngineRequestedTime;[\s\S]*?renderPlayback\(frameEngineRequestedTime\)/u);
  // 尺の公開（シークバー上限・時刻表示）は totalDuration のまま = 尺を縮めていない。
  assert.match(app, /seek\.max = totalDuration;/u);
  assert.match(app, /timeLabel\.textContent = `\$\{fm\(outputTime\)\} \/ \$\{fm\(totalDuration\)\}`;/u);
});
