import assert from 'node:assert/strict';
import test from 'node:test';

import { ADJUST_PREVIEW_SECTIONS } from '../lib/browser/inspector/adjust-preview.js';
import { COMING_SOON_ADJUST_SECTIONS } from '../lib/browser/inspector/tab-model.js';

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.style = {};
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  append(...children) {
    children.forEach(child => this.appendChild(child));
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }
}

function withFakeDocument(callback) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const create = tagName => new FakeElement(tagName);
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElement: create, createElementNS: (_namespace, tagName) => create(tagName) }
  });
  try {
    return callback();
  } finally {
    if (original) Object.defineProperty(globalThis, 'document', original);
    else delete globalThis.document;
  }
}

function descendants(root) {
  return [root, ...root.children.flatMap(descendants)];
}

function hasClass(element, className) {
  return String(element.className ?? '').split(/\s+/u).includes(className);
}

function buildSection(id) {
  const section = ADJUST_PREVIEW_SECTIONS.find(candidate => candidate.id === id);
  assert.ok(section, id);
  return section.build();
}

test('調整プレビューは既存ラベルと一致する 6 セクションを定義する', () => {
  assert.equal(ADJUST_PREVIEW_SECTIONS.length, 6);
  assert.deepEqual(
    ADJUST_PREVIEW_SECTIONS.map(section => section.label),
    [...COMING_SOON_ADJUST_SECTIONS]
  );
});

test('基本補正は 10 行、エフェクトは 6 行を表示する', () => withFakeDocument(() => {
  const basicRows = descendants(buildSection('basic'))
    .filter(element => hasClass(element, 'akari-adjust-preview-row'));
  const effectRows = descendants(buildSection('effects'))
    .filter(element => hasClass(element, 'akari-adjust-preview-row'));
  assert.equal(basicRows.length, 10);
  assert.equal(effectRows.length, 6);
}));

test('カラーホイールは Lift / Gamma / Gain / Offset の 4 要素を表示する', () => withFakeDocument(() => {
  const wheels = descendants(buildSection('color-wheels'))
    .filter(element => hasClass(element, 'akari-adjust-preview-wheel'));
  assert.equal(wheels.length, 4);
}));

test('各プレビューは pointer event を受けず、活性 button / input を含まない', () => withFakeDocument(() => {
  for (const section of ADJUST_PREVIEW_SECTIONS) {
    const root = section.build();
    assert.equal(root.attributes.get('aria-disabled'), 'true', section.id);
    assert.equal(root.style.pointerEvents, 'none', section.id);
    const activeControls = descendants(root).filter(element =>
      (element.tagName === 'BUTTON' || element.tagName === 'INPUT') && element.disabled !== true
    );
    assert.deepEqual(activeControls, [], section.id);
  }
}));
