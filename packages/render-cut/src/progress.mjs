export const PROGRESS_STAGES = ["prepare", "audio-cut", "render", "audio-mix", "verify"];

const PROGRESS_STAGE_SET = new Set(PROGRESS_STAGES);

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

function toNonNegativeInteger(value) {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}
