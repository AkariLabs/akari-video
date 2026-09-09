// L1: 実素材で書き出し、重なりありプロジェクトの尺と字幕の周回数を実測する。
// 使い方: node evidence/export-caption-clock-multitrack/run-l1.mjs [--baseline <修正前リポの絶対パス>]
// 一時ディレクトリ以外へは書かない（AKARI_HOME も一時ディレクトリへ隔離する）。
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const baselineIndex = process.argv.indexOf("--baseline");
const baselineRepo = baselineIndex > 0 ? process.argv[baselineIndex + 1] : null;
const ffmpeg = join(repo, "packages/media-bin/vendor/darwin-arm64/ffmpeg");
const ffprobe = join(repo, "packages/media-bin/vendor/darwin-arm64/ffprobe");
const work = realpathSync(mkdtempSync(join(tmpdir(), "akari-caption-l1-")));
const akariHome = join(work, "akari-home");
mkdirSync(akariHome, { recursive: true });

const scrub = (text) => String(text)
  .replaceAll(repo, "<WORKTREE>")
  .replaceAll(baselineRepo ?? "<no-baseline-sentinel>", "<BASELINE>")
  .replaceAll(work, "<TMP>")
  .replaceAll(homedir(), "<HOME>")
  .replaceAll(tmpdir().replace(/\/$/u, ""), "<TMP_ROOT>");
const run = (command, args, cwd = work) => {
  const result = spawnSync(command, args, {
    cwd, encoding: "utf8", timeout: 900000, maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, AKARI_HOME: akariHome },
  });
  return {
    exit: result.status, signal: result.signal,
    stdout: scrub(result.stdout ?? ""), stderr: scrub(result.stderr ?? ""),
  };
};
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

// 素材: 暗い背景 + 上部を動く小さなパターン（下 4 割の字幕帯は暗いまま = 白文字が判定できる）。
const makeSource = (path, seconds) => {
  const result = run(ffmpeg, [
    "-v", "error", "-y",
    "-f", "lavfi", "-i", "color=c=0x0a0f18:s=640x360:r=30",
    "-f", "lavfi", "-i", "testsrc2=s=128x72:r=30",
    "-filter_complex", "[0][1]overlay=x='mod(t*40,512)':y=16:shortest=1,format=yuv420p",
    "-frames:v", String(Math.round(seconds * 30)), "-c:v", "libx264", "-preset", "veryfast", path,
  ]);
  if (result.exit !== 0) throw new Error(`ffmpeg source failed: ${result.stderr}`);
};

const CUE_WINDOWS = [
  [0.59, 2.1], [3, 5], [6, 7.5], [8, 9.5], [10, 11.5],
  [12, 13.5], [14, 15.5], [16, 17.5], [18, 19.5], [20, 21.5],
  [23, 24.5], [26, 27.5], [30, 31.5], [34, 35.9],
];
const captions = CUE_WINDOWS.map(([start, end], index) => ({
  id: `c-${String(index + 1).padStart(4, "0")}`,
  start, end, text: `CUE ${index + 1}`,
  speaker: null, sourceRef: null, edited: false,
  src: "src-1", time_domain: "source",
}));

const writeProject = (root, items) => {
  mkdirSync(root, { recursive: true });
  makeSource(join(root, "source.mp4"), 37.6);
  writeFileSync(join(root, "edit.json"), JSON.stringify({
    version: 2,
    output: { width: 640, height: 360, fps: 30 },
    sources: [{ id: "src-1", path: "source.mp4" }],
    tracks: items.map((item, index) => ({
      id: `visual-${index}`, lane: "visual",
      items: [{
        id: `clip-${index}`, at: item.atFrames, duration: 1128,
        source: { kind: "media", src: "src-1", in: 0, out: 37.6 },
      }],
    })),
  }, null, 2) + "\n");
  writeFileSync(join(root, "captions.json"), JSON.stringify(captions, null, 2) + "\n");
  const lint = run(process.execPath, [join(repo, "packages/edit-lint/bin/edit-lint.mjs"), root]);
  if (lint.exit !== 0) throw new Error(`edit-lint failed: ${lint.stdout}${lint.stderr}`);
  return lint;
};

// --out はプロジェクト内でなければ verify が拒む（render output is not a regular contained project file）。
const exportWith = (fromRepo, projectRoot, outPath) => run(process.execPath, [
  join(fromRepo, "packages/render-cut/bin/render-cut.mjs"), projectRoot,
  "--out", outPath, "--no-settle",
]);

const probe = (path) => {
  const result = run(ffprobe, ["-v", "error", "-show_format", "-show_streams", "-print_format", "json", path]);
  const parsed = JSON.parse(result.stdout || "{}");
  if (!parsed.format) return { error: result.stderr.trim() || "no output file" };
  return {
    durationSeconds: Number(parsed.format.duration),
    videoStream: (parsed.streams ?? []).filter((stream) => stream.codec_type === "video")
      .map(({ codec_name, width, height, nb_frames, avg_frame_rate }) =>
        ({ codec_name, width, height, nb_frames, avg_frame_rate }))[0],
  };
};

// 字幕帯（下 4 割）に白い文字画素があるか。素材側は暗いので閾値ひとつで判定できる。
const captionBandBrightPixels = (videoPath, second, pngPath) => {
  const png = run(ffmpeg, ["-v", "error", "-y", "-ss", String(second), "-i", videoPath,
    "-frames:v", "1", pngPath]);
  if (png.exit !== 0) throw new Error(`frame grab failed at ${second}s: ${png.stderr}`);
  const raw = spawnSync(ffmpeg, ["-v", "error", "-ss", String(second), "-i", videoPath,
    "-frames:v", "1", "-vf", "crop=640:144:0:216", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
    { maxBuffer: 32 * 1024 * 1024 });
  if (raw.status !== 0) throw new Error(`raw grab failed at ${second}s`);
  let bright = 0;
  for (const value of raw.stdout) if (value > 200) bright += 1;
  return bright;
};

// 区間の中点で撮る（境界ちょうどはフェード両端に当たり誤診する — skills/verify §L1）。
// 修正後の射影: 可視ラン [0,0.4) t0 / [0.4,4.8) t1 / [4.8,42.4) t2。
// cue1 (src 0.59-2.1) は t1 で出力 [0.99,2.5]、t2 で出力 [5.39,6.9]。cue14 (src 34-35.9) は t2 で [38.8,40.7]。
const SAMPLES = [
  ["cue1-on-first-visible-run", 1.75],
  ["cue1-on-last-visible-run", 6.1],
  ["cue14-near-tail", 39.7],
  ["after-last-cue", 41.5],
];
const results = { generatedAt: new Date().toISOString(), multitrack: {}, serial: {} };
try {
  // --- 1) 重なり 3 本（at 0 / 12f / 144f、すべて同じ src の 0..37.6s） ---
  const multitrack = join(work, "multitrack");
  const multitrackLint = writeProject(multitrack, [{ atFrames: 0 }, { atFrames: 12 }, { atFrames: 144 }]);
  results.multitrack.lint = {
    exit: multitrackLint.exit,
    verdict: JSON.parse(readFileSync(join(multitrack, ".akari/lint.json"), "utf8")).verdict,
  };

  mkdirSync(join(multitrack, "exports"), { recursive: true });
  const fixedOut = join(multitrack, "exports/multitrack-fixed.mp4");
  const fixedExport = exportWith(repo, multitrack, fixedOut);
  results.multitrack.fixed = {
    export: { exit: fixedExport.exit, stdoutTail: fixedExport.stdout.trim().split("\n").slice(-3), stderrTail: fixedExport.stderr.trim().split("\n").slice(-5) },
    probe: probe(fixedOut),
    captionBandBrightPixels: {},
  };
  for (const [label, second] of SAMPLES) {
    results.multitrack.fixed.captionBandBrightPixels[`${label}@${second}s`] =
      captionBandBrightPixels(fixedOut, second, join(here, `frame-fixed-${label}.png`));
  }

  if (baselineRepo) {
    // 修正前の書き出しは同内容の別プロジェクト（同じ生成手順の素材・同じ captions.json）で撮る。
    const multitrackBase = join(work, "multitrack-baseline");
    const lint = writeProject(multitrackBase, [{ atFrames: 0 }, { atFrames: 12 }, { atFrames: 144 }]);
    mkdirSync(join(multitrackBase, "exports"), { recursive: true });
    const baseOut = join(multitrackBase, "exports/multitrack-baseline.mp4");
    const baseExport = exportWith(baselineRepo, multitrackBase, baseOut);
    results.multitrack.baseline = {
      lintExit: lint.exit,
      export: { exit: baseExport.exit, stdoutTail: baseExport.stdout.trim().split("\n").slice(-3), stderrTail: baseExport.stderr.trim().split("\n").slice(-5) },
      probe: probe(baseOut),
      captionBandBrightPixels: {},
    };
    if (!results.multitrack.baseline.probe.error) {
      for (const [label, second] of SAMPLES) {
        results.multitrack.baseline.captionBandBrightPixels[`${label}@${second}s`] =
          captionBandBrightPixels(baseOut, second, join(here, `frame-baseline-${label}.png`));
      }
    }
  }

  // --- 2) 単一トラック直列（同じ素材・同じ字幕）: 修正前後で mp4 の byte 一致 ---
  const serial = join(work, "serial");
  writeProject(serial, [{ atFrames: 0 }]);
  mkdirSync(join(serial, "exports"), { recursive: true });
  const serialFixedOut = join(serial, "exports/serial-fixed.mp4");
  const serialFixedExport = exportWith(repo, serial, serialFixedOut);
  results.serial.fixed = {
    exit: serialFixedExport.exit,
    bytes: readFileSync(serialFixedOut).length,
    sha256: sha256(serialFixedOut),
  };
  if (baselineRepo) {
    rmSync(join(serial, ".akari"), { recursive: true, force: true });
    rmSync(join(serial, "render-tmp"), { recursive: true, force: true });
    run(process.execPath, [join(baselineRepo, "packages/edit-lint/bin/edit-lint.mjs"), serial]);
    const serialBaseOut = join(serial, "exports/serial-baseline.mp4");
    const serialBaseExport = exportWith(baselineRepo, serial, serialBaseOut);
    results.serial.baseline = {
      exit: serialBaseExport.exit,
      bytes: readFileSync(serialBaseOut).length,
      sha256: sha256(serialBaseOut),
    };
    results.serial.byteIdentical = results.serial.fixed.sha256 === results.serial.baseline.sha256;
  }

  // --- 3) 後始末の実測: 起動した Electron / Helper が残っていないこと ---
  const ps = spawnSync("/bin/sh", ["-c",
    `ps -eo pid,ppid,args | grep -F -e '${work}' -e '${repo}/node_modules/electron' | grep -v grep | grep -v -F 'run-l1.mjs' | wc -l`],
    { encoding: "utf8" });
  results.leftoverElectronProcesses = Number(ps.stdout.trim());
} finally {
  writeFileSync(join(here, "l1-results.json"), scrub(JSON.stringify(results, null, 2)) + "\n");
  rmSync(work, { recursive: true, force: true });
}
console.log(readFileSync(join(here, "l1-results.json"), "utf8"));
