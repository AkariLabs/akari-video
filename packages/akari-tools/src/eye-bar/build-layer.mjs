// build-layer.mjs — face_landmarks トラック + edit.json（cuts）から目線黒帯レイヤーの群を
// 決定論的に組み立てるオーケストレーション層。ファイル I/O は一切しない（純関数）。
// CLI（bin/eye-bar.mjs）が analysis.json / edit.json の読み込み・帯素材の ffmpeg 生成・
// edit.json への --apply 書き込みを担当する。
//
// 出力は「連続して画面に出ている区間ごとに 1 レイヤー」（source を実際に映しているタイムライン
// 上の連続区間 = group）。理由: layers[] は [t, t+duration) の間ずっと合成され続ける機構であり、
// 別カットアウェイ（他 source・他区間）に切り替わっている間も 1 本のレイヤーで押し通すと、
// 黒帯が無関係な映像の上に取り残されたまま浮いてしまう。区間ごとに別レイヤーへ分ければ、
// レイヤーの [t,t+duration) の外＝自動的に非表示になり、新しい render 機構を足さずに
// 「対象 source が映っている間だけ出す」を実現できる（契約 §0「新しいレンダー機構は作らない」）。
import { applyCutTransformToGeometry, barLayerTransform, eyeGeometryFromCanvasPoints } from "./geometry.mjs";
import { decimatePoints } from "./decimate.mjs";
import { applyCutTransformToPoint, containFitRect, cutHasUnsupportedFraming, mapNormalizedPointToCanvas } from "./space-map.mjs";
import { smoothSeries, unwrapDegrees } from "./smoothing.mjs";
import { runsInTimelineOrder, sourceCutRuns } from "./time-map.mjs";

const GROUP_GAP_EPSILON = 0.02; // 隣接カット判定の許容誤差（秒）。1 フレーム未満のずれは連続とみなす。
const T_EPSILON = 1e-6;

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function hasPupils(detection) {
  const landmarks = detection?.landmarks;
  const left = landmarks?.left_pupil;
  const right = landmarks?.right_pupil;
  return (
    Array.isArray(left) && left.length === 2 && Number.isFinite(left[0]) && Number.isFinite(left[1])
    && Array.isArray(right) && right.length === 2 && Number.isFinite(right[0]) && Number.isFinite(right[1])
  );
}

function shortestAngleDiffDeg(a, b) {
  let diff = (a - b) % 360;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return diff;
}

/**
 * 実測で確認されたノイズ（demo report.md 参照 — Vision が瞬き等で 3 フレーム連続、左右の瞳を
 * 取り違えて誤検出した実例。conf は 1.0 のまま、角度だけ物理的にあり得ない量で跳ねる）への
 * 対策。「直前に採用した角度から maxJumpDeg 度を超えて瞬時に跳んだ検出」を、瞳の取り違え等の
 * 誤検出とみなして無効化し、既存のホールド埋め機構（欠測フレームと同じ扱い）へ委ねる。
 * 新しい平滑化アルゴリズムを足すのではなく「生値主義（契約 §2）に反する明らかな誤検出を、
 * 変換器の責務として弾く」フィルタ — 弾かれた分は下流で欠測と同じくホールドされる。
 */
function rejectAngleOutliers(validFlags, angleByIndex, maxJumpDeg) {
  const out = validFlags.slice();
  let lastAcceptedAngle = null;
  for (let i = 0; i < out.length; i += 1) {
    if (!out[i]) continue;
    if (lastAcceptedAngle !== null) {
      const jump = Math.abs(shortestAngleDiffDeg(angleByIndex[i], lastAcceptedAngle));
      if (jump > maxJumpDeg) {
        out[i] = false;
        continue;
      }
    }
    lastAcceptedAngle = angleByIndex[i];
  }
  return out;
}

/** 検出が無いフレームを、直近の有効値でホールド埋めする（先頭側は最初の有効値で back-fill）。 */
function holdFillIndices(validFlags) {
  const filledFrom = new Array(validFlags.length).fill(-1);
  let lastValid = -1;
  for (let i = 0; i < validFlags.length; i += 1) {
    if (validFlags[i]) lastValid = i;
    filledFrom[i] = lastValid;
  }
  if (filledFrom[0] === -1) {
    let firstValid = validFlags.findIndex(Boolean);
    if (firstValid === -1) firstValid = -1;
    for (let i = 0; i < filledFrom.length && filledFrom[i] === -1; i += 1) filledFrom[i] = firstValid;
  }
  return filledFrom;
}

/** validFlags 上の「連続した無効区間」を、samples[].t を使った秒数つきで列挙する。 */
function collectGapStreaks(validFlags, times) {
  const streaks = [];
  let start = -1;
  for (let i = 0; i < validFlags.length; i += 1) {
    if (!validFlags[i] && start === -1) start = i;
    if (validFlags[i] && start !== -1) {
      streaks.push({ startIndex: start, endIndex: i - 1, startT: times[start], endT: times[i - 1] });
      start = -1;
    }
  }
  if (start !== -1) {
    streaks.push({ startIndex: start, endIndex: validFlags.length - 1, startT: times[start], endT: times[validFlags.length - 1] });
  }
  return streaks.map((s) => ({ ...s, durationSeconds: Math.max(0, s.endT - s.startT) }));
}

/** 昇順 times[] 上で任意の sourceT における 4 系列（線形補間・端はホールド）を返す。 */
function makeSampler(times, seriesMap) {
  return (sourceT) => {
    if (sourceT <= times[0]) {
      const out = {};
      for (const key of Object.keys(seriesMap)) out[key] = seriesMap[key][0];
      return out;
    }
    const last = times.length - 1;
    if (sourceT >= times[last]) {
      const out = {};
      for (const key of Object.keys(seriesMap)) out[key] = seriesMap[key][last];
      return out;
    }
    let lo = 0;
    let hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (times[mid] <= sourceT) lo = mid;
      else hi = mid;
    }
    const span = times[hi] - times[lo];
    const u = span > 0 ? (sourceT - times[lo]) / span : 0;
    const out = {};
    for (const key of Object.keys(seriesMap)) {
      const series = seriesMap[key];
      out[key] = series[lo] + (series[hi] - series[lo]) * u;
    }
    return out;
  };
}

/**
 * @param {object} options
 * @param {object} options.track vision-tracks v0 の face-landmarks トラック（kind必須）
 * @param {Array} options.cuts edit.json の cuts[]
 * @param {number} options.canvasWidth edit.output.width
 * @param {number} options.canvasHeight edit.output.height
 * @param {number} options.sourceDisplayWidth ソース動画の表示上の幅（回転補正後）
 * @param {number} options.sourceDisplayHeight
 * @param {string|null} [options.sourceId] v1 の cuts[].src 一致判定に使う id。v0 プロジェクトは null。
 * @param {number} [options.faceIndex] 各フレームの detections[] のうち追跡する index（v0 は 1 人）
 * @param {{method:string,window?:number,oneEuro?:object}} [options.smoothing]
 * @param {{mode:string,intervalSeconds?:number,threshold?:object}} [options.decimate]
 * @param {number} [options.marginMultiplier] 瞳間距離に対する帯の長さ倍率
 * @param {number} [options.thicknessRatio] 帯の太さ（長さに対する比率）
 * @param {number} [options.nativeBarWidthPx] 生成する帯素材のネイティブ幅（scale=1 の長さ）
 * @param {"hold"|"shrink"} [options.onGap]
 * @param {number} [options.gapShrinkAfterSeconds]
 * @param {number} [options.gapShrinkRampSeconds]
 * @param {number} [options.gapShrinkScale]
 * @param {number} [options.outlierMaxAngleJumpDeg] 直前採用値からの瞬時角度ジャンプ上限（度）。
 *   超えた検出は瞳の取り違え等の誤検出とみなし棄却してホールドへ委ねる（0 で無効化）。
 * @param {string} [options.layerIdPrefix]
 */
export function buildEyeBarGroups(options) {
  const {
    track,
    cuts,
    canvasWidth,
    canvasHeight,
    sourceDisplayWidth,
    sourceDisplayHeight,
    sourceId = null,
    faceIndex = 0,
    smoothing = { method: "moving-average", window: 5 },
    decimate = { mode: "interval", intervalSeconds: 0.2 },
    marginMultiplier = 1.6,
    thicknessRatio = 0.22,
    nativeBarWidthPx = 800,
    onGap = "hold",
    gapShrinkAfterSeconds = 0.5,
    gapShrinkRampSeconds = 0.15,
    gapShrinkScale = 0.001,
    outlierMaxAngleJumpDeg = 45,
    layerIdPrefix = "eye-bar",
  } = options;

  const warnings = [];

  if (!track || track.kind !== "face-landmarks") {
    return { ok: false, reason: "track.kind が face-landmarks ではありません" };
  }
  const samples = Array.isArray(track.samples) ? track.samples.slice().sort((a, b) => a.t - b.t) : [];
  if (samples.length === 0) {
    return { ok: false, reason: "face_landmarks トラックに samples がありません" };
  }

  const times = samples.map((s) => Number(s.t));
  const detections = samples.map((s) => (Array.isArray(s.detections) ? s.detections[faceIndex] : undefined));
  const canvasSize = { width: canvasWidth, height: canvasHeight };
  const sourceSize = { width: sourceDisplayWidth, height: sourceDisplayHeight };

  let detectedValid = detections.map((d) => hasPupils(d));
  if (!detectedValid.some(Boolean)) {
    return { ok: false, reason: `face index ${faceIndex} の検出（瞳ランドマーク）が 1 フレームもありません` };
  }
  // 検出できたフレームだけ、いったん幾何（center/angle/length）を計算しておく（後段の外れ値
  // 検出・ホールド埋めの両方がこのキャッシュを共有する — 同じ landmarks から二重に計算しない）。
  const detectedGeometry = new Array(samples.length).fill(null);
  for (let i = 0; i < samples.length; i += 1) {
    if (!detectedValid[i]) continue;
    const detection = detections[i];
    const left = mapNormalizedPointToCanvas(detection.landmarks.left_pupil, sourceSize, canvasSize);
    const right = mapNormalizedPointToCanvas(detection.landmarks.right_pupil, sourceSize, canvasSize);
    detectedGeometry[i] = eyeGeometryFromCanvasPoints(left, right);
  }

  const validFlags = outlierMaxAngleJumpDeg > 0
    ? rejectAngleOutliers(detectedValid, detectedGeometry.map((g) => g?.angleDeg ?? null), outlierMaxAngleJumpDeg)
    : detectedValid;
  const rejectedOutlierCount = detectedValid.filter(Boolean).length - validFlags.filter(Boolean).length;
  if (rejectedOutlierCount > 0) {
    warnings.push(
      `${rejectedOutlierCount} フレームを角度の外れ値として棄却しホールドで埋めました`
        + `（直前採用値から ${outlierMaxAngleJumpDeg}° を超える瞬時ジャンプ — 瞳の取り違え等の`
        + "誤検出とみなす。--outlier-max-angle-jump 0 で無効化できます）。",
    );
  }

  const filledFrom = holdFillIndices(validFlags);

  const rawCenterX = new Array(samples.length);
  const rawCenterY = new Array(samples.length);
  const rawAngle = new Array(samples.length);
  const rawLength = new Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const geometry = detectedGeometry[filledFrom[i]];
    rawCenterX[i] = geometry.centerX;
    rawCenterY[i] = geometry.centerY;
    rawAngle[i] = geometry.angleDeg;
    rawLength[i] = geometry.lengthPx;
  }
  const unwrappedAngle = unwrapDegrees(rawAngle);

  const smoothedX = smoothSeries(rawCenterX, times, smoothing);
  const smoothedY = smoothSeries(rawCenterY, times, smoothing);
  const smoothedAngle = smoothSeries(unwrappedAngle, times, smoothing);
  const smoothedLength = smoothSeries(rawLength, times, smoothing);
  const sampleAt = makeSampler(times, {
    centerX: smoothedX,
    centerY: smoothedY,
    angleDeg: smoothedAngle,
    lengthPx: smoothedLength,
  });

  const gapStreaks = onGap === "shrink" ? collectGapStreaks(validFlags, times) : [];

  const allRuns = runsInTimelineOrder(sourceCutRuns(cuts, sourceId));
  if (allRuns.length === 0) {
    return { ok: false, reason: "cuts[] の中に対象 source を参照するカットがありません" };
  }
  const supportedRuns = [];
  for (const run of allRuns) {
    if (cutHasUnsupportedFraming(run.cut)) {
      warnings.push(
        `cut (in=${run.cut.in}, out=${run.cut.out}) は framing キーフレームを宣言しており、`
          + "v0 の目線黒帯は空間写像を保証できないためこの区間をスキップしました（別レイヤーの境界として扱う）。",
      );
      continue;
    }
    supportedRuns.push(run);
  }
  if (supportedRuns.length === 0) {
    return { ok: false, reason: "対象カットはすべて framing 付きで、v0 の目線黒帯は対応できません" };
  }

  // 出力タイムライン上で隣接（またはほぼ隣接）する run をひとまとめにする — 同一区間の連続表示は
  // 1 レイヤーにまとめ、真のギャップ（別カットアウェイ）でだけレイヤーを分ける。
  const groups = [];
  for (const run of supportedRuns) {
    const last = groups[groups.length - 1];
    if (last && run.outStart - last.outEnd <= GROUP_GAP_EPSILON) {
      last.runs.push(run);
      last.outEnd = Math.max(last.outEnd, run.outEnd);
    } else {
      groups.push({ outStart: run.outStart, outEnd: run.outEnd, runs: [run] });
    }
  }

  const layers = [];
  let maxLayerDuration = 0;
  groups.forEach((group, groupIndex) => {
    const points = [];
    group.runs.forEach((run, runIndex) => {
      const anchors = new Set([run.srcIn, run.srcOut]);
      for (const t of times) {
        if (t > run.srcIn + T_EPSILON && t < run.srcOut - T_EPSILON) anchors.add(t);
      }
      const shrinkAnchors = new Map(); // sourceT -> forced scale override
      if (onGap === "shrink") {
        for (const streak of gapStreaks) {
          if (streak.durationSeconds < gapShrinkAfterSeconds) continue;
          const overlapStart = Math.max(streak.startT, run.srcIn);
          const overlapEnd = Math.min(streak.endT, run.srcOut);
          if (overlapEnd - overlapStart < 2 * gapShrinkRampSeconds) continue;
          const rampInT = Math.min(overlapStart + gapShrinkRampSeconds, overlapEnd);
          const rampOutT = Math.max(overlapEnd - gapShrinkRampSeconds, overlapStart);
          anchors.add(rampInT);
          anchors.add(rampOutT);
          shrinkAnchors.set(rampInT, gapShrinkScale);
          shrinkAnchors.set(rampOutT, gapShrinkScale);
        }
      }
      const sortedAnchors = [...anchors].sort((a, b) => a - b);
      for (const sourceT of sortedAnchors) {
        const sampled = sampleAt(sourceT);
        const geometry = applyCutTransformToGeometry(
          { centerX: sampled.centerX, centerY: sampled.centerY, angleDeg: sampled.angleDeg, lengthPx: sampled.lengthPx },
          applyCutTransformToPoint,
          run.cut.transform ?? null,
        );
        const transform = barLayerTransform(geometry, { nativeBarWidthPx, marginMultiplier, canvasWidth, canvasHeight });
        if (shrinkAnchors.has(sourceT)) transform.scale = shrinkAnchors.get(sourceT);
        const timelineT = run.outStart + (sourceT - run.srcIn) / run.speed;
        const isBoundary = sourceT === run.srcIn || sourceT === run.srcOut || shrinkAnchors.has(sourceT);
        points.push({ t: timelineT, x: transform.x, y: transform.y, rotate: transform.rotate, scale: transform.scale, boundary: isBoundary, runIndex });
      }
    });
    points.sort((a, b) => a.t - b.t);
    // 隣接（またはほぼ隣接）カットを 1 グループへまとめた副作用: 前の run の最終アンカー
    // （t=outEnd）と次の run の先頭アンカー（t=outStart）は時刻がほぼ一致する（ジャンプカット
    // の切り替わり）。まとめて 1 レイヤーの keyframes にすると、この 2 点の間を素通しで
    // 線形補間してしまい、実際には瞬時に切り替わるはずの帯位置が「じわっとスライドする」
    // 誤りが起きる（源映像側は t=srcOut で終わり別の t=srcIn から再開する不連続点なので、
    // 補間してよい区間ではない）。source run の境界をまたぐ 2 点が接近しすぎている場合は、
    // 手前側の点を SNAP_EPSILON だけ早めて「直前まで前カットの位置を保持 → 一瞬で切り替え」
    // という有向スナップに直す（右から左へ処理し、連鎖的な前方への押し出しを 1 パスで解決する）。
    // 4ms は「どんな一般的な fps（〜250fps）でも 1 フレーム未満」になる固定値。knife-edge
    // にはせず定数にする（fps は build-layer.mjs の入力に含まれない — 帯素材の生成にしか
    // 使わない値を幾何計算へ持ち込まない、という既存の関心の分離を保つ）。
    const SNAP_EPSILON = 0.004;
    for (let i = points.length - 1; i >= 1; i -= 1) {
      if (points[i].runIndex === points[i - 1].runIndex) continue;
      const gap = points[i].t - points[i - 1].t;
      if (gap < SNAP_EPSILON) {
        points[i - 1].t = points[i].t - SNAP_EPSILON;
        points[i - 1].boundary = true;
      }
    }
    points.sort((a, b) => a.t - b.t);
    const decimated = decimatePoints(points, decimate);
    const groupStart = group.outStart;
    const keyframes = decimated.map((p) => ({
      t: round(Math.max(0, p.t - groupStart), 6),
      transform: { x: round(p.x, 3), y: round(p.y, 3), scale: round(p.scale, 6), rotate: round(p.rotate, 3) },
    }));
    // usableLayerKeyframePoints は t 昇順・>=2 点を要求する（layer-keyframes.mjs）。丸め込みで
    // 同一 t が連続してしまった場合は後勝ちで潰す（値が近い連続点なので実害はない）。
    const dedupedKeyframes = [];
    for (const kf of keyframes) {
      const prev = dedupedKeyframes[dedupedKeyframes.length - 1];
      if (prev && Math.abs(prev.t - kf.t) < 1e-6) {
        dedupedKeyframes[dedupedKeyframes.length - 1] = kf;
      } else {
        dedupedKeyframes.push(kf);
      }
    }
    if (dedupedKeyframes.length < 2) {
      dedupedKeyframes.push({ t: round((dedupedKeyframes[0]?.t ?? 0) + 0.001, 6), transform: { ...dedupedKeyframes[0].transform } });
    }
    const layerDuration = Math.max(group.outEnd - group.outStart, dedupedKeyframes[dedupedKeyframes.length - 1].t);
    maxLayerDuration = Math.max(maxLayerDuration, layerDuration);
    layers.push({
      id: `${layerIdPrefix}-${faceIndex}-${groupIndex}`,
      t: round(group.outStart, 6),
      duration: round(layerDuration, 6),
      kind: "baked",
      transform: { ...dedupedKeyframes[0].transform },
      keyframes: dedupedKeyframes,
      _sourceRunCount: group.runs.length,
    });
  });

  const nativeBarHeightPx = Math.max(2, Math.round(nativeBarWidthPx * thicknessRatio));
  return {
    ok: true,
    layers,
    warnings,
    nativeBarWidthPx,
    nativeBarHeightPx,
    maxLayerDuration,
    detectedFrameCount: validFlags.filter(Boolean).length,
    totalFrameCount: validFlags.length,
    rejectedOutlierCount,
  };
}

export { containFitRect };
