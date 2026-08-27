import assert from "node:assert/strict";
import test from "node:test";

import { buildMultiSourceCutCommand } from "../src/plan.mjs";

function filterComplex(command) {
  const index = command.args.indexOf("-filter_complex");
  assert.notEqual(index, -1, "the cut command must contain a filter graph");
  return command.args[index + 1];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function graphTimebase(graph, label, seen = new Set()) {
  assert.ok(!seen.has(label), `cycle while resolving ${label}`);
  const nextSeen = new Set(seen).add(label);
  const segments = graph.split(";");
  const outputPattern = new RegExp(`${escapeRegExp(label)}(?:\\[[^\\]]+\\])?$`, "u");
  const producer = segments.find((segment) => outputPattern.test(segment));
  assert.ok(producer, `missing producer for ${label}\n${graph}`);

  if (producer.includes(`settb=AVTB${label}`)) return "AVTB";

  if (producer.includes("concat=")) {
    // ffmpeg's concat filter emits video on AVTB. This is the important accumulator case:
    // a hard boundary may sit between two transition boundaries, and its output then becomes
    // the first input of the following xfade.
    return "AVTB";
  }

  if (producer.includes("xfade=")) {
    const match = producer.match(/^(\[[^\]]+\])(\[[^\]]+\])xfade=.*?(\[[^\]]+\])$/u);
    assert.ok(match, `could not parse xfade producer for ${label}: ${producer}`);
    const left = graphTimebase(graph, match[1], nextSeen);
    const right = graphTimebase(graph, match[2], nextSeen);
    assert.equal(left, right, `xfade inputs disagree in ${producer}`);
    return left;
  }

  return "unknown";
}

function assertTransitionGraphUsesAvtb(command, cutCount) {
  const graph = filterComplex(command);
  const segments = graph.split(";");
  const xfadeSegments = segments.filter((segment) => segment.includes("xfade="));
  const concatSegments = segments.filter((segment) => /concat=.*\[(?:vacc\d+|joinedv)\]/u.test(segment));

  assert.ok(xfadeSegments.length > 0, graph);
  for (let index = 0; index < cutCount; index += 1) {
    assert.match(
      graph,
      new RegExp(`\\[vpre${index}\\]settb=AVTB\\[v${index}\\]`, "u"),
      `cut ${index} must be normalized only after its final fps/transform/composite stage`,
    );
  }

  for (const segment of xfadeSegments) {
    const match = segment.match(/^(\[[^\]]+\])(\[[^\]]+\])xfade=.*?(\[[^\]]+\])$/u);
    assert.ok(match, `could not parse xfade segment: ${segment}`);
    assert.equal(graphTimebase(graph, match[1]), "AVTB", segment);
    assert.equal(graphTimebase(graph, match[2]), "AVTB", segment);
    assert.equal(graphTimebase(graph, match[3]), "AVTB", segment);
  }

  for (const segment of concatSegments) {
    const videoOutput = segment.match(/(\[(?:vacc\d+|joinedv)\])(?:\[aacc\d+\]|\[joineda\])$/u)?.[1];
    assert.ok(videoOutput, `could not parse concat video output: ${segment}`);
    assert.equal(graphTimebase(graph, videoOutput), "AVTB", segment);
  }
}

const cases = [
  {
    name: "MP4/audio, transition at the first boundary",
    fps: 30,
    sources: [
      { id: "a", path: "/project/a-24fps.mp4", hasAudio: true, width: 320, height: 180 },
      { id: "b", path: "/project/b-30fps.mp4", hasAudio: true, width: 320, height: 180 },
    ],
    cuts: [
      { src: "a", in: 0, out: 2, transition_out: { type: "dissolve", duration: 0.5 } },
      { src: "b", in: 0, out: 2 },
      { src: "a", in: 0, out: 1 },
    ],
  },
  {
    name: "MOV/video-only, concat accumulator feeds a later transition",
    fps: 30,
    sources: [
      { id: "a", path: "/project/a-30fps.mov", hasAudio: false, width: 320, height: 180 },
      { id: "b", path: "/project/b-30fps.mov", hasAudio: false, width: 320, height: 180 },
      { id: "c", path: "/project/c-30fps.mov", hasAudio: false, width: 320, height: 180 },
    ],
    cuts: [
      { src: "a", in: 0, out: 1 },
      { src: "b", in: 0, out: 1, transition_out: { type: "dissolve", duration: 0.25 } },
      { src: "c", in: 0, out: 1 },
    ],
  },
  {
    name: "MKV/audio, consecutive transition boundaries",
    fps: 24,
    sources: [
      { id: "a", path: "/project/a-60fps.mkv", hasAudio: true, width: 640, height: 360 },
      { id: "b", path: "/project/b-24fps.mkv", hasAudio: true, width: 640, height: 360 },
      { id: "c", path: "/project/c-30fps.mkv", hasAudio: true, width: 640, height: 360 },
    ],
    cuts: [
      { src: "a", in: 0, out: 1, transition_out: { type: "dissolve", duration: 0.25 } },
      { src: "b", in: 0, out: 1, transition_out: { type: "dissolve", duration: 0.25 } },
      { src: "c", in: 0, out: 1 },
    ],
  },
  {
    name: "still image/video-only with transform and a concat between transitions",
    fps: 30,
    sources: [
      { id: "still", path: "/project/still.png", hasAudio: false, width: 640, height: 360 },
      { id: "video", path: "/project/video.mp4", hasAudio: false, width: 640, height: 360 },
    ],
    cuts: [
      {
        src: "still",
        in: 0,
        out: 1,
        transform: { scale: 1.1, x: 4, y: -2 },
        transition_out: { type: "dissolve", duration: 0.25 },
      },
      { src: "video", in: 0, out: 1, transform: { scale: 1.05 } },
      { src: "still", in: 0, out: 1, transition_out: { type: "dissolve", duration: 0.25 } },
      { src: "video", in: 1, out: 2 },
    ],
  },
];

test("transition plans normalize every xfade input and concat video output to AVTB", () => {
  for (const scenario of cases) {
    const command = buildMultiSourceCutCommand({
      sourceInputs: scenario.sources,
      cutPath: "/project/.akari/cut.mp4",
      cuts: scenario.cuts,
      width: 320,
      height: 180,
      fps: scenario.fps,
      ffmpegCommand: "ffmpeg",
      ffprobeCommand: null,
      projectRoot: "/project",
    });
    assert.doesNotThrow(
      () => assertTransitionGraphUsesAvtb(command, scenario.cuts.length),
      scenario.name,
    );
  }
});
