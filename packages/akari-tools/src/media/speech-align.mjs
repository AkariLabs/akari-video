const round = (value) => Number(Number(value).toFixed(6));

export const SPEECH_SNAP_DEFAULTS = Object.freeze({
  toleranceSec: 0.5,
  padInSec: 0.06,
  padOutSec: 0.12,
  minDurSec: 0.3,
  minWordSec: 0.05,
});

export const SPEECH_DETECT_DEFAULTS = Object.freeze({
  thresholdRatio: 3,
  minSpeechSec: 0.12,
  minGapSec: 0.18,
});

function normalizedChunks(chunks) {
  const sorted = (Array.isArray(chunks) ? chunks : []).flatMap((chunk) => {
    const start = Number(Array.isArray(chunk) ? chunk[0] : chunk?.start);
    const end = Number(Array.isArray(chunk) ? chunk[1] : chunk?.end);
    return Number.isFinite(start) && Number.isFinite(end) && end > start
      ? [{ start, end }]
      : [];
  }).sort((left, right) => left.start - right.start);
  const merged = [];
  for (const chunk of sorted) {
    const previous = merged.at(-1);
    if (previous && chunk.start <= previous.end) previous.end = Math.max(previous.end, chunk.end);
    else merged.push({ ...chunk });
  }
  return merged;
}

/** silencedetect の無音一覧の補集合を発話チャンクとして返す。 */
export function detectSpeechChunks({ silences = [], duration }) {
  const limit = Number(duration);
  if (!Number.isFinite(limit) || limit <= 0) return [];
  const quiet = normalizedChunks(silences).flatMap((silence) => {
    const start = Math.max(0, Math.min(limit, silence.start));
    const end = Math.max(0, Math.min(limit, silence.end));
    return end > start ? [{ start, end }] : [];
  });
  const chunks = [];
  let cursor = 0;
  for (const silence of quiet) {
    if (silence.start > cursor) chunks.push({ start: round(cursor), end: round(silence.start) });
    cursor = Math.max(cursor, silence.end);
  }
  if (cursor < limit) chunks.push({ start: round(cursor), end: round(limit) });
  return chunks;
}

/** 旧 Akari OS の RMS 適応しきい値 + ヒステリシス実装。 */
export function detectSpeechChunksFromPeaks(peaks, binSec = 0.02, opts = {}) {
  const rms = peaks?.rms ?? peaks;
  const values = ArrayBuffer.isView(rms) ? rms : Array.isArray(rms) ? rms : [];
  if (!values.length || !Number.isFinite(binSec) || binSec <= 0) return [];
  const {
    thresholdRatio = SPEECH_DETECT_DEFAULTS.thresholdRatio,
    minSpeechSec = SPEECH_DETECT_DEFAULTS.minSpeechSec,
    minGapSec = SPEECH_DETECT_DEFAULTS.minGapSec,
  } = opts;
  const sorted = Array.from(values, Number).sort((left, right) => left - right);
  const noiseFloor = sorted[Math.floor(sorted.length * 0.2)] ?? 0;
  const rmsMax = sorted.at(-1) ?? 0;
  const enterThreshold = Math.max(noiseFloor * thresholdRatio, rmsMax * 0.06);
  const exitThreshold = enterThreshold * 0.7;
  const raw = [];
  let start = null;
  for (let index = 0; index < values.length; index += 1) {
    const value = Number(values[index]);
    if (start === null && value >= enterThreshold) start = index * binSec;
    else if (start !== null && value < exitThreshold) {
      raw.push({ start, end: index * binSec });
      start = null;
    }
  }
  if (start !== null) raw.push({ start, end: values.length * binSec });
  const merged = [];
  for (const chunk of raw) {
    const previous = merged.at(-1);
    if (previous && chunk.start - previous.end < minGapSec) previous.end = chunk.end;
    else merged.push({ ...chunk });
  }
  return merged.filter((chunk) => chunk.end - chunk.start >= minSpeechSec)
    .map((chunk) => ({ start: round(chunk.start), end: round(chunk.end) }));
}

function textWeight(text) {
  return Math.max(1, Array.from(String(text ?? "").replace(/\s/g, "")).length);
}

function assignWord(word, chunks, minWordSec) {
  const start = Number(word.start);
  const end = Number(word.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  let best = null;
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const overlap = Math.max(0, Math.min(end, chunk.end) - Math.max(start, chunk.start));
    if (overlap > (best?.overlap ?? 0)) best = { index, chunk, overlap };
  }
  const wordDuration = end - start;
  const requiredOverlap = Math.min(minWordSec, wordDuration);
  const fullyContained = best && start >= best.chunk.start && end <= best.chunk.end;
  if (best && (fullyContained || best.overlap + 1e-9 >= requiredOverlap)) {
    return {
      chunkIndex: best.index,
      start: Math.max(start, best.chunk.start),
      end: Math.min(end, best.chunk.end),
      displaced: start < best.chunk.start || end > best.chunk.end,
    };
  }
  const nextIndex = chunks.findIndex((chunk) => chunk.end - chunk.start >= minWordSec && chunk.start >= start);
  if (nextIndex < 0) {
    const previousIndex = chunks.findLastIndex((chunk) => chunk.end - chunk.start >= minWordSec && chunk.end <= end);
    if (previousIndex < 0) return null;
    const chunk = chunks[previousIndex];
    return { chunkIndex: previousIndex, start: chunk.end - minWordSec, end: chunk.end, displaced: true };
  }
  const chunk = chunks[nextIndex];
  return { chunkIndex: nextIndex, start: chunk.start, end: chunk.start + minWordSec, displaced: true };
}

/** 語を発話チャンク内へ吸着し、連続語を文字数比で再配分する。 */
export function snapWordsToSpeech(words, chunks, opts = {}) {
  const minWordSec = Number(opts.minWordSec ?? SPEECH_SNAP_DEFAULTS.minWordSec);
  const speech = normalizedChunks(chunks);
  const source = Array.isArray(words) ? words : [];
  if (!speech.length) return { words: source.map((word) => ({ ...word })), moved: 0, total: source.length };
  const assigned = source.map((word) => assignWord(word, speech, minWordSec));
  const timing = assigned.map((item, index) => item ?? {
    chunkIndex: -1,
    start: Number(source[index]?.start),
    end: Number(source[index]?.end),
    displaced: false,
  });

  for (let first = 0; first < timing.length;) {
    if (timing[first].chunkIndex < 0) { first += 1; continue; }
    let last = first + 1;
    while (last < timing.length && timing[last].chunkIndex === timing[first].chunkIndex) last += 1;
    const group = timing.slice(first, last);
    const collides = group.some((item, index) => item.displaced
      || (index > 0 && item.start < group[index - 1].end));
    if (collides) {
      const chunk = speech[group[0].chunkIndex];
      const required = group.length * minWordSec;
      let groupStart = Math.max(chunk.start, Math.min(...group.map((item) => item.start)));
      let groupEnd = Math.min(chunk.end, Math.max(...group.map((item) => item.end), groupStart + required));
      if (groupEnd - groupStart < required) groupStart = Math.max(chunk.start, groupEnd - required);
      const span = Math.max(0, groupEnd - groupStart);
      const weights = source.slice(first, last).map((word) => textWeight(word.text));
      const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
      let cursor = groupStart;
      for (let index = first; index < last; index += 1) {
        const remaining = last - index - 1;
        const proportional = span * weights[index - first] / totalWeight;
        const end = index === last - 1 ? groupEnd
          : Math.min(groupEnd - remaining * minWordSec, cursor + Math.max(minWordSec, proportional));
        timing[index] = { ...timing[index], start: cursor, end };
        cursor = end;
      }
    }
    first = last;
  }

  let previousEnd = 0;
  let moved = 0;
  const snapped = source.map((word, index) => {
    const originalStart = Number(word.start);
    const originalEnd = Number(word.end);
    if (timing[index].chunkIndex < 0) {
      previousEnd = Math.max(previousEnd, originalEnd);
      return { ...word };
    }
    let start = Math.max(previousEnd, timing[index].start);
    let end = Math.max(start + minWordSec, timing[index].end);
    const chunk = speech[timing[index].chunkIndex];
    if (chunk && previousEnd + minWordSec <= chunk.end) {
      start = Math.max(previousEnd, chunk.start, Math.min(start, chunk.end - minWordSec));
      end = Math.max(start + minWordSec, Math.min(end, chunk.end));
    } else if (chunk) {
      // 入力順の単調性を最終不変条件とする。チャンク内に残り幅が無い場合は
      // previousEnd を巻き戻さず、最短長を確保してチャンク境界の外側へ送る。
      start = Math.max(previousEnd, start);
      end = Math.max(start + minWordSec, end);
    }
    start = round(start);
    end = round(Math.max(start + minWordSec, end));
    previousEnd = end;
    if (start === originalStart && end === originalEnd) return { ...word };
    moved += 1;
    return { ...word, start, end, raw_start: word.raw_start ?? originalStart, raw_end: word.raw_end ?? originalEnd };
  });
  return { words: snapped, moved, total: source.length };
}

/** 行境界を先頭・末尾語から再計算する。 */
export function snapSegmentsToWords(segments, opts = {}) {
  const padInSec = Number(opts.padInSec ?? SPEECH_SNAP_DEFAULTS.padInSec);
  const padOutSec = Number(opts.padOutSec ?? SPEECH_SNAP_DEFAULTS.padOutSec);
  const minDurSec = Number(opts.minDurSec ?? SPEECH_SNAP_DEFAULTS.minDurSec);
  return (Array.isArray(segments) ? segments : []).map((segment) => {
    if (!Array.isArray(segment.words) || segment.words.length === 0) return { ...segment };
    const start = round(Math.max(0, Number(segment.words[0].start) - padInSec));
    const end = round(Math.max(start + minDurSec, Number(segment.words.at(-1).end) + padOutSec));
    return { ...segment, start, end };
  });
}
