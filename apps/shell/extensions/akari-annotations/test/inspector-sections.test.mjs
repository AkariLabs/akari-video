import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  composeInspectorSections,
  InspectorSectionState
} from '../lib/browser/inspector/section-model.js';
import {
  clampNumber,
  INSPECTOR_LIVE_PREVIEW_THROTTLE_MS,
  numericStep
} from '../lib/browser/inspector/number-field.js';
import {
  sliderFromDisplay,
  sliderToDisplay
} from '../lib/browser/inspector/slider-field.js';
import {
  knobControlKind,
  parseInspectorKnobs
} from '../lib/browser/inspector/knob-resolver.js';
import {
  NudgeCommitSession,
  planAdjacentVisualTrackMove
} from '../lib/browser/inspector/keyboard-shortcuts.js';
import {
  chromaControlValue,
  layerSnapshotChromaKey,
  legacyTransformOpFor,
  telopParamControlKind
} from '../lib/browser/inspector/field-mappings.js';

const widgetSource = readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');
const inspectorWidgetSource = readFileSync(new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8');

test('節合成は時間→変形→外観→種別固有→情報の順に固定する', () => {
  const sections = composeInspectorSections([
    { id: 'info' }, { id: 'style' }, { id: 'appearance' },
    { id: 'time' }, { id: 'transform' }, { id: 'knobs:color' }
  ]);
  assert.deepEqual(sections.map(section => section.id), [
    'time', 'transform', 'appearance', 'style', 'knobs:color', 'info'
  ]);
});

test('イージング節は外観の直後に入り、KF 席から disabled 属性を除く', () => {
  const sections = composeInspectorSections([
    { id: 'info' }, { id: 'easing' }, { id: 'appearance' }, { id: 'transform' }
  ]);
  assert.deepEqual(sections.map(section => section.id), ['transform', 'appearance', 'easing', 'info']);
  const numberFieldSource = readFileSync(new URL('../src/browser/inspector/number-field.ts', import.meta.url), 'utf8');
  assert.equal(numberFieldSource.includes('button.disabled = true'), false);
});

test('木 item snapshot がインスペクターへ時間・変形・外観を渡す', () => {
  assert.match(widgetSource, /this\.treeItemSnapshot\(treeSelection, raw\)/u);
  assert.match(inspectorWidgetSource, /case 'item':\s+sections = TREE_ITEM_SECTIONS/u);
  assert.match(inspectorWidgetSource, /id: 'transform', label: '変形'/u);
});

test('イージングは選択点の実値を表示し、DOM プリセット hover を既存 throttle へ流す', () => {
  assert.match(inspectorWidgetSource, /selectedKeyframe\.easing \?\? 'linear'/u);
  assert.match(inspectorWidgetSource, /INSPECTOR_LIVE_PREVIEW_THROTTLE_MS/u);
  assert.match(inspectorWidgetSource, /data\.akariEasingPreview|dataset\.akariEasingPreview/u);
  assert.match(inspectorWidgetSource, /this\.model\.requestLivePreview/u);
  assert.doesNotMatch(inspectorWidgetSource, /segment-easing'[\s\S]{0,120}getValue: \(\) => 'linear'/u);
});

test('プロパティ行の空白は native dblclick ではなく click の合成判定を使う', () => {
  const start = widgetSource.indexOf('protected renderKeyframePropertyRows');
  const end = widgetSource.indexOf('protected appendMotionMarks', start);
  const block = widgetSource.slice(start, end);
  assert.match(block, /addEventListener\('click'/u);
  assert.match(block, /addEventListener\('pointerdown',[\s\S]{0,80}stopPropagation/u);
  assert.match(block, /detectTreeDoubleClick/u);
  assert.doesNotMatch(block, /addEventListener\('dblclick'/u);
});

test('折りたたみ状態は kind と section id ごとに記憶する', () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
  const state = new InspectorSectionState(storage);
  assert.equal(state.isCollapsed('layer', { id: 'info', collapsedByDefault: true }), true);
  state.setCollapsed('layer', 'info', false);
  assert.equal(state.isCollapsed('layer', { id: 'info', collapsedByDefault: true }), false);
  assert.equal(state.isCollapsed('overlay', { id: 'info', collapsedByDefault: true }), true);
});

test('数値部品は step・Shift 10倍・min/max clamp を適用する', () => {
  assert.equal(numericStep(2, 1, 0.5), 2.5);
  assert.equal(numericStep(2, -1, 0.5, true), -3);
  assert.equal(numericStep(9, 1, 1, true, 0, 10), 10);
  assert.equal(clampNumber(-2, 0, 1), 0);
});

test('不透明度スライダーは内部 0..1 と表示 0..100% を往復する', () => {
  assert.equal(sliderToDisplay(0.5, 100), 50);
  assert.equal(sliderFromDisplay(50, 100), 0.5);
  assert.equal(INSPECTOR_LIVE_PREVIEW_THROTTLE_MS, 30);
});

test('chroma は内部 0..1 と表示 0..100% を往復し、宣言の無い layer では読み取り専用になる', () => {
  const rows = [
    { chromaKey: { similarity: 0.3, blend: 0.2 }, field: 'similarity', fallback: 0.1, value: 0.3, display: 30, editable: true },
    { chromaKey: { color: '#00ff00' }, field: 'similarity', fallback: 0.1, value: 0.1, display: 10, editable: true },
    { chromaKey: { color: '#00ff00' }, field: 'blend', fallback: 0, value: 0, display: 0, editable: true },
    { chromaKey: undefined, field: 'similarity', fallback: 0.1, value: undefined, display: undefined, editable: false }
  ];
  assert.deepEqual(rows.map(row => {
    const value = chromaControlValue(row.chromaKey, row.field, row.fallback);
    return {
      value,
      display: value === undefined ? undefined : sliderToDisplay(value, 100),
      editable: value !== undefined
    };
  }), rows.map(({ value, display, editable }) => ({ value, display, editable })));
  assert.equal(sliderFromDisplay(30, 100), 0.3);
});

test('layer snapshot の chromaKey は item 自身の raw source.chroma_key だけから補完する', () => {
  const raw = { color: '#00ff00', similarity: 0.3, blend: 0.1 };
  assert.deepEqual(layerSnapshotChromaKey(undefined, raw), raw);
  const projected = { color: '#ffffff', similarity: 0.2 };
  assert.equal(layerSnapshotChromaKey(projected, raw), projected);
  for (const missing of [undefined, null, '#00ff00', ['not-an-object-map']]) {
    assert.equal(layerSnapshotChromaKey(undefined, missing), undefined);
  }
});

test('telop params は primitive だけを型対応部品へ写し、telop 節を外観と情報の間へ置く', () => {
  const params = {
    text: '第1章', size: 42, visible: true,
    style: { color: 'red' }, choices: ['a'], empty: null
  };
  assert.deepEqual(Object.entries(params).flatMap(([name, value]) => {
    const kind = telopParamControlKind(value);
    return kind ? [[name, kind]] : [];
  }), [
    ['text', 'text'], ['size', 'scrub-number'], ['visible', 'boolean-select']
  ]);
  const sections = composeInspectorSections([
    { id: 'info' }, { id: 'telop' }, { id: 'appearance' }
  ]);
  assert.deepEqual(sections.map(section => section.id), ['appearance', 'telop', 'info']);
});

test('legacy item-field は拡縮・回転だけを cut/layer の既存 op へ写像する', () => {
  assert.deepEqual([
    ['transform.scale', 'layer'], ['transform.scale', 'cut'],
    ['transform.rotate', 'layer'], ['transform.rotate', 'cut']
  ].map(([path, target]) => legacyTransformOpFor(path, target)), [
    'layer-scale', 'cut-scale', 'layer-rotate', 'cut-rotate'
  ]);
  for (const path of [
    'transform.x', 'transform.y', 'opacity', 'blend',
    'source.vars.color', 'source.params.text', 'source.chroma_key.similarity'
  ]) {
    assert.equal(legacyTransformOpFor(path, 'layer'), undefined, path);
  }
});

test('knob type は対応するインスペクター部品へ写る', () => {
  assert.deepEqual(
    ['slider', 'color', 'dropdown', 'checkbox', 'text', 'media'].map(knobControlKind),
    ['slider', 'color', 'select', 'boolean-select', 'text', 'readonly']
  );
  const knobs = parseInspectorKnobs({ knobs: [
    { cssVar: '--size', type: 'slider', group: 'layout', min: 10, max: 20, unit: 'px' },
    { param: 'visible', type: 'checkbox', group: 'layout' }
  ] });
  assert.deepEqual(knobs.map(knob => [knob.name, knob.group]), [
    ['--size', 'layout'], ['visible', 'layout']
  ]);
});

test('前後移動は隣の visual トラックを選び、時間重なりなら新しい段を要求する', () => {
  const tracks = [
    { id: 'V1', lane: 'visual', items: [{ id: 'selected', at: 10, duration: 20 }] },
    { id: 'A1', lane: 'audio', items: [] },
    { id: 'V2', lane: 'visual', items: [{ id: 'other', at: 20, duration: 20 }] },
    { id: 'V3', lane: 'visual', items: [] }
  ];
  assert.deepEqual(planAdjacentVisualTrackMove(tracks, 'selected', 1), {
    targetTrackId: 'V2', targetTrackLabel: 'V2', atFrames: 10, requiresNewTrack: true
  });
  assert.deepEqual(planAdjacentVisualTrackMove(tracks, 'other', 1), {
    targetTrackId: 'V3', targetTrackLabel: 'V3', atFrames: 20, requiresNewTrack: false
  });
});

test('nudge は keydown 相当の更新が複数回でも release で1回だけ書き戻す', () => {
  const session = new NudgeCommitSession();
  const writes = [];
  session.apply('clip-1', 'transform.x', 1);
  session.apply('clip-1', 'transform.x', 2);
  session.apply('clip-1', 'transform.x', 3);
  assert.equal(session.release(value => writes.push(value)), true);
  assert.equal(session.release(value => writes.push(value)), false);
  assert.deepEqual(writes, [{ id: 'clip-1', path: 'transform.x', value: 3 }]);
});

test('前後移動は重なり時も拒否せず新しい段を通知し、legacy item-field は v2 限定文言を返す', () => {
  assert.match(widgetSource, /を追加しました/);
  assert.match(widgetSource, /この項目の編集は edit\.json v2 のみ対応です。/);
});
