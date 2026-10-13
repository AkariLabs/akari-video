import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolveCaptionPlan } from '../src/caption-resolve.mjs';

const require = createRequire(import.meta.url);
const { planCaptionLookMigration, TEXTSTYLE_CATALOG } = require('../../edit-store/lib/index.js');

test('移行を一回と二回行っても書き出しの HTML と CSS 変数が等しい', () => {
  const root = { captions: [{ id: 'c-0001', src: 's1', start: 0, end: 3, text: '猫犬鳥',
    words: [{ text: '猫', start: 0, end: 1 }, { text: '犬', start: 1, end: 2 },
      { text: '鳥', start: 2, end: 3 }],
    style_preset: 'neon', runs: [{ from: 1, to: 2,
      style: { color: '#ff0000', scale: 0.7, stroke: { width_px: 6, color: '#ffffff' } },
      animation: { in: { id: 'pop' } } }] }],
    emphasis_words: [
      { id: 'e-0001', src: 's1', word: '猫', t_start: 0, t_end: 1,
        emotion: 'surprise', style_hint: 'one-char-bang' },
      { id: 'e-0002', src: 's1', word: '犬', t_start: 1, t_end: 2,
        emotion: 'joy', style_hint: 'size-pulse' },
      { id: 'e-0003', src: 's1', word: '鳥', t_start: 2, t_end: 3,
        emotion: 'sadness', style_hint: 'color-only' },
    ] };
  const edit = { version: 1, output: { width: 1080, height: 1920 },
    sources: [{ id: 's1', path: 'assets/s1.mp4' }],
    cuts: [{ id: 'cut-1', src: 's1', in: 0, out: 3, at: 0, track: 0 }], overlays: [] };
  const render = captionsRoot => resolveCaptionPlan({ captionsRoot, edit }).overlays
    .map(overlay => ({ html: overlay.html, vars: overlay.vars }));
  const before = render(root);
  const first = planCaptionLookMigration(root, TEXTSTYLE_CATALOG);
  const second = planCaptionLookMigration(first.next, TEXTSTYLE_CATALOG);
  assert.deepEqual(render(first.next), before);
  assert.deepEqual(render(second.next), before);
  assert.deepEqual(second.diff, []);
  assert.equal(first.next.captions[0].runs.length, second.next.captions[0].runs.length);
  assert.equal(first.next.emphasis_words.length, second.next.emphasis_words.length);
  assert.deepEqual(first.diff.map(item => item.path), [
    'captions[0].style_preset', 'captions[0].runs', 'captions[0].text_style',
    'captions[0].style_sources', 'emphasis_words'
  ]);
});

test('壊れた runs の三形でも字幕プランの解決で例外を出さない', () => {
  const edit = { version: 1, output: { width: 1080, height: 1920 },
    sources: [{ id: 's1', path: 'assets/s1.mp4' }],
    cuts: [{ id: 'cut-1', src: 's1', in: 0, out: 2, at: 0, track: 0 }], overlays: [] };
  for (const runs of [{}, 'x', [null]]) {
    const captionsRoot = { captions: [{ id: 'c-0001', src: 's1', start: 0, end: 2,
      text: '猫', speaker: null, sourceRef: null, edited: false, runs }] };
    assert.doesNotThrow(() => resolveCaptionPlan({ captionsRoot, edit }));
  }
});
