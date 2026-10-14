import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveCaptionPlan } from '../src/caption-resolve.mjs';

const repoRootFileUrl = pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), '../../..') + sep).href;

test('旧 style_preset・emphasis_words・runs v0 の描画結果を固定する', () => {
  const old = { id: 'c-0001', start: 0, end: 2, text: '猫犬', style_preset: 'neon',
    words: [{ text: '猫', start: 0, end: 1 }, { text: '犬', start: 1, end: 2 }],
    runs: [{ from: 1, to: 2, style: { color: '#ff0000' }, animation: { in: { id: 'pop' } } }] };
  const captionsRoot = { captions: [old], emphasis_words: [{ id: 'e-0001', word: '猫',
    t_start: 0, t_end: 1, emotion: 'joy', style_hint: 'color-only' }] };
  const edit = { version: 1, output: { width: 1080, height: 1920 },
    sources: [{ id: 's1', path: 'assets/s1.mp4' }],
    cuts: [{ id: 'cut-1', src: 's1', in: 0, out: 2, at: 0, track: 0 }], overlays: [] };
  const [overlay] = resolveCaptionPlan({ captionsRoot, edit }).overlays;
  assert.match(overlay.html, /data-emphasis-id="e-0001"/);
  assert.match(overlay.html, /akari-caption__run/);
  const snapshot = JSON.stringify({ html: overlay.html, vars: overlay.vars })
    .replaceAll(repoRootFileUrl, 'file:///<repo>/');
  const digest = createHash('sha256').update(snapshot).digest('hex');
  assert.equal(digest, '607d3d6815fb2c6464aa562117b19f53e9e92e48466f2f6de973de0be3a1645a');
});

test('壊れ気味の旧い強調語十例も overlay を一つ描く', () => {
  const good = { id: 'e-0001', src: 's1', word: '猫', t_start: 0.7, t_end: 1.2,
    emotion: 'surprise', style_hint: 'one-char-bang' };
  const other = { ...good, word: '話', t_start: 1.4, t_end: 2 };
  const line = { id: 'c-0001', src: 's1', start: 0, end: 2, text: '今日は猫の話',
    words: [{ text: '今日', start: 0, end: 0.3 }, { text: 'は', start: 0.3, end: 0.7 },
      { text: '猫', start: 0.7, end: 1.2 }, { text: 'の', start: 1.2, end: 1.4 },
      { text: '話', start: 1.4, end: 2 }] };
  const { id, ...withoutId } = good;
  const { id: otherId, ...otherWithoutId } = other;
  const edit = { version: 1, output: { width: 1080, height: 1920 },
    sources: [{ id: 's1', path: 'assets/s1.mp4' }],
    cuts: [{ id: 'cut-1', src: 's1', in: 0, out: 2, at: 0, track: 0 }], overlays: [] };
  const cases = [
    { emphasis_words: [null, good] }, { emphasis_words: ['x', good] },
    { emphasis_words: {} }, { emphasis_words: 'text' }, { emphasis_words: null },
    { emphasis_words: [withoutId, otherWithoutId] },
    { emphasis_words: [{ ...good, id: 'x' }, { ...other, id: 'x' }] },
    { emphasis_words: [null, good], captions: [{ ...line, runs: [
      { id: 'r-0001', from: 0, to: 2, look: { color: '#ff0000' } }] }] },
    { emphasis_words: [good, other], captions: [{ ...line, runs: [null] }] },
    { emphasis_words: [good, other], captions: [{ ...line, runs: {} }] }
  ];
  for (const [index, item] of cases.entries()) {
    const captionsRoot = { captions: [line], ...item };
    assert.equal(resolveCaptionPlan({ captionsRoot, edit }).overlays.length, 1, `例 ${index + 1}`);
  }
});
