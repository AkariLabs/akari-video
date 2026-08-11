// vision-tracks-helper.swift の座標変換（y 反転・正規化）を固定する仕様テスト。
//
// 契約 docs/contract-2026-08-11-analysis-vision-tracks-v0.md §2「座標系（最重要規約）」は
// 「すべて 0〜1 正規化・左上原点」「Vision framework は左下原点で返すため、y 反転は
// サイドカーの責務」と定める。実際の変換は vision-tracks-helper.swift（Vision framework
// を呼ぶため Swift 側にしか実装できない）が行うが、このリポジトリの検証基盤は
// node --test であり Swift 側に単体テストの仕組みが無い（person-matte-helper.swift も
// 同様に Swift 側は無テスト）。そこでこのテストは、helper.swift の
// flipY / flippedBox / absoluteLandmarkPoint（コメントに実装箇所を明記）と**同じ数式**を
// ここに写し、変換の意味（bottom-left origin → top-left origin、box 相対 → 画像全体基準）
// を仕様として固定する。helper.swift を変更するときは、この数式もあわせて見直すこと。
//
// 実 Vision 出力に対する妥当性（瞳・指先が実画像の見た目と一致するか）は
// 非公開の内部記録の実測で検証済み。このテストは
// 「数式そのもの」の回帰トラップである。

import assert from "node:assert/strict";
import test from "node:test";

// --- vision-tracks-helper.swift flipY() のミラー ---
// 正規化 0〜1・左下原点の y を左上原点へ反転する。x は不変。
function flipY(y) {
  return 1 - y;
}

// --- vision-tracks-helper.swift flippedBox() のミラー ---
// Vision の顔矩形 [x, y, w, h]（左下原点）を契約の左上原点へ反転する。
// x / w / h は不変。y は「1 - y - h」（箱の下端基準の y を、上端基準の y へ変換）。
function flippedBox([x, y, w, h]) {
  return [x, 1 - y - h, w, h];
}

// --- vision-tracks-helper.swift absoluteLandmarkPoint() のミラー ---
// VNFaceLandmarkRegion2D の点は「顔矩形基準の 0〜1」（Vision 座標系）で返る。
// 顔矩形（Vision 座標系、左下原点）でアフィン変換して画像全体基準の 0〜1 に直してから、
// 契約の左上原点へ y 反転する。
function absoluteLandmarkPoint([localX, localY], visionBox) {
  const [bx, by, bw, bh] = visionBox;
  const absoluteX = bx + localX * bw;
  const absoluteY = by + localY * bh;
  return [absoluteX, flipY(absoluteY)];
}

// --- vision-tracks-helper.swift clampUnit() のミラー ---
// Vision は画面外へはみ出た遮蔽点を外挿することがある（実測: report.md に
// y = 1.0015... の実例あり）。0〜1 へ丸める。
function clampUnit(value) {
  return Math.min(Math.max(value, 0), 1);
}

test("flipY: 画像の上端（Vision y=1）は左上原点で y=0 になる", () => {
  assert.equal(flipY(1), 0);
});

test("flipY: 画像の下端（Vision y=0）は左上原点で y=1 になる", () => {
  assert.equal(flipY(0), 1);
});

test("flipY: 画像中央（y=0.5）は反転しても中央のまま", () => {
  assert.equal(flipY(0.5), 0.5);
});

test("flippedBox: x/w/h は不変、y だけ 1 - y - h に置き換わる", () => {
  // Vision 座標系で原点 (0.2, 0.3)・幅高 (0.1, 0.1) の箱。
  // 箱の Vision 側「下端」y=0.3 は上端基準では 1 - 0.3 - 0.1 = 0.6。
  assert.deepEqual(flippedBox([0.2, 0.3, 0.1, 0.1]), [0.2, 0.6, 0.1, 0.1]);
});

test("flippedBox: 画像全体を覆う箱（y=0, h=1）は反転しても不変", () => {
  assert.deepEqual(flippedBox([0, 0, 1, 1]), [0, 0, 1, 1]);
});

test("absoluteLandmarkPoint: 顔矩形の中心点は、反転後の箱の中心と一致する", () => {
  const visionBox = [0.2, 0.3, 0.1, 0.1];
  const center = absoluteLandmarkPoint([0.5, 0.5], visionBox);

  const [fx, fy, fw, fh] = flippedBox(visionBox);
  const expectedCenter = [fx + fw / 2, fy + fh / 2];

  assert.ok(Math.abs(center[0] - expectedCenter[0]) < 1e-12);
  assert.ok(Math.abs(center[1] - expectedCenter[1]) < 1e-12);
});

test("absoluteLandmarkPoint: 顔矩形の Vision 側左下隅（局所 0,0）は反転後の箱の左下隅になる", () => {
  const visionBox = [0.2, 0.3, 0.1, 0.4];
  // Vision 座標系での箱の左下隅 = 局所点 (0, 0)。
  const point = absoluteLandmarkPoint([0, 0], visionBox);
  // 反転後の箱は y=[1-0.3-0.4, 1-0.3] = [0.3, 0.7]（上端 0.3・下端 0.7）。
  // Vision の「下端」は反転後の「下端」（大きい方の y = 0.7）に対応する。
  assert.ok(Math.abs(point[0] - 0.2) < 1e-12);
  assert.ok(Math.abs(point[1] - 0.7) < 1e-12);
});

test("clampUnit: 範囲内の値は変えない", () => {
  assert.equal(clampUnit(0.5), 0.5);
  assert.equal(clampUnit(0), 0);
  assert.equal(clampUnit(1), 1);
});

test("clampUnit: 実測（report.md）で観測した 1 をわずかに超える値を 1 へ丸める", () => {
  assert.equal(clampUnit(1.0015984773635864), 1);
});

test("clampUnit: 負にわずかにはみ出た値を 0 へ丸める", () => {
  assert.equal(clampUnit(-0.0016), 0);
});
