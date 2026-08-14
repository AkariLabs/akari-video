import { createHash } from "node:crypto";

const TAU = Math.PI * 2;

export const MOTION_DEFAULTS = Object.freeze({
  intensity: 0.5,
  breathFrequency: 0.25,
  breathOvertoneFrequency: 0.5,
  breathOvertoneWeight: 0.2,
  breathScaleY: 0.008,
  breathTranslateY: 0.0015,
  talkFrequency: 3,
  talkScaleY: 0.028,
  talkTranslateY: 0.009,
  talkAttackSeconds: 0.06,
  talkReleaseSeconds: 0.12,
  tiltDegrees: 3.2,
  tiltMinimumRatio: 0.55,
  tiltAttackSeconds: 0.28,
  samplingMargin: 2,
});

function identityFrame() {
  return { scaleX: 1, scaleY: 1, tx: 0, ty: 0, rotateDeg: 0 };
}

function phaseValues(seed) {
  const digest = createHash("sha256")
    .update("avatar-drive-motion-v1.1\0", "utf8")
    .update(String(seed), "utf8")
    .digest();
  return [digest.readUInt32BE(0), digest.readUInt32BE(4)]
    .map((value) => value / 0x1_0000_0000 * TAU);
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

function wave(time, frequency, phase, overtoneFrequency, overtonePhase, overtoneWeight) {
  return (
    Math.sin(TAU * frequency * time + phase)
    + overtoneWeight * Math.sin(TAU * overtoneFrequency * time + overtonePhase)
  ) / (1 + overtoneWeight);
}

function smoothingAlpha(fps, seconds) {
  return 1 - Math.exp(-1 / (fps * seconds));
}

/** PNGTuber motion derived only from timeline inputs; no wall clock or OS randomness. */
export function buildMotionFrames({
  mouthStates, fps, intensity = MOTION_DEFAULTS.intensity, seed, width, height, headStates = null,
}) {
  if (!Array.isArray(mouthStates) || mouthStates.length === 0) throw new Error("mouthStates は空でない配列です");
  if (!(Number.isFinite(fps) && fps > 0)) throw new Error("fps は正数である必要があります");
  if (!(Number.isFinite(intensity) && intensity >= 0 && intensity <= 1)) {
    throw new Error("motion intensity は 0 以上 1 以下である必要があります");
  }
  if (!(Number.isInteger(width) && width >= 2 && Number.isInteger(height) && height >= 2)) {
    throw new Error("sprite size が不正です");
  }
  if (headStates !== null && (!Array.isArray(headStates) || headStates.length !== mouthStates.length)) {
    throw new Error("headStates と mouthStates の長さが一致しません");
  }
  if (intensity === 0) return mouthStates.map(identityFrame);

  const phase = phaseValues(seed);
  const random = mulberry32(seed);
  const talkAttack = smoothingAlpha(fps, MOTION_DEFAULTS.talkAttackSeconds);
  const talkRelease = smoothingAlpha(fps, MOTION_DEFAULTS.talkReleaseSeconds);
  const tiltAttack = smoothingAlpha(fps, MOTION_DEFAULTS.tiltAttackSeconds);
  let speakingPrevious = false;
  let talkEnvelope = 0;
  let talkOnsetFrame = 0;
  let tiltTarget = 0;
  let tilt = 0;

  return mouthStates.map((mouth, frame) => {
    const speaking = mouth !== "closed";
    if (speaking && !speakingPrevious) {
      talkOnsetFrame = frame;
      const sign = random() < 0.5 ? -1 : 1;
      const magnitude = MOTION_DEFAULTS.tiltMinimumRatio
        + (1 - MOTION_DEFAULTS.tiltMinimumRatio) * random();
      tiltTarget = sign * MOTION_DEFAULTS.tiltDegrees * magnitude;
    }
    const envelopeTarget = speaking ? 1 : 0;
    talkEnvelope += (envelopeTarget - talkEnvelope) * (speaking ? talkAttack : talkRelease);
    tilt += (tiltTarget - tilt) * tiltAttack;

    const time = frame / fps;
    const breath = wave(
      time,
      MOTION_DEFAULTS.breathFrequency,
      phase[0],
      MOTION_DEFAULTS.breathOvertoneFrequency,
      phase[1],
      MOTION_DEFAULTS.breathOvertoneWeight,
    );
    const talkTime = Math.max(0, frame - talkOnsetFrame) / fps;
    const talkPulse = (1 - Math.cos(TAU * MOTION_DEFAULTS.talkFrequency * talkTime)) / 2;
    const talkAmount = talkEnvelope * (0.35 + 0.65 * talkPulse);
    const trackedHead = headStates?.[frame];
    const rotateDeg = trackedHead != null ? Number(trackedHead.roll ?? 0) * intensity : tilt * intensity;
    speakingPrevious = speaking;
    return {
      scaleX: 1,
      scaleY: 1 + intensity * (
        MOTION_DEFAULTS.breathScaleY * breath + MOTION_DEFAULTS.talkScaleY * talkAmount
      ),
      tx: 0,
      ty: -height * intensity * (
        MOTION_DEFAULTS.breathTranslateY * breath + MOTION_DEFAULTS.talkTranslateY * talkAmount
      ),
      rotateDeg,
    };
  });
}

/** Symmetric margin enclosing every transformed source rectangle plus bilinear sampling support. */
export function calculateMotionMargin(width, height, frames) {
  if (!Array.isArray(frames) || frames.length === 0) return 0;
  let required = 0;
  for (const frame of frames) {
    const radians = Math.abs(frame.rotateDeg) * Math.PI / 180;
    const cosine = Math.abs(Math.cos(radians));
    const sine = Math.abs(Math.sin(radians));
    const halfWidth = width * frame.scaleX / 2;
    const halfHeight = height * frame.scaleY / 2;
    const extentX = cosine * halfWidth + sine * halfHeight + Math.abs(frame.tx);
    const extentY = sine * halfWidth + cosine * halfHeight + Math.abs(frame.ty);
    required = Math.max(required, extentX - width / 2, extentY - height / 2);
  }
  return Math.max(0, Math.ceil(required + MOTION_DEFAULTS.samplingMargin));
}
