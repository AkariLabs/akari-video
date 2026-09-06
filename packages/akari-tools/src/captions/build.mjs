const roundTime = (value) => Math.round(value * 1000) / 1000;
const length = (text) => Array.from(text).length;

export function buildCaptionsFromTranscript(segments, {
  src, readoutSeconds = 0.3, minDurationSeconds = 1.0, maxCharacters = null, idStart = 1,
} = {}) {
  if (!Array.isArray(segments)) throw new Error("transcript は配列で指定してください");
  for (const [name, value] of Object.entries({ readoutSeconds, minDurationSeconds })) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${name} は 0 以上の数値で指定してください`);
  }
  if (maxCharacters !== null && (!Number.isInteger(maxCharacters) || maxCharacters < 1)) {
    throw new Error("maxCharacters は正の整数で指定してください");
  }
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
    if (maxCharacters !== null && length(text) > maxCharacters) {
      if (!segment.words?.length) warnings.push(`segment ${index}: words が無いため分割しませんでした`);
      else pieces = splitWords(text, segment.words, maxCharacters);
    }
    for (const piece of pieces) {
      const start = piece.words?.length ? piece.words[0].start : segment.start;
      const lastEnd = piece.words?.length ? piece.words.at(-1).end : segment.end;
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
