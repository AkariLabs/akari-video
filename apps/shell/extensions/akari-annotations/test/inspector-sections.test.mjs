import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  composeInspectorSections,
  InspectorSectionState
} from '../lib/browser/inspector/section-model.js';
import {
  clampNumber,
  createNumberField,
  createKeyframeSeat,
  INSPECTOR_LIVE_PREVIEW_THROTTLE_MS,
  numericStep
} from '../lib/browser/inspector/number-field.js';
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
import { assignSectionToTab } from '../lib/browser/inspector/tab-model.js';

const widgetSource = readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');
const inspectorWidgetSource = readFileSync(new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8');

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.style = {
      values: new Map(),
      setProperty: (name, value) => this.style.values.set(name, value)
    };
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  append(...children) {
    children.forEach(child => this.appendChild(child));
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  blur() {}

  setPointerCapture(pointerId) {
    this.pointerId = pointerId;
  }

  hasPointerCapture(pointerId) {
    return this.pointerId === pointerId;
  }

  releasePointerCapture(pointerId) {
    if (this.pointerId === pointerId) this.pointerId = undefined;
  }
}

class FakeWindow {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter(candidate => candidate !== listener));
  }

  emit(type, event = {}) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
}

function withFakeDocument(callback) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElement: tagName => new FakeElement(tagName) }
  });
  try {
    return callback();
  } finally {
    if (original) Object.defineProperty(globalThis, 'document', original);
    else delete globalThis.document;
  }
}

function sourceBetween(start, end) {
  const startIndex = inspectorWidgetSource.indexOf(start);
  const endIndex = inspectorWidgetSource.indexOf(end, startIndex);
  assert.notEqual(startIndex, -1, start);
  assert.notEqual(endIndex, -1, end);
  return inspectorWidgetSource.slice(startIndex, endIndex);
}

test('節合成は時間→変形→外観→種別固有→情報の順に固定する', () => {
  const sections = composeInspectorSections([
    { id: 'info' }, { id: 'style' }, { id: 'appearance' },
    { id: 'time' }, { id: 'transform' }, { id: 'knobs:color' }
  ]);
  assert.deepEqual(sections.map(section => section.id), [
    'time', 'transform', 'appearance', 'style', 'knobs:color', 'info'
  ]);
});

test('cut の動画タブだけにフレーミングがクロップの直後へ出る', () => {
  assert.deepEqual(composeInspectorSections([
    { id: 'appearance' }, { id: 'framing' }, { id: 'crop' }, { id: 'transform' }
  ]).map(section => section.id), ['transform', 'crop', 'framing', 'appearance']);
  assert.equal(assignSectionToTab('cut', 'framing'), 'video');

  const cutFactory = sourceBetween('function CUT_SECTIONS(', 'const LAYER_BLEND_OPTIONS');
  assert.match(cutFactory, /id: 'framing', label: 'フレーミング'/u);
  assert.match(cutFactory, /cutFramingFields\(snapshot, requestWrite\)/u);
  for (const [start, end] of [
    ['function LAYER_SECTIONS(', 'function CAPTION_SECTIONS('],
    ['function CAPTION_SECTIONS(', 'function MULTI_CAPTION_SECTIONS('],
    ['function AUDIO_SECTIONS(', 'function OVERLAY_SECTIONS('],
    ['function OVERLAY_SECTIONS(', 'function TREE_ITEM_SECTIONS('],
    ['function TREE_ITEM_SECTIONS(', '@injectable()']
  ]) {
    assert.doesNotMatch(sourceBetween(start, end), /label: 'フレーミング'/u);
  }
});

test('cut の動画タブだけにフリーズがフレーミングの直後へ出る', () => {
  assert.deepEqual(composeInspectorSections([
    { id: 'appearance' }, { id: 'freeze' }, { id: 'framing' }, { id: 'transform' }
  ]).map(section => section.id), ['transform', 'framing', 'freeze', 'appearance']);
  assert.equal(assignSectionToTab('cut', 'freeze'), 'video');

  const cutFactory = sourceBetween('function CUT_SECTIONS(', 'const LAYER_BLEND_OPTIONS');
  assert.match(cutFactory, /id: 'framing', label: 'フレーミング'[\s\S]{0,180}id: 'freeze', label: 'フリーズ'/u);
  assert.match(cutFactory, /cutFreezeFields\(snapshot, requestWrite\)/u);
  for (const [start, end] of [
    ['function LAYER_SECTIONS(', 'function CAPTION_SECTIONS('],
    ['function CAPTION_SECTIONS(', 'function MULTI_CAPTION_SECTIONS('],
    ['function AUDIO_SECTIONS(', 'function OVERLAY_SECTIONS('],
    ['function OVERLAY_SECTIONS(', 'function TREE_ITEM_SECTIONS('],
    ['function TREE_ITEM_SECTIONS(', '@injectable()']
  ]) {
    assert.doesNotMatch(sourceBetween(start, end), /label: 'フリーズ'/u);
  }
});

test('ズーム KF がある間はフレーミング窓 4 行を disabled + title にする', () => {
  const framingFields = sourceBetween('function cutFramingFields(', 'function CUT_SECTIONS(');
  assert.match(framingFields, /const cropDisabled = keyframes\.length > 0/u);
  assert.match(framingFields, /disabled: cropDisabled/u);
  assert.match(framingFields, /title: cropDisabled \? CUT_FRAMING_CROP_DISABLED_TITLE/u);
  assert.match(inspectorWidgetSource, /querySelectorAll\('button, input'\)[\s\S]{0,180}\.disabled = true/u);
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

test('字幕位置は 3x3 grid から preview 所有の hover/preset イベントへ流す', () => {
  assert.match(inspectorWidgetSource, /inputKind: 'zone-grid'/u);
  assert.match(inspectorWidgetSource, /akari-caption-zone-grid/u);
  assert.match(inspectorWidgetSource, /akari\.caption\.zoneHover/u);
  assert.match(inspectorWidgetSource, /akari\.caption\.zonePreset/u);
  assert.match(inspectorWidgetSource, /saved\.textContent = '保存中'/u);
  assert.doesNotMatch(inspectorWidgetSource, /name: 'caption-zone'[\s\S]{0,500}kind: 'caption-style-zone'/u);
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

test('KF 席の前後ナビは ‹ / › で、席本体の ◇ / ◆ と区別する', () => withFakeDocument(() => {
  const inactive = createKeyframeSeat('opacity');
  assert.deepEqual(inactive.children.map(child => child.textContent), ['‹', '◇', '›']);
  assert.equal(inactive.children[1].className, 'akari-inspector-kf-seat');

  const active = createKeyframeSeat('opacity', {
    active: true,
    onToggle() {},
    onPrevious() {},
    onNext() {}
  });
  assert.deepEqual(active.children.map(child => child.textContent), ['‹', '◆', '›']);
}));

test('不透明度は表示 0..100% のドラッグ数値行と KF 席を使う', async () => {
  const previews = [];
  const commits = [];
  const field = withFakeDocument(() => createNumberField({
    name: 'opacity', label: '不透明度', value: 1,
    min: 0, max: 1, step: 0.01, unit: '%', displayScale: 100,
    onPreview: value => previews.push(value),
    onCommit: async value => {
      commits.push(value);
      return true;
    }
  }));
  const [handle, number, unit, steps, seat] = field.children;
  assert.equal(field.className, 'akari-inspector-number-field');
  assert.equal(handle.className, 'akari-inspector-number-handle');
  assert.equal(number.parentElement, field);
  assert.match(number.className, /(?:^| )akari-inspector-number-input(?: |$)/u);
  assert.equal(number.value, '100');
  assert.equal(number.attributes.get('aria-valuemin'), '0');
  assert.equal(number.attributes.get('aria-valuemax'), '100');
  assert.equal(unit.className, 'akari-inspector-number-unit');
  assert.equal(unit.textContent, '%');
  assert.equal(steps.className, 'akari-inspector-number-steps');
  assert.equal(seat.className, 'akari-inspector-kf-controls');

  number.value = '150';
  number.emit('blur');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(previews, [1]);
  assert.deepEqual(commits, [1]);
  assert.equal(number.value, '100');
  assert.equal(INSPECTOR_LIVE_PREVIEW_THROTTLE_MS, 30);

  const scrubBranch = sourceBetween(
    "if (field.inputKind === 'scrub-number') {",
    "if (field.inputKind === 'color') {"
  );
  assert.match(scrubBranch, /createNumberField\(\{/u);
  assert.match(scrubBranch, /displayScale: field\.displayScale/u);
  assert.match(scrubBranch, /onPreview: sendLive/u);
});

test('displayScale 付き数値行はドラッグを内部値へ戻して preview と commit へ渡す', async () => {
  const fakeWindow = new FakeWindow();
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });
  const previews = [];
  const commits = [];
  try {
    const field = withFakeDocument(() => createNumberField({
      name: 'opacity', label: '不透明度', value: 0.5,
      min: 0, max: 1, step: 0.01, displayScale: 100,
      onPreview: value => previews.push(value),
      onCommit: async value => {
        commits.push(value);
        return true;
      }
    }));
    const [handle, input] = field.children;
    handle.emit('pointerdown', {
      button: 0, pointerId: 7, clientX: 100, preventDefault() {}
    });
    fakeWindow.emit('pointermove', { pointerId: 7, clientX: 125, shiftKey: false });
    assert.equal(input.value, '75');
    assert.deepEqual(previews, [0.75]);
    fakeWindow.emit('pointerup', { pointerId: 7 });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(commits, [0.75]);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else delete globalThis.window;
  }
});

test('cut / layer / overlay / item の変形節は拡縮・回転を既定 fields に含む', () => {
  const factories = [
    sourceBetween('function CUT_SECTIONS(', 'const LAYER_BLEND_OPTIONS'),
    sourceBetween('function LAYER_SECTIONS(', 'function CAPTION_SECTIONS('),
    sourceBetween('function OVERLAY_SECTIONS(', 'function TREE_ITEM_SECTIONS('),
    sourceBetween('function TREE_ITEM_SECTIONS(', '@injectable()')
  ];
  for (const source of factories) {
    const transformFields = source.slice(
      source.indexOf('const transformFields:'),
      source.indexOf('return composeInspectorSections')
    );
    assert.match(transformFields, /name: 'transform-scale'/u);
    assert.match(transformFields, /name: 'transform-rotate'/u);
    assert.doesNotMatch(source, /const optionalFields/u);
    assert.match(source, /\{ id: 'transform', label: '変形', fields: transformFields \}/u);
  }
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
      display: value === undefined ? undefined : value * 100,
      editable: value !== undefined
    };
  }), rows.map(({ value, display, editable }) => ({ value, display, editable })));
  assert.equal(30 / 100, 0.3);
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

test('BGM と音声クリップは共通のフェード・ダッキング節と固定既定値を使う', () => {
  assert.match(inspectorWidgetSource, /const AUDIO_DUCK_DEFAULTS = \{ duckDb: -12, duckAttack: 0\.3, duckRelease: 0\.8 \}/u);
  assert.equal((inspectorWidgetSource.match(/label: 'フェード・ダッキング'/gu) ?? []).length, 2);
  assert.match(inspectorWidgetSource, /function duckingFields\(/u);
  assert.match(inspectorWidgetSource, /'audio-duck-preset'[\s\S]{0,300}options: \['-3', '-6', '-12'\]/u);
});

test('default change 2026-09-02: inspector displays attack 0.3 / release 0.8 without changing steps', () => {
  assert.match(inspectorWidgetSource, /AUDIO_DUCK_DEFAULTS = \{ duckDb: -12, duckAttack: 0\.3, duckRelease: 0\.8 \}/u);
  assert.match(inspectorWidgetSource, /AUDIO_DUCK_DEFAULTS\.duckAttack, 0, 2, 0\.01, 's'/u);
  assert.match(inspectorWidgetSource, /AUDIO_DUCK_DEFAULTS\.duckRelease, 0, 5, 0\.05, 's'/u);
});

test('ダッキング数値 UI は契約範囲と step を固定する', () => {
  assert.match(inspectorWidgetSource, /AUDIO_DUCK_DEFAULTS\.duckDb, -40, 0, 0\.5, 'dB'/u);
  assert.match(inspectorWidgetSource, /AUDIO_DUCK_DEFAULTS\.duckAttack, 0, 2, 0\.01, 's'/u);
  assert.match(inspectorWidgetSource, /AUDIO_DUCK_DEFAULTS\.duckRelease, 0, 5, 0\.05, 's'/u);
  assert.match(inspectorWidgetSource, /gain_db は -60〜12 の範囲/u);
});

test('音量キーフレーム節は追加・時刻・gain・easing・削除を配列 write へ戻す', () => {
  assert.match(inspectorWidgetSource, /id: 'audio:keyframes', label: '音量キーフレーム'/u);
  assert.match(inspectorWidgetSource, /actionLabel: '再生ヘッド位置に追加'/u);
  assert.match(inspectorWidgetSource, /AUDIO_KEYFRAME_EASING_OPTIONS = \['linear', 'hold', 'ease-in-out'\]/u);
  assert.match(inspectorWidgetSource, /actionLabel: '削除'/u);
  const requestStart = inspectorWidgetSource.indexOf("kind: 'audio-keyframes'");
  const requestBlock = inspectorWidgetSource.slice(requestStart, requestStart + 420);
  assert.match(requestBlock, /gain_db: point\.gain_db \?\? 0/u);
  assert.match(requestBlock, /sort\(\(left, right\) => left\.t - right\.t\)/u);
});

test('キーフレーム時刻は v2 の frame と表示秒を fps で往復する', () => {
  assert.match(inspectorWidgetSource, /point\.t \/ Math\.max\(1, snapshot\.fps \?\? 30\)/u);
  assert.match(inspectorWidgetSource, /Math\.round\(seconds \* Math\.max\(1, snapshot\.fps \?\? 30\)\)/u);
  assert.match(inspectorWidgetSource, /Math\.abs\(candidate\.t - t\) < 1e-3/u);
  assert.match(widgetSource, /keyframeFrames: this\.rawV2Item\(sfx\.id\) !== undefined/u);
});

test('snapshot と write 配線は duck 値・keyframes・再生ヘッドを往復する', () => {
  assert.match(widgetSource, /audioEnvelopeFieldsForSnapshot\(sfx\)/u);
  assert.match(widgetSource, /playheadSeconds: this\.playheadT/u);
  assert.match(widgetSource, /case 'sfx-ducking':[\s\S]{0,300}case 'audio-keyframes':/u);
  assert.match(widgetSource, /updateAudioItemEnvelope\(doc, \{ itemId, patch \}\)/u);
  assert.match(widgetSource, /setAudioKeyframes\(\{[\s\S]{0,120}keyframes/u);
});

test('タイムラインは音声 keyframes を固定pxのひし形で示し、波形高さを dB 変換する', () => {
  assert.match(widgetSource, /appendAudioKeyframeMarkers\(/u);
  assert.match(widgetSource, /audioKeyframeMarkerPositions\(/u);
  assert.match(widgetSource, /waveformHeightForPeak\(peaks\[bucket\]\) \* heightPx/u);
  const drawing = widgetSource.slice(
    widgetSource.indexOf('protected appendAudioKeyframeMarkers'),
    widgetSource.indexOf('protected updateBgmWaveform')
  );
  assert.doesNotMatch(drawing, /MIN_TRACK_HEIGHT_FOR_AUDIO_WAVEFORM_PX/u);
  assert.doesNotMatch(drawing, /ducking/u);
});
