#!/usr/bin/env node
// L1 実測: 2 GiB 超の素材で `media probe` / `media transcribe` が ERR_FS_FILE_TOO_LARGE で落ちないこと。
//
//   node evidence/transcribe-large-file-hash/run-l1.mjs [--baseline-rev f955a97d] [--seconds 19] [--out l1-results.json]
//
// - 合成素材は mktemp の下に作り、終了時に必ず削除する（2.3 GiB を残さない）
// - 修正前（baseline）は `git archive <rev> packages presets` の複製を一時ディレクトリへ展開して同じ CLI を叩く
// - 出力 JSON の作業機パスは <TMP> / <WORKTREE> / <HOME> に置換する

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TWO_GIB = 2 ** 31;
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
};
const baselineRev = option("--baseline-rev", "f955a97d");
const seconds = Number(option("--seconds", "19"));
const outPath = path.resolve(option("--out", path.join(here, "l1-results.json")));

function run(command, argv, options = {}) {
  const started = performance.now();
  const result = spawnSync(command, argv, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options });
  return {
    exit: result.status,
    wallSeconds: Number(((performance.now() - started) / 1000).toFixed(2)),
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function redactor(tmp) {
  const candidates = [
    [realpathSync(tmp), "<TMP>"],
    [tmp, "<TMP>"],
    [realpathSync(repoRoot), "<WORKTREE>"],
    [repoRoot, "<WORKTREE>"],
    [realpathSync(os.homedir()), "<HOME>"],
    [os.homedir(), "<HOME>"],
    [realpathSync(os.tmpdir()), "<TMPDIR>"],
    [os.tmpdir(), "<TMPDIR>"],
  ];
  return (text) => candidates.reduce((acc, [from, to]) => acc.split(from).join(to), String(text));
}

function summarizeTranscribe(stdout) {
  try {
    const value = JSON.parse(stdout);
    return {
      backend: value.backend,
      range: value.range,
      no_speech: value.no_speech,
      segmentsCount: Array.isArray(value.segments) ? value.segments.length : null,
      cacheKey: value.cache?.key ?? null,
      cacheHit: value.cache?.hit ?? null,
    };
  } catch {
    return null;
  }
}

async function main() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "akari-large-file-hash-"));
  const redact = redactor(tmp);
  const results = { generatedAt: new Date().toISOString(), node: process.version, baselineRev, tmpDir: "<TMP>" };
  try {
    // 1. 合成（rawvideo uyvy422 1080p ≈ 4.1 MB/frame × 30 fps）。yuv420p は mov に入れられないので uyvy422 を使う
    const source = path.join(tmp, "out.mov");
    const synth = run("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30",
      "-f", "lavfi", "-i", "sine=frequency=440",
      "-t", String(seconds), "-c:v", "rawvideo", "-pix_fmt", "uyvy422", "-c:a", "pcm_s16le", source,
    ]);
    if (synth.exit !== 0) throw new Error(`ffmpeg synth failed: ${synth.stderr}`);
    const sizeBytes = statSync(source).size;
    results.synth = { seconds, sizeBytes, exceedsTwoGiB: sizeBytes > TWO_GIB, ffmpegWallSeconds: synth.wallSeconds };
    if (sizeBytes <= TWO_GIB) throw new Error(`synthesized file is not > 2 GiB (${sizeBytes})`);

    // 2. 参照ハッシュ（shasum -a 256）
    const shasum = run("shasum", ["-a", "256", source]);
    const referenceSha256 = shasum.stdout.trim().split(/\s+/)[0];
    results.reference = { sha256: referenceSha256, shasumWallSeconds: shasum.wallSeconds };

    // 3. 修正前（git archive の複製）
    const baselineDir = path.join(tmp, "baseline");
    mkdirSync(baselineDir, { recursive: true });
    execFileSync("sh", ["-c", `git archive ${baselineRev} packages presets | tar -x -C "${baselineDir}"`], { cwd: repoRoot, stdio: ["ignore", "ignore", "inherit"] });
    const baselineCli = path.join(baselineDir, "packages", "akari-tools", "bin", "media.mjs");
    const baselineProbe = run(process.execPath, [baselineCli, "probe", source, "--no-record"], { cwd: tmp });
    const baselineTranscribe = run(process.execPath, [baselineCli, "transcribe", source, "--backend", "whisper-cpp", "--no-record"], { cwd: tmp });
    let baselineDirect;
    try {
      const common = await import(pathToFileURL(path.join(baselineDir, "packages", "akari-tools", "src", "media", "common.mjs")).href);
      const value = await common.sha256File(source);
      baselineDirect = { threw: false, value };
    } catch (error) {
      baselineDirect = { threw: true, code: error.code, name: error.name, message: error.message };
    }
    results.before = {
      probe: { exit: baselineProbe.exit, stderr: redact(baselineProbe.stderr.trim()), stdout: redact(baselineProbe.stdout.trim()) },
      transcribe: { exit: baselineTranscribe.exit, stderr: redact(baselineTranscribe.stderr.trim()), stdout: redact(baselineTranscribe.stdout.trim()) },
      sha256FileDirect: baselineDirect,
    };

    // 4. 修正後（この worktree の CLI）
    const cli = path.join(repoRoot, "packages", "akari-tools", "bin", "media.mjs");
    const probe = run(process.execPath, [cli, "probe", source, "--no-record"], { cwd: tmp });
    const probeJson = probe.exit === 0 ? JSON.parse(probe.stdout) : null;
    results.after = {
      probe: {
        exit: probe.exit,
        wallSeconds: probe.wallSeconds,
        stderr: redact(probe.stderr.trim()),
        stderrMentionsTwoGiB: /greater than 2 GiB/.test(probe.stderr),
        sha256: probeJson?.sha256 ?? null,
        sha256MatchesShasum: probeJson?.sha256 === referenceSha256,
        size_bytes: probeJson?.size_bytes ?? null,
        container: probeJson?.container ?? null,
        duration_s: probeJson?.duration_s ?? null,
        video: probeJson?.video ?? null,
        audio: probeJson?.audio ?? null,
      },
    };

    const { resolveWhisper } = await import(pathToFileURL(path.join(repoRoot, "packages", "akari-tools", "src", "media", "transcribe.mjs")).href);
    const backend = resolveWhisper() ? "whisper-cpp" : "speech-analyzer";
    const transcribe = run(process.execPath, [cli, "transcribe", source, "--backend", backend, "--no-record"], { cwd: tmp });
    results.after.transcribe = {
      backendRequested: backend,
      exit: transcribe.exit,
      wallSeconds: transcribe.wallSeconds,
      stderr: redact(transcribe.stderr.trim()),
      stderrMentionsTwoGiB: /greater than 2 GiB/.test(transcribe.stderr),
      result: summarizeTranscribe(transcribe.stdout),
      cacheKeyStartsWithShasum: summarizeTranscribe(transcribe.stdout)?.cacheKey?.startsWith(referenceSha256) ?? false,
    };

    // 5. ハッシュ単体の秒数（ストリーム版 sha256File を直接呼ぶ）
    const common = await import(pathToFileURL(path.join(repoRoot, "packages", "akari-tools", "src", "media", "common.mjs")).href);
    const hashStarted = performance.now();
    const hashed = await common.sha256File(source);
    const hashSeconds = Number(((performance.now() - hashStarted) / 1000).toFixed(2));
    const memory = process.memoryUsage();
    // 小ファイルでも readFile 一括ハッシュと同値であること（キャッシュ鍵互換）+ 戻り値が Promise であること
    const small = path.join(here, "run-l1.mjs");
    const smallPending = common.sha256File(small);
    const smallExpected = createHash("sha256").update(readFileSync(small)).digest("hex");
    results.after.sha256FileDirect = {
      sha256: hashed,
      matchesShasum: hashed === referenceSha256,
      hashSeconds,
      throughputMiBPerSecond: Number((sizeBytes / 1048576 / hashSeconds).toFixed(1)),
      rssMiB: Math.round(memory.rss / 1048576),
      heapUsedMiB: Math.round(memory.heapUsed / 1048576),
      isPromise: smallPending instanceof Promise,
      smallFileMatchesReadFile: (await smallPending) === smallExpected,
    };

    results.verdict = {
      beforeFailsWithErrFsFileTooLarge:
        results.before.probe.exit !== 0 && results.before.transcribe.exit !== 0 && baselineDirect.code === "ERR_FS_FILE_TOO_LARGE",
      afterProbeOk: probe.exit === 0 && !results.after.probe.stderrMentionsTwoGiB && results.after.probe.sha256MatchesShasum,
      afterTranscribeOk: transcribe.exit === 0 && !results.after.transcribe.stderrMentionsTwoGiB && results.after.transcribe.cacheKeyStartsWithShasum,
      smallFileMatchesReadFile: results.after.sha256FileDirect.smallFileMatchesReadFile,
    };
    results.verdict.pass = Object.values(results.verdict).every(Boolean);
  } finally {
    await rm(tmp, { recursive: true, force: true });
    results.cleanup = { tmpRemoved: !existsSync(tmp) };
  }
  writeFileSync(outPath, `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify({ out: redact(outPath), verdict: results.verdict, cleanup: results.cleanup }));
  if (!results.verdict.pass) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
