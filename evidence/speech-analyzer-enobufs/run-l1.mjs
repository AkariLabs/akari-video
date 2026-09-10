#!/usr/bin/env node
// L1 実測: 長尺音声（SpeechAnalyzer ヘルパーの JSON 出力が 1 MiB を超える長さ）で
// `media transcribe <wav> --backend speech-analyzer` が ENOBUFS で落ちないこと。
//
//   node evidence/speech-analyzer-enobufs/run-l1.mjs [--baseline-rev 8e96e81f] [--loops 6] [--out l1-results.json]
//
// - 合成音声は mkdtemp の下に作り（`say -v Kyoko` の日本語 → ffmpeg `-stream_loop` で伸ばす）、終了時に必ず削除する
// - 修正前（baseline）は `git archive <rev> packages presets skills` の複製を一時ディレクトリへ展開して同じ CLI を叩く
// - ヘルパーの生 JSON はヘルパーを直接叩いてバイト数・words 数を記録する（CLI 経路の一時ファイルは終了時に消えるため）
// - 出力 JSON の作業機パスは <TMP> / <WORKTREE> / <HOME> / <TMPDIR> に置換する

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ONE_MIB = 1024 * 1024;
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
};
const baselineRev = option("--baseline-rev", "8e96e81f");
const loops = Number(option("--loops", "6"));
const outPath = path.resolve(option("--out", path.join(here, "l1-results.json")));

// 認識語数を稼ぐための日本語本文（ヘルパーの locale は ja-JP 固定なので日本語で喋らせる）
const paragraph = [
  "これは長時間の収録を想定した文字起こしの試験です。この段落は、認識される単語の数を増やして、出力が一メガバイトを大きく超えるようにするためだけに用意しています。",
  "朝になるとパン屋は日の出前に店を開け、焼きたてのパンの香りが広場に漂い、子どもたちは学校に行く前にそこへ集まります。",
  "午後には市場が開き、りんご、なし、はちみつ、チーズ、そして丘で摘んだ色とりどりの花を売る人たちでにぎわいます。",
  "やわらかな風が教会の鐘の音を屋根の上へ運び、漁師は湖から銀色のますでいっぱいの籠を持って戻ってきます。",
  "夕方になると細い通りの街灯がひとつずつ灯り、近所の人たちは木のベンチに腰かけて、収穫のこと、天気のこと、そしてきっとまたやって来る長い冬のことを語り合います。",
  "数字も試験に役立ちます。一、二、三、四、五、六、七、八、九、十、十一、十二、十三、十四、十五、十六、十七、十八、十九、二十。",
  "色も同じです。赤、橙、黄、緑、青、藍、紫、黒、白、灰色、茶色、桃色、銀、金。",
  "最後に短い文をいくつか。猫が眠る。犬が吠える。鳥が歌う。時計が時を刻む。列車は定刻に出発する。授業はここで終わり、また始まります。",
].join("");

function run(command, argv, options = {}) {
  const started = performance.now();
  const result = spawnSync(command, argv, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...options });
  return {
    exit: result.status,
    signal: result.signal ?? null,
    errorCode: result.error?.code ?? null,
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
    [realpathSync(os.tmpdir()), "<TMPDIR>"],
    [os.tmpdir().replace(/\/$/, ""), "<TMPDIR>"],
    [realpathSync(os.homedir()), "<HOME>"],
    [os.homedir(), "<HOME>"],
  ];
  return (text) => candidates.reduce((acc, [from, to]) => acc.split(from).join(to), String(text));
}

function durationSeconds(file) {
  const probe = run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  return Number(probe.stdout.trim());
}

function summarizeTranscribe(stdout) {
  try {
    const value = JSON.parse(stdout);
    const segments = Array.isArray(value.segments) ? value.segments : [];
    return {
      backend: value.backend,
      range: value.range,
      no_speech: value.no_speech,
      segmentsCount: segments.length,
      wordsCount: segments.reduce((count, segment) => count + (Array.isArray(segment.words) ? segment.words.length : 0), 0),
      firstSegment: segments[0] ? { start: segments[0].start, end: segments[0].end, textHead: String(segments[0].text ?? "").slice(0, 40) } : null,
      lastSegment: segments.at(-1) ? { start: segments.at(-1).start, end: segments.at(-1).end } : null,
      cacheHit: value.cache?.hit ?? null,
      stdoutBytes: Buffer.byteLength(stdout),
    };
  } catch {
    return null;
  }
}

async function main() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "akari-sa-enobufs-"));
  const redact = redactor(tmp);
  const results = { generatedAt: new Date().toISOString(), node: process.version, macos: run("sw_vers", ["-productVersion"]).stdout.trim(), baselineRev, tmpDir: "<TMP>" };
  try {
    // 1. 合成音声: say（Kyoko・16 kHz mono）→ -stream_loop で伸ばす
    const textPath = path.join(tmp, "text.txt");
    writeFileSync(textPath, `${Array.from({ length: 12 }, () => paragraph).join("\n")}\n`, "utf8");
    const baseWav = path.join(tmp, "base.wav");
    const say = run("say", ["-v", "Kyoko", "-o", baseWav, "--file-format=WAVE", "--data-format=LEI16@16000", "-f", textPath]);
    if (say.exit !== 0) throw new Error(`say failed: ${say.stderr}`);
    const longWav = path.join(tmp, "long.wav");
    const loop = run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-stream_loop", String(loops), "-i", baseWav, "-c:a", "pcm_s16le", longWav]);
    if (loop.exit !== 0) throw new Error(`ffmpeg loop failed: ${loop.stderr}`);
    results.synth = {
      voice: "Kyoko (ja_JP)", baseSeconds: Number(durationSeconds(baseWav).toFixed(2)), loops,
      longSeconds: Number(durationSeconds(longWav).toFixed(2)), longBytes: statSync(longWav).size,
      sayWallSeconds: say.wallSeconds, ffmpegWallSeconds: loop.wallSeconds,
    };

    // 2. ヘルパーの生 JSON（バイト数・words 数）。CLI が渡すのと同じ共有ヘルパーを直接叩く
    const helperBin = path.join(os.tmpdir(), "akari-speech-analyzer", "speechanalyzer-helper");
    const helperOut = path.join(tmp, "helper.json");
    const fd = openSync(helperOut, "w");
    let helper;
    try {
      helper = run(helperBin, [longWav], { stdio: ["ignore", fd, "pipe"] });
    } finally {
      closeSync(fd);
    }
    const helperBytes = statSync(helperOut).size;
    const helperJson = helper.exit === 0 ? JSON.parse(readFileSync(helperOut, "utf8")) : null;
    results.helper = {
      exit: helper.exit, wallSeconds: helper.wallSeconds, stderr: redact(helper.stderr.trim()),
      jsonBytes: helperBytes, exceedsOneMiB: helperBytes > ONE_MIB, ratioToOneMiB: Number((helperBytes / ONE_MIB).toFixed(2)),
      segmentsCount: helperJson?.segments?.length ?? null,
      segmentWordsCount: helperJson ? helperJson.segments.reduce((count, segment) => count + (segment.words?.length ?? 0), 0) : null,
      allWordsCount: helperJson?.words?.length ?? null,
      engine: helperJson?.engine ?? null, locale: helperJson?.locale ?? null,
    };
    if (!(helperBytes > ONE_MIB)) throw new Error(`helper JSON is not > 1 MiB (${helperBytes})`);

    // 3. 修正前（git archive の複製）
    const baselineDir = path.join(tmp, "baseline");
    mkdirSync(baselineDir, { recursive: true });
    execFileSync("sh", ["-c", `git archive ${baselineRev} packages presets skills | tar -x -C "${baselineDir}"`], { cwd: repoRoot, stdio: ["ignore", "ignore", "inherit"] });
    const baselineCli = path.join(baselineDir, "packages", "akari-tools", "bin", "media.mjs");
    const before = run(process.execPath, [baselineCli, "transcribe", longWav, "--backend", "speech-analyzer", "--no-record"], { cwd: tmp });
    results.before = {
      exit: before.exit, wallSeconds: before.wallSeconds,
      stderr: redact(before.stderr.trim()), stdout: redact(before.stdout.trim()),
      enobufs: /ENOBUFS/.test(before.stderr + before.stdout),
    };

    // 4. 修正後（この worktree の CLI）
    const cli = path.join(repoRoot, "packages", "akari-tools", "bin", "media.mjs");
    const after = run(process.execPath, [cli, "transcribe", longWav, "--backend", "speech-analyzer", "--no-record"], { cwd: tmp });
    results.after = {
      exit: after.exit, wallSeconds: after.wallSeconds,
      stderr: redact(after.stderr.trim()),
      enobufs: /ENOBUFS/.test(after.stderr + after.stdout),
      transcribe: summarizeTranscribe(after.stdout),
    };
    results.verdict = {
      beforeFailsWithEnobufs: before.exit !== 0 && results.before.enobufs,
      afterSucceeds: after.exit === 0 && !results.after.enobufs && (results.after.transcribe?.segmentsCount ?? 0) > 0,
    };
  } finally {
    await rm(tmp, { recursive: true, force: true });
    results.cleanup = { tmpRemoved: !existsSync(tmp) };
  }
  writeFileSync(outPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(results.verdict));
}

main().catch((error) => {
  console.error(error?.stack ?? String(error));
  process.exitCode = 1;
});
