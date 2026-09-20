// 不具合メモ第9項（長尺素材の静止画取得が非常に遅い）の回帰テスト。
//   1. 引数列: 入力側 -ss が -i より前にあること（出力側シーク単独へ戻らないこと）
//   2. 精度: 二段構えのシークが従来の出力側シーク単独と同じフレームを返すこと
//   3. 一括抽出: 近接時刻は 1 プロセス、離れた時刻は別プロセスになること
//   4. 保険: 入力側シークが目的時刻を越えた素材は従来法でやり直すこと
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveFfmpeg, resolveFfprobe } from "../../media-bin/src/index.mjs";
import { SEPARATE_FRAME_FILTER, grabMedia } from "../src/media/grab.mjs";
import {
  GRAB_BATCH_GAP_SECONDS,
  GRAB_BATCH_MAX_FRAMES,
  GRAB_PREROLL_SECONDS,
  buildFrameGrabPlan,
  firstDecodedSeconds,
  frameGrabArguments,
  legacyFrameGrabArguments,
  toMicros,
} from "../src/media/frame-grab.mjs";

function resolveMediaTools() {
  try {
    return { ffmpeg: resolveFfmpeg(), ffprobe: resolveFfprobe() };
  } catch {
    return null;
  }
}

function planOf(times) {
  return buildFrameGrabPlan(times.map((time) => ({ time, outputPath: `${time}.png` })));
}

// ffprobe / ffmpeg を差し替える stub。ffmpeg の引数列だけを集める。
function stubTools(calls, { stderr = "n: 0 pts_time:0.017100 iskey:1" } = {}) {
  return {
    ffmpegCommand: "FFMPEG-STUB",
    ffprobeCommand: "FFPROBE-STUB",
    spawn: (command, args) => {
      if (command === "FFPROBE-STUB") {
        return {
          status: 0,
          stdout: JSON.stringify({
            streams: [{ codec_type: "video", width: 1920, height: 1080 }],
            format: { duration: "7871.365000" },
          }),
          stderr: "",
        };
      }
      calls.push(args);
      return { status: 0, stdout: "", stderr };
    },
  };
}

test("grab --separate の ffmpeg 引数列は入力側 -ss を -i より前に置く（第9項 再発防止）", () => {
  const pass = planOf([1920])[0];
  const args = frameGrabArguments({ inputPath: "C:\\src\\C0001.MP4", pass, filter: SEPARATE_FRAME_FILTER });
  assert.deepEqual(args, [
    "-hide_banner", "-loglevel", "info", "-nostdin", "-y",
    "-ss", "1919.000000",
    "-i", "C:\\src\\C0001.MP4",
    "-ss", "1.000000",
    "-frames:v", "1",
    "-vf", "scale=-2:720:force_original_aspect_ratio=decrease,showinfo",
    "1920.png",
  ]);
  assert.ok(args.indexOf("-ss") < args.indexOf("-i"), "入力側 -ss が -i より後ろにある（出力側シークに戻っている）");

  // 一括抽出でも「-ss → -i → 出力ごとの -ss」の形は変わらない。
  const batched = frameGrabArguments({
    inputPath: "in.mp4",
    pass: planOf([1920, 1922, 1924])[0],
    filter: SEPARATE_FRAME_FILTER,
  });
  assert.deepEqual(batched, [
    "-hide_banner", "-loglevel", "info", "-nostdin", "-y",
    "-ss", "1919.000000",
    "-i", "in.mp4",
    "-ss", "1.000000", "-frames:v", "1", "-vf", `${SEPARATE_FRAME_FILTER},showinfo`, "1920.png",
    "-ss", "3.000000", "-frames:v", "1", "-vf", SEPARATE_FRAME_FILTER, "1922.png",
    "-ss", "5.000000", "-frames:v", "1", "-vf", SEPARATE_FRAME_FILTER, "1924.png",
  ]);
  assert.ok(batched.indexOf("-ss") < batched.indexOf("-i"));
  assert.equal(batched.filter((value) => value === "-i").length, 1, "デコードは 1 回で済ませる");

  // やり直し用（従来法）は出力側シーク単独のまま — 遅いが先頭から全部デコードするので取り違えない。
  assert.deepEqual(
    legacyFrameGrabArguments({ inputPath: "in.mp4", frame: { time: 1920, outputPath: "1920.png" }, filter: SEPARATE_FRAME_FILTER }),
    [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
      "-i", "in.mp4",
      "-ss", "1920.000000",
      "-frames:v", "1",
      "-vf", SEPARATE_FRAME_FILTER,
      "1920.png",
    ],
  );
});

test("シークは µs 整数で入力側 + 出力側へ分割され、和は常に要求時刻と一致する", () => {
  for (const time of [0, 0.033333, 0.5, 1, 1.000001, 12.345, 1920, 1920.5, 7871.365]) {
    const [pass] = planOf([time]);
    const frame = pass.frames[0];
    assert.equal(pass.inputSeekMicros + frame.outputSeekMicros, toMicros(time), `t=${time}`);
    assert.ok(pass.inputSeekMicros >= 0, `t=${time} で入力側シークが負になっている`);
    assert.ok(
      pass.inputSeekMicros <= Math.max(0, toMicros(time) - toMicros(GRAB_PREROLL_SECONDS)) + 1,
      `t=${time} で手前マージンが足りない`,
    );
  }
  // 先頭付近は入力側シークが 0 で止まり、出力側が要求時刻をそのまま受ける。
  const [head] = planOf([0.2]);
  assert.equal(head.inputSeekMicros, 0);
  assert.equal(head.frames[0].outputSeekMicros, 200_000);
});

test("近接時刻は 1 パスにまとめ、離れた時刻はまとめない", () => {
  const near = planOf([1920, 1922, 1924]);
  assert.equal(near.length, 1);
  assert.equal(near[0].inputSeekMicros, toMicros(1919));
  assert.deepEqual(near[0].frames.map((frame) => frame.time), [1920, 1922, 1924]);

  // 閾値ちょうどはまとめる / 1 µs 超えたら分ける。
  assert.equal(planOf([10, 10 + GRAB_BATCH_GAP_SECONDS]).length, 1);
  assert.equal(planOf([10, 10 + GRAB_BATCH_GAP_SECONDS + 0.000001]).length, 2);

  // 離れた時刻をまとめると隙間ぶんを丸ごとデコードしてしまうので、必ず別パスにする。
  const far = planOf([10, 600, 1920]);
  assert.equal(far.length, 3);
  assert.deepEqual(far.map((pass) => pass.inputSeekMicros), [toMicros(9), toMicros(599), toMicros(1919)]);
  for (const pass of far) assert.equal(pass.frames[0].outputSeekMicros, toMicros(GRAB_PREROLL_SECONDS));

  // 指定順はばらばらでもよい（パスは時刻昇順に組む）。
  const shuffled = planOf([1924, 1920, 600, 1922]);
  assert.deepEqual(shuffled.map((pass) => pass.frames.map((frame) => frame.time)), [[600], [1920, 1922, 1924]]);

  // 1 パスの上限は 12 コマ。13 コマぶん近接していても 12 + 1 に割れる。
  const many = planOf(Array.from({ length: 13 }, (_, index) => 100 + index));
  assert.deepEqual(many.map((pass) => pass.frames.length), [GRAB_BATCH_MAX_FRAMES, 1]);

  // 同じ出力ファイルへの重複指定は 1 回の抽出にまとめる（1 プロセスから二重に開かせない）。
  const duplicated = buildFrameGrabPlan([
    { time: 12, outputPath: "same.png" },
    { time: 12, outputPath: "same.png" },
  ]);
  assert.equal(duplicated.length, 1);
  assert.equal(duplicated[0].frames.length, 1);
});

test("showinfo のデコード開始時刻を読み、目的時刻を越えていたら従来法でやり直す", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "akari-grab-seek-"));
  try {
    const inputPath = path.join(root, "C0001.MP4");
    await writeFile(inputPath, "");
    const outputDirectory = path.join(root, "out");
    await mkdir(outputDirectory);

    // 入力側シークが t=1920 を飛び越えた（開始フレームが相対 2.5s = 絶対 1921.5s）ケース。
    const calls = [];
    await grabMedia(inputPath, {
      ...stubTools(calls, { stderr: "n: 0 pts_time:2.500000 iskey:1" }),
      times: [1920, 1922, 1924],
      separate: true,
      out: outputDirectory,
      noRecord: true,
      stderr: () => {},
    });
    assert.equal(calls.length, 2, "一括抽出 1 回 + やり直し 1 回になっていない");
    assert.ok(calls[0].indexOf("-ss") < calls[0].indexOf("-i"));
    // 越えられたのは t=1920 だけ。開始フレーム以降の t=1922 / 1924 は候補集合が同じなので取り直さない。
    assert.deepEqual(calls[1], legacyFrameGrabArguments({
      inputPath,
      frame: { time: 1920, outputPath: path.join(outputDirectory, "32m00s.png") },
      filter: SEPARATE_FRAME_FILTER,
    }));

    // 目的時刻より前から復号できていれば、やり直しは起こらない。
    const healthy = [];
    await grabMedia(inputPath, {
      ...stubTools(healthy),
      times: [1920, 1922, 1924],
      separate: true,
      out: outputDirectory,
      noRecord: true,
    });
    assert.equal(healthy.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  assert.equal(firstDecodedSeconds("n: 0 pts:513 pts_time:0.0171\nn: 1 pts_time:0.0504667"), 0.0171);
  assert.equal(firstDecodedSeconds("何も出ていない"), null);
  t.diagnostic("stub spawn で ffmpeg 引数列だけを検査した");
});

test("showinfo が無い ffmpeg でも取得は続け、検査だけを諦める", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "akari-grab-plain-"));
  try {
    const inputPath = path.join(root, "C0001.MP4");
    await writeFile(inputPath, "");
    const outputDirectory = path.join(root, "out");
    await mkdir(outputDirectory);

    const calls = [];
    const warnings = [];
    let firstFfmpegCall = true;
    await grabMedia(inputPath, {
      ffmpegCommand: "FFMPEG-STUB",
      ffprobeCommand: "FFPROBE-STUB",
      spawn: (command, args) => {
        if (command === "FFPROBE-STUB") {
          return {
            status: 0,
            stdout: JSON.stringify({ streams: [{ codec_type: "video", width: 1920, height: 1080 }], format: { duration: "60" } }),
            stderr: "",
          };
        }
        calls.push(args);
        if (firstFfmpegCall) {
          firstFfmpegCall = false;
          return { status: 1, stdout: "", stderr: "[AVFilterGraph @ 0x0] No such filter: 'showinfo'" };
        }
        return { status: 0, stdout: "", stderr: "" };
      },
      times: [12],
      separate: true,
      out: outputDirectory,
      noRecord: true,
      stderr: (line) => warnings.push(line),
    });
    assert.equal(calls.length, 2);
    const filterOf = (args) => args[args.indexOf("-vf") + 1];
    assert.equal(filterOf(calls[0]), `${SEPARATE_FRAME_FILTER},showinfo`);
    // 検査を諦めた 2 回目でも入力側シークは -i より前のまま（速さは落とさない）。
    assert.equal(filterOf(calls[1]), SEPARATE_FRAME_FILTER);
    assert.ok(calls[1].indexOf("-ss") < calls[1].indexOf("-i"));
    assert.equal(calls[1][calls[1].indexOf("-ss") + 1], "11.000000");
    assert.deepEqual(warnings, ["grab: この ffmpeg は showinfo filter を持たないため、シーク位置の検査を省略します。"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("grab --separate は近接時刻を 1 プロセスで取り、離れた時刻は分けて取る", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "akari-grab-batch-"));
  try {
    const inputPath = path.join(root, "C0001.MP4");
    await writeFile(inputPath, "");
    const outputDirectory = path.join(root, "out");
    await mkdir(outputDirectory);

    const near = [];
    const results = await grabMedia(inputPath, {
      ...stubTools(near),
      times: [1920, 1921.5, 1923],
      separate: true,
      out: outputDirectory,
      noRecord: true,
    });
    assert.equal(near.length, 1, "近接 3 枚が 1 プロセスにまとまっていない");
    // 出力ファイル名・JSON の並び順・種別は従来どおり（-t の指定順）。
    assert.deepEqual(results.map((item) => item.timecode), ["32m00s", "32m01s15f", "32m03s"]);
    assert.deepEqual(results.map((item) => item.kind), ["frame", "frame", "frame"]);
    assert.deepEqual(results.map((item) => item.times_s), [[1920], [1921.5], [1923]]);
    assert.deepEqual(
      results.map((item) => path.basename(item.path)),
      ["32m00s.png", "32m01s15f.png", "32m03s.png"],
    );

    const far = [];
    await grabMedia(inputPath, {
      ...stubTools(far),
      times: [10, 600, 1920],
      separate: true,
      out: outputDirectory,
      noRecord: true,
    });
    assert.equal(far.length, 3, "離れた 3 枚がまとめられている（隙間ぶんのデコードが丸損になる）");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// 実 ffmpeg 用の共有素材。キーフレームは 0 / 5 / 10s（keyint 150 @30fps）なので、
// 入力側シークは必ずキーフレームへ着地する。丸めたぶんを出力側シークで捨てられているかを見る。
const tools = resolveMediaTools();
let fixtureRoot = null;
let fixturePath = null;

test.before(async () => {
  if (!tools) return;
  fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "akari-grab-seek-fixture-"));
  fixturePath = path.join(fixtureRoot, "gop5.mp4");
  execFileSync(tools.ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30:duration=12",
    "-c:v", "libx264", "-x264-params", "keyint=150:min-keyint=150:scenecut=0",
    "-pix_fmt", "yuv420p", fixturePath,
  ]);
});

test.after(async () => {
  if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
});

test("入力側シーク + 一括抽出は従来の出力側シークと同じフレームを返す（実 ffmpeg）", async (t) => {
  if (!tools) return t.skip("ffmpeg/ffprobe unavailable");
  const root = await mkdtemp(path.join(os.tmpdir(), "akari-grab-parity-"));
  try {
    // 0 / 0.5 は先頭（入力側シーク 0）、5 はキーフレームちょうど、7 系はキーフレームから
    // 2 秒後・フレーム境界ちょうど、11.5 は末尾側。7 の 3 つは一括抽出に載る。
    const times = [0, 0.5, 5, 7, 7.033333, 7.066667, 11.5];
    const outputDirectory = path.join(root, "fast");
    await mkdir(outputDirectory);
    const results = await grabMedia(fixturePath, {
      ffmpegCommand: tools.ffmpeg,
      ffprobeCommand: tools.ffprobe,
      times,
      separate: true,
      out: outputDirectory,
      noRecord: true,
    });
    assert.equal(results.length, times.length);

    const referenceDirectory = path.join(root, "reference");
    await mkdir(referenceDirectory);
    for (const [index, time] of times.entries()) {
      const name = `${results[index].timecode}.png`;
      const referencePath = path.join(referenceDirectory, name);
      // 従来法（-i の後に -ss = 先頭から全デコード）を正解として、1 枚ずつ取り直す。
      execFileSync(tools.ffmpeg, legacyFrameGrabArguments({
        inputPath: fixturePath,
        frame: { time, outputPath: referencePath },
        filter: SEPARATE_FRAME_FILTER,
      }));
      assert.deepEqual(
        readFileSync(path.join(outputDirectory, name)),
        readFileSync(referencePath),
        `t=${time} で従来法と違うフレームになっている`,
      );
    }

    // 検査に歯があること: 隣のフレームなら PNG は別物になる素材で比べている。
    assert.notDeepEqual(
      readFileSync(path.join(referenceDirectory, `${results[3].timecode}.png`)),
      readFileSync(path.join(referenceDirectory, `${results[4].timecode}.png`)),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("入力側シークだけでは要求時刻のフレームにならない（出力側シークが効いていることの証明・実 ffmpeg）", async (t) => {
  if (!tools) return t.skip("ffmpeg/ffprobe unavailable");
  const root = await mkdtemp(path.join(os.tmpdir(), "akari-grab-rounding-"));
  try {
    // -noaccurate_seek は「索引が信用できない素材でシーク先がキーフレームへ丸められる」状況を
    // 決定論的に再現する手段（この素材では t=7.0 の要求に対し pts 5.0 のキーフレームが返る）。
    const rounded = path.join(root, "input-seek-only.png");
    const twoStage = path.join(root, "two-stage.png");
    const reference = path.join(root, "reference.png");
    execFileSync(tools.ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
      "-noaccurate_seek", "-ss", "7.000000", "-i", fixturePath,
      "-frames:v", "1", "-vf", SEPARATE_FRAME_FILTER, rounded,
    ]);
    execFileSync(tools.ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
      "-noaccurate_seek", "-ss", "6.000000", "-i", fixturePath,
      "-ss", "1.000000", "-frames:v", "1", "-vf", SEPARATE_FRAME_FILTER, twoStage,
    ]);
    execFileSync(tools.ffmpeg, legacyFrameGrabArguments({
      inputPath: fixturePath,
      frame: { time: 7, outputPath: reference },
      filter: SEPARATE_FRAME_FILTER,
    }));
    assert.notDeepEqual(
      readFileSync(rounded),
      readFileSync(reference),
      "入力側シーク単独で要求時刻のフレームが返っている（この検査の前提が崩れている）",
    );
    assert.deepEqual(
      readFileSync(twoStage),
      readFileSync(reference),
      "二段構えでも要求時刻のフレームに戻せていない",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
