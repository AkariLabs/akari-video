import { decimateMotionPoints, extractVisibleSegments, sliceSegment, smoothSegment } from "./motion.mjs";
import { resolveBlockPixels, even } from "./bake.mjs";
import { sourceCutRuns, sourceTimeToTimeline } from "./timeline-map.mjs";

function round(value, digits = 6) {
  return Number(value.toFixed(digits));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function defaultCutGeometry(cut) {
  const framing = cut?.framing;
  if (framing?.crop || (Array.isArray(framing?.keyframes) && framing.keyframes.length > 0)) return false;
  const transform = cut?.transform;
  if (!transform) return true;
  return Number(transform.x ?? 0) === 0 && Number(transform.y ?? 0) === 0
    && Number(transform.scale ?? 1) === 1 && Number(transform.rotate ?? 0) === 0;
}

function cropSize(points, sourceWidth, sourceHeight, blockPixels, feather) {
  const maxWidth = Math.max(...points.map((point) => point.w * sourceWidth));
  const maxHeight = Math.max(...points.map((point) => point.h * sourceHeight));
  const margin = Math.ceil(Math.max(blockPixels * 1.5, feather * 3, 8));
  const maxEvenWidth = Math.max(2, Math.floor(sourceWidth / 2) * 2);
  const maxEvenHeight = Math.max(2, Math.floor(sourceHeight / 2) * 2);
  return {
    width: Math.min(maxEvenWidth, even(maxWidth + margin * 2)),
    height: Math.min(maxEvenHeight, even(maxHeight + margin * 2)),
    maxFaceWidth: maxWidth,
  };
}

function displayPlacement(centerXPx, centerYPx, sourceWidth, sourceHeight, canvasWidth, canvasHeight) {
  const scale = Math.min(canvasWidth / sourceWidth, canvasHeight / sourceHeight);
  const displayedWidth = sourceWidth * scale;
  const displayedHeight = sourceHeight * scale;
  const left = (canvasWidth - displayedWidth) / 2;
  const top = (canvasHeight - displayedHeight) / 2;
  return {
    x: left + centerXPx * scale - canvasWidth / 2,
    y: top + centerYPx * scale - canvasHeight / 2,
    scale,
  };
}

/** Build bounded bake jobs and schema-compatible baked layers without touching edit.json. */
export function buildMosaicPlan({
  track,
  cuts,
  sourceId = null,
  sourcePath,
  sourceWidth,
  sourceHeight,
  canvasWidth,
  canvasHeight,
  fps,
  faceIndex = 0,
  smoothWindow = 9,
  blockSize = "0.08",
  strength = 0.82,
  feather = 8,
  outPathFor,
  layerIdPrefix = "face-mosaic",
}) {
  if (track?.kind !== "face-landmarks") return { ok: false, reason: "track.kind が face-landmarks ではありません" };
  const visible = extractVisibleSegments(track, { faceIndex });
  if (visible.length === 0) {
    return { ok: false, reason: "face_contour を持つ対象顔の検出がありません。vision-tracks を再実行してください" };
  }
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
    for (const rawSegment of visible) {
      const smoothed = smoothSegment(rawSegment, smoothWindow);
      const sampleStep = 1 / Number(track.sample_fps || fps);
      const srcStart = Math.max(run.srcIn, smoothed[0].t);
      const srcEnd = Math.min(run.srcOut, smoothed[smoothed.length - 1].t + sampleStep);
      if (srcEnd - srcStart <= 1 / (fps * 2)) continue;
      const points = sliceSegment(smoothed, srcStart, Math.min(srcEnd, smoothed[smoothed.length - 1].t));
      if (points.length === 0) continue;
      const estimatedFaceWidth = Math.max(...points.map((point) => point.w * sourceWidth));
      const blockPixels = resolveBlockPixels(blockSize, estimatedFaceWidth);
      const crop = cropSize(points, sourceWidth, sourceHeight, blockPixels, feather);
      const anchorSource = decimateMotionPoints(points, { sourceWidth, sourceHeight });
      const anchors = anchorSource.map((point) => ({
        ...point,
        centerXPx: clamp(point.cx * sourceWidth, crop.width / 2, sourceWidth - crop.width / 2),
        centerYPx: clamp(point.cy * sourceHeight, crop.height / 2, sourceHeight - crop.height / 2),
      }));
      const outStart = sourceTimeToTimeline(run, srcStart);
      const duration = (srcEnd - srcStart) / run.speed;
      if (outStart === null || !(duration > 0)) continue;
      const keyframes = anchors.map((anchor) => {
        const placement = displayPlacement(
          anchor.centerXPx, anchor.centerYPx, sourceWidth, sourceHeight, canvasWidth, canvasHeight,
        );
        return {
          t: round((anchor.t - srcStart) / run.speed),
          transform: { x: round(placement.x, 3), y: round(placement.y, 3), scale: round(placement.scale) },
        };
      });
      if (keyframes.length === 1) keyframes.push({ t: round(duration), transform: { ...keyframes[0].transform } });
      const outPath = outPathFor(ordinal);
      const layer = {
        id: `${layerIdPrefix}-${faceIndex}-${ordinal}`,
        t: round(outStart),
        duration: round(duration),
        kind: "baked",
        src: null,
        transform: { ...keyframes[0].transform },
        keyframes,
        preset: "face-mosaic-v0",
        params: {
          face: faceIndex,
          block_size: String(blockSize),
          strength: round(strength),
          feather: round(feather),
        },
      };
      jobs.push({
        outPath,
        sourcePath,
        sourceWidth,
        sourceHeight,
        srcStart,
        srcEnd,
        sourceDuration: srcEnd - srcStart,
        duration,
        speed: run.speed,
        fps,
        points,
        anchors,
        cropWidth: crop.width,
        cropHeight: crop.height,
        blockPixels,
        strength,
        feather,
      });
      layers.push(layer);
      ordinal += 1;
    }
  }
  if (jobs.length === 0) return { ok: false, reason: "検出区間と表示 cut が重なる対応可能な区間がありません", warnings };
  return { ok: true, jobs, layers, warnings };
}
