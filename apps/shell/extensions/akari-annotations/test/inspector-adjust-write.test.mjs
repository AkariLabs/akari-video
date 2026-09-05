import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  createInspectorAdjustWriteRequest,
  formatInspectorAdjustValue,
  INSPECTOR_ADJUST_BASIC_FIELDS,
  INSPECTOR_LUT_PRESET_IDS,
  inspectorAdjustDisplayValue,
  inspectorAdjustInternalValue,
  isInspectorAdjustIdentity,
  readInspectorAdjustSnapshot,
  updateInspectorAdjust
} from '../lib/browser/inspector/adjust-fields.js';
import { createNumberField } from '../lib/browser/inspector/number-field.js';
import { updateTreeV2Item } from '../lib/common/edit-v2-mutations.js';

const inspectorSource = readFileSync(
  new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8'
);
const timelineSource = readFileSync(
  new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8'
);

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  assert.notEqual(startIndex, -1, start);
  assert.notEqual(endIndex, -1, end);
  return source.slice(startIndex, endIndex);
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
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
    for (const child of children) this.appendChild(child);
  }

  appendChild(child) {
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

test('基本補正 10 行と LUT 3 操作は item-field の adjust path へ対応する', () => {
  assert.equal(INSPECTOR_ADJUST_BASIC_FIELDS.length, 10);
  assert.deepEqual(
    INSPECTOR_ADJUST_BASIC_FIELDS.map(field => createInspectorAdjustWriteRequest(
      'item-1', `adjust.basic.${field.key}`, 0.25
    )),
    INSPECTOR_ADJUST_BASIC_FIELDS.map(field => ({
      kind: 'item-field', id: 'item-1', path: `adjust.basic.${field.key}`, value: 0.25
    }))
  );
  assert.deepEqual([
    createInspectorAdjustWriteRequest('item-1', 'adjust.lut.lut', 'cinematic'),
    createInspectorAdjustWriteRequest('item-1', 'adjust.lut.intensity', 0.8),
    createInspectorAdjustWriteRequest('item-1', 'adjust.sections.lut', false)
  ], [
    { kind: 'item-field', id: 'item-1', path: 'adjust.lut.lut', value: 'cinematic' },
    { kind: 'item-field', id: 'item-1', path: 'adjust.lut.intensity', value: 0.8 },
    { kind: 'item-field', id: 'item-1', path: 'adjust.sections.lut', value: false }
  ]);
  assert.deepEqual(
    createInspectorAdjustWriteRequest('cut-item', 'adjust.sections.basic', false),
    { kind: 'item-field', id: 'cut-item', path: 'adjust.sections.basic', value: false }
  );
});

test('表示変換は EV 小数 2 桁・±100 整数・3000K〜10000K を往復する', async () => {
  assert.equal(formatInspectorAdjustValue('exposure', 1), '1.00 EV');
  assert.equal(formatInspectorAdjustValue('contrast', -1), '-100');
  assert.equal(formatInspectorAdjustValue('saturation', 1), '100');
  assert.equal(formatInspectorAdjustValue('temperature', -1), '3000 K');
  assert.equal(formatInspectorAdjustValue('temperature', 0), '6500 K');
  assert.equal(formatInspectorAdjustValue('temperature', 1), '10000 K');
  assert.equal(inspectorAdjustDisplayValue('temperature', -1), 3000);
  assert.equal(inspectorAdjustDisplayValue('temperature', 1), 10000);
  assert.equal(inspectorAdjustInternalValue('temperature', 3000), -1);
  assert.equal(inspectorAdjustInternalValue('temperature', 10000), 1);

  const commits = [];
  const field = withFakeDocument(() => createNumberField({
    name: 'adjust-temperature', label: '色温度', value: -1,
    step: 0.01, min: -1, max: 1, unit: 'K',
    displayScale: 3500, displayOffset: 6500, displayPrecision: 0,
    onCommit: async value => {
      commits.push(value);
      return true;
    }
  }));
  const input = field.children[1];
  assert.equal(input.value, '3000');
  assert.equal(input.attributes.get('aria-valuemin'), '3000');
  assert.equal(input.attributes.get('aria-valuemax'), '10000');
  input.value = '10000';
  input.emit('blur');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(commits, [1]);
});

test('基本補正は未知キーを保持して部分更新し、全既定で adjust 自体を除去する', () => {
  const current = {
    future: { keep: true },
    basic: { contrast: 0.2, futureBasic: 7 },
    sections: { lut: false, futureSection: true }
  };
  const updated = updateInspectorAdjust(current, 'adjust.basic.exposure', 1);
  assert.deepEqual(updated, {
    future: { keep: true },
    basic: { contrast: 0.2, futureBasic: 7, exposure: 1 },
    sections: { lut: false, futureSection: true }
  });
  assert.deepEqual(
    updateInspectorAdjust({ basic: { exposure: 1 } }, 'adjust.basic.exposure', null),
    null
  );
  assert.equal(isInspectorAdjustIdentity({
    basic: Object.fromEntries(INSPECTOR_ADJUST_BASIC_FIELDS.map(field => [field.key, 0])),
    lut: null,
    sections: { basic: false, lut: false }
  }), true);
});

test('LUT はカタログ 10 本だけを提示し、選択・強度・なしを部分更新する', () => {
  assert.deepEqual([...INSPECTOR_LUT_PRESET_IDS], [
    'natural', 'cinematic', 'film-warm', 'mono', 'silver-retain',
    'vintage-fade', 'cool-clear', 'night-neon', 'forest-soft', 'sunset-gold'
  ]);
  let adjust = updateInspectorAdjust(undefined, 'adjust.lut.lut', 'cinematic');
  assert.deepEqual(adjust, { lut: { lut: 'cinematic' } });
  adjust = updateInspectorAdjust(adjust, 'adjust.lut.intensity', 0.4);
  assert.deepEqual(adjust, { lut: { lut: 'cinematic', intensity: 0.4 } });
  adjust = updateInspectorAdjust(adjust, 'adjust.lut.intensity', null);
  assert.deepEqual(adjust, { lut: { lut: 'cinematic' } });
  assert.equal(updateInspectorAdjust(adjust, 'adjust.lut.lut', null), null);
  assert.throws(
    () => updateInspectorAdjust(undefined, 'adjust.lut.intensity', 0.5),
    /LUT を選択/u
  );
});

test('sections OFF は値を保持して snapshot の行を無効化し、ON は疎辞書へ戻す', () => {
  const disabled = updateInspectorAdjust(
    { basic: { exposure: 1 }, lut: { lut: 'natural', intensity: 0.8 } },
    'adjust.sections.basic',
    false
  );
  assert.deepEqual(disabled, {
    basic: { exposure: 1 },
    lut: { lut: 'natural', intensity: 0.8 },
    sections: { basic: false }
  });
  assert.deepEqual(readInspectorAdjustSnapshot(disabled), {
    basic: {
      exposure: 1, contrast: 0, highlights: 0, shadows: 0, blacks: 0,
      whites: 0, temperature: 0, tint: 0, vibrance: 0, saturation: 0
    },
    lut: { lut: 'natural', intensity: 0.8 },
    sections: { basic: false, lut: true }
  });
  assert.deepEqual(
    updateInspectorAdjust(disabled, 'adjust.sections.basic', null),
    { basic: { exposure: 1 }, lut: { lut: 'natural', intensity: 0.8 } }
  );
});

test('v2 tree item へ露出を書き、既定へ戻すと adjust field が消える', () => {
  let document = {
    version: 2,
    output: { width: 1920, height: 1080, fps: 30 },
    sources: [{ id: 'main', path: 'assets/main.mp4' }],
    tracks: [{
      id: 'visual-1', lane: 'visual', z: 0,
      items: [{
        id: 'cut-1', at: 0, duration: 30, futureItem: 'keep',
        source: { kind: 'media', src: 'main', in: 0, out: 1 }
      }]
    }]
  };
  const item = () => document.tracks[0].items[0];
  document = updateTreeV2Item(document, 'cut-1', {
    adjust: updateInspectorAdjust(item().adjust, 'adjust.basic.exposure', 1)
  });
  assert.equal(item().adjust.basic.exposure, 1);
  assert.equal(item().futureItem, 'keep');
  document = updateTreeV2Item(document, 'cut-1', {
    adjust: updateInspectorAdjust(item().adjust, 'adjust.basic.exposure', null)
  });
  assert.equal(Object.hasOwn(item(), 'adjust'), false);
});

test('実働 2 セクションは近日 4 セクションより先に描かれ、OFF 行と KF 席を無効化する', () => {
  const adjustFactory = sourceBetween(inspectorSource, 'function ADJUST_SECTIONS(', '/**\n * タイムラインの選択内容');
  assert.match(adjustFactory, /id: 'adjust:basic'/u);
  assert.match(adjustFactory, /id: 'adjust:lut'/u);
  assert.match(adjustFactory, /INSPECTOR_ADJUST_BASIC_FIELDS\.map/u);
  assert.match(adjustFactory, /disabled: !basicEnabled/u);
  assert.match(adjustFactory, /keyframeDisabled: true/u);
  assert.match(adjustFactory, /disabled: !lutEnabled \|\| !adjust\.lut/u);
  assert.match(adjustFactory, /options: \['なし', \.\.\.INSPECTOR_LUT_PRESET_IDS\]/u);
  assert.match(inspectorSource, /ADJUST_SECTIONS\(rowSnapshot, requestWrite\)[\s\S]{0,360}ADJUST_PREVIEW_SECTIONS/u);
  assert.match(inspectorSource, /field\.keyframeDisabled[\s\S]{0,180}\.akari-inspector-kf-controls button/u);
});

test('snapshot は cut の実 itemId と全 visual 選択の adjust を運ぶ', () => {
  assert.match(timelineSource, /const itemId = this\.cutItemId\(selection\.index\)/u);
  assert.match(timelineSource, /kind: 'cut', index: selection\.index, itemId/u);
  assert.equal((timelineSource.match(/adjust: readInspectorAdjustSnapshot\(/gu) ?? []).length, 4);
});

test('adjust item-field は crop と同じネスト分岐で更新し、v1 は固定文言で拒否する', () => {
  const itemFieldBranch = sourceBetween(
    timelineSource,
    "} else if (request.kind === 'item-field') {",
    '} else if (cutKinds.has(request.kind)) {'
  );
  assert.match(itemFieldBranch, /request\.path\.startsWith\('adjust\.'\)/u);
  assert.match(itemFieldBranch, /updateInspectorAdjust\([\s\S]{0,180}raw\.adjust/u);
  assert.match(itemFieldBranch, /patch = \{[\s\S]{0,220}adjust:/u);
  assert.match(
    timelineSource,
    /return \{ ok: false, message: 'この項目の編集は edit\.json v2 のみ対応です。' \}/u
  );
});
