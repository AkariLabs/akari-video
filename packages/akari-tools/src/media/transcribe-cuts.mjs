import { existsSync } from "node:fs";
import path from "node:path";
import { formatNumber, generatedAt, probeRaw, resolveTools } from "./common.mjs";
import { transcriptsDirForTarget } from "./record.mjs";
import { countFillerHits, findFillerSpans } from "./filler-lexicon.mjs";
import { runSilenceDetect } from "./transcribe.mjs";
import { UNRECOGNIZED_DEFAULTS } from "./unrecognized-spans.mjs";
import {
  characterTiming, comparisonTarget, readEngineTranscripts, readJson, segmentCharacters, writeSidecar,
} from "./transcribe-diff.mjs";

const BASIS_PRIORITY = ["cloud-scribe", "whisper-cpp", "speech-analyzer", "cloud-groq"];
const overlap = (a, b) => a.start < b.end && a.end > b.start;

export function pickBasisByFillerHits(transcripts) {
  const priority = (backend) => {
    const index = BASIS_PRIORITY.indexOf(backend);
    return index < 0 ? BASIS_PRIORITY.length : index;
  };
  const ranked = transcripts.map((transcript, index) => ({
    transcript, index,
    // SA の words は 1 文字単位のため、トークン粒度の差を数えないよう本文を走査する。
    hits: transcript.segments.reduce((total, segment) => total + countFillerHits(segment.text), 0),
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
  if (!Number.isFinite(resolved) || resolved < 0) throw new Error(`${label} は 0 以上の数値で指定してください`);
  return resolved;
}

function textCandidates(segments, options) {
  const candidates = [];
  for (const segment of segments) {
    const chars = segmentCharacters(segment);
    const text = segment.text;
    const spans = findFillerSpans(text);
    const consecutive = (a, b) => a && b && a.filler === b.filler && /^[、,\s]*$/u.test(text.slice(a.to, b.from));
    // Leave every member of a repeated filler run to the redo extractor.
    const fillerRanges = spans.filter((span, index) => !consecutive(spans[index - 1], span) && !consecutive(span, spans[index + 1]));
    const fillers = [];
    const seen = new Set();
    const sliceChars = (from, to) => chars.slice(Array.from(text.slice(0, from)).length, Array.from(text.slice(0, to)).length);
    for (const { from, to } of fillerRanges) {
      const timing = characterTiming(sliceChars(from, to));
      const key = `${timing.start}:${timing.end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      fillers.push({ kind: "filler", ...timing, text: text.slice(from, to), default_on: options.filler === "on", reason: from === 0 ? "冒頭のフィラー" : "フィラー" });
    }
    candidates.push(...fillers);
    // A punctuated one-character unit such as 「で、」 is itself two characters.
    const repeats = /(?<![^、,。！？.!?\s])([^、,。！？.!?\s]{2,6}|[^、,。！？.!?\s][、,])(?:[、,]*\1)+[、,]*/gu;
    for (const match of text.matchAll(repeats)) {
      const unit = match[1];
      const last = match[0].lastIndexOf(unit);
      const timing = characterTiming(sliceChars(match.index, match.index + last));
      if (fillers.some((filler) => overlap(filler, timing))) continue;
      candidates.push({ kind: "redo", ...timing, text: match[0], default_on: options.redo === "on", reason: "言い直し。最後の 1 回を残す" });
    }
  }
  return candidates;
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
    if (!["on", "off"].includes(value)) throw new Error(`--${name} は on / off で指定してください`);
  }
  const silenceMin = numeric(options.silenceMin, 1.5, "--silence-min");
  const silenceBreak = numeric(options.silenceBreak, 3, "--silence-break");
  const silenceKeep = numeric(options.silenceKeep, 0.5, "--silence-keep");
  const target = comparisonTarget(argument, options);
  const transcripts = await readEngineTranscripts(target);
  const requested = options.basis?.replace(/:/g, "-");
  const { basis, reason: basisReason } = requested
    ? { basis: transcripts.find((transcript) => transcript.backend === requested), reason: `explicit (--basis ${options.basis})` }
    : pickBasisByFillerHits(transcripts);
  if (!basis) throw new Error(`根拠エンジンの文字起こしがありません: ${requested}`);
  const { ffmpeg, ffprobe } = resolveTools(options);
  let detected;
  try {
    const { duration } = probeRaw(target.inputPath, ffprobe, options);
    detected = await (options.silencesRunner ?? runSilenceDetect)({
      inputPath: target.inputPath, range: { in: 0, out: duration }, ffmpeg,
      silenceDb: UNRECOGNIZED_DEFAULTS.silenceDb, silenceMinSec: UNRECOGNIZED_DEFAULTS.silenceMinSec, options,
    });
  } catch (error) {
    throw Object.assign(new Error(`素材を読めません: ${error.message}`), { exitCode: 2 });
  }
  const candidates = textCandidates(basis.segments, { filler, redo });
  for (const silence of Array.isArray(detected) ? detected : detected?.silences ?? []) {
    const duration = formatNumber(silence.end - silence.start);
    if (!Number.isFinite(duration) || duration < silenceMin || duration <= silenceKeep) continue;
    const belowBreak = duration < silenceBreak;
    candidates.push({ kind: "silence", start: silence.start, end: formatNumber(silence.end - silenceKeep), text: null,
      default_on: false,
      reason: belowBreak ? `無音 ${duration} 秒 → ${silenceKeep} 秒残す` : `無音 ${duration} 秒。章の切れ目とみなす` });
  }
  for (const span of unionUnrecognized(transcripts)) {
    candidates.push({ kind: "unrecognized", ...span, text: null, default_on: false, reason: "未認識。決まるまで切らない" });
  }
  candidates.sort((a, b) => a.start - b.start || a.end - b.end || a.kind.localeCompare(b.kind, "en"));
  // A sub-tenth-second duplicate occupies the same stable id; retain its union.
  const byId = new Map();
  for (const candidate of candidates) {
    const id = `${candidate.kind}-${(Math.round(candidate.start * 10) / 10).toFixed(1)}`;
    const previous = byId.get(id);
    if (previous) {
      previous.end = Math.max(previous.end, candidate.end);
      previous.default_on &&= candidate.default_on;
      if (candidate.timing) previous.timing = candidate.timing;
    } else byId.set(id, { id, ...candidate });
  }
  const unique = [...byId.values()];
  const directory = path.dirname(transcriptsDirForTarget(target));
  const cutsPath = path.join(directory, "cuts.json");
  const previous = existsSync(cutsPath) ? await readJson(cutsPath) : { candidates: [] };
  if (!Array.isArray(previous?.candidates)) throw new Error("既存 cuts.json の candidates が不正です");
  const previousOn = new Map(previous.candidates.map((candidate) => [candidate.id, candidate.on]));
  const captionsPath = path.join(target.projectRoot, "captions.json");
  const captionRoot = existsSync(captionsPath) ? await readJson(captionsPath) : [];
  const captions = Array.isArray(captionRoot) ? captionRoot : captionRoot?.captions;
  if (!Array.isArray(captions)) throw new Error("captions.json の形式が不正です");
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
