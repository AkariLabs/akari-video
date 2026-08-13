import { smoothSeries } from "../../src/eye-bar/smoothing.mjs";
import { JOINT_NAMES } from "./skeleton.mjs";

function finiteJoint(joint) {
  return Array.isArray(joint?.projection) && joint.projection.length === 2
    && joint.projection.every((value) => Number.isFinite(Number(value)))
    && Number.isFinite(Number(joint?.conf));
}

/** 検出欠落で必ず分割する。補間 hold は作らない。 */
export function extractPoseSegments(track, { bodyIndex = 0 } = {}) {
  if (track?.kind !== "body-pose-3d" || !Array.isArray(track.samples)) return [];
  const segments = [];
  let current = [];
  for (const sample of track.samples) {
    const detection = Array.isArray(sample?.detections) ? sample.detections[bodyIndex] : null;
    const joints = detection?.joints;
    const valid = Number.isFinite(Number(sample?.t)) && joints
      && JOINT_NAMES.every((name) => finiteJoint(joints[name]));
    if (!valid) {
      if (current.length > 0) segments.push(current);
      current = [];
      continue;
    }
    current.push({ t: Number(sample.t), joints });
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

export function smoothPoseSegment(points, smoothing = 5) {
  if (points.length === 0) return [];
  const window = Math.max(1, Math.floor(Number(smoothing)));
  const times = points.map((point) => point.t);
  const smoothedByJoint = {};
  for (const name of JOINT_NAMES) {
    smoothedByJoint[name] = [0, 1].map((axis) => smoothSeries(
      points.map((point) => Number(point.joints[name].projection[axis])),
      times,
      { method: window === 1 ? "none" : "moving-average", window },
    ));
  }
  return points.map((point, index) => ({
    t: point.t,
    joints: Object.fromEntries(JOINT_NAMES.map((name) => [name, {
      ...point.joints[name],
      projection: [smoothedByJoint[name][0][index], smoothedByJoint[name][1][index]],
    }])),
  }));
}

function interpolateJoint(a, b, ratio) {
  const lerp = (x, y) => Number(x) + (Number(y) - Number(x)) * ratio;
  return {
    ...a,
    position: Array.isArray(a.position) && Array.isArray(b.position)
      ? a.position.map((value, index) => lerp(value, b.position[index]))
      : a.position,
    projection: [lerp(a.projection[0], b.projection[0]), lerp(a.projection[1], b.projection[1])],
    conf: lerp(a.conf, b.conf),
  };
}

export function samplePoseAt(points, t) {
  if (points.length === 0) return null;
  if (t <= points[0].t) return { ...points[0], t };
  if (t >= points[points.length - 1].t) return { ...points[points.length - 1], t };
  let high = 1;
  while (high < points.length && points[high].t < t) high += 1;
  const a = points[high - 1];
  const b = points[high];
  const ratio = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
  return {
    t,
    joints: Object.fromEntries(JOINT_NAMES.map((name) => [
      name,
      interpolateJoint(a.joints[name], b.joints[name], ratio),
    ])),
  };
}

export function slicePoseSegment(points, start, end) {
  if (!(end > start) || points.length === 0) return [];
  const sliced = [samplePoseAt(points, start)];
  for (const point of points) if (point.t > start && point.t < end) sliced.push(point);
  sliced.push(samplePoseAt(points, end));
  return sliced.filter(Boolean);
}
