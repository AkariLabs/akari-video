export const PROGRESS_STAGES = ["prepare", "audio-cut", "render", "audio-mix", "verify"];

// 不具合メモ第22項（2026-09-18）: verify 段の中で何が走っているかを親の進捗ログへ出す。
// 88 分 4K では verify 段だけで約 63 分かかり、そのうち黒画面検査（signalstats の全フレーム走査）が
// 約 57 分を占めるため、段の開始/終了しか出ないと「レンダーが停止した」ように見えていた。
export const VERIFY_CHECKS = [
  "probe",
  "video-identity",
  "decode",
  "audio-decode",
  "audio-level",
  "motion",
  "blank-frames",
];

// reused = 同じ証拠をより少ない走査で得たので走らせなかった（省略ではない）。
// skipped = その検査の対象が無い、または利用者が明示的に無効化した。
export const VERIFY_CHECK_STATUSES = ["start", "end", "reused", "skipped"];

const PROGRESS_STAGE_SET = new Set(PROGRESS_STAGES);
const VERIFY_CHECK_SET = new Set(VERIFY_CHECKS);
const VERIFY_CHECK_STATUS_SET = new Set(VERIFY_CHECK_STATUSES);

export function createProgressReporter({ enabled, io, totalMs }) {
  const doneTotalMs = toNonNegativeInteger(totalMs);
  const emit = enabled === true
    ? (line) => io.log(line)
    : () => {};

  return {
    stageStart(stage, extra) {
      assertProgressStage(stage);
      const engine = stage === "render" && (extra?.engine === "gpu" || extra?.engine === "osr")
        ? ` engine=${extra.engine}`
        : "";
      emit(`PROGRESS stage=${stage} status=start${engine}`);
    },
    stageEnd(stage) {
      assertProgressStage(stage);
      emit(`PROGRESS stage=${stage} status=end`);
    },
    cutTime(seconds, totalSeconds) {
      const cutTotalMs = toNonNegativeInteger(Number(totalSeconds) * 1000);
      const outTimeMs = Math.min(cutTotalMs, toNonNegativeInteger(Number(seconds) * 1000));
      emit(`PROGRESS out_time_ms=${outTimeMs} total_ms=${cutTotalMs}`);
    },
    // 既存の `PROGRESS stage=<stage> status=<start|end>` とは別の行形（check= が付く）にしてある。
    // シェル側の進捗パーサは stage 行を `status=(start|end)(engine=...)?$` で厳格に照合し、
    // 一致しない行は無視するので、この追加行が既存の進捗表示を壊すことはない。
    verifyCheck(check, status) {
      assertVerifyCheck(check);
      if (!VERIFY_CHECK_STATUS_SET.has(status)) {
        throw new TypeError(`Unknown verify check status: ${status}`);
      }
      emit(`PROGRESS stage=verify check=${check} status=${status}`);
    },
    verifyCheckFrames(check, frames, totalFrames) {
      assertVerifyCheck(check);
      const done = toNonNegativeInteger(frames);
      const total = toNonNegativeInteger(totalFrames);
      emit(`PROGRESS stage=verify check=${check} frames=${done}${total > 0 ? ` total_frames=${total}` : ""}`);
    },
    done() {
      emit(`PROGRESS done total_ms=${doneTotalMs}`);
    },
  };
}

function assertProgressStage(stage) {
  if (!PROGRESS_STAGE_SET.has(stage)) {
    throw new TypeError(`Unknown progress stage: ${stage}`);
  }
}

function assertVerifyCheck(check) {
  if (!VERIFY_CHECK_SET.has(check)) {
    throw new TypeError(`Unknown verify check: ${check}`);
  }
}

function toNonNegativeInteger(value) {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}
