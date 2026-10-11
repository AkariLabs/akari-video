import { subtractSilences } from "./unrecognized-spans.mjs";

export const LANGUAGE_GAP_MIN_SECONDS = 1.5;
export const LANGUAGE_GAP_MIN_VOICED_SECONDS = 1.0;
export const LANGUAGE_GAP_PADDING_SECONDS = 0.2;
export const LANGUAGE_GAP_MAX_RETRIES = 20;
// 声の無い区間の言語判定は 0.93 まで上がることがあり、本物の英語の区間は 0.97 以上だったため。
export const LANGUAGE_GAP_MIN_DETECT_PROBABILITY = 0.95;

const round = (value) => Math.round(value * 1000) / 1000;

export function detectLanguageGaps(segments, silences, range, {
  minSeconds = LANGUAGE_GAP_MIN_SECONDS,
  minVoicedSeconds = LANGUAGE_GAP_MIN_VOICED_SECONDS,
} = {}) {
  const start = Number(range?.in);
  const end = Number(range?.out);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const occupied = (Array.isArray(segments) ? segments : [])
    .map((segment) => ({ start: Math.max(start, Number(segment.start)), end: Math.min(end, Number(segment.end)) }))
    .filter((span) => Number.isFinite(span.start) && Number.isFinite(span.end) && span.end > span.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const gaps = [];
  let cursor = start;
  for (const span of occupied) {
    if (span.start - cursor >= minSeconds) gaps.push({ start: round(cursor), end: round(span.start) });
    cursor = Math.max(cursor, span.end);
  }
  if (end - cursor >= minSeconds) gaps.push({ start: round(cursor), end: round(end) });
  return gaps.filter((gap) => subtractSilences(gap, silences)
    .reduce((seconds, voiced) => seconds + voiced.end - voiced.start, 0) >= minVoicedSeconds);
}

export function insertRecoveredSegments(segments, recovered, gap, offset) {
  const additions = (Array.isArray(recovered) ? recovered : []).flatMap((segment) => {
    const { words: sourceWords, markers: sourceMarkers, ...rest } = segment;
    const originalStart = Number(segment.start) + offset;
    const originalEnd = Number(segment.end) + offset;
    if (!Number.isFinite(originalStart) || !Number.isFinite(originalEnd)
      || (originalStart + originalEnd) / 2 < gap.start || (originalStart + originalEnd) / 2 > gap.end) return [];
    const start = round(Math.max(gap.start, originalStart));
    const end = round(Math.min(gap.end, originalEnd));
    if (end <= start || !String(segment.text ?? "").trim()) return [];
    const words = (sourceWords ?? []).filter((word) => Number(word.end) + offset > gap.start
      && Number(word.start) + offset < gap.end).map((word) => ({
      ...word,
      start: round(Math.max(start, Number(word.start) + offset)),
      end: round(Math.min(end, Number(word.end) + offset)),
    })).filter((word) => word.end > word.start);
    if (words.length) words[0].text = words[0].text.trimStart();
    const text = words.length ? words.map((word) => word.text).join("") : segment.text;
    const markers = (sourceMarkers ?? []).map((marker) => ({
      start: round(Math.max(start, Number(marker.start) + offset)),
      end: round(Math.min(end, Number(marker.end) + offset)),
    })).filter((marker) => marker.end > marker.start);
    return [{ ...rest, start, end, text,
      ...(words.length ? { words } : {}),
      ...(markers.length ? { markers } : {}),
    }];
  });
  return [...segments, ...additions].sort((left, right) => left.start - right.start || left.end - right.end);
}
