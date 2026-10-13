import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateCaptionOverlays } from '../src/captions.mjs';

const require = createRequire(import.meta.url);
const { applyCaptionStylePresets, TEXTSTYLE_CATALOG } = require('../../edit-store/lib/index.js');
const repoRootFileUrl = pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), '../../..') + sep).href;

test('旧 style_preset・emphasis_words・runs v0 の描画結果を固定する', () => {
  const old = { id: 'c-0001', start: 0, end: 2, text: '猫犬', style_preset: 'neon',
    words: [{ text: '猫', start: 0, end: 1 }, { text: '犬', start: 1, end: 2 }],
    runs: [{ from: 1, to: 2, style: { color: '#ff0000' }, animation: { in: { id: 'pop' } } }] };
  const [resolved] = applyCaptionStylePresets([old], TEXTSTYLE_CATALOG).root;
  const [overlay] = generateCaptionOverlays([resolved], [], { output: { width: 1080, height: 1920 },
    emphasisWords: [{ id: 'e-0001', word: '猫', t_start: 0, t_end: 1,
      emotion: 'joy', style_hint: 'color-only' }] });
  assert.match(overlay.html, /data-emphasis-id="e-0001"/);
  assert.match(overlay.html, /akari-caption__run/);
  const snapshot = JSON.stringify({ html: overlay.html, vars: overlay.vars })
    .replaceAll(repoRootFileUrl, 'file:///<repo>/');
  const digest = createHash('sha256').update(snapshot).digest('hex');
  assert.equal(digest, '607d3d6815fb2c6464aa562117b19f53e9e92e48466f2f6de973de0be3a1645a');
});
