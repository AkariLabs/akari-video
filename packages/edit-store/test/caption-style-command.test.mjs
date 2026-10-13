import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { planCaptionStyleEdit, planCaptionStyleClear, planCaptionStyleReapply,
  planCaptionSizeEdit, captionValueHash } from '../lib/index.js';
import { applyCaptionStyle, applyCaptionLookMigration, setCaptionSize, clearCaptionStyle } from '../lib/caption-style-write.js';
import { projectFileHash, writeProjectFilesTransactional } from '../lib/write-gate.js';

const row = (extra = {}) => ({ id: 'c-0001', start: 0, end: 2, text: '赤い猫と赤い犬',
  speaker: 'a', sourceRef: null, edited: false, ...extra });
const root = (extra = {}) => ({ default_text_style: { size_px: 38 }, captions: [row(extra)] });
const source = { kind: 'my', id: '好きな見た目' };
const look = { size_px: 56, color: '#ffffff', stroke: { color: '#000000', width_px: 4 } };

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
