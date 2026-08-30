const PROPERTY_DEFAULTS = Object.freeze({ x: 0, y: 0, scale: 1, rotate: 0, opacity: 1 });
const TRANSFORM_PROPERTIES = new Set(["x", "y", "scale", "rotate"]);
const CUBIC_BEZIER_PATTERN = /^cubic-bezier\(\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*,\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*,\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*,\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*\)$/iu;

function finiteNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function rounded(value) {
  return Number(Number(value).toFixed(9));
}

function cubicCoordinateAt(parameter, first, second) {
  const inverse = 1 - parameter;
  return 3 * inverse * inverse * parameter * first
    + 3 * inverse * parameter * parameter * second
    + parameter * parameter * parameter;
}

function cubicBezierAt(progress, x1, y1, x2, y2) {
  if (![x1, y1, x2, y2].every(Number.isFinite) || x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) {
    return progress;
  }
  if (x1 === y1 && x2 === y2) return progress;
  let lower = 0;
  let upper = 1;
  for (let index = 0; index < 32; index += 1) {
    const parameter = (lower + upper) / 2;
    if (cubicCoordinateAt(parameter, x1, x2) < progress) lower = parameter;
    else upper = parameter;
  }
  return cubicCoordinateAt((lower + upper) / 2, y1, y2);
}

function easingAt(name, progress) {
  const value = clamp(progress);
  switch (name) {
    case "hold": return 0;
    case "ease-in-out":
    case "in-out-cubic": return value < 0.5
      ? 4 * value * value * value
      : 1 - ((-2 * value + 2) ** 3) / 2;
    case "in-quad": return value * value;
    case "out-quad": return 1 - (1 - value) ** 2;
    case "in-out-quad": return value < 0.5
      ? 2 * value * value
      : 1 - ((-2 * value + 2) ** 2) / 2;
    case "in-cubic": return value ** 3;
    case "out-cubic": return 1 - (1 - value) ** 3;
    case "in-quart": return value ** 4;
    case "out-quart": return 1 - (1 - value) ** 4;
    case "in-out-quart": return value < 0.5
      ? 8 * value ** 4
      : 1 - ((-2 * value + 2) ** 4) / 2;
    case "in-expo": return value === 0 ? 0 : 2 ** (10 * value - 10);
    case "out-expo": return value === 1 ? 1 : 1 - 2 ** (-10 * value);
    case "in-out-expo":
      if (value === 0 || value === 1) return value;
      return value < 0.5
        ? 2 ** (20 * value - 10) / 2
        : (2 - 2 ** (-20 * value + 10)) / 2;
    case "in-back": {
      const c1 = 1.70158;
      return (c1 + 1) * value ** 3 - c1 * value ** 2;
    }
    case "out-back": {
      const c1 = 1.70158;
      return 1 + (c1 + 1) * (value - 1) ** 3 + c1 * (value - 1) ** 2;
    }
    case "in-out-back": {
      const c2 = 1.70158 * 1.525;
      return value < 0.5
        ? ((2 * value) ** 2 * ((c2 + 1) * 2 * value - c2)) / 2
        : (((2 * value - 2) ** 2 * ((c2 + 1) * (value * 2 - 2) + c2)) + 2) / 2;
    }
    case "out-bounce": {
      const n1 = 7.5625;
      const d1 = 2.75;
      if (value < 1 / d1) return n1 * value * value;
      if (value < 2 / d1) {
        const shifted = value - 1.5 / d1;
        return n1 * shifted * shifted + 0.75;
      }
      if (value < 2.5 / d1) {
        const shifted = value - 2.25 / d1;
        return n1 * shifted * shifted + 0.9375;
      }
      const shifted = value - 2.625 / d1;
      return n1 * shifted * shifted + 0.984375;
    }
    case "out-elastic": {
      if (value === 0 || value === 1) return value;
      return 2 ** (-10 * value) * Math.sin((value * 10 - 0.75) * (2 * Math.PI / 3)) + 1;
    }
    case "linear": return value;
    default: {
      const match = typeof name === "string" ? name.match(CUBIC_BEZIER_PATTERN) : null;
      if (!match) return value;
      return cubicBezierAt(value, ...match.slice(1).map(Number));
    }
  }
}

function easingFor(point, property) {
  const easing = point?.easing;
  if (typeof easing === "string") return easing;
  if (!easing || typeof easing !== "object" || Array.isArray(easing)) return "linear";
  const direct = easing[property];
  if (typeof direct === "string") return direct;
  if (TRANSFORM_PROPERTIES.has(property) && typeof easing.transform === "string") return easing.transform;
  const nested = easing.transform?.[property];
  return typeof nested === "string" ? nested : "linear";
}

function pointValue(point, property) {
  const value = TRANSFORM_PROPERTIES.has(property) ? point?.transform?.[property] : point?.[property];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function interpolateProperty(points, property, localFrame, fallback) {
  const declared = points
    .map((point) => ({ point, value: pointValue(point, property) }))
    .filter((entry) => entry.value !== undefined);
  if (declared.length === 0) return fallback;
  if (declared.length === 1) return declared[0].value;
  if (localFrame <= declared[0].point.t) return declared[0].value;
  const last = declared[declared.length - 1];
  if (localFrame >= last.point.t) return last.value;
  for (let index = 0; index < declared.length - 1; index += 1) {
    const start = declared[index];
    const end = declared[index + 1];
    if (localFrame >= end.point.t) continue;
    const span = end.point.t - start.point.t;
    if (!(span > 0)) return end.value;
    const progress = (localFrame - start.point.t) / span;
    const eased = easingAt(easingFor(end.point, property), progress);
    return start.value + (end.value - start.value) * eased;
  }
  return last.value;
}

function interpolateKeyframes(points, localFrame, { statics = {} } = {}) {
  const fallback = Object.fromEntries(Object.entries(PROPERTY_DEFAULTS).map(([property, value]) => [
    property,
    finiteNumber(statics?.[property], value),
  ]));
  const usable = Array.isArray(points)
    ? points.filter((point) => point && typeof point === "object" && !Array.isArray(point)
      && typeof point.t === "number" && Number.isFinite(point.t) && point.t >= 0)
      .slice()
      .sort((left, right) => left.t - right.t)
    : [];
  const frame = finiteNumber(localFrame, 0);
  if (usable.length < 2) return { ...fallback };
  const result = {};
  for (const property of Object.keys(PROPERTY_DEFAULTS)) {
    result[property] = rounded(interpolateProperty(usable, property, frame, fallback[property]));
  }
  result.opacity = rounded(clamp(result.opacity));
  return result;
}

if (typeof window !== "undefined") {
  window.akari = window.akari || {};
  window.akari.keyframes = Object.freeze({ interpolateKeyframes });
}

export { interpolateKeyframes };
