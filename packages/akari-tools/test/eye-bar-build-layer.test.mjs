import assert from "node:assert/strict";
import test from "node:test";

import { buildEyeBarGroups } from "../src/eye-bar/build-layer.mjs";

// 200x200 の正方形キャンバス・正方形ソース（letterbox なし）で幾何を単純化したテスト用トラック。
// 瞳は水平（angle=0 のまま）・中心が x 方向へ線形に動く。t=1.0 だけ検出ゼロにして
// ホールド埋めの経路も一緒に踏む。
function makeTrack({ withGap = false } = {}) {
  const samples = [];
  for (let i = 0; i <= 4; i += 1) {
    const t = i * 0.5;
    if (withGap && i === 2) {
      samples.push({ t, detections: [] });
      continue;
    }
    const centerU = 0.3 + i * 0.05; // 0.3 → 0.5 まで正規化座標で右へ移動
    samples.push({
      t,
      detections: [
        {
          box: [centerU - 0.05, 0.45, 0.1, 0.1],
          conf: 0.99,
          landmarks: {
            left_pupil: [centerU - 0.05, 0.5],
            right_pupil: [centerU + 0.05, 0.5],
            left_eye: [[centerU - 0.05, 0.5]],
            right_eye: [[centerU + 0.05, 0.5]],
            outer_lips: [[centerU, 0.7]],
            inner_lips: [[centerU, 0.7]],
          },
        },
      ],
    });
  }
  return { version: 0, kind: "face-landmarks", source: { path: "../clip.mp4", duration: 2 }, sample_fps: 2, provider: { name: "apple-vision" }, samples };
}

const baseOptions = {
  cuts: [{ in: 0, out: 2 }],
  canvasWidth: 200,
  canvasHeight: 200,
  sourceDisplayWidth: 200,
  sourceDisplayHeight: 200,
  smoothing: { method: "none" },
  decimate: { mode: "interval", intervalSeconds: 0.01 },
  marginMultiplier: 1.5,
  nativeBarWidthPx: 100,
};

test("buildEyeBarGroups: 単純カット 1 本 → レイヤー 1 枚・t は 0 始まり", () => {
  const result = buildEyeBarGroups({ ...baseOptions, track: makeTrack() });
  assert.equal(result.ok, true);
  assert.equal(result.layers.length, 1);
  const layer = result.layers[0];
  assert.equal(layer.t, 0);
  assert.ok(layer.duration >= 2 - 1e-6);
  assert.equal(layer.keyframes[0].t, 0);
  assert.ok(layer.keyframes.every((kf) => kf.t >= 0));
  // t 昇順・重複なし（layer-keyframes.mjs の usableLayerKeyframePoints 前提）
  for (let i = 1; i < layer.keyframes.length; i += 1) {
    assert.ok(layer.keyframes[i].t > layer.keyframes[i - 1].t);
  }
});

test("buildEyeBarGroups: 決定論（同一入力 → 同一出力）", () => {
  const track = makeTrack();
  const a = buildEyeBarGroups({ ...baseOptions, track });
  const b = buildEyeBarGroups({ ...baseOptions, track });
  assert.deepEqual(a, b);
});

test("buildEyeBarGroups: x は中心が右へ動くにつれ単調増加（動きに追従）", () => {
  const result = buildEyeBarGroups({ ...baseOptions, track: makeTrack() });
  const xs = result.layers[0].keyframes.map((kf) => kf.transform.x);
  for (let i = 1; i < xs.length; i += 1) assert.ok(xs[i] >= xs[i - 1] - 1e-6);
});

test("buildEyeBarGroups: 欠測フレームはホールドされ、破綻しない", () => {
  const result = buildEyeBarGroups({ ...baseOptions, track: makeTrack({ withGap: true }) });
  assert.equal(result.ok, true);
  assert.equal(result.detectedFrameCount, 4);
  assert.equal(result.totalFrameCount, 5);
  // t=1.0（欠測フレーム）付近の x は、直前(t=0.5)の値でホールドされているはず（method:none のため
  // 補間ではなく完全一致になる — sampleAt は smoothed 系列の線形補間だが、欠測区間はホールド後
  // 値が一定なので前後で同じ値になる）。
  const layer = result.layers[0];
  const near1 = layer.keyframes.find((kf) => Math.abs(kf.t - 1.0) < 0.05);
  const at05 = layer.keyframes.find((kf) => Math.abs(kf.t - 0.5) < 1e-6);
  assert.ok(near1 && at05);
  assert.ok(Math.abs(near1.transform.x - at05.transform.x) < 1e-6);
});

test("buildEyeBarGroups: 瞳の取り違えのような一瞬の外れ値は棄却されホールドで埋まる（実測ノイズ再現）", () => {
  // 実デモ素材（report.md 参照）で観測した実際の壊れ方を再現: 数フレームだけ左右の瞳が入れ替わり
  // 角度が急変し、また元に戻る。conf は変わらず 1（Vision 自身は異常を報告しない）。
  const samples = [];
  const good = (t, centerU) => ({
    t,
    detections: [{
      box: [centerU - 0.05, 0.45, 0.1, 0.1],
      conf: 1,
      landmarks: {
        left_pupil: [centerU - 0.05, 0.5],
        right_pupil: [centerU + 0.05, 0.5],
        left_eye: [[centerU - 0.05, 0.5]],
        right_eye: [[centerU + 0.05, 0.5]],
        outer_lips: [[centerU, 0.7]],
        inner_lips: [[centerU, 0.7]],
      },
    }],
  });
  const swapped = (t, centerU) => ({
    t,
    detections: [{
      box: [centerU - 0.05, 0.45, 0.1, 0.1],
      conf: 1,
      landmarks: {
        // 左右逆転 + y も大きくずれる（実測ログと同じ壊れ方）
        left_pupil: [centerU + 0.05, 0.65],
        right_pupil: [centerU - 0.05, 0.64],
        left_eye: [[centerU + 0.05, 0.65]],
        right_eye: [[centerU - 0.05, 0.64]],
        outer_lips: [[centerU, 0.7]],
        inner_lips: [[centerU, 0.7]],
      },
    }],
  });
  for (let i = 0; i <= 8; i += 1) {
    const t = i * 0.0417;
    samples.push(i === 4 || i === 5 ? swapped(t, 0.5) : good(t, 0.5));
  }
  const track = { version: 0, kind: "face-landmarks", source: { path: "../clip.mp4", duration: 1 }, sample_fps: 24, provider: { name: "apple-vision" }, samples };
  const result = buildEyeBarGroups({ ...baseOptions, cuts: [{ in: 0, out: 0.4 }], track, smoothing: { method: "none" }, decimate: { mode: "interval", intervalSeconds: 0.001 } });
  assert.equal(result.ok, true);
  assert.equal(result.rejectedOutlierCount, 2, "取り違えた 2 フレームが棄却されるはず");
  // 棄却された 2 点は直前の正常値でホールドされるので、角度は正常範囲内に収まる（-90°等の
  // 破綻した値にならない）。
  const angles = result.layers[0].keyframes.map((kf) => kf.transform.rotate);
  for (const angle of angles) assert.ok(Math.abs(angle) < 20, `異常な角度が残っている: ${angle}`);
});

test("buildEyeBarGroups: onGap=shrink は長い欠測区間で scale を gapShrinkScale までランプする", () => {
  // t=0..3 まで検出あり、t=3.5..6 まで検出ゼロ（3.5秒 — gapShrinkAfterSeconds を超える）、
  // t=6.5 から検出再開。
  const samples = [];
  for (let i = 0; i <= 12; i += 1) {
    const t = i * 0.5;
    const detected = t <= 3 || t >= 6.5;
    samples.push({
      t,
      detections: detected ? [{
        box: [0.4, 0.4, 0.1, 0.1], conf: 1,
        landmarks: {
          left_pupil: [0.45, 0.5], right_pupil: [0.55, 0.5],
          left_eye: [[0.45, 0.5]], right_eye: [[0.55, 0.5]],
          outer_lips: [[0.5, 0.7]], inner_lips: [[0.5, 0.7]],
        },
      }] : [],
    });
  }
  const track = { version: 0, kind: "face-landmarks", source: { path: "../clip.mp4", duration: 6.5 }, sample_fps: 2, provider: { name: "apple-vision" }, samples };
  const result = buildEyeBarGroups({
    ...baseOptions,
    cuts: [{ in: 0, out: 6.5 }],
    track,
    onGap: "shrink",
    gapShrinkAfterSeconds: 1,
    gapShrinkRampSeconds: 0.3,
    gapShrinkScale: 0.001,
    decimate: { mode: "interval", intervalSeconds: 0.01 },
  });
  assert.equal(result.ok, true);
  const scales = result.layers[0].keyframes.map((kf) => kf.transform.scale);
  const minScale = Math.min(...scales);
  assert.ok(Math.abs(minScale - 0.001) < 1e-6, `最小 scale が gapShrinkScale まで下がっていない: ${minScale}`);
  // 検出が続いている間（先頭・末尾付近）は縮小していないはず
  assert.ok(scales[0] > 0.01);
  assert.ok(scales[scales.length - 1] > 0.01);
});

test("buildEyeBarGroups: 対象 source を参照するカットが無ければ ok:false", () => {
  const result = buildEyeBarGroups({ ...baseOptions, cuts: [{ src: "other", in: 0, out: 2 }], track: makeTrack(), sourceId: "main" });
  assert.equal(result.ok, false);
});

test("buildEyeBarGroups: 同一 source の隣接カット（ジャンプカット）は 1 レイヤーだが境界でスライドしない", () => {
  // track: t=0..2 で中心が単調に右へ動く。cuts で [0,0.5] と [1.5,2] をつなぐ
  // （0.5〜1.5 秒分の動きを飛ばすジャンプカット）。飛ばした分だけ本来は瞬時にジャンプするはずで、
  // 前後の値の間を素通しで補間してはいけない。
  const cuts = [{ in: 0, out: 0.5 }, { in: 1.5, out: 2 }];
  const result = buildEyeBarGroups({ ...baseOptions, cuts, track: makeTrack() });
  assert.equal(result.ok, true);
  assert.equal(result.layers.length, 1, "隣接カットは 1 レイヤーへまとめる");
  const kfs = result.layers[0].keyframes;
  // カットの継ぎ目（timeline t=0.5）の直前・直後で x の値が「飛んで」いる（連続的にスライドして
  // いない）ことを確認する: 継ぎ目直前の点は前カット側の最終値（SNAP_EPSILON だけ手前に
  // ずらされている）、直後の点（ちょうど t=0.5）は次カット側の初期値。
  const seamIndex = kfs.findIndex((kf) => Math.abs(kf.t - 0.5) < 1e-6);
  assert.ok(seamIndex >= 1, "継ぎ目ちょうど（t=0.5）の点と、その手前の点が見つかること");
  const afterSeam = kfs[seamIndex];
  const beforeSeam = kfs[seamIndex - 1];
  assert.ok(beforeSeam.t < 0.5 - 0.001, `手前の点は SNAP_EPSILON だけ前倒しされているはず: ${beforeSeam.t}`);
  // track の x は 0.3+i*0.05（i=0..4, t=0,0.5,1,1.5,2）なので、継ぎ目直前は t=0.5(i=1) の値、
  // 直後は t=1.5(i=3) の値 — 継ぎ目を挟んで 2 段跳んでいる（間の i=2 を経由する滑らかな
  // 補間にはなっていない）ことを x の差で確認する。
  assert.ok(Math.abs(afterSeam.transform.x - beforeSeam.transform.x) > 5, `beforeSeam=${beforeSeam.transform.x} afterSeam=${afterSeam.transform.x}`);
});

test("buildEyeBarGroups: 別カットアウェイを挟むと 2 レイヤーに分かれる（黒帯が浮かない）", () => {
  // track の source 範囲は [0,2]。cuts で [0,1] と [1.5,2](gap-aware) に分割 → 別レイヤー。
  const cuts = [{ in: 0, out: 1 }, { at: 3, in: 1.5, out: 2 }]; // track1 側の別カットアウェイは省略、
  // at=3 かつ track 省略（=0）なので gap-aware 経路になる条件を満たすため in/out だけでなく
  // 明示的に track も揃えて gap-aware を発火させる。
  const gapCuts = [{ in: 0, out: 1, track: 0 }, { at: 3, in: 1.5, out: 2, track: 0 }];
  const result = buildEyeBarGroups({ ...baseOptions, cuts: gapCuts, track: makeTrack() });
  assert.equal(result.ok, true);
  assert.equal(result.layers.length, 2);
  assert.equal(result.layers[0].t, 0);
  assert.equal(result.layers[1].t, 3);
});
