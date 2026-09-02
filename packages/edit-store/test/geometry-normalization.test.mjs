import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { register } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  applyMigration,
  collectFitBasisCandidates,
  hasCutLayerStyleVisual,
  normalizeGeometry,
  planGeometryNormalization,
  revertMigration,
} from '../lib/migrate/index.js';
import { serializeEdit } from '../lib/canonical.js';
import { projectLegacyEdit, readInternalEdit } from '../lib/internal-model.js';

const testDirectory = dirname(fileURLToPath(import.meta.url));

function editWith({ output = {}, items, sources, tracks } = {}) {
  return {
    version: 2,
    output: { width: 1920, height: 1080, fps: 30, ...output },
    sources: sources ?? [{ id: 'main', path: 'main.mp4', proxy: null }],
    tracks: tracks ?? [{ id: 'v1', lane: 'visual', items }],
  };
}

function cut(id, extra = {}) {
  return {
    id,
    at: 0,
    duration: 90,
    source: { kind: 'media', src: 'main', in: 0, out: 3 },
    ...extra,
  };
}

/** 素材 id → 寸法（表示回転後）。 */
function dimensions(table) {
  return sourceId => table[sourceId];
}

test('4K 素材の cut は scale 1 → 0.5 になり、マーカーが立つ', () => {
  const result = normalizeGeometry(
    editWith({ items: [cut('cut-1', { transform: { x: 320, y: 160, scale: 1, rotate: 15 } })] }),
    dimensions({ main: { width: 3840, height: 2160 } }),
  );
  assert.ok(!('blockers' in result), JSON.stringify(result));
  assert.deepEqual(result.changes, [
    { itemId: 'cut-1', sourceId: 'main', fit: 0.5, before: 1, after: 0.5 },
  ]);
  const item = result.edit.tracks[0].items[0];
  // x / y / rotate は両基準で同じ意味なので触らない。
  assert.deepEqual(item.transform, { x: 320, y: 160, scale: 0.5, rotate: 15 });
  assert.equal(result.edit.output.geometry, 'source');
});

test('transform 宣言が無い cut も既定 scale 1 から焼き込む', () => {
  const result = normalizeGeometry(
    editWith({ items: [cut('cut-1')] }),
    dimensions({ main: { width: 3840, height: 2160 } }),
  );
  assert.deepEqual(result.changes, [
    { itemId: 'cut-1', sourceId: 'main', fit: 0.5, before: 1, after: 0.5 },
  ]);
  assert.deepEqual(result.edit.tracks[0].items[0].transform, { scale: 0.5 });
});

test('1080p 素材（fit 1）は値を変えずキーも足さず、マーカーだけ立つ', () => {
  const result = normalizeGeometry(
    editWith({ items: [cut('cut-1'), cut('cut-2', { at: 90, transform: { x: 10 } })] }),
    dimensions({ main: { width: 1920, height: 1080 } }),
  );
  assert.deepEqual(result.changes, []);
  assert.equal('transform' in result.edit.tracks[0].items[0], false);
  assert.deepEqual(result.edit.tracks[0].items[1].transform, { x: 10 });
  assert.equal(result.edit.output.geometry, 'source');
});

test('縦出力 × 横素材は fit 0.5625', () => {
  const result = normalizeGeometry(
    editWith({
      output: { width: 1080, height: 1920 },
      items: [cut('cut-1', { transform: { scale: 2 } })],
    }),
    dimensions({ main: { width: 1920, height: 1080 } }),
  );
  assert.deepEqual(result.changes, [
    { itemId: 'cut-1', sourceId: 'main', fit: 0.5625, before: 2, after: 1.125 },
  ]);
  assert.equal(result.edit.tracks[0].items[0].transform.scale, 1.125);
});

test('回転 90° の素材は表示回転後の寸法で fit を決める', () => {
  // 格納 3840×2160 / rotation 90 の素材は表示 2160×3840。dimensionsOf は表示回転後を返す契約。
  const stored = normalizeGeometry(
    editWith({ output: { width: 1080, height: 1920 }, items: [cut('cut-1')] }),
    dimensions({ main: { width: 3840, height: 2160 } }),
  );
  const displayed = normalizeGeometry(
    editWith({ output: { width: 1080, height: 1920 }, items: [cut('cut-1')] }),
    dimensions({ main: { width: 2160, height: 3840 } }),
  );
  assert.equal(stored.changes[0].fit, 0.28125);
  assert.equal(displayed.changes[0].fit, 0.5);
  assert.equal(displayed.edit.tracks[0].items[0].transform.scale, 0.5);
});

test('crop / perspective / 2 点以上の keyframes を持つ cut は既に実寸基準なので無変更', () => {
  const result = normalizeGeometry(
    editWith({
      items: [
        cut('crop-cut', { crop: { x: 0, y: 0, w: 0.5, h: 0.5 }, transform: { scale: 1 } }),
        cut('perspective-cut', {
          at: 90,
          perspective: { tl: [0, 0], tr: [1, 0], br: [1, 1], bl: [0, 1] },
          transform: { scale: 1 },
        }),
        cut('keyframed-cut', {
          at: 180,
          transform: { scale: 1 },
          keyframes: [{ t: 0, transform: { scale: 1 } }, { t: 30, transform: { scale: 2 } }],
        }),
        cut('plain-cut', { at: 270, transform: { scale: 1 } }),
      ],
    }),
    dimensions({ main: { width: 3840, height: 2160 } }),
  );
  assert.deepEqual(result.changes.map(change => change.itemId), ['plain-cut']);
  const byId = Object.fromEntries(result.edit.tracks[0].items.map(item => [item.id, item]));
  assert.equal(byId['crop-cut'].transform.scale, 1);
  assert.equal(byId['perspective-cut'].transform.scale, 1);
  assert.equal(byId['keyframed-cut'].transform.scale, 1);
  assert.deepEqual(byId['keyframed-cut'].keyframes.map(point => point.transform.scale), [1, 2]);
  assert.equal(byId['plain-cut'].transform.scale, 0.5);
});

test('layers へ投影される item は無変更（同一トラックで重なる 2 本）', () => {
  const doc = editWith({
    items: [
      cut('overlap-a', { at: 0, duration: 90, transform: { scale: 1 } }),
      cut('overlap-b', { at: 30, duration: 90, transform: { scale: 1 } }),
    ],
  });
  const internal = readInternalEdit(doc);
  assert.deepEqual(projectLegacyEdit(internal).cuts, []);
  assert.deepEqual(collectFitBasisCandidates(internal), []);

  const result = normalizeGeometry(doc, dimensions({ main: { width: 3840, height: 2160 } }));
  assert.deepEqual(result.changes, []);
  for (const item of result.edit.tracks[0].items) assert.equal(item.transform.scale, 1);
  assert.equal(result.edit.output.geometry, 'source');
});

test('1 点だけの keyframe を持つ文書は v2 検証で止まる（1 点 keyframe の焼き込み規則は到達不能）', () => {
  // 契約は「keyframes が 1 点だけのときはその transform.scale にも同じ倍率」を求めており、
  // その分岐は normalizeGeometry に実装してある。ただし edit-v2 の v2 検証が keyframes[] に
  // 2 要素以上を要求する（packages/edit-store/src/edit-v2.ts）ため、有効な v2 文書で
  // 「usable keyframe が 1 点だけの fit 基準 cut」は構成できない。実際の入口の挙動を固定する。
  const result = normalizeGeometry(
    editWith({
      items: [cut('cut-1', {
        transform: { scale: 2 },
        keyframes: [{ t: 0, transform: { scale: 3, x: 10 }, opacity: 0.5 }],
      })],
    }),
    dimensions({ main: { width: 3840, height: 2160 } }),
  );
  assert.ok('blockers' in result);
  assert.match(result.blockers[0], /keyframes.*2 要素以上/u);
});

test('寸法が取れない素材があると blockers を返し、マーカーも立てない（部分適用禁止）', () => {
  const result = normalizeGeometry(
    editWith({
      sources: [
        { id: 'main', path: 'main.mp4', proxy: null },
        { id: 'pip', path: 'pip.mp4', proxy: null },
      ],
      tracks: [
        { id: 'v1', lane: 'visual', items: [cut('cut-1')] },
        {
          id: 'v2',
          lane: 'visual',
          items: [{
            id: 'cut-2', at: 200, duration: 90,
            source: { kind: 'media', src: 'pip', in: 0, out: 3 },
          }],
        },
      ],
    }),
    dimensions({ main: { width: 3840, height: 2160 } }),
  );
  assert.ok('blockers' in result);
  assert.deepEqual(result.blockers, ['素材 pip の寸法を取得できないため移行できません。']);
});

test('既に output.geometry: "source" なら noop', () => {
  const doc = editWith({
    output: { geometry: 'source' },
    items: [cut('cut-1', { transform: { scale: 0.5 } })],
  });
  const result = normalizeGeometry(doc, dimensions({ main: { width: 3840, height: 2160 } }));
  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.edit, doc);
});

test('未知の output.geometry は黙って上書きせず blockers で止まる', () => {
  const result = normalizeGeometry(
    editWith({ output: { geometry: 'fit' }, items: [cut('cut-1')] }),
    dimensions({ main: { width: 3840, height: 2160 } }),
  );
  assert.ok('blockers' in result);
  assert.match(result.blockers[0], /未知の output\.geometry/u);
});

test('version 2 以外は移行しない', () => {
  const result = normalizeGeometry({ version: 1, output: { width: 1920, height: 1080, fps: 30 } }, () => undefined);
  assert.ok('blockers' in result);
  assert.deepEqual(result.blockers, ['edit.json.version が 2 ではありません。']);
});

test('collectFitBasisCandidates は projectLegacyEdit の cuts 投影と同じ集合を数える', () => {
  const doc = editWith({
    items: [
      cut('plain', { at: 0, transform: { scale: 1 } }),
      cut('cropped', { at: 90, crop: { x: 0, y: 0, w: 0.5, h: 0.5 } }),
    ],
  });
  const internal = readInternalEdit(doc);
  const legacy = projectLegacyEdit(internal);
  assert.equal(legacy.cuts.length, 2);
  assert.deepEqual(collectFitBasisCandidates(internal), [{ itemId: 'plain', sourceId: 'main' }]);
});

test('hasCutLayerStyleVisual は frame-engine の同名関数と同じ判定を返す', async () => {
  register('./helpers/ts-source-loader.mjs', pathToFileURL(`${testDirectory}/`));
  const plan = await import(
    pathToFileURL(join(testDirectory, '../../frame-engine/src/timeline/plan.ts')).href
  );
  const table = [
    {},
    { crop: undefined, perspective: undefined, keyframes: undefined },
    { crop: { x: 0, y: 0, w: 1, h: 1 } },
    { crop: null },
    { crop: [] },
    { crop: 'nope' },
    { perspective: {} },
    { perspective: null },
    { keyframes: [] },
    { keyframes: [{ t: 0 }] },
    { keyframes: [{ t: 0 }, { t: 30 }] },
    { keyframes: [{ t: 0 }, { t: 0 }] },
    { keyframes: [{ t: 0 }, { t: -1 }] },
    { keyframes: [{ t: 0 }, { t: Number.NaN }] },
    { keyframes: [{ t: 0 }, null] },
    { keyframes: [null, null] },
    { keyframes: { path: 'motion/g1.json', count: 5 } },
    { crop: { x: 0, y: 0, w: 1, h: 1 }, keyframes: [{ t: 0 }] },
  ];
  for (const entry of table) {
    assert.equal(
      hasCutLayerStyleVisual(entry),
      plan.hasCutLayerStyleVisual(entry),
      `判定が frame-engine と食い違いました: ${JSON.stringify(entry)}`,
    );
  }
  // 表が両実装の分岐（crop / perspective / keyframes 2 点）を実際に踏んでいること。
  assert.equal(table.filter(entry => plan.hasCutLayerStyleVisual(entry)).length, 6);
});

test('planGeometryNormalization は backup 付きの提案を返し、apply / revert が対称に働く', async () => {
  const root = await mkdtemp(join(tmpdir(), 'akari-geometry-normalize-'));
  const editPath = join(root, 'edit.json');
  try {
    const doc = editWith({ items: [cut('cut-1', { transform: { scale: 1 } })] });
    const before = serializeEdit(doc);
    await writeFile(editPath, before);

    const proposal = planGeometryNormalization(root, editPath, before, {
      dimensionsOf: dimensions({ main: { width: 3840, height: 2160 } }),
      now: new Date('2026-09-02T00:00:00.000Z'),
    });
    assert.equal(proposal.ok, undefined);
    assert.equal(proposal.version, 2);
    assert.deepEqual(proposal.geometry, [
      { itemId: 'cut-1', sourceId: 'main', fit: 0.5, before: 1, after: 0.5 },
    ]);
    assert.deepEqual(proposal.changes.map(change => change.path), [
      'tracks[].items[id=cut-1].transform.scale',
      'output.geometry',
    ]);
    assert.equal(proposal.backupPath, join(root, '.akari', 'backup', 'edit-2026-09-02T00-00-00-000Z.json'));

    await applyMigration(proposal);
    const applied = await readFile(editPath, 'utf8');
    assert.equal(applied, proposal.nextText);
    assert.equal(JSON.parse(applied).output.geometry, 'source');
    assert.equal(JSON.parse(applied).tracks[0].items[0].transform.scale, 0.5);
    assert.equal(await readFile(proposal.backupPath, 'utf8'), before);

    const second = planGeometryNormalization(root, editPath, applied, {
      dimensionsOf: dimensions({ main: { width: 3840, height: 2160 } }),
      now: new Date('2026-09-02T01:00:00.000Z'),
    });
    assert.equal(second.noop, true);
    assert.deepEqual(second.geometry, []);

    await revertMigration(proposal);
    assert.equal(await readFile(editPath, 'utf8'), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
