// docs/contract-2026-07-22-render-basics.md #7 (cuts[].freeze). Freezes the frame at a
// cut-local timestamp (post-speed) for a fixed duration, then resumes playback of the
// remainder of the cut. The frozen hold is *extra* time -- it never truncates content -- so
// the cut's own segment duration grows by freeze.duration_sec (see segmentDuration in
// cut-timeline.mjs, which is the single place this extension is applied to downstream
// timeline math: predictedDuration / xfade offsets / gap-aware placement all inherit it for
// free). Audio decision (residual decision, this task): the frozen span gets **silence
// inserted**, not a held/looped audio sample -- looping raw PCM produces an audible click at
// the loop seam, while silence is deterministic and glitch-free. Narration/BGM/SFX are timed
// on the output timeline independently of this per-cut source audio and are not shifted here
// (same precedent as cuts[].speed, which also does not auto-shift them).

const EPSILON = 1e-6;

export function freezeDurationSeconds(freeze) {
  const value = freeze?.duration_sec;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function freezeAtSeconds(freeze) {
  const value = freeze?.at_sec;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function hasCutFreeze(cuts) {
  return Array.isArray(cuts) && cuts.some((cut) =>
    cut && typeof cut === "object" && freezeDurationSeconds(cut.freeze) > 0 && freezeAtSeconds(cut.freeze) !== null,
  );
}

// Splits a cut's [sourceIn, sourceOut) trim into the freeze point, expressed in *source* time
// (accounting for the speed factor already dividing the played-out duration). Returns null
// when the cut has no usable freeze declaration.
function resolveFreezeSplit({ freeze, sourceIn, sourceOut, speed }) {
  const hold = freezeDurationSeconds(freeze);
  const at = freezeAtSeconds(freeze);
  if (hold <= 0 || at === null) return null;
  const base = (sourceOut - sourceIn) / speed;
  const clampedAt = Math.min(Math.max(at, 0), base);
  const freezeSourceIn = sourceIn + clampedAt * speed;
  const mode = clampedAt <= EPSILON ? "start" : clampedAt >= base - EPSILON ? "end" : "middle";
  return { freezeSourceIn, hold, mode };
}

// Appends the trim(+freeze-hold) filter chain for one cut's video onto `filters`, ending at
// `outputLabel`. `postSuffixFilter`, when given (e.g. "settb=AVTB"), is applied as the final
// step so callers that need a timebase normalizer keep byte-identical single-line output in
// the (overwhelmingly common) no-freeze case.
//
// `fps` is only used for the "freeze at the very start of the cut" branch (see below) -- every
// other branch is duration-based and does not need it.
export function appendFreezeAwareVideoTrim({
  filters,
  inputLabel,
  outputLabel,
  sourceIn,
  sourceOut,
  speed,
  freeze,
  id,
  fps,
  postSuffixFilter = "",
}) {
  const ptsExpr = speed === 1 ? "PTS-STARTPTS" : `(PTS-STARTPTS)/${formatNumber(speed)}`;
  const split = resolveFreezeSplit({ freeze, sourceIn, sourceOut, speed });
  if (!split) {
    const suffix = postSuffixFilter ? `,${postSuffixFilter}` : "";
    filters.push(`${inputLabel}trim=start=${formatNumber(sourceIn)}:end=${formatNumber(sourceOut)},setpts=${ptsExpr}${suffix}${outputLabel}`);
    return;
  }
  const finalLabel = postSuffixFilter ? `[fz_${id}_pre_tb]` : outputLabel;
  if (split.mode === "start") {
    // tpad's `start_mode=clone` has an empirically-verified bug on this ffmpeg build: any `fps`
    // filter downstream of it (however many steps later) silently drops the segment's very last
    // frame. `stop_mode=clone` does not have this problem. So instead of padding at the start,
    // this pulls a 1-frame seed out of the (already time-rebased) whole segment via a
    // frame-index trim -- exact regardless of the segment's frame rate -- pads *that* seed at
    // its stop with `stop_mode=clone`, and concats it in front of the untouched whole segment.
    // `stop` (an integer clone-frame count, not `stop_duration`) is used so the total held span
    // is an exact frame count instead of depending on sub-frame duration rounding.
    const holdFrames = Math.max(1, Math.round(split.hold * fps));
    const whole = `[fzv_${id}_whole]`;
    const wholeSeed = `[fzv_${id}_seed]`;
    const wholeRest = `[fzv_${id}_rest]`;
    const seedHeld = `[fzv_${id}_seedheld]`;
    filters.push(`${inputLabel}trim=start=${formatNumber(sourceIn)}:end=${formatNumber(sourceOut)},setpts=${ptsExpr}${whole}`);
    filters.push(`${whole}split=2${wholeSeed}${wholeRest}`);
    filters.push(`${wholeSeed}trim=start_frame=0:end_frame=1,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop=${holdFrames - 1}${seedHeld}`);
    filters.push(`${seedHeld}${wholeRest}concat=n=2:v=1:a=0${finalLabel}`);
  } else if (split.mode === "end") {
    filters.push(
      `${inputLabel}trim=start=${formatNumber(sourceIn)}:end=${formatNumber(sourceOut)},setpts=${ptsExpr},tpad=stop_mode=clone:stop_duration=${formatNumber(split.hold)}${finalLabel}`,
    );
  } else {
    const partA = `[fzv_${id}_a]`;
    const partAHeld = `[fzv_${id}_ah]`;
    const partB = `[fzv_${id}_b]`;
    filters.push(`${inputLabel}trim=start=${formatNumber(sourceIn)}:end=${formatNumber(split.freezeSourceIn)},setpts=${ptsExpr}${partA}`);
    filters.push(`${partA}tpad=stop_mode=clone:stop_duration=${formatNumber(split.hold)}${partAHeld}`);
    filters.push(`${inputLabel}trim=start=${formatNumber(split.freezeSourceIn)}:end=${formatNumber(sourceOut)},setpts=${ptsExpr}${partB}`);
    filters.push(`${partAHeld}${partB}concat=n=2:v=1:a=0${finalLabel}`);
  }
  if (postSuffixFilter) {
    filters.push(`${finalLabel}${postSuffixFilter}${outputLabel}`);
  }
}

// Audio counterpart: inserts silence (anullsrc) for the frozen span instead of the source's
// own audio, keeping the cut's audio content in sync with the (now longer) video.
//
// `normalize` controls only the NO-freeze fallback line's format: it exists so this shared
// helper can reproduce each of the three call sites' pre-existing byte-identical behavior when
// freeze is absent (buildMultiSourceCutCommand already unconditionally resamples to
// 48k/stereo; the historical single-source paths did not). Whenever freeze *is* present,
// the resample+format step is applied unconditionally regardless of `normalize` -- concat-ing
// real audio with anullsrc-generated silence needs a matching sample format on both sides, and
// that requirement doesn't depend on which call site is asking.
export function appendFreezeAwareAudioTrim({
  filters,
  inputLabel,
  outputLabel,
  sourceIn,
  sourceOut,
  speed,
  atempoSuffix = "",
  freeze,
  id,
  normalize = false,
  padToSeconds,
}) {
  const padSuffix = padToSeconds === undefined
    ? ""
    : `,apad=whole_dur=${formatNumber(padToSeconds)}`;
  const split = resolveFreezeSplit({ freeze, sourceIn, sourceOut, speed });
  if (!split) {
    const noFreezeSuffix = normalize ? ",aresample=48000,aformat=channel_layouts=stereo" : "";
    filters.push(`${inputLabel}atrim=start=${formatNumber(sourceIn)}:end=${formatNumber(sourceOut)},asetpts=PTS-STARTPTS${atempoSuffix}${noFreezeSuffix}${padSuffix}${outputLabel}`);
    return;
  }
  const freezeSuffix = ",aresample=48000,aformat=channel_layouts=stereo";
  const silence = `[fza_${id}_silence]`;
  const buildSilence = () => filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${formatNumber(split.hold)},asetpts=PTS-STARTPTS${silence}`);
  if (split.mode === "start") {
    buildSilence();
    const rest = `[fza_${id}_rest]`;
    filters.push(`${inputLabel}atrim=start=${formatNumber(sourceIn)}:end=${formatNumber(sourceOut)},asetpts=PTS-STARTPTS${atempoSuffix}${freezeSuffix}${rest}`);
    filters.push(`${silence}${rest}concat=n=2:v=0:a=1${padSuffix}${outputLabel}`);
  } else if (split.mode === "end") {
    const rest = `[fza_${id}_rest]`;
    filters.push(`${inputLabel}atrim=start=${formatNumber(sourceIn)}:end=${formatNumber(sourceOut)},asetpts=PTS-STARTPTS${atempoSuffix}${freezeSuffix}${rest}`);
    buildSilence();
    filters.push(`${rest}${silence}concat=n=2:v=0:a=1${padSuffix}${outputLabel}`);
  } else {
    buildSilence();
    const partA = `[fza_${id}_a]`;
    const partB = `[fza_${id}_b]`;
    filters.push(`${inputLabel}atrim=start=${formatNumber(sourceIn)}:end=${formatNumber(split.freezeSourceIn)},asetpts=PTS-STARTPTS${atempoSuffix}${freezeSuffix}${partA}`);
    filters.push(`${inputLabel}atrim=start=${formatNumber(split.freezeSourceIn)}:end=${formatNumber(sourceOut)},asetpts=PTS-STARTPTS${atempoSuffix}${freezeSuffix}${partB}`);
    filters.push(`${partA}${silence}${partB}concat=n=3:v=0:a=1${padSuffix}${outputLabel}`);
  }
}

// Input-seeked audio discards its preroll, so filter timestamps use cut-relative time plus
// preroll. Keep the legacy helper above source-relative and adapt only the audio-only path here.
export function appendFreezeAwareRelativeAudioTrim({
  sourceIn,
  sourceOut,
  preroll = 0,
  filters,
  inputLabel,
  outputLabel,
  atempoSuffix = "",
  normalize = false,
  padToSeconds,
  ...options
}) {
  if (!Number.isFinite(sourceOut)) {
    const normalizeSuffix = normalize ? ",aresample=48000,aformat=channel_layouts=stereo" : "";
    const padSuffix = padToSeconds === undefined
      ? ""
      : `,apad=whole_dur=${formatNumber(padToSeconds)}`;
    filters.push(
      `${inputLabel}atrim=start=${formatNumber(preroll)},asetpts=PTS-STARTPTS${atempoSuffix}${normalizeSuffix}${padSuffix}${outputLabel}`,
    );
    return;
  }
  const relativeSourceOut = preroll + (sourceOut - sourceIn);
  appendFreezeAwareAudioTrim({
    ...options,
    filters,
    inputLabel,
    outputLabel,
    sourceIn: preroll,
    sourceOut: relativeSourceOut,
    atempoSuffix,
    normalize,
    padToSeconds,
  });
}

function formatNumber(value) {
  return Number(Number(value).toFixed(6)).toString();
}
