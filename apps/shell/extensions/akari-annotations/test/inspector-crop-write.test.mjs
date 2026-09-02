import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  createInspectorCropWriteRequest,
  INSPECTOR_CROP_DISPLAY_SCALE,
  INSPECTOR_CROP_SCRUB_STEP,
  normalizeInspectorCrop,
  updateInspectorCrop
} from '../lib/browser/inspector/crop-fields.js';
import { createNumberField } from '../lib/browser/inspector/number-field.js';
import { composeInspectorSections } from '../lib/browser/inspector/section-model.js';
import { assignSectionToTab } from '../lib/browser/inspector/tab-model.js';
import { updateItem, updateTreeV2Item } from '../lib/common/edit-v2-mutations.js';

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

test('crop 4 行は layer kind と item-field path を正しく書き分ける', () => {
  const axes = ['x', 'y', 'w', 'h'];
  assert.deepEqual(
    axes.map(axis => createInspectorCropWriteRequest({ kind: 'layer', id: 'layer-1' }, axis, 0.25)),
    [
      { kind: 'layer-crop-x', id: 'layer-1', value: 0.25 },
      { kind: 'layer-crop-y', id: 'layer-1', value: 0.25 },
      { kind: 'layer-crop-w', id: 'layer-1', value: 0.25 },
      { kind: 'layer-crop-h', id: 'layer-1', value: 0.25 }
    ]
  );
  assert.deepEqual(
    axes.map(axis => createInspectorCropWriteRequest({ kind: 'item', id: 'item-1' }, axis, 0.8)),
    axes.map(axis => ({ kind: 'item-field', id: 'item-1', path: `crop.${axis}`, value: 0.8 }))
  );
  assert.deepEqual(createInspectorCropWriteRequest({ kind: 'item', id: 'item-1' }, 'w', null), {
    kind: 'item-field', id: 'item-1', path: 'crop.w', value: null
  });
});

test('displayScale 100 の数値行は内部 0.8 を 80% と表示し、35% を 0.35 で commit する', async () => {
  const commits = [];
  const field = withFakeDocument(() => createNumberField({
    name: 'crop-w', label: '幅', value: 0.8,
    step: INSPECTOR_CROP_SCRUB_STEP,
    min: 0, max: 1, unit: '%', displayScale: INSPECTOR_CROP_DISPLAY_SCALE,
    onCommit: async value => {
      commits.push(value);
      return true;
    }
  }));
  const input = field.children[1];
  assert.equal(input.value, '80');
  input.value = '35';
  input.emit('blur');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(commits, [0.35]);
});

test('crop は 0..1 と右端/下端へ clamp され、未設定値は 0/0/1/1 になる', () => {
  assert.deepEqual(normalizeInspectorCrop(undefined), { x: 0, y: 0, w: 1, h: 1 });
  const next = updateInspectorCrop({ x: 0, y: 0, w: 0.8, h: 1 }, 'x', 0.5);
  assert.notEqual(next, null);
  assert.ok(Math.abs(next.x - 0.2) < 1e-9);
  assert.ok(next.x + next.w <= 1);
  assert.deepEqual(updateInspectorCrop({ x: 0, y: 0, w: 1, h: 1 }, 'h', -2), {
    x: 0, y: 0, w: 1, h: 0
  });
});

test('4 軸を既定へ戻すと layer / v2 item から crop フィールド自体が消える', () => {
  const fixture = () => ({
    version: 2,
    output: { width: 1920, height: 1080, fps: 30 },
    sources: [{ id: 'main', path: 'assets/main.mp4' }],
    tracks: [{
      id: 'visual-1', lane: 'visual', z: 0,
      items: [{
        id: 'item-1', at: 0, duration: 30,
        source: { kind: 'media', src: 'main', in: 0, out: 1 },
        crop: { x: 0.2, y: 0.1, w: 0.7, h: 0.8 }
      }]
    }]
  });
  for (const mutate of [
    (document, patch) => updateItem(document, { itemId: 'item-1', patch }),
    (document, patch) => updateTreeV2Item(document, 'item-1', patch)
  ]) {
    let document = fixture();
    for (const axis of ['x', 'y', 'w', 'h']) {
      const item = document.tracks[0].items[0];
      document = mutate(document, { crop: updateInspectorCrop(item.crop, axis, null) });
    }
    assert.equal(Object.hasOwn(document.tracks[0].items[0], 'crop'), false);
  }
});

test('クロップ節は layer / overlay / item の動画タブで変形直後に出て caption / audio には出ない', () => {
  const cropFieldsSource = sourceBetween(inspectorSource, 'function CROP_FIELDS', 'function CUT_SECTIONS');
  for (const label of ['左', '上', '幅', '高さ']) {
    assert.match(cropFieldsSource, new RegExp(`label: '${label}'`, 'u'));
  }
  assert.match(cropFieldsSource, /displayScale: INSPECTOR_CROP_DISPLAY_SCALE/u);
  assert.match(cropFieldsSource, /scrubStep: INSPECTOR_CROP_SCRUB_STEP/u);
  assert.match(cropFieldsSource, /liveField: `crop\.\$\{axis\}`/u);
  assert.match(cropFieldsSource, /removable: true/u);

  const mediaFactories = [
    sourceBetween(inspectorSource, 'function LAYER_SECTIONS(', 'function CAPTION_SECTIONS('),
    sourceBetween(inspectorSource, 'function OVERLAY_SECTIONS(', 'function TREE_ITEM_SECTIONS('),
    sourceBetween(inspectorSource, 'function TREE_ITEM_SECTIONS(', '@injectable()')
  ];
  for (const source of mediaFactories) {
    assert.match(source, /const cropFields = CROP_FIELDS/u);
    assert.match(source, /id: 'transform', label: '変形'[\s\S]*id: 'crop', label: 'クロップ'/u);
  }
  const captionFactory = sourceBetween(inspectorSource, 'function CAPTION_SECTIONS(', 'function MULTI_CAPTION_SECTIONS(');
  const audioFactory = sourceBetween(inspectorSource, 'function AUDIO_SECTIONS(', 'function OVERLAY_SECTIONS(');
  assert.doesNotMatch(captionFactory, /label: 'クロップ'|CROP_FIELDS/u);
  assert.doesNotMatch(audioFactory, /label: 'クロップ'|CROP_FIELDS/u);

  for (const kind of ['layer', 'overlay', 'item']) {
    assert.equal(assignSectionToTab(kind, 'crop'), 'video');
  }
  assert.deepEqual(
    composeInspectorSections([{ id: 'appearance' }, { id: 'crop' }, { id: 'transform' }]).map(({ id }) => id),
    ['transform', 'crop', 'appearance']
  );
});

test('確定 mutation は item crop path と layer crop kind の両方で既定値除去 helper を使う', () => {
  assert.match(timelineSource, /request\.path\.startsWith\('crop\.'\)[\s\S]{0,240}updateInspectorCrop/u);
  assert.match(timelineSource, /request\.kind === 'layer-crop-x'[\s\S]{0,500}updateInspectorCrop/u);
  assert.match(timelineSource, /patch = \{ crop: updateInspectorCrop/u);
});
