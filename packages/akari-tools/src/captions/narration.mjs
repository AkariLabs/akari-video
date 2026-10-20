import { buildCaptionsFromTranscript } from "./build.mjs";

const roundTime = (value) => Math.round(value * 1000) / 1000;
const ZERO_SPAN_CHAR_SECONDS = 0.02;

export class NarrationAlignmentError extends Error {
  constructor(code) {
    super(code);
    this.name = "NarrationAlignmentError";
    this.code = code;
  }
}

function foldKana(char) {
  const code = char.codePointAt(0);
  return code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : char;
}

// Comparison-only normalization: full-width forms, case, katakana/hiragana,
// punctuation, symbols and whitespace are folded away so a script and the
// transcribed readings can be aligned character by character.
export function normalizeAlignmentText(text) {
  return [...String(text ?? "")]
    .map((char) => foldKana(char.normalize("NFKC").toLowerCase()))
    .filter((char) => char && !/[\p{P}\p{S}\s]/u.test(char))
    .join("");
}

function normalizedCharEntries(text) {
  const entries = [];
  [...String(text ?? "")].forEach((original, index) => {
    for (const char of normalizeAlignmentText(original)) entries.push({ char, index, original });
  });
  return entries;
}

function distributeWord(text, start, end, output) {
  const entries = normalizedCharEntries(text);
  if (!entries.length) return;
  const span = end - start;
  if (span > 0) {
    for (let index = 0; index < entries.length; index += 1) {
      output.push({
        char: entries[index].char,
        start: start + (span * index) / entries.length,
        end: start + (span * (index + 1)) / entries.length,
      });
    }
    return;
  }
  for (let index = 0; index < entries.length; index += 1) {
    output.push({
      char: entries[index].char,
      start: start + index * ZERO_SPAN_CHAR_SECONDS,
      end: start + (index + 1) * ZERO_SPAN_CHAR_SECONDS,
    });
  }
}

// Flattens transcript words into timed characters. Words are the preferred
// source because whisper/SpeechAnalyzer emit word-level timings; segments
// without words fall back to an even distribution across the segment.
export function timedCharacters(segments) {
  const characters = [];
  for (const segment of Array.isArray(segments) ? segments : []) {
    const words = Array.isArray(segment?.words) ? segment.words : [];
    const usable = words.filter((word) => typeof word?.text === "string" && word.text.trim()
      && Number.isFinite(word.start) && Number.isFinite(word.end) && word.end >= word.start);
    if (usable.length) {
      for (const word of usable) distributeWord(word.text, word.start, word.end, characters);
    } else if (typeof segment?.text === "string" && Number.isFinite(segment.start)
      && Number.isFinite(segment.end) && segment.end >= segment.start) {
      distributeWord(segment.text, segment.start, segment.end, characters);
    }
  }
  return characters.sort((a, b) => a.start - b.start || a.end - b.end);
}

// Monotonic character alignment (substitution cost 1). The returned array has
// one entry per source character: the matched heard-character index or null.
// A tiny position prior only breaks ties in the primary edit distance, so an
// insertion is pushed toward the point where both texts are proportionally
// aligned instead of silently shifting the whole mapping by one character.
export function alignCharacters(sourceCharacters, heardCharacters) {
  const n = sourceCharacters.length;
  const m = heardCharacters.length;
  const epsilon = 1e-6;
  const position = (i, j) => (n && m ? Math.abs(i / n - j / m) : 0);
  const dp = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  for (let i = 0; i <= n; i += 1) dp[i][0] = i + epsilon * position(i, 0);
  for (let j = 0; j <= m; j += 1) dp[0][j] = j + epsilon * position(0, j);
  for (let i = 1; i <= n; i += 1) {
    const row = dp[i];
    const previous = dp[i - 1];
    const source = sourceCharacters[i - 1].char;
    for (let j = 1; j <= m; j += 1) {
      const substitution = previous[j - 1] + (source === heardCharacters[j - 1].char ? 0 : 1)
        + epsilon * position(i - 1, j - 1);
      const deletion = previous[j] + 1 + epsilon * position(i - 1, j);
      const insertion = row[j - 1] + 1 + epsilon * position(i, j - 1);
      row[j] = Math.min(substitution, deletion, insertion);
    }
  }
  const matched = new Array(n).fill(null);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const same = sourceCharacters[i - 1].char === heardCharacters[j - 1].char;
    const substitution = dp[i - 1][j - 1] + (same ? 0 : 1) + epsilon * position(i - 1, j - 1);
    if (Math.abs(dp[i][j] - substitution) < 1e-9) {
      matched[i - 1] = j - 1;
      i -= 1;
      j -= 1;
      continue;
    }
    const deletion = dp[i - 1][j] + 1 + epsilon * position(i - 1, j);
    if (Math.abs(dp[i][j] - deletion) < 1e-9) {
      i -= 1;
      continue;
    }
    j -= 1;
  }
  return matched;
}

function averageDuration(times) {
  const durations = times.filter(Boolean).map((time) => time.end - time.start).filter((value) => value > 0);
  if (!durations.length) return 0;
  return durations.reduce((sum, value) => sum + value, 0) / durations.length;
}

// Characters without a counterpart (deleted from the reading) borrow time from
// the surrounding matched characters. The count is reported so callers can tell
// how much of the timing was inferred rather than heard.
function fillMissingTimes(times) {
  const count = times.length;
  if (!times.some(Boolean)) return { times: null, interpolated: count };
  const typical = averageDuration(times) || ZERO_SPAN_CHAR_SECONDS;
  let interpolated = 0;
  let first = times.findIndex(Boolean);
  for (let index = 0; index < first; index += 1) {
    const anchor = times[first].start;
    const start = Math.max(0, anchor - (first - index) * typical);
    const end = Math.max(start, Math.min(anchor, start + typical));
    times[index] = { start, end };
    interpolated += 1;
  }
  for (let index = first + 1; index < count; index += 1) {
    if (times[index]) continue;
    let next = index;
    while (next < count && !times[next]) next += 1;
    if (next < count) {
      const previous = index - 1;
      const from = times[previous].end;
      const to = times[next].start;
      const gap = to - from;
      const missing = next - previous;
      for (let step = 1; step < missing; step += 1) {
        const start = gap > 0 ? from + (gap * (step - 1)) / (missing - 1) : from;
        const end = gap > 0 ? from + (gap * step) / (missing - 1) : from;
        times[previous + step] = { start, end };
        interpolated += 1;
      }
      index = next - 1;
    } else {
      let cursor = times[index - 1].end;
      for (let tail = index; tail < count; tail += 1) {
        times[tail] = { start: cursor, end: cursor + typical };
        cursor += typical;
        interpolated += 1;
      }
      break;
    }
  }
  return { times, interpolated };
}

function scriptWords(script, entries, times, { spaced = false } = {}) {
  const characters = [...script];
  const indexes = [...new Set(entries.map((entry) => entry.index))].sort((a, b) => a - b);
  // Spaced languages keep whole words as tokens; Japanese/Chinese use one
  // token per character so punctuation stays attached to its character.
  const starts = spaced
    ? indexes.filter((index, position) => position === 0 || /\s/u.test(characters[index - 1] ?? ""))
    : indexes;
  const words = [];
  for (let position = 0; position < starts.length; position += 1) {
    const from = position === 0 ? 0 : starts[position];
    const to = position + 1 < starts.length ? starts[position + 1] : characters.length;
    const text = characters.slice(from, to).join("");
    if (!text.trim()) continue;
    const matched = [];
    for (let index = 0; index < entries.length; index += 1) {
      if (entries[index].index >= from && entries[index].index < to) matched.push(times[index]);
    }
    if (!matched.length) continue;
    const start = Math.min(...matched.map((time) => time.start));
    const end = Math.max(...matched.map((time) => time.end));
    words.push({ text, start: roundTime(start), end: roundTime(Math.max(start, end)) });
  }
  return words;
}

export function buildNarrationWords(script, segments, { spaced = false } = {}) {
  if (!String(script ?? "").trim()) throw new NarrationAlignmentError("script-empty");
  const entries = normalizedCharEntries(script);
  if (!entries.length) throw new NarrationAlignmentError("script-empty");
  const heard = timedCharacters(segments);
  if (!heard.length) throw new NarrationAlignmentError("timing-missing");
  const matched = alignCharacters(entries, heard);
  const times = entries.map((entry, index) => matched[index] === null ? null : {
    start: heard[matched[index]].start,
    end: heard[matched[index]].end,
  });
  const filled = fillMissingTimes(times);
  if (!filled.times) throw new NarrationAlignmentError("timing-missing");
  return {
    words: scriptWords(script, entries, filled.times, { spaced }),
    interpolated: filled.interpolated,
  };
}

function offsetCaption(caption, offsetSeconds, src, segmentOffset) {
  const shift = (value) => roundTime(value + offsetSeconds);
  const result = {
    ...caption,
    start: shift(caption.start),
    end: shift(caption.end),
    time_domain: "output",
  };
  if (src !== undefined) result.src = src;
  if (segmentOffset) {
    result.sourceRef = {
      ...caption.sourceRef,
      segment: (caption.sourceRef?.segment ?? 0) + segmentOffset,
    };
  }
  if (Array.isArray(caption.words)) {
    result.words = caption.words.map((word) => ({
      ...word,
      start: shift(word.start),
      end: shift(word.end),
    }));
  }
  return result;
}

export function buildCaptionsFromNarration(script, segments, options = {}) {
  const { t = 0, src, idStart = 1, segmentOffset = 0, ...buildOptions } = options;
  if (!Number.isFinite(t) || t < 0) throw new NarrationAlignmentError("invalid-offset");
  const spaced = /\s/u.test(String(script ?? "").trim()) || /[A-Za-z\u00C0-\u024F]/u.test(String(script ?? ""));
  const { words, interpolated } = buildNarrationWords(script, segments, { spaced });
  const result = buildCaptionsFromTranscript([{
    start: words[0].start,
    end: words.at(-1).end,
    text: script,
    words,
  }], { ...buildOptions, src, idStart });
  return {
    captions: result.captions.map((caption) => offsetCaption(caption, t, src, segmentOffset)),
    warnings: result.warnings,
    interpolated,
  };
}
