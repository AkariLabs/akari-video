import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { resolveFfmpeg, resolveFfprobe } from "../../media-bin/src/index.mjs";
import { computePerspectiveFfmpegCorners, PERSPECTIVE_PAD_FRAC } from "./perspective-homography.mjs";
import {
  expandLayerForPerspectiveKeyframes,
  hasUsableLayerKeyframes,
  layerCropKeyframeSteps,
  layerTransformKeyframeExprs,
  probeLayerSourceSize,
} from "./layer-keyframes.mjs";
import { resolveLutPath } from "./render-inputs.mjs";

// contract-2026-07-22-prerender-rail-and-assets.md §0/§1.2: render-cut composites edit.json
// layers[] (baked alpha video / video PinP) onto the cuts-composited base video, ordered by t.
// This module builds the single ffmpeg filter_complex for that stage; render-cut.mjs only calls
// it when edit.layers has at least one item, so a layers-less edit.json never runs this code path
// at all (byte-identical output, zero regression risk for existing projects).

const EPSILON = 1e-6;
const DEFAULT_CHROMA_SIMILARITY = 0.1;
const DEFAULT_CHROMA_BLEND = 0;

// Codecs that carry alpha in a WebM *container side channel* (BlockAdditional) rather than in the
// coded pixel format. ffmpeg's built-in `vp8`/`vp9` decoders ignore that side channel entirely and
// hand back a fully opaque frame -- no warning, no error -- so a VP9-alpha matte opened with a bare
// `-i` silently composites as an opaque rectangle and blacks out whatever is underneath. Only the
// libvpx wrappers decode the alpha plane. Measured on ffmpeg 8.1.1 with a real person matte: the
// pixel outside the subject reads (252,0,0) over a red base with `-c:v libvpx-vp9`, and (0,0,0)
// without it. Both libvpx decoders ship with the standard ffmpeg build on macOS / Windows / Linux,
// which is why contract-2026-07-23-analysis-person-matte.md §3 can keep VP9 alpha WebM as the
// canonical matte format instead of falling back to a platform-locked or 18x larger container.
const SIDE_CHANNEL_ALPHA_DECODERS = { vp8: "libvpx", vp9: "libvpx-vp9" };

// contract-2026-08-10-image-layer-parity task.md §司令塔裁定 1: a layers[] item is treated as a
// still image purely by src extension (kind stays "video" in the schema either way) -- the exact
// same extension set plan.mjs's chroma_key background already uses (plan.mjs:1124 / :1530). Kept
// as an independent literal here rather than importing it from plan.mjs: plan.mjs already imports
// buildLayersCompositeCommand/hasLayers from *this* module, so the reverse import would create a
// plan.mjs <-> layers.mjs circular module dependency for no real benefit.
const IMAGE_LAYER_SOURCE_PATTERN = /\.(png|jpe?g|webp|bmp|gif)$/iu;

export function isImageLayerSource(path) {
  return IMAGE_LAYER_SOURCE_PATTERN.test(String(path ?? ""));
}

export function hasLayers(edit) {
  return Array.isArray(edit?.layers) && edit.layers.length > 0;
}

// Alpha reaches a decoded frame two different ways, and only one of them needs our help:
//   - in the pixel format itself (ProRes 4444's yuva444p10le, QTRLE's argb, PNG's rgba, ...) --
//     every decoder emits it, so those inputs must stay on the default decoder and produce
//     byte-identical ffmpeg args to before this function existed;
//   - in a WebM side channel, flagged by the AlphaMode track element that ffprobe surfaces as
//     `tags.alpha_mode` while pix_fmt stays opaque (yuv420p) -- this is the case that needs an
//     explicit libvpx decoder.
// The probe is by ffprobe rather than by file extension on purpose: `.webm` can hold VP8, VP9 or
// AV1, and `.mov` can hold anything, so extension matching would both miss real alpha and force
// libvpx onto files that do not want it.
export function probeLayerAlphaSource(ffprobeCommand, path) {
  if (!existsSync(path)) return null;
  const result = spawnSync(
    ffprobeCommand,
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_name,pix_fmt:stream_tags=alpha_mode",
      "-of",
      "json",
      path,
    ],
    { encoding: "utf8" },
  );
  if (result.error || result.status !== 0) return null;
  try {
    const stream = JSON.parse(result.stdout).streams?.[0];
    if (!stream) return null;
    const codec = String(stream.codec_name ?? "");
    const pixelFormat = String(stream.pix_fmt ?? "");
    // Matroska/WebM surfaces the native AlphaMode track element lowercased (`alpha_mode`) but
    // uppercases tags that were muxed in as generic stream metadata (`ALPHA_MODE`), so a file that
    // has been remuxed through a `-metadata:s:v:0` step declares the exact same thing under a
    // different key. Match either.
    const alphaModeTag = Object.entries(stream.tags ?? {})
      .find(([key]) => key.toLowerCase() === "alpha_mode")?.[1];
    return {
      codec,
      pixelFormat,
      // yuva420p / rgba / argb / bgra / ya8 ... every alpha-carrying pix_fmt name contains an "a"
      // in its component list, which is the same test rasterize.mjs' probeHasAlpha already uses.
      alphaInPixelFormat: pixelFormat.includes("a"),
      alphaInSideChannel: String(alphaModeTag ?? "") === "1",
    };
  } catch {
    return null;
  }
}

// Returns the `-c:v <decoder>` input option this layer needs (empty when the default decoder is
// already correct), plus a warning when alpha is declared but unreachable. An unprobeable input
// (missing file, no ffprobe) yields neither: the file is about to be opened by ffmpeg anyway, and
// failing loudly there beats guessing here.
function resolveDecoderForLayer(ffprobeCommand, resolvedPath, warnings) {
  const probed = probeLayerAlphaSource(ffprobeCommand, resolvedPath);
  if (!probed || probed.alphaInPixelFormat || !probed.alphaInSideChannel) return [];
  const decoder = SIDE_CHANNEL_ALPHA_DECODERS[probed.codec];
  if (decoder) return ["-c:v", decoder];
  warnings.push(
    `layer source ${resolvedPath} declares alpha (alpha_mode=1) but no alpha-capable decoder is`
      + ` known for codec "${probed.codec}"; it will composite fully opaque and hide the video`
      + " underneath. Re-encode the layer as VP9 alpha WebM or as a ProRes 4444 / QTRLE mov.",
  );
  return [];
}

function escapeFilterPath(path) {
  return path.replace(/\\/gu, "\\\\").replace(/:/gu, "\\:").replace(/'/gu, "\\'");
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function probeBaseFps(ffprobeCommand, path) {
  if (!existsSync(path)) return null;
  const result = spawnSync(
    ffprobeCommand,
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=r_frame_rate",
      "-of",
      "json",
      path,
    ],
    { encoding: "utf8" },
  );
  if (result.error || result.status !== 0) return null;
  try {
    const rate = JSON.parse(result.stdout).streams?.[0]?.r_frame_rate;
    const [numerator, denominator] = String(rate ?? "").split("/").map(Number);
    const fps = denominator ? numerator / denominator : numerator;
    return Number.isFinite(fps) && fps > 0 ? fps : null;
  } catch {
    return null;
  }
}

// Plan construction runs before the cut stage has written inputPath, while the project's
// edit.json already exists and has been read by render-cut. Resolve output.fps from that same
// stable input first; probing inputPath remains a fallback for callers where it already exists.
function resolveEditFps(projectRoot) {
  try {
    const raw = readFileSync(resolve(projectRoot, "edit.json"), "utf8");
    const fps = JSON.parse(raw)?.output?.fps;
    return isFiniteNumber(fps) && fps > 0 ? fps : null;
  } catch {
    return null;
  }
}

function appendFilterLayerComposite({
  filters,
  previous,
  layer,
  idBase,
  t,
  end,
  layerDuration,
  duration,
  width,
  height,
  projectRoot,
  fps,
}) {
  // Perspective keyframes expand one layer into adjacent sub-layers whose boundaries are usually
  // not exact frame boundaries. The base is CFR, so snapping every trim boundary to its frame grid
  // keeps adjacent concat segments bit-identical and prevents accumulated duplicate/dropped frames.
  let snappedT = t;
  let snappedEnd = end;
  if (isFiniteNumber(fps) && fps > 0) {
    const frame = 1 / fps;
    snappedT = Math.round(t / frame) * frame;
    snappedEnd = Math.round(end / frame) * frame;
    if (!(snappedEnd > snappedT)) snappedEnd = snappedT + frame;
  }
  const snappedLayerDuration = snappedEnd - snappedT;

  const hasBefore = snappedT > EPSILON;
  const hasAfter = snappedEnd < duration - EPSILON;
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
    filters.push(`${prevBefore}trim=start=0:end=${formatNumber(snappedT)},setpts=PTS-STARTPTS${segA}`);
    parts.push(segA);
  }

  const baseDuring = `[${idBase}_bd]`;
  const gradeInput = `[${idBase}_gradein]`;
  filters.push(
    `${prevDuring}trim=start=${formatNumber(snappedT)}:end=${formatNumber(snappedEnd)},setpts=PTS-STARTPTS,split=2${baseDuring}${gradeInput}`,
  );
  const baseRgb = `[${idBase}_bdrgb]`;
  filters.push(`${baseDuring}format=gbrp${baseRgb}`);

  const gradedRgb = `[${idBase}_gradedrgb]`;
  if (layer.filter.type === "invert") {
    filters.push(`${gradeInput}negate,format=gbrp${gradedRgb}`);
  } else if (layer.filter.type === "saturation") {
    filters.push(`${gradeInput}eq=saturation=${formatNumber(layer.filter.value)},format=gbrp${gradedRgb}`);
  } else if (layer.filter.type === "lut") {
    const lutPath = escapeFilterPath(resolveLutPath(projectRoot, layer.filter.id));
    const lutFilter = `lut3d=file='${lutPath}':interp=trilinear`;
    const intensity = layer.filter.intensity === undefined ? 1 : Number(layer.filter.intensity);
    if (intensity <= EPSILON) {
      filters.push(`${gradeInput}format=gbrp${gradedRgb}`);
    } else if (intensity >= 1 - EPSILON) {
      filters.push(`${gradeInput}${lutFilter},format=gbrp${gradedRgb}`);
    } else {
      const lutInput = `[${idBase}_lutin]`;
      const originalInput = `[${idBase}_originalin]`;
      const lutRgb = `[${idBase}_lutrgb]`;
      const originalRgb = `[${idBase}_originalrgb]`;
      filters.push(`${gradeInput}split=2${lutInput}${originalInput}`);
      filters.push(`${lutInput}${lutFilter},format=gbrp${lutRgb}`);
      filters.push(`${originalInput}format=gbrp${originalRgb}`);
      filters.push(
        `${lutRgb}${originalRgb}blend=all_mode=normal:all_opacity=${formatNumber(intensity)}${gradedRgb}`,
      );
    }
  } else {
    throw new Error(`unsupported layer filter type: ${layer.filter?.type}`);
  }

  const maskRaw = `[${idBase}_maskraw]`;
  const maskOpaque = `[${idBase}_maskopaque]`;
  const rateSuffix = isFiniteNumber(fps) && fps > 0 ? `:r=${formatNumber(fps)}` : "";
  filters.push(`color=c=white:s=${width}x${height}:d=${formatNumber(snappedLayerDuration)}${rateSuffix}${maskRaw}`);
  filters.push(`${maskRaw}format=yuva420p${maskOpaque}`);

  const padFrac = PERSPECTIVE_PAD_FRAC;
  const denom = 1 + 2 * padFrac;
  const destCorners = computePerspectiveFfmpegCorners(layer.perspective.corners, padFrac);
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = destCorners;
  const scaledBy = (value, axisExpr) => `${formatNumber(value)}*${axisExpr}`;
  const maskQuad = `[${idBase}_maskquad]`;
  filters.push(
    `${maskOpaque}pad=trunc(iw*${formatNumber(denom)}/2)*2:trunc(ih*${formatNumber(denom)}/2)*2:x=trunc(iw*${formatNumber(padFrac)}/2)*2:y=trunc(ih*${formatNumber(padFrac)}/2)*2:color=black@0,`
      + `perspective=x0=${scaledBy(x0, "W")}:y0=${scaledBy(y0, "H")}:x1=${scaledBy(x1, "W")}:y1=${scaledBy(y1, "H")}:x2=${scaledBy(x2, "W")}:y2=${scaledBy(y2, "H")}:x3=${scaledBy(x3, "W")}:y3=${scaledBy(y3, "H")}:sense=destination:eval=init,`
      + `crop=trunc((iw/${formatNumber(denom)})/2)*2:trunc((ih/${formatNumber(denom)})/2)*2:trunc((iw*${formatNumber(padFrac)}/${formatNumber(denom)})/2)*2:trunc((ih*${formatNumber(padFrac)}/${formatNumber(denom)})/2)*2${maskQuad}`,
  );
  const mask = `[${idBase}_mask]`;
  filters.push(`${maskQuad}alphaextract${mask}`);

  const segB = `[${idBase}_segB]`;
  const fpsFilter = isFiniteNumber(fps) && fps > 0 ? `,fps=${formatNumber(fps)}` : "";
  filters.push(`${baseRgb}${gradedRgb}${mask}maskedmerge,format=yuv420p${fpsFilter}${segB}`);
  parts.push(segB);

  if (hasAfter) {
    const segC = `[${idBase}_segC]`;
    filters.push(`${prevAfter}trim=start=${formatNumber(snappedEnd)}:end=${formatNumber(duration)},setpts=PTS-STARTPTS${segC}`);
    parts.push(segC);
  }

  const hasKnownFps = isFiniteNumber(fps) && fps > 0;
  if (parts.length === 1 && !hasKnownFps) return parts[0];

  const next = `[${idBase}_out]`;
  if (parts.length > 1 && !hasKnownFps) {
    filters.push(`${parts.join("")}concat=n=${parts.length}:v=1:a=0${next}`);
    return next;
  }

  let merged = parts[0];
  if (parts.length > 1) {
    merged = `[${idBase}_concat]`;
    filters.push(`${parts.join("")}concat=n=${parts.length}:v=1:a=0${merged}`);
  }
  filters.push(`${merged}fps=${formatNumber(fps)}${next}`);
  return next;
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
  ffprobeCommand = resolveFfprobe(),
  inputPath,
  outputPath,
  duration,
  width,
  height,
  videoEncodeArgs = null,
  fps = null,
}) {
  const inputArgs = [];
  const filters = [];
  const warnings = [];
  let previous = "[0:v]";
  let nextInputIndex = 1;

  // layers[].keyframes[].perspective: ffmpeg's perspective= filter exposes no per-frame time
  // variable at all (verified empirically -- see layer-keyframes.mjs's own header comment on
  // expandLayerForPerspectiveKeyframes), so it cannot be driven by an eval=frame expression like
  // every other keyframed property here. Instead a layer with keyframed perspective is expanded,
  // up front, into several adjacent synthetic sub-layers each holding a static perspective value
  // -- ordinary layers (the overwhelming majority) pass through this unchanged (flatMap of a
  // single-element array is the identity), so this adds no cost/behavior change for them.
  const expandedLayers = layers.flatMap(expandLayerForPerspectiveKeyframes);
  const needsFps = expandedLayers.some((layer) => layer.kind === "filter");
  const resolvedFps = needsFps
    ? (isFiniteNumber(fps) && fps > 0
        ? fps
        : (resolveEditFps(projectRoot) ?? probeBaseFps(ffprobeCommand, inputPath)))
    : null;

  expandedLayers.forEach((layer, index) => {
    const idBase = `l${index}`;
    const t = Number(layer.t) || 0;
    const layerDuration = Number(layer.duration) || 0;
    const end = t + layerDuration;
    if (layer.kind === "filter") {
      if (!Array.isArray(layer.perspective?.corners) || layer.perspective.corners.length !== 4) {
        warnings.push(`filter layer ${layer.id ?? index} has no usable perspective region; skipped`);
        return;
      }
      previous = appendFilterLayerComposite({
        filters,
        previous,
        layer,
        idBase,
        t,
        end,
        layerDuration,
        duration,
        width,
        height,
        projectRoot,
        fps: resolvedFps,
      });
      return;
    }

    const inputIndex = nextInputIndex++; // 0 is the base video (-i inputPath)
    const transform = layer.transform ?? {};
    const scale = Number(transform.scale ?? 1) || 1;
    const rotate = Number(transform.rotate ?? 0) || 0;
    const opacity = layer.opacity === undefined ? 1 : Number(layer.opacity);
    const blend = layer.blend ?? "normal";
    const isNormal = blend === "normal";

    const resolvedSource = resolve(projectRoot, layer.src);
    // A still-image src has exactly one frame, so without -loop 1 the downstream
    // trim=duration=${layerDuration} step below would starve after that single frame instead of
    // holding it for the whole [t, t+duration) window (same technique as plan.mjs's chroma_key
    // background image input).
    const isImageSource = isImageLayerSource(resolvedSource);
    inputArgs.push(
      ...(isNormal ? ["-itsoffset", formatNumber(t)] : []),
      ...(isImageSource ? ["-loop", "1"] : []),
      // Input option, so it must sit between the previous input and this layer's own `-i`.
      ...resolveDecoderForLayer(ffprobeCommand, resolvedSource, warnings),
      "-i",
      resolvedSource,
    );

    // contract-2026-08-09-transform-keyframes-v0.md: layers[].keyframes overrides the layer's own
    // static transform/crop/perspective for whichever of those categories at least one keyframe
    // point declares (matches cuts[].framing's "keyframes win over the static field" rule).
    // hasUsableLayerKeyframes gates this whole block so a keyframe-less layer -- still the
    // overwhelming majority of layers -- runs the exact pre-existing static code below unchanged
    // (byte-identical output, zero regression risk).
    const keyframed = hasUsableLayerKeyframes(layer);
    // See layer-keyframes.mjs's own header comment: the "normal" blend path below never rebases
    // via setpts=PTS-STARTPTS, so ffmpeg's own `t` inside this layer's filter chain is absolute
    // base-timeline seconds ([t, t+layerDuration]); the non-normal (blend-mode) path does rebase,
    // so `t` there is already layer-local. keyframes[].t is layer-local (contract), so the
    // "normal" path must subtract the layer's own start -- __keyframeClockOriginT (set only on
    // expandLayerForPerspectiveKeyframes' synthetic sub-layers, see that function's own comment)
    // is the *original* layer's own start, which no longer equals this (possibly time-shifted)
    // sub-layer's own `t`; ordinary layers never set it, so `?? t` keeps them unaffected.
    const keyframeClockOriginT = Number(layer.__keyframeClockOriginT ?? t) || 0;
    const localTExpr = isNormal ? `(t-${formatNumber(keyframeClockOriginT)})` : "t";
    const transformKeyframes = keyframed ? layerTransformKeyframeExprs(layer, localTExpr) : null;
    const xExpr = transformKeyframes ? transformKeyframes.xExpr : formatNumber(Number(transform.x ?? 0) || 0);
    const yExpr = transformKeyframes ? transformKeyframes.yExpr : formatNumber(Number(transform.y ?? 0) || 0);

    // layers[].keyframes[].crop / a genuinely time-varying rotate both need the layer source's own
    // native pixel size (see layer-keyframes.mjs's layerCropKeyframeSteps / the rotate bounding-box
    // comment below) -- probed once, only when actually needed, so keyframe-less layers and layers
    // that only animate x/y/scale never pay for it.
    const cropKeyframeDeclared = keyframed
      && Array.isArray(layer.keyframes)
      && layer.keyframes.some((point) => point && typeof point === "object" && point.crop);
    const rotateVaries = Boolean(transformKeyframes?.rotateVaries);
    const sourceSize = (cropKeyframeDeclared || rotateVaries)
      ? probeLayerSourceSize(ffprobeCommand, resolvedSource)
      : null;
    if ((cropKeyframeDeclared || rotateVaries) && !sourceSize) {
      warnings.push(
        `layer ${layer.id ?? index} declares keyframed crop and/or a time-varying rotate, but its`
          + ` source size could not be probed (ffprobe failed on ${resolvedSource}); those`
          + " keyframes will not be applied.",
      );
    }
    // Folds *any* additional scale factor -- transform's own keyframed scale if animated,
    // otherwise the layer's plain static transform.scale if not 1 -- into crop's final
    // scale-down step, instead of emitting a second, separate `scale=` filter afterwards. Not an
    // optimization: verified empirically that a scale filter reading `iw`/`ih` from an upstream
    // *animated* (variable-size) scale silently gets a stale, frame-0-only size -- and this
    // applies whether the downstream scale is itself static or eval=frame, since the staleness is
    // in what `iw`/`ih` resolve to, not in how often that (frozen) value gets re-read. So any
    // scale step that would otherwise sit right after cropKeyframeSteps' own final scale must be
    // folded into it instead.
    const extraScaleExpr = transformKeyframes ? transformKeyframes.scaleExpr : (scale !== 1 ? formatNumber(scale) : null);
    const cropKeyframeSteps = sourceSize
      ? layerCropKeyframeSteps(layer, localTExpr, sourceSize.width, sourceSize.height, extraScaleExpr)
      : null;
    const cropScaleFolded = Boolean(cropKeyframeSteps && extraScaleExpr);

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
    if (cropKeyframeSteps) {
      steps.push(...cropKeyframeSteps);
    } else if (crop) {
      const cropW = clamp(Number(crop.w) || 1, EPSILON, 1);
      const cropH = clamp(Number(crop.h) || 1, EPSILON, 1);
      const cropX = clamp(Number(crop.x) || 0, 0, 1 - cropW);
      const cropY = clamp(Number(crop.y) || 0, 0, 1 - cropH);
      steps.push(
        `crop=trunc(iw*${formatNumber(cropW)}/2)*2:trunc(ih*${formatNumber(cropH)}/2)*2:trunc(iw*${formatNumber(cropX)}/2)*2:trunc(ih*${formatNumber(cropY)}/2)*2`,
      );
    }
    if (cropScaleFolded) {
      // Already applied as part of cropKeyframeSteps' own final scale-down step above.
    } else if (transformKeyframes) {
      steps.push(
        `scale=w='trunc(iw*(${transformKeyframes.scaleExpr}))':h='trunc(ih*(${transformKeyframes.scaleExpr}))':eval=frame`,
      );
    } else if (scale !== 1) {
      steps.push(`scale=trunc(iw*${formatNumber(scale)}):trunc(ih*${formatNumber(scale)})`);
    }
    // contract-2026-08-02-preview-parity.md §2.4.4: layers[].perspective applies after scale and
    // before rotate (crop → scale → perspective → rotate → opacity → overlay). ffmpeg's
    // `perspective` filter's x0..y3 always describe where the INPUT FRAME'S OWN 4 corners land in
    // the output -- not an inner content rectangle's corners -- so reproducing a corner-pin
    // declared against the layer's own (post crop+scale) box requires first padding the frame
    // (transparent) and then feeding perspective the *padded frame's* corner positions under the
    // same homography (computePerspectiveFfmpegCorners does this derivation; see that module for
    // why padding is required for the outside-the-trapezoid area to render transparent rather than
    // edge-clamped opaque content). The padding is removed again by the trailing crop= so the
    // stream handed to rotate/opacity/overlay is exactly the same iw/ih it would have been without
    // perspective (their pivot/placement math is therefore unaffected by this stage). Note:
    // layers[].keyframes[].perspective never reaches this static branch directly -- a layer that
    // declares it was already expanded (above, expandLayerForPerspectiveKeyframes) into several
    // synthetic sub-layers, each with its own plain static `perspective`, specifically so this
    // exact static code runs for them unmodified (see that function's own header comment for why
    // ffmpeg's perspective filter cannot be driven by a per-frame expression at all).
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
    // rotate's own `angle` option supports per-frame `t` natively, but -- like crop's w/h -- its
    // `ow`/`oh` output-size expressions are evaluated once, at init (verified empirically:
    // `oh=roth(t*...)` fails with "invalid expression ... or non-positive or indefinite value
    // nan"), and even a *constant* angle's `ow=rotw(angle):oh=roth(angle)` reads `iw`/`ih` only
    // once, so it silently freezes at frame 0's size if fed from a genuinely variable-size
    // upstream (i.e. this layer's own crop is keyframed -- transform.scale can't cause this on
    // its own since it is always folded into cropKeyframeSteps' own final step, never left as a
    // separate downstream scale). `cropVaries` below gates the fixed bounding-square sizing onto
    // *both* cases that need it: a genuinely time-varying rotate angle, or a constant angle
    // sitting downstream of a keyframed crop.
    const cropVaries = Boolean(cropKeyframeSteps);
    const rotateConstant = transformKeyframes ? (rotateVaries ? null : transformKeyframes.rotateMin) : rotate;
    if (rotateConstant !== 0 && (rotateVaries || cropVaries) && !sourceSize) {
      // Probe failed (already warned above) -- skip the rotate step entirely rather than risk a
      // wrongly-sized/clipped rotation built on an unknown box size.
    } else if (rotateConstant !== 0 && (rotateVaries || cropVaries)) {
      // Sizes the output to a fixed square big enough to contain the box at *any* angle (the
      // diagonal bound sqrt(boxW^2+boxH^2), generously widened to sqrt(2)*max(boxW,boxH) and
      // computed from the probed *native* source size times the largest scale this layer's
      // keyframes ever reach -- ignoring any shrinking effect of an animated crop, i.e.
      // deliberately generous rather than tight, since the only cost of an oversized bound is
      // extra transparent padding, not a correctness risk). overlay's own eval=frame (its
      // default) re-centers this fixed-size, mostly-transparent box every frame exactly like it
      // already does for the static case, so the visible (rotated) content stays correctly
      // centered regardless of the extra padding.
      const scaleMax = transformKeyframes ? transformKeyframes.scaleMax : scale;
      const boundSide = Math.ceil((Math.sqrt(2) * Math.max(sourceSize.width, sourceSize.height) * scaleMax) / 2) * 2;
      const radiansExpr = transformKeyframes ? `((${transformKeyframes.rotateExpr})*PI/180)` : `(${formatNumber(rotate)}*PI/180)`;
      steps.push(`rotate=${radiansExpr}:fillcolor=black@0:ow=${boundSide}:oh=${boundSide}`);
    } else if (rotateConstant !== 0) {
      // No upstream size variability to worry about -- keeps the cheap static-style rotw/roth
      // sizing (byte-identical to the pre-keyframes code when !transformKeyframes).
      const radians = `(${formatNumber(rotateConstant)}*PI/180)`;
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
        `${previous}${processed}overlay=x=(main_w-overlay_w)/2+${xExpr}:y=(main_h-overlay_h)/2+${yExpr}:format=auto:enable='between(t,${formatNumber(t)},${formatNumber(end)})'${next}`,
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
      `${processed}pad=${width}:${height}:x=(ow-iw)/2+${xExpr}:y=(oh-ih)/2+${yExpr}:color=black@0${canvas}`,
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
    warnings,
  };
}

function formatNumber(value) {
  return Number(value).toString();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
