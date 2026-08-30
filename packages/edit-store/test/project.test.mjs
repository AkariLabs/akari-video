import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import { serializeCaptions, serializeEdit, serializeMotion } from '../lib/canonical.js';
import { readInternalEdit } from '../lib/internal-model.js';
import { openProject } from '../lib/project.js';
import {
  ITEM_SOURCE_V2_KEYS,
  ITEM_V2_KEYS,
  KEYFRAME_V2_KEYS,
} from '../lib/generated/edit-v2-keys.js';

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(import.meta.dirname, '..');

function editWith(tracks, extra = {}) {
  return {
    version: 2,
    output: { width: 640, height: 360, fps: 30 },
    sources: [],
    tracks,
    ...extra,
  };
}

function track(id, items) {
  return { id, lane: 'visual', items };
}

function filterItem(id, at, duration, extra = {}) {
  return { id, at, duration, source: { kind: 'filter', filter: { type: 'invert' } }, ...extra };
}

function groupItem(id, at, duration, items, extra = {}) {
  return { id, at, duration, source: { kind: 'group' }, items, ...extra };
}

function points(count) {
  return Array.from({ length: count }, (_, t) => ({ t, opacity: t / Math.max(1, count - 1) }));
}

async function makeProject(edit, captions, files = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'edit-store-project-'));
  await writeFile(path.join(root, 'edit.json'), typeof edit === 'string' ? edit : JSON.stringify(edit), 'utf8');
  if (captions !== undefined) {
    await writeFile(path.join(root, 'captions.json'), typeof captions === 'string' ? captions : JSON.stringify(captions), 'utf8');
  }
  for (const [relative, text] of Object.entries(files)) {
    const destination = path.join(root, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, text, 'utf8');
  }
  return root;
}

async function hashes(root) {
  const result = {};
  async function visit(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = path.posix.join(prefix, entry.name);
      if (entry.isDirectory()) await visit(path.join(directory, entry.name), relative);
      else result[relative] = createHash('sha256').update(await readFile(path.join(directory, entry.name))).digest('hex');
    }
  }
  await visit(root);
  return result;
}

test('openProject は読むだけで全ファイルの bytes を変えない', async t => {
  const root = await makeProject(
    editWith([track('v1', [filterItem('clip', 0, 30)])]),
    [{ id: 'c1', start: 0, end: 1, text: '字幕', speaker: null, sourceRef: null, edited: false }],
    {
      'overlays/card.html': '<div>card</div>',
      'motion/g1.json': JSON.stringify({ version: 0, group: 'g1', items: { clip: points(2) } }),
    },
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const before = await hashes(root);
  await openProject(root);
  assert.deepEqual(await hashes(root), before);
});

test('正規形は無編集 save で byte 等価、非正規形は canonical へ正規化される', async t => {
  const doc = editWith([track('v1', [filterItem('clip', 0, 30)])]);
  const captions = [{ id: 'c1', start: 0, end: 1, text: '字幕', speaker: null, sourceRef: null, edited: false }];
  const canonicalRoot = await makeProject(serializeEdit(doc), serializeCaptions(captions));
  const compactRoot = await makeProject(doc);
  t.after(() => fs.rmSync(canonicalRoot, { recursive: true, force: true }));
  t.after(() => fs.rmSync(compactRoot, { recursive: true, force: true }));

  const canonicalBefore = await hashes(canonicalRoot);
  const unchanged = await (await openProject(canonicalRoot)).save();
  assert.deepEqual(unchanged, { written: [], findings: [] });
  assert.deepEqual(await hashes(canonicalRoot), canonicalBefore);

  const normalized = await (await openProject(compactRoot)).save();
  assert.deepEqual(normalized.written, ['edit.json']);
  assert.equal(await readFile(path.join(compactRoot, 'edit.json'), 'utf8'), serializeEdit(doc));
  assert.equal(fs.existsSync(path.join(compactRoot, 'captions.json')), false);
});

test('keyframes は 9 点以上を最寄りグループ袋へ出し、8 点は inline、段直下は自分の袋へ出す', async t => {
  const doc = editWith([track('v1', [
    groupItem('g-hook', 0, 30, [
      filterItem('h-title', 0, 15, { keyframes: points(9) }),
      filterItem('h-small', 15, 15, { keyframes: points(8) }),
    ]),
    filterItem('top', 30, 15, { keyframes: points(9) }),
  ])]);
  const root = await makeProject(doc);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const p = await openProject(root);
  const result = await p.save();
  assert.deepEqual(result.written.sort(), ['edit.json', 'motion/g-hook.json', 'motion/top.json']);
  const saved = JSON.parse(await readFile(path.join(root, 'edit.json'), 'utf8'));
  const savedGroup = saved.tracks[0].items[0];
  assert.deepEqual(savedGroup.items[0].keyframes, { path: 'motion/g-hook.json', count: 9 });
  assert.equal(savedGroup.items[1].keyframes.length, 8);
  assert.deepEqual(saved.tracks[0].items[1].keyframes, { path: 'motion/top.json', count: 9 });
  assert.equal(JSON.parse(await readFile(path.join(root, 'motion/g-hook.json'), 'utf8')).items['h-title'].length, 9);
});

test('参照形 keyframes の袋を編集すると count と実点数を更新する', async t => {
  const motion = { version: 0, group: 'g-hook', items: { 'h-title': points(9) } };
  const doc = editWith([track('v1', [groupItem('g-hook', 0, 30, [
    filterItem('h-title', 0, 15, { keyframes: { path: 'motion/g-hook.json', count: 9 } }),
  ])])]);
  const root = await makeProject(serializeEdit(doc), undefined, { 'motion/g-hook.json': serializeMotion(motion) });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const p = await openProject(root);
  (await p.motion('g-hook')).items['h-title'] = points(5);
  await p.save();
  assert.equal(p.edit.find('h-title').keyframes.count, 5);
  assert.equal(JSON.parse(await readFile(path.join(root, 'motion/g-hook.json'), 'utf8')).items['h-title'].length, 5);
});

test('motion 袋を保存しても参照されていない孤児 item は削除しない', async t => {
  const gone = points(2);
  const motion = { version: 0, group: 'g1', items: { kept: points(9), gone } };
  const doc = editWith([track('v1', [groupItem('g1', 0, 30, [
    filterItem('kept', 0, 15, { keyframes: { path: 'motion/g1.json', count: 9 } }),
  ])])]);
  const root = await makeProject(serializeEdit(doc), undefined, { 'motion/g1.json': serializeMotion(motion) });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const p = await openProject(root);
  (await p.motion('g1')).items.kept = points(5);
  await p.save();
  const saved = JSON.parse(await readFile(path.join(root, 'motion/g1.json'), 'utf8'));
  assert.equal(saved.items.kept.length, 5);
  assert.deepEqual(saved.items.gone, gone);
});

test('存在しない motion 袋は読んだだけでは保存対象にならない', async t => {
  const root = await makeProject(serializeEdit(editWith([track('v1', [filterItem('base', 0, 30)])])));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const p = await openProject(root);
  await p.motion('x');
  const result = await p.save();
  assert.deepEqual(result.written, []);
  assert.equal(fs.existsSync(path.join(root, 'motion/x.json')), false);
});

test('id 指定ヘルパは 3 段入れ子を操作し、重なる段への move は直上段を生やす', async t => {
  const leaf = filterItem('leaf', 2, 5);
  const doc = editWith([
    track('v1', [groupItem('root', 0, 30, [groupItem('middle', 1, 20, [leaf])])]),
    track('v2', [filterItem('occupied', 0, 10)]),
  ]);
  const root = await makeProject(serializeEdit(doc));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const p = await openProject(root);
  assert.equal(p.edit.find('leaf').id, 'leaf');
  assert.equal(p.edit.parentOf('leaf').id, 'middle');
  const walked = [];
  p.edit.walk(item => walked.push(item.id));
  assert.deepEqual(walked, ['root', 'middle', 'leaf', 'occupied']);
  p.edit.update('leaf', { name: 'updated' });
  assert.equal(p.edit.find('leaf').name, 'updated');
  p.edit.insert('middle', filterItem('inserted', 0, 5));
  assert.equal(p.edit.parentOf('inserted').id, 'middle');
  p.edit.move('inserted', { track: 'v2' });
  assert.equal(p.edit.tracks.length, 3);
  assert.equal(p.edit.tracks[2].items[0].id, 'inserted');
  assert.equal(p.edit.remove('inserted').id, 'inserted');
  assert.equal(p.edit.find('inserted'), undefined);
});

test('lint error は save を拒みファイルを 1 byte も変えない', async t => {
  const doc = editWith([track('v1', [filterItem('a', 0, 20)])]);
  const root = await makeProject(serializeEdit(doc));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const before = await hashes(root);
  const p = await openProject(root);
  p.edit.tracks[0].items.push(filterItem('b', 10, 20));
  await assert.rejects(p.save(), error => {
    assert.match(`${error.message} ${JSON.stringify(error.findings)}`, /v2\.track-no-overlap/u);
    return true;
  });
  assert.deepEqual(await hashes(root), before);
});

test('group → ungroup は描画用 internal JSON を保つ', async t => {
  const doc = editWith([track('v1', [filterItem('a', 0, 10), filterItem('b', 10, 10)])]);
  const root = await makeProject(serializeEdit(doc));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const p = await openProject(root);
  const before = JSON.parse(JSON.stringify(readInternalEdit(JSON.parse(serializeEdit(p.edit)))));
  const grouped = p.edit.group(['a', 'b']);
  p.edit.ungroup(grouped.group.id);
  const after = JSON.parse(JSON.stringify(readInternalEdit(JSON.parse(serializeEdit(p.edit)))));
  assert.deepEqual(after, before);
});

test('ungroup は transform / opacity / at を式どおり焼き込み、焼けない動きと袋を拒否する', async t => {
  const child = filterItem('child', 10, 20, {
    transform: { x: 3, y: 4, scale: 3, rotate: 30 }, opacity: 0.4,
  });
  const parent = groupItem('g1', 100, 100, [child], {
    transform: { x: 10, y: 20, scale: 2, rotate: 90 }, opacity: 0.5,
  });
  const root = await makeProject(serializeEdit(editWith([track('v1', [parent])])));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const p = await openProject(root);
  const [baked] = p.edit.ungroup('g1');
  assert.equal(baked.at, 110);
  assert.ok(Math.abs(baked.transform.x - 2) < 1e-9);
  assert.ok(Math.abs(baked.transform.y - 26) < 1e-9);
  assert.equal(baked.transform.scale, 6);
  assert.equal(baked.transform.rotate, 120);
  assert.equal(baked.opacity, 0.2);

  for (const [key, value] of [['keyframes', points(2)], ['motion', { in: { preset: 'fade', duration: 2 } }], ['animator', []]]) {
    const blocked = groupItem(`blocked-${key}`, 0, 20, [filterItem(`child-${key}`, 0, 10)], { [key]: value });
    p.edit.insert('v1', blocked);
    assert.throws(() => p.edit.ungroup(blocked.id), /v2\.group-bake-blocked/u);
    p.edit.remove(blocked.id);
  }
  for (const bag of [
    { id: 'bag-captions', at: 0, duration: 20, source: { kind: 'captions', path: 'captions.json' }, items: [] },
    { id: 'bag-html', at: 20, duration: 20, source: { kind: 'html', path: 'overlays/bag.html' }, items: [] },
  ]) {
    p.edit.insert('v1', bag);
    assert.throws(() => p.edit.ungroup(bag.id), /袋グループ/u);
  }
});

test('detach は袋 exclude と直上段を作り、親の時間・変形・不透明度を焼き込む', async t => {
  const child = filterItem('part', 10, 20, {
    transform: { x: 3, y: 4, scale: 3, rotate: 30 }, opacity: 0.4,
  });
  const bag = {
    id: 'bag', at: 100, duration: 100,
    transform: { x: 10, y: 20, scale: 2, rotate: 90 }, opacity: 0.5,
    source: { kind: 'html', path: 'overlays/bag.html', exclude: [] }, items: [child],
  };
  const root = await makeProject(serializeEdit(editWith([track('v1', [bag])])));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const p = await openProject(root);
  const detached = p.edit.detach('part', { track: 'above' });
  assert.deepEqual(bag.source.exclude, []);
  assert.deepEqual(p.edit.find('bag').source.exclude, ['part']);
  assert.equal(p.edit.tracks.length, 2);
  assert.equal(p.edit.tracks[1].items[0], detached);
  assert.equal(detached.at, 110);
  assert.ok(Math.abs(detached.transform.x - 2) < 1e-9);
  assert.ok(Math.abs(detached.transform.y - 26) < 1e-9);
  assert.equal(detached.transform.scale, 6);
  assert.equal(detached.transform.rotate, 120);
  assert.equal(detached.opacity, 0.2);
});

test('group は異なる場所の混在を拒み、離れた段では最前面へ置いて順序変化 id を返す', async t => {
  const nested = groupItem('nested', 0, 20, [filterItem('inside', 0, 10)]);
  const root = await makeProject(serializeEdit(editWith([
    track('v1', [filterItem('a', 0, 20)]),
    track('v2', [filterItem('between', 0, 20), nested]),
    track('v3', [filterItem('b', 0, 20)]),
  ])));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const p = await openProject(root);
  assert.throws(() => p.edit.group(['inside', 'a']), /同じ場所/u);
  const result = p.edit.group(['a', 'b']);
  assert.equal(p.edit.tracks[2].items.some(item => item.id === result.group.id), true);
  assert.deepEqual(result.changedOrderIds.sort(), ['between', 'nested']);
});

test('examples は字幕シフトとグループ倍速を子プロセスで実行する', async t => {
  const captions = [
    { id: 'c-0001', start: 59.9, end: 60.2, text: 'before', speaker: null, sourceRef: null, edited: false },
    { id: 'c-0002', start: 60, end: 61, text: 'after', speaker: null, sourceRef: null, edited: false },
  ];
  const captionsRoot = await makeProject(
    serializeEdit(editWith([track('v1', [filterItem('base', 0, 120)])])),
    serializeCaptions(captions),
  );
  const speedRoot = await makeProject(serializeEdit(editWith([track('v1', [
    groupItem('g1', 0, 100, [filterItem('a', 20, 20), filterItem('b', 50, 21)]),
  ])])));
  t.after(() => fs.rmSync(captionsRoot, { recursive: true, force: true }));
  t.after(() => fs.rmSync(speedRoot, { recursive: true, force: true }));

  const shifted = await execFileAsync(process.execPath, ['examples/shift-captions-after.mjs', captionsRoot, '60', '0.5'], { cwd: packageRoot });
  assert.match(shifted.stdout, /captions\.json/u);
  const savedCaptions = JSON.parse(await readFile(path.join(captionsRoot, 'captions.json'), 'utf8'));
  assert.deepEqual(savedCaptions.map(row => [row.start, row.end]), [[59.9, 60.2], [60.5, 61.5]]);

  const sped = await execFileAsync(process.execPath, ['examples/speed-up-group.mjs', speedRoot, 'g1'], { cwd: packageRoot });
  assert.match(sped.stdout, /edit\.json/u);
  const savedEdit = JSON.parse(await readFile(path.join(speedRoot, 'edit.json'), 'utf8'));
  const group = savedEdit.tracks[0].items[0];
  assert.equal(group.duration, 50);
  assert.deepEqual(group.items.map(item => [item.at, item.duration]), [[10, 10], [25, 11]]);
});

test('tree-summary example は入れ子を親子順と深さ別インデントで出力する', async t => {
  const fixture = await readFile(path.resolve(packageRoot, '../schemas/test/fixtures/object-tree-b-nested.json'), 'utf8');
  const root = await makeProject(fixture);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const result = await execFileAsync(process.execPath, ['examples/tree-summary.mjs', root], { cwd: packageRoot });
  const lines = result.stdout.trimEnd().split('\n');
  assert.equal(lines.length, 3);
  assert.deepEqual(lines, [
    'root  group  at=10  duration=100  children=1  keyframes=0  exclude=0',
    '  middle  group  at=5  duration=80  children=1  keyframes=0  exclude=0',
    '    leaf  telop  at=7  duration=20  children=0  keyframes=0  exclude=0',
  ]);
});

test('generated type keys は再生成 diff 0 で edit-v2 公開 interface を包摂する', async () => {
  const generatedPath = path.join(packageRoot, 'src/generated/edit-v2-keys.ts');
  const before = await readFile(generatedPath, 'utf8');
  await execFileAsync(process.execPath, ['scripts/gen-types.mjs'], { cwd: packageRoot });
  assert.equal(await readFile(generatedPath, 'utf8'), before);

  const source = await readFile(path.join(packageRoot, 'src/edit-v2.ts'), 'utf8');
  const properties = name => {
    const match = source.match(new RegExp(`export interface ${name}\\s*\\{([\\s\\S]*?)\\n?\\}`, 'u'));
    assert.ok(match, name);
    return [...match[1].matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\??:/gmu)].map(entry => entry[1]);
  };
  for (const name of ['ItemV2Base', 'AudioMediaItemV2']) {
    for (const key of properties(name)) assert.ok(ITEM_V2_KEYS.includes(key), `${name}.${key}`);
  }
  for (const name of [
    'MediaSourceV2', 'AudioMediaSourceV2', 'HtmlSourceV2', 'TelopSourceV2',
    'FilterSourceV2', 'GroupSourceV2', 'CaptionsSourceV2', 'CaptionSourceV2',
  ]) {
    for (const key of properties(name)) assert.ok(ITEM_SOURCE_V2_KEYS.includes(key), `${name}.${key}`);
  }
  for (const key of properties('KeyframeV2')) assert.ok(KEYFRAME_V2_KEYS.includes(key), `KeyframeV2.${key}`);
});

test('captions は配列形と object 形を編集後も保つ', async t => {
  const rows = [{ id: 'c-0001', start: 0, end: 1, text: 'before', speaker: null, sourceRef: null, edited: false }];
  for (const [name, captions] of [['array', rows], ['object', { captions: rows }]]) {
    await t.test(name, async t => {
      const root = await makeProject(serializeEdit(editWith([track('v1', [filterItem('base', 0, 30)])])), serializeCaptions(captions));
      t.after(() => fs.rmSync(root, { recursive: true, force: true }));
      const p = await openProject(root);
      p.captions.rows[0].text = 'after';
      await p.save();
      const saved = JSON.parse(await readFile(path.join(root, 'captions.json'), 'utf8'));
      assert.equal(Array.isArray(saved), name === 'array');
      assert.equal((Array.isArray(saved) ? saved : saved.captions)[0].text, 'after');
    });
  }
});
