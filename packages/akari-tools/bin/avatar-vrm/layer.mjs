import { isAbsolute, relative, sep } from "node:path";

export const BAKE_SIZE = Object.freeze({ width: 720, height: 720 });
const MARGIN = 48;

function round(value, digits = 6) {
  return Number(value.toFixed(digits));
}

function explicitPosition(position) {
  const match = /^\s*(-?(?:\d+(?:\.\d*)?|\.\d+))\s*,\s*(-?(?:\d+(?:\.\d*)?|\.\d+))\s*$/.exec(position);
  return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
}

function centerFor(position, outputWidth, outputHeight, width, height) {
  const named = {
    "right-bottom": { x: outputWidth - MARGIN - width / 2, y: outputHeight - MARGIN - height / 2 },
    "left-bottom": { x: MARGIN + width / 2, y: outputHeight - MARGIN - height / 2 },
    "right-top": { x: outputWidth - MARGIN - width / 2, y: MARGIN + height / 2 },
    "left-top": { x: MARGIN + width / 2, y: MARGIN + height / 2 },
    center: { x: outputWidth / 2, y: outputHeight / 2 },
  };
  const explicit = explicitPosition(position);
  if (explicit) return explicit;
  if (!named[position]) throw new Error(`--position が不正です: ${position}`);
  return named[position];
}

export function buildAvatarVrmLayer({
  projectRoot = null,
  outPath,
  outputWidth,
  outputHeight,
  duration,
  position = "right-bottom",
  scale = 1,
  framing = "bust",
  id = "avatar-vrm-0",
  bakeWidth = BAKE_SIZE.width,
  bakeHeight = BAKE_SIZE.height,
}) {
  if (!(scale > 0)) throw new Error("--scale は正数である必要があります");
  const center = centerFor(position, outputWidth, outputHeight, bakeWidth * scale, bakeHeight * scale);
  const relativePath = projectRoot ? relative(projectRoot, outPath) : outPath;
  const src = !projectRoot || isAbsolute(relativePath) || relativePath.startsWith("..")
    ? outPath
    : relativePath.split(sep).join("/");
  return {
    id,
    t: 0,
    duration: round(duration),
    kind: "baked",
    src,
    transform: {
      x: round(center.x - outputWidth / 2, 3),
      y: round(center.y - outputHeight / 2, 3),
      scale: round(scale),
      rotate: 0,
    },
    preset: "avatar-vrm-v0",
    params: { framing, position },
  };
}
