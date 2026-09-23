import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  filterInspectorSoloSections,
  inspectorSoloSectionMatches,
  normalizeInspectorSoloKind
} from '../lib/browser/inspector/solo-model.js';

const sections = [{
  id: 'transform',
  label: '変形',
  fields: [
    { name: 'transform-x', label: 'X' },
    { name: 'transform-scale', label: '拡縮' }
  ],
  optionalFields: [{ name: 'transform-rotate', label: '回転' }]
}, {
  id: 'time',
  label: '時間',
  fields: [{ name: 'output-start', label: '開始' }]
}];

const target = {
  kind: 'cut',
  tabId: 'video',
  sectionId: 'transform',
  fieldName: 'transform-scale'
};

test('指定した行を含む節とその行だけを返す', () => {
  const filtered = filterInspectorSoloSections('cut', sections, target);
  assert.deepEqual(filtered.map(section => [
    section.id,
    section.fields.map(field => field.name),
    section.optionalFields?.map(field => field.name)
  ]), [['transform', ['transform-scale'], []]]);
  assert.equal(sections[0].fields.length, 2);
});

test('行を指定しない場合は指定した節をそのまま返す', () => {
  const filtered = filterInspectorSoloSections('cut', sections, {
    kind: 'cut', tabId: 'video', sectionId: 'transform'
  });
  assert.deepEqual(filtered, [sections[0]]);
});

test('存在しない行では空の列を返す', () => {
  assert.deepEqual(filterInspectorSoloSections('cut', sections, {
    ...target, fieldName: 'missing-field'
  }), []);
});

test('multi 選択を caption として扱う', () => {
  const captionSections = [{
    id: 'content',
    label: '内容',
    fields: [{ name: 'caption-text', label: 'テキスト' }]
  }];
  const filtered = filterInspectorSoloSections('multi', captionSections, {
    kind: 'caption', tabId: 'text', sectionId: 'content', fieldName: 'caption-text'
  });
  assert.equal(normalizeInspectorSoloKind('multi'), 'caption');
  assert.deepEqual(filtered, captionSections);
});

test('選択変更の購読から絞り込み解除判定を呼ぶ', () => {
  const source = readFileSync(new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8');
  assert.match(source, /this\.model\.onChanged\(\(\) => \{\s*this\.clearSoloForSelectionChange\(\);/u);
});

test('親セクション ID はコロンで区切られた子だけを含む', () => {
  assert.equal(inspectorSoloSectionMatches('style:position', 'style'), true);
  assert.equal(inspectorSoloSectionMatches('audio:fades', 'audio'), true);
  assert.equal(inspectorSoloSectionMatches('adjust:basic', 'adjust:basic'), true);
  assert.equal(inspectorSoloSectionMatches('adjust:curves', 'adjust:basic'), false);
  assert.equal(inspectorSoloSectionMatches('stylesheet', 'style'), false);
});
