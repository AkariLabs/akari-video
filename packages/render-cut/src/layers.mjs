import { resolve } from "node:path";

import { resolveFfmpeg } from "../../media-bin/src/index.mjs";
import { computePerspectiveFfmpegCorners, PERSPECTIVE_PAD_FRAC } from "./perspective-homography.mjs";

// contract-2026-07-22-prerender-rail-and-assets.md §0/§1.2: render-cut composites edit.json
// layers[] (baked alpha mov / video PinP) onto the cuts-composited base video, ordered by t.
// This module builds the single ffmpeg filter_complex for that stage; render-cut.mjs only calls
// it when edit.layers has at least one item, so a layers-less edit.json never runs this code path
// at all (byte-identical output, zero regression risk for existing projects).

const EPSILON = 1e-6;
const DEFAULT_CHROMA_SIMILARITY = 0.1;
const DEFAULT_CHROMA_BLEND = 0;

export function hasLayers(edit) {
  return Array.isArray(edit?.layers) && edit.layers.length > 0;
}

// Layers whose blend is "normal" (or unset) are composited with a single itsoffset+trim+overlay
// step chained directly onto the running video label (cheap, no re-encode of untouched regions).
// Layers with a non-normal blend (screen/multiply/...) need pixel-aligned inputs for ffmpeg's
// `blend` filter, which the `overlay` filter's x/y placement doesn't provide, so those go through
// a trim-the-timeline-into-three-segments/blend-the-middle-one/concat-back pipeline instead. Both
// styles consume and produce a single running "[label]" for the full base duration, so layers of
// either kind chain together in any order within one ffmpeg invocation.
export function buildLayersCompositeCommand({
  layers,
  projectRoot,
  ffmpegCommand = resolveFfmpeg(),
  inputPath,
  outputPath,
  duration,
  width,
  height,
  videoEncodeArgs = null,
}) {
  const inputArgs = [];
  const filters = [];
  let previous = "[0:v]";

  layers.forEach((layer, index) => {
    const inputIndex = index + 1; // 0 is the base video (-i inputPath)
    const idBase = `l${index}`;
    const t = Number(layer.t) || 0;
    const layerDuration = Number(layer.duration) || 0;
    const end = t + layerDuration;
    const transform = layer.transform ?? {};
    const x = Number(transform.x ?? 0) || 0;
    const y = Number(transform.y ?? 0) || 0;
    const scale = Number(transform.scale ?? 1) || 1;
    const rotate = Number(transform.rotate ?? 0) || 0;
    const opacity = layer.opacity === undefined ? 1 : Number(layer.opacity);
    const blend = layer.blend ?? "normal";
    const isNormal = blend === "normal";

    inputArgs.push(
      ...(isNormal ? ["-itsoffset", formatNumber(t)] : []),
      "-i",
      resolve(projectRoot, layer.src),
    );

    // Layer preprocessing chain shared by both compositing styles: trim to the declared duration,
    // key out chroma if requested, normalize to an alpha-carrying format, then apply transform/opacity.
    const steps = [`trim=duration=${formatNumber(layerDuration)}`];
    if (!isNormal) steps.push("setpts=PTS-STARTPTS");
    if (layer.kind === "video" && layer.chroma_key) {
      const key = layer.chroma_key;
      steps.push(
        `chromakey=color=${key.color}:similarity=${formatNumber(key.similarity ?? DEFAULT_CHROMA_SIMILARITY)}:blend=${formatNumber(key.blend ?? DEFAULT_CHROMA_BLEND)}`,
      );
    }
    steps.push("format=yuva420p");
    // contract-2026-08-02-preview-parity.md: layers[].crop applies before scale/rotate/opacity
    // (crop → scale → rotate → opacity → overlay). crop is 0..1 normalized against the source
    // frame (layer.crop is undefined for the common case, so this step is skipped entirely and
    // existing crop-less projects render byte-identical output — zero regression risk). Even
    // rounding (trunc(.../2)*2) keeps w/h/x/y aligned to yuva420p's 4:2:0 chroma subsampling,
    // which the same-style scale step below does not need since it never runs on odd offsets.
    const crop = layer.crop;
    if (crop) {
      const cropW = clamp(Number(crop.w) || 1, EPSILON, 1);
      const cropH = clamp(Number(crop.h) || 1, EPSILON, 1);
      const cropX = clamp(Number(crop.x) || 0, 0, 1 - cropW);
      const cropY = clamp(Number(crop.y) || 0, 0, 1 - cropH);
      steps.push(
        `crop=trunc(iw*${formatNumber(cropW)}/2)*2:trunc(ih*${formatNumber(cropH)}/2)*2:trunc(iw*${formatNumber(cropX)}/2)*2:trunc(ih*${formatNumber(cropY)}/2)*2`,
      );
    }
    if (scale !== 1) {
      steps.push(`scale=trunc(iw*${formatNumber(scale)}):trunc(ih*${formatNumber(scale)})`);
    }
    // contract-2026-08-02-preview-parity.md §2.4.3: layers[].perspective applies after scale and
    // before rotate (crop → scale → perspective → rotate → opacity → overlay). ffmpeg's
    // `perspective` filter's x0..y3 always describe where the INPUT FRAME'S OWN 4 corners land in
    // the output -- not an inner content rectangle's corners -- so reproducing a corner-pin
    // declared against the layer's own (post crop+scale) box requires first padding the frame
    // (transparent) and then feeding perspective the *padded frame's* corner positions under the
    // same homography (computePerspectiveFfmpegCorners does this derivation; see that module for
    // why padding is required for the outside-the-trapezoid area to render transparent rather than
    // edge-clamped opaque content). The padding is removed again by the trailing crop= so the
    // stream handed to rotate/opacity/overlay is exactly the same iw/ih it would have been without
    // perspective (their pivot/placement math is therefore unaffected by this stage).
    const perspective = layer.perspective;
    if (perspective && Array.isArray(perspective.corners) && perspective.corners.length === 4) {
      const padFrac = PERSPECTIVE_PAD_FRAC;
      const denom = 1 + 2 * padFrac;
      const destCorners = computePerspectiveFfmpegCorners(perspective.corners, padFrac);
      const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = destCorners;
      const iwExpr = "iw";
      const ihExpr = "ih";
      // ffmpeg's expression evaluator rejects `iw*-0.07` (unary minus straight after `*`, e.g.
      // for extrapolated corners that land left/above the padded canvas) -- and, empirically,
      // also rejects `iw*(-0.07)`/`iw*(0.07)` (a parenthesized factor right after `iw*` trips its
      // "Unknown function" path, as if `iw(` were being parsed as a call). Putting the numeric
      // coefficient *first* sidesteps both: a leading unary minus at the start of an expression is
      // always valid, and the size variable no longer immediately precedes a `(`. Separately, the
      // `perspective` filter's own expression evaluator does not define `iw`/`ih` (those are
      // crop/pad/scale's constants) -- it defines `W`/`H` for its own input frame size instead
      // (confirmed by real ffmpeg invocation; `iw`/`ih` here fail with "Undefined constant").
      const scaledBy = (value, axisExpr) => `${formatNumber(value)}*${axisExpr}`;
      steps.push(
        `pad=trunc(${iwExpr}*${formatNumber(denom)}/2)*2:trunc(${ihExpr}*${formatNumber(denom)}/2)*2:x=trunc(${iwExpr}*${formatNumber(padFrac)}/2)*2:y=trunc(${ihExpr}*${formatNumber(padFrac)}/2)*2:color=black@0`,
      );
      steps.push(
        `perspective=x0=${scaledBy(x0, "W")}:y0=${scaledBy(y0, "H")}:x1=${scaledBy(x1, "W")}:y1=${scaledBy(y1, "H")}:x2=${scaledBy(x2, "W")}:y2=${scaledBy(y2, "H")}:x3=${scaledBy(x3, "W")}:y3=${scaledBy(y3, "H")}:sense=destination:eval=init`,
      );
      steps.push(
        `crop=trunc((${iwExpr}/${formatNumber(denom)})/2)*2:trunc((${ihExpr}/${formatNumber(denom)})/2)*2:trunc((${iwExpr}*${formatNumber(padFrac)}/${formatNumber(denom)})/2)*2:trunc((${ihExpr}*${formatNumber(padFrac)}/${formatNumber(denom)})/2)*2`,
      );
    }
    if (rotate !== 0) {
      const radians = `(${formatNumber(rotate)}*PI/180)`;
      steps.push(`rotate=${radians}:fillcolor=black@0:ow=rotw(${radians}):oh=roth(${radians})`);
    }
    if (opacity !== 1) {
      steps.push(`colorchannelmixer=aa=${formatNumber(opacity)}`);
    }
    const processed = `[${idBase}_p]`;
    filters.push(`[${inputIndex}:v]${steps.join(",")}${processed}`);

    if (isNormal) {
      const next = `[${idBase}_out]`;
      filters.push(
        `${previous}${processed}overlay=x=(main_w-overlay_w)/2+${formatNumber(x)}:y=(main_h-overlay_h)/2+${formatNumber(y)}:format=auto:enable='between(t,${formatNumber(t)},${formatNumber(end)})'${next}`,
      );
      previous = next;
      return;
    }

    // Blend-mode path: split `previous` into as many copies as this layer needs (the [t, t+duration)
    // segment always; [0, t) and [t+duration, total) only when they're non-empty), so no label is
    // ever referenced twice (an unconnected/double-referenced ffmpeg pad silently drops a branch of
    // the graph rather than erroring — this is the same asplit discipline audio_mix's bgm ducking
    // uses for [narration] in plan.mjs).
    const hasBefore = t > EPSILON;
    const hasAfter = end < duration - EPSILON;
    const needed = 1 + (hasBefore ? 1 : 0) + (hasAfter ? 1 : 0);
    let prevBefore = null;
    let prevDuring = previous;
    let prevAfter = null;
    if (needed > 1) {
      const copies = Array.from({ length: needed }, (_, copyIndex) => `[${idBase}_prev${copyIndex}]`);
      filters.push(`${previous}split=${needed}${copies.join("")}`);
      let cursor = 0;
      if (hasBefore) prevBefore = copies[cursor++];
      prevDuring = copies[cursor++];
      if (hasAfter) prevAfter = copies[cursor];
    }

    const parts = [];
    if (hasBefore) {
      const segA = `[${idBase}_segA]`;
      filters.push(`${prevBefore}trim=start=0:end=${formatNumber(t)},setpts=PTS-STARTPTS${segA}`);
      parts.push(segA);
    }

    // maskedmerge requires all three of its inputs to share an identical, non-chroma-subsampled
    // pixel format (yuv420p's subsampled chroma planes silently corrupt the merge); gbrp (planar
    // RGB, full resolution) is what both `blend` and `maskedmerge` need to produce correct color
    // math here, confirmed empirically against known blend-formula results before wiring this up.
    const baseDuring = `[${idBase}_bd]`;
    filters.push(`${prevDuring}trim=start=${formatNumber(t)}:end=${formatNumber(end)},setpts=PTS-STARTPTS,format=gbrp${baseDuring}`);
    const bd1 = `[${idBase}_bd1]`;
    const bd2 = `[${idBase}_bd2]`;
    filters.push(`${baseDuring}split=2${bd1}${bd2}`);
    // `blend`/`maskedmerge` need pixel-aligned, same-size inputs (unlike `overlay`, which places a
    // smaller image via x/y on its own), so the layer canvas is padded up to the output frame size
    // at the same centered+offset position the normal path passes to `overlay`.
    const canvas = `[${idBase}_canvas]`;
    filters.push(
      `${processed}pad=${width}:${height}:x=(ow-iw)/2+${formatNumber(x)}:y=(oh-ih)/2+${formatNumber(y)}:color=black@0${canvas}`,
    );
    const lc1 = `[${idBase}_lc1]`;
    const lc2 = `[${idBase}_lc2]`;
    filters.push(`${canvas}split=2${lc1}${lc2}`);
    const mask = `[${idBase}_mask]`;
    filters.push(`${lc1}alphaextract${mask}`);
    const lcRgb = `[${idBase}_lcrgb]`;
    filters.push(`${lc2}format=gbrp${lcRgb}`);
    const blended = `[${idBase}_blended]`;
    filters.push(`${bd1}${lcRgb}blend=all_mode=${blend}${blended}`);
    const segB = `[${idBase}_segB]`;
    filters.push(`${bd2}${blended}${mask}maskedmerge,format=yuv420p${segB}`);
    parts.push(segB);

    if (hasAfter) {
      const segC = `[${idBase}_segC]`;
      filters.push(`${prevAfter}trim=start=${formatNumber(end)}:end=${formatNumber(duration)},setpts=PTS-STARTPTS${segC}`);
      parts.push(segC);
    }

    if (parts.length === 1) {
      previous = parts[0];
    } else {
      const next = `[${idBase}_out]`;
      filters.push(`${parts.join("")}concat=n=${parts.length}:v=1:a=0${next}`);
      previous = next;
    }
  });

  return {
    command: ffmpegCommand,
    args: [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-y",
      "-i",
      inputPath,
      ...inputArgs,
      "-filter_complex",
      filters.join(";"),
      "-map",
      previous,
      "-map",
      "0:a:0",
      ...(videoEncodeArgs ?? ["-c:v", "libx264", "-profile:v", "high"]),
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "copy",
      outputPath,
    ],
  };
}

function formatNumber(value) {
  return Number(value).toString();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
