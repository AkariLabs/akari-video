import { extractPoseSegments, slicePoseSegment, smoothPoseSegment } from "./motion.mjs";
import { JOINT_NAMES, visibleSkeleton } from "./skeleton.mjs";
import { sourceCutRuns, sourceTimeToTimeline } from "./timeline-map.mjs";

function round(value, digits = 6) {
  return Number(Number(value).toFixed(digits));
}

function defaultCutGeometry(cut) {
  const framing = cut?.framing;
  if (framing?.crop || (Array.isArray(framing?.keyframes) && framing.keyframes.length > 0)) return false;
  const transform = cut?.transform;
  if (!transform) return true;
  return Number(transform.x ?? 0) === 0 && Number(transform.y ?? 0) === 0
    && Number(transform.scale ?? 1) === 1 && Number(transform.rotate ?? 0) === 0;
}

function evenExtent(start, end, limit) {
  let from = Math.max(0, Math.floor(start));
  let to = Math.min(limit, Math.ceil(end));
  if ((to - from) % 2 !== 0) {
    if (to < limit) to += 1;
    else if (from > 0) from -= 1;
  }
  if (to - from < 2) to = Math.min(limit, from + 2);
  return { from, to };
}

function cropFor(points, {
  sourceWidth,
  sourceHeight,
  strokeWidth,
  jointRadius,
  minConfidence,
}) {
  const projected = [];
  for (const point of points) {
    const visible = visibleSkeleton(point.joints, minConfidence);
    for (const name of visible.joints) {
      projected.push([
        point.joints[name].projection[0] * sourceWidth,
        point.joints[name].projection[1] * sourceHeight,
      ]);
    }
  }
  if (projected.length === 0) return null;
  const margin = Math.ceil(Math.max(strokeWidth / 2, jointRadius) + 3);
  const xs = projected.map(([x]) => x);
  const ys = projected.map(([, y]) => y);
  const horizontal = evenExtent(Math.min(...xs) - margin, Math.max(...xs) + margin, sourceWidth);
  const vertical = evenExtent(Math.min(...ys) - margin, Math.max(...ys) + margin, sourceHeight);
  return {
    left: horizontal.from,
    top: vertical.from,
    width: horizontal.to - horizontal.from,
    height: vertical.to - vertical.from,
  };
}

function displayPlacement(crop, sourceWidth, sourceHeight, canvasWidth, canvasHeight) {
  const scale = Math.min(canvasWidth / sourceWidth, canvasHeight / sourceHeight);
  const displayedWidth = sourceWidth * scale;
  const displayedHeight = sourceHeight * scale;
  const sourceCenterX = crop.left + crop.width / 2;
  const sourceCenterY = crop.top + crop.height / 2;
  return {
    x: (canvasWidth - displayedWidth) / 2 + sourceCenterX * scale - canvasWidth / 2,
    y: (canvasHeight - displayedHeight) / 2 + sourceCenterY * scale - canvasHeight / 2,
    scale,
  };
}

export function buildSkeletonPlan({
  track,
  cuts,
  sourceId = null,
  sourceWidth,
  sourceHeight,
  canvasWidth,
  canvasHeight,
  fps,
  strokeWidth = 4,
  color = "#00e5ff",
  jointRadius = 6,
  smoothing = 5,
  minConfidence = 0.3,
  layerIdPrefix = "pose-skeleton",
  outPathFor,
}) {
  if (track?.kind !== "body-pose-3d") {
    return { ok: false, reason: "track.kind が body-pose-3d ではありません" };
  }
  const segments = extractPoseSegments(track);
  if (segments.length === 0) return { ok: false, reason: "有効な 3D ボディポーズ検出がありません" };
  const runs = sourceCutRuns(cuts, sourceId);
  if (runs.length === 0) return { ok: false, reason: "対象 source を表示する cut 区間がありません" };

  const warnings = [];
  const jobs = [];
  const layers = [];
  let ordinal = 0;
  for (const run of runs) {
    if (!defaultCutGeometry(run.cut)) {
      warnings.push("framing/cut transform を持つ区間は座標一致を保証できないためスキップしました");
      continue;
    }
    for (const segment of segments) {
      const sampleStep = 1 / Number(track.sample_fps || fps);
      const srcStart = Math.max(run.srcIn, segment[0].t);
      const srcEnd = Math.min(run.srcOut, segment[segment.length - 1].t + sampleStep);
      if (srcEnd - srcStart <= 1 / (fps * 2)) continue;

      // cut 境界で先に slice してから平滑化する。別シーンの値を window に混ぜない。
      const sliced = slicePoseSegment(
        segment,
        srcStart,
        Math.min(srcEnd, segment[segment.length - 1].t),
      );
      const points = smoothPoseSegment(sliced, smoothing);
      const crop = cropFor(points, {
        sourceWidth, sourceHeight, strokeWidth, jointRadius, minConfidence,
      });
      if (!crop) continue;
      const outStart = sourceTimeToTimeline(run, srcStart);
      const duration = (srcEnd - srcStart) / run.speed;
      if (outStart === null || !(duration > 0)) continue;
      const placement = displayPlacement(
        crop, sourceWidth, sourceHeight, canvasWidth, canvasHeight,
      );
      const outPath = outPathFor(ordinal);
      jobs.push({
        outPath,
        srcStart,
        srcEnd,
        duration,
        speed: run.speed,
        fps,
        points,
        sourceWidth,
        sourceHeight,
        cropLeft: crop.left,
        cropTop: crop.top,
        cropWidth: crop.width,
        cropHeight: crop.height,
        strokeWidth,
        color,
        jointRadius,
        minConfidence,
      });
      layers.push({
        id: `${layerIdPrefix}-${ordinal}`,
        t: round(outStart),
        duration: round(duration),
        kind: "baked",
        src: null,
        transform: { x: round(placement.x, 3), y: round(placement.y, 3), scale: round(placement.scale) },
        preset: "pose-skeleton-v0",
        params: {
          stroke_width: round(strokeWidth),
          color,
          joint_radius: round(jointRadius),
          smoothing: Math.floor(smoothing),
          min_confidence: round(minConfidence),
        },
      });
      ordinal += 1;
    }
  }
  if (jobs.length === 0) {
    return { ok: false, reason: "検出区間と表示 cut が重なる描画可能な区間がありません", warnings };
  }
  return { ok: true, jobs, layers, warnings };
}

export { JOINT_NAMES };
