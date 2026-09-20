// 不具合メモ第22項の 3 点目（2026-09-18）: 黒画面検査の進捗と検査工程名が親の進捗ログへ
// 出ていなかったため、88 分 4K では約 57 分間まったく音沙汰が無く「レンダーが停止した」ように
// 見えていた。ストリーミング版は同期版と同じ引数列・同じ判定器を使うので、出す結果は変わらない。
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createProgressReporter, VERIFY_CHECKS } from "../src/progress.mjs";
import {
  blankFrameScanArgs,
  scanBlankFrames,
  scanBlankFramesStreaming,
} from "../src/verify-blank.mjs";

const FPS = 30;
const ffmpegAvailable = spawnSync("ffmpeg", ["-version"]).status === 0;

function metadataForFrames(count, ymaxAt) {
  return Array.from({ length: count }, (_, index) => [
    `[Parsed_metadata_1] frame:${index} pts:${index} pts_time:${index / FPS}`,
    `[Parsed_metadata_1] lavfi.signalstats.YMIN=16`,
    `[Parsed_metadata_2] frame:${index} pts:${index} pts_time:${index / FPS}`,
    `[Parsed_metadata_2] lavfi.signalstats.YMAX=${ymaxAt(index)}`,
  ].join("\n")).join("\n");
}

/** stderr を任意の位置で切り刻んで流す子プロセスの代役。 */
function fakeChild({ chunks, code = 0 }) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr = new EventEmitter();
  child.stderr.setEncoding = () => {};
  child.kill = () => {};
  setImmediate(() => {
    for (const chunk of chunks) child.stderr.emit("data", chunk);
    child.emit("close", code);
  });
  return child;
}

function splitIntoChunks(text, size) {
  const chunks = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks;
}

test("ストリーミング走査は同期走査と同じ引数列を使い、同じ結果を返す", async () => {
  const frames = 120;
  // 先頭 1 秒（30 フレーム）が黒、残りは絵あり。
  const metadata = metadataForFrames(frames, (index) => (index < 30 ? 16 : 200));
  let observedArgs = null;

  const streamed = await scanBlankFramesStreaming({
    outputPath: "out.mp4",
    fps: FPS,
    edit: { cuts: [], overlays: [] },
    spawnImpl: (command, args) => {
      observedArgs = args;
      return fakeChild({ chunks: splitIntoChunks(metadata, 997) });
    },
  });
  const synchronous = scanBlankFrames({
    outputPath: "out.mp4",
    fps: FPS,
    edit: { cuts: [], overlays: [] },
    spawnSyncImpl: () => ({ status: 0, stdout: "", stderr: metadata }),
  });

  assert.deepEqual(observedArgs, blankFrameScanArgs("out.mp4"));
  assert.deepEqual(streamed, synchronous);
  assert.equal(streamed.ok, true);
  assert.equal(streamed.intervals.length, 1);
  assert.equal(streamed.intervals[0].duration, 1);
});

test("走査中に処理フレーム数が逐次通知される（行境界をまたぐチャンク分割でも取りこぼさない）", async () => {
  const frames = 1000;
  const metadata = metadataForFrames(frames, () => 200);
  const progress = [];
  const result = await scanBlankFramesStreaming({
    outputPath: "out.mp4",
    fps: FPS,
    totalFrames: frames,
    progressIntervalFrames: 100,
    onProgress: (snapshot) => progress.push(snapshot),
    // わざと行の途中で切れるサイズにする。
    spawnImpl: () => fakeChild({ chunks: splitIntoChunks(metadata, 137) }),
  });

  assert.equal(result.ok, true);
  assert.ok(progress.length >= 5, `progress reports: ${progress.length}`);
  // 単調増加で、総フレーム数も一緒に伝わる。
  for (const [index, snapshot] of progress.entries()) {
    assert.equal(snapshot.totalFrames, frames);
    if (index > 0) assert.ok(snapshot.frames > progress[index - 1].frames);
  }
  // 最後の通知は最終フレームまで到達している。
  assert.equal(progress.at(-1).frames, frames);
});

test("走査の失敗はストリーミング版でも同期版と同じ形で報告される", async () => {
  const failed = await scanBlankFramesStreaming({
    outputPath: "out.mp4",
    fps: FPS,
    spawnImpl: () => fakeChild({ chunks: ["out.mp4: No such file or directory\n"], code: 1 }),
  });
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.intervals, []);
  assert.deepEqual(failed.findings, []);
  assert.equal(failed.error, "out.mp4: No such file or directory");

  const spawnFailed = await scanBlankFramesStreaming({
    outputPath: "out.mp4",
    fps: FPS,
    spawnImpl: () => { throw new Error("ENOENT ffmpeg"); },
  });
  assert.equal(spawnFailed.ok, false);
  assert.equal(spawnFailed.error, "ENOENT ffmpeg");
});

test("進捗ログには検査工程名と処理フレーム数が載り、既存の stage 行とは別形になる", () => {
  const lines = [];
  const reporter = createProgressReporter({
    enabled: true,
    io: { log: (line) => lines.push(line) },
    totalMs: 1000,
  });
  reporter.stageStart("verify");
  reporter.verifyCheck("blank-frames", "start");
  reporter.verifyCheckFrames("blank-frames", 45_000, 158_682);
  reporter.verifyCheck("blank-frames", "end");
  reporter.verifyCheck("decode", "reused");
  reporter.stageEnd("verify");

  assert.deepEqual(lines, [
    "PROGRESS stage=verify status=start",
    "PROGRESS stage=verify check=blank-frames status=start",
    "PROGRESS stage=verify check=blank-frames frames=45000 total_frames=158682",
    "PROGRESS stage=verify check=blank-frames status=end",
    "PROGRESS stage=verify check=decode status=reused",
    "PROGRESS stage=verify status=end",
  ]);
  // シェルの進捗パーサは stage 行を `status=(start|end)(engine=...)?$` で厳格に照合するため、
  // check= が付いた行はその正規表現に一致せず、既存の進捗表示を壊さない。
  const stagePattern = /^PROGRESS stage=(prepare|audio-cut|render|audio-mix|verify) status=(start|end)(?: engine=(gpu|osr))?$/u;
  const checkLines = lines.filter((line) => line.includes("check="));
  assert.equal(checkLines.length, 4);
  for (const line of checkLines) assert.equal(stagePattern.test(line), false);

  assert.throws(() => reporter.verifyCheck("no-such-check", "start"), TypeError);
  assert.throws(() => reporter.verifyCheck("blank-frames", "maybe"), TypeError);
  assert.ok(VERIFY_CHECKS.includes("blank-frames"));
});

test("進捗が無効なときは検査工程行を一切出さない", () => {
  const lines = [];
  const reporter = createProgressReporter({
    enabled: false,
    io: { log: (line) => lines.push(line) },
    totalMs: 1000,
  });
  reporter.verifyCheck("blank-frames", "start");
  reporter.verifyCheckFrames("blank-frames", 10, 20);
  assert.deepEqual(lines, []);
});

test("実素材でもストリーミング走査と同期走査の判定は一致する", async (t) => {
  if (!ffmpegAvailable) return t.skip("ffmpeg unavailable");
  const directory = await mkdtemp(join(tmpdir(), "render-cut-blank-stream-"));
  try {
    const path = join(directory, "four-part.mkv");
    const build = spawnSync("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", `color=c=black:size=160x90:rate=${FPS}:duration=1`,
      "-f", "lavfi", "-i", `testsrc2=size=160x90:rate=${FPS}:duration=1`,
      "-f", "lavfi", "-i", `color=c=black:size=160x90:rate=${FPS}:duration=0.5`,
      "-f", "lavfi", "-i", `testsrc2=size=160x90:rate=${FPS}:duration=1`,
      "-filter_complex", "[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0[v]",
      "-map", "[v]", "-c:v", "ffv1", path,
    ], { encoding: "utf8" });
    assert.equal(build.status, 0, build.stderr);

    const edit = { cuts: [], overlays: [] };
    const progress = [];
    const streamed = await scanBlankFramesStreaming({
      outputPath: path, fps: FPS, edit, progressIntervalFrames: 10,
      onProgress: (snapshot) => progress.push(snapshot),
    });
    const synchronous = scanBlankFrames({ outputPath: path, fps: FPS, edit });
    assert.deepEqual(streamed, synchronous);
    assert.equal(streamed.ok, true);
    assert.ok(streamed.intervals.length > 0);
    assert.ok(progress.length > 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
