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

async function makeProject(gopFrames) {
  const root = await mkdtemp(join(tmpdir(), "edit-lint-proxy-gop-"));
  await mkdir(join(root, "assets"), { recursive: true });
  const proxy = join(root, "assets", "proxy.mp4");
  const generated = spawnSync("ffmpeg", [
    "-v", "error",
    "-f", "lavfi", "-i", "testsrc2=s=64x64:r=30:d=5",
    "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-g", String(gopFrames), "-keyint_min", String(gopFrames),
    "-sc_threshold", "0", "-bf", "0",
    proxy,
  ], { encoding: "utf8", timeout: 60_000 });
  assert.equal(generated.status, 0, generated.stderr || generated.error?.message);
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
  return root;
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
  const cache = JSON.parse(await readFile(
    join(longProject, ".akari", "cache", "proxy-gop.json"),
    "utf8",
  ));
  assert.equal(Object.keys(cache).length, 1);
  assert.ok(Object.values(cache)[0].maxKeyframeIntervalSeconds > 2);

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
