import { createHash } from "node:crypto";

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function deriveSeed(value) {
  const digest = createHash("sha256").update(stableStringify(value)).digest();
  return digest.readUInt32LE(0);
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** 入力由来 seed だけを使う、seek 非依存の決定論的なまばたき列。 */
export function buildBlinkStates({ frameCount, fps, seed, period, jitter, duration }) {
  if (!Number.isInteger(frameCount) || frameCount < 0) throw new Error("frameCount は 0 以上の整数です");
  if (!(fps > 0 && period > 0 && jitter >= 0 && jitter < period && duration > 0)) {
    throw new Error("まばたきパラメータが不正です");
  }
  const random = mulberry32(seed);
  const states = Array.from({ length: frameCount }, () => "open");
  const events = [];
  const totalDuration = frameCount / fps;
  let start = period + (random() * 2 - 1) * jitter;
  while (start < totalDuration) {
    const firstFrame = Math.max(0, Math.round(start * fps));
    const closedFrames = Math.max(1, Math.round(duration * fps));
    const endFrame = Math.min(frameCount, firstFrame + closedFrames);
    for (let frame = firstFrame; frame < endFrame; frame += 1) states[frame] = "closed";
    events.push({ frame: firstFrame, frames: endFrame - firstFrame });
    start += period + (random() * 2 - 1) * jitter;
  }
  return { states, events };
}

