import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { audioSections, audioSnapshot, fxSections } from './helpers/audio-clip-fx-fixture.mjs';
import { layerSections, itemSections, cutSections, visualSnapshot, cutSnapshot } from './helpers/perspective-transition-fixture.mjs';
import { AUDIO_PREVIEW_SECTIONS } from '../lib/browser/inspector/audio-preview.js';
import { keyframeValueAt } from '../lib/browser/timeline/timeline-keyframe-rows.js';

test('media layer / item の動画タブはパース直後に「動き」12行を畳んで表示する', () => {
  for (const [kind, factory] of [['layer', layerSections], ['item', itemSections]]) {
    const snapshot = visualSnapshot(kind);
    const sections = factory(snapshot, async () => ({ ok: true }))
      .filter(section => assignSectionToTab(kind, section.id) === 'video');
    const index = sections.findIndex(section => section.id === 'motion');
    assert.ok(index > 0);
    assert.equal(sections[index - 1].id, 'perspective');
    assert.equal(sections[index].label, '動き');
    assert.equal(sections[index].collapsedByDefault, true);
    assert.deepEqual(sections[index].fields.map(field => field.label), [
      '入り', '入りの尺', '入りのイージング', '入りの量',
      '抜き', '抜きの尺', '抜きのイージング', '抜きの量',
      'ループ', '周期', 'ループのイージング', 'ループの量'
    ]);
    assert.deepEqual(sections[index].fields.map(field => field.inputKind),
      Array(3).fill(['select', 'scrub-number', 'select', 'scrub-number']).flat());
  }
});

test('HTML item / layer には動きセクションを出さない', () => {
  for (const factory of [itemSections, layerSections]) {
    const snapshot = visualSnapshot('item', { sourceKind: 'html', itemKind: 'part' });
    assert.equal(factory(snapshot, () => {}).some(section => section.id === 'motion'), false);
  }
});

test('motion 未選択席の尺・ease・量は disabled、fade / wipe の量には理由を表示する', async () => {
  for (const [kind, factory] of [['layer', layerSections], ['item', itemSections]]) {
    const snapshot = visualSnapshot(kind);
    const fields = factory(snapshot, async () => assert.fail('未選択席には書かない'))
      .find(section => section.id === 'motion').fields;
    for (const offset of [0, 4, 8]) {
      assert.equal(fields[offset].disabled, false);
      assert.equal(fields[offset].options[0], 'なし');
      for (const index of [1, 2, 3]) {
        assert.equal(fields[offset + index].disabled, true);
        assert.equal((await fields[offset + index].write(snapshot, '1')).ok, false);
      }
      assert.equal(fields[offset + 1].unit, 'f');
      assert.equal(fields[offset + 1].min, 1);
      assert.equal(fields[offset + 1].scrubStep, 1);
      assert.equal(fields[offset + 1].max, offset === 8 ? undefined : 150);
      assert.equal(fields[offset + 2].getValue(), 'linear');
    }
    for (const preset of ['fade', 'wipe']) {
      const current = { ...snapshot, motion: { in: { preset, duration: 12 } } };
      const row = factory(current, async () => assert.fail('量を書かない')).find(section => section.id === 'motion').fields[3];
      assert.equal(row.disabled, true);
      assert.equal(row.title, 'このプリセットに量はありません');
      assert.equal((await row.write(current, '20')).ok, false);
    }
  }
});

test('media layer / item の外観末尾に「なし」+ 動画候補のマスク select が出る', () => {
  for (const [kind, factory] of [['layer', layerSections], ['item', itemSections]]) {
    const snapshot = visualSnapshot(kind, { maskSourceOptions: [{ id: 'maskgrad', label: 'mask.mp4' }] });
    const row = factory(snapshot, async () => ({ ok: true })).find(section => section.id === 'appearance').fields.at(-1);
    assert.equal(row.label, 'マスク');
    assert.equal(row.inputKind, 'select');
    assert.deepEqual(row.options, ['なし', 'mask.mp4']);
    assert.equal(row.getValue(snapshot), 'なし');
    assert.equal(row.disabled, false);
    assert.match(row.title, /グレースケール動画（白 = 表示・黒 = 透過）/u);
  }
});

test('telop layer と html / group item はマスク行を出さない', () => {
  for (const [kind, factory] of [['layer', layerSections], ['item', itemSections]]) {
    for (const sourceKind of ['telop', 'html', 'group']) {
      const snapshot = visualSnapshot(kind, { sourceKind, itemKind: sourceKind, layerKind: 'baked' });
      const fields = factory(snapshot, async () => ({ ok: true })).flatMap(section => section.fields);
      assert.equal(fields.some(field => field.name === 'mask'), false);
    }
  }
});

test('mask 候補0件の行は disabled と理由を表示し、書き込みを拒否する', async () => {
  for (const [kind, factory] of [['layer', layerSections], ['item', itemSections]]) {
    const snapshot = visualSnapshot(kind, { maskSourceOptions: [] });
    const row = factory(snapshot, async () => assert.fail('disabled write'))
      .find(section => section.id === 'appearance').fields.at(-1);
    assert.equal(row.disabled, true);
    assert.deepEqual(row.options, ['なし']);
    assert.match(row.title, /プロジェクトにマスクに使える動画ソースがありません/u);
    assert.match(row.title, /グレースケール動画（白 = 表示・黒 = 透過）/u);
    assert.equal((await row.write(snapshot, 'なし')).ok, false);
  }
});

test('調整タブの A/B ボタンはイージング節より前に追加し、イージング節を隠さない', () => {
  const source = readFileSync(new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8');
  const start = source.indexOf("if (activeTab === 'adjust' && compareTarget)");
  assert.ok(start >= 0);
  const render = source.slice(start, source.indexOf('protected syncAdjustCompare'));
  assert.match(render, /this.body.appendChild\(button\);\s*\}\s*if \(keyframeSection\) \{\s*this.appendSection\(keyframeSection, rowSnapshot, sectionKind\);/u);
  assert.ok(render.indexOf('this.body.appendChild(button)') < render.indexOf('this.appendSection(keyframeSection'));
  assert.ok(render.indexOf('this.appendSection(keyframeSection') < render.indexOf('ADJUST_SECTIONS(rowSnapshot'));
});

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

// Theia の DOM / DI を起動せず、実ソースの行描画・KF 判定・メニューを実行する。
const inspectorAst = ts.createSourceFile('akari-inspector-widget.ts', inspectorWidgetSource,
  ts.ScriptTarget.Latest, true);
const inspectorClass = inspectorAst.statements.find(statement => ts.isClassDeclaration(statement)
  && statement.name?.text === 'AkariInspectorWidget');
const rowMethods = ['appendRow', 'keyframeSeatOptions', 'attachRowMenu'].map(name => {
  const method = inspectorClass.members.find(member => member.name?.getText(inspectorAst) === name);
  assert.ok(method, name);
  return method.getText(inspectorAst);
});
const rowCode = ts.transpileModule(`class InspectorRows { ${rowMethods.join('\n')} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2021 }
}).outputText;
const InspectorRows = new Function('createNumberField', 'keyframeValueAt',
  `${rowCode}\nreturn InspectorRows;`)(createNumberField, keyframeValueAt);

test('layer / item の動画タブにクロップ直後のパース（4 隅）8行 + 解除が出る', () => {
  for (const [kind, factory] of [['layer', layerSections], ['item', itemSections]]) {
    const snapshot = visualSnapshot(kind);
    const sections = factory(snapshot, async () => ({ ok: true }))
      .filter(section => assignSectionToTab(kind, section.id) === 'video');
    const index = sections.findIndex(section => section.id === 'perspective');
    assert.ok(index > 0);
    assert.equal(sections[index - 1].id, 'crop');
    assert.equal(sections[index].label, 'パース（4 隅）');
    assert.equal(sections[index].collapsedByDefault, true);
    assert.deepEqual(sections[index].fields.map(field => field.label), [
      '左上 X', '左上 Y', '右上 X', '右上 Y', '左下 X', '左下 Y', '右下 X', '右下 Y', '解除'
    ]);
  }
});

test('cut の時間セクションに実働のトランジション選択・尺が一度だけ出る', () => {
  const sections = cutSections(cutSnapshot(), async () => ({ ok: true }));
  const time = sections.find(section => section.id === 'time');
  const rows = time.fields.filter(field => field.name.startsWith('transition-'));
  assert.deepEqual(rows.map(field => [field.label, field.inputKind]), [
    ['トランジション', 'select'], ['トランジション尺', 'scrub-number']
  ]);
  assert.ok(rows.every(field => typeof field.write === 'function'));
  assert.equal(sections.flatMap(section => section.fields).filter(field => field.name?.startsWith('transition-')).length, 2);
});

test('パース左上Xの25%入力は数値部品を通り corners[0][0] = 0.25 を書く', async () => {
  const snapshot = visualSnapshot();
  const requests = [];
  const row = layerSections(snapshot, async request => { requests.push(request); return { ok: true }; })
    .find(section => section.id === 'perspective').fields[0];
  const field = withFakeDocument(() => createNumberField({
    name: row.name, label: row.label, value: Number(row.getEditValue(snapshot)),
    min: row.min, max: row.max, step: row.scrubStep, unit: row.unit, displayScale: row.displayScale,
    onCommit: async value => (await row.write(snapshot, String(value))).ok
  }));
  const input = field.children[1];
  assert.equal(input.attributes.get('aria-valuemax'), '100');
  input.value = '25';
  input.emit('blur');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(input.value, '25');
  assert.deepEqual(requests, [{ kind: 'item-field', id: snapshot.id, path: 'perspective',
    value: { corners: [[0.25, 0], [1, 0], [0, 1], [1, 1]] } }]);
});

test('cut 選択の節は timing → audio → info の順に並ぶ', () => {
  const factory = sourceBetween('function CUT_SECTIONS(', 'const LAYER_BLEND_OPTIONS');
  const sections = [...factory.matchAll(/id: '([^']+)'/gu)].map(match => ({ id: match[1] }));
  assert.deepEqual(composeInspectorSections(sections).map(section => section.id), [
    'time', 'transform', 'framing', 'freeze', 'appearance', 'timing', 'audio', 'info'
  ]);
});

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
    if (event.bubbles) this.parentElement?.emit(type, event);
  }

  append(...children) {
    children.forEach(child => this.appendChild(child));
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter(child => child !== this);
      this.parentElement = null;
    }
  }

  querySelectorAll(selector) {
    return this.children.flatMap(child => [
      ...(selector.startsWith('.') && (child.className ?? '').split(' ').includes(selector.slice(1))
        ? [child] : []),
      ...child.querySelectorAll(selector)
    ]);
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
    value: { createElement: tagName => new FakeElement(tagName), body: new FakeElement('body') }
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

test('調整タブは実働 6 セクションを順番に描き、近日の空配列も扱う', () => {
  const factory = sourceBetween('function ADJUST_SECTIONS(', '/**\n * タイムラインの選択内容');
  assert.equal((factory.match(/id: 'adjust:(?:basic|lut|curves|wheels|hue|fx)'/gu) ?? []).length, 6);
  assert.match(factory, /id: 'adjust:basic'[\s\S]*id: 'adjust:curves'[\s\S]*id: 'adjust:wheels'[\s\S]*id: 'adjust:hue'[\s\S]*id: 'adjust:lut'[\s\S]*id: 'adjust:fx'/u);
  assert.equal((factory.match(/enable: \{/gu) ?? []).length, 6);

  const branch = sourceBetween(
    "if (activeTab === 'adjust') {",
    "if (activeTab === 'audio' && sectionKind !== 'audio') {"
  );
  assert.match(branch, /ADJUST_SECTIONS\(rowSnapshot, requestWrite, \{/u);
  assert.match(branch, /ADJUST_PREVIEW_SECTIONS\.forEach/u);
  assert.ok(branch.indexOf('ADJUST_SECTIONS') < branch.indexOf('ADJUST_PREVIEW_SECTIONS'));
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

test('音声タブ末尾のマスターは cut と audio アイテムの両方へ出る', () => {
  const masterFactory = sourceBetween('function AUDIO_MASTER_SECTION(', 'function OVERLAY_SECTIONS(');
  assert.match(masterFactory, /label: 'マスター（書き出し全体）'/u);
  assert.match(masterFactory, /プロジェクト全体に適用・プレビューは未対応（書き出し時のみ）/u);
  assert.equal((masterFactory.match(/name: 'audio-master-/gu) ?? []).length, 4);

  const render = sourceBetween('protected render(): void', 'protected tabSourceHint(');
  assert.match(render, /sectionKind !== 'audio'[\s\S]*AUDIO_PREVIEW_SECTIONS[\s\S]*appendSection\(AUDIO_MASTER_SECTION/u);
  assert.match(render, /sectionKind === 'audio'[\s\S]*AUDIO_ITEM_PREVIEW_SECTIONS[\s\S]*appendSection\(AUDIO_MASTER_SECTION/u);
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

test('keyframe オプションが無い数値行には KF 席を append しない', () => withFakeDocument(() => {
  const field = createNumberField({
    name: 'gain-db', label: 'gain_db', value: 0, step: 0.5,
    onCommit: async () => true
  });
  assert.equal(field.children.length, 4);
  assert.equal(field.querySelectorAll('.akari-inspector-kf-controls').length, 0);
}));

function renderInspectorRow(field, snapshot) {
  const inspector = new InspectorRows();
  inspector.model = {};
  const parent = document.createElement('div');
  inspector.appendRow(parent, field, snapshot, snapshot.kind);
  assert.equal(parent.children.length, 1);
  return parent.children[0];
}

test('audio の gain・fade・速度・ピッチ・ローカット行には KF 席が無い', () => withFakeDocument(() => {
  const snapshot = audioSnapshot();
  const fields = audioSections(snapshot, async () => ({ ok: true })).flatMap(section => section.fields);
  for (const name of ['gain-db', 'audio-fade-in', 'audio-fade-out', 'audio-speed', 'audio-pitch', 'audio-lowcut']) {
    const field = fields.find(candidate => candidate.name === name);
    assert.ok(field, name);
    const row = renderInspectorRow(field, snapshot);
    assert.equal(row.querySelectorAll('.akari-inspector-number-field').length, 1, name);
    assert.equal(row.querySelectorAll('.akari-inspector-kf-controls').length, 0, name);
  }
}));

test('cut の transform-x 行には KF 席がある', () => withFakeDocument(() => {
  const row = renderInspectorRow({
    name: 'transform-x', label: 'X', inputKind: 'scrub-number',
    getValue: () => '0', write: async () => ({ ok: true })
  }, { kind: 'cut', index: 0 });
  assert.equal(row.querySelectorAll('.akari-inspector-number-field').length, 1);
  assert.equal(row.querySelectorAll('.akari-inspector-kf-controls').length, 1);
}));

test('audio の formant select 上の右クリックから既定値に戻すと field.reset を呼ぶ', () => withFakeDocument(() => {
  const snapshot = audioSnapshot('sfx', { formant: 'shift' });
  const requests = [];
  const fields = audioSections(snapshot, async request => {
    requests.push(request);
    return { ok: true };
  }).flatMap(section => section.fields);
  const field = fields.find(candidate => candidate.name === 'audio-formant');
  assert.ok(field);
  const resetSnapshots = [];
  const reset = field.reset;
  const row = renderInspectorRow({ ...field, reset: value => {
    resetSnapshots.push(value);
    return reset(value);
  } }, snapshot);
  const select = row.children[1];
  assert.equal(select.tagName, 'SELECT');
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const fakeWindow = new FakeWindow();
  fakeWindow.setTimeout = callback => callback();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });
  try {
    let prevented = false;
    select.emit('contextmenu', {
      bubbles: true, target: select, clientX: 20, clientY: 30,
      preventDefault() { prevented = true; }
    });
    assert.equal(prevented, true);
    const menus = document.body.querySelectorAll('.akari-inspector-row-menu');
    assert.equal(menus.length, 1);
    const button = menus[0].children.find(child => child.textContent === '既定値に戻す');
    assert.ok(button);
    assert.equal(resetSnapshots.length, 0);
    button.emit('click');
    assert.deepEqual(resetSnapshots, [snapshot]);
    assert.deepEqual(requests, [{
      kind: 'audio-clip-fx', id: 'clip', audioKind: 'sfx', field: 'formant', value: null
    }]);
    assert.equal(document.body.querySelectorAll('.akari-inspector-row-menu').length, 0);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else delete globalThis.window;
  }
}));

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
    keyframe: { active: false, onToggle() {}, onPrevious() {}, onNext() {} },
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

test('sfx / bgm 音声タブはピッチ・タイム→音声強調、narration は音声強調だけを追加する', () => {
    for (const kind of ['sfx', 'bgm', 'narration']) {
        const sections = audioSections(audioSnapshot(kind), async () => ({ ok: true }))
            .filter(section => assignSectionToTab('audio', section.id) === 'audio');
        assert.deepEqual(sections.map(section => section.label), [
            '音声', '時間', ...(kind === 'narration' ? [] : ['フェード・ダッキング']), '音量キーフレーム',
            ...(kind === 'narration' ? [] : ['ピッチ・タイム']), '音声強調'
        ]);
        assert.ok(sections.find(section => section.id === 'audio:enhancement').fields[0].write);
    }
});

test('cut の音声タブはグレー 6 枚のまま、実働 clip FX は audio factory だけに属する', () => {
    assert.equal(AUDIO_PREVIEW_SECTIONS.length, 6);
    const render = sourceBetween('protected render(): void', 'protected tabSourceHint(');
    assert.match(render, /activeTab === 'audio' && sectionKind !== 'audio'[\s\S]*AUDIO_PREVIEW_SECTIONS[\s\S]*return;/u);
    assert.match(sourceBetween('function AUDIO_SECTIONS(', 'function AUDIO_CLIP_FX_SECTIONS('),
        /tabs.push\(\.\.\.AUDIO_CLIP_FX_SECTIONS\(snapshot, requestWrite\)\)/u);
});

test('ノイズ除去の実働強さ行は 60% 入力を 0.6 として書き、5% 刻みで操作する', async () => {
    const snapshot = audioSnapshot('sfx', { denoise: { method: 'nlm', strength: 0.5 } });
    const requests = [];
    const row = fxSections(snapshot, async request => { requests.push(request); return { ok: true }; })
        .flatMap(section => section.fields).find(field => field.name === 'audio-denoise-strength');
    assert.equal(row.getValue(snapshot), '50');
    assert.equal(row.disabled, false);
    assert.equal(row.scrubStep * row.displayScale, 5);
    const field = withFakeDocument(() => createNumberField({
        name: row.name, label: row.label, value: Number(row.getEditValue(snapshot)),
        min: row.min, max: row.max, step: row.scrubStep, unit: row.unit,
        displayScale: row.displayScale, displayPrecision: row.displayPrecision,
        onCommit: async value => (await row.write(snapshot, String(value))).ok
    }));
    const input = field.children[1];
    assert.equal(input.value, '50');
    input.value = '60';
    input.emit('blur');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(input.value, '60');
    assert.deepEqual(requests[0], {
        kind: 'audio-clip-fx', id: 'clip', audioKind: 'sfx', field: 'denoise',
        value: { method: 'nlm', strength: 0.6 }
    });
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
