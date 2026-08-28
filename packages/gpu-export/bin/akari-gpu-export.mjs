#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loadAndBuildGpuPage } from "../src/page-builder.mjs";
import { exportWithGpu, resolveGpuRuntimeOptions } from "../src/index.mjs";

async function runCli() {
  try {
    const options = parse(process.argv.slice(2));
    const built = await loadAndBuildGpuPage(options);
    await exportWithGpu({ ...options, ...resolveGpuRuntimeOptions(options), eligibility: built.eligibility });
  } catch (error) {
    process.stderr.write(`${String(error?.stack ?? error)}\n`);
    process.exitCode = 1;
  }
}

function parse(argv) {
  const result = {
    projectRoot: null,
    out: null,
    fps: 30,
    width: 1920,
    height: 1080,
    duration: null,
    frames: null,
    soft: false,
    queueDepth: 4,
    quality: "high",
    bitrate: undefined,
    trapReadback: false,
    verifyFrames: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => {
      if (index + 1 >= argv.length) throw new Error(`${argument} requires a value`);
      return argv[++index];
    };
    if (argument === "--out") result.out = value();
    else if (argument === "--fps") result.fps = positive(value(), "--fps");
    else if (argument === "--width") result.width = positive(value(), "--width");
    else if (argument === "--height") result.height = positive(value(), "--height");
    else if (argument === "--duration") result.duration = positive(value(), "--duration");
    else if (argument === "--frames") result.frames = positive(value(), "--frames");
    else if (argument === "--queue-depth") result.queueDepth = positive(value(), "--queue-depth");
    else if (argument === "--quality") result.quality = value();
    else if (argument === "--bitrate") result.bitrate = positive(value(), "--bitrate");
    else if (argument === "--soft") result.soft = true;
    else if (argument === "--trap-readback") result.trapReadback = true;
    else if (argument === "--verify-frames") result.verifyFrames = true;
    else if (!argument.startsWith("-") && result.projectRoot === null) result.projectRoot = argument;
    else throw new Error(`unknown argument: ${argument}`);
  }
  if (!result.projectRoot || !result.out || !(result.duration > 0)) throw new Error("project root, --out, and --duration are required");
  if (result.frames === null) result.frames = Math.round(result.duration * result.fps);
  return result;
}

function positive(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} requires a positive number`);
  return number;
}

const invoked = (() => {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
})();
if (invoked) await runCli();
