import { existsSync } from "node:fs";
import path from "node:path";
import { readContentLanguage } from "../../../content-language/src/node.mjs";
import { normalizeLanguage } from "../../../content-language/src/index.mjs";
import { formatNumber, generatedAt, probeRaw, resolveTools } from "./common.mjs";
import { transcriptsDirForTarget } from "./record.mjs";
import { countFillerHits, fillerPackLanguage, findFillerSpans } from "./filler-lexicon.mjs";
import { toolsText } from '../i18n.mjs';
import { resolveWhisper, runSilenceDetect, transcribeMedia } from "./transcribe.mjs";
import { UNRECOGNIZED_DEFAULTS } from "./unrecognized-spans.mjs";
import {
  characterTiming, comparisonTarget, readEngineTranscripts, readJson, segmentCharacters, writeSidecar,
} from "./transcribe-diff.mjs";

const BASIS_PRIORITY = ["cloud-scribe", "whisper-cpp", "speech-analyzer", "cloud-groq"];
const overlap = (a, b) => a.start < b.end && a.end > b.start;
const ALIGNED_CORE = Symbol("aligned speech word interval");
const ENGLISH_RESTART = /\b(?:(?:okay|ok|sorry|wait|no)\b[\s,.;:—–-]*)?(?:let\s+me\s+(?:start\s+(?:over|again)|try\s+(?:that\s+)?again)|scratch\s+that|start\s+over)\b/giu;
const NUMBER_WORDS = Object.freeze({ "1st": "first", "2nd": "second", "3rd": "third", "10": "ten", mike: "mic" });

export function pickBasisByFillerHits(transcripts, language = "ja") {
  const priority = (backend) => {
    const index = BASIS_PRIORITY.indexOf(backend);
    return index < 0 ? BASIS_PRIORITY.length : index;
  };
  const ranked = transcripts.map((transcript, index) => ({
    transcript, index,
    // SA の words は 1 文字単位のため、トークン粒度の差を数えないよう本文を走査する。
    hits: transcript.segments.reduce((total, segment) => total + countFillerHits(segment.text, language), 0),
  })).sort((a, b) => b.hits - a.hits
    || priority(a.transcript.backend) - priority(b.transcript.backend) || a.index - b.index);
  return {
    basis: ranked[0]?.transcript,
    reason: `filler_hits=${ranked.map(({ transcript, hits }) => `${hits} (${transcript.backend})`).join(" > ")}`,
    hits: ranked[0]?.hits ?? 0,
  };
}

function numeric(value, fallback, label) {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved < 0) throw new Error(toolsText('tools.transcribeCuts.error.nonNegative', { label }));
  return resolved;
}

function textCandidates(segments, options) {
  const candidates = [];
  for (const segment of segments) {
    const chars = segmentCharacters(segment);
    const text = segment.text;
    const spans = findFillerSpans(text, options.language);
    const consecutive = (a, b) => a && b && a.filler === b.filler && /^[、,\s]*$/u.test(text.slice(a.to, b.from));
    // Leave every member of a repeated filler run to the redo extractor.
    const fillerRanges = spans.filter((span, index) => !consecutive(spans[index - 1], span) && !consecutive(span, spans[index + 1]));
    const fillers = [];
    const seen = new Set();
    const sliceChars = (from, to) => chars.slice(Array.from(text.slice(0, from)).length, Array.from(text.slice(0, to)).length);
    for (const { from, to, confidence } of fillerRanges) {
      const timing = characterTiming(sliceChars(from, to));
      const key = `${timing.start}:${timing.end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      fillers.push({ kind: "filler", ...timing, text: text.slice(from, to), default_on: options.filler === "on" && confidence !== "low", reason: from === 0 ? toolsText('tools.transcribeCuts.reason.openingFiller') : toolsText('tools.transcribeCuts.reason.filler'), ...(confidence ? { confidence } : {}) });
    }
    candidates.push(...fillers);
    // A punctuated one-character unit such as 「で、」 is itself two characters.
    const repeats = options.language === "en"
      ? /(?<![\p{L}\p{N}])([\p{L}]+(?:['’][\p{L}]+)?)(?:\s*[,，]\s*|\s+)\1(?![\p{L}\p{N}])/giu
      : /(?<![^、,。！？.!?\s])([^、,。！？.!?\s]{2,6}|[^、,。！？.!?\s][、,])(?:[、,]*\1)+[、,]*/gu;
    for (const match of text.matchAll(repeats)) {
      const unit = match[1];
      const last = options.language === "en" ? match[0].toLowerCase().lastIndexOf(unit.toLowerCase()) : match[0].lastIndexOf(unit);
      const timing = characterTiming(sliceChars(match.index, match.index + last));
      if (fillers.some((filler) => overlap(filler, timing))) continue;
      candidates.push({ kind: "redo", ...timing, text: match[0], default_on: options.redo === "on", reason: toolsText('tools.transcribeCuts.reason.redo') });
    }
    if (options.language === "en") {
      for (const match of text.matchAll(ENGLISH_RESTART)) {
        const before = text.slice(0, match.index);
        const sentenceEnd = [...before.matchAll(/[.!?](?=\s|$)/gu)].at(-1);
        let from = sentenceEnd ? sentenceEnd.index + 1 : 0;
        while (/\s/u.test(text[from] ?? "") && from < match.index) from += 1;
        let to = match.index + match[0].length;
        while (/[ \t]/u.test(text[to] ?? "")) to += 1;
        if (/[.,]/u.test(text[to] ?? "")) to += 1;
        const timing = characterTiming(sliceChars(from, to));
        candidates.push({ kind: "redo", ...timing, text: text.slice(from, to), default_on: options.redo === "on", reason: "Restart phrase" });
      }
    }
  }
  return candidates;
}

function timedWords(segments) {
  return segments.flatMap((segment) => segment.words ?? [])
    .filter((word) => Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

function comparableWord(text) {
  const word = String(text).toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  return NUMBER_WORDS[word] ?? word;
}

function alignEnglishWindow(basisWords, saWords) {
  const basis = basisWords.map((word) => comparableWord(word.text));
  const sa = saWords.map((word) => comparableWord(word.text));
  const rows = Array.from({ length: basis.length + 1 }, () => new Uint16Array(sa.length + 1));
  for (let i = basis.length - 1; i >= 0; i -= 1) for (let j = sa.length - 1; j >= 0; j -= 1) {
    rows[i][j] = basis[i] && basis[i] === sa[j] && Math.abs(basisWords[i].start - saWords[j].start) <= 10
      ? rows[i + 1][j + 1] + 1
      : Math.max(rows[i + 1][j], rows[i][j + 1]);
  }
  const matched = new Map();
  let i = 0, j = 0;
  while (i < basis.length && j < sa.length) {
    // If either occurrence can be skipped without reducing the match count, keep the later
    // basis occurrence. This leaves the first "I" in "I, I" available as the redo candidate.
    if (rows[i + 1][j] === rows[i][j]) i += 1;
    else if (rows[i][j + 1] === rows[i][j]) j += 1;
    else if (basis[i] && basis[i] === sa[j] && Math.abs(basisWords[i].start - saWords[j].start) <= 10) {
      matched.set(i, j); i += 1; j += 1;
    }
    else { i += 1; j += 1; }
  }
  return matched;
}

export function alignEnglishWords(basisWords, saWords) {
  const windowSeconds = 120;
  const haloSeconds = 10;
  const maxWordsPerWindow = 512;
  const lowerBound = (words, time) => {
    let low = 0, high = words.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (words[middle].start < time) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  const proposed = new Map();
  if (!basisWords.length || !saWords.length) return proposed;
  const firstWindow = Math.floor(basisWords[0].start / windowSeconds) * windowSeconds;
  const lastTime = basisWords.at(-1).start;
  for (let windowStart = firstWindow; windowStart <= lastTime; windowStart += windowSeconds) {
    const coreStart = lowerBound(basisWords, windowStart);
    const coreEnd = lowerBound(basisWords, windowStart + windowSeconds);
    if (coreStart === coreEnd) continue;
    const basisStart = lowerBound(basisWords, windowStart - haloSeconds);
    const basisEnd = lowerBound(basisWords, windowStart + windowSeconds + haloSeconds);
    const saStart = lowerBound(saWords, windowStart - haloSeconds);
    const saEnd = lowerBound(saWords, windowStart + windowSeconds + haloSeconds);
    // Dense or remote words remain unmatched; candidate review then favors retaining speech.
    if (basisEnd - basisStart > maxWordsPerWindow || saEnd - saStart > maxWordsPerWindow) continue;
    const local = alignEnglishWindow(basisWords.slice(basisStart, basisEnd), saWords.slice(saStart, saEnd));
    for (const [basisIndex, saIndex] of local) {
      const globalBasis = basisStart + basisIndex;
      if (globalBasis >= coreStart && globalBasis < coreEnd) proposed.set(globalBasis, saStart + saIndex);
    }
  }
  const matched = new Map();
  let previousBasis = -1, previousSa = -1;
  for (const [basisIndex, saIndex] of proposed) {
    if (saIndex > previousSa) { matched.set(basisIndex, saIndex); previousBasis = basisIndex; previousSa = saIndex; }
    else if (saIndex === previousSa) {
      matched.delete(previousBasis);
      matched.set(basisIndex, saIndex);
      previousBasis = basisIndex;
    }
  }
  return matched;
}

function closestSafeGap(saWords, from, to, start, end, duration) {
  const boundaries = [saWords[from]?.end ?? 0];
  for (let index = from + 1; index < to; index += 1) boundaries.push(saWords[index].start, saWords[index].end);
  boundaries.push(saWords[to]?.start ?? duration);
  const center = (start + end) / 2;
  const gaps = [];
  for (let index = 0; index + 1 < boundaries.length; index += 2) {
    const left = boundaries[index], right = boundaries[index + 1];
    if (right > left) gaps.push({ start: left, end: right,
      distance: center < left ? left - center : center > right ? center - right : 0 });
  }
  return gaps.sort((a, b) => a.distance - b.distance || b.end - b.start - (a.end - a.start))[0];
}

function expandEnglishSpeechCuts(candidates, segments, silences, duration, saSegments) {
  const words = timedWords(segments);
  if (!words.length) return;
  const saWords = saSegments?.length ? timedWords(saSegments) : [];
  const aligned = saWords.length ? alignEnglishWords(words, saWords) : null;
  const quiet = silences.filter((span) => Number.isFinite(span.start) && Number.isFinite(span.end) && span.end > span.start)
    .sort((a, b) => a.start - b.start);
  for (const candidate of candidates) {
    if (candidate.kind !== "filler" && candidate.kind !== "redo") continue;
    if (candidate.timing === "estimated") continue;
    // Keep the identifier tied to the recognized occurrence when its proposed cut grows.
    candidate.id = `${candidate.kind}-${(Math.round(candidate.start * 10) / 10).toFixed(1)}`;
    const first = words.findIndex((word) => overlap(word, candidate));
    const last = words.findLastIndex((word) => overlap(word, candidate));
    if (first < 0) {
      if (aligned) { candidate.default_on = false; candidate.alignment_review = true; }
      continue;
    }
    let coreStart = candidate.start, coreEnd = candidate.end;
    let left = words[first - 1]?.end ?? 0;
    let right = words[last + 1]?.start ?? duration;
    let adjacent = (words[first - 1] && coreStart - left <= 0.005)
      || (words[last + 1] && right - coreEnd <= 0.005);
    if (aligned) {
      const matched = Array.from({ length: last - first + 1 }, (_, index) => aligned.get(first + index));
      const complete = matched.every(Number.isInteger)
        && matched.every((position, index) => index === 0 || position === matched[index - 1] + 1);
      if (complete) {
        coreStart = saWords[matched[0]].start;
        coreEnd = saWords[matched.at(-1)].end;
        candidate[ALIGNED_CORE] = { start: coreStart, end: coreEnd };
        left = saWords[matched[0] - 1]?.end ?? 0;
        right = saWords[matched.at(-1) + 1]?.start ?? duration;
        adjacent = (matched[0] > 0 && coreStart - left <= 0.005)
          || (matched.at(-1) < saWords.length - 1 && right - coreEnd <= 0.005);
      } else {
        let before = first - 1, after = last + 1;
        while (before >= 0 && !aligned.has(before)) before -= 1;
        while (after < words.length && !aligned.has(after)) after += 1;
        const beforeSa = before < 0 ? -1 : aligned.get(before);
        const afterSa = after === words.length ? saWords.length : aligned.get(after);
        const safe = closestSafeGap(saWords, beforeSa, afterSa, candidate.start, candidate.end, duration);
        if (beforeSa < 0 || afterSa === saWords.length || afterSa - beforeSa > 1) {
          candidate.default_on = false;
          candidate.alignment_review = true;
        }
        if (!safe || safe.end - safe.start <= 0.005) {
          candidate.adjacent = true;
          candidate.default_on = false;
          candidate.alignment_review = true;
          continue;
        }
        coreStart = left = safe.start;
        coreEnd = right = safe.end;
        adjacent = false;
      }
    }
    if (left >= right || Math.max(left, coreStart) >= Math.min(right, coreEnd)) {
      candidate.adjacent = true;
      if (aligned) { candidate.default_on = false; candidate.alignment_review = true; }
      continue;
    }
    const before = [...quiet].reverse().find((span) => span.start >= left && span.end <= coreStart);
    const after = quiet.find((span) => span.start >= coreEnd && span.end <= right);
    const start = Math.max(left, before ? (before.start + before.end) / 2 : (aligned ? coreStart : left > 0 ? left : coreStart));
    const end = Math.min(right, after ? (after.start + after.end) / 2 : (aligned ? coreEnd : right < duration ? right : coreEnd));
    if (end > start) { candidate.start = formatNumber(start); candidate.end = formatNumber(end); }
    if (adjacent) candidate.adjacent = true;
  }
}

function tightenEnglishSpeechCuts(candidates, shortSilences) {
  if (!shortSilences) return;
  const quiet = shortSilences.filter((span) => Number.isFinite(span.start) && Number.isFinite(span.end) && span.end > span.start)
    .sort((a, b) => a.start - b.start);
  const isQuiet = (time) => quiet.some((span) => span.start + 0.005 <= time && time <= span.end - 0.005);
  const hasSpeech = (start, end) => {
    let cursor = start;
    for (const span of quiet) {
      if (span.end <= cursor || span.start >= end) continue;
      if (span.start > cursor + 0.005) return true;
      cursor = Math.max(cursor, span.end);
    }
    return cursor < end - 0.005;
  };
  for (const candidate of candidates) {
    if (candidate.kind !== "filler" && candidate.kind !== "redo") continue;
    const originalStart = candidate.start, originalEnd = candidate.end;
    const inside = quiet.filter((span) => span.end > originalStart && span.start < originalEnd);
    const leftQuiet = isQuiet(originalStart), rightQuiet = isQuiet(originalEnd);
    const left = leftQuiet ? originalStart : inside.length
      ? (Math.max(originalStart, inside[0].start) + Math.min(originalEnd, inside[0].end)) / 2 : null;
    const right = rightQuiet ? originalEnd : inside.length
      ? (Math.max(originalStart, inside.at(-1).start) + Math.min(originalEnd, inside.at(-1).end)) / 2 : null;
    const core = candidate[ALIGNED_CORE];
    const cutsEarlierSpeech = !rightQuiet && core && left < core.start - 0.005 && right < core.end - 0.005;
    if (left === null || right === null || right <= left || !hasSpeech(left, right) || cutsEarlierSpeech) {
      // A quiet-only interval is safer even when a prior human selection remains ON.
      const retreat = (cutsEarlierSpeech ? inside.at(-1) : inside[0]);
      if (retreat) {
        const retreatStart = Math.max(originalStart, retreat.start);
        const retreatEnd = Math.min(originalEnd, retreat.end);
        if (retreatEnd > retreatStart) {
          const width = retreatEnd - retreatStart;
          const isolatedValley = cutsEarlierSpeech && inside.length > 1;
          candidate.start = formatNumber(retreatStart + width * (isolatedValley ? 0.25 : 0.1));
          candidate.end = formatNumber(retreatStart + width * (isolatedValley ? 0.75 : 0.25));
        }
      }
      candidate.adjacent = true;
      candidate.default_on = false;
      candidate.boundary_review = true;
      continue;
    }
    candidate.start = formatNumber(left);
    candidate.end = formatNumber(right);
  }
}

export function unionUnrecognized(transcripts) {
  const spans = transcripts.flatMap((transcript) => transcript.segments.flatMap((segment) => segment.unrecognized ?? []))
    .map((span) => ({ ...span })).sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push(span);
  }
  return merged;
}

function applyHandEdited(candidates, captions, basis, target) {
  const handEdited = [];
  const characters = basis.segments.flatMap(segmentCharacters);
  for (let index = 0; index < captions.length; index += 1) {
    const caption = captions[index];
    if (caption.time_domain === "output") continue;
    if (caption.src && ![target.projectRelative, target.sourceId, target.inputPath].includes(caption.src)) continue;
    const original = characters.filter((char) => overlap(char, caption)).map((char) => char.char).join("");
    if (original === caption.text) continue;
    for (const candidate of candidates) {
      if (!overlap(candidate, caption)) continue;
      candidate.default_on = false;
      handEdited.push({ candidate: candidate.id, line: index + 1 });
    }
  }
  return handEdited;
}

export async function transcribeCutsMedia(argument, options = {}) {
  const filler = options.filler ?? "off";
  const redo = options.redo ?? "off";
  for (const [name, value] of Object.entries({ filler, redo })) {
    if (!["on", "off"].includes(value)) throw new Error(toolsText('tools.transcribeCuts.error.toggle', { name }));
  }
  const silenceMin = numeric(options.silenceMin, 0.45, "--silence-min");
  const silenceBreak = numeric(options.silenceBreak, 3, "--silence-break");
  const silenceKeep = numeric(options.silenceKeep, 0.15, "--silence-keep");
  const target = comparisonTarget(argument, options);
  const resolvedLanguage = await readContentLanguage(target.projectRoot);
  let transcripts = await readEngineTranscripts(target);
  const language = fillerPackLanguage(resolvedLanguage.source === "intake" ? resolvedLanguage.language
    : normalizeLanguage(transcripts[0]?.transcript_language) ?? "ja");
  if (language === "en" && filler === "on" && resolveWhisper({ ...options, lang: "en" })) {
    await transcribeMedia(argument, { ...options, backend: "whisper-cpp", lang: "en", whisperPrompt: true });
    transcripts = await readEngineTranscripts(target);
  }
  const requested = options.basis?.replace(/:/g, "-");
  const { basis, reason: basisReason } = requested
    ? { basis: transcripts.find((transcript) => transcript.backend === requested), reason: `explicit (--basis ${options.basis})` }
    : pickBasisByFillerHits(transcripts, language);
  if (!basis) throw new Error(toolsText('tools.transcribeCuts.error.basisMissing', { requested }));
  const { ffmpeg, ffprobe } = resolveTools(options);
  let detected;
  let duration;
  try {
    ({ duration } = probeRaw(target.inputPath, ffprobe, options));
    detected = await (options.silencesRunner ?? runSilenceDetect)({
      inputPath: target.inputPath, range: { in: 0, out: duration }, ffmpeg,
      silenceDb: UNRECOGNIZED_DEFAULTS.silenceDb, silenceMinSec: UNRECOGNIZED_DEFAULTS.silenceMinSec, options,
    });
  } catch (error) {
    throw Object.assign(new Error(toolsText('tools.transcribeCuts.error.sourceUnreadable', { message: error.message })), { exitCode: 2 });
  }
  const candidates = textCandidates(basis.segments, { filler, redo, language });
  const silences = Array.isArray(detected) ? detected : detected?.silences ?? [];
  if (language === "en") expandEnglishSpeechCuts(candidates, basis.segments, silences, duration,
    basis.backend === "speech-analyzer" ? null : transcripts.find((transcript) => transcript.backend === "speech-analyzer")?.segments);
  if (language === "en" && candidates.some((candidate) => candidate.kind === "filler" || candidate.kind === "redo")) {
    let shortSilences = null;
    try {
      const detectedShort = await (options.silencesRunner ?? runSilenceDetect)({
        inputPath: target.inputPath, range: { in: 0, out: duration }, ffmpeg,
        silenceDb: UNRECOGNIZED_DEFAULTS.silenceDb, silenceMinSec: 0.02, options,
      });
      shortSilences = Array.isArray(detectedShort) ? detectedShort : detectedShort?.silences ?? [];
    } catch { /* Keep the projected intervals if the boundary-only detector is unavailable. */ }
    tightenEnglishSpeechCuts(candidates, shortSilences);
  }
  for (const silence of silences) {
    const duration = formatNumber(silence.end - silence.start);
    if (!Number.isFinite(duration) || duration < silenceMin || duration <= silenceKeep) continue;
    const belowBreak = duration < silenceBreak;
    candidates.push({ kind: "silence", start: silence.start, end: formatNumber(silence.end - silenceKeep), text: null,
      default_on: false,
      reason: belowBreak ? toolsText('tools.transcribeCuts.reason.silenceKeep', { duration, keep: silenceKeep }) : toolsText('tools.transcribeCuts.reason.chapterBreak', { duration }) });
  }
  for (const span of unionUnrecognized(transcripts)) {
    candidates.push({ kind: "unrecognized", ...span, text: null, default_on: false, reason: toolsText('tools.transcribeCuts.reason.unrecognized') });
  }
  candidates.sort((a, b) => a.start - b.start || a.end - b.end || a.kind.localeCompare(b.kind, "en"));
  // A sub-tenth-second duplicate occupies the same stable id; retain its union.
  const byId = new Map();
  for (const candidate of candidates) {
    const id = candidate.id ?? `${candidate.kind}-${(Math.round(candidate.start * 10) / 10).toFixed(1)}`;
    const previous = byId.get(id);
    if (previous) {
      previous.end = Math.max(previous.end, candidate.end);
      previous.default_on &&= candidate.default_on;
      if (candidate.alignment_review) previous.alignment_review = true;
      if (candidate.boundary_review) previous.boundary_review = true;
      if (candidate.timing) previous.timing = candidate.timing;
    } else byId.set(id, { id, ...candidate });
  }
  const unique = [...byId.values()];
  const directory = path.dirname(transcriptsDirForTarget(target));
  const cutsPath = path.join(directory, "cuts.json");
  const previous = existsSync(cutsPath) ? await readJson(cutsPath) : { candidates: [] };
  if (!Array.isArray(previous?.candidates)) throw new Error(toolsText('tools.transcribeCuts.error.candidatesInvalid'));
  const previousOn = new Map(previous.candidates.map((candidate) => [candidate.id, candidate.on]));
  const captionsPath = path.join(target.projectRoot, "captions.json");
  const captionRoot = existsSync(captionsPath) ? await readJson(captionsPath) : [];
  const captions = Array.isArray(captionRoot) ? captionRoot : captionRoot?.captions;
  if (!Array.isArray(captions)) throw new Error(toolsText('tools.transcribeCuts.error.captionsInvalid'));
  const handEdited = applyHandEdited(unique, captions, basis, target);
  for (const candidate of unique) {
    const on = previousOn.get(candidate.id);
    candidate.on = typeof on === "boolean" ? on : candidate.default_on;
  }
  const result = { version: 1, generated_at: generatedAt(options), basis: basis.backend, basis_reason: basisReason,
    rules: { filler, redo, silence_min_sec: silenceMin, silence_keep_sec: silenceKeep, silence_break_sec: silenceBreak, unrecognized: "off" },
    candidates: unique, hand_edited: handEdited };
  await writeSidecar(target, "cuts.json", result);
  const by_kind = { filler: 0, redo: 0, silence: 0, unrecognized: 0 };
  unique.forEach((candidate) => { by_kind[candidate.kind] += 1; });
  const enabled = unique.filter((candidate) => candidate.on);
  return { basis: basis.backend, basis_reason: basisReason, candidates: unique.length, by_kind, on: enabled.length,
    seconds: formatNumber(enabled.reduce((sum, candidate) => sum + candidate.end - candidate.start, 0)) };
}
