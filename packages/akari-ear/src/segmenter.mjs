export function createSegmenter() {
  let firstT;
  let previousPartial;
  let previousFinal;
  return {
    push({ t, final, text, confidence, t0 }) {
      const value = String(text ?? '').trim();
      if (!value) return undefined;
      if (!final) {
        if (value === previousPartial) return undefined;
        firstT ??= Number.isFinite(t0) ? t0 : t;
        previousPartial = value;
        return undefined;
      }
      const start = Number.isFinite(t0) ? t0 : (firstT ?? t);
      firstT = undefined;
      previousPartial = undefined;
      if (value === previousFinal) return undefined;
      previousFinal = value;
      return { t0: start, t1: t, text: value,
        ...(Number.isFinite(confidence) ? { confidence } : {}) };
    }
  };
}
