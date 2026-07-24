// r5c-track-z 検証専用スクリプト（ラッパー作成・「検証 = ラッパー所掌」の fixture）。
// L2 受け入れ条件 #1: 交互スタック（下から cuts0 -> layers0 -> cuts1）で cuts1 が
// layers0 のテロップより前面に出ること・宣言順を入れ替えると前後が反転することを
// 実レンダリング + ピクセル実測で確認する。Chrome 不要（cuts + layers は純 ffmpeg 合成）。
//
// 設計:
//   cuts track0 = 緑（土台。常時 [0,3) で存在）
//   layers track0 = 完全不透明の黄色いテロップ相当（[0.5, 2.5) で存在、alpha=255）
//   cuts track1 = 青（[1, 2.5) で存在。layers0 と重なる窓を持つ）
//   サンプル時刻 t=2.0s: track1(青) と layers0(黄) の重なり窓の内側
//     - stack-a: timeline.tracks = [cuts0, layers0, cuts1]  -> cuts1 が最前面 -> 青が見えるはず
//     - stack-b: timeline.tracks = [cuts0, cuts1, layers0]  -> layers0 が最前面 -> 黄が見えるはず
//   サンプル時刻 t=0.2s: どちらのスタックでも layers0/cuts1 未活性 -> 緑（cuts0）が見えるはず（土台の透過が正しく機能する回帰チェック）
//
// 使い方: node check-interleaved-stack.mjs [--out <path>]
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderProject } from "../../src/render-cut.mjs";

const evidenceRoot = dirname(fileURLToPath(import.meta.url));
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  assert.equal(result.status, 0, result.stderr);
  return result;
}

function makeColorSource(path, color, frequency, duration = 3) {
  run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `color=c=${color}:s=320x180:r=10:d=${duration}`,
    "-f", "lavfi", "-i", `sine=frequency=${frequency}:sample_rate=48000:duration=${duration}`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path,
  ]);
}

// Fully opaque (alpha=255 everywhere) yellow layer clip so the sampled pixel is unambiguous
// (pure yellow) whenever this layer wins the z-order, regardless of what's beneath it.
function makeOpaqueTelopLayer(path, { width = 320, height = 180, duration = 2, fps = 10 } = {}) {
  run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `color=c=0xFFFF00:s=${width}x${height}:d=${duration}:r=${fps}`,
    "-vf", "format=yuva420p,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255'",
    "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le",
    path,
  ]);
}

function samplePixel(filePath, time, x, y) {
  const result = spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-ss", String(time), "-i", filePath,
    "-vf", `crop=2:2:${x}:${y},format=rgb24`,
    "-frames:v", "1", "-f", "rawvideo", "pipe:1",
  ]);
  assert.equal(result.status, 0, result.stderr?.toString());
  return { r: result.stdout[0], g: result.stdout[1], b: result.stdout[2] };
}

function classify(pixel) {
  const { r, g, b } = pixel;
  if (r > 180 && g > 180 && b < 100) return "yellow(layers0)";
  if (b > 150 && r < 100 && g < 100) return "blue(cuts1)";
  if (g > 100 && r < 50 && b < 50) return "green(cuts0)";
  return `unknown(${r},${g},${b})`;
}

async function sha256File(path) {
  const hash = createHash("sha256");
  hash.update(await readFile(path));
  return hash.digest("hex");
}

async function buildProject({ trackOrder }) {
  const project = await mkdtemp(join(tmpdir(), "render-cut-track-z-interleave-"));
  process.env.CHROME_PATH = chromePath;
  await mkdir(join(project, ".akari"), { recursive: true });
  await writeFile(join(project, ".akari", "lint.json"), '{"version":1,"verdict":"pass"}\n');
  makeColorSource(join(project, "green.mp4"), "green", 220, 3);
  makeColorSource(join(project, "blue.mp4"), "blue", 660, 2);
  makeOpaqueTelopLayer(join(project, "telop.mov"), { duration: 2 });

  const tracksByKey = {
    cuts0: { id: "t-cuts0", kind: "cuts", ref: 0 },
    layers0: { id: "t-layers0", kind: "layers", ref: 0 },
    cuts1: { id: "t-cuts1", kind: "cuts", ref: 1 },
  };

  await writeFile(
    join(project, "edit.json"),
    `${JSON.stringify(
      {
        version: 1,
        output: { width: 320, height: 180, fps: 10 },
        sources: [
          { id: "g", path: "green.mp4", proxy: null },
          { id: "b", path: "blue.mp4", proxy: null },
        ],
        cuts: [
          { src: "g", in: 0, out: 3, at: 0, track: 0 },
          { src: "b", in: 0, out: 1.5, at: 1, track: 1 },
        ],
        overlays: [],
        layers: [
          { id: "l1", t: 0.5, duration: 2, kind: "baked", src: "telop.mov", track: 0 },
        ],
        timeline: { tracks: trackOrder.map((key) => tracksByKey[key]) },
      },
      null,
      2,
    )}\n`,
  );
  return project;
}

async function renderAndSample(trackOrder) {
  const project = await buildProject({ trackOrder });
  try {
    const state = await renderProject(project);
    assert.equal(state.verify.verdict, "pass", JSON.stringify(state.verify.findings));
    const outputPath = join(project, state.plan.output);
    const overlapPixel = samplePixel(outputPath, 2.0, 159, 89);
    const basePixel = samplePixel(outputPath, 0.2, 159, 89);
    return {
      track_order: trackOrder,
      output_sha256: await sha256File(outputPath),
      "t=2.0s (cuts1 x layers0 overlap window)": { rgb: overlapPixel, classified: classify(overlapPixel) },
      "t=0.2s (base track only, regression check)": { rgb: basePixel, classified: classify(basePixel) },
    };
  } finally {
    await rm(project, { recursive: true, force: true });
  }
}

const stackA = await renderAndSample(["cuts0", "layers0", "cuts1"]);
const stackB = await renderAndSample(["cuts0", "cuts1", "layers0"]);

const result = {
  "stack-a (cuts1 declared frontmost)": stackA,
  "stack-b (layers0 declared frontmost, reversed)": stackB,
  expectation: {
    "stack-a t=2.0s": "blue(cuts1)",
    "stack-b t=2.0s": "yellow(layers0)",
    "both t=0.2s": "green(cuts0)",
  },
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
await writeFile(join(evidenceRoot, "result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
