import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { resolveFfmpeg, resolveFfprobe } from "../../media-bin/src/index.mjs";
import { ExecutionError, messageOf, parseJson } from "./errors.mjs";
import { blankFramesFromLuma, scanBlankFrames, scanBlankFramesStreaming } from "./verify-blank.mjs";
import { judgeAudioLevel, judgeMotion, measureAudioLevel } from "./verify-declared.mjs";

export function verifyArtifact({
  outputPath,
  plan,
  inputs = [],
  edit = null,
  ffprobeCommand = resolveFfprobe(),
  ffmpegCommand = resolveFfmpeg(),
  spawnSyncImpl = spawnSync,
  verifyBlank = true,
  gpuVerification = null,
  // 事前に解決済みの再利用判定。render パスは 1 回だけ解決して黒画面検査の先行実行にも使う。
  videoEvidence = null,
  // 進捗付きで先行実行した signalstats 走査の結果（scanBlankFramesStreaming の戻り値）。
  blankFrameScan = null,
  onTiming = null,
  onCheck = null,
}) {
  if (plan.preset?.video_codec === "png") {
    return verifyPngArtifact({ outputPath, plan, ffprobeCommand, spawnSyncImpl });
  }
  const evidence = videoEvidence ?? resolveVideoEvidenceReuse({
    plan, gpuVerification, outputPath, ffprobeCommand, ffmpegCommand, spawnSyncImpl, onTiming, onCheck,
  });
  const reusable = evidence.scope === "none" ? null : evidence;
  const measured = evidence.measured;
  const video = measured.streams.find((stream) => stream.codec_type === "video");
  const audio = measured.streams.find((stream) => stream.codec_type === "audio");
  const actualDuration = Number(measured.format?.duration ?? video?.duration);
  const actualFps = parseRate(video?.avg_frame_rate ?? video?.r_frame_rate);
  const expected = plan.preset;
  const expectedVideoCodec = expected.video_codec ?? "h264";
  const expectedVideoProfile = expected.profile ?? (expectedVideoCodec === "hevc" ? "main" : "high");
  const expectedPixelFormat = expected.pixel_format ?? "yuv420p";
  const expectedAudioCodec = expected.audio_codec ?? "aac";
  const findings = [];
  // docs/contract-2026-08-18-v1-render-parity.md §2: v1's cuts[].track / at declarations now
  // reach a real gap-aware or track-stack render path under both the default and custom
  // timeline.tracks orders (see buildPlan's v1 dispatch and buildTrackStackPlan in plan.mjs), so the
  // 2026-08-04 "declared but never rendered" hint this comparison used to append on a mismatch no
  // longer has a live cause to point at -- removed rather than left stale/misleading.
  const durationOk = Number.isFinite(actualDuration)
    && Math.abs(actualDuration - plan.predicted_duration_seconds) <= plan.duration_tolerance_seconds;
  compare(findings, "verify.duration", durationOk, `duration ${actualDuration}s; expected ${plan.predicted_duration_seconds}s ±${plan.duration_tolerance_seconds}s`);

  // 検査 1 + 2（task 2026-08-04-render-verify-media-checks）: 1 パスの全デコードで
  // (a) 実フレーム数と (b) デコードエラーの有無を同時に測る。ffprobe -count_frames も同じだけ
  // デコードが要るので、長尺で二重にコストを払わないよう ffmpeg 側 1 回に統合する。
  const decodeStarted = performance.now();
  notifyVerifyCheck(onCheck, "decode", reusable ? "reused" : "start");
  const decodePass = reusable
    ? reusedDecodePass({ evidence, video, audio, outputPath, ffmpegCommand, spawnSyncImpl, onCheck })
    : decodeAllFramesAndCount(ffmpegCommand, outputPath, spawnSyncImpl);
  notifyVerifyCheck(onCheck, "decode", "end");
  reportTiming(onTiming, "verify_decode", decodeStarted);
  const expectedFrameCount = Math.round(plan.predicted_duration_seconds * expected.fps);
  const frameTolerance = Math.round(plan.duration_tolerance_seconds * expected.fps);
  compare(
    findings,
    "verify.frame-count",
    decodePass.frameCount !== null && Math.abs(decodePass.frameCount - expectedFrameCount) <= frameTolerance,
    `frame count ${decodePass.frameCount ?? "unknown"}; expected ${expectedFrameCount} ±${frameTolerance}`,
  );

  compare(findings, "verify.resolution", video?.width === expected.width && video?.height === expected.height, `resolution ${video?.width ?? "missing"}x${video?.height ?? "missing"}; expected ${expected.width}x${expected.height}`);
  // task 2026-08-07-render-frame-accounting: avg_frame_rate is the container's own
  // nb_frames/duration bookkeeping, not an independent measurement -- it inherits whatever
  // sub-frame rounding the mux step accumulates. Real (non-lavfi) footage run through a
  // multi-segment trim/setpts/atempo/concat graph into a real encoder (verified empirically with
  // the actual reel: 13 cuts, 5 speed changes, 1 dissolve, h264_videotoolbox) legitimately lands
  // exactly 1 frame off nominal fps in either direction -- once as nb_frames landing 1 short of
  // what the declared duration implies (the original v4/v5 render: 1470 frames for a
  // 1471-frame-shaped duration), once as the declared duration landing 1 frame long of nb_frames
  // even though a full decode confirmed every one of the 1471 expected frames was actually
  // present (this task's own repro against the reel's real source footage + cuts + encoder args --
  // see report.md for both runs' raw ffprobe numbers). Both are within verify.duration's and
  // verify.frame-count's own tolerances already; only fps's exact-equality check was flagging
  // them. fpsWithinOneFrameTolerance is intentionally narrower than frame-count's own
  // ±duration_tolerance_seconds*fps (which already accepts up to ~3 frames here) so a genuine
  // multi-frame drop -- like the original v1 3-frame loss this same reel had before its cut
  // boundaries were snapped to the fps grid -- still fails (regression: verify-fps-tolerance.test.mjs).
  compare(
    findings,
    "verify.fps",
    fpsWithinOneFrameTolerance(actualFps, expected.fps, expectedFrameCount),
    `fps ${actualFps}; expected ${expected.fps} ±${oneFrameFpsTolerance(expected.fps, expectedFrameCount)} (1 frame of ${expectedFrameCount})`,
  );
  compare(findings, "verify.video-codec", video?.codec_name === expectedVideoCodec, `video codec ${video?.codec_name ?? "missing"}; expected ${expectedVideoCodec}`);
  const profileOk = expectedVideoCodec === "prores"
    ? video?.profile === 3 || String(video?.profile ?? "").toLowerCase() === "hq"
    : String(video?.profile ?? "").toLowerCase() === expectedVideoProfile;
  compare(findings, "verify.video-profile", profileOk, `video profile ${video?.profile ?? "missing"}; expected ${expectedVideoProfile}`);
  compare(findings, "verify.pixel-format", video?.pix_fmt === expectedPixelFormat, `pixel format ${video?.pix_fmt ?? "missing"}; expected ${expectedPixelFormat}`);
  compare(
    findings,
    "verify.color-range",
    video?.color_range !== "pc",
    `color range ${video?.color_range ?? "missing (defaults to tv)"}; expected ${expected.color_range ?? "tv"}`,
  );
  if (plan.audio_enabled === false) {
    compare(findings, "verify.audio", !audio, `audio stream ${audio ? "present" : "absent"}; expected absent`);
  } else {
    compare(findings, "verify.audio", audio?.codec_name === expectedAudioCodec, `audio codec ${audio?.codec_name ?? "missing"}; expected ${expectedAudioCodec}`);
  }
  if (plan.commands.audio_mix?.hasNarration) {
    compare(findings, "verify.narration-audio", Boolean(audio), `narration audio stream present: ${Boolean(audio)}; expected an audio stream because edit.json has audio.narration`);
  }
  compare(
    findings,
    "verify.decode",
    decodePass.ok,
    decodePass.ok ? "all frames decoded without error" : `decode error: ${decodePass.errorExcerpt}`,
  );
  const audioReasons = declaredAudioReasons({ plan, inputs, edit });
  const declaredAudio = plan.commands.audio_mix?.hasAudibleAudio === true
    || inputs.some((input) => input?.has_audio === true || input?.hasAudio === true);
  // 音圧測定は成果物そのものを毎回測る。GPU 段が測ったのは音声合成**前**の composite なので、
  // 映像ストリームが同一と実証できても音声側の測定値は決して引き継がない。
  const audioMeasurement = audio
    ? (() => {
        const started = performance.now();
        notifyVerifyCheck(onCheck, "audio-level", "start");
        const result = measureAudioLevel({
          outputPath,
          durationSeconds: actualDuration,
          ffmpegCommand,
          spawnSyncImpl,
        });
        notifyVerifyCheck(onCheck, "audio-level", "end");
        reportTiming(onTiming, "verify_audio", started);
        return result;
      })()
    : null;
  if (!audio) {
    notifyVerifyCheck(onCheck, "audio-level", "skipped");
    reportTiming(onTiming, "verify_audio", performance.now());
  }
  const audioLevel = judgeAudioLevel({
    declared: declaredAudio,
    reasons: audioReasons,
    hasAudioStream: Boolean(audio),
    measurement: audioMeasurement,
  });
  if (audioLevel.finding) findings.push(audioLevel.finding);

  const motionStarted = performance.now();
  notifyVerifyCheck(onCheck, "motion", "start");
  const motion = judgeMotion({
    outputPath,
    cuts: edit?.cuts ?? [],
    fps: expected.fps,
    durationSeconds: actualDuration,
    ffmpegCommand,
    spawnSyncImpl,
  });
  notifyVerifyCheck(onCheck, "motion", "end");
  reportTiming(onTiming, "verify_motion", motionStarted);
  findings.push(...motion.findings);
  const blankStarted = performance.now();
  // 走査の優先順位: (1) 映像が同一と実証できたときの GPU 段 luma、(2) 呼び出し側が進捗付きで
  // 先行実行した走査結果、(3) この場での同期走査。いずれも同じ判定器を通るので結果は同じ。
  const reusedLuma = verifyBlank
    ? blankFramesFromLuma({ luma: reusable?.luma, fps: expected.fps, edit })
    : null;
  if (!verifyBlank) notifyVerifyCheck(onCheck, "blank-frames", "skipped");
  else if (reusedLuma) notifyVerifyCheck(onCheck, "blank-frames", "reused");
  else if (!blankFrameScan) notifyVerifyCheck(onCheck, "blank-frames", "start");
  const blankFrames = verifyBlank
    ? (reusedLuma
      ?? blankFrameScan
      ?? scanBlankFrames({
          outputPath,
          fps: expected.fps,
          edit,
          ffmpegCommand,
          spawnSyncImpl,
        }))
    : { intervals: [], findings: [] };
  if (verifyBlank && !reusedLuma && !blankFrameScan) notifyVerifyCheck(onCheck, "blank-frames", "end");
  // 先行実行された走査の所要時間は呼び出し側が verify_blank として記録済み（0ms で上書きしない）。
  if (!blankFrameScan) reportTiming(onTiming, "verify_blank", blankStarted);
  findings.push(...blankFrames.findings);
  return {
    verdict: findings.some((finding) => finding.severity === "error") ? "fail" : "pass",
    findings,
    ...(evidence.scope === "video" ? { evidence_reuse: evidence.record } : {}),
    measured: {
      duration_seconds: actualDuration,
      width: video?.width ?? null,
      height: video?.height ?? null,
      fps: actualFps,
      video_codec: video?.codec_name ?? null,
      video_profile: video?.profile ?? null,
      pixel_format: video?.pix_fmt ?? null,
      color_range: video?.color_range ?? null,
      audio_codec: audio?.codec_name ?? null,
      frame_count: decodePass.frameCount,
    },
    declared: {
      audio_level: audioLevel.record,
      motion: motion.records,
      blank_frames: blankFrames.intervals,
    },
  };
}

export function reusableGpuVerificationResult(gpuVerification) {
  const finalVerify = gpuVerification?.finalVerify;
  const measured = finalVerify?.measured;
  const decodeStderr = finalVerify?.decode?.stderr;
  const video = measured?.streams?.find((stream) => stream?.codec_type === "video");
  if (!measured || !Array.isArray(measured.streams) || !measured.format
    || typeof decodeStderr !== "string" || !video || finiteFrameCount(video.nb_read_frames) === null) return null;
  return { measured, decodeStderr, luma: gpuVerification?.luma ?? null };
}

// 引き継ぎの前に「同じ映像か」を確かめる項目。復号後の画の性質を決めるものだけを並べる。
// 時刻系（avg_frame_rate / duration）は `-t` の末尾サンプル丸めで数桁だけ動くことがあり、
// しかも成果物側で verify.duration / verify.fps が毎回測り直すので同一性の条件には入れない。
export const VIDEO_STREAM_IDENTITY_FIELDS = Object.freeze([
  "codec_name",
  "profile",
  "width",
  "height",
  "pix_fmt",
  "color_range",
  "r_frame_rate",
]);

/**
 * 映像ストリームのパケットペイロードだけを demux して sha256 を取る（`-c copy` なのでデコードしない）。
 * 実測（4K 600 フレーム・157MB・本機 16 コア）: 全デコード 1.24s / signalstats 走査 16.7s に対し
 * このパスは 0.47s。streamhash muxer を持たない ffmpeg では非 0 終了するので null を返し、
 * 呼び出し側は「同一性を実証できない」= 再走査へ倒れる。
 */
export function hashVideoBitstream({ path, ffmpegCommand = resolveFfmpeg(), spawnSyncImpl = spawnSync }) {
  const result = spawnSyncImpl(
    ffmpegCommand,
    [
      "-hide_banner", "-v", "error", "-nostdin",
      "-i", path,
      "-map", "0:v:0",
      "-c", "copy",
      "-f", "streamhash",
      "-hash", "sha256",
      "-",
    ],
    { encoding: "utf8", maxBuffer: 1024 * 1024 },
  );
  if (result?.error || result?.status !== 0) return null;
  const match = /,v,SHA256=([0-9a-f]{64})/iu.exec(String(result?.stdout ?? ""));
  return match ? match[1].toLowerCase() : null;
}

/**
 * audio_mix の入力（GPU 段が測った composite）と成果物の映像ストリームが同一であることを実証する。
 * 「plan が `-c:v copy` だったのだから同じはず」という前提では判定しない。実際に
 *   1. 復号後の画の性質（コーデック / プロファイル / 解像度 / pix_fmt / color_range / 公称 fps）
 *   2. フレーム数（GPU 段が数えた nb_read_frames と、成果物コンテナの nb_frames）
 *   3. 映像パケットのペイロードの sha256（= ビットストリームそのもの）
 * の 3 つが全て一致したときだけ identical を返す。どれか 1 つでも確かめられなければ
 * 安全側（再走査）へ倒すため identical:false を返す。
 */
export function proveVideoStreamIdentity({
  referencePath,
  referenceStream,
  referenceFrames,
  candidatePath,
  candidateStream,
  ffmpegCommand = resolveFfmpeg(),
  spawnSyncImpl = spawnSync,
}) {
  const unproven = (reason) => ({ identical: false, reason, frames: null, sha256: null });
  if (typeof referencePath !== "string" || referencePath === "") {
    return unproven("audio_mix の入力パスが plan に無い");
  }
  if (!referenceStream || !candidateStream) return unproven("映像ストリームの測定値が揃っていない");
  for (const field of VIDEO_STREAM_IDENTITY_FIELDS) {
    const left = referenceStream[field] ?? null;
    const right = candidateStream[field] ?? null;
    if (String(left) !== String(right)) {
      return unproven(`映像ストリームの ${field} が違う（${String(left)} → ${String(right)}）`);
    }
  }
  if (finiteFrameCount(referenceFrames) === null) return unproven("GPU 段の数えたフレーム数が読めない");
  const candidateFrames = finiteFrameCount(candidateStream.nb_frames);
  if (candidateFrames === null) return unproven("成果物のフレーム数（nb_frames）がコンテナから読めない");
  if (candidateFrames !== Number(referenceFrames)) {
    return unproven(`フレーム数が違う（${referenceFrames} → ${candidateFrames}）`);
  }
  const referenceHash = hashVideoBitstream({ path: referencePath, ffmpegCommand, spawnSyncImpl });
  if (referenceHash === null) return unproven("audio_mix 入力の映像ビットストリームを読めない");
  const candidateHash = hashVideoBitstream({ path: candidatePath, ffmpegCommand, spawnSyncImpl });
  if (candidateHash === null) return unproven("成果物の映像ビットストリームを読めない");
  if (referenceHash !== candidateHash) return unproven("映像ビットストリームが一致しない");
  return { identical: true, reason: null, frames: candidateFrames, sha256: candidateHash };
}

/**
 * 不具合メモ第22項（2026-09-18）: 書き出し後検査が映像を何度も走査していた問題への対処。
 *
 * GPU 段は composite に対して既に「全フレームを数える ffprobe」と「エンコード対象 canvas から
 * 集めた全フレーム luma」を持っている。audio_mix が音声だけを作り直す（映像は `-c:v copy`）
 * 書き出しでは、映像の証拠だけは同じものを使い回せる余地がある。ただし
 *
 *   - 引き継ぎの前に映像ストリームの同一性を実証する（proveVideoStreamIdentity）。
 *   - **音声の証拠は決して引き継がない**。GPU 段が測ったのは音声合成前の composite なので、
 *     最終音声の証拠にはならない。scope "video" では ffprobe の測定値は成果物を測り直し、
 *     音声のデコード検査も音圧測定も成果物に対して毎回実行する。
 *
 * 返す scope の意味:
 *   full  … audio_mix が composite のバイト単位コピー。最終ファイル = GPU 段が測ったファイル。
 *   video … 映像ビットストリームの同一性を実証できた。映像の証拠だけ引き継ぐ。
 *   none  … 実証できなかった / GPU 段の検査値が無い。従来どおり全部測り直す。
 */
export function resolveVideoEvidenceReuse({
  plan,
  gpuVerification = null,
  outputPath,
  ffprobeCommand = resolveFfprobe(),
  ffmpegCommand = resolveFfmpeg(),
  spawnSyncImpl = spawnSync,
  onTiming = null,
  onCheck = null,
}) {
  const audioPlan = plan?.commands?.audio_mix ?? {};
  const reusable = reusableGpuVerificationResult(gpuVerification);
  const probeStarted = performance.now();
  if (reusable !== null && audioPlan.operation === "copy") {
    notifyVerifyCheck(onCheck, "probe", "reused");
    reportTiming(onTiming, "verify_probe", probeStarted);
    const video = reusable.measured.streams.find((stream) => stream?.codec_type === "video");
    return {
      scope: "full",
      reason: "audio_mix は composite のバイトコピーなので最終ファイルは GPU 段が測ったファイルそのもの",
      measured: reusable.measured,
      decodeStderr: reusable.decodeStderr,
      frameCount: finiteFrameCount(video?.nb_read_frames),
      luma: reusable.luma,
      identity: null,
      record: null,
    };
  }
  notifyVerifyCheck(onCheck, "probe", "start");
  const measured = probeMedia(ffprobeCommand, outputPath, spawnSyncImpl);
  notifyVerifyCheck(onCheck, "probe", "end");
  reportTiming(onTiming, "verify_probe", probeStarted);
  const unreusable = (reason, identity = null) => ({
    scope: "none",
    reason,
    measured,
    decodeStderr: null,
    frameCount: null,
    luma: null,
    identity,
    record: null,
  });
  if (reusable === null) {
    return unreusable(gpuVerification === null
      ? "GPU 段の映像検査値が無い（OSR 経路など）"
      : "GPU 段の映像検査値が引き継げる形をしていない");
  }
  const referenceStream = reusable.measured.streams.find((stream) => stream?.codec_type === "video");
  const candidateStream = measured.streams?.find((stream) => stream?.codec_type === "video");
  notifyVerifyCheck(onCheck, "video-identity", "start");
  const identityStarted = performance.now();
  const identity = proveVideoStreamIdentity({
    referencePath: audioPlan.input,
    referenceStream,
    referenceFrames: referenceStream?.nb_read_frames,
    candidatePath: outputPath,
    candidateStream,
    ffmpegCommand,
    spawnSyncImpl,
  });
  reportTiming(onTiming, "verify_video_identity", identityStarted);
  notifyVerifyCheck(onCheck, "video-identity", "end");
  if (!identity.identical) {
    return unreusable(`映像ストリームの同一性を実証できない: ${identity.reason}`, identity);
  }
  return {
    scope: "video",
    reason: "映像ビットストリームが audio_mix 入力と同一",
    measured,
    decodeStderr: reusable.decodeStderr,
    frameCount: identity.frames,
    luma: reusable.luma,
    identity,
    record: {
      scope: "video-only",
      audio_mix_operation: audioPlan.operation ?? null,
      video_bitstream_sha256: identity.sha256,
      video_frames: identity.frames,
      video_luma_reused: Boolean(reusable.luma),
      // 音声の証拠は成果物を毎回測り直す（GPU 段の音声検査は最終音声の証拠にならない）。
      audio_evidence_reused: false,
    },
  };
}

function reusedDecodePass({ evidence, video, audio, outputPath, ffmpegCommand, spawnSyncImpl, onCheck }) {
  const videoDecode = evidence.decodeStderr.trim();
  const frameCount = evidence.frameCount ?? finiteFrameCount(video?.nb_read_frames);
  if (evidence.scope === "full") {
    return {
      ok: videoDecode === "",
      frameCount,
      errorExcerpt: videoDecode || "ffprobe exited successfully",
    };
  }
  // scope "video": 映像は同一と実証済みなので GPU 段のデコード結果を引き継ぐが、
  // 音声は audio_mix が作り直しているため、音声のデコード検査だけは必ず成果物に対して実行する。
  notifyVerifyCheck(onCheck, "audio-decode", audio ? "start" : "skipped");
  const audioDecode = audio
    ? decodeAudioStreamOnly(ffmpegCommand, outputPath, spawnSyncImpl)
    : { ok: true, errorExcerpt: "no audio stream to decode" };
  if (audio) notifyVerifyCheck(onCheck, "audio-decode", "end");
  const failures = [
    ...(videoDecode === "" ? [] : [`video(reused): ${videoDecode}`]),
    ...(audioDecode.ok ? [] : [`audio: ${audioDecode.errorExcerpt}`]),
  ];
  return {
    ok: failures.length === 0,
    frameCount,
    errorExcerpt: failures.join(" / ") || "video decode reused from the identical bitstream; audio decoded without error",
  };
}

// 音声だけをデコードする（`-vn`）。映像を一切触らないので 4K でも数秒で終わる。
function decodeAudioStreamOnly(ffmpegCommand, outputPath, spawnSyncImpl = spawnSync) {
  const result = spawnSyncImpl(
    ffmpegCommand,
    [
      "-hide_banner", "-v", "error", "-nostdin",
      "-i", outputPath,
      "-vn", "-sn", "-dn",
      "-f", "null", "-",
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const stderr = String(result?.stderr ?? "");
  const spawnFailed = Boolean(result?.error);
  return {
    ok: !spawnFailed && result?.status === 0 && stderr.trim() === "",
    errorExcerpt: spawnFailed
      ? messageOf(result.error)
      : (stderr.trim() || `ffmpeg exited ${result?.status ?? "unknown"} with no stderr output`)
          .split(/\r?\n/u)
          .slice(0, 5)
          .join(" / "),
  };
}

function notifyVerifyCheck(callback, check, status) {
  if (typeof callback === "function") callback(check, status);
}

/**
 * 不具合メモ第22項の 3 点目: 黒画面検査を進捗付きで先行実行する。
 * 88 分 4K では走査に約 57 分かかるため、spawnSync のまま（= 終わるまで 1 バイトも読めない）だと
 * 親の進捗ログが無音になり「レンダーが停止した」ように見えていた。走査の引数列と判定器は
 * 同期版とまったく同じなので、出す結果は変わらない。
 * 映像の同一性が実証できて luma を引き継げるときは走査そのものを行わない（null を返し、
 * verifyArtifact 側が luma から同じ判定器で結果を作る）。
 */
export async function prescanBlankFramesWithProgress({
  enabled,
  evidence,
  outputPath,
  fps,
  edit,
  ffmpegCommand,
  expectedFrames,
  reporter,
  onTiming,
}) {
  if (enabled !== true) return null;
  if (blankFramesFromLuma({ luma: evidence?.luma ?? null, fps, edit }) !== null) return null;
  const started = performance.now();
  reporter.verifyCheck("blank-frames", "start");
  const result = await scanBlankFramesStreaming({
    outputPath,
    fps,
    edit,
    ffmpegCommand,
    totalFrames: expectedFrames,
    onProgress: ({ frames, totalFrames }) => reporter.verifyCheckFrames("blank-frames", frames, totalFrames),
  });
  reporter.verifyCheck("blank-frames", "end");
  reportTiming(onTiming, "verify_blank", started);
  return result;
}

function finiteFrameCount(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function reportTiming(callback, name, started) {
  if (typeof callback !== "function") return;
  callback(name, Math.max(0, Math.round(performance.now() - started)));
}

function verifyPngArtifact({ outputPath, plan, ffprobeCommand, spawnSyncImpl }) {
  const frameFiles = readdirSync(outputPath)
    .filter((name) => /^frame-\d{5}\.png$/u.test(name))
    .sort();
  const expectedFrames = Math.round(plan.predicted_duration_seconds * plan.preset.fps);
  const first = frameFiles[0] ? probeMedia(ffprobeCommand, join(outputPath, frameFiles[0]), spawnSyncImpl) : null;
  const last = frameFiles.length > 1 ? probeMedia(ffprobeCommand, join(outputPath, frameFiles.at(-1)), spawnSyncImpl) : first;
  const firstVideo = first?.streams?.find((stream) => stream.codec_type === "video");
  const lastVideo = last?.streams?.find((stream) => stream.codec_type === "video");
  const audio = probeMedia(ffprobeCommand, join(outputPath, "audio.wav"), spawnSyncImpl);
  const audioStream = audio.streams?.find((stream) => stream.codec_type === "audio");
  const audioDuration = Number(audio.format?.duration ?? audioStream?.duration);
  const findings = [];
  compare(findings, "verify.frame-count", frameFiles.length === expectedFrames, `frame count ${frameFiles.length}; expected ${expectedFrames} ±0`);
  compare(findings, "verify.first-resolution", firstVideo?.width === plan.preset.width && firstVideo?.height === plan.preset.height, `first PNG resolution ${firstVideo?.width ?? "missing"}x${firstVideo?.height ?? "missing"}; expected ${plan.preset.width}x${plan.preset.height}`);
  compare(findings, "verify.last-resolution", lastVideo?.width === plan.preset.width && lastVideo?.height === plan.preset.height, `last PNG resolution ${lastVideo?.width ?? "missing"}x${lastVideo?.height ?? "missing"}; expected ${plan.preset.width}x${plan.preset.height}`);
  compare(findings, "verify.audio", audioStream?.codec_name === "pcm_s16le", `audio codec ${audioStream?.codec_name ?? "missing"}; expected pcm_s16le`);
  compare(findings, "verify.audio-duration", Number.isFinite(audioDuration) && Math.abs(audioDuration - plan.predicted_duration_seconds) <= 1 / plan.preset.fps, `audio duration ${audioDuration}s; expected ${plan.predicted_duration_seconds}s ±${1 / plan.preset.fps}s`);
  return {
    verdict: findings.some((finding) => finding.severity === "error") ? "fail" : "pass",
    findings,
    measured: {
      duration_seconds: audioDuration,
      width: firstVideo?.width ?? null,
      height: firstVideo?.height ?? null,
      fps: plan.preset.fps,
      video_codec: "png",
      video_profile: null,
      pixel_format: firstVideo?.pix_fmt ?? null,
      color_range: null,
      audio_codec: audioStream?.codec_name ?? null,
      frame_count: frameFiles.length,
      first,
      last,
      audio,
    },
    declared: { audio_level: null, motion: [], blank_frames: [] },
  };
}

// render-cut ハードルール 10: ffmpeg 本体を直叩き（ラッパー禁止）。task が挙げる
// `ffmpeg -v error -i <out> -f null -` 相当（map 指定なし = 全ストリームをデコード）に
// `-progress pipe:1` を足し、stdout に構造化された frame=N の進捗行（常に映像フレーム数）を
// 吐かせつつ stderr は `-v error` のみ（デコードエラーだけが載る）にすることで、1 回の全デコード
// から実フレーム数とデコード成否の両方を取り出す（検査 1 + 2 の統合。task 契約が許容する範囲）。
function decodeAllFramesAndCount(ffmpegCommand, outputPath, spawnSyncImpl = spawnSync) {
  const result = spawnSyncImpl(
    ffmpegCommand,
    [
      "-hide_banner",
      "-v",
      "error",
      "-nostdin",
      "-i",
      outputPath,
      "-progress",
      "pipe:1",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const frameMatches = [...stdout.matchAll(/^frame=(\d+)$/gmu)];
  const frameCount = frameMatches.length > 0 ? Number(frameMatches.at(-1)[1]) : null;
  const spawnFailed = Boolean(result.error);
  const ok = !spawnFailed && result.status === 0 && stderr.trim() === "";
  const errorExcerpt = spawnFailed
    ? messageOf(result.error)
    : (stderr.trim() || `ffmpeg exited ${result.status ?? "unknown"} with no stderr output`)
        .split(/\r?\n/u)
        .slice(0, 5)
        .join(" / ");
  return { ok, frameCount, errorExcerpt };
}

export function probeMedia(command, path, spawnSyncImpl = spawnSync) {
  const result = spawnSyncImpl(command, ["-v", "error", "-show_streams", "-show_format", "-of", "json", path], { encoding: "utf8" });
  if (result.error) throw new ExecutionError(messageOf(result.error));
  if (result.status !== 0) throw new ExecutionError(`ffprobe failed for ${basename(path)}: ${result.stderr.trim()}`);
  return parseJson(result.stdout, `ffprobe ${basename(path)}`);
}

function declaredAudioReasons({ plan, inputs, edit }) {
  const reasons = [];
  const audioPlan = plan.commands.audio_mix ?? {};
  if (audioPlan.hasAudibleAudio === true) {
    if (edit?.audio?.bgm) reasons.push("bgm");
    if (Array.isArray(edit?.audio?.sfx) && edit.audio.sfx.length > 0) reasons.push("sfx");
    if (audioPlan.hasNarration === true) reasons.push("narration");
    if (edit?.audio?.master && typeof edit.audio.master === "object") reasons.push("master");
    if (reasons.length === 0) reasons.push("audio_mix");
  }
  if (inputs.some((input) => input?.has_audio === true || input?.hasAudio === true)) {
    reasons.push("素材音声");
  }
  return [...new Set(reasons)];
}

function compare(findings, check, passed, message) {
  findings.push({ severity: passed ? "info" : "error", check, message });
}

// task 2026-08-07-render-frame-accounting: how much avg_frame_rate is allowed to drift from the
// nominal fps before verify.fps fails, expressed as "1 frame's worth of container-duration
// rounding" -- see the call site in verifyArtifact for the empirical justification. Exported (and
// kept pure/number-only) so the exact boundary -- 1 frame passes, a genuine multi-frame drop like
// v1's still fails -- can be pinned in tests without needing to reproduce the encoder/mux quirk
// that motivated it in an actual media file.
export function oneFrameFpsTolerance(expectedFps, expectedFrameCount) {
  return expectedFrameCount > 0 ? expectedFps / expectedFrameCount : 0;
}

export function fpsWithinOneFrameTolerance(actualFps, expectedFps, expectedFrameCount) {
  if (!Number.isFinite(actualFps)) return false;
  // +1e-9 absorbs float noise at the exact boundary (a real 1-frame-off case, like the reel's
  // v4/v5 render, lands diff === tolerance to within float precision, not strictly under it).
  return Math.abs(actualFps - expectedFps) <= oneFrameFpsTolerance(expectedFps, expectedFrameCount) + 1e-9;
}

export function parseRate(value) {
  if (typeof value !== "string") return Number.NaN;
  const [top, bottom = "1"] = value.split("/");
  return Number(top) / Number(bottom);
}
