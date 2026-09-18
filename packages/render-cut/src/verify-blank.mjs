import { spawn, spawnSync } from "node:child_process";

export const BLANK_FRAME_MIN_DURATION_SECONDS = 0.3;
export const BLANK_FRAME_YMAX_TOLERANCE = 8;
export const BLANK_FRAME_SPREAD_TOLERANCE = 16;
export const BLANK_FRAME_BACKGROUND_FRACTION = 0.05;

const CAPTURE_LIMIT_BYTES = 64 * 1024 * 1024;

export function parseSignalstatsMetadata(output) {
  const samples = [];
  let pending = null;

  const finish = () => {
    if (!pending) return;
    if (Number.isFinite(pending.pts_time) && Number.isFinite(pending.ymax)) {
      samples.push(pending);
    }
    pending = null;
  };

  for (const line of textOf(output).split(/\r?\n/u)) {
    const frame = /frame:\s*(\d+)\s+pts:\s*(-?\d+)\s+pts_time:\s*([^\s]+)/u.exec(line);
    if (frame) {
      const frameNumber = Number(frame[1]);
      const pts = Number(frame[2]);
      if (pending?.frame === frameNumber && pending?.pts === pts) continue;
      finish();
      pending = {
        frame: frameNumber,
        pts,
        pts_time: Number(frame[3]),
      };
      continue;
    }
    const stat = /lavfi\.signalstats\.(YMIN|YMAX)=([+-]?(?:\d+(?:\.\d*)?|\.\d+))/u.exec(line);
    if (!stat || !pending) continue;
    const value = Number(stat[2]);
    if (!Number.isFinite(value)) continue;
    pending[stat[1].toLowerCase()] = value;
  }
  finish();
  return samples;
}

// The contract defines the background as the median of the lowest five percent of all YMAX
// observations. This remains relative to the artifact rather than assuming limited-range black.
export function estimateBackgroundYmax(samplesOrValues) {
  const values = (Array.isArray(samplesOrValues) ? samplesOrValues : [])
    .map((sample) => typeof sample === "number" ? sample : sample?.ymax)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (values.length === 0) return null;
  const lowestCount = Math.max(1, Math.ceil(values.length * BLANK_FRAME_BACKGROUND_FRACTION));
  const lowest = values.slice(0, lowestCount);
  const middle = Math.floor(lowest.length / 2);
  return lowest.length % 2 === 1
    ? lowest[middle]
    : (lowest[middle - 1] + lowest[middle]) / 2;
}

export function detectBlankIntervals(
  samples,
  {
    fps,
    backgroundYmax = estimateBackgroundYmax(samples),
    tolerance = BLANK_FRAME_YMAX_TOLERANCE,
    spreadTolerance = BLANK_FRAME_SPREAD_TOLERANCE,
    minimumDurationSeconds = BLANK_FRAME_MIN_DURATION_SECONDS,
  } = {},
) {
  if (!Array.isArray(samples) || samples.length === 0
    || !Number.isFinite(fps) || fps <= 0
    || !Number.isFinite(backgroundYmax)) return [];
  const frameDuration = 1 / fps;
  const threshold = backgroundYmax + tolerance;
  const intervals = [];
  let run = null;

  const finish = () => {
    if (!run) return;
    const duration = run.frames * frameDuration;
    if (duration + Number.EPSILON >= minimumDurationSeconds) {
      intervals.push({
        start: roundSeconds(run.start),
        duration: roundSeconds(duration),
        ymax_max: run.ymaxMax,
      });
    }
    run = null;
  };

  for (const sample of samples) {
    if (!Number.isFinite(sample?.pts_time) || !Number.isFinite(sample?.ymax)) {
      finish();
      continue;
    }
    // Blank frames are flat (YMAX ~= YMIN), while drawn detail can keep YMIN low and raise
    // YMAX, so spread separates dark content without an absolute brightness threshold.
    const spreadIsBlank = !Number.isFinite(sample.ymin)
      || sample.ymax - sample.ymin <= spreadTolerance;
    if (sample.ymax <= threshold && spreadIsBlank) {
      if (!run) run = { start: sample.pts_time, frames: 0, ymaxMax: sample.ymax };
      run.frames += 1;
      run.ymaxMax = Math.max(run.ymaxMax, sample.ymax);
    } else {
      finish();
    }
  }
  finish();
  return intervals;
}

export function activeIdsForInterval(edit, interval) {
  const intervalStart = Number(interval?.start);
  const intervalEnd = intervalStart + Number(interval?.duration);
  if (!Number.isFinite(intervalStart) || !Number.isFinite(intervalEnd) || intervalEnd <= intervalStart) {
    return { active_overlays: [], active_cuts: [] };
  }

  const activeOverlays = [];
  for (const overlay of edit?.overlays ?? []) {
    const start = Number(overlay?.start);
    const duration = Number(overlay?.duration);
    if (typeof overlay?.id === "string" && overlaps(start, duration, intervalStart, intervalEnd)) {
      activeOverlays.push(overlay.id);
    }
  }

  const activeCuts = [];
  const cursors = new Map();
  for (const cut of edit?.cuts ?? []) {
    const track = Number.isInteger(cut?.track) && cut.track >= 0 ? cut.track : 0;
    const cursor = cursors.get(track) ?? 0;
    const start = isNonNegativeFinite(cut?.at) ? cut.at : cursor;
    const duration = cutOutputDuration(cut);
    cursors.set(track, start + duration);
    if (typeof cut?.id === "string" && overlaps(start, duration, intervalStart, intervalEnd)) {
      activeCuts.push(cut.id);
    }
  }

  return {
    active_overlays: [...new Set(activeOverlays)],
    active_cuts: [...new Set(activeCuts)],
  };
}

export function blankIntervalSeverity(interval) {
  return (interval?.active_overlays?.length ?? 0) > 0 || (interval?.active_cuts?.length ?? 0) > 0
    ? "warning"
    : "info";
}

export function annotateBlankIntervals(intervals, edit) {
  return (Array.isArray(intervals) ? intervals : []).map((interval) => {
    const active = activeIdsForInterval(edit, interval);
    const record = { ...interval, ...active };
    return { ...record, severity: blankIntervalSeverity(record) };
  });
}

export function blankFrameFindings(intervals, { backgroundYmax, spreadTolerance } = {}) {
  const thresholdDetails = Number.isFinite(backgroundYmax) && Number.isFinite(spreadTolerance)
    ? `; background_ymax ${formatSeconds(backgroundYmax)}; spread 許容 ${formatSeconds(spreadTolerance)}`
    : "";
  return (Array.isArray(intervals) ? intervals : []).map((interval) => {
    const active = [
      ...(interval.active_overlays ?? []).map((id) => `overlay:${id}`),
      ...(interval.active_cuts ?? []).map((id) => `cut:${id}`),
    ];
    return {
      severity: interval.severity,
      check: "verify.blank-frames",
      message: `空フレーム候補 ${formatSeconds(interval.start)}s–${formatSeconds(interval.start + interval.duration)}s（${formatSeconds(interval.duration)} 秒、YMAX 最大 ${formatSeconds(interval.ymax_max)}）${active.length > 0 ? `; 活性 ${active.join(", ")}` : "; 活性 overlay/cut なし"}${thresholdDetails}`,
    };
  });
}

/**
 * GPU exporter がエンコード対象 canvas から集計したフレーム単位の YMIN/YMAX を、
 * signalstats 経路と同じサンプル列へ戻して同じ判定器へ通す。欠損・不正値は null にして
 * 呼び出し側を従来の scanBlankFrames へフォールバックさせる。
 */
export function blankFramesFromLuma({
  luma,
  fps,
  edit = null,
  spreadTolerance = BLANK_FRAME_SPREAD_TOLERANCE,
} = {}) {
  if (!luma || !Array.isArray(luma.ymin) || !Array.isArray(luma.ymax)
    || luma.ymin.length === 0 || luma.ymin.length !== luma.ymax.length
    || !Number.isFinite(fps) || fps <= 0) return null;
  const samples = [];
  for (let frame = 0; frame < luma.ymin.length; frame += 1) {
    const ymin = Number(luma.ymin[frame]);
    const ymax = Number(luma.ymax[frame]);
    if (!Number.isInteger(ymin) || !Number.isInteger(ymax)
      || ymin < 0 || ymin > 255 || ymax < 0 || ymax > 255 || ymin > ymax) return null;
    samples.push({ frame, pts_time: frame / fps, ymin, ymax });
  }
  const backgroundYmax = estimateBackgroundYmax(samples);
  const intervals = annotateBlankIntervals(
    detectBlankIntervals(samples, { fps, backgroundYmax, spreadTolerance }),
    edit,
  );
  return {
    ok: true,
    background_ymax: backgroundYmax,
    intervals,
    findings: blankFrameFindings(intervals, { backgroundYmax, spreadTolerance }),
    error: null,
  };
}

// No -skip_frame or scale is used: signalstats sees every decoded frame, so the minimum
// detectable/reported run remains exactly BLANK_FRAME_MIN_DURATION_SECONDS (subject to fps).
// Print only YMIN and YMAX: all signalstats keys inflate capture by about 13x per frame and
// can exhaust CAPTURE_LIMIT_BYTES on long artifacts.
//
// 不具合メモ第22項（2026-09-18）の検討記録: この走査自体は軽くできなかった。
//   - signalstats は既定で slice threading が効いている（実測: 4K 600 フレームで
//     -filter_threads 1 が 36.9s、既定（16 コア）が 15.1s）ので、並列化の余地は残っていない。
//   - 画素を減らす（scale で縮小）・別フィルタに替える（blackdetect 等）・フレームを飛ばす
//     （-skip_frame）はいずれも「測っているもの」が変わる = 証拠の強度が下がるので採らない。
// よって速くする手は「同じ証拠をより少ない走査で得る」= GPU 段が同じ canvas から集計した
// 全フレーム luma を、映像ストリームの同一性を実証できたときに引き継ぐことだけ
// （render-cut.mjs の resolveVideoEvidenceReuse / blankFramesFromLuma）。
export function blankFrameScanArgs(outputPath) {
  return [
    "-hide_banner",
    "-nostats",
    "-nostdin",
    "-i",
    outputPath,
    "-map",
    "0:v:0",
    "-vf",
    "signalstats,metadata=print:key=lavfi.signalstats.YMIN,metadata=print:key=lavfi.signalstats.YMAX",
    "-an",
    "-sn",
    "-dn",
    "-f",
    "null",
    "-",
  ];
}

// 同期版・ストリーミング版が同じ判定器を通って同じ結果を返すための共有部。
function buildBlankFrameScanResult({ metadata, failed, stderr, error, fps, edit, spreadTolerance }) {
  const samples = parseSignalstatsMetadata(metadata);
  if (failed || samples.length === 0) {
    return {
      ok: false,
      background_ymax: estimateBackgroundYmax(samples),
      intervals: [],
      findings: [],
      error: lastMeaningfulLine(stderr) || messageOf(error) || "signalstats did not report YMAX",
    };
  }
  const backgroundYmax = estimateBackgroundYmax(samples);
  const intervals = annotateBlankIntervals(
    detectBlankIntervals(samples, { fps, backgroundYmax, spreadTolerance }),
    edit,
  );
  return {
    ok: true,
    background_ymax: backgroundYmax,
    intervals,
    findings: blankFrameFindings(intervals, { backgroundYmax, spreadTolerance }),
    error: null,
  };
}

export function scanBlankFrames({
  outputPath,
  fps,
  edit = null,
  spreadTolerance = BLANK_FRAME_SPREAD_TOLERANCE,
  ffmpegCommand = "ffmpeg",
  spawnSyncImpl = spawnSync,
}) {
  const result = spawnSyncImpl(
    ffmpegCommand,
    blankFrameScanArgs(outputPath),
    { encoding: "utf8", maxBuffer: CAPTURE_LIMIT_BYTES },
  );
  return buildBlankFrameScanResult({
    metadata: `${textOf(result?.stdout)}\n${textOf(result?.stderr)}`,
    failed: Boolean(result?.error) || result?.status !== 0,
    stderr: result?.stderr,
    error: result?.error,
    fps,
    edit,
    spreadTolerance,
  });
}

/**
 * scanBlankFrames と同じ引数列・同じ判定器を使い、同じ結果を返す非同期版。
 * 違いは出力を逐次読むことだけなので、進み具合（何フレームまで測ったか）を走査中に通知できる。
 * spawnSync では子プロセスが終わるまで 1 バイトも読めず、88 分 4K では約 57 分間まったく
 * 音沙汰が無いため「レンダーが停止した」ように見えていた（不具合メモ第22項の 3 点目）。
 */
export function scanBlankFramesStreaming({
  outputPath,
  fps,
  edit = null,
  spreadTolerance = BLANK_FRAME_SPREAD_TOLERANCE,
  ffmpegCommand = "ffmpeg",
  spawnImpl = spawn,
  onProgress = null,
  totalFrames = 0,
  progressIntervalFrames = 300,
}) {
  return new Promise((resolvePromise) => {
    let child;
    try {
      child = spawnImpl(ffmpegCommand, blankFrameScanArgs(outputPath), {
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolvePromise(buildBlankFrameScanResult({
        metadata: "", failed: true, stderr: "", error, fps, edit, spreadTolerance,
      }));
      return;
    }
    let stdout = "";
    let stderr = "";
    let captured = 0;
    let overflowed = false;
    let highestFrame = -1;
    let reportedFrame = -1;
    let settled = false;
    // 行境界をまたぐチャンク分割で frame: 見出しを取りこぼさないための持ち越し。
    const carry = { stdout: "", stderr: "" };

    // 通知は必ず単調増加。同じフレーム位置を二度通知しない。
    const notify = (force) => {
      if (typeof onProgress !== "function" || highestFrame < 0) return;
      if (highestFrame === reportedFrame) return;
      if (!force && highestFrame - reportedFrame < progressIntervalFrames) return;
      reportedFrame = highestFrame;
      onProgress({ frames: highestFrame + 1, totalFrames });
    };

    // 2 つの metadata フィルタが 1 フレームにつき 2 本の見出しを出すので、本数ではなく
    // frame: の最大値（フレーム索引）を進み具合として使う。
    const absorbFrameHeadings = (text) => {
      for (const match of text.matchAll(/frame:\s*(\d+)/gu)) {
        const value = Number(match[1]);
        if (Number.isInteger(value) && value > highestFrame) highestFrame = value;
      }
    };

    const scanForProgress = (which, chunk) => {
      const text = carry[which] + chunk;
      const lastBreak = text.lastIndexOf("\n");
      carry[which] = lastBreak === -1 ? text : text.slice(lastBreak + 1);
      if (lastBreak !== -1) absorbFrameHeadings(text.slice(0, lastBreak));
      notify(false);
    };

    const absorb = (which, chunk) => {
      const text = chunk.toString();
      captured += Buffer.byteLength(text);
      if (captured > CAPTURE_LIMIT_BYTES) {
        // spawnSync の maxBuffer 超過（ENOBUFS）と同じ扱いにする。
        overflowed = true;
        child.kill();
        return;
      }
      if (which === "stdout") stdout += text; else stderr += text;
      scanForProgress(which, text);
    };

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => absorb("stdout", chunk));
    child.stderr?.on("data", (chunk) => absorb("stderr", chunk));

    const finish = (failed, error) => {
      if (settled) return;
      settled = true;
      // 改行で終わっていない最後の一行も進捗の対象にする。
      absorbFrameHeadings(carry.stdout);
      absorbFrameHeadings(carry.stderr);
      notify(true);
      resolvePromise(buildBlankFrameScanResult({
        metadata: `${stdout}\n${stderr}`,
        failed,
        stderr,
        error: error ?? (overflowed ? new Error("signalstats output exceeded bounded capture") : null),
        fps,
        edit,
        spreadTolerance,
      }));
    };

    child.on("error", (error) => finish(true, error));
    child.on("close", (code) => finish(overflowed || code !== 0, null));
  });
}

function cutOutputDuration(cut) {
  if (Number.isFinite(cut?.duration) && cut.duration >= 0) return cut.duration;
  if (!Number.isFinite(cut?.in) || !Number.isFinite(cut?.out) || cut.out < cut.in) return 0;
  const speed = Number.isFinite(cut.speed) && cut.speed > 0 ? cut.speed : 1;
  const freeze = Number.isFinite(cut?.freeze?.duration_sec) && cut.freeze.duration_sec > 0
    ? cut.freeze.duration_sec
    : 0;
  return (cut.out - cut.in) / speed + freeze;
}

function overlaps(start, duration, intervalStart, intervalEnd) {
  return Number.isFinite(start) && Number.isFinite(duration) && duration > 0
    && start < intervalEnd && start + duration > intervalStart;
}

function isNonNegativeFinite(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function roundSeconds(value) {
  return Number(value.toFixed(6));
}

function formatSeconds(value) {
  return Number(value.toFixed(3)).toString();
}

function textOf(value) {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  return Buffer.from(value).toString("utf8");
}

function lastMeaningfulLine(value) {
  return textOf(value).trim().split(/\r?\n/u).filter(Boolean).at(-1) ?? "";
}

function messageOf(error) {
  return error instanceof Error ? error.message : error ? String(error) : "";
}
