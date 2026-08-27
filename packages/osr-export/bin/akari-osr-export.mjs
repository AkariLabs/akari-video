#!/usr/bin/env node
import { exportWithOsr } from "../src/index.mjs";
import { ENCODER_CHOICES } from "../../render-cut/src/encode-preset.mjs";

const options = parse(process.argv.slice(2));
const result = await exportWithOsr(options);
process.exitCode = result.fellBackToLegacy ? 3 : 0;

function parse(argv) {
  const result = { projectRoot: null, out: null, fps: 30, width: 1920, height: 1080, duration: null, frames: null, quality: "high", encoder: "auto", verify: "stamp", soft: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      if (index + 1 >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[++index];
    };
    if (arg === "--out") result.out = value();
    else if (arg === "--fps") result.fps = Number(value());
    else if (arg === "--width") result.width = Number(value());
    else if (arg === "--height") result.height = Number(value());
    else if (arg === "--duration") result.duration = Number(value());
    else if (arg === "--frames") result.frames = Number(value());
    else if (arg === "--quality") result.quality = value();
    else if (arg === "--encoder") result.encoder = parseEncoder(value());
    else if (arg === "--verify") result.verify = value();
    else if (arg === "--soft") result.soft = true;
    else if (!arg.startsWith("-") && result.projectRoot === null) result.projectRoot = arg;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!result.projectRoot || !result.out || !(result.duration > 0)) throw new Error("project root, --out, and --duration are required");
  if (result.frames === null) result.frames = Math.round(result.duration * result.fps);
  return result;
}

function parseEncoder(value) {
  if (!ENCODER_CHOICES.includes(value)) {
    throw new Error(`--encoder must be one of ${ENCODER_CHOICES.join("|")}, got: ${value}`);
  }
  return value;
}
