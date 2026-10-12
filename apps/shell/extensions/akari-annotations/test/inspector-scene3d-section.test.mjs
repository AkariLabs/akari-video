import './helpers/ja-language.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

import { scene3dSection } from '../lib/browser/inspector/scene3d-section.js';
import { OVERLAY_SECTIONS } from '../lib/browser/inspector/sections/overlay-sections.js';
import { TREE_ITEM_SECTIONS } from '../lib/browser/inspector/sections/tree-item-sections.js';
import { treeItemOutputStart } from '../lib/browser/inspector/tree-item-output-start.js';
import { readInspectorAdjustSnapshot } from '../lib/browser/inspector/adjust-fields.js';
import { maskSourceOptionsForSources } from '../lib/browser/inspector/mask-fields.js';
import { timelineMethod } from './helpers/perspective-transition-fixture.mjs';
import { deriveTimelineKeyframeRows, keyframeRowPropertyOf, keyframeValueAt }
  from '../lib/browser/timeline/timeline-keyframe-rows.js';
import { activateV2ItemRotation3dKeyframe, removeV2Keyframe, moveV2Keyframe,
  setV2SegmentEasing, writeV2ItemVarsAt } from '../lib/common/edit-v2-mutations.js';

const vars = { '--akari-3d-rot-x': '0', '--akari-3d-rot-y': '0', '--akari-3d-rot-z': '0' };
const source = () => ({ kind: 'html', path: 'assets/scene3d/demo/scene.html', vars: { ...vars } });
const doc = () => ({ version: 2, output: { width: 1920, height: 1080, fps: 30 }, sources: [],
  tracks: [{ id: 'visual', lane: 'visual', items: [
  { id: 'scene', at: 0, duration: 90, source: source() }
] }] });
const item = document => document.tracks[0].items[0];
const snapshot = () => ({ kind: 'overlay', id: 'scene', outputStart: 0, duration: 3,
  trackName: '映像', clipName: '3D', payload: { html: source().path, vars: { ...vars } } });
const childSnapshot = () => ({ kind: 'item', id: 'scene', itemKind: 'item', parentId: 'canvas',
  trackId: 'visual', outputStart: 1.5, playheadSeconds: 3.5, duration: 3, durationFrames: 90,
  sourceKind: 'html', source: { ...source(), vars: { ...vars, '--akari-3d-rot-y': '35' } },
  trackName: '映像', clipName: '3D' });
const canvasDoc = () => ({ version: 2, output: { width: 1920, height: 1080, fps: 30 }, sources: [],
  tracks: [{ id: 'visual', lane: 'visual', items: [{ id: 'canvas', at: 30, duration: 120,
    source: { kind: 'group', canvas: { origin: 'user', durationMode: 'fixed' } },
    items: [{ id: 'scene', at: 15, duration: 90, source: source() }] }] }] });
const canvasChild = document => document.tracks[0].items[0].items[0];
const treeItemSnapshot = timelineMethod('treeItemSnapshot', {
  treeItemOutputStart, readInspectorAdjustSnapshot, maskSourceOptionsForSources
});

test('キャンバスの子は行がなくても親の時刻を含む出力位置で評価する', () => {
  const edit = canvasDoc();
  edit.tracks[0].items[0].at = 30;
  const child = canvasChild(edit);
  child.at = 0;
  child.keyframes = [
    { t: 30, vars: { '--akari-3d-rot-y': 90 } },
    { t: 90, vars: { '--akari-3d-rot-y': 180 } }
  ];
  assert.equal(treeItemOutputStart(edit, child.id, child.at, 30), 1);
  assert.equal(treeItemOutputStart(edit, 'missing', 15, 30), 0.5);
  const nested = structuredClone(edit);
  nested.tracks[0].items[0].items = [{ id: 'inner', at: 15, duration: 90,
    source: { kind: 'group' }, items: [canvasChild(nested)] }];
  assert.equal(treeItemOutputStart(nested, child.id, child.at, 30), 1.5);
  const selection = { kind: 'item', id: child.id, itemKind: 'part', parentId: 'canvas', trackId: 'visual' };
  const state = { fps: 30, editDocument: edit, expandedTimelineTreeRows: [], sourceMap: new Map(),
    rawKeyframeItem: () => edit.tracks[0].items[0], trackDisplayNameForItem: () => '映像' };
  const selected = treeItemSnapshot.call(state, selection, child);
  assert.equal(selected.outputStart, 1);
  selected.playheadSeconds = 2;
  const field = TREE_ITEM_SECTIONS(selected, async () => ({ ok: true }), undefined, undefined, { fps: 30 })
    .find(section => section.id === 'scene3d').fields[1];
  assert.equal(field.getEditValue(), '90');
  state.expandedTimelineTreeRows = [{ id: child.id, at: 1, duration: 3 }];
  assert.equal(treeItemSnapshot.call(state, selection, child).outputStart, 1);
});

test('3D 欄は回転 3 軸を scrub-number、動きを select として組み立てる', async () => {
  const writes = [];
  const selected = snapshot();
  const section = scene3dSection(selected, async request => { writes.push(request); return { ok: true }; },
    { meta: { motion_presets: [{ clip: 'Turntable', label: 'ターンテーブル' }] } });
  assert.equal(section.label, '3D');
  assert.deepEqual(section.fields.map(field => field.label), ['回転 X', '回転 Y', '回転 Z', '動き']);
  assert.deepEqual(section.fields.slice(0, 3).map(field => field.inputKind),
    ['scrub-number', 'scrub-number', 'scrub-number']);
  assert.equal(section.fields[3].inputKind, 'select');
  assert.equal(section.fields[3].optionLabels.Turntable, 'ターンテーブル');
  await section.fields[3].write(selected, 'Turntable');
  assert.equal(writes[0].path, 'source.vars.--akari-3d-clip');
});

test('3D セクションは 3D item だけに出て、画面と回転のツマミが重複しない', () => {
  const selected = snapshot();
  selected.payload.vars['--akari-screen-src'] = 'assets/screen.mp4';
  const knobs = [
    { name: '--akari-screen-src', type: 'media', group: '画面' },
    { name: '--akari-3d-rot-y', type: 'slider', group: '回転' }
  ];
  const meta = { knobs: [{ cssVar: '--akari-screen-src', type: 'media' }] };
  const sections = OVERLAY_SECTIONS(selected, async () => ({ ok: true }), knobs, undefined, new Map(), { meta });
  assert.equal(sections.find(section => section.id === 'scene3d').label, '3D');
  assert.equal(sections.findIndex(section => section.id === 'scene3d'),
    sections.findIndex(section => section.id === 'transform') + 1);
  assert.equal(sections.flatMap(section => section.fields).some(field => field.name === 'var---akari-screen-src'), false);
  assert.equal(sections.flatMap(section => section.fields).some(field => field.name === 'var---akari-3d-rot-y'), false);
  assert.equal(sections.find(section => section.id === 'transform').fields.some(field => field.name === 'transform-rotate'), false);
  selected.payload.transform = { rotate: 15 };
  assert.equal(OVERLAY_SECTIONS(selected, async () => ({ ok: true })).find(section => section.id === 'transform')
    .fields.some(field => field.name === 'transform-rotate'), true);
  selected.payload.html = 'assets/overlay/demo/scene.html';
  selected.payload.vars = {};
  assert.equal(OVERLAY_SECTIONS(selected, async () => ({ ok: true })).some(section => section.id === 'scene3d'), false);
  selected.payload.vars['--akari-3d-rot-y'] = '0';
  assert.equal(OVERLAY_SECTIONS(selected, async () => ({ ok: true })).some(section => section.id === 'scene3d'), true);
});

test('キャンバスの子の 3D item に 3D 欄を出し、0 度の 2D 回転欄を隠す', async () => {
  const selected = childSnapshot();
  const writes = [];
  const write = async request => { writes.push(request); return { ok: true }; };
  const sections = TREE_ITEM_SECTIONS(selected, write);
  assert.equal(sections.findIndex(section => section.id === 'scene3d'),
    sections.findIndex(section => section.id === 'transform') + 1);
  assert.deepEqual(sections.find(section => section.id === 'scene3d').fields.map(field => field.label),
    ['回転 X', '回転 Y', '回転 Z', '動き']);
  await sections.find(section => section.id === 'scene3d').fields[3].write(selected, 'none');
  assert.equal(writes[0].path, 'source.vars.--akari-3d-clip');
  assert.equal(sections.find(section => section.id === 'transform').fields.some(field => field.name === 'transform-rotate'), false);
  selected.transform = { rotate: 12 };
  assert.equal(TREE_ITEM_SECTIONS(selected, async () => ({ ok: true })).find(section => section.id === 'transform')
    .fields.some(field => field.name === 'transform-rotate'), true);
  selected.source = { kind: 'html', path: 'assets/overlay/demo/scene.html', vars: {} };
  assert.equal(TREE_ITEM_SECTIONS(selected, async () => ({ ok: true })).some(section => section.id === 'scene3d'), false);
});

test('3D 回転の数値は再生ヘッドの評価値を表示する', () => {
  const selected = childSnapshot();
  selected.keyframes = [
    { t: 0, vars: { '--akari-3d-rot-y': 0 } },
    { t: 60, vars: { '--akari-3d-rot-y': 120 } }
  ];
  const field = TREE_ITEM_SECTIONS(selected, async () => ({ ok: true }), undefined, undefined, { fps: 30 })
    .find(section => section.id === 'scene3d').fields[1];
  assert.equal(field.getEditValue(), '120');
  selected.playheadSeconds = 2.5;
  const middle = TREE_ITEM_SECTIONS(selected, async () => ({ ok: true }), undefined, undefined, { fps: 30 })
    .find(section => section.id === 'scene3d').fields[1];
  assert.equal(middle.getEditValue(), '60');
  const overlay = snapshot();
  overlay.payload.vars['--akari-3d-rot-y'] = '35';
  overlay.keyframes = selected.keyframes;
  overlay.playheadSeconds = 2;
  assert.equal(OVERLAY_SECTIONS(overlay, async () => ({ ok: true }), [], undefined, new Map(), { fps: 30 })
    .find(section => section.id === 'scene3d').fields[1].getEditValue(), '120');
});

test('キャンバスの子の 3D 菱形は再生ヘッドの点で on/off になる', () => {
  const sourceText = readFileSync(new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('inspector.ts', sourceText, ts.ScriptTarget.Latest, true);
  const widgetClass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariInspectorWidget');
  const method = widgetClass.members.find(node => node.name?.getText(ast) === 'keyframeSeatOptions');
  const code = ts.transpileModule(`class Widget { ${method.getText(ast)} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2021 }
  }).outputText;
  const seat = new Function('keyframeRowPropertyOf', 'keyframeValueAt',
    `${code}; return Widget.prototype.keyframeSeatOptions;`)(keyframeRowPropertyOf, keyframeValueAt);
  const selected = childSnapshot();
  selected.keyframes = [
    { t: 0, vars: { '--akari-3d-rot-y': 0 } },
    { t: 60, vars: { '--akari-3d-rot-y': 120 } }
  ];
  const requests = [];
  const widget = { model: { fps: 30, requestKeyframe: request => { requests.push(request); } } };
  assert.equal(seat.call(widget, selected, 'rotation3d-x', 0).active, true);
  assert.equal(seat.call(widget, selected, 'rotation3d-x', 0).hasKeyframes, true);
  selected.playheadSeconds = 2.5;
  const middle = seat.call(widget, selected, 'rotation3d-x', 60);
  assert.equal(middle.active, false);
  middle.onToggle();
  assert.deepEqual(requests[0], { action: 'toggle', itemId: 'scene', property: 'rotation3d.x', value: 60 });
});

test('キャンバスの子の 3D キーは item 内フレームに入る', () => {
  let edit = activateV2ItemRotation3dKeyframe(canvasDoc(), { itemId: 'scene', t: 0 });
  edit = activateV2ItemRotation3dKeyframe(edit, { itemId: 'scene', t: 60 });
  edit = writeV2ItemVarsAt(edit, { itemId: 'scene', t: 60, values: { '--akari-3d-rot-y': 120 } });
  assert.deepEqual(canvasChild(edit).keyframes.map(point => point.t), [0, 60]);
  assert.equal(canvasChild(edit).keyframes[1].vars['--akari-3d-rot-y'], 120);
  assert.equal(canvasChild(edit).at, 15);
  assert.equal(edit.tracks[0].items[0].at, 30);
});

test('3D 菱形は同じフレームの 3 軸をまとめて on/off する', () => {
  let edit = activateV2ItemRotation3dKeyframe(doc(), { itemId: 'scene', t: 0 });
  edit = activateV2ItemRotation3dKeyframe(edit, { itemId: 'scene', t: 60 });
  assert.deepEqual(item(edit).keyframes.map(point => point.t), [0, 60]);
  assert.equal(Object.keys(item(edit).keyframes[0].vars).length, 3);
  edit = removeV2Keyframe(edit, { itemId: 'scene', property: 'rotation3d', t: 60 });
  assert.equal(item(edit).keyframes.filter(point => point.vars).length, 1);
  edit = removeV2Keyframe(edit, { itemId: 'scene', property: 'rotation3d', t: 0 });
  assert.equal(item(edit).keyframes, undefined);
});

test('回転の数値はキーなしで静的値、キーありで再生ヘッドの点へ書く', () => {
  let edit = writeV2ItemVarsAt(doc(), { itemId: 'scene', t: 30,
    values: { '--akari-3d-rot-y': 45 } });
  assert.equal(item(edit).source.vars['--akari-3d-rot-y'], '45');
  assert.equal(item(edit).keyframes, undefined);
  edit = activateV2ItemRotation3dKeyframe(edit, { itemId: 'scene', t: 0 });
  edit = activateV2ItemRotation3dKeyframe(edit, { itemId: 'scene', t: 60 });
  edit = writeV2ItemVarsAt(edit, { itemId: 'scene', t: 30,
    values: { '--akari-3d-rot-y': 90 } });
  assert.equal(item(edit).keyframes.find(point => point.t === 30).vars['--akari-3d-rot-y'], 90);
});

test('3D 回転の行・点移動・easing は vars の 3 軸に対応する', () => {
  let edit = activateV2ItemRotation3dKeyframe(doc(), { itemId: 'scene', t: 0 });
  edit = activateV2ItemRotation3dKeyframe(edit, { itemId: 'scene', t: 60 });
  edit = writeV2ItemVarsAt(edit, { itemId: 'scene', t: 60, values: { '--akari-3d-rot-y': 180 } });
  const rows = deriveTimelineKeyframeRows(item(edit));
  const row = rows.find(entry => entry.property === 'rotation3d');
  assert.equal(row.label, '3D 回転');
  assert.deepEqual(row.diamonds.map(point => point.t), [0, 60]);
  assert.equal(keyframeRowPropertyOf('rotation3d.y'), 'rotation3d');
  assert.equal(keyframeValueAt(item(edit).keyframes[1], 'rotation3d')['--akari-3d-rot-y'], 180);
  edit = setV2SegmentEasing(edit, { itemId: 'scene', property: 'rotation3d', toT: 60, easing: 'ease-in-out' });
  for (const axis of 'xyz') assert.equal(item(edit).keyframes[1].easing[`vars.--akari-3d-rot-${axis}`], 'ease-in-out');
  edit = moveV2Keyframe(edit, { itemId: 'scene', property: 'rotation3d', fromT: 60, toT: 75 });
  assert.deepEqual(item(edit).keyframes.map(point => point.t), [0, 75]);
});
