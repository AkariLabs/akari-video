import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile as rawWriteFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { legacyRenderArgs } from "./helpers/render-engine.mjs";
import { createMigratingWriteFile } from "./helpers/v2-fixture.mjs";

const writeFile = createMigratingWriteFile(rawWriteFile);

// docs/contract-2026-07-22-render-basics.md #2 (source.chroma_key). L2 requires a pixel sample
// from the real rendered output proving the green background was actually replaced, not just
// that the command plan mentions chromakey/overlay.

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(packageRoot, "bin", "render-cut.mjs");

function run(project, args = []) {
  // This suite measures legacy filtergraph output; engine resolution has separate unit coverage.
  return spawnSync(process.execPath, [cliPath, project, ...legacyRenderArgs(args)], { encoding: "utf8" });
}

function ffmpeg(args) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result;
}

function averageFrameRgb(filePath, atSeconds = 0) {
  const result = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(atSeconds), "-i", filePath, "-frames:v", "1", "-vf", "scale=4:4", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { encoding: "buffer" },
  );
  assert.equal(result.status, 0, result.stderr.toString("utf8"));
  const buf = result.stdout;
  const pixelCount = buf.length / 3;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < pixelCount; i += 1) {
    r += buf[i * 3];
    g += buf[i * 3 + 1];
    b += buf[i * 3 + 2];
  }
  return { r: r / pixelCount, g: g / pixelCount, b: b / pixelCount };
}

// docs/contract-2026-07-22-render-basics.md #2: "緑背景フィクスチャは ffmpeg lavfi で自作してよい".
async function makeProject({ chromaKey, duration = 2 } = {}) {
  // Deliberately avoids "chromakey" in the prefix: the non-regression test below greps the
  // rendered command's args string (which includes this temp directory's own path) for
  // "chromakey=" and a matching substring in the directory name would be a false positive.
  const root = await mkdtemp(join(tmpdir(), "render-cut-ck-test-"));
  ffmpeg(["-f", "lavfi", "-i", `color=c=0x00FF00:s=64x64:d=${duration}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", join(root, "source.mp4")]);
  await writeFile(
    join(root, "edit.json"),
    `${JSON.stringify(
      {
        version: 0,
        output: { width: 64, height: 64, fps: 10 },
        source: { path: "source.mp4", proxy: null, ...(chromaKey ? { chroma_key: chromaKey } : {}) },
        cuts: [{ in: 0, out: duration }],
        overlays: [],
      },
      null,
      2,
    )}\n`,
  );
  await mkdir(join(root, ".akari"));
  await writeFile(join(root, ".akari", "lint.json"), '{"version":1,"verdict":"pass"}\n');
  return root;
}

async function renderAndGetOutputPath(project) {
  const executed = run(project);
  assert.equal(executed.status, 0, executed.stderr);
  const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
  assert.equal(state.verify.verdict, "pass");
  return join(project, state.artifacts[0].path);
}

test("source.chroma_key with a solid-color background replaces the green screen with that color", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const project = await makeProject({
    chromaKey: { color: "#00ff00", similarity: 0.4, blend: 0.1, background: "#0000ff" },
  });
  try {
    const rgb = averageFrameRgb(await renderAndGetOutputPath(project));
    t.diagnostic(`chroma-keyed frame RGB=${JSON.stringify(rgb)} (expected close to blue 0,0,255)`);
    assert.ok(rgb.b > 180, `expected a strongly blue background, got ${JSON.stringify(rgb)}`);
    assert.ok(rgb.g < 80, `expected the green screen to be gone, got ${JSON.stringify(rgb)}`);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("source.chroma_key with an image-file background replaces the green screen with that image's color", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const project = await makeProject({
    chromaKey: { color: "#00ff00", similarity: 0.4, blend: 0.1, background: "bg.png" },
  });
  try {
    ffmpeg(["-f", "lavfi", "-i", "color=c=0xFF8800:s=32x32:d=1", "-frames:v", "1", join(project, "bg.png")]);
    const rgb = averageFrameRgb(await renderAndGetOutputPath(project));
    t.diagnostic(`chroma-keyed frame RGB=${JSON.stringify(rgb)} (expected close to orange 255,136,0)`);
    // 0xFF8800 = (255, 136, 0); checking against the actual background color (not a bare "green
    // is gone" threshold, since this background's own G channel is 136 -- a low-G check would be
    // wrong for this specific color, independent of whether the key worked).
    assert.ok(rgb.r > 230, `expected R close to 255, got ${JSON.stringify(rgb)}`);
    assert.ok(Math.abs(rgb.g - 136) < 20, `expected G close to 136, got ${JSON.stringify(rgb)}`);
    assert.ok(rgb.b < 20, `expected B close to 0 (no residual green screen blue/green), got ${JSON.stringify(rgb)}`);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("source.chroma_key absent leaves the green screen untouched (non-regression)", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const project = await makeProject({});
  try {
    const rgb = averageFrameRgb(await renderAndGetOutputPath(project));
    t.diagnostic(`no chroma_key frame RGB=${JSON.stringify(rgb)} (expected close to green 0,255,0)`);
    assert.ok(rgb.g > 200, `expected the green screen to remain, got ${JSON.stringify(rgb)}`);

    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.doesNotMatch(state.plan.commands.cut.args.join(" "), /chromakey=/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
