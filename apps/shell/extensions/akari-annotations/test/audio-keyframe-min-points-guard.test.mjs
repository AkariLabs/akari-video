import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  AUDIO_KEYFRAME_MIN_POINTS,
  AUDIO_KEYFRAME_MIN_POINTS_NOTICE,
  audioKeyframeWriteGuard,
} from '../lib/common/audio-keyframe-editor-geometry.js';

const dialog = readFileSync(new URL('../src/browser/akari-audio-keyframe-dialog.ts', import.meta.url), 'utf8');
const widget = readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');

function section(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start);
  assert.ok(start >= 0 && end > start, `${startNeedle}..${endNeedle}`);
  return source.slice(start, end);
}

test('1 点のキーフレームは書き込み不可にする', () => {
  assert.equal(audioKeyframeWriteGuard([{ t: 0, gain_db: 0 }]), 'too-few');
});

test('0 点のキーフレームは削除経路として通す', () => {
  assert.equal(audioKeyframeWriteGuard([]), 'ok');
});

test('null のキーフレームは削除経路として通す', () => {
  assert.equal(audioKeyframeWriteGuard(null), 'ok');
});

test('2 点以上のキーフレームは書き込み可能にする', () => {
  assert.equal(audioKeyframeWriteGuard([{ t: 0 }, { t: 1 }]), 'ok');
  assert.equal(audioKeyframeWriteGuard([{ t: 0 }, { t: 1 }, { t: 2 }]), 'ok');
});

test('最小点数と notice 文言はシェル共通の固定値にする', () => {
  assert.equal(AUDIO_KEYFRAME_MIN_POINTS, 2);
  assert.equal(
    AUDIO_KEYFRAME_MIN_POINTS_NOTICE,
    'キーフレームは 2 点以上必要です。点を追加するか、この 1 点を削除してください。',
  );
});

test('dialog は isValid で1点 accept を止め、valid 復帰時に notice を消す', () => {
  const validation = section(dialog, 'protected override async isValid(', '\n    get value():');
  assert.match(validation, /audioKeyframeWriteGuard\(value\.keyframes\) === 'too-few'/u);
  assert.match(validation, /this\.showNotice\(AUDIO_KEYFRAME_MIN_POINTS_NOTICE\)/u);
  assert.match(
    validation,
    /return \{ message: AUDIO_KEYFRAME_MIN_POINTS_NOTICE, result: false \};/u,
  );
  assert.match(validation, /this\.hideNotice\(\);\s*return true;/u);
});

test('widget は1点要求を既存値・service・履歴に触れる前に拒否する', () => {
  const write = section(
    widget,
    'protected async handleInspectorWrite(',
    '\n    protected async handleAudioAutoLevelWrite(',
  );
  const rejection = section(
    write,
    "if (request.kind === 'audio-keyframes'",
    '        const location = this.location;',
  );
  assert.match(rejection, /audioKeyframeWriteGuard\(request\.value\) === 'too-few'/u);
  assert.match(
    rejection,
    /return \{ ok: false, message: AUDIO_KEYFRAME_MIN_POINTS_NOTICE \};/u,
  );
  assert.doesNotMatch(rejection, /setAudioKeyframes|pushHistory|commitEditMutation|current/u);

  const guard = write.indexOf('audioKeyframeWriteGuard(request.value)');
  const v2Write = write.indexOf('this.handleInspectorWriteV2(request)');
  const legacyWrite = write.indexOf('this.annotationsService.setAudioKeyframes');
  const legacyHistory = write.indexOf('this.pushHistory', legacyWrite);
  assert.ok(guard >= 0 && guard < v2Write);
  assert.ok(guard < legacyWrite && guard < legacyHistory);
});

test('dialog 経由の0点は null、2点以上は配列のまま widget へ渡す', () => {
  const open = section(
    widget,
    'protected async openAudioKeyframeEditor(',
    'protected exitAudioTrimmerMode(',
  );
  assert.match(
    open,
    /value: dialogValue\.keyframes\.length > 0 \? dialogValue\.keyframes : null/u,
  );
});
