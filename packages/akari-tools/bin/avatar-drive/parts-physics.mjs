import { createHash } from "node:crypto";

import { computeMouthTransitions } from "./mouth-transition.mjs";

const TAU = Math.PI * 2;
const IDENTITY = Object.freeze({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

function multiply(left, right) {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

function translate(x, y) {
  return { ...IDENTITY, e: x, f: y };
}

function rotate(degrees) {
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return { a: cosine, b: sine, c: -sine, d: cosine, e: 0, f: 0 };
}

function scale(x, y) {
  return { a: x, b: 0, c: 0, d: y, e: 0, f: 0 };
}

function rootMatrix(frame, width, height) {
  if (frame === null) return IDENTITY;
  const centerX = width / 2;
  const centerY = height / 2;
  return multiply(
    multiply(
      multiply(translate(centerX + frame.tx, centerY + frame.ty), rotate(frame.rotateDeg)),
      scale(frame.scaleX, frame.scaleY),
    ),
    translate(-centerX, -centerY),
  );
}

function phaseFor(seed, id, axis) {
  const digest = createHash("sha256")
    .update("avatar-drive-parts-v2\0", "utf8")
    .update(String(seed), "utf8")
    .update("\0", "utf8")
    .update(id, "utf8")
    .update("\0", "utf8")
    .update(axis, "utf8")
    .digest();
  return digest.readUInt32BE(0) / 0x1_0000_0000 * TAU;
}

function waveAt(wave, time, fallbackPhase) {
  if (wave === undefined) return 0;
  return wave.amplitude * Math.sin(TAU * wave.frequency * time + (wave.phase ?? fallbackPhase));
}

export function visibleFor(part, mouth, eyes, emotion) {
  if (part.states === "always") return true;
  const drive = { mouth, eyes, emotion };
  return Object.entries(part.states).every(([name, values]) => values.includes(drive[name]));
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function measureFollowLagFrames(target, observed, maximumLag = 60) {
  if (!Array.isArray(target) || target.length !== observed?.length || target.length < 3) return 0;
  const center = (values) => {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return values.map((value) => value - mean);
  };
  const x = center(target);
  const y = center(observed);
  let best = { lag: 0, correlation: -Infinity };
  for (let lag = 0; lag <= Math.min(maximumLag, target.length - 2); lag += 1) {
    let numerator = 0;
    let xSquare = 0;
    let ySquare = 0;
    for (let index = lag; index < target.length; index += 1) {
      const targetValue = x[index - lag];
      const observedValue = y[index];
      numerator += targetValue * observedValue;
      xSquare += targetValue * targetValue;
      ySquare += observedValue * observedValue;
    }
    const correlation = xSquare > 0 && ySquare > 0 ? numerator / Math.sqrt(xSquare * ySquare) : (lag === 0 ? 0 : -1);
    if (correlation > best.correlation + 1e-12) best = { lag, correlation };
  }
  return best.lag;
}

/**
 * Resolve every part pivot in parent-before-child order. Wobble is closed-form;
 * follow, rotational drag and talk bounce use a fixed 1/fps step.
 */
export function buildPartFrames({
  partsSet, mouthStates, eyeStates, emotionStates = null, fps, seed, motionFrames = null,
  mouthTransitionFrames = 0,
}) {
  if (partsSet?.kind !== "parts-v2") throw new Error("buildPartFrames には parts.json v2 が必要です");
  if (!Array.isArray(mouthStates) || mouthStates.length === 0 || mouthStates.length !== eyeStates?.length) {
    throw new Error("口と目の状態列の長さが一致しません");
  }
  if (!(Number.isFinite(fps) && fps > 0)) throw new Error("fps は正数である必要があります");
  if (emotionStates !== null && emotionStates.length !== mouthStates.length) throw new Error("emotion 状態列の長さが一致しません");
  if (motionFrames !== null && motionFrames.length !== mouthStates.length) throw new Error("ルートモーション列の長さが一致しません");

  const state = new Map(partsSet.parts.map((part) => [part.id, {
    followed: null,
    rotation: 0,
    bounceY: 0,
    bounceVelocity: 0,
    speaking: false,
  }]));
  const traces = new Map(partsSet.parts.map((part) => [part.id, { targetX: [], actualX: [], targetY: [], actualY: [] }]));
  const frames = [];
  const dt = 1 / fps;

  for (let frameIndex = 0; frameIndex < mouthStates.length; frameIndex += 1) {
    const time = frameIndex / fps;
    const speaking = mouthStates[frameIndex] !== "closed";
    const pivots = new Map();
    const rendered = [];
    const root = rootMatrix(motionFrames?.[frameIndex] ?? null, partsSet.manifest.size.width, partsSet.manifest.size.height);

    for (const part of partsSet.parts) {
      const physics = part.physics ?? {};
      const parent = part.parent === null ? root : pivots.get(part.parent);
      const wobbleX = waveAt(physics.wobble?.x, time, phaseFor(seed, part.id, "x"));
      const wobbleY = waveAt(physics.wobble?.y, time, phaseFor(seed, part.id, "y"));
      const target = multiply(parent, translate(part.offset.x + wobbleX, part.offset.y + wobbleY));
      const current = state.get(part.id);
      const drag = physics.follow?.drag ?? 1;
      if (current.followed === null || drag === 1) current.followed = { x: target.e, y: target.f };
      else {
        current.followed.x += (target.e - current.followed.x) / drag;
        current.followed.y += (target.f - current.followed.y) / drag;
      }

      const rotational = physics.rotationalDrag;
      if (rotational) {
        const targetDegrees = clamp(
          (target.e - current.followed.x) * rotational.strength,
          rotational.minDeg ?? -180,
          rotational.maxDeg ?? 180,
        );
        current.rotation += (targetDegrees - current.rotation) * (rotational.lerp ?? 0.25);
      } else current.rotation = 0;

      const bounce = physics.talkBounce;
      if (bounce) {
        if (speaking && !current.speaking) current.bounceVelocity = -bounce.velocity;
        if (current.bounceY < 0 || current.bounceVelocity < 0) {
          current.bounceVelocity += bounce.gravity * dt;
          current.bounceY += current.bounceVelocity * dt;
          if (current.bounceY > 0) { current.bounceY = 0; current.bounceVelocity = 0; }
        }
      } else { current.bounceY = 0; current.bounceVelocity = 0; }
      current.speaking = speaking;

      const orientation = { ...target, e: current.followed.x, f: current.followed.y + current.bounceY };
      const pivot = multiply(orientation, rotate(current.rotation));
      pivots.set(part.id, pivot);
      rendered.push({
        id: part.id,
        z: part.z,
        declarationIndex: part.declarationIndex,
        visible: visibleFor(part, mouthStates[frameIndex], eyeStates[frameIndex], emotionStates?.[frameIndex] ?? "neutral"),
        matrix: multiply(pivot, translate(-part.origin.x, -part.origin.y)),
      });
      const trace = traces.get(part.id);
      trace.targetX.push(target.e); trace.actualX.push(current.followed.x);
      trace.targetY.push(target.f); trace.actualY.push(current.followed.y);
    }
    rendered.sort((left, right) => left.z - right.z || left.declarationIndex - right.declarationIndex);
    frames.push(rendered);
  }

  const followLagFrames = {};
  for (const part of partsSet.parts) {
    if ((part.physics?.follow?.drag ?? 1) <= 1) continue;
    const trace = traces.get(part.id);
    const xRange = Math.max(...trace.targetX) - Math.min(...trace.targetX);
    const yRange = Math.max(...trace.targetY) - Math.min(...trace.targetY);
    const target = xRange >= yRange ? trace.targetX : trace.targetY;
    const actual = xRange >= yRange ? trace.actualX : trace.actualY;
    followLagFrames[part.id] = measureFollowLagFrames(target, actual, Math.round(fps * 2));
  }
  let transitions = null;
  if (mouthTransitionFrames > 0) {
    const mouthTransitions = computeMouthTransitions(mouthStates, mouthTransitionFrames);
    const partsById = new Map(partsSet.parts.map((part) => [part.id, part]));
    transitions = mouthTransitions.map((transition, index) => {
      if (transition === null) return null;
      const emotion = emotionStates?.[index] ?? "neutral";
      return {
        t: transition.t,
        fromRendered: frames[index].map((rendered) => ({
          ...rendered,
          visible: visibleFor(partsById.get(rendered.id), transition.from, eyeStates[index], emotion),
        })),
      };
    });
  }
  return { frames, diagnostics: { follow_lag_frames: followLagFrames }, transitions };
}
