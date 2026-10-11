// 3D モックアップの向き（--akari-3d-rot-x/y/z）のキーフレーム。3 本で 1 グループ rotation3d として、
// transform のグループと同じ規則（キーを入れた瞬間は見た目を変えない・自動キー・最後の点を消すと静的値へ戻る）で動く。
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ROTATION_3D_VARS, isScene3dItem, evaluatedItemVar, writeItemVarsAt, activateItemKeyframe,
  activateItemKeyframeGroup, removeItemKeyframeGroup, removeItemKeyframePoint, moveItemKeyframeGroup,
  hasItemKeyframeGroup, writeItemTransformAt, evaluatedItemTransform } = require('../lib/transform-keyframe-edit.js');
const { resolvePreviewItemWrite } = require('../lib/edit-v2-item-write.js');
const { readEditV2 } = require('../lib/edit-v2.js');
const { evaluateOverlayVars } = require('../../overlay-runtime/src/item-motion.js');

const phone = (extra = {}) => ({ id: 'phone', at: 0, duration: 120,
  source: { kind: 'html', path: 'assets/scene3d/phone-demo/fragment.html',
    vars: { '--phone-demo-finish': 'black-titanium', '--akari-3d-clip': 'none' } },
  transform: { x: 0, y: 0, scale: 1 }, ...extra });
const edit = item => ({ version: 2, output: { width: 1920, height: 1080, fps: 30 }, sources: [],
  tracks: [{ id: 'v', lane: 'visual', items: [item] }] });
const rot = (item, frame) => Object.fromEntries(ROTATION_3D_VARS.map(name => [name, evaluatedItemVar(item, frame, name)]));
const realPoints = item => (item.keyframes ?? []).filter(point => point.vars);

test('scene3d の html item を 3D と判定する（パス・値・キーのどれか）', () => {
  assert.equal(isScene3dItem(phone()), true);
  assert.equal(isScene3dItem({ ...phone(), source: { kind: 'html', path: 'overlays/title.html' } }), false);
  assert.equal(isScene3dItem({ ...phone(), source: { kind: 'html', path: 'x.html', vars: { '--akari-3d-rot-y': '10' } } }), true);
  assert.equal(isScene3dItem({ id: 'm', at: 0, duration: 10, source: { kind: 'media', src: 'a' } }), false);
});

test('キーが無ければ静的値（source.vars の文字列）に書き、他の vars は残す', () => {
  const next = writeItemVarsAt(phone(), 40, { '--akari-3d-rot-y': 35.0000001 });
  assert.equal(next.source.vars['--akari-3d-rot-y'], '35');
  assert.equal(next.source.vars['--phone-demo-finish'], 'black-titanium');
  assert.equal(next.keyframes, undefined);
  assert.deepEqual(rot(next, 0), { '--akari-3d-rot-x': 0, '--akari-3d-rot-y': 35, '--akari-3d-rot-z': 0 });
  assert.doesNotThrow(() => readEditV2(edit(next)));
});

test('キーを入れた瞬間は見た目を変えず、3 本そろって入る', () => {
  const start = writeItemVarsAt(phone(), 0, { '--akari-3d-rot-x': -10, '--akari-3d-rot-y': 20 });
  const keyed = activateItemKeyframeGroup(start, 30, 'rotation3d');
  assert.equal(hasItemKeyframeGroup(keyed, 'rotation3d'), true);
  assert.deepEqual(realPoints(keyed).map(point => point.t), [30]);
  assert.deepEqual(realPoints(keyed)[0].vars, { '--akari-3d-rot-x': -10, '--akari-3d-rot-y': 20, '--akari-3d-rot-z': 0 });
  for (const frame of [0, 30, 90]) assert.deepEqual(rot(keyed, frame), rot(start, frame));
  assert.doesNotThrow(() => readEditV2(edit(keyed)));
});

test('キーがあれば再生ヘッドに自動キーを打ち、間を easing で補間する', () => {
  let item = activateItemKeyframeGroup(phone(), 0, 'rotation3d');
  item = writeItemVarsAt(item, 60, { '--akari-3d-rot-y': 90 });
  assert.deepEqual(realPoints(item).map(point => point.t), [0, 60]);
  assert.equal(evaluatedItemVar(item, 30, '--akari-3d-rot-y'), 45);
  assert.equal(evaluatedItemVar(item, 30, '--akari-3d-rot-x'), 0);
  item.keyframes.find(point => point.t === 60).easing = { 'vars.--akari-3d-rot-y': 'in-quad' };
  assert.equal(evaluatedItemVar(item, 30, '--akari-3d-rot-y'), 22.5);
  assert.doesNotThrow(() => readEditV2(edit(item)));
});

test('プレビューの評価（item-motion）は edit-store と同じ値を出す', () => {
  let item = activateItemKeyframeGroup(phone(), 0, 'rotation3d');
  item = writeItemVarsAt(item, 60, { '--akari-3d-rot-y': 90, '--akari-3d-rot-z': -12 });
  item.keyframes.find(point => point.t === 60).easing = { 'vars.--akari-3d-rot-y': 'out-cubic' };
  const record = { start: 2, keyframes: item.keyframes, keyframeUnit: 'frames' };
  for (const frame of [0, 15, 30, 45, 60, 90]) {
    const runtime = evaluateOverlayVars(record, 2 + frame / 30, 30);
    for (const name of ROTATION_3D_VARS) {
      assert.ok(Math.abs(runtime[name] - evaluatedItemVar(item, frame, name)) < 1e-9, `${name} @${frame}`);
    }
  }
});

test('transform のグループを消しても、別の時刻の回転だけの点は消えない', () => {
  let item = activateItemKeyframeGroup(phone(), 0, 'rotation3d');
  item = writeItemVarsAt(item, 60, { '--akari-3d-rot-y': 90 });
  item = activateItemKeyframeGroup(item, 30, 'position');
  item = writeItemTransformAt(item, 90, { x: 200, y: 0 });
  const removed = removeItemKeyframeGroup(item, 30, 'position');
  assert.deepEqual(realPoints(removed).map(point => point.t), [0, 60]);
  assert.equal(evaluatedItemVar(removed, 30, '--akari-3d-rot-y'), 45);
  assert.equal(evaluatedItemTransform(removed, 90).x, 200);
});

test('回転のグループの最後の点を消すと、直前に見えていた値で静的値へ戻る', () => {
  let item = activateItemKeyframeGroup(phone(), 0, 'rotation3d');
  item = writeItemVarsAt(item, 60, { '--akari-3d-rot-y': 90 });
  item = removeItemKeyframeGroup(item, 0, 'rotation3d');
  assert.deepEqual(realPoints(item).map(point => point.t), [60]);
  assert.equal(item.source.vars['--akari-3d-rot-y'], '90');
  item = removeItemKeyframeGroup(item, 60, 'rotation3d');
  assert.equal(hasItemKeyframeGroup(item, 'rotation3d'), false);
  assert.equal(item.source.vars['--akari-3d-rot-y'], '90');
  assert.equal(evaluatedItemVar(item, 10, '--akari-3d-rot-y'), 90);
});

test('点ごと消す（タイムライン）でも回転は静的値へ戻る', () => {
  let item = activateItemKeyframeGroup(phone(), 10, 'rotation3d');
  item = writeItemVarsAt(item, 10, { '--akari-3d-rot-x': 25 });
  const removed = removeItemKeyframePoint(item, 10);
  assert.equal(hasItemKeyframeGroup(removed, 'rotation3d'), false);
  assert.equal(removed.source.vars['--akari-3d-rot-x'], '25');
});

test('回転のキーを別の時刻へ動かせる', () => {
  let item = activateItemKeyframeGroup(phone(), 0, 'rotation3d');
  item = writeItemVarsAt(item, 60, { '--akari-3d-rot-y': 90 });
  item = moveItemKeyframeGroup(item, 60, 90, 'rotation3d');
  assert.deepEqual(realPoints(item).map(point => point.t), [0, 90]);
  assert.equal(evaluatedItemVar(item, 45, '--akari-3d-rot-y'), 45);
});

test('アイテム全体の菱形は 3D なら回転も同じ点に入れる', () => {
  const item = activateItemKeyframe(writeItemVarsAt(phone(), 0, { '--akari-3d-rot-y': 15 }), 20);
  const point = item.keyframes.find(entry => entry.t === 20);
  assert.equal(point.vars['--akari-3d-rot-y'], 15);
  assert.ok(point.transform);
  const flat = activateItemKeyframe({ ...phone(), source: { kind: 'html', path: 'overlays/title.html' } }, 20);
  assert.equal(flat.keyframes.find(entry => entry.t === 20).vars, undefined);
});

test('検証: vars は -- 名と有限の数値だけ', () => {
  const bad = phone({ keyframes: [{ t: 0, vars: { '--akari-3d-rot-y': '10' } }, { t: 10 }] });
  assert.throws(() => readEditV2(edit(bad)), /有限の数値/);
  const badName = phone({ keyframes: [{ t: 0, vars: { rot: 10 } }, { t: 10 }] });
  assert.throws(() => readEditV2(edit(badName)), /CSS 変数名/);
  assert.throws(() => writeItemVarsAt(phone(), 0, { '--other': 1 }), /Invalid vars/);
});

test('プレビューからの書き戻し varsAt: キーが無ければ静的値、あれば再生ヘッドに自動キー', () => {
  const still = JSON.parse(resolvePreviewItemWrite(JSON.stringify(edit(phone())), {
    kind: 'overlay', itemId: 'phone', patch: { varsAt: { '--akari-3d-rot-y': 30, '--akari-3d-rot-x': 5 } },
    playheadSeconds: 1 }).candidateText);
  assert.equal(still.tracks[0].items[0].source.vars['--akari-3d-rot-y'], '30');
  assert.equal(still.tracks[0].items[0].keyframes, undefined);

  const keyed = activateItemKeyframeGroup(phone({ at: 30 }), 0, 'rotation3d');
  const written = JSON.parse(resolvePreviewItemWrite(JSON.stringify(edit(keyed)), {
    kind: 'overlay', itemId: 'phone', patch: { varsAt: { '--akari-3d-rot-y': 60 } },
    playheadSeconds: 3 }).candidateText).tracks[0].items[0];
  assert.deepEqual(realPoints(written).map(point => point.t), [0, 60]);
  assert.equal(written.keyframes.find(point => point.t === 60).vars['--akari-3d-rot-y'], 60);
});
