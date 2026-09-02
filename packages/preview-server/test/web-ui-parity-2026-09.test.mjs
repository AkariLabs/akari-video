// Web UI を shell に揃えた 4 点（task/2026-09-02-preview-perf: パリティ）。
//   1. 字幕時計: active cue の判定は出力秒（共有カーネル normalizeCaptionClock）
//   2. 字幕フォント名: @font-face 登録名 "AKARI Noto Sans JP" を font-family の先頭に置く
//   3. slot-params.js を配信し、mount 時に renderTextSlots を通す（data-mirror の aria-hidden も）
//   4. frame-engine の最下段 cut は「track 0」ではなく「最小の track」
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const read = name => readFile(path.resolve(import.meta.dirname, '..', name), 'utf8');
const [app, index, server, client] = await Promise.all([
  read('public/app.js'), read('public/index.html'), read('src/server.mjs'), read('src/frame-engine-client.ts'),
]);

test('字幕時計: 共有カーネルで出力秒へ正規化し、判定は outputTime だけ', () => {
  assert.match(app, /normalizeCaptionClock,\n/u);
  assert.match(app, /captionClockDomainOf,\n/u);
  assert.match(app, /captionsOutputClock = normalizeCaptionClock\(/u);
  assert.match(app, /timelineMap = built;\n  refreshCaptionClock\(\);/u);
  const updateCaption = app.slice(app.indexOf('function updateCaption()'), app.indexOf('function syncCaptionAnimations()'));
  assert.match(updateCaption, /const active = findActiveCaption\(caps, outputTime\);/u);
  assert.doesNotMatch(updateCaption, /getVideoTimeForOutput|srcT/u);
  const sync = app.slice(app.indexOf('function syncCaptionAnimations()'), app.indexOf('function esc('));
  assert.match(sync, /\(outputTime - start\) \* 1000/u);
});

test('字幕フォント: 登録名 "AKARI Noto Sans JP" を先頭に置く（index.html の @font-face と一致）', () => {
  assert.match(index, /@font-face \{ font-family: "AKARI Noto Sans JP";/u);
  const rule = app.slice(app.indexOf('.akari-caption {'), app.indexOf('.akari-caption__plate {'));
  assert.match(rule, /font-family:"AKARI Noto Sans JP","Noto Sans JP",sans-serif;/u);
});

test('slot-params: ルートで配信し、index.html が app.js より先に読み、mount が renderTextSlots を通す', () => {
  assert.match(server, /'\/slot-params\.js': fileURLToPath\(new URL\('\.\.\/\.\.\/overlay-runtime\/src\/slot-params\.js'/u);
  const slotAt = index.indexOf('<script src="/slot-params.js"></script>');
  const appAt = index.indexOf('<script type="module" src="/app.js"></script>');
  assert.ok(slotAt > 0 && appAt > slotAt, 'slot-params.js は app.js より前');
  const helper = app.slice(app.indexOf('function setOverlayFragmentHtml('), app.indexOf('function mount(s)'));
  assert.match(helper, /window\.akari\?\.slotParams\?\.renderTextSlots\?\.\(template\.content, params\)/u);
  assert.match(helper, /\[data-mirror="text"\]/u);
  assert.match(helper, /setAttribute\('aria-hidden', 'true'\)/u);
  assert.equal((app.match(/setOverlayFragmentHtml\(c, /g) ?? []).length, 2, 'fetch 経路とインライン経路の両方');
  assert.doesNotMatch(app.slice(app.indexOf('function mount(s)'), app.indexOf('function syncHitRegion(')), /c\.innerHTML = (html \|\| ''|rawHtml);/u);
});

test('frame-engine client: 最下段は最小 track（shell の normalizedCuts と同じ規則）', () => {
  const fn = client.slice(client.indexOf('function normalizedCuts('), client.indexOf('function normalizedCuts(') + 1600);
  assert.match(fn, /const baseTrack = declaredTracks\.length > 0 \? Math\.min\(\.\.\.declaredTracks\) : 0;/u);
  assert.match(fn, /cut\.track > baseTrack \? Number\(cut\.track\) : 0;/u);
});
