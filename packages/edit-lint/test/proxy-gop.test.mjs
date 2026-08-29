import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(packageRoot, "bin", "edit-lint.mjs");

function commandExists(command) {
  const result = spawnSync(command, ["-version"], { stdio: "ignore" });
  return result.status === 0;
}

const hasMediaTools = commandExists("ffmpeg") && commandExists("ffprobe");

async function writeProject(root) {
  await mkdir(join(root, "assets"), { recursive: true });
  const edit = {
    version: 2,
    output: { width: 64, height: 64, fps: 30 },
    sources: [{ id: "s1", path: "assets/proxy.mp4", proxy: "assets/proxy.mp4" }],
    tracks: [{
      id: "v1",
      lane: "visual",
      items: [{
        id: "clip-1",
        at: 0,
        duration: 150,
        source: { kind: "media", src: "s1", in: 0, out: 5 },
      }],
    }],
  };
  await writeFile(join(root, "edit.json"), `${JSON.stringify(edit, null, 2)}\n`, "utf8");
}

async function makeProject(gopFrames, bFrames = 0) {
  const root = await mkdtemp(join(tmpdir(), "edit-lint-proxy-gop-"));
  await writeProject(root);
  const proxy = join(root, "assets", "proxy.mp4");
  const generated = spawnSync("ffmpeg", [
    "-v", "error",
    "-f", "lavfi", "-i", "testsrc2=s=64x64:r=30:d=5",
    "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-g", String(gopFrames), "-keyint_min", String(gopFrames),
    "-sc_threshold", "0", "-bf", String(bFrames),
    proxy,
  ], { encoding: "utf8", timeout: 60_000 });
  assert.equal(generated.status, 0, generated.stderr || generated.error?.message);
  return root;
}

async function cachedMaximum(project) {
  const cache = JSON.parse(await readFile(
    join(project, ".akari", "cache", "proxy-gop.json"),
    "utf8",
  ));
  assert.equal(Object.keys(cache).length, 1);
  return Object.values(cache)[0].maxKeyframeIntervalSeconds;
}

function run(project, ffprobe) {
  return spawnSync(process.execPath, [
    cliPath,
    project,
    "--json",
    "--ffprobe", ffprobe,
  ], { encoding: "utf8" });
}

test("declared proxies warn only when the maximum GOP exceeds two seconds", {
  skip: !hasMediaTools && "ffmpeg/ffprobe are required",
  timeout: 120_000,
}, async t => {
  const longProject = await makeProject(120);
  const shortProject = await makeProject(30);
  const missingProbeProject = await makeProject(120);
  t.after(async () => {
    await Promise.all([longProject, shortProject, missingProbeProject]
      .map(root => rm(root, { recursive: true, force: true })));
  });

  const longRun = run(longProject, "ffprobe");
  assert.equal(longRun.status, 0, longRun.stderr || longRun.stdout);
  const longResult = JSON.parse(longRun.stdout);
  const warnings = longResult.findings.filter(finding => finding.check === "source.proxy-long-gop");
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].severity, "warning");
  assert.equal(warnings[0].path, "edit.json#sources[0].proxy");
  assert.match(warnings[0].message, /-g <fps> -keyint_min <fps> -sc_threshold 0 -bf 0/u);
  assert.ok(await cachedMaximum(longProject) > 2);

  const shortRun = run(shortProject, "ffprobe");
  assert.equal(shortRun.status, 0, shortRun.stderr || shortRun.stdout);
  assert.equal(
    JSON.parse(shortRun.stdout).findings.filter(finding => finding.check === "source.proxy-long-gop").length,
    0,
  );

  const missingRun = run(missingProbeProject, join(missingProbeProject, "no-such-ffprobe"));
  assert.equal(missingRun.status, 0, missingRun.stderr || missingRun.stdout);
  assert.equal(
    JSON.parse(missingRun.stdout).findings.filter(finding => finding.check === "source.proxy-long-gop").length,
    0,
  );
});

test("a proxy with only one keyframe warns for its full-file GOP", {
  skip: !hasMediaTools && "ffmpeg/ffprobe are required",
  timeout: 120_000,
}, async t => {
  const project = await makeProject(1000);
  t.after(() => rm(project, { recursive: true, force: true }));

  const executed = run(project, "ffprobe");
  assert.equal(executed.status, 0, executed.stderr || executed.stdout);
  const result = JSON.parse(executed.stdout);
  const warnings = result.findings.filter(finding => finding.check === "source.proxy-long-gop");
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].severity, "warning");
  assert.equal(warnings[0].path, "edit.json#sources[0].proxy");
});

test("B-frame proxies are measured by presentation timestamp", {
  skip: !hasMediaTools && "ffmpeg/ffprobe are required",
  timeout: 120_000,
}, async t => {
  const longProject = await makeProject(90, 2);
  const shortProject = await makeProject(30, 2);
  t.after(async () => {
    await Promise.all([longProject, shortProject]
      .map(root => rm(root, { recursive: true, force: true })));
  });

  const longRun = run(longProject, "ffprobe");
  assert.equal(longRun.status, 0, longRun.stderr || longRun.stdout);
  assert.equal(
    JSON.parse(longRun.stdout).findings.filter(finding => finding.check === "source.proxy-long-gop").length,
    1,
  );
  assert.ok(Math.abs(await cachedMaximum(longProject) - 3) < 0.05);

  const shortRun = run(shortProject, "ffprobe");
  assert.equal(shortRun.status, 0, shortRun.stderr || shortRun.stdout);
  assert.equal(
    JSON.parse(shortRun.stdout).findings.filter(finding => finding.check === "source.proxy-long-gop").length,
    0,
  );
  assert.ok(Math.abs(await cachedMaximum(shortProject) - 1) < 0.05);
});

test("packet timestamps are sorted before GOP intervals are measured", async t => {
  const project = await mkdtemp(join(tmpdir(), "edit-lint-proxy-gop-unsorted-"));
  await writeProject(project);
  await writeFile(join(project, "assets", "proxy.mp4"), "fixture", "utf8");
  const ffprobe = join(project, "fake-ffprobe.mjs");
  await writeFile(ffprobe, `#!/usr/bin/env node
process.stdout.write([
  "0.000000,K_",
  "0.500000,__",
  "3.000000,K_",
  "2.500000,__",
  "1.000000,K_",
  "2.000000,K_",
  "4.000000",
].join("\\n") + "\\n");
`, { encoding: "utf8", mode: 0o755 });
  t.after(() => rm(project, { recursive: true, force: true }));

  const executed = run(project, ffprobe);
  assert.equal(executed.status, 0, executed.stderr || executed.stdout);
  assert.equal(
    JSON.parse(executed.stdout).findings.filter(finding => finding.check === "source.proxy-long-gop").length,
    0,
  );
  assert.ok(Math.abs(await cachedMaximum(project) - 1) < 0.001);

  const packetOrder = [0, 3, 1, 2];
  let naiveMaximum = 4 - packetOrder.at(-1);
  for (let index = 1; index < packetOrder.length; index += 1) {
    naiveMaximum = Math.max(naiveMaximum, packetOrder[index] - packetOrder[index - 1]);
  }
  assert.equal(naiveMaximum, 3);
  assert.ok(naiveMaximum > 2, "unsorted packet order would incorrectly produce a warning");
});
