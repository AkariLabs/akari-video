import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUDIO_ITEM_PREVIEW_SECTIONS,
  AUDIO_PREVIEW_SECTIONS
} from '../lib/browser/inspector/audio-preview.js';

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

function descendants(root) {
  return [root, ...root.children.flatMap(descendants)];
}

function hasClass(element, className) {
  return String(element.className ?? '').split(/\s+/u).includes(className);
}

function buildSection(id) {
  const section = AUDIO_PREVIEW_SECTIONS.find(candidate => candidate.id === id);
  assert.ok(section, id);
  return section.build();
}

test('音声プレビューは裁定どおりの 6 セクションと audio アイテム用 2 セクションを定義する', () => {
  assert.deepEqual(AUDIO_PREVIEW_SECTIONS.map(section => section.label), [
    '音量', 'フェード', '音声強調', 'ダッキング', 'A/V リンク', 'ピッチ・タイム'
  ]);
  assert.deepEqual(AUDIO_ITEM_PREVIEW_SECTIONS.map(section => section.label), [
    '音声強調', 'ピッチ・タイム'
  ]);
});

test('各音声プレビューは裁定どおりの行数を表示する', () => withFakeDocument(() => {
  const expectedRows = new Map([
    ['volume', 2],
    ['fades', 2],
    ['enhancement', 4],
    ['ducking', 2],
    ['av-link', 3],
    ['pitch-time', 2]
  ]);
  for (const [id, count] of expectedRows) {
    const rows = descendants(buildSection(id))
      .filter(element => hasClass(element, 'akari-audio-preview-row'));
    assert.equal(rows.length, count, id);
  }
}));

test('各音声プレビューは pointer event を受けず、活性 button / input を含まない', () => withFakeDocument(() => {
  for (const section of AUDIO_PREVIEW_SECTIONS) {
    const root = section.build();
    assert.equal(root.attributes.get('aria-disabled'), 'true', section.id);
    assert.equal(root.style.pointerEvents, 'none', section.id);
    const activeControls = descendants(root).filter(element =>
      (element.tagName === 'BUTTON' || element.tagName === 'INPUT') && element.disabled !== true
    );
    assert.deepEqual(activeControls, [], section.id);
  }
}));
