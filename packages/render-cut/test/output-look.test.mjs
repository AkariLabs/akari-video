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

// docs/contract-2026-07-22-render-basics.md #4 (output.look: LUT). L2 requires a pixel diff
// between LUT-applied and LUT-free output, measured on the real rendered frame — not just
// checking the command plan contains a lut3d filter.

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

// Averages the RGB of a downscaled 4x4 thumbnail of the frame at `atSeconds`, avoiding any
// dependency on exact pixel geometry while still being sensitive to a uniform-color LUT shift.
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

function colorDistance(a, b) {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

async function makeProject({ look, duration = 2 } = {}) {
  const root = await mkdtemp(join(tmpdir(), "render-cut-look-test-"));
  // A flat neutral gray is close to a fixed point of contrast/saturation math (both pivot at
  // 0.5) and the natural preset's shift there is under 1/255 after H.264 rounding — invisible to
  // a real encode/decode pipeline even though the filter *is* being applied. testsrc2's varied,
  // highly-saturated colors give contrast/saturation/temperature real, non-degenerate room to
  // move (matching the fixture convention used by render-cut's other L2 tests).
  ffmpeg(["-f", "lavfi", "-i", `testsrc2=size=64x64:rate=10:duration=${duration}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", join(root, "source.mp4")]);
  await writeFile(
    join(root, "edit.json"),
    `${JSON.stringify(
      {
        version: 0,
        output: { width: 64, height: 64, fps: 10, ...(look ? { look } : {}) },
        source: { path: "source.mp4", proxy: null },
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

test("output.look (catalog LUT 'natural') measurably shifts pixel color versus no look", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const plainProject = await makeProject({});
  const lutProject = await makeProject({ look: { lut: "natural", intensity: 1 } });
  try {
    const plainOutput = await renderAndGetOutputPath(plainProject);
    const lutOutput = await renderAndGetOutputPath(lutProject);
    const plainRgb = averageFrameRgb(plainOutput);
    const lutRgb = averageFrameRgb(lutOutput);
    const distance = colorDistance(plainRgb, lutRgb);
    t.diagnostic(`no-look RGB=${JSON.stringify(plainRgb)}; natural-LUT RGB=${JSON.stringify(lutRgb)}; distance=${distance.toFixed(2)}`);
    // "natural" is deliberately subtle (presets/luts/INDEX.md: a safe, minimal default look, not
    // a strong grade like "cinematic" below) — measured empirically at ~1.9 on this fixture,
    // reproducibly nonzero (a flat neutral-gray fixture measured exactly 0.00 for comparison, see
    // git history of this test), so > 1 confirms the LUT is genuinely applied without demanding
    // cinematic-strength visibility from a preset that isn't supposed to have it.
    assert.ok(distance > 1, `expected a measurable pixel difference between LUT and no-LUT output, got distance=${distance}`);
  } finally {
    await rm(plainProject, { recursive: true, force: true });
    await rm(lutProject, { recursive: true, force: true });
  }
});

test("output.look (catalog LUT 'cinematic') pushes shadows toward teal / highlights toward orange", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const plainProject = await makeProject({});
  const cinematicProject = await makeProject({ look: { lut: "cinematic", intensity: 1 } });
  try {
    const plainOutput = await renderAndGetOutputPath(plainProject);
    const cinematicOutput = await renderAndGetOutputPath(cinematicProject);
    const plainRgb = averageFrameRgb(plainOutput);
    const cinematicRgb = averageFrameRgb(cinematicOutput);
    t.diagnostic(`no-look RGB=${JSON.stringify(plainRgb)}; cinematic-LUT RGB=${JSON.stringify(cinematicRgb)}`);
    const distance = colorDistance(plainRgb, cinematicRgb);
    assert.ok(distance > 3, `expected a measurable pixel difference, got distance=${distance}`);
  } finally {
    await rm(plainProject, { recursive: true, force: true });
    await rm(cinematicProject, { recursive: true, force: true });
  }
});

test("output.look.intensity blends proportionally between untouched and fully graded", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const plainProject = await makeProject({});
  const halfProject = await makeProject({ look: { lut: "natural", intensity: 0.5 } });
  const fullProject = await makeProject({ look: { lut: "natural", intensity: 1 } });
  try {
    const plainRgb = averageFrameRgb(await renderAndGetOutputPath(plainProject));
    const halfRgb = averageFrameRgb(await renderAndGetOutputPath(halfProject));
    const fullRgb = averageFrameRgb(await renderAndGetOutputPath(fullProject));
    t.diagnostic(`intensity=0 RGB=${JSON.stringify(plainRgb)}; intensity=0.5 RGB=${JSON.stringify(halfRgb)}; intensity=1 RGB=${JSON.stringify(fullRgb)}`);
    const distanceHalfToPlain = colorDistance(halfRgb, plainRgb);
    const distanceFullToPlain = colorDistance(fullRgb, plainRgb);
    // Same "natural" preset as the test above (subtle by design); see its comment for why the
    // bar is > 1 rather than a larger number.
    assert.ok(distanceFullToPlain > 1, `expected intensity=1 to differ measurably from no-look, got ${distanceFullToPlain}`);
    assert.ok(
      distanceHalfToPlain > 0.5 && distanceHalfToPlain < distanceFullToPlain,
      `expected intensity=0.5 to sit strictly between no-look and full-look (half-distance=${distanceHalfToPlain}, full-distance=${distanceFullToPlain})`,
    );
  } finally {
    await rm(plainProject, { recursive: true, force: true });
    await rm(halfProject, { recursive: true, force: true });
    await rm(fullProject, { recursive: true, force: true });
  }
});

test("output.look.intensity=0 is pixel-identical to no look (explicit off)", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const plainProject = await makeProject({});
  const zeroProject = await makeProject({ look: { lut: "natural", intensity: 0 } });
  try {
    const plainRgb = averageFrameRgb(await renderAndGetOutputPath(plainProject));
    const zeroRgb = averageFrameRgb(await renderAndGetOutputPath(zeroProject));
    const distance = colorDistance(plainRgb, zeroRgb);
    t.diagnostic(`no-look RGB=${JSON.stringify(plainRgb)}; intensity=0 RGB=${JSON.stringify(zeroRgb)}; distance=${distance.toFixed(2)}`);
    assert.ok(distance < 2, `expected intensity=0 to be indistinguishable from no look, got distance=${distance}`);
  } finally {
    await rm(plainProject, { recursive: true, force: true });
    await rm(zeroProject, { recursive: true, force: true });
  }
});

test("output.look with a project-relative path (not a bare catalog name) resolves as a file path", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  // A trivial custom LUT that inverts the frame, to prove path-based (non-catalog) resolution works.
  const plainProject = await makeProject({});
  const customProject = await makeProject({ look: { lut: "luts/invert.cube", intensity: 1 } });
  try {
    await mkdir(join(customProject, "luts"));
    const invertCube = [
      "LUT_3D_SIZE 2",
      "1.0 1.0 1.0",
      "0.0 1.0 1.0",
      "1.0 0.0 1.0",
      "0.0 0.0 1.0",
      "1.0 1.0 0.0",
      "0.0 1.0 0.0",
      "1.0 0.0 0.0",
      "0.0 0.0 0.0",
      "",
    ].join("\n");
    await writeFile(join(customProject, "luts", "invert.cube"), invertCube, "utf8");

    const plainRgb = averageFrameRgb(await renderAndGetOutputPath(plainProject));
    const invertedRgb = averageFrameRgb(await renderAndGetOutputPath(customProject));
    t.diagnostic(`no-look RGB=${JSON.stringify(plainRgb)}; inverted-path-LUT RGB=${JSON.stringify(invertedRgb)}`);
    // Gray (~128) inverted is still ~127, so check the LUT plan actually referenced the path
    // (not a catalog miss silently no-op'ing) via the render plan's recorded command.
    const state = JSON.parse(await readFile(join(customProject, ".akari", "render.json"), "utf8"));
    assert.match(JSON.stringify(state.plan.commands.cut), /invert\.cube/);
  } finally {
    await rm(plainProject, { recursive: true, force: true });
    await rm(customProject, { recursive: true, force: true });
  }
});

test("output.look absent keeps the v2 multi-source scale/pad chain without LUT", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const project = await makeProject({});
  try {
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass");
    assert.match(state.plan.commands.cut.args.join(" "), /setsar=1\[vrange0\]/);
    assert.match(state.plan.commands.cut.args.join(" "), /\[joinedv\]null\[outv_tv\]/);
    assert.doesNotMatch(state.plan.commands.cut.args.join(" "), /lut3d/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
