import assert from 'node:assert/strict';
import test from 'node:test';
import { setLanguage } from '../../i18n/index.mjs';
import { renderReport } from '../src/report.mjs';
import { renderText } from '../src/i18n.mjs';

test('English render report localizes fixed text', () => {
  setLanguage('en');
  try {
    const html = renderReport({
      version: 1, phase: 'planned',
      plan: { predicted_duration_seconds: 1, preset: { width: 320, height: 180, fps: 30 },
        output: 'exports/out.mp4', rasterizer: { selected: 'osr' }, intermediates: [], commands: {} },
      warnings: [],
    }, 'reports/render-report.html', '.');
    assert.match(html, /<h1>render-cut report<\/h1>/u);
    assert.doesNotMatch(html, /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
  } finally { setLanguage(undefined); }
});

test('render warning counts use singular English and stable Japanese wording', () => {
  setLanguage('en');
  try {
    assert.equal(renderText('render.captions.warning.wordBookFallback', { count: 1, n: 1 }),
      'Word book: line-break protection was removed for 1 line');
    assert.equal(renderText('render.captions.warning.wordBookFallback', { count: 2, n: 2 }),
      'Word book: line-break protection was removed for 2 lines');
    setLanguage('ja');
    assert.equal(renderText('render.captions.warning.wordBookFallback', { count: 1, n: 1 }),
      '単語帳: 1 行で行分割保護を外しました');
  } finally { setLanguage(undefined); }
});
