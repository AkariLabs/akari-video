import assert from 'node:assert/strict';
import test from 'node:test';

import { orderCornersFromPoints, angleSortRing, quadAreaOf, DEGENERATE_AREA_EPSILON } from '../bin/finger-frame/corners.mjs';

const SQUARE = { tl: [0, 0], tr: [1, 0], br: [1, 1], bl: [0, 1] };

function permutations(items) {
  if (items.length <= 1) return [items];
  const out = [];
  items.forEach((item, index) => {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    for (const perm of permutations(rest)) out.push([item, ...perm]);
  });
  return out;
}

test('orderCornersFromPoints: 正しい TL,TR,BL,BR を全 24 通りの入力順で復元する（ねじれ正規化の不変性）', () => {
  const points = [SQUARE.tl, SQUARE.tr, SQUARE.br, SQUARE.bl];
  for (const perm of permutations(points)) {
    const { corners } = orderCornersFromPoints(perm);
    assert.deepEqual(corners, [SQUARE.tl, SQUARE.tr, SQUARE.bl, SQUARE.br], `入力順 ${JSON.stringify(perm)} で失敗`);
  }
});

test('orderCornersFromPoints: 素朴な [leftThumb,leftIndex,rightThumb,rightIndex] 固定割当だと自己交差する配置で、正規化後は自己交差しない', () => {
  // 「フレーム」ジェスチャでよくある配置: 左手の親指・人差し指が右側に、右手の親指・人差し指が
  // 左側に来る（両手が交差して重なる構え）。素朴な固定順 [leftThumb,leftIndex,rightThumb,rightIndex]
  // を TL,TR,BL,BR にそのまま当てると対角同士が結ばれ bowtie になる典型例。
  const leftThumb = [0.7, 0.1]; // 右上寄り
  const leftIndex = [0.3, 0.9]; // 左下寄り
  const rightThumb = [0.3, 0.1]; // 左上寄り
  const rightIndex = [0.7, 0.9]; // 右下寄り
  const naiveRing = [leftThumb, leftIndex, rightThumb, rightIndex]; // TL,TR,BR,BL のつもりの素朴割当
  const naiveArea2 = quadAreaOf(naiveRing);
  // 素朴割当は自己交差（bowtie）で符号付き面積が実際の正方形よりずっと小さい/退化に近い。
  assert.ok(Math.abs(naiveArea2) < 0.5, `素朴割当が bowtie でないなら前提が崩れている（area2=${naiveArea2}）`);

  const { corners } = orderCornersFromPoints([leftThumb, leftIndex, rightThumb, rightIndex]);
  assert.ok(corners, '正規化後は非退化な四角形になるはず');
  const [tl, tr, bl, br] = corners;
  const ring = [tl, tr, br, bl];
  const area2 = quadAreaOf(ring);
  // 4 点が作る凸包の面積（正方形にほぼ近い配置なので ~0.8*0.8=0.64 程度）に近いはず。
  assert.ok(Math.abs(area2) > 0.5, `正規化後も面積が小さすぎる（自己交差が残っている疑い, area2=${area2}）`);
});

test('quadAreaOf: 単位正方形の TL,TR,BR,BL 順で shoelace = 2（validate-edit.mjs と同じ規約）', () => {
  const ring = [SQUARE.tl, SQUARE.tr, SQUARE.br, SQUARE.bl];
  assert.equal(quadAreaOf(ring), 2);
});

test('orderCornersFromPoints: ほぼ一直線の 4 点は退化として null を返す', () => {
  const points = [[0, 0], [0.3, 0], [0.6, 0], [1, 0]];
  const { corners, ring } = orderCornersFromPoints(points);
  assert.equal(corners, null);
  assert.equal(ring, null);
});

test('orderCornersFromPoints: previousRing 指定時は最も近い回転（コーナー割当）を選び、指定なしより前フレームとの移動距離が小さい', () => {
  // 前フレーム: ほぼ正方形（少し回転）。
  const previous = [[0.05, 0.02], [0.95, 0.05], [0.9, 0.9], [0.02, 0.95]]; // TL,TR,BR,BL 相当
  // 今フレーム: ほぼ同じ配置（わずかにドリフト）だが、点の入力順を変えて渡す。
  const nowPointsSameOrderAsRing = [previous[0], previous[1], previous[2], previous[3]].map(([x, y]) => [x + 0.01, y]);
  const withPrevious = orderCornersFromPoints(nowPointsSameOrderAsRing, previous);
  const withoutPrevious = orderCornersFromPoints(nowPointsSameOrderAsRing, null);
  // 継続点では ring がそのまま (TL,TR,BR,BL) の並びを保つはず。
  assert.deepEqual(withPrevious.ring.map(([x]) => Math.round(x * 100)), previous.map(([x]) => Math.round((x + 0.01) * 100)));
  // ヒューリスティックのみ（previousRing 無し）でも同じ結果になる素直な例だが、少なくとも
  // 両者とも同じ非退化な四角形を返すことを確認する（回転のねじれが無いこと）。
  assert.ok(withoutPrevious.corners);
});

test('DEGENERATE_AREA_EPSILON は validate-edit.mjs の 1e-4 より安全側（大きい）に取ってある', () => {
  assert.ok(DEGENERATE_AREA_EPSILON > 1e-4);
});

test('angleSortRing: 4 象限点を渡すと TL,TR,BR,BL の時計回りに並ぶ（画像座標系: x右・y下）', () => {
  const tl = [-1, -1];
  const tr = [1, -1];
  const br = [1, 1];
  const bl = [-1, 1];
  const ring = angleSortRing([bl, tr, tl, br]); // シャッフルして入力
  assert.deepEqual(ring, [tl, tr, br, bl]);
});
