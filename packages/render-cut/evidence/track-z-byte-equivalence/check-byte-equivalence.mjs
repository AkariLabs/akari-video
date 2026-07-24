// r5c-track-z 検証専用スクリプト（ラッパー作成・「検証 = ラッパー所掌」の fixture）。
// timeline.tracks を宣言しない既存プロジェクト 3 種の render-cut 出力が、実装変更の
// 前後でバイト等価であることを独立に確認する。
//
// 使い方:
//   node check-byte-equivalence.mjs --baseline   # 実装変更「前」に一度だけ実行し baseline-results.json を書く
//   node check-byte-equivalence.mjs --verify      # 実装変更「後」に実行し baseline-results.json と突き合わせる
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderProject } from "../../src/render-cut.mjs";

const evidenceRoot = dirname(fileURLToPath(import.meta.url));
const baselinePath = join(evidenceRoot, "baseline-results.json");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const mode = process.argv.includes("--verify") ? "verify" : "baseline";

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

// Baked alpha layer (ProRes4444, left half opaque yellow / right half transparent) — same
// authoring recipe as test/layers.test.mjs's makeBakedAlphaLayer, proven to survive
// probeHasAlpha()'s alpha-channel detection.
function makeBakedLayer(path, { width = 160, height = 90, duration = 2, fps = 10 } = {}) {
  run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `color=c=0xFFFF00:s=${width}x${height}:d=${duration}:r=${fps}`,
    "-vf", `format=yuva420p,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lt(X,${Math.floor(width / 2)}),255,0)'`,
    "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le",
    path,
  ]);
}

async function sha256File(path) {
  const hash = createHash("sha256");
  hash.update(await readFile(path));
  return hash.digest("hex");
}

async function renderFixture(build) {
  const project = await mkdtemp(join(tmpdir(), "render-cut-track-z-byte-eq-"));
  try {
    process.env.CHROME_PATH = chromePath;
    await mkdir(join(project, ".akari"), { recursive: true });
    await writeFile(join(project, ".akari", "lint.json"), '{"version":1,"verdict":"pass"}\n');
    await build(project);
    const state = await renderProject(project);
    assert.equal(state.verify.verdict, "pass", JSON.stringify(state.verify.findings));
    const outputPath = join(project, state.plan.output);
    return {
      sha256: await sha256File(outputPath),
      duration_seconds: state.artifacts[0].ffprobe.duration_seconds,
      width: state.artifacts[0].ffprobe.width,
      height: state.artifacts[0].ffprobe.height,
      video_codec: state.artifacts[0].ffprobe.video_codec,
    };
  } finally {
    await rm(project, { recursive: true, force: true });
  }
}

const fixtures = {
  "multi-track-cuts-with-layers": async (project) => {
    makeColorSource(join(project, "a.mp4"), "red", 440);
    makeColorSource(join(project, "b.mp4"), "blue", 880);
    makeBakedLayer(join(project, "layer.mov"));
    await writeFile(
      join(project, "edit.json"),
      `${JSON.stringify(
        {
          version: 1,
          output: { width: 320, height: 180, fps: 10 },
          sources: [
            { id: "a", path: "a.mp4", proxy: null },
            { id: "b", path: "b.mp4", proxy: null },
          ],
          cuts: [
            { src: "a", in: 0, out: 1, at: 0, track: 0 },
            { src: "b", in: 0, out: 1, at: 1, track: 0 },
            { src: "a", in: 1, out: 1.5, at: 0.5, track: 1 },
          ],
          overlays: [],
          layers: [
            { id: "l1", t: 0.2, duration: 1, kind: "baked", src: "layer.mov", track: 0 },
          ],
        },
        null,
        2,
      )}\n`,
    );
  },
  "sequential-transition": async (project) => {
    makeColorSource(join(project, "src.mp4"), "green", 220, 3);
    await writeFile(
      join(project, "edit.json"),
      `${JSON.stringify(
        {
          version: 0,
          output: { width: 320, height: 180, fps: 10 },
          source: { path: "src.mp4", proxy: null },
          cuts: [
            { in: 0, out: 1.5, transition_out: { type: "dissolve", duration: 0.3 } },
            { in: 1.5, out: 3 },
          ],
          overlays: [],
        },
        null,
        2,
      )}\n`,
    );
  },
  // No overlays/captions.json here: this sandboxed shell environment's headless Chrome hangs
  // until timeout on every rasterizer path (hyperframes absent, puppeteer-core absent,
  // static-screenshot spawnSync times out even with --headless=new --no-sandbox --disable-gpu --
  // confirmed independently, unrelated to this task, reproducible with a bare Chrome invocation
  // using rasterize.mjs's exact flags). This fixture instead exercises the "video" layer kind +
  // chroma_key branch (layers.mjs's non-baked path), which is pure ffmpeg and Chrome-free, to keep
  // byte-equivalence coverage independently verifiable in this environment. Overlay/caption
  // rasterization is untouched by this task (rasterizeAndComposite runs unconditionally after the
  // cuts+layers stage) and is covered instead by the existing render-cut test suite passing
  // unchanged (captions/overlay .test.mjs files assert on generated commands/HTML, not real Chrome
  // pixels, so they do not hit this environment limitation).
  "chroma-key-video-layer": async (project) => {
    makeColorSource(join(project, "src.mp4"), "purple", 330, 3);
    run("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "color=c=0x00FF00:s=160x90:d=2:r=10",
      "-vf", "drawbox=x=32:y=18:w=96:h=54:color=white:t=fill",
      "-c:v", "libx264", "-pix_fmt", "yuv420p",
      join(project, "pinp.mp4"),
    ]);
    await writeFile(
      join(project, "edit.json"),
      `${JSON.stringify(
        {
          version: 0,
          output: { width: 320, height: 180, fps: 10 },
          source: { path: "src.mp4", proxy: null },
          cuts: [{ in: 0, out: 3 }],
          overlays: [],
          layers: [
            {
              id: "l1",
              t: 0.3,
              duration: 1.5,
              kind: "video",
              src: "pinp.mp4",
              chroma_key: { color: "0x00FF00" },
            },
          ],
        },
        null,
        2,
      )}\n`,
    );
  },
};

const results = {};
for (const [name, build] of Object.entries(fixtures)) {
  results[name] = await renderFixture(build);
  process.stdout.write(`${name}: ${JSON.stringify(results[name])}\n`);
}

if (mode === "baseline") {
  await writeFile(baselinePath, `${JSON.stringify(results, null, 2)}\n`, "utf8");
  process.stdout.write(`baseline written: ${baselinePath}\n`);
} else {
  const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
  let allMatch = true;
  for (const name of Object.keys(fixtures)) {
    const before = baseline[name];
    const after = results[name];
    const match = before && before.sha256 === after.sha256;
    if (!match) allMatch = false;
    process.stdout.write(
      `${name}: ${match ? "BYTE-IDENTICAL" : "MISMATCH"} before=${before?.sha256 ?? "missing"} after=${after.sha256}\n`,
    );
  }
  await writeFile(
    join(evidenceRoot, "verify-results.json"),
    `${JSON.stringify({ verdict: allMatch ? "pass" : "fail", baseline, after: results }, null, 2)}\n`,
    "utf8",
  );
  if (!allMatch) {
    process.exitCode = 1;
  }
}
