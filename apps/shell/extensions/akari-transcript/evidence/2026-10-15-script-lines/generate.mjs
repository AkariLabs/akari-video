#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { formatScriptTime, orderScriptDisplayLines, readScriptLines } from '../../lib/common/daihon-script-lines.js';

const folder = path.dirname(fileURLToPath(import.meta.url));
const script = readScriptLines(await readFile(path.join(folder, 'script.json'), 'utf8'));
const captions = JSON.parse(await readFile(path.join(folder, 'captions.json'), 'utf8'));
const rows = orderScriptDisplayLines(captions, script.lines);
assert.deepEqual(rows.map(row => row.kind), ['plan', 'caption', 'plan', 'caption', 'memo', 'caption']);

const widgetSource = await readFile(path.resolve(folder, '../../src/browser/daihon/akari-daihon-widget.ts'), 'utf8');
const tick = String.fromCharCode(96);
const start = widgetSource.indexOf('const STYLE = ' + tick) + ('const STYLE = ' + tick).length;
const end = widgetSource.indexOf(tick + '.replace(', start);
assert.ok(start > 15 && end > start, 'widget STYLE must be extractable');
const widgetCss = widgetSource.slice(start, end).replace('__AKARI_UNSAVED__', '未保存');

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
function captionTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return String(minutes) + ':' + String(Math.floor(rest)).padStart(2, '0') + '.'
    + String(Math.floor((rest % 1) * 100)).padStart(2, '0');
}
function rowHtml(row) {
  if (row.kind === 'caption') {
    const caption = row.caption;
    return '<div class="akari-daihon-row" data-caption-id="' + escapeHtml(caption.id) + '">'
      + '<div class="akari-daihon-row-head"><span class="akari-daihon-kind">字幕</span>'
      + '<button class="akari-daihon-tc">' + captionTime(caption.start) + ' – ' + captionTime(caption.end) + '</button></div>'
      + '<span class="akari-daihon-row-text">' + escapeHtml(caption.text) + '</span></div>';
  }
  const line = row.line;
  const time = line.kind === 'plan' && line.duration
    ? formatScriptTime(line.at) + '–' + formatScriptTime(line.at + line.duration)
    : formatScriptTime(line.at);
  const checked = line.kind === 'plan'
    ? '<input type="checkbox" aria-label="済"' + (line.done ? ' checked' : '') + '>' : '';
  return '<div class="akari-daihon-script-line' + (line.done ? ' is-done' : '')
    + '" data-kind="' + line.kind + '" data-script-id="' + escapeHtml(line.id) + '">'
    + '<div class="akari-daihon-row-head"><span class="akari-daihon-kind">'
    + (line.kind === 'plan' ? '予定' : 'メモ') + '</span><span class="akari-daihon-tc">'
    + time + '</span>' + checked + '<button class="akari-daihon-script-menu" title="行の操作">⋯</button></div>'
    + '<span class="akari-daihon-row-text">' + escapeHtml(line.text) + '</span></div>';
}

const evidenceCss = ':root{color-scheme:dark;--theia-editor-background:#20252b;--theia-foreground:#e5eaed;'
  + '--akari-ink:#e5eaed;--akari-muted:#a9b5bd;--akari-card:#2b333a;--akari-elevated:#344049;'
  + '--akari-line:#50606b;--akari-line-inner:#394650;--akari-accent:#54cfbd;--theia-widget-border:#394650}'
  + 'body{margin:0;background:#151a20;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif}'
  + '.evidence-stage{position:relative;width:720px;height:690px;display:flex;align-items:flex-start;padding:30px;box-sizing:border-box}'
  + '.akari-daihon-widget{width:400px;height:620px;flex:none;border:1px solid var(--akari-line);border-radius:8px;box-shadow:0 14px 38px #0008}'
  + '.akari-daihon-row-head button{background:transparent;border:0}'
  + '.akari-daihon-script-line .akari-daihon-row-text{color:var(--akari-ink)}'
  + '.akari-daihon-pop.evidence-menu{position:absolute;left:448px;top:85px;width:230px;max-height:none;box-sizing:border-box}'
  + '.akari-daihon-pop.evidence-menu button{color:var(--akari-ink);border:0;background:transparent;text-align:left;padding:7px}'
  + '.akari-daihon-pop.evidence-menu button.selected{color:var(--akari-accent)}';

const html = [
  '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
  '<title>台本パネル script-lines v0</title><style>', evidenceCss, widgetCss, '</style></head><body>',
  '<main class="evidence-stage"><section class="akari-daihon-widget" aria-label="台本">',
  '<header class="akari-daihon-head"><button class="akari-daihon-captions">字幕を作る…</button>',
  '<button class="akari-daihon-cuts">✂ カットを整える</button>',
  '<button class="akari-daihon-display" aria-expanded="true">表示 ▾</button>',
  '<button class="akari-daihon-qc ok">QC ✓</button><button class="akari-daihon-more">⋯</button></header>',
  '<div class="akari-daihon-source">台本 · 字幕 3 行 / 予定 2 行 / メモ 1 行</div>',
  '<div class="akari-daihon-rows-region"><div class="akari-daihon-rows show-script-lines">',
  rows.map(rowHtml).join(''), '</div></div>',
  '<div class="akari-daihon-actionbar"></div>',
  '<footer class="akari-daihon-footer"><button class="akari-daihon-display">＋ メモ</button>',
  '<span>行を選ぶと操作が表示されます</span></footer></section>',
  '<div class="akari-daihon-pop evidence-menu"><button class="selected">✓ 予定とメモを出す</button></div>',
  '</main></body></html>\n'
].join('');
const htmlPath = path.join(folder, 'panel.html');
await writeFile(htmlPath, html);

let screenshotStatus;
try {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 760, height: 720 }, deviceScaleFactor: 2 });
    await page.goto(pathToFileURL(htmlPath).href);
    assert.equal(await page.locator('.akari-daihon-rows > div').count(), 6);
    await page.locator('.evidence-stage').screenshot({ path: path.join(folder, 'panel.png') });
    screenshotStatus = 'Playwright Chromium で panel.png を生成済み。';
  } finally {
    await browser.close();
  }
} catch (error) {
  screenshotStatus = 'Playwright Chromium の起動または撮影に失敗: ' + String(error.message).split('\n')[0];
  console.warn(screenshotStatus);
}

await writeFile(path.join(folder, 'README.md'), [
  '# 台本パネル script-lines v0 証跡',
  '',
  '生成: リポジトリルートで `node apps/shell/extensions/akari-transcript/evidence/2026-10-15-script-lines/generate.mjs`。先に `apps/shell/extensions/akari-transcript` で `npx tsc -b` を実行し、`lib/common/daihon-script-lines.js` を更新する。',
  '',
  '`script.json`（予定 2 行・メモ 1 行）と `captions.json`（字幕 3 行）から、ビルド済み純関数 `readScriptLines` と `orderScriptDisplayLines` で時刻順を求める。`panel.html` の CSS は `akari-daihon-widget.ts` の `STYLE` から抽出し、フッターの「＋ メモ」、行種別、予定の区間・済チェック・⋯メニュー、開いた表示メニューを示す。',
  '',
  screenshotStatus,
  '',
  'この証跡は fixture から生成した静的描画であり、実機アプリのキャプチャではない。',
  ''
].join('\n'));
console.log('Generated panel.html; ' + screenshotStatus);
