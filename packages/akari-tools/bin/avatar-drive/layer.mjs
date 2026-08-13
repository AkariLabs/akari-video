import { isAbsolute, relative, sep } from "node:path";

function round(value, digits = 6) {
  return Number(value.toFixed(digits));
}

function explicitAnchorTarget(position) {
  const explicit = /^\s*(-?(?:\d+(?:\.\d*)?|\.\d+))\s*,\s*(-?(?:\d+(?:\.\d*)?|\.\d+))\s*$/.exec(position);
  return explicit ? { x: Number(explicit[1]), y: Number(explicit[2]) } : null;
}

function presetCenter(position, outputWidth, outputHeight, scaledWidth, scaledHeight, margin) {
  const centers = {
    "right-bottom": {
      x: outputWidth - margin - scaledWidth / 2,
      y: outputHeight - margin - scaledHeight / 2,
    },
    "left-bottom": {
      x: margin + scaledWidth / 2,
      y: outputHeight - margin - scaledHeight / 2,
    },
    "right-top": {
      x: outputWidth - margin - scaledWidth / 2,
      y: margin + scaledHeight / 2,
    },
    "left-top": {
      x: margin + scaledWidth / 2,
      y: margin + scaledHeight / 2,
    },
    center: { x: outputWidth / 2, y: outputHeight / 2 },
  };
  if (!centers[position]) throw new Error(`--position が不正です: ${position}`);
  return centers[position];
}

export function buildAvatarLayer({
  projectRoot, outPath, outputWidth, outputHeight, sprite, duration,
  position = "right-bottom", scale = 1, margin = 48, id = "avatar-drive-0", profile,
}) {
  if (!(scale > 0)) throw new Error("--scale は正数である必要があります");
  const scaledWidth = sprite.size.width * scale;
  const scaledHeight = sprite.size.height * scale;
  const explicit = explicitAnchorTarget(position);
  const center = explicit
    ? {
        x: explicit.x + (0.5 - sprite.anchor.x) * scaledWidth,
        y: explicit.y + (0.5 - sprite.anchor.y) * scaledHeight,
      }
    : presetCenter(position, outputWidth, outputHeight, scaledWidth, scaledHeight, margin);
  const relativePath = relative(projectRoot, outPath);
  const src = isAbsolute(relativePath) || relativePath.startsWith("..")
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
    preset: "avatar-drive-v0",
    params: {
      position,
      mid_threshold: profile.midThreshold,
      open_threshold: profile.openThreshold,
      hysteresis: profile.hysteresis,
      attack_ms: profile.attackMs,
      release_ms: profile.releaseMs,
      blink_period: profile.blinkPeriod,
      blink_jitter: profile.blinkJitter,
      blink_duration: profile.blinkDuration,
    },
  };
}
