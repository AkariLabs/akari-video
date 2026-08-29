import { readFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { deriveContactSheetTimestamps } from "../../../render-cut/src/contact-sheet.mjs";
import { renderFrameAt } from "../../../render-cut/src/frame-at.mjs";
import { projectRendererCompatibilityEdit, readRenderEdit } from "../../../render-cut/src/internal-render.mjs";
import {
  findChromePath,
  loadCaptions,
  loadOverlays,
  renderProject,
} from "../../../render-cut/src/render-cut.mjs";
import { parseCaptureArguments } from "./arguments.mjs";
import {
  copyFullFrame,
  renderContactSheetFromPngs,
  renderSeparateFrame,
  reportPath,
  sha256File,
  timecodeFor,
} from "./output.mjs";

const RENDER_PACKAGE_PATH = new URL("../../../render-cut/package.json", import.meta.url);

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

  const originalWarn = console.warn;
  console.warn = (...values) => console.error(...values);
  let state;
  try {
    state = await renderProject(projectRoot, {
      planOnly: true,
      force: true,
      engine: "legacy",
      editPath: parsed.edit,
      writeState: false,
      temporaryDirectory: join(work, "plan"),
      out: join(outputDirectory, ".capture-plan.mp4"),
    }, { log() {}, error() {} });
  } catch (error) {
    await rm(work, { recursive: true, force: true });
    throw error;
  } finally {
    console.warn = originalWarn;
  }
  let captions;
  let overlays;
  try {
    captions = await loadCaptions(projectRoot, edit);
    overlays = await loadOverlays(projectRoot, edit);
  } catch (error) {
    await rm(work, { recursive: true, force: true });
    throw error;
  }
  const fps = state.plan.preset.fps;
  const autoTimes = parsed.auto
    ? deriveContactSheetTimestamps({
        cuts: edit.cuts,
        overlays: [...(edit.overlays ?? []), ...captions.overlays],
        durationSeconds: state.plan.predicted_duration_seconds,
        fps,
      })
    : [];
  const times = unionOnFrameGrid(
    [...parsed.times, ...autoTimes],
    fps,
    state.plan.predicted_duration_seconds,
    { onWarning: options.warn ?? ((line) => console.error(line)) },
  );
  if (times.length === 0) {
    await rm(work, { recursive: true, force: true });
    throw new Error("capture did not resolve any timeline frames");
  }

  const chromePath = options.chromePath ?? await findChromePath();
  if (!chromePath) {
    await rm(work, { recursive: true, force: true });
    throw new Error("Chrome が見つかりません（render-cut と同じ探索を使用）。");
  }
  const ffmpegCommand = state.plan.commands.cut.command;
  const fullFrames = [];
  try {
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
      fullFrames.push({ path: fullPath, timeS: result.timeS, timecode: timecodeFor(result.timeS, fps) });
    }

    const records = [];
    if (!parsed.separate && !parsed.full) {
      for (let offset = 0; offset < fullFrames.length; offset += parsed.perSheet) {
        const chunk = fullFrames.slice(offset, offset + parsed.perSheet);
        const sheetCode = `${chunk[0].timecode}-${chunk.at(-1).timecode}`;
        const sheetPath = join(outputDirectory, `${sheetCode}.png`);
        await renderContactSheetFromPngs({
          ffmpegCommand,
          frames: chunk.map((frame) => frame.path),
          output: sheetPath,
          directory: join(work, `sheet-${offset / parsed.perSheet + 1}`),
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

    const renderPackage = JSON.parse(await readFile(RENDER_PACKAGE_PATH, "utf8"));
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
      renderer: `render-cut@${renderPackage.version}`,
      generated_at: now.toISOString(),
    };
    const manifestPath = join(outputDirectory, "capture.json");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    return { records, manifestPath, manifest };
  } finally {
    await rm(work, { recursive: true, force: true });
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
