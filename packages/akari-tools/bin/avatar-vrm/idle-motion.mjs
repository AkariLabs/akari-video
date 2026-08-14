import { createHash } from "node:crypto";

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const BONES = Object.freeze(["chest", "spine", "head", "hips"]);

function zeroOffsets() {
  return Object.fromEntries(BONES.map((bone) => [bone, { x: 0, y: 0, z: 0 }]));
}

function phaseValues(seed) {
  const digest = createHash("sha256")
    .update("avatar-vrm-idle-v0.1\0", "utf8")
    .update(String(seed), "utf8")
    .digest();
  return Array.from({ length: 8 }, (_, index) => digest.readUInt32BE(index * 4) / 0x1_0000_0000 * TAU);
}

function wave(time, frequency, phase, overtoneFrequency, overtonePhase, overtoneWeight) {
  return (
    Math.sin(TAU * frequency * time + phase)
    + overtoneWeight * Math.sin(TAU * overtoneFrequency * time + overtonePhase)
  ) / (1 + overtoneWeight);
}

export function modelBytesSeed(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function computeIdleOffsets({ frame, fps, intensity, seed }) {
  if (!Number.isInteger(frame) || frame < 0) throw new Error("frame は 0 以上の整数である必要があります");
  if (!Number.isFinite(fps) || fps <= 0) throw new Error("fps は正数である必要があります");
  if (!Number.isFinite(intensity) || intensity < 0 || intensity > 1) {
    throw new Error("idle intensity は 0 以上 1 以下である必要があります");
  }
  if (intensity === 0) return zeroOffsets();

  const time = frame / fps;
  const phase = phaseValues(seed);
  const breath = wave(time, 0.25, phase[0], 0.50, phase[1], 0.20);
  const sway = wave(time, 0.08, phase[2], 0.13, phase[3], 0.35);
  const nod = wave(time, 0.47, phase[4], 0.63, phase[5], 0.30);
  const tilt = wave(time, 0.41, phase[6], 0.57, phase[7], 0.25);
  const scaled = (degrees, value) => degrees * DEG * intensity * value;

  return {
    chest: {
      x: scaled(1.10, breath),
      y: scaled(0.25, sway),
      z: scaled(0.45, sway),
    },
    spine: {
      x: scaled(0.55, breath),
      y: scaled(0.70, sway),
      z: scaled(0.95, sway),
    },
    head: {
      x: scaled(1.50, nod),
      y: scaled(1.20, tilt),
      z: scaled(1.35, 0.65 * tilt + 0.35 * nod),
    },
    hips: {
      x: scaled(0.35, sway),
      y: scaled(0.80, sway),
      z: scaled(1.40, sway),
    },
  };
}

export function addHeadDrive(offsets, head) {
  if (head == null) return offsets;
  const result = Object.fromEntries(BONES.map((bone) => [bone, { ...offsets[bone] }]));
  result.head.x += (head.pitch ?? 0) * DEG;
  result.head.y += (head.yaw ?? 0) * DEG;
  result.head.z += (head.roll ?? 0) * DEG;
  return result;
}

export function frameMotionOffsets({ frame, fps, intensity, seed, idleEnabled, headSource, head }) {
  if (!new Set(["track", "idle", "both"]).has(headSource)) throw new Error(`head source が不正です: ${headSource}`);
  const useIdle = idleEnabled && headSource !== "track";
  const trackedHead = headSource === "idle" ? null : head;
  if (!useIdle && trackedHead == null) return null;
  return addHeadDrive(computeIdleOffsets({
    frame, fps, intensity: useIdle ? intensity : 0, seed,
  }), trackedHead);
}
