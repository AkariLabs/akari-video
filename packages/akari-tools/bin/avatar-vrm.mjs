#!/usr/bin/env node

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { appendLayersAdditive } from "../src/eye-bar/edit-apply.mjs";
import { resolveFfmpeg } from "../../media-bin/src/index.mjs";
import { parseArguments } from "./avatar-vrm/arguments.mjs";
import { loadDrive } from "./avatar-vrm/drive.mjs";
import { findChrome } from "./avatar-vrm/find-chrome.mjs";
import { buildAvatarVrmLayer } from "./avatar-vrm/layer.mjs";

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function summary(value, fallback) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 4000) : fallback;
}

function availability() {
  let ffmpeg;
  try { ffmpeg = resolveFfmpeg(); }
  catch (error) { return { available: false, reason: summary(error.message, "ffmpeg not found") }; }
  const chrome = process.env.PUPPETEER_EXECUTABLE_PATH?.trim() || findChrome();
  if (!chrome || !existsSync(chrome)) return { available: false, reason: "Chrome for Testing が見つかりません" };
  return { available: true, ffmpeg, chrome };
}

function loadOutputSize(options) {
  if (!options.project) return { width: options.outputWidth, height: options.outputHeight, editPath: null };
  const editPath = join(options.project, "edit.json");
  const edit = JSON.parse(readFileSync(editPath, "utf8"));
  const width = Number(edit.output?.width ?? options.outputWidth);
  const height = Number(edit.output?.height ?? options.outputHeight);
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error("edit.json output.width/height が不正です");
  }
  return { width, height, editPath };
}

async function main() {
  let options;
  try { options = parseArguments(process.argv.slice(2)); }
  catch (error) { printJson({ ok: false, reason: summary(error.message, "引数が不正です") }); process.exitCode = 2; return; }
  if (options.check) { printJson(availability()); return; }
  if (!options.model || !options.drive || !options.out) {
    printJson({ ok: false, reason: "--model <path.vrm>、--drive <path.json>、--out <path.mov> が必要です" });
    process.exitCode = 2;
    return;
  }
  if (!existsSync(options.model) || !existsSync(options.drive)) {
    printJson({ ok: false, reason: "model または drive ファイルが見つかりません" });
    process.exitCode = 2;
    return;
  }
  const available = availability();
  if (!available.available) { printJson({ ok: false, reason: available.reason }); process.exitCode = 1; return; }
  try {
    const drive = loadDrive(options.drive);
    const output = loadOutputSize(options);
    const { bakeAvatarVrmClip } = await import("./avatar-vrm/bake.mjs");
    const baked = await bakeAvatarVrmClip({
      modelPath: options.model,
      drive,
      framing: options.framing,
      outPath: options.out,
      ffmpegCommand: available.ffmpeg,
    });
    const layer = buildAvatarVrmLayer({
      projectRoot: options.project,
      outPath: options.out,
      outputWidth: output.width,
      outputHeight: output.height,
      duration: drive.mouth.length / drive.fps,
      position: options.position,
      scale: options.scale,
      framing: options.framing,
      id: options.layerId,
      bakeWidth: baked.width,
      bakeHeight: baked.height,
    });
    const result = {
      ok: true,
      layers: [layer],
      stats: {
        frames: baked.frameCount,
        fps: baked.fps,
        width: baked.width,
        height: baked.height,
        expressions: baked.expressions,
        three_revision: baked.threeRevision,
        blink_frames: drive.eyes.filter((state) => state === "closed").length,
        mouth_counts: Object.fromEntries(["closed", "a", "i", "u", "e", "o"].map(
          (state) => [state, drive.mouth.filter((value) => value === state).length],
        )),
      },
    };
    if (options.apply) {
      const applied = appendLayersAdditive(output.editPath, [layer]);
      if (!applied.ok) throw new Error(applied.reason);
      result.applied = { addedIds: applied.addedIds };
    }
    printJson(result);
  } catch (error) {
    printJson({ ok: false, reason: summary(error.message, "avatar-vrm 生成に失敗しました") });
    process.exitCode = 1;
  }
}

if (process.argv[1]
  && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  await main();
}
