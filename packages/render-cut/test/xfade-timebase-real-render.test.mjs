import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile as rawWriteFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createMigratingWriteFile } from "./helpers/v2-fixture.mjs";

const writeFile = createMigratingWriteFile(rawWriteFile);
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(packageRoot, "bin", "render-cut.mjs");

function run(project) {
  return spawnSync(process.execPath, [cliPath, project], { encoding: "utf8" });
}

function ffmpeg(args) {
  const result = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y", ...args],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
}

function averageFrameRgb(filePath, atSeconds) {
  const result = spawnSync(
    "ffmpeg",
    [
      "-hide_banner", "-loglevel", "error", "-y",
      "-ss", String(atSeconds), "-i", filePath,
      "-frames:v", "1", "-vf", "scale=4:4",
      "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
    ],
    { encoding: "buffer" },
  );
  assert.equal(result.status, 0, result.stderr.toString("utf8"));
  assert.equal(result.stdout.length, 4 * 4 * 3);

  let r = 0;
  let g = 0;
  let b = 0;
  for (let index = 0; index < result.stdout.length; index += 3) {
    r += result.stdout[index];
    g += result.stdout[index + 1];
    b += result.stdout[index + 2];
  }
  return { r: r / 16, g: g / 16, b: b / 16 };
}

function makeColorSource(root, { name, color, frequency }) {
  const path = join(root, `${name}.mp4`);
  ffmpeg([
    "-f", "lavfi", "-i", `color=c=${color}:s=64x64:r=10:d=1.5`,
    "-f", "lavfi", "-i", `sine=frequency=${frequency}:sample_rate=48000:duration=1.5`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-shortest", path,
  ]);
  return path;
}

async function makeProject() {
  const root = await mkdtemp(join(tmpdir(), "render-cut-xfade-timebase-real-"));
  makeColorSource(root, { name: "red", color: "red", frequency: 330 });
  makeColorSource(root, { name: "lime", color: "lime", frequency: 440 });
  makeColorSource(root, { name: "blue", color: "blue", frequency: 550 });

  await writeFile(
    join(root, "edit.json"),
    `${JSON.stringify(
      {
        version: 1,
        output: { width: 64, height: 64, fps: 10 },
        sources: [
          { id: "red", path: "red.mp4", proxy: null },
          { id: "lime", path: "lime.mp4", proxy: null },
          { id: "blue", path: "blue.mp4", proxy: null },
        ],
        cuts: [
          { src: "red", in: 0, out: 1.2, transform: { scale: 1.1 } },
          {
            src: "lime",
            in: 0,
            out: 1.2,
            transition_out: { type: "dissolve", duration: 0.4 },
          },
          { src: "blue", in: 0, out: 1.2 },
        ],
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

test("a transformed three-cut timeline renders concat output into a later dissolve with a real blend", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  if (spawnSync("ffprobe", ["-version"]).status !== 0) return t.skip("ffprobe unavailable");

  const project = await makeProject();
  try {
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);

    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass", JSON.stringify(state.verify.findings, null, 2));

    const graph = state.plan.commands.cut.args[
      state.plan.commands.cut.args.indexOf("-filter_complex") + 1
    ];
    assert.equal((graph.match(/xfade=/gu) ?? []).length, 1, graph);
    assert.ok((graph.match(/concat=n=2/gu) ?? []).length >= 1, graph);
    assert.match(graph, /\[vacc1\]\[v2\]xfade=/u);
    assert.ok((graph.match(/overlay=/gu) ?? []).length >= 3, graph);

    const outputPath = join(project, state.artifacts[0].path);
    const before = averageFrameRgb(outputPath, 1.6);
    const middle = averageFrameRgb(outputPath, 2.2);
    const after = averageFrameRgb(outputPath, 2.8);
    t.diagnostic(`before=${JSON.stringify(before)} middle=${JSON.stringify(middle)} after=${JSON.stringify(after)}`);

    assert.ok(before.g > 200 && before.r < 40 && before.b < 40, `expected solid lime before dissolve: ${JSON.stringify(before)}`);
    assert.ok(after.b > 200 && after.r < 40 && after.g < 40, `expected solid blue after dissolve: ${JSON.stringify(after)}`);
    assert.ok(
      middle.g > 60 && middle.b > 60 && middle.r < 40,
      `expected lime/blue blend at dissolve midpoint: ${JSON.stringify(middle)}`,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
