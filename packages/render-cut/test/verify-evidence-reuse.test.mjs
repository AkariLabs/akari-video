// 不具合メモ第22項（2026-09-18）: 書き出し後検査が映像を繰り返し走査していた問題。
// 88 分 4K の実測では verify 段だけで約 63 分（うち signalstats の全フレーム走査が約 57 分）。
//
// このファイルが固定する契約:
//   1. 音声を作り直した書き出し（audio_mix.operation !== "copy"、映像は -c:v copy）でも、
//      **映像ストリームの同一性を実証できたときだけ** 映像検査と luma を引き継ぐ。
//   2. **音声の証拠は決して引き継がない**（ここが最重要）。ffprobe の測定値は成果物を測り直し、
//      音声のデコード検査と音圧測定は成果物に対して毎回実行する。
//   3. 同一性が確認できない場合は安全側（全部測り直す）へ倒れる。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  hashVideoBitstream,
  proveVideoStreamIdentity,
  resolveVideoEvidenceReuse,
  verifyArtifact,
} from "../src/render-cut.mjs";

const ffmpegAvailable = spawnSync("ffmpeg", ["-version"]).status === 0
  && spawnSync("ffprobe", ["-version"]).status === 0;

const FPS = 30;
const FRAMES = 30;
const COMPOSITE = "composite.mp4";
const OUTPUT = "final.mp4";
const IDENTICAL_HASH = "a".repeat(64);

const VIDEO_SHAPE = {
  codec_type: "video",
  codec_name: "h264",
  profile: "High",
  width: 160,
  height: 90,
  pix_fmt: "yuv420p",
  r_frame_rate: `${FPS}/1`,
  avg_frame_rate: `${FPS}/1`,
};

function planFor(operation, { input = COMPOSITE } = {}) {
  return {
    predicted_duration_seconds: 1,
    duration_tolerance_seconds: 0.1,
    preset: {
      width: 160, height: 90, fps: FPS,
      video_codec: "h264", profile: "high", pixel_format: "yuv420p", audio_codec: "aac",
    },
    commands: {
      audio_mix: { operation, input, output: OUTPUT, hasNarration: false, hasAudibleAudio: true },
    },
  };
}

// GPU 段が composite（= 音声合成**前**）に対して取った検査値。音声は素材由来の PCM のまま。
function gpuVerificationFor({ frames = FRAMES, decodeStderr = "", luma = lumaFor(frames), overrides = {} } = {}) {
  return {
    finalVerify: {
      measured: {
        streams: [
          { ...VIDEO_SHAPE, nb_read_frames: String(frames), duration: "1", ...overrides },
          { codec_type: "audio", codec_name: "pcm_s16le" },
        ],
        format: { duration: "1" },
      },
      decode: { ok: decodeStderr === "", stderr: decodeStderr },
    },
    luma,
  };
}

function lumaFor(frames) {
  return {
    ymin: Array(frames).fill(16),
    ymax: [16, ...Array(frames - 1).fill(200)],
  };
}

/**
 * spawnSync の差し替え。どの走査が何回走ったかを数える。
 * 完成ファイルの全編デコード（-progress）と signalstats 走査が 0 回であることを示すのが主目的。
 */
function makeStub({
  outputFrames = String(FRAMES),
  outputVideoOverrides = {},
  outputDuration = "1.01",
  outputAudioCodec = "aac",
  hashes = { [COMPOSITE]: IDENTICAL_HASH, [OUTPUT]: IDENTICAL_HASH },
  streamhashStatus = 0,
  audioDecodeStderr = "",
  audioDecodeStatus = 0,
} = {}) {
  const calls = {
    probe: 0,
    streamhash: [],
    fullDecode: 0,
    audioDecode: 0,
    volumedetect: 0,
    signalstats: 0,
  };
  const impl = (command, args) => {
    const inputPath = args[args.indexOf("-i") + 1];
    if (args.includes("-show_streams")) {
      calls.probe += 1;
      return {
        status: 0,
        stderr: "",
        stdout: JSON.stringify({
          streams: [
            {
              ...VIDEO_SHAPE,
              ...(outputFrames === null ? {} : { nb_frames: outputFrames }),
              ...outputVideoOverrides,
            },
            ...(outputAudioCodec === null ? [] : [{ codec_type: "audio", codec_name: outputAudioCodec }]),
          ],
          format: { duration: outputDuration },
        }),
      };
    }
    if (args.includes("streamhash")) {
      calls.streamhash.push(inputPath);
      if (streamhashStatus !== 0) return { status: streamhashStatus, stdout: "", stderr: "Unknown output format" };
      return { status: 0, stderr: "", stdout: `0,v,SHA256=${hashes[inputPath] ?? "f".repeat(64)}\n` };
    }
    if (args.includes("-progress")) {
      calls.fullDecode += 1;
      return { status: 0, stdout: `frame=${FRAMES}\nprogress=end\n`, stderr: "" };
    }
    if (args.includes("volumedetect")) {
      calls.volumedetect += 1;
      return { status: 0, stdout: "", stderr: "mean_volume: -20.0 dB\nmax_volume: -3.0 dB\n" };
    }
    if (args.includes("-vn")) {
      calls.audioDecode += 1;
      return { status: audioDecodeStatus, stdout: "", stderr: audioDecodeStderr };
    }
    if (args.some((value) => typeof value === "string" && value.includes("signalstats"))) {
      calls.signalstats += 1;
      const metadata = Array.from({ length: FRAMES }, (_, index) => [
        `[Parsed_metadata_1] frame:${index} pts:${index} pts_time:${index / FPS}`,
        `[Parsed_metadata_1] lavfi.signalstats.YMIN=16`,
        `[Parsed_metadata_2] frame:${index} pts:${index} pts_time:${index / FPS}`,
        `[Parsed_metadata_2] lavfi.signalstats.YMAX=${index === 0 ? 16 : 200}`,
      ].join("\n")).join("\n");
      return { status: 0, stdout: "", stderr: metadata };
    }
    throw new Error(`unexpected spawn: ${command} ${args.join(" ")}`);
  };
  return { calls, impl };
}

function runVerify({ plan, gpuVerification, stub, onCheck = null, verifyBlank = true }) {
  return verifyArtifact({
    outputPath: OUTPUT,
    plan,
    edit: { cuts: [], overlays: [], audio: { bgm: { path: "bgm.wav" } } },
    ffprobeCommand: "ffprobe-test",
    ffmpegCommand: "ffmpeg-test",
    spawnSyncImpl: stub.impl,
    gpuVerification,
    verifyBlank,
    onCheck,
  });
}

test("音声だけ作り直した書き出し: 映像の同一性を実証できたら映像検査と luma を引き継ぎ、映像の再走査をしない", () => {
  const stub = makeStub();
  const checks = [];
  const verification = runVerify({
    plan: planFor("ffmpeg"),
    gpuVerification: gpuVerificationFor(),
    stub,
    onCheck: (check, status) => checks.push(`${check}:${status}`),
  });

  // 映像の再走査（全編デコード / signalstats 全フレーム走査）は 0 回。
  assert.equal(stub.calls.fullDecode, 0);
  assert.equal(stub.calls.signalstats, 0);
  // 引き継ぎの前に同一性を実証した: audio_mix の入力と成果物の両方をハッシュしている。
  assert.deepEqual(stub.calls.streamhash, [COMPOSITE, OUTPUT]);
  assert.equal(verification.verdict, "pass");
  assert.equal(verification.measured.frame_count, FRAMES);
  assert.deepEqual(verification.declared.blank_frames, []);
  assert.equal(verification.evidence_reuse.video_luma_reused, true);
  assert.equal(verification.evidence_reuse.video_bitstream_sha256, IDENTICAL_HASH);
  assert.equal(verification.evidence_reuse.video_frames, FRAMES);
  assert.deepEqual(checks.filter((entry) => entry.startsWith("blank-frames")), ["blank-frames:reused"]);
  assert.ok(checks.includes("video-identity:start"));
  assert.ok(checks.includes("decode:reused"));
});

test("音声の証拠は引き継がない: 測定値は成果物を測り直し、音声のデコードと音圧は毎回実行する", () => {
  const stub = makeStub();
  const verification = runVerify({
    plan: planFor("ffmpeg"),
    gpuVerification: gpuVerificationFor(),
    stub,
  });

  // GPU 段の測定値をまるごと引き継いでいたら audio_codec は composite の pcm_s16le になる。
  assert.equal(verification.measured.audio_codec, "aac");
  // 尺も成果物側の値（composite は "1"）。
  assert.equal(verification.measured.duration_seconds, 1.01);
  // 成果物の ffprobe・音声のみデコード・音圧測定がそれぞれ実際に走っている。
  assert.equal(stub.calls.probe, 1);
  assert.equal(stub.calls.audioDecode, 1);
  assert.ok(stub.calls.volumedetect >= 1);
  assert.equal(verification.declared.audio_level.max_db, -3);
  assert.equal(verification.evidence_reuse.audio_evidence_reused, false);
});

test("最終音声のデコード失敗は、GPU 段のデコードが無事でも verdict に出る（音声検査が引き継がれていない証拠）", () => {
  const stub = makeStub({ audioDecodeStderr: "[aac @ 0x1] channel element 0.0 is not allocated", audioDecodeStatus: 1 });
  const verification = runVerify({
    plan: planFor("ffmpeg"),
    // GPU 段の映像デコードは無事（stderr 空）。
    gpuVerification: gpuVerificationFor({ decodeStderr: "" }),
    stub,
  });
  const decode = verification.findings.find(({ check }) => check === "verify.decode");
  assert.equal(decode.severity, "error");
  assert.match(decode.message, /audio: \[aac/u);
  assert.equal(verification.verdict, "fail");
  assert.equal(stub.calls.audioDecode, 1);
});

test("音声ストリームが無い成果物では音声のみデコードを走らせない（対象が無いため）", () => {
  const stub = makeStub({ outputAudioCodec: null });
  const verification = runVerify({
    plan: planFor("ffmpeg"),
    gpuVerification: gpuVerificationFor(),
    stub,
  });
  assert.equal(stub.calls.audioDecode, 0);
  assert.equal(stub.calls.volumedetect, 0);
  assert.equal(verification.findings.find(({ check }) => check === "verify.decode").severity, "info");
});

const fallbackCases = [
  {
    name: "映像ビットストリームのハッシュが一致しない",
    stub: () => makeStub({ hashes: { [COMPOSITE]: IDENTICAL_HASH, [OUTPUT]: "b".repeat(64) } }),
    gpu: () => gpuVerificationFor(),
    plan: () => planFor("ffmpeg"),
    expectedStreamhash: 2,
  },
  {
    name: "成果物のフレーム数が GPU 段の数えた値と違う（切り詰められた）",
    stub: () => makeStub({ outputFrames: "29" }),
    gpu: () => gpuVerificationFor(),
    plan: () => planFor("ffmpeg"),
    expectedStreamhash: 0,
  },
  {
    name: "成果物のフレーム数がコンテナから読めない",
    stub: () => makeStub({ outputFrames: null }),
    gpu: () => gpuVerificationFor(),
    plan: () => planFor("ffmpeg"),
    expectedStreamhash: 0,
  },
  {
    // 成果物側は plan どおり（= 他の検査は通る）だが、GPU 段が測った映像と性質が違う。
    name: "GPU 段が測った映像と成果物の pix_fmt が違う",
    stub: () => makeStub(),
    gpu: () => gpuVerificationFor({ overrides: { pix_fmt: "yuv420p10le" } }),
    plan: () => planFor("ffmpeg"),
    expectedStreamhash: 0,
  },
  {
    name: "ffmpeg が streamhash を扱えない",
    stub: () => makeStub({ streamhashStatus: 1 }),
    gpu: () => gpuVerificationFor(),
    plan: () => planFor("ffmpeg"),
    expectedStreamhash: 1,
  },
  {
    name: "audio_mix の入力パスが plan に無い",
    stub: () => makeStub(),
    gpu: () => gpuVerificationFor(),
    plan: () => planFor("ffmpeg", { input: "" }),
    expectedStreamhash: 0,
  },
  {
    name: "GPU 段の検査値そのものが無い（OSR 経路）",
    stub: () => makeStub(),
    gpu: () => null,
    plan: () => planFor("ffmpeg"),
    expectedStreamhash: 0,
  },
];

for (const scenario of fallbackCases) {
  test(`同一性が確認できないので再走査へ倒れる: ${scenario.name}`, () => {
    const stub = scenario.stub();
    const verification = runVerify({
      plan: scenario.plan(),
      gpuVerification: scenario.gpu(),
      stub,
    });
    // 引き継がず、従来どおり全編デコードと signalstats 走査を実行する。
    assert.equal(stub.calls.fullDecode, 1);
    assert.equal(stub.calls.signalstats, 1);
    assert.equal(stub.calls.streamhash.length, scenario.expectedStreamhash);
    assert.equal(verification.evidence_reuse, undefined);
    assert.equal(verification.measured.frame_count, FRAMES);
    assert.equal(verification.verdict, "pass");
  });
}

test("audio_mix がバイトコピーの経路は従来どおり全部引き継ぎ、同一性ハッシュも取らない", () => {
  const stub = makeStub();
  const verification = runVerify({
    plan: planFor("copy"),
    gpuVerification: gpuVerificationFor(),
    stub,
  });
  assert.equal(stub.calls.probe, 0);
  assert.equal(stub.calls.streamhash.length, 0);
  assert.equal(stub.calls.fullDecode, 0);
  assert.equal(stub.calls.signalstats, 0);
  assert.equal(stub.calls.audioDecode, 0);
  assert.equal(verification.measured.frame_count, FRAMES);
  assert.equal(verification.evidence_reuse, undefined);
});

test("resolveVideoEvidenceReuse の scope と理由は判定の根拠を残す", () => {
  const identical = resolveVideoEvidenceReuse({
    plan: planFor("ffmpeg"),
    gpuVerification: gpuVerificationFor(),
    outputPath: OUTPUT,
    ffprobeCommand: "ffprobe-test",
    ffmpegCommand: "ffmpeg-test",
    spawnSyncImpl: makeStub().impl,
  });
  assert.equal(identical.scope, "video");
  assert.equal(identical.identity.identical, true);
  assert.equal(identical.record.audio_evidence_reused, false);

  const copied = resolveVideoEvidenceReuse({
    plan: planFor("copy"),
    gpuVerification: gpuVerificationFor(),
    outputPath: OUTPUT,
    ffprobeCommand: "ffprobe-test",
    ffmpegCommand: "ffmpeg-test",
    spawnSyncImpl: () => { throw new Error("unexpected spawn"); },
  });
  assert.equal(copied.scope, "full");

  const unproven = resolveVideoEvidenceReuse({
    plan: planFor("ffmpeg"),
    gpuVerification: gpuVerificationFor(),
    outputPath: OUTPUT,
    ffprobeCommand: "ffprobe-test",
    ffmpegCommand: "ffmpeg-test",
    spawnSyncImpl: makeStub({ outputVideoOverrides: { width: 1920 } }).impl,
  });
  assert.equal(unproven.scope, "none");
  assert.match(unproven.reason, /width が違う/u);
});

test("proveVideoStreamIdentity は確かめられない項目があれば identical を返さない", () => {
  const reference = { ...VIDEO_SHAPE, nb_read_frames: "30" };
  const candidate = { ...VIDEO_SHAPE, nb_frames: "30" };
  const hashing = () => ({ status: 0, stdout: `0,v,SHA256=${IDENTICAL_HASH}\n`, stderr: "" });

  assert.equal(proveVideoStreamIdentity({
    referencePath: "", referenceStream: reference, referenceFrames: "30",
    candidatePath: OUTPUT, candidateStream: candidate, ffmpegCommand: "ffmpeg-test", spawnSyncImpl: hashing,
  }).reason, "audio_mix の入力パスが plan に無い");

  assert.equal(proveVideoStreamIdentity({
    referencePath: COMPOSITE, referenceStream: null, referenceFrames: "30",
    candidatePath: OUTPUT, candidateStream: candidate, ffmpegCommand: "ffmpeg-test", spawnSyncImpl: hashing,
  }).reason, "映像ストリームの測定値が揃っていない");

  assert.match(proveVideoStreamIdentity({
    referencePath: COMPOSITE, referenceStream: reference, referenceFrames: "not-a-number",
    candidatePath: OUTPUT, candidateStream: candidate, ffmpegCommand: "ffmpeg-test", spawnSyncImpl: hashing,
  }).reason, /GPU 段の数えたフレーム数が読めない/u);

  assert.equal(proveVideoStreamIdentity({
    referencePath: COMPOSITE, referenceStream: reference, referenceFrames: "30",
    candidatePath: OUTPUT, candidateStream: candidate, ffmpegCommand: "ffmpeg-test", spawnSyncImpl: hashing,
  }).identical, true);

  // 参照側と成果物側で違うハッシュが返るときは一致しない。
  let call = 0;
  assert.equal(proveVideoStreamIdentity({
    referencePath: COMPOSITE, referenceStream: reference, referenceFrames: "30",
    candidatePath: OUTPUT, candidateStream: candidate, ffmpegCommand: "ffmpeg-test",
    spawnSyncImpl: () => ({
      status: 0,
      stderr: "",
      stdout: `0,v,SHA256=${(call++ === 0 ? "a" : "c").repeat(64)}\n`,
    }),
  }).reason, "映像ビットストリームが一致しない");
});

// ここから下は実素材での確認（ffmpeg / ffprobe が無い環境では skip）。
// 「-c:v copy の音声のみ作り直し」で映像ビットストリームが本当に同一になること、
// 「-t で切り詰めた」ものはちゃんと弾かれることを、実際のファイルで確かめる。
function runFfmpeg(args) {
  const result = spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

function probeVideoStream(path, { countFrames = false } = {}) {
  const result = spawnSync("ffprobe", [
    "-v", "error",
    ...(countFrames ? ["-count_frames"] : []),
    "-select_streams", "v:0",
    "-show_streams", "-of", "json", path,
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).streams[0];
}

test("実素材: 音声のみ作り直した成果物は映像ビットストリームが同一と実証でき、切り詰めた成果物は弾かれる", async (t) => {
  if (!ffmpegAvailable) return t.skip("ffmpeg/ffprobe unavailable");
  const directory = await mkdtemp(join(tmpdir(), "render-cut-video-identity-"));
  try {
    const composite = join(directory, "composite.mp4");
    const mixed = join(directory, "final.mp4");
    const truncated = join(directory, "truncated.mp4");
    runFfmpeg([
      "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=30:duration=2",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", composite,
    ]);
    // plan.mjs の audio_mix と同じ形（filter_complex + -map 0:v:0 + -c:v copy + -t）。
    runFfmpeg([
      "-i", composite, "-filter_complex", "[0:a]volume=-3dB[mixed]",
      "-map", "0:v:0", "-map", "[mixed]", "-t", "2", "-c:v", "copy", "-c:a", "aac", mixed,
    ]);
    runFfmpeg([
      "-i", composite, "-filter_complex", "[0:a]volume=-3dB[mixed]",
      "-map", "0:v:0", "-map", "[mixed]", "-t", "1", "-c:v", "copy", "-c:a", "aac", truncated,
    ]);

    const reference = probeVideoStream(composite, { countFrames: true });
    const identical = proveVideoStreamIdentity({
      referencePath: composite,
      referenceStream: reference,
      referenceFrames: reference.nb_read_frames,
      candidatePath: mixed,
      candidateStream: probeVideoStream(mixed),
      ffmpegCommand: "ffmpeg",
    });
    assert.equal(identical.identical, true, identical.reason ?? "");
    assert.equal(identical.frames, Number(reference.nb_read_frames));
    assert.match(identical.sha256, /^[0-9a-f]{64}$/u);
    // 引き継ぎに使った証拠はデコードなしの demux で取れている（同じファイルなら同じ値）。
    assert.equal(hashVideoBitstream({ path: mixed, ffmpegCommand: "ffmpeg" }), identical.sha256);

    const clipped = proveVideoStreamIdentity({
      referencePath: composite,
      referenceStream: reference,
      referenceFrames: reference.nb_read_frames,
      candidatePath: truncated,
      candidateStream: probeVideoStream(truncated),
      ffmpegCommand: "ffmpeg",
    });
    assert.equal(clipped.identical, false);
    assert.match(clipped.reason, /フレーム数が違う/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
