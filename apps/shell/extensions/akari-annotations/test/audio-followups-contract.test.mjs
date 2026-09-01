import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [model, inspector, widget, protocol] = await Promise.all([
  readFile(new URL('../src/browser/timeline-selection-model.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/common/akari-annotations-protocol.ts', import.meta.url), 'utf8')
]);

test('InspectorWriteOperation は duck と keyframes の全 write kind を正式に持つ', () => {
  const union = model.slice(model.indexOf('type InspectorWriteOperation'), model.indexOf('/**\n * targets'));
  for (const kind of [
    'bgm-duck-db', 'bgm-duck-attack', 'bgm-duck-release',
    'sfx-ducking', 'sfx-duck-db', 'sfx-duck-attack', 'sfx-duck-release',
    'audio-keyframes'
  ]) assert.match(union, new RegExp(`kind: '${kind}'`, 'u'));
});

test('InspectorWriteOperation は自動レベル write kind を正式に持つ', () => {
  const union = model.slice(model.indexOf('type InspectorWriteOperation'), model.indexOf('/**\n * targets'));
  assert.match(union, /kind: 'audio-auto-level'/u);
  assert.match(union, /audioKind: 'bgm' \| 'sfx' \| 'narration'/u);
});

test('両 widget は AudioEnvelopeWriteRequest 回避 union と cast を持たない', () => {
  for (const source of [inspector, widget]) {
    assert.doesNotMatch(source, /\bAudioEnvelopeWriteRequest\b/u);
    assert.doesNotMatch(source, /as\s+(?:InspectorWriteOperation|AudioEnvelopeWriteRequest)\b/u);
  }
});

test('shell payload は edit-store の EditAudioKeyframe を正本にする', () => {
  assert.match(protocol, /import type \{ EditAudioKeyframe, TransitionType \}/u);
  assert.match(protocol, /export type AudioEnvelopeKeyframePayload = EditAudioKeyframe;/u);
});

test('表示と書き込みは省略 gain_db を 0 dB に正規化する', () => {
  assert.match(inspector, /point\.gain_db \?\? 0/u);
  assert.match(widget, /gain_db: point\.gain_db \?\? 0/u);
  assert.match(widget, /gainDb: point\.gain_db \?\? 0/u);
});
