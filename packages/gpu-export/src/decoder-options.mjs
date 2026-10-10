function integer(value, label, allowZero = false) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || (allowZero ? number < 0 : number <= 0) || value === "") {
    throw new Error(`${label} must be ${allowZero ? "a non-negative" : "a positive"} integer`);
  }
  return number;
}

export function resolveDecoderOptions(env = process.env) {
  const stallMs = integer(env.AKARI_EXPORT_DECODER_STALL_MS ?? 8_000, "AKARI_EXPORT_DECODER_STALL_MS");
  const recoveryAttempts = integer(env.AKARI_EXPORT_DECODER_RETRIES ?? 3, "AKARI_EXPORT_DECODER_RETRIES", true);
  const requestedTimeout = integer(env.AKARI_EXPORT_DECODE_TIMEOUT_MS ?? 30_000, "AKARI_EXPORT_DECODE_TIMEOUT_MS");
  return {
    stallMs,
    recoveryAttempts,
    recoveryBackoffMs: [500, 1_000, 2_000],
    tickTimeoutMs: Math.max(requestedTimeout, stallMs),
  };
}
