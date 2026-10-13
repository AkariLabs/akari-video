import { spawnSync } from "node:child_process";
import { isAbsolute, resolve } from "node:path";
import { renderText } from "./i18n.mjs";

const WIDTH = 32;
const HEIGHT = 18;

function sampleFrame(command, path, seconds, spawn) {
  const result = spawn(command, ["-v", "error", "-nostdin", "-ss", String(seconds),
    "-i", path, "-frames:v", "1", "-vf", `scale=${WIDTH}:${HEIGHT}:flags=area`,
    "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
  { encoding: null, timeout: 30_000, maxBuffer: WIDTH * HEIGHT * 3 + 4096 });
  return result.status === 0 && result.stdout?.length === WIDTH * HEIGHT * 3
    ? result.stdout : null;
}

function meanDifference(left, right) {
  let total = 0;
  for (let index = 0; index < left.length; index++) total += Math.abs(left[index] - right[index]);
  return total / left.length;
}

// Compare output moments across the base track against their declared source moments
// and the moments one leading-gap later. A strong match to the latter proves a
// shifted picture; overlays, static footage and unavailable frames remain inconclusive.
export function verifyLeadingGap({ outputPath, edit, inputs, projectRoot = null, ffmpegCommand, spawnSyncImpl = spawnSync }) {
  const cuts = Array.isArray(edit?.cuts) ? edit.cuts : [];
  const baseTrack = cuts.length > 0
    ? Math.min(...cuts.map(cut => Number.isInteger(cut.track) ? cut.track : 0)) : 0;
  const baseCuts = cuts.filter(cut => (Number.isInteger(cut.track) ? cut.track : 0) === baseTrack);
  const gap = Number(baseCuts[0]?.at);
  if (!(gap > 0.2)) return null;
  const paths = new Map(inputs.filter(input => typeof input.path === "string")
    .map(input => [input.id, isAbsolute(input.path) ? input.path
      : projectRoot ? resolve(projectRoot, input.path) : null]));
  const segments = [];
  let cursor = 0;
  for (const cut of baseCuts) {
    const speed = Number(cut.speed) > 0 ? Number(cut.speed) : 1;
    const duration = (Number(cut.out) - Number(cut.in)) / speed;
    if (!(duration > 0)) continue;
    const at = Number.isFinite(cut.at) && cut.at >= 0 ? Number(cut.at) : cursor;
    segments.push({ cut, speed, at, end: at + duration, path: paths.get(cut.src) });
    const freeze = Number(cut.freeze?.duration_sec) > 0 ? Number(cut.freeze.duration_sec) : 0;
    const overlap = Number(cut.transition_out?.duration ?? cut.transitionOut?.duration);
    cursor = at + duration + freeze - (Number.isFinite(overlap) && overlap > 0 ? overlap : 0);
  }
  const sourceAt = seconds => {
    const active = segments.filter(segment => !segment.cut.freeze
      && segment.at + 0.15 < seconds && seconds < segment.end - 0.15 && segment.path);
    return active.length === 1 ? active[0] : null;
  };
  let good = null;
  const step = Math.max(1, Math.ceil(segments.length / 12));
  for (let index = 0; index < segments.length; index += step) {
    const segment = segments[index];
    const local = Math.min(0.35, (segment.end - segment.at) / 2);
    const time = segment.at + local;
    const expected = sourceAt(time);
    const advanced = sourceAt(time + gap);
    if (!expected || !advanced) continue;
    const outputFrame = sampleFrame(ffmpegCommand, outputPath, time, spawnSyncImpl);
    const expectedFrame = sampleFrame(ffmpegCommand, expected.path,
      Number(expected.cut.in) + (time - expected.at) * expected.speed, spawnSyncImpl);
    const earlyFrame = sampleFrame(ffmpegCommand, advanced.path,
      Number(advanced.cut.in) + (time + gap - advanced.at) * advanced.speed, spawnSyncImpl);
    if (!outputFrame || !expectedFrame || !earlyFrame) continue;
    const expectedDifference = meanDifference(outputFrame, expectedFrame);
    const earlyDifference = meanDifference(outputFrame, earlyFrame);
    const sourceDifference = meanDifference(expectedFrame, earlyFrame);
    if (sourceDifference < 12) continue;
    const values = { gap: gap.toFixed(2), expected: expectedDifference.toFixed(1), early: earlyDifference.toFixed(1) };
    if (earlyDifference < expectedDifference * 0.6 && earlyDifference < sourceDifference * 0.6) {
      return { severity: "error", check: "verify.leading-gap-sync",
        message: renderText("render.verify.leadingGap.early", values) };
    }
    if (expectedDifference < earlyDifference * 0.6 && expectedDifference < sourceDifference * 0.6) {
      good = { severity: "info", check: "verify.leading-gap-sync",
        message: renderText("render.verify.leadingGap.ok", values) };
    }
  }
  return good;
}
