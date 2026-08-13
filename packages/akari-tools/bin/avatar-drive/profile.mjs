export const DEFAULT_PROFILE = Object.freeze({
  sampleRate: 4800,
  midThreshold: 0.025,
  openThreshold: 0.075,
  hysteresis: 0.008,
  attackMs: 35,
  releaseMs: 120,
  blinkPeriod: 4.2,
  blinkJitter: 1.2,
  blinkDuration: 0.12,
});

function finite(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${name} は有限数である必要があります`);
  return number;
}

export function normalizeProfile(value = {}) {
  const profile = {
    sampleRate: finite(value.sampleRate ?? DEFAULT_PROFILE.sampleRate, "sampleRate"),
    midThreshold: finite(value.midThreshold ?? DEFAULT_PROFILE.midThreshold, "midThreshold"),
    openThreshold: finite(value.openThreshold ?? DEFAULT_PROFILE.openThreshold, "openThreshold"),
    hysteresis: finite(value.hysteresis ?? DEFAULT_PROFILE.hysteresis, "hysteresis"),
    attackMs: finite(value.attackMs ?? DEFAULT_PROFILE.attackMs, "attackMs"),
    releaseMs: finite(value.releaseMs ?? DEFAULT_PROFILE.releaseMs, "releaseMs"),
    blinkPeriod: finite(value.blinkPeriod ?? DEFAULT_PROFILE.blinkPeriod, "blinkPeriod"),
    blinkJitter: finite(value.blinkJitter ?? DEFAULT_PROFILE.blinkJitter, "blinkJitter"),
    blinkDuration: finite(value.blinkDuration ?? DEFAULT_PROFILE.blinkDuration, "blinkDuration"),
  };
  if (!Number.isInteger(profile.sampleRate) || profile.sampleRate < 1000) {
    throw new Error("sampleRate は 1000 以上の整数である必要があります");
  }
  if (!(profile.midThreshold >= 0 && profile.openThreshold > profile.midThreshold)) {
    throw new Error("閾値は 0 <= midThreshold < openThreshold である必要があります");
  }
  if (!(profile.hysteresis >= 0 && profile.hysteresis < profile.openThreshold - profile.midThreshold)) {
    throw new Error("hysteresis は 0 以上かつ 2 閾値の間隔未満である必要があります");
  }
  if (!(profile.attackMs > 0 && profile.releaseMs > 0)) {
    throw new Error("attackMs / releaseMs は正数である必要があります");
  }
  if (!(profile.blinkPeriod > 0 && profile.blinkJitter >= 0
      && profile.blinkJitter < profile.blinkPeriod && profile.blinkDuration > 0)) {
    throw new Error("まばたきは period > jitter >= 0、duration > 0 である必要があります");
  }
  return profile;
}

function smoothingFactor(dt, milliseconds) {
  return 1 - Math.exp(-dt / (milliseconds / 1000));
}

/** RMS 列を、アタック/リリース平滑 + 2 閾値ヒステリシスで口 3 状態へ変換する。 */
export function envelopeToMouthStates(rmsValues, fps, profileValue = {}) {
  const profile = normalizeProfile(profileValue);
  if (!(Number.isFinite(fps) && fps > 0)) throw new Error("fps は正数である必要があります");
  const dt = 1 / fps;
  const attack = smoothingFactor(dt, profile.attackMs);
  const release = smoothingFactor(dt, profile.releaseMs);
  const halfHysteresis = profile.hysteresis / 2;
  const midOn = profile.midThreshold + halfHysteresis;
  const midOff = Math.max(0, profile.midThreshold - halfHysteresis);
  const openOn = profile.openThreshold + halfHysteresis;
  const openOff = Math.max(midOn, profile.openThreshold - halfHysteresis);
  const states = [];
  const smoothed = [];
  let level = 0;
  let state = "closed";

  for (const value of rmsValues) {
    const target = Math.max(0, Number.isFinite(value) ? value : 0);
    level += (target - level) * (target > level ? attack : release);
    if (state === "closed") {
      if (level >= openOn) state = "open";
      else if (level >= midOn) state = "mid";
    } else if (state === "mid") {
      if (level >= openOn) state = "open";
      else if (level < midOff) state = "closed";
    } else if (level < openOff) {
      state = level < midOff ? "closed" : "mid";
    }
    smoothed.push(level);
    states.push(state);
  }
  return { states, smoothed };
}

