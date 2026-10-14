import { setLanguage } from '@akari-video/i18n';
import assert from 'node:assert/strict';
import test from 'node:test';

import { after as resetLanguageAfter } from 'node:test';
setLanguage('ja');
resetLanguageAfter(() => setLanguage(undefined));
const { itemMotionMarks } = await import('../lib/browser/inspector/motion-marks.js');


test('軸ごとの点・プリセット・親キャンバスの印を重ねる', () => {
  const item = {
    keyframes: [{ t: 0, transform: { x: 10 }, opacity: 0.5 }],
    motion: { in: { preset: 'fade', duration: 12 } }, canvasMotion: true
  };
  assert.deepEqual(itemMotionMarks(item, 'transform.x'), ['キーフレーム', '入り・抜き', 'キャンバス']);
  assert.deepEqual(itemMotionMarks(item, 'transform.y'), ['入り・抜き', 'キャンバス']);
  assert.deepEqual(itemMotionMarks(item, 'opacity'), ['キーフレーム', '入り・抜き', 'キャンバス']);
});
