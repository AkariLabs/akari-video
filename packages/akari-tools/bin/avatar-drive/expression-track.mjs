import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const DEFAULT_HEAD_SMOOTHING = 5;
export const BLINK_GATE = Object.freeze({ threshold: 0.3, symmetry: 0.12, minimumSamples: 2 });
export const EMOTION_RULES = Object.freeze({
  happy: Object.freeze({ blendshapes: ["mouthSmileLeft", "mouthSmileRight"], enter: 0.45, exit: 0.3 }),
  sad: Object.freeze({ blendshapes: ["mouthFrownLeft", "mouthFrownRight"], enter: 0.45, exit: 0.3 }),
  angry: Object.freeze({ blendshapes: ["browDownLeft", "browDownRight"], enter: 0.45, exit: 0.3 }),
  surprised: Object.freeze({ blendshapes: ["browOuterUpLeft", "browOuterUpRight", "jawOpen"], enter: 0.45, exit: 0.3 }),
});

const EMOTIONS = Object.freeze(Object.keys(EMOTION_RULES));
const RAD_TO_DEG = 180 / Math.PI;

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} は有限数である必要があります`);
  return number;
}

function validateTrack(document, trackPath) {
  if (document?.kind !== "face-expression" || !Array.isArray(document.samples)) {
    throw new Error("expression track は kind:\"face-expression\" と samples[] が必要です");
  }
  let previous = -Infinity;
  const samples = document.samples.map((sample, index) => {
    const t = finite(sample?.t, `samples[${index}].t`);
    if (t < 0 || t < previous) throw new Error("expression track の samples[].t は 0 以上の昇順である必要があります");
    previous = t;
    if (!Array.isArray(sample?.detections)) throw new Error(`samples[${index}].detections は配列である必要があります`);
    const detection = sample.detections[0] ?? null;
    if (detection && (typeof detection !== "object" || Array.isArray(detection))) {
      throw new Error(`samples[${index}].detections[0] が不正です`);
    }
    const head = detection?.head == null ? null : Object.fromEntries(
      ["yaw", "pitch", "roll"].map((key) => [key, finite(detection.head[key] ?? 0, `samples[${index}].head.${key}`)]),
    );
    const blendshapes = detection?.blendshapes == null ? null : Object.fromEntries(
      Object.entries(detection.blendshapes).map(([name, value]) => [name, finite(value, `samples[${index}].blendshapes.${name}`)]),
    );
    return { t, head, blendshapes };
  });
  if (samples.length === 0) throw new Error("expression track の samples[] が空です");
  const sourcePath = typeof document.source?.path === "string"
    ? resolve(dirname(trackPath), document.source.path)
    : null;
  return { ...document, samples, trackPath, sourcePath };
}

export function loadExpressionTrack(inputPath) {
  const absolute = resolve(inputPath);
  const document = JSON.parse(readFileSync(absolute, "utf8"));
  if (document?.kind === "face-expression") return validateTrack(document, absolute);
  const pointer = document?.tracks?.face_expression;
  const pointerPath = typeof pointer === "string" ? pointer : pointer?.path;
  if (typeof pointerPath !== "string" || pointerPath.length === 0) {
    throw new Error("analysis.json に tracks.face_expression.path がありません");
  }
  const trackPath = resolve(dirname(absolute), pointerPath);
  return validateTrack(JSON.parse(readFileSync(trackPath, "utf8")), trackPath);
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function emotionScores(blendshapes = {}) {
  return Object.fromEntries(EMOTIONS.map((emotion) => {
    const rule = EMOTION_RULES[emotion];
    return [emotion, average(rule.blendshapes.map((name) => Number(blendshapes[name] ?? 0)))];
  }));
}

export function buildEmotionStates(samples) {
  let current = "neutral";
  return samples.map((sample) => {
    if (!sample.blendshapes) { current = "neutral"; return current; }
    const scores = emotionScores(sample.blendshapes);
    const entering = EMOTIONS
      .filter((emotion) => scores[emotion] >= EMOTION_RULES[emotion].enter)
      .sort((left, right) => scores[right] - scores[left] || EMOTIONS.indexOf(left) - EMOTIONS.indexOf(right));
    if (entering.length > 0) current = entering[0];
    else if (current !== "neutral" && scores[current] < EMOTION_RULES[current].exit) current = "neutral";
    return current;
  });
}

export function buildTrackedBlinkStates(samples, gate = BLINK_GATE, sampleFps = null) {
  const candidates = samples.map((sample) => {
    if (!sample.blendshapes) return false;
    const left = Number(sample.blendshapes.eyeBlinkLeft ?? 0);
    const right = Number(sample.blendshapes.eyeBlinkRight ?? 0);
    return left >= gate.threshold && right >= gate.threshold && Math.abs(left - right) <= gate.symmetry;
  });
  const states = Array(samples.length).fill("open");
  const events = [];
  for (let start = 0; start < candidates.length;) {
    if (!candidates[start]) { start += 1; continue; }
    let end = start + 1;
    while (end < candidates.length && candidates[end]
      && (!(sampleFps > 0) || samples[end].t - samples[end - 1].t <= 1.5 / sampleFps)) end += 1;
    if (end - start >= gate.minimumSamples) {
      states.fill("closed", start, end);
      events.push({ start: samples[start].t, end: samples[end - 1].t });
    }
    start = end;
  }
  return { states, events };
}

function nearestSampleIndex(samples, time) {
  let low = 0;
  let high = samples.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (samples[middle].t < time) low = middle + 1;
    else high = middle;
  }
  if (low === 0) return 0;
  if (low === samples.length) return samples.length - 1;
  return time - samples[low - 1].t <= samples[low].t - time ? low - 1 : low;
}

function sourceFrameMap({ cuts, fps, frameCount }, trackSourcePath) {
  const uniqueSources = new Set(cuts.map((cut) => resolve(cut.path)));
  const acceptAll = uniqueSources.size === 1;
  const mapped = [];
  let cutIndex = 0;
  let timelineStart = 0;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const time = frame / fps;
    while (cutIndex < cuts.length - 1) {
      const duration = (cuts[cutIndex].end - cuts[cutIndex].start) / cuts[cutIndex].speed;
      if (time < timelineStart + duration) break;
      timelineStart += duration;
      cutIndex += 1;
    }
    const cut = cuts[cutIndex];
    const matches = acceptAll || !trackSourcePath || resolve(cut.path) === trackSourcePath;
    mapped.push(matches ? cut.start + (time - timelineStart) * cut.speed : null);
  }
  return mapped;
}

function smoothHead(states, windowFrames) {
  if (windowFrames <= 1) return states.map((state) => (state ? { ...state } : null));
  const before = Math.floor((windowFrames - 1) / 2);
  const after = windowFrames - before - 1;
  return states.map((state, index) => {
    if (!state) return null;
    const neighbors = states.slice(Math.max(0, index - before), index + after + 1).filter(Boolean);
    return Object.fromEntries(["yaw", "pitch", "roll"].map((key) => [key, average(neighbors.map((head) => head[key]))]));
  });
}

export function buildExpressionDrive({ track, timeline, frameCount, headSmoothing = DEFAULT_HEAD_SMOOTHING }) {
  if (!Number.isInteger(headSmoothing) || headSmoothing < 0) {
    throw new Error("--head-smoothing は 0 以上の整数である必要があります");
  }
  const blink = buildTrackedBlinkStates(track.samples, BLINK_GATE, Number(track.sample_fps));
  const sampleEmotions = buildEmotionStates(track.samples);
  const sourceTimes = sourceFrameMap({ cuts: timeline.cuts, fps: timeline.fps, frameCount }, track.sourcePath);
  let heldHead = null;
  const sampleHeads = track.samples.map((sample) => {
    if (sample.head) heldHead = Object.fromEntries(Object.entries(sample.head).map(([key, value]) => [key, value * RAD_TO_DEG]));
    return heldHead ? { ...heldHead } : null;
  });
  const indices = sourceTimes.map((time) => (time == null ? null : nearestSampleIndex(track.samples, time)));
  const head = smoothHead(indices.map((index) => (index == null ? null : sampleHeads[index])), headSmoothing);
  const eyes = indices.map((index) => (index == null ? "open" : blink.states[index]));
  const emotion = indices.map((index) => (index == null ? "neutral" : sampleEmotions[index]));
  const blinkEvents = [];
  for (let start = 0; start < eyes.length;) {
    if (eyes[start] !== "closed") { start += 1; continue; }
    let end = start + 1;
    while (end < eyes.length && eyes[end] === "closed") end += 1;
    blinkEvents.push({ start: start / timeline.fps, end: end / timeline.fps });
    start = end;
  }
  return { head, eyes, emotion, blinkEvents };
}
