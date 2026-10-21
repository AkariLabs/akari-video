// Web UI を shell に揃えた 4 点（task/2026-09-02-preview-perf: パリティ）。
//   1. 字幕時計: active cue の判定は出力秒（共有カーネル normalizeCaptionClock）
//   2. 字幕フォント名: @font-face 登録名 "AKARI Noto Sans JP" を font-family の先頭に置く
//   3. slot-params.js を配信し、mount 時に renderTextSlots を通す（data-mirror の aria-hidden も）
//   4. frame-engine の最下段 cut は「track 0」ではなく「最小の track」
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

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
  assert.match(updateCaption, /const active = findActiveCaptions\(captionsOutputClock, outputTime\);/u);
  assert.doesNotMatch(updateCaption, /getVideoTimeForOutput|srcT/u);
  const sync = app.slice(app.indexOf('function syncCaptionAnimations()'), app.indexOf('function esc('));
  assert.match(sync, /\(outputTime - start\) \* 1000/u);
});

test('字幕フォント: 登録名 "AKARI Noto Sans JP" を先頭に置く（index.html の @font-face と一致）', () => {
  assert.match(index, /@font-face \{ font-family: "AKARI Noto Sans JP";/u);
  const rule = app.slice(app.indexOf('.akari-caption {'), app.indexOf('.akari-caption__plate {'));
  assert.match(rule, /font-family:var\(--caption-font-family,"AKARI Noto Sans JP","Noto Sans JP",sans-serif\);/u);
});

test('English caption font has a fixed asset route and an AKARI family face', () => {
  assert.match(index, /@font-face \{ font-family: "AKARI Noto Sans"; src: url\("\/assets\/fonts\/akari-noto-sans\.ttf"\)/u);
  assert.match(server, /LATIN_CAPTION_FONT_PATH = fileURLToPath\(new URL\('\.\.\/\.\.\/\.\.\/assets\/font\/noto-sans\/NotoSans-Variable\.ttf'/u);
  assert.match(server, /pathname === LATIN_CAPTION_FONT_ROUTE/u);
  assert.match(app, /document\.fonts\.load\('600 82px "AKARI Noto Sans"', 'English captions'\)/u);
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
  // 断片の実体は先に全部そろえ（ファイル参照は fetch、インラインはそのまま）、
  // スコープ後に 1 か所の注入経路へ通す。fetch / インラインの両方が同じ経路に合流する。
  assert.equal((app.match(/setOverlayFragmentHtml\(c, /g) ?? []).length, 1, '注入は 1 か所に集約');
  assert.match(app, /spec\.needsFetch\s*\n?\s*\? fetch\(resolveMediaUrl\(spec\.rawHtml\)\)/u);
  assert.match(app, /: Promise\.resolve\(spec\.rawHtml\)\)/u);
  assert.doesNotMatch(app.slice(app.indexOf('function mount(s)'), app.indexOf('function syncHitRegion(')), /c\.innerHTML = (html \|\| ''|rawHtml);/u);
});

test('frame-engine client: 最下段は最小 track（shell の normalizedCuts と同じ規則）', () => {
  const fn = client.slice(client.indexOf('function normalizedCuts('), client.indexOf('function normalizedCuts(') + 1600);
  assert.match(fn, /const baseTrack = declaredTracks\.length > 0 \? Math\.min\(\.\.\.declaredTracks\) : 0;/u);
  assert.match(fn, /cut\.track > baseTrack \? Number\(cut\.track\) : 0;/u);
});

test('frame-engine client preserves base-track gaps while recomputing freeze and overlap', () => {
  const functionText = client.slice(client.indexOf('function normalizedCuts('),
    client.indexOf('function resolvedEngineLayers('));
  const { code } = transformSync(functionText, { loader: 'ts', format: 'esm' });
  const normalizedCuts = vm.runInNewContext(
    `const resolvedItemAdjust = item => item; ${code}; normalizedCuts`,
  );
  const cuts = normalizedCuts({ sources: [{ id: 's' }], cuts: [
    { src: 's', track: 1, at: 2, in: 0, out: 2,
      freeze: { at_sec: 1, duration_sec: 1 }, transition_out: { duration: 0.5 } },
    { src: 's', track: 1, at: 4.5, in: 2, out: 4 },
    { src: 's', track: 1, at: 8, in: 4, out: 5 },
    { src: 's', track: 2, at: 1, in: 0, out: 1 },
  ] });
  assert.equal(cuts[0].at, 2);
  assert.equal('at' in cuts[1], false);
  assert.equal(cuts[2].at, 8);
  assert.equal(cuts[3].at, 1);
  assert.equal(cuts[3].track, 2);
});
