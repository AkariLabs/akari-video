import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// docs/contract-2026-07-14-edit-json-v1-audio.md §4: sidechaincompress threshold ~-24dB (linear 0.063), ratio 8, attack 5ms, release 300ms.
const DUCKING_SIDECHAIN_ARGS = "threshold=0.063:ratio=8:attack=5:release=300";
// docs/contract-2026-07-20-edit-json-v1-narration.md §1: gain_db clamp range, shared with bgm/sfx.
const GAIN_DB_MIN = -60;
const GAIN_DB_MAX = 12;

export function buildPlan({
  edit,
  projectRoot,
  outputPath,
  capabilities,
  hasSourceAudio,
  renderOverlays = edit.overlays,
}) {
  const width = edit.output.width;
  const height = edit.output.height;
  const fps = edit.output.fps;
  const duration = predictedDuration(edit.cuts, capabilities.sourceDuration);
  const temporary = join(projectRoot, ".akari", "render-tmp");
  const cutPath = join(temporary, "cut.mp4");
  const overlayWebmPath = join(temporary, "overlay.webm");
  const overlayMovPath = join(temporary, "overlay.mov");
  const compositePath = join(temporary, "composite.mp4");
  const finalPath = join(temporary, "final.mp4");
  const sheetPath = join(temporary, "overlay-sheet.html");
  const sourcePath = resolve(projectRoot, edit.source.path);
  const rasterizer = selectRasterizer(capabilities);
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
  });

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
      order: ["hyperframes", "puppeteer-core", "static-screenshot"],
    },
    intermediates: [
      cutPath,
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
          cutPath,
          overlayWebmPath,
          compositePath,
        ),
        "puppeteer-core": buildAnimatedCompositeCommand(
          capabilities.ffmpegCommand,
          cutPath,
          overlayMovPath,
          compositePath,
        ),
        "static-screenshot": buildStaticCompositeCommand(
          capabilities.ffmpegCommand,
          cutPath,
          compositePath,
          temporary,
          renderOverlays,
          duration,
        ),
      },
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

  if (!audio.bgm && audio.sfx.length === 0 && !hasNarration) {
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
    filters.push(
      `[${inputIndex}:a]volume=${formatNumber(audio.bgm.gain_db ?? 0)}dB,atrim=duration=${formatNumber(duration)}[bgm]`,
    );
    bgmLabel = "[bgm]";
    inputIndex += 1;

    if (audio.bgm.ducking === true && narrationLabel) {
      filters.push(`[bgm]${narrationLabel}sidechaincompress=${DUCKING_SIDECHAIN_ARGS}[bgm_ducked]`);
      bgmLabel = "[bgm_ducked]";
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
  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "0:v:0",
    "-map",
    "[mixed]",
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

function normalizeAudioPlan(audio) {
  if (!audio) return { bgm: null, sfx: [] };
  const normalize = (value) => (typeof value === "string" ? { path: value } : value);
  return {
    bgm: audio.bgm ? normalize(audio.bgm) : null,
    sfx: Array.isArray(audio.sfx) ? audio.sfx.map(normalize) : [],
  };
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
}) {
  const effectiveCuts = cuts.length > 0 ? cuts : [{ in: 0, out: null }];
  const filters = [];
  const concatInputs = [];
  for (const [index, cut] of effectiveCuts.entries()) {
    const end = cut.out === null ? "" : `:end=${formatNumber(cut.out)}`;
    filters.push(
      `[0:v]trim=start=${formatNumber(cut.in)}${end},setpts=PTS-STARTPTS[v${index}]`,
    );
    concatInputs.push(`[v${index}]`);
    if (hasAudio) {
      filters.push(
        `[0:a]atrim=start=${formatNumber(cut.in)}${end},asetpts=PTS-STARTPTS[a${index}]`,
      );
      concatInputs.push(`[a${index}]`);
    }
  }
  filters.push(
    `${concatInputs.join("")}concat=n=${effectiveCuts.length}:v=1:a=${hasAudio ? 1 : 0}[joinedv]${hasAudio ? "[joineda]" : ""}`,
  );
  if (!hasAudio) {
    filters.push(`[1:a]atrim=duration=${formatNumber(duration)},asetpts=PTS-STARTPTS[joineda]`);
  }
  filters.push(
    `[joinedv]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${formatNumber(fps)},setsar=1[outv]`,
  );

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
    return cuts.reduce((sum, cut) => sum + cut.out - cut.in, 0);
  }
  return sourceDuration;
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

function selectRasterizer(capabilities) {
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
