import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { planCaptionStyleEdit, planCaptionStyleClear, planCaptionStyleReapply,
  planCaptionSizeEdit, captionValueHash, captionEmphasisOverlapsRange,
  validateCaptionsSemantics, mergeCaptionTextStyles } from '../lib/index.js';

test('既定の fill と strokes を受け継ぐ行は大きさ変更後も px 以外を保つ', () => {
  const defaultStyle = { size_px: 38,
    fill: { type: 'pattern', pattern: { image: 'paper.png', scale: 2, repeat: 'repeat' }, opacity: 0.8 },
    strokes: [{ color: '#123456', width_px: 3, offset_x: 1, offset_y: 2 }] };
  const captions = { default_text_style: defaultStyle, captions: [
    { id: 'c-0001', text: '文字', start: 0, end: 1, text_style: {} },
    { id: 'c-0002', text: '別', start: 1, end: 2, text_style: {} }
  ] };
  const before = mergeCaptionTextStyles(defaultStyle, captions.captions[0].text_style);
  const after = planCaptionSizeEdit({ captions, targets: [{ caption_id: 'c-0001' }], size_px: 76 }).next.captions;
  const effective = mergeCaptionTextStyles(after.default_text_style, after.captions[0].text_style);
  assert.equal(effective.fill.pattern.scale, 4);
  assert.deepEqual({ ...effective.fill, pattern: { ...effective.fill.pattern, scale: 2 } }, before.fill);
  assert.deepEqual(effective.strokes, [{ color: '#123456', width_px: 6, offset_x: 2, offset_y: 4 }]);
  assert.deepEqual(after.default_text_style, defaultStyle);
  assert.deepEqual(after.captions[1], captions.captions[1]);
});
import { validateCaptionLookV1Shape } from '../lib/caption-look-shape.js';
import { TEXTSTYLE_CATALOG } from '../lib/generated/textstyle-catalog.js';
import { applyCaptionStyle, applyCaptionLookMigration, setCaptionSize, clearCaptionStyle } from '../lib/caption-style-write.js';
import { projectFileHash, writeProjectFilesTransactional } from '../lib/write-gate.js';

const row = (extra = {}) => ({ id: 'c-0001', start: 0, end: 2, text: '赤い猫と赤い犬',
  speaker: 'a', sourceRef: null, edited: false, ...extra });
const root = (extra = {}) => ({ default_text_style: { size_px: 38 }, captions: [row(extra)] });
const source = { kind: 'my', id: '好きな見た目' };
const look = { size_px: 56, color: '#ffffff', stroke: { color: '#000000', width_px: 4 } };

const wordRow = () => row({ text: '赤い猫', src: 's1', text_style: { size_px: 38,
  stroke: { color: '#000000', width_px: 4 }, shadow: { color: '#000000', opacity: 0.6, blur_px: 3 } },
  words: [{ text: '赤い', start: 0, end: 0.8 }, { text: '猫', start: 0.8, end: 1.4 }] });
const label = { size_px: 58, color: '#202020', background: { color: '#ffd948', opacity: 0.98,
  padding_px: 16, radius_px: 3 } };
const cat = { 'news-yellow-label': { id: 'news-yellow-label', style: label } };

test('38px の猫に黄色ラベルを当てると縁・影・グローを無しにして出所 hash が一致する', () => {
  const captions = { default_text_style: {}, captions: [wordRow()] };
  const result = planCaptionStyleEdit({ captions, targets: [{ caption_id: 'c-0001', range: { from: 2, to: 3 } }],
    parts: { look: label }, source: { kind: 'builtin', id: 'news-yellow-label' } });
  const line = result.next.captions.captions[0], run = line.runs[0];
  assert.equal(line.text_style.size_px, 38);
  assert.equal(run.look.color, '#202020');
  assert.equal(run.look.background.padding_px, 10.482759);
  assert.equal(run.look.background.radius_px, 1.965517);
  assert.deepEqual(run.look.stroke, { width_px: 0 });
  assert.deepEqual(run.look.shadow, { color: '#000000', opacity: 0 });
  assert.deepEqual(run.look.glow, { color: '#000000', density: 0 });
  assert.equal(run.style_sources.look.applied_hash, captionValueHash(run.look));
  assert.equal(run.style_sources.look.original_hash, captionValueHash({ color: '#202020', background: label.background }));
  assert.deepEqual(validateCaptionLookV1Shape(result.next.captions), []);
  assert.equal(validateCaptionsSemantics({ captions: result.next.captions }).some(item => item.severity === 'error'), false);
  assert.equal(planCaptionStyleReapply({ captions: result.next.captions, styles: { builtin: cat } }).items[0].modified, false);
  const cleared = planCaptionStyleClear({ captions: result.next.captions,
    targets: [{ caption_id: 'c-0001', range: { from: 2, to: 3 } }], mode: 'range' });
  assert.equal(cleared.next.captions.captions[0].runs.length, 0);
});

test('グローだけのスタイルは縁と影を無しにしグローの広がりを換算する', () => {
  const captions = { captions: [wordRow()] };
  const glow = planCaptionStyleEdit({ captions, targets: [{ caption_id: 'c-0001', range: { from: 2, to: 3 } }],
    parts: { look: { size_px: 58, color: '#ff0000', glow: { color: '#ff0000', density: 2, spread: 5 } } } })
    .next.captions.captions[0].runs[0].look;
  assert.equal(glow.stroke.width_px, 0);
  assert.equal(glow.shadow.opacity, 0);
  assert.equal(glow.glow.spread, 3.275862);
});

test('黄色のラベルを範囲に当てると太さ 800 を写し通知を出さない', () => {
  const result = planCaptionStyleEdit({ captions: { captions: [wordRow()] },
    targets: [{ caption_id: 'c-0001', range: { from: 2, to: 3 } }],
    parts: { look: TEXTSTYLE_CATALOG['news-yellow-label'].style } });
  assert.equal(result.next.captions.captions[0].runs[0].look.font_weight, 800);
  assert.deepEqual(result.notices, []);
  assert.deepEqual(validateCaptionLookV1Shape(result.next.captions), []);
});

test('ネオンを範囲に当てる通知は内部の鍵でなく日本語の名前を出す', () => {
  const { animation, ...look } = TEXTSTYLE_CATALOG.neon.style;
  const result = planCaptionStyleEdit({ captions: { captions: [wordRow()] },
    targets: [{ caption_id: 'c-0001', range: { from: 2, to: 3 } }],
    parts: { look } });
  assert.equal(result.next.captions.captions[0].runs[0].look.font_weight, 700);
  assert.match(result.notices.join(' '), /大文字・小文字の変換は字幕全体にだけ当てられます。/u);
  assert.doesNotMatch(result.notices.join(' '), /text_transform|weight/u);
});

test('実測時刻と表示位置の重なりで旧い強調を判定する', () => {
  const line = wordRow();
  assert.equal(captionEmphasisOverlapsRange(line, { from: 2, to: 3 },
    { src: 's1', word: '猫', t_start: 0.9, t_end: 1.2 }), true);
  assert.equal(captionEmphasisOverlapsRange(line, { from: 2, to: 3 },
    { src: 's2', word: '猫', t_start: 0.9, t_end: 1.2 }), false);
  assert.equal(captionEmphasisOverlapsRange({ ...line, words: undefined }, { from: 2, to: 3 },
    { word: '猫', t_start: 0.9, t_end: 1.2 }), true);
});

test('黄色ラベルを当てると style_preset と style_hint の旧い強調だけ同じ結果から消える', () => {
  const captions = { captions: [wordRow()], emphasis_words: [
    { id: 'e-0001', word: '猫', src: 's1', t_start: 0.8, t_end: 1.4, emotion: 'joy', style_preset: 'neon' },
    { id: 'e-0002', word: '猫', src: 's1', t_start: 0.8, t_end: 1.4, emotion: 'joy', style_hint: 'size-pulse' },
    { id: 'e-0003', word: '赤い', src: 's1', t_start: 0, t_end: 0.8, emotion: 'joy' }
  ], extra: { untouched: true } };
  const result = planCaptionStyleEdit({ captions, targets: [{ caption_id: 'c-0001', range: { from: 2, to: 3 } }],
    parts: { look: label } });
  assert.deepEqual(result.next.captions.emphasis_words.map(item => item.id), ['e-0003']);
  assert.ok(result.changed.includes('emphasis_words'));
  assert.equal(JSON.stringify(result.next.captions.extra), JSON.stringify(captions.extra));
  const split = planCaptionStyleClear({ captions: { captions: [{ ...wordRow(), runs: [
    { id: 'r-0001', from: 0, to: 3, look: { color: '#202020' } }] }],
    emphasis_words: [{ id: 'e-0001', word: 'い', t_start: 0, t_end: 0.8, emotion: 'joy' }] },
    targets: [{ caption_id: 'c-0001', range: { from: 1, to: 2 } }], mode: 'range' });
  assert.deepEqual(split.next.captions.captions[0].runs.map(run => run.id), ['r-0001', 'r-0002']);
  assert.deepEqual(split.next.captions.emphasis_words, []);
});

test('run の解除もその範囲の旧い強調を一緒に外す', () => {
  const captions = { captions: [{ ...wordRow(), runs: [{ id: 'r-0001', from: 2, to: 3,
    look: { color: '#202020' } }] }], emphasis_words: [
    { id: 'e-0001', word: '猫', t_start: 0.8, t_end: 1.4, emotion: 'joy' },
    { id: 'e-0002', word: '赤い', t_start: 0, t_end: 0.8, emotion: 'joy' }] };
  const result = planCaptionStyleClear({ captions, mode: 'run', targets: [
    { caption_id: 'c-0001', run_id: 'r-0001' }] });
  assert.deepEqual(result.next.captions.captions[0].runs, []);
  assert.deepEqual(result.next.captions.emphasis_words.map(item => item.id), ['e-0002']);
  assert.ok(result.changed.includes('emphasis_words'));
});

test('受け継いだ縁と範囲の台紙は 38 から 72 で同率になり他の行と既定は不変', () => {
  const captions = { default_text_style: { size_px: 38, stroke: { color: '#000000', width_px: 4 } },
    captions: [row({ text: '猫', runs: [{ id: 'r-0001', from: 0, to: 1,
      look: { background: { color: '#ffd948', padding_px: 10 } } }] }),
    row({ id: 'c-0002', text: '犬' })] };
  const defaultBefore = JSON.stringify(captions.default_text_style), otherBefore = JSON.stringify(captions.captions[1]);
  const resized = planCaptionSizeEdit({ captions, targets: [{ caption_id: 'c-0001' }], size_px: 72 }).next.captions;
  assert.equal(resized.captions[0].text_style.stroke.width_px, 7.578947);
  assert.equal(resized.captions[0].runs[0].look.background.padding_px, 18.947368);
  assert.equal(JSON.stringify(resized.default_text_style), defaultBefore);
  assert.equal(JSON.stringify(resized.captions[1]), otherBefore);
  assert.equal(JSON.stringify(planCaptionSizeEdit({ captions, targets: [{ caption_id: 'c-0001' }],
    size_px: 38 }).next.captions), JSON.stringify(captions));
});

test('範囲の無しは大きさ変更後もゼロで当て直しでは手直し扱いにならない', () => {
  const target = { caption_id: 'c-0001', range: { from: 2, to: 3 } };
  const applied = planCaptionStyleEdit({ captions: { captions: [wordRow()] }, targets: [target],
    parts: { look: label }, source: { kind: 'builtin', id: 'news-yellow-label' } }).next.captions;
  const resized = planCaptionSizeEdit({ captions: applied, targets: [{ caption_id: 'c-0001' }],
    size_px: 72 }).next.captions;
  const run = resized.captions[0].runs[0];
  assert.equal(run.look.stroke.width_px, 0);
  assert.equal(run.look.shadow.opacity, 0);
  assert.equal(run.look.glow.density, 0);
  assert.equal(run.look.background.padding_px, 19.86207);
  assert.equal(planCaptionStyleReapply({ captions: resized, styles: { builtin: cat } }).items[0].modified, false);
});

test('既定の縁の幅と行の縁の色は成分ごとに合成して換算する', () => {
  const captions = { default_text_style: { size_px: 38,
    stroke: { color: '#000000', width_px: 4 } },
    captions: [row({ text_style: { stroke: { color: '#ffffff' } } })] };
  const changed = planCaptionSizeEdit({ captions, targets: [{ caption_id: 'c-0001' }], size_px: 72 });
  assert.deepEqual(changed.next.captions.captions[0].text_style.stroke,
    { color: '#ffffff', width_px: 7.578947 });
});

test('ライブラリの preset を値へ解いてから大きさを換算する', () => {
  const captions = { captions: [row({ style_preset: 'custom-label' })] };
  const catalog = { 'custom-label': { id: 'custom-label', style: { size_px: 58,
    stroke: { color: '#000000', width_px: 5 }, animation: { in: { id: 'pop' } } } } };
  const resized = planCaptionSizeEdit({ captions, targets: [{ caption_id: 'c-0001' }],
    size_px: 72, catalog }).next.captions.captions[0];
  assert.equal(resized.style_preset, undefined);
  assert.equal(resized.text_style.stroke.width_px, 6.206897);
  assert.equal(resized.text_style.size_px, 72);
  assert.equal(resized.style_sources.motion.original_hash, captionValueHash({ in: { id: 'pop' } }));
});

test('適用境界の before 全文を書き戻すと run と旧い強調が元のバイト列に戻る', async () => {
  const project = await mkdtemp(join(tmpdir(), 'akari-caption-undo-'));
  try {
    const original = `${JSON.stringify({ captions: [wordRow()], emphasis_words: [
      { id: 'e-0001', word: '猫', src: 's1', t_start: 0.8, t_end: 1.4,
        emotion: 'joy', style_hint: 'size-pulse' }] }, null, 2)}\n`;
    await writeFile(join(project, 'captions.json'), original);
    const result = await applyCaptionStyle(project, { targets: [
      { caption_id: 'c-0001', range: { from: 2, to: 3 } }], parts: { look: label } },
    { expectedHashes: { captions: projectFileHash(original) } });
    assert.equal(JSON.parse(await readFile(join(project, 'captions.json'), 'utf8')).emphasis_words.length, 0);
    await writeProjectFilesTransactional(project, { label: 'undo', files: {
      'captions.json': { expectedHash: result.after['captions.json'].hash, next: result.before['captions.json'].text }
    } });
    assert.equal(await readFile(join(project, 'captions.json'), 'utf8'), original);
  } finally { await rm(project, { recursive: true, force: true }); }
});

test('1700 行の範囲適用・解除・大きさ変更は対象数に対して線形に増える', () => {
  const measure = count => {
    const captions = { default_text_style: { size_px: 38 }, captions: Array.from({ length: count }, (_, index) =>
      ({ id: `c-${index}`, start: index * 2, end: index * 2 + 1, text: '猫',
        text_style: { size_px: 38 }, runs: [] })) };
    const targets = captions.captions.map(line => ({ caption_id: line.id, range: { from: 0, to: 1 } }));
    const start = performance.now();
    const applied = planCaptionStyleEdit({ captions, targets, parts: { look: { color: '#202020' } } }).next.captions;
    const applyMs = performance.now() - start;
    const clearStart = performance.now();
    planCaptionStyleClear({ captions: applied, targets, mode: 'range' });
    const clearMs = performance.now() - clearStart;
    const sizeStart = performance.now();
    planCaptionSizeEdit({ captions: applied, targets: targets.map(target => ({ caption_id: target.caption_id })),
      size_px: 72 });
    const sizeMs = performance.now() - sizeStart;
    return [applyMs, clearMs, sizeMs];
  };
  measure(100);
  const small = measure(500), large = measure(1700);
  for (let index = 0; index < 3; index++) {
    assert.ok(large[index] <= Math.max(10, small[index]) * 6,
      `operation ${index}: ${large[index]}ms versus ${small[index]}ms`);
    assert.ok(large[index] < 1000, `operation ${index}: ${large[index]}ms`);
  }
});

test('BOM 付き字幕は BOM なしの期待 hash で書けて undo で元のバイト列に戻る', async () => {
  const project = await mkdtemp(join(tmpdir(), 'akari-bom-'));
  try {
    const original = `\uFEFF${JSON.stringify(root())}\n`;
    await writeFile(join(project, 'captions.json'), original);
    const result = await applyCaptionStyle(project, { targets: [{ caption_id: 'c-0001' }],
      parts: { look: { color: '#ffffff' } } }, { expectedHashes: { captions: projectFileHash(original.slice(1)) } });
    assert.equal(result.before['captions.json'].text, original);
    assert.equal(result.before['captions.json'].hash, projectFileHash(original));
    await writeProjectFilesTransactional(project, { label: 'undo', files: {
      'captions.json': { expectedHash: result.after['captions.json'].hash, next: result.before['captions.json'].text }
    } });
    assert.deepEqual(await readFile(join(project, 'captions.json')), Buffer.from(original));
  } finally { await rm(project, { recursive: true, force: true }); }
});

test('引用は重ならず NFC で探し元の書記素位置を返す', () => {
  const captions = root({ text: 'ああああか\u3099' });
  const result = planCaptionStyleEdit({ captions, targets: [
    { caption_id: 'c-0001', range: { quote: 'ああ', occurrence: 2 } },
    { caption_id: 'c-0001', range: { quote: 'が' } }
  ], parts: { look: { color: '#ffffff' } } });
  assert.deepEqual(result.next.captions.captions[0].runs.map(run => [run.from, run.to]), [[2, 4], [4, 5]]);
});

test('複数対象で同じ通知は一度だけ返す', () => {
  const captions = root({ text: '猫犬' });
  const result = planCaptionStyleEdit({ captions, targets: [
    { caption_id: 'c-0001', range: { from: 0, to: 1 } },
    { caption_id: 'c-0001', range: { from: 1, to: 2 } }
  ], parts: { look: { color: '#ffffff', font_family: 'Klee One' } } });
  assert.ok(result.notices.length > 0);
  assert.equal(new Set(result.notices).size, result.notices.length);
});

test('行に当てると大きさを保ち px を換算し preset を解いて出所を記録する', () => {
  const input = root({ style_preset: 'subtitle-news', text_style: { size_px: 38 } });
  const original = structuredClone(input);
  const result = planCaptionStyleEdit({ captions: input, targets: [{ caption_id: 'c-0001' }],
    parts: { look }, source, now: '2026-10-13T00:00:00Z' });
  const updated = result.next.captions.captions[0];
  assert.deepEqual(input, original);
  assert.equal(updated.text_style.size_px, 38);
  assert.equal(updated.text_style.stroke.width_px, 2.714286);
  assert.equal(updated.style_preset, undefined);
  assert.equal(updated.style_sources.look.kind, 'my');
  assert.equal(updated.style_sources.look.applied_at, '2026-10-13T00:00:00.000Z');
});

test('マイスタイル互換: keepSize 真の行 look は既存の置換結果と同じ', () => {
  const captions = { default_text_style: { size_px: 42, reference_height_px: 1920 },
    captions: [row({ text_style: { size_px: 38, color: '#ff0000', position: { y: 0.4 } } })] };
  const result = planCaptionStyleEdit({ captions, targets: [{ caption_id: 'c-0001' }],
    parts: { look }, source }).next.captions.captions[0].text_style;
  assert.deepEqual(result, { position: { y: 0.4 }, size_px: 38, color: '#ffffff',
    stroke: { color: '#000000', width_px: 2.714286 }, reference_height_px: 1920 });
});

test('layout と基準高さの衝突は文言に依存しない code を持つ', () => {
  const captions = { default_text_style: { layout: { mode: 'reference-pixel' } }, captions: [row()] };
  assert.throws(() => planCaptionStyleEdit({ captions, targets: [{ caption_id: 'c-0001' }],
    parts: { look: { color: '#ffffff', reference_height_px: 1920 } },
    legacy: { preset: 'drop', size: 'style' } }),
  error => error.code === 'AKARI_CAPTION_LAYOUT_REFERENCE_CONFLICT');
});

test('出所を渡さず部品を当てると古い出所を消し空の容器も消す', () => {
  const prior = { kind: 'my', id: 'old', original_hash: 'a', applied_hash: 'b' };
  const captions = root({ text_style: { size_px: 38 },
    style_sources: { look: prior, motion: prior },
    runs: [{ id: 'r-0001', from: 0, to: 1, look: { color: '#fff' },
      style_sources: { look: prior } }] });
  const first = planCaptionStyleEdit({ captions, targets: [{ caption_id: 'c-0001' }],
    parts: { look: { color: '#000' } } }).next.captions;
  assert.equal(first.captions[0].style_sources.look, undefined);
  assert.deepEqual(first.captions[0].style_sources, { motion: prior });
  const second = planCaptionStyleEdit({ captions: first, targets: [{ caption_id: 'c-0001' }],
    parts: { motion: { in: { id: 'pop' } } } }).next.captions;
  assert.equal(second.captions[0].style_sources, undefined);
  const range = planCaptionStyleEdit({ captions: second, targets: [{ caption_id: 'c-0001',
    range: { from: 0, to: 1 } }], parts: { look: { color: '#000' } } }).next.captions;
  assert.equal(range.captions[0].runs[0].style_sources, undefined);
});

test('保存する適用と移行は渡されたライブラリのカタログで preset を解く', async () => {
  const project = await mkdtemp(join(tmpdir(), 'akari-caption-catalog-'));
  const catalog = { 'library-only': { style: { size_px: 80, color: '#123456' } } };
  try {
    await writeFile(join(project, 'captions.json'), `${JSON.stringify(root({ style_preset: 'library-only' }))}\n`);
    const migrated = await applyCaptionLookMigration(project, { catalog });
    assert.equal(migrated.written.includes('captions.json'), true);
    assert.equal(JSON.parse(await readFile(join(project, 'captions.json'), 'utf8'))
      .captions[0].text_style.size_px, 80);
    await writeFile(join(project, 'captions.json'), `${JSON.stringify(root({ style_preset: 'library-only' }))}\n`);
    const applied = await applyCaptionStyle(project, { targets: [{ caption_id: 'c-0001' }],
      parts: { look: { size_px: 56, stroke: { color: '#fff', width_px: 4 } } } }, { catalog });
    assert.equal(JSON.parse(applied.after['captions.json'].text).captions[0].text_style.size_px, 80);
  } finally { await rm(project, { recursive: true, force: true }); }
});

test('字幕保存後の lint 結果を指定した callback へ渡す', async () => {
  const project = await mkdtemp(join(tmpdir(), 'akari-caption-lint-'));
  try {
    await writeFile(join(project, 'captions.json'), `${JSON.stringify(root())}\n`);
    let notified;
    const notification = new Promise(resolve => { notified = resolve; });
    await applyCaptionStyle(project, { targets: [{ caption_id: 'c-0001' }],
      parts: { look: { color: '#fff' } } }, { debounceMs: 0,
      lintRunner: async () => ({ pass: true, errors: [], findings: [] }), onLintResult: notified });
    assert.deepEqual(await notification, { pass: true, errors: [], findings: [] });
  } finally { await rm(project, { recursive: true, force: true }); }
});

test('マイスタイル互換: keepSize 偽の内部指定は元の大きさを写す', () => {
  const captions = root({ text_style: { size_px: 38, color: '#ff0000', position: { y: 0.4 } } });
  const result = planCaptionStyleEdit({ captions, targets: [{ caption_id: 'c-0001' }],
    parts: { look }, source, legacy: { size: 'style', preset: 'drop' } }).next.captions.captions[0].text_style;
  assert.deepEqual(result, { position: { y: 0.4 }, size_px: 56, color: '#ffffff',
    stroke: { color: '#000000', width_px: 4 } });
});

test('マイスタイル互換: preset のある行で内部 drop 指定なら解かず消す', () => {
  const captions = root({ style_preset: 'neon', text_style: { color: '#ff0000' } });
  const result = planCaptionStyleEdit({ captions, targets: [{ caption_id: 'c-0001' }],
    parts: { look }, source, legacy: { size: 'style', preset: 'drop' } }).next.captions.captions[0];
  assert.equal(result.style_preset, undefined);
  assert.deepEqual(result.text_style, { size_px: 56, color: '#ffffff',
    stroke: { color: '#000000', width_px: 4 } });
});

test('マイスタイル互換: preset の実効サイズを使ってから内部 drop 指定で外す', () => {
  const captions = { captions: [row({ style_preset: 'neon' })] };
  const result = planCaptionStyleEdit({ captions, targets: [{ caption_id: 'c-0001' }],
    parts: { look }, source, legacy: { preset: 'drop' } }).next.captions.captions[0];
  assert.equal(result.style_preset, undefined);
  assert.equal(result.text_style.size_px, 120);
  assert.equal(result.text_style.stroke.width_px, 4 * 120 / 56);
});

test('範囲は quote と occurrence で書記素を選び許可外を通知してファイル全体で採番する', () => {
  const captions = root({ runs: [{ id: 'r-0007', from: 0, to: 1, look: { color: '#ffffff' } }] });
  captions.unresolved_runs = [{ run: { id: 'r-0008', from: 0, to: 1 }, old_caption_id: 'c-x',
    old_text: 'x', old_src: null, old_start: 0, old_end: 1, reason: 'x' }];
  const result = planCaptionStyleEdit({ captions, targets: [{ caption_id: 'c-0001',
    range: { quote: '赤い', occurrence: 2 } }], parts: { look: { ...look, font_family: 'serif' } }, source });
  const run = result.next.captions.captions[0].runs[1];
  assert.deepEqual([run.from, run.to, run.id], [4, 6, 'r-0009']);
  assert.equal(run.look.font_family, undefined);
  assert.match(result.notices.join(' '), /フォント/);
  assert.throws(() => planCaptionStyleEdit({ captions, targets: [{ caption_id: 'c-0001',
    range: { quote: '赤い' } }], parts: { look }, source }), /2 件/);
});

test('複数の新しい範囲は 1 回のコマンドでも別の id を持つ', () => {
  const result = planCaptionStyleEdit({ captions: root(), targets: [
    { caption_id: 'c-0001', range: { from: 0, to: 1 } },
    { caption_id: 'c-0001', range: { from: 1, to: 2 } },
  ], parts: { look }, source });
  assert.deepEqual(result.next.captions.captions[0].runs.map(run => run.id), ['r-0001', 'r-0002']);
});

test('範囲の出所 hash は範囲の許可項目を使い大きさを含めない', () => {
  const value = { size_px: 56, italic: true, scale: 1.2, color: '#ffffff' };
  const result = planCaptionStyleEdit({ captions: root(), targets: [{ caption_id: 'c-0001',
    range: { from: 0, to: 1 } }], parts: { look: value }, source });
  const run = result.next.captions.captions[0].runs[0];
  assert.equal(run.style_sources.look.original_hash,
    captionValueHash({ italic: true, scale: 1.2, color: '#ffffff' }));
});

test('default 対象は配列ルートを object に上げる', () => {
  const result = planCaptionStyleEdit({ captions: [row()], targets: [{ default: true }],
    parts: { look }, source });
  assert.equal(Array.isArray(result.next.captions), false);
  assert.equal(result.next.captions.default_text_style.size_px, 38);
  assert.equal(result.next.captions.captions.length, 1);
});

test('解除 run は指定そのものを消す', () => {
  const captions = root({ runs: [{ id: 'r-0001', from: 0, to: 2, look: { color: '#ffffff' } }] });
  const result = planCaptionStyleClear({ captions, targets: [{ caption_id: 'c-0001', run_id: 'r-0001' }], mode: 'run' });
  assert.deepEqual(result.next.captions.captions[0].runs, []);
});

test('解除 range は重なる範囲を切り取り右側に新しい id を付ける', () => {
  const captions = root({ runs: [{ id: 'r-0001', from: 0, to: 7, look: { color: '#ffffff' } }] });
  const result = planCaptionStyleClear({ captions, targets: [{ caption_id: 'c-0001',
    range: { from: 2, to: 4 } }], mode: 'range' });
  const runs = result.next.captions.captions[0].runs;
  assert.deepEqual(runs.map(run => [run.from, run.to]), [[0, 2], [4, 7]]);
  assert.equal(runs[1].split_from, 'r-0001');
  assert.notEqual(runs[0].id, runs[1].id);
});

test('行の解除は look・motion と出所を消す', () => {
  const captions = root({ text_style: { color: '#ffffff', animation: { in: { id: 'pop' } } },
    style_sources: { look: { kind: 'my', id: 'x' } } });
  const result = planCaptionStyleClear({ captions, targets: [{ caption_id: 'c-0001' }], mode: 'run' });
  assert.equal(result.next.captions.captions[0].text_style, undefined);
  assert.equal(result.next.captions.captions[0].style_sources, undefined);
});

test('行の解除は利用者の大きさと配置を保って preset を外す', () => {
  const captions = root({ style_preset: 'neon', text_style: { size_px: 72, color: '#ffffff',
    position: { y: 0.4 }, animation: { in: { id: 'pop' } } } });
  const result = planCaptionStyleClear({ captions, targets: [{ caption_id: 'c-0001' }], mode: 'run' });
  assert.deepEqual(result.next.captions.captions[0].text_style, { size_px: 72, position: { y: 0.4 } });
  assert.equal(result.next.captions.captions[0].style_preset, undefined);
});

test('当て直しは手直しと見つからない出所を一覧にする', () => {
  const applied = planCaptionStyleEdit({ captions: root(), targets: [{ caption_id: 'c-0001' }],
    parts: { look }, source });
  const captions = applied.next.captions;
  captions.captions[0].text_style.color = '#ff0000';
  const result = planCaptionStyleReapply({ captions, styles: { lookup: () => undefined } });
  assert.equal(result.items[0].modified, true);
  assert.equal(result.items[0].status, 'missing');
  assert.match(result.notices.join(' '), /元のスタイルが見つかりません/);
  assert.equal(result.next, undefined);
});

test('当て直すと指定した部品だけ新しい値へ置換し大きさを保つ', () => {
  const target = { caption_id: 'c-0001' };
  const applied = planCaptionStyleEdit({ captions: root(), targets: [target], parts: { look }, source });
  const newer = { ...look, color: '#ff0000' };
  const result = planCaptionStyleReapply({ captions: applied.next.captions,
    styles: { lookup: () => ({ look: newer, revision: 2 }) },
    apply: [{ target, part: 'look' }] });
  assert.equal(result.items[0].status, 'updated');
  assert.equal(result.next.captions.captions[0].text_style.size_px, 38);
  assert.equal(result.next.captions.captions[0].text_style.color, '#ff0000');
  assert.equal(result.next.captions.captions[0].style_sources.look.revision, 2);
});

test('範囲への sfx は拒む', () => {
  assert.throws(() => planCaptionStyleEdit({ captions: root(), targets: [{ caption_id: 'c-0001',
    range: { from: 0, to: 1 } }], parts: { sfx: {} }, source }), /字幕全体/);
});

const fixture = async fn => {
  const dir = await mkdtemp(join(tmpdir(), 'akari-caption-style-'));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
};

test('意味の error があれば applyCaptionStyle は書かない', async () => fixture(async dir => {
  const sourceText = `${JSON.stringify(root({ runs: [{ id: 'r-0001', from: 0, to: 99, look: { color: '#ffffff' } }] }), null, 2)}\n`;
  await writeFile(join(dir, 'captions.json'), sourceText);
  await assert.rejects(applyCaptionStyle(dir, { targets: [{ caption_id: 'c-0001' }],
    parts: { look }, source }), error => error.code === 'AKARI_CAPTIONS_INVALID');
  assert.equal(await readFile(join(dir, 'captions.json'), 'utf8'), sourceText);
}));

const brokenV1Cases = [
  ['fire が bogus', run => { run.fire = 'bogus'; }],
  ['id が zzz', run => { run.id = 'zzz'; }],
  ['look が数値', run => { run.look = 5; }],
  ['look に id がない', run => { delete run.id; }],
  ['anchor が文字列', run => { run.anchor = 'x'; }],
  ['unresolved_runs が文字列', (_run, value) => { value.unresolved_runs = 'x'; }],
];
for (const [name, change] of brokenV1Cases) for (const command of ['applyCaptionStyle', 'applyCaptionLookMigration'])
test(`壊れた v1 の ${name} は ${command} で保存しない`, async () => fixture(async dir => {
  const value = root({ runs: [{ id: 'r-0001', from: 0, to: 1, look: { color: '#ffffff' } }] });
  value.captions.push(row({ id: 'c-0002', style_preset: 'neon' }));
  change(value.captions[0].runs[0], value);
  const text = `${JSON.stringify(value)}\n`;
  await writeFile(join(dir, 'captions.json'), text);
  const action = command === 'applyCaptionStyle'
    ? applyCaptionStyle(dir, { targets: [{ caption_id: 'c-0002' }], parts: { look }, source })
    : applyCaptionLookMigration(dir);
  await assert.rejects(action, error => error.code === 'AKARI_CAPTIONS_INVALID');
  assert.equal(await readFile(join(dir, 'captions.json'), 'utf8'), text);
}));

for (const [name, action] of [
  ['setCaptionSize', dir => setCaptionSize(dir, { targets: [{ caption_id: 'c-0002' }], size_px: 72 })],
  ['clearCaptionStyle', dir => clearCaptionStyle(dir, { targets: [{ caption_id: 'c-0002' }], mode: 'run' })]
]) test(`壊れた v1 は ${name} でも保存しない`, async () => fixture(async dir => {
  const value = root({ runs: [{ id: 'r-0001', from: 0, to: 1, look: 5 }] });
  value.captions.push(row({ id: 'c-0002', text_style: { size_px: 38, color: '#ffffff' } }));
  const text = `${JSON.stringify(value)}\n`;
  await writeFile(join(dir, 'captions.json'), text);
  await assert.rejects(action(dir), error => error.code === 'AKARI_CAPTIONS_INVALID');
  assert.equal(await readFile(join(dir, 'captions.json'), 'utf8'), text);
}));

test('setCaptionSize は 38 → 72 で縁と範囲の台紙の余白を同じ比で丸める', () => {
  const captions = root({ text_style: { size_px: 38, stroke: { color: '#000000', width_px: 4 } },
    runs: [{ id: 'r-0001', from: 0, to: 1, look: { background: { padding_px: 3 } } }] });
  const result = planCaptionSizeEdit({ captions, targets: [{ caption_id: 'c-0001' }], size_px: 72 });
  const updated = result.next.captions.captions[0];
  assert.equal(updated.text_style.stroke.width_px, 7.578947);
  assert.equal(updated.runs[0].look.background.padding_px, 5.684211);
});

test('setCaptionSize は layout の reference_height_px を保つ', () => {
  const captions = root({ text_style: { size_px: 38, layout: { mode: 'auto' }, reference_height_px: 1080 } });
  const result = planCaptionSizeEdit({ captions, targets: [{ caption_id: 'c-0001' }], size_px: 72 });
  assert.equal(result.next.captions.captions[0].text_style.reference_height_px, 1080);
});

test('setCaptionSize の比が 1 なら何も変えない', () => {
  const captions = root({ text_style: { size_px: 38 } });
  const result = planCaptionSizeEdit({ captions, targets: [{ caption_id: 'c-0001' }], size_px: 38 });
  assert.deepEqual(result.changed, []);
  assert.deepEqual(result.next.captions, captions);
});

test('大きさを変えても当て直し一覧で手直しにならない', () => {
  const first = planCaptionStyleEdit({ captions: root(), targets: [{ caption_id: 'c-0001' }],
    parts: { look }, source }).next.captions;
  const resized = planCaptionSizeEdit({ captions: first, targets: [{ caption_id: 'c-0001' }], size_px: 72 }).next.captions;
  const result = planCaptionStyleReapply({ captions: resized, styles: { lookup: () => ({ look }) } });
  assert.equal(result.items[0].modified, false);
});

test('applyCaptionStyle は読んだ hash とディスクが違えば Conflict になる', async () => fixture(async dir => {
  const text = `${JSON.stringify(root())}\n`;
  await writeFile(join(dir, 'captions.json'), text);
  await assert.rejects(applyCaptionStyle(dir, { targets: [{ caption_id: 'c-0001' }],
    parts: { look }, source }, { expectedHashes: { 'captions.json': projectFileHash('古い') } }),
  error => error.code === 'AKARI_WRITE_CONFLICT');
  assert.equal(await readFile(join(dir, 'captions.json'), 'utf8'), text);
}));

test('別名字幕の読み書きと期待 hash は実ファイル名と役割名を使える', async () => fixture(async dir => {
  const text = `${JSON.stringify(root())}\n`;
  const edit = '{"version":2}\n';
  await writeFile(join(dir, 'captions.b.json'), text);
  await writeFile(join(dir, 'edit.b.json'), edit);
  const files = { captions: 'captions.b.json', edit: 'edit.b.json' };
  await assert.rejects(applyCaptionStyle(dir, { targets: [{ caption_id: 'c-0001' }],
    parts: { look }, source }, { files, expectedHashes: { captions: projectFileHash('別') } }),
  error => error.code === 'AKARI_WRITE_CONFLICT');
  await assert.rejects(applyCaptionStyle(dir, { targets: [{ caption_id: 'c-0001' }],
    parts: { look }, source }, { files, expectedHashes: { 'edit.b.json': projectFileHash('別') } }),
  error => error.code === 'AKARI_WRITE_CONFLICT');
  const result = await applyCaptionStyle(dir, { targets: [{ caption_id: 'c-0001' }],
    parts: { look }, source }, { files, expectedHashes: { captions: projectFileHash(text), edit: projectFileHash(edit) } });
  assert.deepEqual(result.written, ['captions.b.json']);
  assert.equal(result.before['captions.b.json'].text, text);
  assert.equal(result.after['captions.b.json'].text, await readFile(join(dir, 'captions.b.json'), 'utf8'));
  await assert.rejects(readFile(join(dir, 'captions.json')));
}));
