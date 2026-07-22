import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildLayersCompositeCommand, hasLayers } from "./layers.mjs";

// docs/contract-2026-07-14-edit-json-v1-audio.md §4: sidechaincompress threshold ~-24dB (linear 0.063), ratio 8, attack 5ms, release 300ms.
const DUCKING_SIDECHAIN_ARGS = "threshold=0.063:ratio=8:attack=5:release=300";
// docs/contract-2026-07-20-edit-json-v1-narration.md §1: gain_db clamp range, shared with bgm/sfx.
const GAIN_DB_MIN = -60;
const GAIN_DB_MAX = 12;
// catalog/luts/<id>/<id>.cube — packages/render-cut/src/../../.. is the monorepo root, sibling to
// catalog/ (see catalog/luts/INDEX.md for the bare-name catalog reference convention).
const CATALOG_LUTS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "catalog", "luts");

export function buildPlan({
  edit,
  projectRoot,
  outputPath,
  capabilities,
  hasSourceAudio,
  renderOverlays = edit.overlays,
  hasThreeDimensionalOverlay = false,
  // Execution-unique subdirectory for intermediates (see render-cut.mjs's per-run isolation).
  // Defaults to the flat, deterministic path so direct callers (unit tests, --plan-only preview)
  // keep producing byte-identical command plans across repeated calls.
  temporaryDirectory = join(projectRoot, ".akari", "render-tmp"),
}) {
  const width = edit.output.width;
  const height = edit.output.height;
  const fps = edit.output.fps;
  const duration = predictedDuration(edit.cuts, capabilities.sourceDuration);
  const temporary = temporaryDirectory;
  const cutPath = join(temporary, "cut.mp4");
  const layeredPath = join(temporary, "layered.mp4");
  const overlayWebmPath = join(temporary, "overlay.webm");
  const overlayMovPath = join(temporary, "overlay.mov");
  const compositePath = join(temporary, "composite.mp4");
  const finalPath = join(temporary, "final.mp4");
  const sheetPath = join(temporary, "overlay-sheet.html");
  const sourcePath = resolve(projectRoot, edit.source.path);
  const rasterizer = selectRasterizer(capabilities, hasThreeDimensionalOverlay);
  const cut = buildCutCommand({
    sourcePath,
    cutPath,
    cuts: edit.cuts,
    width,
    height,
    fps,
    hasAudio: hasSourceAudio,
    duration,
    ffmpegCommand: capabilities.ffmpegCommand,
    projectRoot,
    look: edit.output.look,
    chromaKey: edit.source?.chroma_key,
  });
  // layers[] is additive-only (contract-2026-07-22-prerender-rail-and-assets.md §1.2): an edit.json
  // without it produces no `layers` command and render-cut.mjs skips this stage entirely, so
  // existing projects keep their byte-identical cut.mp4 -> composite pipeline (zero regression).
  const layers = hasLayers(edit)
    ? buildLayersCompositeCommand({
        layers: edit.layers,
        projectRoot,
        ffmpegCommand: capabilities.ffmpegCommand,
        inputPath: cutPath,
        outputPath: layeredPath,
        duration,
        width,
        height,
      })
    : null;

  return {
    predicted_duration_seconds: duration,
    duration_tolerance_seconds: Math.max(0.1, 2 / fps),
    output: relativeOrAbsolute(projectRoot, outputPath),
    preset: {
      video_codec: "h264",
      profile: "high",
      pixel_format: "yuv420p",
      audio_codec: "aac",
      width,
      height,
      fps,
    },
    rasterizer: {
      selected: rasterizer,
      // 3D scenes cannot degrade to a still image: execution rejects HyperFrames and requires
      // puppeteer-core, while ordinary overlays follow this same full fallback order.
      order: hasThreeDimensionalOverlay
        ? ["puppeteer-core"]
        : ["hyperframes", "puppeteer-core", "static-screenshot"],
    },
    intermediates: [
      cutPath,
      ...(layers ? [layeredPath] : []),
      sheetPath,
      overlayWebmPath,
      overlayMovPath,
      join(temporary, "frames", "frame-%08d.png"),
      ...renderOverlays.flatMap((_, index) => {
        const stem = `static-${String(index + 1).padStart(4, "0")}`;
        return [join(temporary, `${stem}.html`), join(temporary, `${stem}.png`)];
      }),
      compositePath,
      finalPath,
    ].map((value) => relative(projectRoot, value)),
    commands: {
      cut,
      rasterize: {
        hyperframes: {
          command: localBinary(projectRoot, "hyperframes"),
          cwd: projectRoot,
          env: {
            HYPERFRAMES_BROWSER_PATH: capabilities.chromePath,
            DO_NOT_TRACK: "1",
          },
          args: [
            "render",
            ".",
            "--composition",
            relative(projectRoot, sheetPath),
            "--format",
            "webm",
            "--fps",
            String(fps),
            "--workers",
            "1",
            "--no-browser-gpu",
            "--no-best-effort",
            "-o",
            relative(projectRoot, overlayWebmPath),
          ],
        },
        "puppeteer-core": {
          operation: "capture-transparent-png-sequence",
          driver: "puppeteer-core",
          input: relative(projectRoot, sheetPath),
          output_pattern: relative(projectRoot, join(temporary, "frames", "frame-%08d.png")),
        },
        "static-screenshot": {
          operation: "capture-one-transparent-png-per-overlay",
          driver: capabilities.chromePath ?? "chrome",
          outputs: renderOverlays.map((_, index) =>
            relative(projectRoot, join(temporary, `static-${String(index + 1).padStart(4, "0")}.png`)),
          ),
        },
      },
      composite: {
        hyperframes: buildAnimatedCompositeCommand(
          capabilities.ffmpegCommand,
          layers ? layeredPath : cutPath,
          overlayWebmPath,
          compositePath,
        ),
        "puppeteer-core": buildAnimatedCompositeCommand(
          capabilities.ffmpegCommand,
          layers ? layeredPath : cutPath,
          overlayMovPath,
          compositePath,
        ),
        "static-screenshot": buildStaticCompositeCommand(
          capabilities.ffmpegCommand,
          layers ? layeredPath : cutPath,
          compositePath,
          temporary,
          renderOverlays,
          duration,
        ),
      },
      layers,
      audio_mix: buildAudioMixCommand({
        edit,
        projectRoot,
        inputPath: compositePath,
        outputPath: finalPath,
        duration,
        ffmpegCommand: capabilities.ffmpegCommand,
        ffprobeCommand: capabilities.ffprobeCommand,
      }),
      verify: {
        command: capabilities.ffprobeCommand,
        args: ["-v", "error", "-show_streams", "-show_format", "-of", "json", relativeOrAbsolute(projectRoot, outputPath)],
      },
    },
  };
}

export function buildAudioMixCommand({
  edit,
  projectRoot,
  inputPath,
  outputPath,
  duration,
  ffmpegCommand = "ffmpeg",
  ffprobeCommand = "ffprobe",
}) {
  const audio = normalizeAudioPlan(edit.audio);
  const { tracks: narrationTracks, warnings } = resolveNarrationTracks({
    narration: edit.audio?.narration,
    projectRoot,
    duration,
    ffprobeCommand,
  });
  const hasNarration = narrationTracks.length > 0;
  const master = normalizeMasterPlan(edit.audio?.master);

  if (!audio.bgm && audio.sfx.length === 0 && !hasNarration && !master) {
    return { operation: "copy", input: inputPath, output: outputPath, warnings, hasNarration };
  }

  const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", inputPath];
  const labels = ["[0:a]"];
  const filters = [];
  let inputIndex = 1;

  // Build the narration track(s) first so the merged [narration] label exists before bgm decides
  // whether to route ducking's sidechain input through it (contract-2026-07-20 §3).
  let narrationLabel = null;
  if (hasNarration) {
    const rawLabels = [];
    for (const [index, track] of narrationTracks.entries()) {
      args.push("-i", track.path);
      const delay = Math.max(0, Math.round(track.t * 1000));
      const rawLabel = `nar_raw${index}`;
      filters.push(
        `[${inputIndex}:a]volume=${formatNumber(track.gain_db)}dB,adelay=${delay}:all=1[${rawLabel}]`,
      );
      rawLabels.push(`[${rawLabel}]`);
      inputIndex += 1;
    }
    // Pad to the full timeline duration so a short narration track never truncates a downstream
    // sidechaincompress (which otherwise ends at the shorter of its two inputs).
    if (rawLabels.length === 1) {
      filters.push(`${rawLabels[0]}apad=whole_dur=${formatNumber(duration)}[narration]`);
    } else {
      filters.push(
        `${rawLabels.join("")}amix=inputs=${rawLabels.length}:duration=longest:normalize=0,apad=whole_dur=${formatNumber(duration)}[narration]`,
      );
    }
    narrationLabel = "[narration]";
  }

  let bgmLabel = null;
  if (audio.bgm) {
    args.push("-stream_loop", "-1", "-i", resolve(projectRoot, audio.bgm.path));
    const bgmFade = resolveBgmFadeSeconds(audio.bgm, duration);
    warnings.push(...bgmFade.warnings);
    // afade is chained directly onto volume/atrim -- i.e. baked into the [bgm] label itself --
    // rather than appended after ducking's sidechaincompress step below. Empirically verified
    // (audio-bgm-fade.test.mjs "order" case): sidechaincompress's gain reduction is driven only by
    // the narration (key/sidechain) input's level, never by bgm's own amplitude, so multiplying in
    // the fade envelope before or after ducking is mathematically commutative and measures
    // identically either way. Applying it here keeps the fade envelope visible on every downstream
    // consumer of [bgm]/[bgm_ducked] without a second branch, and matches the reserved-seat design
    // note ("afade を volume の後").
    filters.push(
      `[${inputIndex}:a]volume=${formatNumber(audio.bgm.gain_db ?? 0)}dB,atrim=duration=${formatNumber(duration)}${buildBgmFadeSuffix(bgmFade, duration)}[bgm]`,
    );
    bgmLabel = "[bgm]";
    inputIndex += 1;

    if (audio.bgm.ducking === true && narrationLabel) {
      // [narration] would otherwise be referenced twice (once as sidechaincompress's key input,
      // once as the final amix's input). ffmpeg's filtergraph requires each labeled pad to be
      // consumed exactly once; a second reference is accepted without error but left unconnected
      // (ffmpeg 8.1.1), silently dropping narration from the output. asplit fans it out into two
      // independent copies, one per consumer.
      filters.push(`${narrationLabel}asplit=2[nar_sc][nar_mix]`);
      filters.push(`[bgm][nar_sc]sidechaincompress=${DUCKING_SIDECHAIN_ARGS}[bgm_ducked]`);
      bgmLabel = "[bgm_ducked]";
      narrationLabel = "[nar_mix]";
    }
    labels.push(bgmLabel);
  }
  for (const [index, sfx] of audio.sfx.entries()) {
    args.push("-i", resolve(projectRoot, sfx.path));
    const delay = Math.max(0, Math.round((sfx.t ?? 0) * 1000));
    filters.push(
      `[${inputIndex}:a]volume=${formatNumber(sfx.gain_db ?? 0)}dB,adelay=${delay}:all=1[sfx${index}]`,
    );
    labels.push(`[sfx${index}]`);
    inputIndex += 1;
  }
  if (narrationLabel) labels.push(narrationLabel);

  filters.push(`${labels.join("")}amix=inputs=${labels.length}:duration=first:normalize=0[mixed]`);

  // docs/contract-2026-07-22-render-basics.md #5: master processing (denoise / loudnorm) runs on
  // the fully mixed bus, after bgm/sfx/narration/ducking are combined — it is a mastering step, not
  // a per-track one. 1-pass loudnorm is accepted for v0 (contract explicitly allows it over 2-pass).
  let finalLabel = "[mixed]";
  if (master) {
    if (master.denoise !== "off") {
      const nr = master.denoise === "strong" ? 24 : 12;
      // afftdn's default noise_floor (-50dB) assumes near-silent background hiss and barely
      // engages against realistically-proportioned recording noise (measured empirically: a
      // -47dB noise floor under a normal-level dialogue tone saw <1.5dB reduction at the
      // default nf). nf=-30 (near the top of ffmpeg's -80..-20 range) makes both std and strong
      // measurably and monotonically effective against typical background noise levels.
      filters.push(`${finalLabel}afftdn=nr=${nr}:nf=-30[master_dn]`);
      finalLabel = "[master_dn]";
    }
    filters.push(`${finalLabel}loudnorm=I=${formatNumber(master.loudnormTarget)}:TP=-1.5:LRA=11[master_ln]`);
    finalLabel = "[master_ln]";
  }

  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "0:v:0",
    "-map",
    finalLabel,
    "-t",
    formatNumber(duration),
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-ar",
    "48000",
    outputPath,
  );
  return { operation: "ffmpeg", command: ffmpegCommand, args, warnings, hasNarration };
}

// docs/contract-2026-07-22-render-basics.md #5: denoise has an explicit off value; loudnorm does
// not, so once the master object is present at all, loudness normalization is on by default at
// -14 LUFS unless overridden (command-center judgment call, documented in edit.schema.json's
// $defs/audioMaster $comment).
function normalizeMasterPlan(master) {
  if (!master || typeof master !== "object") return null;
  const denoise = ["off", "std", "strong"].includes(master.denoise) ? master.denoise : "off";
  const rawTarget = master.loudnorm;
  const loudnormTarget = typeof rawTarget === "number" && Number.isFinite(rawTarget) ? rawTarget : -14;
  return { denoise, loudnormTarget };
}

// docs/contract-2026-07-20-edit-json-v1-narration.md §4: resolve each narration element against the
// filesystem and its declared values, skipping (with a warning) whatever cannot be rendered safely
// instead of failing the whole export. Runs during planning so the resulting command is deterministic
// for a fixed filesystem/edit.json pair.
function resolveNarrationTracks({ narration, projectRoot, duration, ffprobeCommand }) {
  const warnings = [];
  const tracks = [];
  if (!Array.isArray(narration)) return { tracks, warnings };

  for (const raw of narration) {
    const item = raw && typeof raw === "object" ? raw : {};
    const id = typeof item.id === "string" && item.id !== "" ? item.id : "narration";
    const path = typeof item.path === "string" && item.path !== "" ? item.path : null;
    if (!path) {
      warnings.push(`narration ${id}: path is missing; skipped`);
      continue;
    }
    const resolvedPath = resolve(projectRoot, path);
    if (!existsSync(resolvedPath)) {
      warnings.push(`narration ${id}: file not found at ${path}; skipped`);
      continue;
    }
    if (!isReadableAudioFile(ffprobeCommand, resolvedPath)) {
      warnings.push(`narration ${id}: file could not be decoded as audio at ${path}; skipped`);
      continue;
    }
    const t = Number(item.t);
    if (!Number.isFinite(t) || t < 0) {
      warnings.push(`narration ${id}: t is not a finite non-negative number (${item.t}); skipped`);
      continue;
    }
    if (Number.isFinite(duration) && t >= duration) {
      warnings.push(`narration ${id}: t (${t}s) is at or beyond the timeline duration (${duration}s); skipped`);
      continue;
    }
    const rawGain = item.gain_db === undefined ? 0 : Number(item.gain_db);
    if (!Number.isFinite(rawGain)) {
      warnings.push(`narration ${id}: gain_db is not a finite number (${item.gain_db}); skipped`);
      continue;
    }
    const gain_db = Math.min(GAIN_DB_MAX, Math.max(GAIN_DB_MIN, rawGain));
    if (gain_db !== rawGain) {
      warnings.push(`narration ${id}: gain_db ${rawGain} clamped to ${gain_db}`);
    }
    tracks.push({ id, path: resolvedPath, t, gain_db });
  }
  return { tracks, warnings };
}

function isReadableAudioFile(ffprobeCommand, path) {
  const result = spawnSync(
    ffprobeCommand,
    ["-v", "error", "-show_entries", "stream=codec_type", "-of", "json", path],
    { encoding: "utf8" },
  );
  if (result.error || result.status !== 0) return false;
  try {
    const parsed = JSON.parse(result.stdout);
    return Array.isArray(parsed.streams) && parsed.streams.some((stream) => stream.codec_type === "audio");
  } catch {
    return false;
  }
}

function buildAnimatedCompositeCommand(command, cutPath, overlayPath, outputPath) {
  return {
    command,
    args: [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-y",
      "-i",
      cutPath,
      "-i",
      overlayPath,
      "-filter_complex",
      "[0:v][1:v]overlay=0:0:format=auto:shortest=1[outv]",
      "-map",
      "[outv]",
      "-map",
      "0:a:0",
      "-c:v",
      "libx264",
      "-profile:v",
      "high",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "copy",
      outputPath,
    ],
  };
}

function buildStaticCompositeCommand(command, cutPath, outputPath, temporary, overlays, duration) {
  const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", cutPath];
  const filters = [];
  let previous = "[0:v]";
  for (const [index, overlay] of overlays.entries()) {
    const png = join(temporary, `static-${String(index + 1).padStart(4, "0")}.png`);
    args.push("-loop", "1", "-i", png);
    const next = `[overlay${index}]`;
    filters.push(
      `${previous}[${index + 1}:v]overlay=0:0:format=auto:enable='between(t,${formatNumber(overlay.start)},${formatNumber(overlay.start + overlay.duration)})'${next}`,
    );
    previous = next;
  }
  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    previous,
    "-map",
    "0:a:0",
    "-t",
    formatNumber(duration),
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "copy",
    outputPath,
  );
  return { command, args };
}

// docs/contract-2026-07-22-render-basics.md #4: "lut(カタログ参照 or パス)" — a bare name (no
// path separator) resolves against catalog/luts/<name>/<name>.cube; anything else is treated as a
// path relative to the project root (same regel as source.path / audio.bgm.path elsewhere).
function resolveLutPath(projectRoot, lutRef) {
  if (!lutRef.includes("/") && !lutRef.includes("\\")) {
    return join(CATALOG_LUTS_ROOT, lutRef, `${lutRef}.cube`);
  }
  return resolve(projectRoot, lutRef);
}

// ffmpeg filter option values split on ':' and quote-related characters; escape both before
// wrapping the value in single quotes (lut3d's file= option; same convention as chromakey's color=).
function escapeFilterPath(path) {
  return path.replace(/\\/gu, "\\\\").replace(/:/gu, "\\:").replace(/'/gu, "\\'");
}

const CSS_COLOR_KEYWORDS = new Set([
  "black",
  "white",
  "red",
  "green",
  "blue",
  "yellow",
  "cyan",
  "magenta",
  "gray",
  "grey",
  "orange",
  "purple",
  "pink",
  "brown",
]);

function isColorLike(value) {
  return value.startsWith("#") || /^0x/iu.test(value) || CSS_COLOR_KEYWORDS.has(value.toLowerCase());
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function normalizeAudioPlan(audio) {
  if (!audio) return { bgm: null, sfx: [] };
  const normalize = (value) => (typeof value === "string" ? { path: value } : value);
  return {
    bgm: audio.bgm ? normalize(audio.bgm) : null,
    sfx: Array.isArray(audio.sfx) ? audio.sfx.map(normalize) : [],
  };
}

// audio.bgm.fadeIn/fadeOut clamp rule: the "clip" bgm occupies is the full timeline (it is
// stream_loop'd and atrim'd to `duration` above), so each of fadeIn/fadeOut is independently capped
// at duration/2 -- the standard NLE handle ceiling that guarantees a fade-in and a fade-out can
// never together exceed the full duration, regardless of the other one's value.
function resolveBgmFadeSeconds(bgm, duration) {
  const warnings = [];
  const ceiling = isFiniteNumber(duration) && duration > 0 ? duration / 2 : 0;
  const resolveField = (label) => {
    const raw = bgm[label];
    if (raw === undefined) return 0;
    if (!isFiniteNumber(raw) || raw < 0) return 0; // schema/edit-lint reject this; render tolerates it as "no fade".
    if (ceiling > 0 && raw > ceiling) {
      warnings.push(
        `audio.bgm.${label} ${formatNumber(raw)}s exceeds half the timeline duration (${formatNumber(duration)}s); clamped to ${formatNumber(ceiling)}s`,
      );
      return ceiling;
    }
    return raw;
  };
  return { fadeIn: resolveField("fadeIn"), fadeOut: resolveField("fadeOut"), warnings };
}

function buildBgmFadeSuffix({ fadeIn, fadeOut }, duration) {
  const parts = [];
  if (fadeIn > 0) parts.push(`afade=t=in:st=0:d=${formatNumber(fadeIn)}`);
  if (fadeOut > 0) {
    const start = Math.max(0, duration - fadeOut);
    parts.push(`afade=t=out:st=${formatNumber(start)}:d=${formatNumber(fadeOut)}`);
  }
  return parts.length > 0 ? `,${parts.join(",")}` : "";
}

export function buildCutCommand({
  sourcePath,
  cutPath,
  cuts,
  width,
  height,
  fps,
  hasAudio,
  duration,
  ffmpegCommand = "ffmpeg",
  projectRoot,
  look,
  chromaKey,
}) {
  const effectiveCuts = cuts.length > 0 ? cuts : [{ in: 0, out: null }];
  const filters = [];
  const concatInputs = [];
  // docs/contract-2026-07-22-render-basics.md #3 (cuts[].transition_out). Residual decision 3
  // (command-center ruling): v0 only takes the xfade path at cut boundaries that explicitly
  // specify transition_out; every other boundary keeps today's exact N-input concat call
  // untouched, so a project with zero transition_out is byte-for-byte unaffected.
  const hasAnyTransition = effectiveCuts
    .slice(0, -1)
    .some((cut) => cut.transition_out);
  // xfade/acrossfade require both of their inputs to share one timebase; concat's own output
  // timebase does not always match a fresh trim+setpts segment's (verified empirically: mixing
  // concat'd and freshly-trimmed segments into a later xfade failed with "do not match ...
  // timebase"). settb=AVTB standardizes every segment onto ffmpeg's default timebase before they
  // are ever joined, so it is only added on the transition-aware path (never touches the
  // non-regression concat-only path's exact filter string).
  const timebaseNormalizer = hasAnyTransition ? ",settb=AVTB" : "";
  for (const [index, cut] of effectiveCuts.entries()) {
    const end = cut.out === null ? "" : `:end=${formatNumber(cut.out)}`;
    // docs/contract-2026-07-22-render-basics.md #1 (cuts[].speed): v0 is constant speed only
    // (residual decision 1, command-center ruling: pitch preservation is fixed, not optional).
    // setpts divides by speed so the resulting segment plays at speed x its original duration
    // shrinks accordingly; atempo (audio) achieves the same duration change while resampling
    // pitch back to the original, chained in <=2x/>=0.5x steps per ffmpeg's atempo range limit.
    const speed = cutSpeed(cut);
    const ptsExpr = speed === 1 ? "PTS-STARTPTS" : `(PTS-STARTPTS)/${formatNumber(speed)}`;
    filters.push(
      `[0:v]trim=start=${formatNumber(cut.in)}${end},setpts=${ptsExpr}${timebaseNormalizer}[v${index}]`,
    );
    concatInputs.push(`[v${index}]`);
    if (hasAudio) {
      const atempoSuffix = buildAtempoChain(speed)
        .map((factor) => `,atempo=${formatNumber(factor)}`)
        .join("");
      filters.push(
        `[0:a]atrim=start=${formatNumber(cut.in)}${end},asetpts=PTS-STARTPTS${atempoSuffix}[a${index}]`,
      );
      concatInputs.push(`[a${index}]`);
    }
  }

  if (!hasAnyTransition) {
    filters.push(
      `${concatInputs.join("")}concat=n=${effectiveCuts.length}:v=1:a=${hasAudio ? 1 : 0}[joinedv]${hasAudio ? "[joineda]" : ""}`,
    );
  } else {
    let videoAcc = "[v0]";
    let audioAcc = hasAudio ? "[a0]" : null;
    let accDuration = segmentDuration(effectiveCuts[0]);
    for (let index = 1; index < effectiveCuts.length; index += 1) {
      const boundary = effectiveCuts[index - 1].transition_out;
      const isLastBoundary = index === effectiveCuts.length - 1;
      const nextVideoLabel = isLastBoundary ? "[joinedv]" : `[vacc${index}]`;
      const nextAudioLabel = hasAudio ? (isLastBoundary ? "[joineda]" : `[aacc${index}]`) : null;
      if (boundary) {
        const transitionName = XFADE_TRANSITION_NAMES[boundary.type] ?? "fade";
        const transitionDuration = boundary.duration;
        const offset = Math.max(0, accDuration - transitionDuration);
        filters.push(
          `${videoAcc}[v${index}]xfade=transition=${transitionName}:duration=${formatNumber(transitionDuration)}:offset=${formatNumber(offset)}${nextVideoLabel}`,
        );
        if (hasAudio) {
          filters.push(`${audioAcc}[a${index}]acrossfade=d=${formatNumber(transitionDuration)}${nextAudioLabel}`);
        }
        accDuration = accDuration + segmentDuration(effectiveCuts[index]) - transitionDuration;
      } else {
        if (hasAudio) {
          filters.push(`${videoAcc}${audioAcc}[v${index}][a${index}]concat=n=2:v=1:a=1${nextVideoLabel}${nextAudioLabel}`);
        } else {
          filters.push(`${videoAcc}[v${index}]concat=n=2:v=1:a=0${nextVideoLabel}`);
        }
        accDuration += segmentDuration(effectiveCuts[index]);
      }
      videoAcc = nextVideoLabel;
      if (hasAudio) audioAcc = nextAudioLabel;
    }
  }
  if (!hasAudio) {
    filters.push(`[1:a]atrim=duration=${formatNumber(duration)},asetpts=PTS-STARTPTS[joineda]`);
  }

  const scaledLabel = chromaKey || look ? "[scaled]" : "[outv]";
  filters.push(
    `[joinedv]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${formatNumber(fps)},setsar=1${scaledLabel}`,
  );

  // docs/contract-2026-07-22-render-basics.md #2 (source.chroma_key). Applied post-scale/pad so a
  // single insertion point covers both chroma key and LUT; the background is either a solid color
  // (built inline via ffmpeg's `color` source filter — no extra -i needed) or an image/video file
  // (an extra input, looped if a still image).
  const extraInputArgs = [];
  let nextInputIndex = hasAudio ? 1 : 2;
  let videoLabel = scaledLabel;
  if (chromaKey) {
    const color = isNonEmptyString(chromaKey.color) ? chromaKey.color : "0x00FF00";
    const similarity = isFiniteNumber(chromaKey.similarity) ? chromaKey.similarity : 0.2;
    const blend = isFiniteNumber(chromaKey.blend) ? chromaKey.blend : 0.1;
    const background = chromaKey.background;
    let backgroundLabel;
    if (!isNonEmptyString(background) || isColorLike(background)) {
      // ffmpeg's `color` source filter defaults to 25fps regardless of the project's output.fps;
      // without an explicit r=, overlay silently adopted that mismatched rate for the whole
      // output (verified empirically: omitting r= here produced a 25fps file when output.fps
      // was 10). Force it to match so background and keyed foreground share one frame rate.
      const bgColor = isNonEmptyString(background) ? background : "0x000000";
      filters.push(`color=c=${bgColor}:s=${width}x${height}:r=${formatNumber(fps)}:d=${formatNumber(duration)}[bgsrc]`);
      backgroundLabel = "[bgsrc]";
    } else {
      const backgroundPath = resolve(projectRoot, background);
      const isImage = /\.(png|jpe?g|webp|bmp|gif)$/iu.test(backgroundPath);
      extraInputArgs.push(...(isImage ? ["-loop", "1", "-i", backgroundPath] : ["-i", backgroundPath]));
      backgroundLabel = `[${nextInputIndex}:v]`;
      nextInputIndex += 1;
    }
    filters.push(`${videoLabel}format=yuva420p,chromakey=color=${color}:similarity=${formatNumber(similarity)}:blend=${formatNumber(blend)}[keyed]`);
    // fps= here too: an image/video-file background (the `else` branch above) may carry its own
    // differing frame rate, which the same mismatch would otherwise leak through as well.
    filters.push(`${backgroundLabel}scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${formatNumber(fps)},setsar=1[bgscaled]`);
    const chromaOutLabel = look ? "[chromakeyed]" : "[outv]";
    filters.push(`[bgscaled][keyed]overlay=shortest=1:format=auto${chromaOutLabel}`);
    videoLabel = chromaOutLabel;
  }

  // docs/contract-2026-07-22-render-basics.md #4 (output.look). intensity blends between the
  // untouched frame and the fully graded one via ffmpeg's blend filter (0 = no-op, 1 = full LUT).
  if (look) {
    const lutPath = resolveLutPath(projectRoot, look.lut);
    const intensity = isFiniteNumber(look.intensity) ? Math.max(0, Math.min(1, look.intensity)) : 1;
    if (intensity <= 0) {
      filters.push(`${videoLabel}null[outv]`);
    } else if (intensity >= 1) {
      filters.push(`${videoLabel}lut3d=file='${escapeFilterPath(lutPath)}':interp=trilinear[outv]`);
    } else {
      filters.push(`${videoLabel}split=2[lutbase][luttop]`);
      filters.push(`[luttop]lut3d=file='${escapeFilterPath(lutPath)}':interp=trilinear[lutapplied]`);
      // blend's inputs are [0]=top [1]=bottom, and all_opacity weights the TOP input (verified
      // empirically: opacity=0.25 with [red][blue] produced ~75% blue, i.e. output =
      // top*opacity + bottom*(1-opacity)). We want intensity=1 -> fully graded, intensity=0 ->
      // untouched, so the graded frame ([lutapplied]) must be the top (first) input.
      filters.push(`[lutapplied][lutbase]blend=all_mode=normal:all_opacity=${formatNumber(intensity)}[outv]`);
    }
  } else if (videoLabel !== "[outv]") {
    filters.push(`${videoLabel}null[outv]`);
  }

  return {
    command: ffmpegCommand,
    args: [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-y",
      "-i",
      sourcePath,
      ...(!hasAudio ? ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"] : []),
      ...extraInputArgs,
      "-filter_complex",
      filters.join(";"),
      "-map",
      "[outv]",
      "-map",
      "[joineda]",
      "-c:v",
      "libx264",
      "-profile:v",
      "high",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-ar",
      "48000",
      "-shortest",
      cutPath,
    ],
  };
}

export function predictedDuration(cuts, sourceDuration) {
  if (Array.isArray(cuts) && cuts.length > 0) {
    const segmentsTotal = cuts.reduce((sum, cut) => sum + segmentDuration(cut), 0);
    // A transition_out overlaps its own segment's end with the next segment's start, shortening
    // the combined timeline by the overlap (xfade/acrossfade's own duration math — see
    // buildCutCommand). The last cut's transition_out (if any) has no following segment to
    // blend into, so it never actually renders and must not be subtracted here.
    const transitionOverlap = cuts
      .slice(0, -1)
      .reduce((sum, cut) => sum + (isPositiveNumber(cut.transition_out?.duration) ? cut.transition_out.duration : 0), 0);
    return segmentsTotal - transitionOverlap;
  }
  return sourceDuration;
}

function segmentDuration(cut) {
  return (cut.out - cut.in) / cutSpeed(cut);
}

function cutSpeed(cut) {
  const value = cut?.speed;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 1;
}

function isPositiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

// docs/contract-2026-07-22-render-basics.md #3: schema enum values map 1:1 onto ffmpeg's xfade
// transition names (dissolve/fadeblack/fadewhite all exist natively — verified via `ffmpeg -filters`).
const XFADE_TRANSITION_NAMES = {
  dissolve: "dissolve",
  "fade-black": "fadeblack",
  "fade-white": "fadewhite",
};

// atempo only accepts factors in [0.5, 2.0]; speeds outside that range are decomposed into a
// chain of filters that multiply out to the requested speed (docs/contract-2026-07-22-render-basics.md
// #1's ffmpeg column: "atempo（>2x/<0.5x の段組み）").
function buildAtempoChain(speed) {
  if (speed === 1) return [];
  const factors = [];
  let remaining = speed;
  while (remaining > 2 + 1e-9) {
    factors.push(2);
    remaining /= 2;
  }
  while (remaining < 0.5 - 1e-9) {
    factors.push(0.5);
    remaining /= 0.5;
  }
  factors.push(remaining);
  return factors;
}

export function selectDefaultOutput(projectRoot, edit, exists) {
  const configured = typeof edit.name === "string" && edit.name.trim() !== "" ? edit.name : null;
  const sourceName = basename(edit.source.path, extname(edit.source.path));
  const stem = sanitizeName(configured ?? sourceName ?? "render");
  const directory = join(projectRoot, "exports");
  let index = 1;
  let candidate = join(directory, `${stem}.mp4`);
  while (exists(candidate)) {
    index += 1;
    candidate = join(directory, `${stem}-${index}.mp4`);
  }
  return candidate;
}

function selectRasterizer(capabilities, hasThreeDimensionalOverlay) {
  if (hasThreeDimensionalOverlay) return "puppeteer-core";
  if (capabilities.hyperframesAvailable) return "hyperframes";
  if (capabilities.puppeteerAvailable && capabilities.chromePath) return "puppeteer-core";
  return "static-screenshot";
}

function localBinary(_projectRoot, name) {
  return fileURLToPath(new URL(`../node_modules/.bin/${name}`, import.meta.url));
}

function relativeOrAbsolute(root, value) {
  const result = relative(root, value);
  return result.startsWith("..") ? value : result;
}

function sanitizeName(value) {
  const result = String(value).trim().replace(/[^a-zA-Z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return result || "render";
}

function formatNumber(value) {
  return Number(value).toString();
}
