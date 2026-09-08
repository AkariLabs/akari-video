import { accessSync, constants } from "node:fs";
import { readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { formatNumber, generatedAt, resolveTarget } from "./common.mjs";
import { transcriptsDirForTarget } from "./record.mjs";
import { comparisonText, isFiller } from "./filler-lexicon.mjs";

export function comparisonTarget(argument, options) {
  let target;
  try {
    target = resolveTarget(argument, options);
    accessSync(target.inputPath, constants.R_OK);
  } catch (error) {
    throw Object.assign(new Error(`素材を読めません: ${error.message}`), { exitCode: 2 });
  }
  if (!transcriptsDirForTarget(target)) throw new Error("プロジェクト内の素材を指定してください");
  return target;
}

export async function readJson(file) {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { throw new Error(`JSON を読めません: ${file}（${error.code ?? "形式不正"}）`); }
}

export async function readEngineTranscripts(target, engines) {
  const directory = transcriptsDirForTarget(target);
  let files;
  try { files = await readdir(directory); }
  catch { throw new Error("transcripts が見つかりません。先に文字起こしを実行してください"); }
  const available = files.filter((file) => /^[A-Za-z0-9_-]+\.json$/.test(file)).sort();
  const names = engines === undefined ? available.map((file) => file.slice(0, -5))
    : (Array.isArray(engines) ? engines : String(engines).split(",")).map((name) => name.trim().replace(/:/g, "-"));
  if (!names.length || names.some((name) => !/^[A-Za-z0-9_-]+$/.test(name)) || new Set(names).size !== names.length) {
    throw new Error("比較するエンジンを重複なく指定してください");
  }
  const transcripts = [];
  for (const name of names) {
    if (!available.includes(`${name}.json`)) throw new Error(`エンジンの文字起こしがありません: ${name}`);
    const transcript = await readJson(path.join(directory, `${name}.json`));
    if (transcript?.version !== 1 || transcript.backend?.replace(/:/g, "-") !== name
      || !Array.isArray(transcript.segments) || transcript.segments.some((segment) => !validSegment(segment))) {
      throw new Error(`文字起こしの形式が不正です: ${name}`);
    }
    transcripts.push({ ...transcript, backend: name, segments: [...transcript.segments].sort((a, b) => a.start - b.start || a.end - b.end) });
  }
  return transcripts;
}

function validSpan(span) {
  return Number.isFinite(span?.start) && Number.isFinite(span?.end) && span.start >= 0 && span.end > span.start;
}

function validSegment(segment) {
  return validSpan(segment) && typeof segment.text === "string"
    && (segment.words === undefined || (Array.isArray(segment.words) && segment.words.every((word) => validSpan(word) && typeof word.text === "string")))
    && (segment.unrecognized === undefined || (Array.isArray(segment.unrecognized) && segment.unrecognized.every(validSpan)));
}

export async function writeSidecar(target, name, value) {
  const output = path.join(path.dirname(transcriptsDirForTarget(target)), name);
  const temporary = `${output}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporary, output);
  } finally { await unlink(temporary).catch(() => {}); }
}

// Keep original characters for display, and attach word times where the text maps.
// Unmapped characters use proportional source times, never invented word boundaries.
export function segmentCharacters(segment) {
  const chars = Array.from(segment.text);
  const mapped = chars.map((char, index) => ({ char,
    start: segment.start + (segment.end - segment.start) * index / chars.length,
    end: segment.start + (segment.end - segment.start) * (index + 1) / chars.length,
    estimated: true,
  }));
  const meaningful = chars.flatMap((char, index) => comparisonText(char) ? [{ char, index }] : []);
  let cursor = 0;
  for (const word of segment.words ?? []) {
    const text = Array.from(comparisonText(word.text));
    if (!text.length) continue;
    let found = -1;
    for (let at = cursor; at <= meaningful.length - text.length; at += 1) {
      if (text.every((char, i) => char === meaningful[at + i].char)) { found = at; break; }
    }
    if (found < 0) continue;
    for (let i = 0; i < text.length; i += 1) {
      Object.assign(mapped[meaningful[found + i].index], { start: word.start, end: word.end, estimated: false });
    }
    cursor = found + text.length;
  }
  return mapped;
}

export function characterTiming(chars) {
  const timed = chars.filter((char) => comparisonText(char.char));
  const relevant = timed.length ? timed : chars;
  return {
    start: formatNumber(Math.min(...relevant.map((char) => char.start))),
    end: formatNumber(Math.max(...relevant.map((char) => char.end))),
    ...(relevant.some((char) => char.estimated) ? { timing: "estimated" } : {}),
  };
}

function sequence(segments) {
  const chars = segments.flatMap(segmentCharacters);
  const tokens = chars.flatMap((char, index) => comparisonText(char.char) ? [{ ...char, index }] : []);
  return { chars, tokens };
}

function sliceSequence(seq, start, end) {
  if (start === end) return [];
  let from = seq.tokens[start].index;
  let to = seq.tokens[end - 1].index + 1;
  while (from > 0 && /[、,]/u.test(seq.chars[from - 1].char)) from -= 1;
  while (to < seq.chars.length && /[、,]/u.test(seq.chars[to].char)) to += 1;
  return seq.chars.slice(from, to);
}

// Pairwise character LCS; ties consume the reference character first.
function align(base, other) {
  const n = base.length, m = other.length;
  const rows = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      rows[i][j] = base[i].char === other[j].char ? rows[i + 1][j + 1] + 1 : Math.max(rows[i + 1][j], rows[i][j + 1]);
    }
  }
  const matches = new Map(), hunks = [];
  let i = 0, j = 0, pending;
  const flush = () => { if (pending) hunks.push({ ...pending, end: i, otherEnd: j }); pending = undefined; };
  while (i < n || j < m) {
    if (i < n && j < m && base[i].char === other[j].char) {
      flush(); matches.set(i, j); i += 1; j += 1;
    } else {
      pending ??= { start: i, otherStart: j };
      if (i < n && (j === m || rows[i + 1][j] >= rows[i][j + 1])) i += 1;
      else j += 1;
    }
  }
  flush();
  return { matches, hunks };
}

function windows(transcripts) {
  const segments = transcripts.flatMap((transcript, engine) => transcript.segments.map((segment) => ({ ...segment, engine })))
    .sort((a, b) => a.start - b.start || a.end - b.end || a.engine - b.engine);
  const result = [];
  for (const segment of segments) {
    const previous = result.at(-1);
    if (previous && segment.start < previous.end) {
      previous.end = Math.max(previous.end, segment.end); previous.segments.push(segment);
    } else result.push({ start: segment.start, end: segment.end, segments: [segment] });
  }
  return result;
}

export function compareTranscripts(transcripts, options = {}) {
  const engines = transcripts.map((transcript) => transcript.backend);
  const items = [];
  const unrecognized = transcripts.flatMap((transcript) => transcript.segments.flatMap((segment) => segment.unrecognized ?? []));
  let total = 0, agreed = 0;
  for (const window of windows(transcripts)) {
    const sequences = engines.map((_, engine) => sequence(window.segments.filter((segment) => segment.engine === engine)));
    const base = sequences[0].tokens;
    const alignments = sequences.map((seq, engine) => engine === 0 ? null : align(base, seq.tokens));
    total += base.length;
    agreed += base.filter((_, index) => alignments.slice(1).every((alignment) => alignment.matches.has(index))).length;
    const changes = alignments.slice(1).flatMap((alignment) => alignment.hunks).sort((a, b) => a.start - b.start || a.end - b.end);
    const groups = [];
    for (const change of changes) {
      const last = groups.at(-1);
      if (last && change.start <= last.end) last.end = Math.max(last.end, change.end);
      else groups.push({ start: change.start, end: change.end });
    }
    for (const group of groups) {
      const selections = sequences.map((seq, engine) => {
        if (engine === 0) return sliceSequence(seq, group.start, group.end);
        const alignment = alignments[engine];
        const indices = [];
        for (let i = group.start; i < group.end; i += 1) {
          if (alignment.matches.has(i)) indices.push(alignment.matches.get(i));
        }
        for (const hunk of alignment.hunks) {
          if (hunk.start <= group.end && hunk.end >= group.start) {
            for (let i = hunk.otherStart; i < hunk.otherEnd; i += 1) indices.push(i);
          }
        }
        return indices.length ? sliceSequence(seq, Math.min(...indices), Math.max(...indices) + 1) : [];
      });
      const texts = Object.fromEntries(engines.map((engine, i) => [engine, selections[i].map((char) => char.char).join("")]));
      const timing = characterTiming(selections.flat());
      const overlaps = unrecognized.some((span) => span.start < timing.end && span.end > timing.start);
      const values = Object.values(texts).map(comparisonText);
      const filler = values.includes("") && values.filter(Boolean).every(isFiller) && new Set(values.filter(Boolean)).size === 1;
      const item = { ...timing, kind: overlaps ? "unrecognized" : filler ? "filler" : "word", texts };
      if (overlaps) item.overlaps_unrecognized = true;
      else if (!filler) {
        // Punctuation/spacing differences cannot split votes for the same reading.
        const votes = new Map();
        const spellings = new Map();
        Object.values(texts).forEach((text) => {
          const key = comparisonText(text);
          if (!spellings.has(key)) spellings.set(key, text);
          votes.set(key, (votes.get(key) ?? 0) + 1);
        });
        item.votes = Object.fromEntries([...votes].map(([key, count]) => [spellings.get(key), count]));
        const top = Math.max(...votes.values());
        const winners = [...votes].filter(([, count]) => count === top);
        item.majority = winners.length === 1 ? spellings.get(winners[0][0]) : null;
      }
      items.push(item);
    }
  }
  items.sort((a, b) => a.start - b.start || a.end - b.end);
  return { version: 1, generated_at: generatedAt(options), engines, agreement: total ? agreed / total : 1,
    items: items.map((item, index) => ({ id: `d-${String(index + 1).padStart(4, "0")}`, ...item })) };
}

export async function transcribeDiffMedia(argument, options = {}) {
  const target = comparisonTarget(argument, options);
  const transcripts = await readEngineTranscripts(target, options.engines);
  const engines = transcripts.map((transcript) => transcript.backend);
  if (engines.length === 1) return { engines, skipped: "比較対象なし" };
  const result = compareTranscripts(transcripts, options);
  await writeSidecar(target, "diff.json", result);
  const by_kind = { word: 0, filler: 0, unrecognized: 0 };
  result.items.forEach((item) => { by_kind[item.kind] += 1; });
  return { engines, agreement: result.agreement, items: result.items.length, by_kind };
}
