import { clipSpansToRange } from "../media/unrecognized-spans.mjs";

const roundTime = (value) => Math.round(value * 1000) / 1000;
const length = (text) => Array.from(text).length;

export function buildCaptionsFromTranscript(segments, {
  src, readoutSeconds = 0.3, minDurationSeconds = 1.0, maxCharacters = 20, idStart = 1,
  splitMode = "phrase", maxSeconds = 7.0, pauseSeconds = 0.6, sourceDurationSeconds = null,
} = {}) {
  if (!Array.isArray(segments)) throw new Error("transcript は配列で指定してください");
  for (const [name, value] of Object.entries({ readoutSeconds, minDurationSeconds, maxSeconds, pauseSeconds })) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${name} は 0 以上の数値で指定してください`);
  }
  if (maxCharacters !== null && (!Number.isInteger(maxCharacters) || maxCharacters < 0)) {
    throw new Error("maxCharacters は 0 以上の整数で指定してください");
  }
  if (!["phrase", "none"].includes(splitMode)) throw new Error("splitMode は phrase または none で指定してください");
  if (!Number.isInteger(idStart) || idStart < 1 || idStart > 9999) throw new Error("idStart は 1〜9999 で指定してください");
  const warnings = [];
  const captions = [];
  const sorted = segments.map((segment, index) => ({ segment, index }))
    .sort((a, b) => a.segment.start - b.segment.start || a.index - b.index);
  for (const { segment, index } of sorted) {
    const text = segment.text.trim();
    if (!text) {
      warnings.push(`segment ${index}: 空の text をスキップしました`);
      continue;
    }
    let pieces = [{ text, words: segment.words }];
    if (splitMode === "phrase") {
      if (segment.words?.length) pieces = splitPhrases(text, segment.words, { maxCharacters, maxSeconds, pauseSeconds });
      else {
        pieces = splitProportionally(text, segment);
        warnings.push(`segment ${index}: words が無いため文字数比で時刻を按分しました`);
      }
    } else if (maxCharacters && length(text) > maxCharacters) {
      if (!segment.words?.length) warnings.push(`segment ${index}: words が無いため分割しませんでした`);
      else pieces = splitWords(text, segment.words, maxCharacters);
    }
    for (const piece of pieces) {
      const start = piece.words?.length ? piece.words[0].start : piece.start ?? segment.start;
      const lastEnd = piece.words?.length ? piece.words.at(-1).end : piece.end ?? segment.end;
      if (!Number.isFinite(start) || !Number.isFinite(lastEnd) || start < 0 || lastEnd < start) {
        throw new Error(`segment ${index}: 時刻が不正です`);
      }
      const id = idStart + captions.length;
      if (id > 9999) throw new Error("字幕 ID が c-9999 を超えます");
      captions.push({
        id: `c-${String(id).padStart(4, "0")}`,
        start: roundTime(start), end: roundTime(lastEnd + readoutSeconds), text: piece.text,
        speaker: null, sourceRef: { segment: index }, edited: false,
        ...(src !== undefined ? { src } : {}),
        ...(piece.words !== undefined ? { words: piece.words } : {}),
        ...(segment.unrecognized !== undefined ? { unrecognized: segment.unrecognized } : {}),
      });
    }
  }
  for (let index = 0; index < captions.length; index += 1) {
    const caption = captions[index];
    const nextStart = captions[index + 1]?.start ?? Infinity;
    caption.end = Math.min(caption.end, nextStart);
    if (caption.end - caption.start < minDurationSeconds) {
      caption.end = Math.min(roundTime(caption.start + minDurationSeconds), nextStart);
    }
    if (caption.end - caption.start < minDurationSeconds - 1e-9) {
      warnings.push(`${caption.id}: 表示時間が ${minDurationSeconds} 秒未満です`);
    }
  }
  if (Number.isFinite(sourceDurationSeconds)) {
    for (let index = captions.length - 1; index >= 0; index -= 1) {
      const caption = captions[index];
      caption.end = roundTime(Math.min(caption.end, sourceDurationSeconds));
      if (caption.end - caption.start < 0.2 - 1e-9) {
        warnings.push(`${caption.id}: 素材尺で丸めた表示時間が 0.2 秒未満のためスキップしました`);
        captions.splice(index, 1);
      }
    }
  }
  // 未認識区間は「セグメントの持ち物」なので、分割してできた各字幕へ丸ごと複製すると
  // 自分の [start, end] の外の区間まで持ち回り、台本パネルが行頭・行末へ無関係な ?? を出す
  // （placeUnrecognized は範囲外の span を行頭へ置く）。契約 §3 のとおり各字幕の範囲へ切り詰め、
  // 空になったらキーごと落とす。正本: docs/contract-2026-09-02-transcript-unrecognized-spans-v0.md
  for (const caption of captions) {
    if (caption.unrecognized === undefined) continue;
    const clipped = clipSpansToRange(caption.unrecognized, caption.start, caption.end);
    if (clipped.length) caption.unrecognized = clipped;
    else delete caption.unrecognized;
  }
  return { captions, warnings };
}

function splitWords(text, words, maxCharacters) {
  // 元の本文にある空白・句読点も語に付随させ、分割で消さない。
  let cursor = 0;
  let tokens = [];
  for (const word of words) {
    const surface = word.text.trim();
    const position = surface ? text.indexOf(surface, cursor) : -1;
    if (position < 0) {
      // 本文が語列と一致しない場合は語列そのものを使い、本文を二重に継ぎ足さない。
      tokens = words.map((item) => item.text);
      cursor = 0;
      break;
    }
    const end = position + surface.length;
    tokens.push(text.slice(cursor, end));
    cursor = end;
  }
  if (cursor > 0) tokens[tokens.length - 1] += text.slice(cursor);
  const pieces = [];
  let piece = { text: "", words: [] };
  for (let index = 0; index < words.length; index += 1) {
    const candidate = piece.text + tokens[index];
    if (piece.words.length && length(candidate.trim()) > maxCharacters) {
      pieces.push({ ...piece, text: piece.text.trim() });
      piece = { text: "", words: [] };
    }
    piece.text += tokens[index];
    piece.words.push(words[index]);
  }
  if (piece.words.length) pieces.push({ ...piece, text: piece.text.trim() });
  return pieces;
}

const hardBoundary = (text) => /[。！？!?]\s*$/u.test(text);
const softBoundary = (text) => /[、,]\s*$/u.test(text);
const punctuationOnly = (text) => /^[\p{P}\s]+$/u.test(text);

function splitPhrases(text, words, { maxCharacters, maxSeconds, pauseSeconds }) {
  // 本文を順に照合し、語間の句読点・空白は直前の語に付随させる。
  const tokens = [];
  let cursor = 0;
  for (const word of words) {
    const surface = word.text.trim();
    const position = surface ? text.indexOf(surface, cursor) : -1;
    if (position < 0) {
      tokens.length = 0;
      tokens.push(...words.map((item) => ({ text: item.text, words: [item] })));
      cursor = 0;
      break;
    }
    const gap = text.slice(cursor, position);
    if (tokens.length) tokens.at(-1).text += gap;
    tokens.push({ text: (tokens.length ? "" : gap) + surface, words: [word] });
    cursor = position + surface.length;
  }
  if (cursor > 0) tokens.at(-1).text += text.slice(cursor);
  // 独立した句読点トークンも前の語と一体にし、句読点だけの cue を防ぐ。
  const attached = [];
  for (const token of tokens) {
    if (attached.length && punctuationOnly(token.text)) {
      attached.at(-1).text += token.text;
      attached.at(-1).words.push(...token.words);
    } else attached.push(token);
  }
  const pieces = [];
  let pending = [];
  const emit = (count) => {
    const group = pending.splice(0, count);
    pieces.push({ text: group.map((token) => token.text).join("").trim(), words: group.flatMap((token) => token.words) });
  };
  for (const token of attached) {
    if (pending.length) {
      const previous = pending.at(-1);
      if (hardBoundary(previous.text) || token.words[0].start - previous.words.at(-1).end >= pauseSeconds - 1e-9) emit(pending.length);
    }
    while (pending.length) {
      const candidate = pending.map((item) => item.text).join("") + token.text;
      const seconds = token.words.at(-1).end - pending[0].words[0].start;
      if (!(maxCharacters && length(candidate.trim()) > maxCharacters) && !(maxSeconds && seconds > maxSeconds)) break;
      const boundary = pending.findLastIndex((item) => softBoundary(item.text));
      emit(boundary >= 0 ? boundary + 1 : pending.length);
    }
    pending.push(token);
  }
  if (pending.length) emit(pending.length);
  if (pieces.length === 1) pieces[0].words = words;
  return pieces;
}

function splitProportionally(text, segment) {
  const fragments = text.match(/[^。！？!?]*[。！？!?]+|[^。！？!?]+$/gu) ?? [text];
  const pieces = [];
  let consumed = 0;
  for (const fragment of fragments) {
    const start = segment.start + (segment.end - segment.start) * consumed / length(text);
    consumed += length(fragment);
    const end = segment.start + (segment.end - segment.start) * consumed / length(text);
    if (!fragment.trim() || (punctuationOnly(fragment) && pieces.length)) {
      if (pieces.length) {
        pieces.at(-1).text += fragment.trim();
        pieces.at(-1).end = end;
      }
    } else pieces.push({ text: fragment.trim(), start, end });
  }
  return pieces;
}
