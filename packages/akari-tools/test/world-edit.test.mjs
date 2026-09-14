import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { formatCoordinateNumber, moveWorldStop, replaceStopCoordinate, withinWorldBounds } from "../src/world/edit.mjs";

const map = () => ({
  schemaVersion: 3, kind: "flat",
  worlds: [{ id: "paper", label: "Paper", flat: { bounds: [0, 0, 100, 80], pattern: "grid" } }],
  zones: [{ id: "a", label: "A", world: "paper", c: [1, 2] }, { id: "b", label: "B", world: "paper", c: [70, 60] }],
  cameraStops: [{ id: "a", world: "paper", at: 0, leave: 1, c: [10, 20, 1] }, { id: "b", world: "paper", at: 2, leave: 3, c: [70, 60, 1.25] }],
  edges: [{ id: "a-b", from: "a", to: "b", type: "move", t0: 1, t1: 2, transition: { kind: "none", cover: 0 } }],
  retainedNodes: []
});

test('replaceStopCoordinate は cameraStops の数値だけを置換する', () => {
  const cases = [
    { c: [30, 40], expected: [30, 40, 1] },
    { c: [-1.25, -2.5], expected: [-1.25, -2.5, 1] },
    { c: [4, 5.125, 0.75], expected: [4, 5.125, 0.75] }
  ];
  for (const entry of cases) {
    const source = JSON.stringify(map(), null, 2) + '\n';
    const next = replaceStopCoordinate(source, 'a', entry.c);
    assert.deepEqual(JSON.parse(next).cameraStops[0].c, entry.expected);
    assert.equal(JSON.parse(next).zones[0].c.join(','), '1,2');
    const expected = source;
    let cursor = 0;
    for (const value of entry.c) {
      const old = String(map().cameraStops[0].c[cursor]);
      cursor += 1;
      assert.ok(next.includes(String(value)) || old === String(value));
    }
    assert.equal(JSON.parse(next).edges[0].id, JSON.parse(expected).edges[0].id);
  }
});

test('1 行形式では c のある 1 行だけが変わる', () => {
  const source = JSON.stringify(map(), null, 2).replace(/"c": \[\n\s+10,\n\s+20,\n\s+1\n\s+\]/u, '"c": [10, 20, 1]') + '\n';
  const next = replaceStopCoordinate(source, 'a', [11, 22]);
  const beforeLines = source.split('\n'), afterLines = next.split('\n');
  assert.deepEqual(beforeLines.map((line, index) => line === afterLines[index]), beforeLines.map(line => !line.includes('"c": [10, 20, 1]')));
});

test('複数行形式では対象リテラル以外の全バイトが一致する', () => {
  const source = JSON.stringify(map(), null, 2) + '\n';
  const next = replaceStopCoordinate(source, 'a', [12.5, 21]);
  const restored = next.replace('12.5', '10').replace(/(\n\s*)21(,\n\s*1\n)/u, '$120$2');
  assert.equal(restored, source);
});

test('存在しない stop・c 欠落・非有限数は throw する', () => {
  const source = JSON.stringify(map(), null, 2);
  assert.throws(() => replaceStopCoordinate(source, 'missing', [1, 2]), /cameraStops/);
  const withoutC = source.replace(/,\n\s+"c": \[\n\s+10,\n\s+20,\n\s+1\n\s+\]/u, '');
  assert.throws(() => replaceStopCoordinate(withoutC, 'a', [1, 2]), /c がありません/);
  assert.throws(() => replaceStopCoordinate(source, 'a', [Infinity, 2]), TypeError);
});

test('2 要素更新は scale のリテラルを保つ', () => {
  const source = JSON.stringify(map()).replace('[10,20,1]', '[10,20,1.2500]');
  const next = replaceStopCoordinate(source, 'a', [12, 13]);
  assert.match(next, /\[12,13,1\.2500\]/);
});

test('formatCoordinateNumber は指数表記を作らない', () => {
  for (const [value, expected] of [[2, '2'], [1.25, '1.25'], [1e-7, '0.0000001'], [-2.5e6, '-2500000']]) assert.equal(formatCoordinateNumber(value), expected);
  assert.throws(() => formatCoordinateNumber(NaN), TypeError);
});

test('withinWorldBounds は境界を含み外側を拒否する', () => {
  const world = map().worlds[0];
  for (const [point, expected] of [[[0, 0], true], [[100, 80], true], [[50, 40], true], [[-0.001, 0], false], [[100.001, 20], false]]) assert.equal(withinWorldBounds(world, point), expected);
});

test('moveWorldStop は全検査通過時だけ書き込む', async t => {
  async function fixture(value = map()) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'akari-world-edit-'));
    await mkdir(path.join(root, 'planning'));
    const text = JSON.stringify(value, null, 2) + '\n';
    await writeFile(path.join(root, 'planning/world-map.json'), text);
    return { root, text };
  }
  await t.test('成功', async () => {
    const { root } = await fixture();
    const result = await moveWorldStop(root, { stopId: 'a', c: [12.3456, 23.4567, 1.23456] });
    assert.deepEqual(result, { ok: true, file: path.join(root, 'planning/world-map.json'), stopId: 'a', before: [10, 20, 1], after: [12.346, 23.457, 1.2346], changed: true, notes: [] });
  });
  await t.test('元からある C7 違反は注記付きで通し座標だけを変える', async () => {
    const value = JSON.parse(await readFile(new URL('../../schemas/examples/world-map-v3-flat-valid/planning/world-map.json', import.meta.url), 'utf8'));
    value.edges.find((edge) => edge.type === 'cut').transition.cover = 0.9;
    const { root, text } = await fixture(value);
    const result = await moveWorldStop(root, { stopId: 'atelier-desk', c: [11, 13, 1.2] });
    assert.equal(result.ok, true);
    assert.deepEqual(result.notes, ['cover が未測定です。`akari world preview --measure` を先に']);
    const after = JSON.parse(await readFile(path.join(root, 'planning/world-map.json'), 'utf8'));
    const before = JSON.parse(text);
    before.cameraStops.find((stop) => stop.id === 'atelier-desk').c = [11, 13, 1.2];
    assert.deepEqual(after, before);
  });
  await t.test('書き戻しで新たに生じた C7 は案内付きで拒む', async () => {
    const { root, text } = await fixture();
    const check = value => ({
      errors: value.cameraStops[0].c[0] === 10 ? [] : [{ code: 'C7', message: 'cut edge synthetic の cover が未測定です' }],
      warnings: [],
    });
    const result = await moveWorldStop(root, { stopId: 'a', c: [11, 21, 1], check });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'INVARIANT');
    assert.match(result.reason, /cover が未測定です。`akari world preview --measure` を先に$/);
    assert.deepEqual(result.errors, [{ code: 'C7', message: 'cut edge synthetic の cover が未測定です' }]);
    assert.equal(await readFile(path.join(root, 'planning/world-map.json'), 'utf8'), text);
  });
  for (const entry of [
    { name: 'bounds 外', mutate: value => value, options: { stopId: 'a', c: [101, 20, 1] }, code: 'BOUNDS' },
    { name: 'spatial', mutate: value => ({ ...value, kind: 'spatial' }), options: { stopId: 'a', c: [10, 20, 1] }, code: 'KIND' },
    { name: '存在しない stop', mutate: value => value, options: { stopId: 'none', c: [10, 20, 1] }, code: 'NO_STOP' },
    { name: '既存 C 違反', mutate: value => ({ ...value, zones: value.zones.slice(0, 1) }), options: { stopId: 'a', c: [11, 21, 1] }, code: 'INVARIANT' }
  ]) await t.test(entry.name, async () => {
    const value = entry.mutate(map());
    const { root, text } = await fixture(value);
    const result = await moveWorldStop(root, entry.options);
    assert.equal(result.ok, false); assert.equal(result.code, entry.code);
    if (entry.code === 'INVARIANT') assert.ok(result.errors.length > 0);
    assert.equal(await readFile(path.join(root, 'planning/world-map.json'), 'utf8'), text);
  });
});
