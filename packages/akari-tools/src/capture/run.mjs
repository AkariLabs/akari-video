import { readFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { captureFramesWithGpu } from "../../../gpu-export/src/index.mjs";
import { evaluateGpuEligibility } from "../../../gpu-export/src/eligibility.mjs";
import { resolveGpuLauncher } from "../../../gpu-export/src/runner.mjs";
import { resolveFfmpeg } from "../../../media-bin/src/index.mjs";
import { captureFramesWithOsr, resolveOsrLauncher } from "../../../osr-export/src/index.mjs";
import {
  deriveContactSheetTimestamps,
  splitContactSheetCounts,
} from "../../../render-cut/src/contact-sheet.mjs";
import { renderFrameAt } from "../../../render-cut/src/frame-at.mjs";
import { projectRendererCompatibilityEdit, readRenderEdit } from "../../../render-cut/src/internal-render.mjs";
import {
  findChromePath,
  loadCaptions,
  loadOverlays,
  renderProject,
  resolveEngineChoice,
} from "../../../render-cut/src/render-cut.mjs";
import { parseCaptureArguments } from "./arguments.mjs";
import {
  copyFullFrame,
  renderLabeledContactSheetFromPngs,
  renderSeparateFrame,
  reportPath,
  sha256File,
  timecodeFor,
} from "./output.mjs";

const RENDER_PACKAGE_PATH = new URL("../../../render-cut/package.json", import.meta.url);
const OSR_PACKAGE_PATH = new URL("../../../osr-export/package.json", import.meta.url);
const GPU_PACKAGE_PATH = new URL("../../../gpu-export/package.json", import.meta.url);

export async function runCapture(argv, options = {}) {
  const parsed = parseCaptureArguments(argv, { cwd: options.cwd ?? process.cwd() });
  if (parsed.help) return { help: true, records: [], manifestPath: null };
  const now = options.now ?? new Date();
  const projectRoot = parsed.projectRoot;
  const editText = await readFile(parsed.edit, "utf8");
  const parsedEdit = JSON.parse(editText);
  const compatibility = readRenderEdit(editText, join(projectRoot, ".akari", "render-tmp"));
  const edit = projectRendererCompatibilityEdit(
    parsedEdit,
    compatibility.internal,
    join(projectRoot, ".akari", "render-tmp"),
  );
  const outputDirectory = parsed.out ?? join(
    projectRoot,
    ".akari",
    "reports",
    "capture",
    captureStamp(now),
  );
  await mkdir(outputDirectory, { recursive: true });
  const work = await mkdtemp(join(tmpdir(), "akari-capture-"));

  try {
    const originalWarn = console.warn;
    console.warn = (...values) => console.error(...values);
    let state;
    try {
      state = await renderProject(projectRoot, {
        planOnly: true,
        force: true,
        engine: parsed.engine,
        editPath: parsed.edit,
        writeState: false,
        temporaryDirectory: join(work, "plan"),
        out: join(outputDirectory, ".capture-plan.mp4"),
      }, { log() {}, error() {} });
    } finally {
      console.warn = originalWarn;
    }
    const captions = await loadCaptions(projectRoot, edit);
    const overlays = await loadOverlays(projectRoot, edit);
    const fps = state.plan.preset.fps;
    const duration = state.plan.predicted_duration_seconds;
    const totalFrames = Math.max(1, Math.round(duration * fps));
    const autoTimes = parsed.auto
      ? deriveContactSheetTimestamps({
          cuts: edit.cuts,
          overlays: [...(edit.overlays ?? []), ...captions.overlays],
          durationSeconds: duration,
          fps,
        })
      : [];
    const times = unionOnFrameGrid(
      [...parsed.times, ...autoTimes],
      fps,
      duration,
      { onWarning: options.warn ?? ((line) => console.error(line)) },
    );
    if (times.length === 0) throw new Error("capture did not resolve any timeline frames");
    const frameNumbers = times.map((time) => Math.round(time * fps));
    const shouldEvaluateGpu = parsed.engine === "gpu"
      || (parsed.engine === "auto" && ["darwin", "win32"].includes(process.platform));
    const gpuEligibility = shouldEvaluateGpu
      ? evaluateGpuEligibility({
          edit: { ...edit, overlays },
          captions: captions.captions,
          defaultTextStyle: captions.defaultTextStyle,
          emphasisWords: captions.emphasisWords,
        })
      : null;
    const initialEngine = resolveEngineChoice(parsed.engine, process.platform, gpuEligibility);
    assertCaptureEngineParity(initialEngine, state.provenance);
    const engine = await resolveCaptureEngine({
      requested: parsed.engine,
      platform: process.platform,
      eligibility: gpuEligibility,
      resolveGpu: options.resolveGpuLauncher ?? resolveGpuLauncher,
      resolveOsr: options.resolveOsrLauncher ?? resolveOsrLauncher,
    });
    const ffmpegCommand = resolveFfmpeg();
    const fullFrames = [];
    let engineReceipt;

    if (engine.resolved === "osr") {
      const captured = await captureFramesWithOsr({
        projectRoot,
        editPath: parsed.edit,
        outputDirectory: join(work, "osr-frames"),
        frameNumbers,
        fps,
        width: edit.output.width,
        height: edit.output.height,
        duration,
        frames: totalFrames,
        launcher: engine.launcher,
        launcherRunner: options.osrLauncherRunner,
        io: { log() {}, error: options.warn ?? ((line) => console.error(line)) },
      });
      if (captured.fellBackToLegacy) throw new Error("OSR launcher changed after engine resolution");
      engineReceipt = captured.receipt;
      const outputs = new Map(captured.run.outputs.map((entry) => [entry.frameNumber, entry.path]));
      for (const [index, frameNumber] of frameNumbers.entries()) {
        fullFrames.push({
          path: outputs.get(frameNumber),
          timeS: times[index],
          timecode: timecodeFor(times[index], fps),
          frameNumber,
        });
      }
    } else if (engine.resolved === "gpu") {
      const captured = await captureFramesWithGpu({
        projectRoot,
        editPath: parsed.edit,
        outputDirectory: join(work, "gpu-frames"),
        frameNumbers,
        fps,
        width: edit.output.width,
        height: edit.output.height,
        duration,
        frames: totalFrames,
        eligibility: gpuEligibility,
        launcher: engine.launcher,
        launcherRunner: options.gpuLauncherRunner,
        io: { log() {}, error: options.warn ?? ((line) => console.error(line)) },
      });
      engineReceipt = captured.receipt;
      const outputs = new Map(captured.run.outputs.map((entry) => [entry.frameNumber, entry.path]));
      for (const [index, frameNumber] of frameNumbers.entries()) {
        fullFrames.push({
          path: outputs.get(frameNumber),
          timeS: times[index],
          timecode: timecodeFor(times[index], fps),
          frameNumber,
        });
      }
    } else {
      const chromePath = options.chromePath ?? await findChromePath();
      if (!chromePath) throw new Error("Chrome が見つかりません（render-cut と同じ探索を使用）。");
      const verifyFrames = [];
      for (let index = 0; index < times.length; index += 1) {
        const frameDirectory = join(work, `capture-${String(index + 1).padStart(3, "0")}`);
        const fullPath = join(work, `full-${String(index + 1).padStart(3, "0")}.png`);
        const result = await renderFrameAt({
          plan: state.plan,
          timeS: times[index],
          outputPath: fullPath,
          edit,
          projectRoot,
          overlays,
          captions: captions.overlays,
          chromePath,
          ffmpegCommand,
          temporaryDirectory: frameDirectory,
        });
        fullFrames.push({
          path: fullPath,
          timeS: result.timeS,
          timecode: timecodeFor(result.timeS, fps),
          frameNumber: result.frameIndex,
        });
        verifyFrames.push({ frameNumber: result.frameIndex, matched: true });
      }
      engineReceipt = { operation: "capture", verify: { mode: "legacy", matched: true, frames: verifyFrames } };
    }

    if (fullFrames.some((frame) => !frame.path)) {
      throw new Error(`${engine.resolved} capture did not return every requested frame`);
    }

    const records = [];
    if (!parsed.separate && !parsed.full) {
      let offset = 0;
      for (const count of splitContactSheetCounts(fullFrames.length, parsed.perSheet)) {
        const chunk = fullFrames.slice(offset, offset + count);
        const sheetCode = `${chunk[0].timecode}-${chunk.at(-1).timecode}`;
        const sheetPath = join(outputDirectory, `${sheetCode}.png`);
        await renderLabeledContactSheetFromPngs({
          ffmpegCommand,
          frames: chunk.map((frame) => frame.path),
          labels: chunk.map((frame) => frame.timecode),
          output: sheetPath,
          directory: join(work, `sheet-${offset + 1}`),
          width: edit.output.width,
          height: edit.output.height,
          cwd: projectRoot,
        });
        records.push({
          kind: "sheet",
          timecode: sheetCode,
          times_s: chunk.map((frame) => frame.timeS),
          path: reportPath(projectRoot, sheetPath),
        });
        offset += count;
      }
    }
    if (parsed.separate) {
      for (const frame of fullFrames) {
        const framePath = join(outputDirectory, `${frame.timecode}.png`);
        const size = await renderSeparateFrame({
          ffmpegCommand,
          source: frame.path,
          output: framePath,
          width: edit.output.width,
          height: edit.output.height,
          cwd: projectRoot,
        });
        records.push({
          kind: "frame",
          timecode: frame.timecode,
          time_s: frame.timeS,
          path: reportPath(projectRoot, framePath),
          ...size,
        });
      }
    }
    if (parsed.full) {
      for (const frame of fullFrames) {
        const framePath = join(outputDirectory, `${frame.timecode}-full.png`);
        await copyFullFrame(frame.path, framePath);
        records.push({
          kind: "frame",
          timecode: frame.timecode,
          time_s: frame.timeS,
          path: reportPath(projectRoot, framePath),
          width: edit.output.width,
          height: edit.output.height,
        });
      }
    }

    const rendererPackagePath = engine.resolved === "osr"
      ? OSR_PACKAGE_PATH
      : engine.resolved === "gpu"
        ? GPU_PACKAGE_PATH
        : RENDER_PACKAGE_PATH;
    const rendererPackage = JSON.parse(await readFile(rendererPackagePath, "utf8"));
    const captionsPath = join(projectRoot, "captions.json");
    const editSha256 = await sha256File(parsed.edit);
    const captionsSha256 = await sha256File(captionsPath);
    const materials = Object.entries(state.inputs ?? {})
      .filter(([path]) => path !== "edit.json" && path !== "captions.json")
      .map(([path, receipt]) => ({ path, sha256: receipt.sha256 }));
    const manifest = {
      images: records,
      edit_path: reportPath(projectRoot, parsed.edit),
      edit_sha256: editSha256,
      captions_sha256: captionsSha256,
      materials,
      engine: {
        requested: parsed.engine,
        resolved: engine.resolved,
        ...(engine.fallback ? { fallback: engine.fallback } : {}),
      },
      renderer: `${rendererPackage.name.replace("@akari-video/", "")}@${rendererPackage.version}`,
      verify: engineReceipt.verify,
      generated_at: now.toISOString(),
    };
    const manifestPath = join(outputDirectory, "capture.json");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    return { records, manifestPath, manifest };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export async function resolveCaptureEngine({
  requested,
  platform,
  eligibility = null,
  resolveGpu = resolveGpuLauncher,
  resolveOsr = resolveOsrLauncher,
}) {
  let resolved = resolveEngineChoice(requested, platform, eligibility);
  let fallback = requested === "auto" && ["darwin", "win32"].includes(platform)
    && eligibility?.eligible === false
    ? { from: "gpu", reason: "GPU ineligible" }
    : null;
  let launcher = null;
  if (resolved === "gpu") {
    launcher = await resolveGpu();
    if (launcher?.tier === 3) {
      if (requested === "gpu") {
        throw new Error(`GPU capture unavailable: ${launcher.reason ?? "Electron unavailable"}`);
      }
      fallback = { from: "gpu", reason: launcher.reason ?? "GPU Electron launcher unavailable" };
      resolved = "osr";
      launcher = null;
    }
  }
  if (resolved === "osr") {
    launcher ??= await resolveOsr();
    if (launcher?.tier === 3) {
      throw new Error(`OSR capture unavailable: ${launcher.reason ?? "Electron unavailable"}`);
    }
  }
  return { requested, resolved, ...(fallback ? { fallback } : {}), launcher };
}

export function assertCaptureEngineParity(resolvedEngine, renderProvenance) {
  if (renderProvenance?.engine !== resolvedEngine) {
    throw new Error(
      `capture engine resolution drifted from render-cut: ${resolvedEngine} != ${renderProvenance?.engine ?? "missing"}`,
    );
  }
}

export function unionOnFrameGrid(times, fps, duration, { onWarning } = {}) {
  const totalFrames = Math.max(1, Math.round(duration * fps));
  const lastFrame = totalFrames - 1;
  const selected = new Map();
  for (const time of times) {
    const requestedFrame = Math.round(time * fps);
    const frame = Math.min(lastFrame, Math.max(0, requestedFrame));
    const snappedTime = frame / fps;
    if (frame !== requestedFrame) {
      onWarning?.(
        `capture: t=${formatWarningNumber(time)} はタイムライン長 ${duration.toFixed(1)}s を超えるため `
          + `${formatWarningNumber(snappedTime)}s に丸めました`,
      );
    }
    const previous = selected.get(frame);
    if (previous) {
      onWarning?.(
        `capture: t=${formatWarningNumber(time)} は t=${formatWarningNumber(previous.time)} と同じ `
          + `${formatWarningNumber(snappedTime)}s のフレームになるため重複を除きました`,
      );
      continue;
    }
    selected.set(frame, { time });
  }
  return [...selected.keys()].sort((left, right) => left - right).map((frame) => frame / fps);
}

function captureStamp(now) {
  return now.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");
}

function formatWarningNumber(value) {
  return Number(value.toFixed(6)).toString();
}
