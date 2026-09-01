export const UNRECOGNIZED_DEFAULTS = Object.freeze({
  minGapSec: 0.45,
  minVoicedSec: 0.3,
  silenceDb: -35,
  silenceMinSec: 0.2,
});

export function classifyWhisperMarker(text) {
  const value = String(text ?? "").trim();
  if (/^\[BLANK_AUDIO\]$/iu.test(value)
    || /^\[_TT_\d+\]$/u.test(value)
    || /^\[_.*_\]$/u.test(value)) return "control";
  if (/^\[[\s\S]*\]$/u.test(value)
    || /^\([\s\S]*\)$/u.test(value)
    || /^（[\s\S]*）$/u.test(value)) return "non-speech";
  return null;
}

export function subtractSilences(interval, silences) {
  const start = roundMs(Number(interval?.start));
  const end = roundMs(Number(interval?.end));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];

  const clippedSilences = mergeSpans((Array.isArray(silences) ? silences : []).flatMap((silence) => {
    const silenceStart = roundMs(Math.max(start, Number(silence?.start)));
    const silenceEnd = roundMs(Math.min(end, Number(silence?.end)));
    return Number.isFinite(silenceStart) && Number.isFinite(silenceEnd) && silenceEnd > silenceStart
      ? [{ start: silenceStart, end: silenceEnd }]
      : [];
  }));

  const remaining = [];
  let cursor = start;
  for (const silence of clippedSilences) {
    if (silence.start > cursor) remaining.push({ start: cursor, end: silence.start });
    cursor = Math.max(cursor, silence.end);
  }
  if (cursor < end) remaining.push({ start: cursor, end });
  return remaining.map(roundSpan).filter((span) => span.end > span.start);
}

export function detectUnrecognizedSpans(segment, silences, options = {}) {
  const segmentStart = roundMs(Number(segment?.start));
  const segmentEnd = roundMs(Number(segment?.end));
  if (!Number.isFinite(segmentStart) || !Number.isFinite(segmentEnd) || segmentEnd <= segmentStart) return [];
  const minGapSec = finiteNonNegative(options.minGapSec, UNRECOGNIZED_DEFAULTS.minGapSec);
  const minVoicedSec = finiteNonNegative(options.minVoicedSec, UNRECOGNIZED_DEFAULTS.minVoicedSec);

  const words = mergeSpans((Array.isArray(segment?.words) ? segment.words : []).flatMap((word) => {
    const start = roundMs(Math.max(segmentStart, Number(word?.start)));
    const end = roundMs(Math.min(segmentEnd, Number(word?.end)));
    return Number.isFinite(start) && Number.isFinite(end) && end > start ? [{ start, end }] : [];
  }));
  const gaps = complementSpans({ start: segmentStart, end: segmentEnd }, words);

  const voicedGaps = gaps.flatMap((gap) => {
    if (duration(gap) < minGapSec) return [];
    return subtractSilences(gap, silences).filter((span) => duration(span) >= minVoicedSec);
  });

  const markerSpans = (Array.isArray(segment?.markers) ? segment.markers : []).flatMap((marker) => {
    const markerStart = roundMs(Math.max(segmentStart, Number(marker?.start)));
    const markerEnd = roundMs(Math.min(segmentEnd, Number(marker?.end)));
    if (!Number.isFinite(markerStart) || !Number.isFinite(markerEnd) || markerEnd <= markerStart) return [];
    return gaps.flatMap((gap) => {
      const start = roundMs(Math.max(gap.start, markerStart));
      const end = roundMs(Math.min(gap.end, markerEnd));
      return end > start ? [{ start, end }] : [];
    });
  });

  return mergeSpans([...voicedGaps, ...markerSpans]).map(roundSpan);
}

export function clipSpansToRange(spans, start, end) {
  const rangeStart = roundMs(Number(start));
  const rangeEnd = roundMs(Number(end));
  if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd) || rangeEnd <= rangeStart) return [];
  return mergeSpans((Array.isArray(spans) ? spans : []).flatMap((span) => {
    const clippedStart = roundMs(Math.max(rangeStart, Number(span?.start)));
    const clippedEnd = roundMs(Math.min(rangeEnd, Number(span?.end)));
    return Number.isFinite(clippedStart) && Number.isFinite(clippedEnd) && clippedEnd > clippedStart
      ? [{ start: clippedStart, end: clippedEnd }]
      : [];
  }));
}

function complementSpans(interval, occupied) {
  const gaps = [];
  let cursor = interval.start;
  for (const span of occupied) {
    if (span.start > cursor) gaps.push({ start: cursor, end: span.start });
    cursor = Math.max(cursor, span.end);
  }
  if (cursor < interval.end) gaps.push({ start: cursor, end: interval.end });
  return gaps;
}

function mergeSpans(spans) {
  const sorted = spans
    .map(roundSpan)
    .filter((span) => Number.isFinite(span.start) && Number.isFinite(span.end) && span.end > span.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const merged = [];
  for (const span of sorted) {
    const previous = merged.at(-1);
    if (previous && span.start <= previous.end) {
      previous.end = roundMs(Math.max(previous.end, span.end));
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

function roundSpan(span) {
  return { start: roundMs(Number(span?.start)), end: roundMs(Number(span?.end)) };
}

function duration(span) {
  return roundMs(span.end - span.start);
}

function finiteNonNegative(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function roundMs(value) {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : value;
}
