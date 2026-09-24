import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMyStyle, ignoredMyStyleParts, myStyleLook, myStylePartLabel, myStyleSamplePresentation, myStyleAppliesTo, parseMyStyle } from '../lib/common/my-style.js';
import { AkariProjectServiceImpl } from '../lib/node/akari-project-service.js';

test('保存形は未知の部品を保持し、位置を除き、絶対パスを拒む', () => {
  const now = '2026-09-24T00:00:00.000Z';
  const style = createMyStyle({ id: 'my-sample', name: '強調', when_to_use: '驚いたとき',
    sample_text: '文字', parts: [{ kind: 'look', text_style: { color: '#ff1744',
      position: { y: 0.8 }, text_anchor: 'tc', zone: 'top', layout: {}, animation: { in: { id: 'pop' } },
      reference_height_px: 1920 } , scope: 'caption', mode: 'modify' },
    { kind: 'motion', scope: 'clip', mode: 'modify', animation: { in: { id: 'pop' } } },
    { kind: 'future', scope: 'scene', mode: 'attach', attach: { at: 'in', offset_frames: 2 } }] }, now);
  const roundtrip = parseMyStyle(JSON.parse(JSON.stringify(style)));
  assert.deepEqual(myStyleLook(roundtrip), { color: '#ff1744', reference_height_px: 1920 });
  assert.deepEqual(ignoredMyStyleParts(roundtrip), ['motion', 'future']);
  assert.equal(roundtrip.license.scope, 'private-owned');
  assert.deepEqual(myStyleAppliesTo(roundtrip), ['caption', 'clip', 'scene']);
  assert.equal('applies_to' in parseMyStyle({ ...roundtrip, applies_to: ['clip'] }), false);
  assert.match(roundtrip.uid, /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
  assert.equal(roundtrip.version, 1);
  assert.equal(roundtrip.revision, 1);
  const reserved = { ...roundtrip, tags: ['強調'], requires: [{ category: 'font', id: 'sample', version: 1 }],
    provenance: { origin: 'own' }, price: null, visibility: 'shared' };
  assert.deepEqual(parseMyStyle(JSON.parse(JSON.stringify(reserved))), reserved);
  assert.throws(() => parseMyStyle({ ...style, parts: [{ kind: 'sfx', path: '/tmp/sound.wav' }] }), /絶対パス/);
  assert.equal(parseMyStyle({ ...style, when_to_use: '朝 /夜のルーティン' }).when_to_use, '朝 /夜のルーティン');
  assert.equal(parseMyStyle({ ...style, parts: [{ kind: 'sfx', url: 'https://example.com/sound.wav' }] }).parts[0].kind, 'sfx');
  for (const path of ['~/sound.wav', 'C:\\sound.wav', '\\\\server\\share\\sound.wav', 'file:///tmp/sound.wav']) {
    assert.throws(() => parseMyStyle({ ...style, parts: [{ kind: 'sfx', path }] }), /絶対パス/);
  }
  assert.throws(() => parseMyStyle({ ...style, id: '../escape' }), /保存形/);
  assert.throws(() => parseMyStyle({ ...style, schema: 'akari-style/v0' }), /保存形/);
  assert.throws(() => parseMyStyle({ ...style, parts: [{ kind: 'look', text_style: { color: '#fff' } }] }), /基準高さ/);
  assert.throws(() => parseMyStyle({ ...style, parts: [{ kind: 'look', text_style: { color: 42,
    reference_height_px: 1920 } }] }), /見た目の値/);
});

test('部品チップは既知 kind を日本語にし、見本へ縁取り・座布団・影を反映する', () => {
  assert.deepEqual(['look', 'motion', 'sfx', 'fx', 'decor', 'camera', 'future'].map(myStylePartLabel),
    ['見た目', '動き', '効果音', '画面効果', '装飾', 'カメラ', 'future']);
  const style = createMyStyle({ id: 'my-look', name: '見本', when_to_use: '強調', sample_text: '文字',
    parts: [{ kind: 'look', text_style: { color: '#ff1744', reference_height_px: 1920, stroke: { color: '#ffffff', width_px: 6 },
      background: { color: '#111111', opacity: 0.5, radius_px: 8 },
      shadow: { color: '#000000', opacity: 0.8, blur_px: 4 } } }] }, '2026-09-24T00:00:00.000Z');
  const css = myStyleSamplePresentation(style);
  assert.equal(css.color, '#ff1744');
  assert.match(css.WebkitTextStroke, /#ffffff/);
  assert.match(css.backgroundColor, /#111111 50%/);
  assert.equal(css.borderRadius, '3.4px');
  assert.match(css.textShadow, /#000000 80%/);
});

test('80px 字幕の見本は縁取り・影・座布団を文字と同じ比率で縮め、塗りを上に描く', () => {
  const style = createMyStyle({ id: 'my-variety', name: 'バラエティ', when_to_use: '強調', sample_text: '黄色',
    parts: [{ kind: 'look', text_style: { size_px: 80, reference_height_px: 1920, color: '#ffeb3b',
      stroke: { color: '#1a1a1a', width_px: 9 },
      shadow: { color: '#000000', blur_px: 8, distance_px: 6, angle_deg: 90 },
      background: { color: '#222222', padding_px: 12, radius_px: 8 } } }] },
  '2026-09-24T00:00:00.000Z');
  const css = myStyleSamplePresentation(style);
  assert.equal(css.fontSize, 22);
  assert.equal(css.WebkitTextStroke, '2.5px #1a1a1a');
  assert.equal(css.paintOrder, 'stroke fill');
  assert.equal(css.textShadow, '0px 1.7px 2.2px color-mix(in srgb, #000000 100%, transparent)');
  assert.equal(css.padding, '3.3px');
  assert.equal(css.borderRadius, '2.2px');
});

test('小さな正の寸法は見本でも 0.5px を残す', () => {
  const style = createMyStyle({ id: 'my-thin', name: '細い', when_to_use: '控えめ', sample_text: '文字',
    parts: [{ kind: 'look', text_style: { size_px: 80, reference_height_px: 1920, stroke: { color: '#000000', width_px: 1 },
      shadow: { color: '#000000', blur_px: 1, distance_px: 1, angle_deg: 90 },
      background: { padding_px: 1, radius_px: 1 } } }] }, '2026-09-24T00:00:00.000Z');
  const css = myStyleSamplePresentation(style);
  assert.equal(css.WebkitTextStroke, '0.5px #000000');
  assert.equal(css.padding, '0.5px');
  assert.equal(css.borderRadius, '0.5px');
  assert.match(css.textShadow, /^0px 0.5px 0.5px /);
});

test('効果無しの明示値は保存形を往復できる', () => {
  const style = createMyStyle({ id: 'none', name: '無し', when_to_use: '控えめ', sample_text: '文字',
    parts: [{ kind: 'look', text_style: { reference_height_px: 1920,
      stroke: { width_px: 0 }, background: { opacity: 0 },
      shadow: { color: '#000000', opacity: 0 }, glow: { color: '#000000', density: 0 } } }] },
  '2026-09-24T00:00:00.000Z');
  assert.deepEqual(parseMyStyle(JSON.parse(JSON.stringify(style))), style);
});

test('style.json を書き、再読込・名前変更・削除できる', async t => {
  const root = await mkdtemp(join(tmpdir(), 'akari-my-style-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new AkariProjectServiceImpl();
  service.myStylesDirectory = async () => join(root, 'styles');
  const style = createMyStyle({ id: 'my-one', name: '最初', when_to_use: '強調',
    sample_text: '文字', parts: [{ kind: 'look', text_style: { color: '#ffffff', reference_height_px: 1920 } }] },
    '2026-09-24T00:00:00.000Z');
  await service.saveMyStyle(style);
  await mkdir(join(root, 'styles', 'broken'));
  await writeFile(join(root, 'styles', 'broken', 'style.json'), '{}');
  const raw = await readFile(join(root, 'styles', 'my-one', 'style.json'), 'utf8');
  assert.equal(raw.includes(root), false);
  assert.deepEqual(await service.listMyStyles(), [style]);
  await service.renameMyStyle(style.id, '変更後');
  assert.equal((await service.listMyStyles())[0].name, '変更後');
  assert.equal((await service.listMyStyles())[0].uid, style.uid);
  assert.equal((await service.listMyStyles())[0].revision, 2);
  await assert.rejects(service.saveMyStyle({ ...style, uid: createMyStyle({ ...style, id: 'other' }, style.created_at).uid }), /衝突/);
  await assert.rejects(service.saveMyStyle({ ...style, id: 'other' }), /UID/);
  await writeFile(join(root, 'styles', 'my-one', 'thumbnail.png'), 'fixture');
  await service.deleteMyStyle(style.id);
  assert.deepEqual(await service.listMyStyles(), []);
});
