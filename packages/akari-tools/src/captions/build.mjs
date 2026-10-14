import { clipSpansToRange } from "../media/unrecognized-spans.mjs";
import { toolsText } from '../i18n.mjs';
import { captionLanguageDefaults, normalizeLanguage } from "../../../content-language/src/index.mjs";

const roundTime = (value) => Math.round(value * 1000) / 1000;
export const captionLength = (text) => Array.from(text).reduce((count, char) =>
  count + (/[\x00-\x7f]/u.test(char) ? 0.5 : 1), 0);
const measuredLength = (text, lang) => ['ja', 'zh'].includes(normalizeLanguage(lang))
  ? captionLength(text) : Array.from(text).length;

export function buildCaptionsFromTranscript(segments, {
  src, lang = 'ja', readoutSeconds = 0.3, minDurationSeconds = captionLanguageDefaults(lang).minimumSeconds,
  maxCharacters = captionLanguageDefaults(lang).landscapeCharacters, idStart = 1,
  splitMode = "phrase", maxSeconds = 7.0, pauseSeconds = 0.6, sourceDurationSeconds = null,
} = {}) {
  if (!Array.isArray(segments)) throw new Error(toolsText('tools.captions.error.transcriptArray'));
  for (const [name, value] of Object.entries({ readoutSeconds, minDurationSeconds, maxSeconds, pauseSeconds })) {
    if (!Number.isFinite(value) || value < 0) throw new Error(toolsText('tools.captions.error.nonNegativeNumber', { name }));
  }
  if (maxCharacters !== null && (!Number.isInteger(maxCharacters) || maxCharacters < 0)) {
    throw new Error(toolsText('tools.captions.error.maxCharacters'));
  }
  if (!["phrase", "none"].includes(splitMode)) throw new Error(toolsText('tools.captions.error.splitMode'));
  if (!Number.isInteger(idStart) || idStart < 1 || idStart > 9999) throw new Error(toolsText('tools.captions.error.idStart'));
  const warnings = [];
  const captions = [];
  const sorted = segments.map((segment, index) => ({ segment, index }))
    .sort((a, b) => a.segment.start - b.segment.start || a.index - b.index);
  for (const { segment, index } of sorted) {
    const originalText = segment.text.trim();
    const alignedWords = segment.words?.length ? alignCaptionWords(originalText, segment.words) : null;
    const words = alignedWords ?? segment.words;
    const text = originalText;
    if (!text) {
      warnings.push(toolsText('tools.captions.warning.emptyText', { index }));
      continue;
    }
    let pieces = [{ text, words }];
    if (splitMode === "phrase") {
      if (words?.length) pieces = splitPhrases(text, words, { maxCharacters, maxSeconds, pauseSeconds, lang });
      else {
        pieces = splitProportionally(text, segment);
        warnings.push(toolsText('tools.captions.warning.wordsMissing', { index }));
      }
    } else if (maxCharacters && measuredLength(text, lang) > maxCharacters) {
      if (!words?.length) warnings.push(toolsText('tools.captions.warning.splitSkipped', { index }));
      else pieces = splitWords(text, words, maxCharacters, lang);
    }
    for (const piece of pieces) {
      const start = piece.words?.length ? piece.words[0].start : piece.start ?? segment.start;
      const lastEnd = piece.words?.length ? piece.words.at(-1).end : piece.end ?? segment.end;
      const captionWords = piece.words?.length ? alignCaptionWords(piece.text, piece.words) : null;
      if (!Number.isFinite(start) || !Number.isFinite(lastEnd) || start < 0 || lastEnd < start) {
        throw new Error(toolsText('tools.captions.error.invalidTiming', { index }));
      }
      const id = idStart + captions.length;
      if (id > 9999) throw new Error(toolsText('tools.captions.error.idOverflow'));
      captions.push({
        id: `c-${String(id).padStart(4, "0")}`,
        start: roundTime(start), end: roundTime(lastEnd + readoutSeconds), text: piece.text,
        speaker: typeof segment.speaker === "string" && segment.speaker.length > 0 ? segment.speaker : null,
        sourceRef: { segment: index }, edited: false,
        ...(src !== undefined ? { src } : {}),
        ...(piece.words !== undefined ? { words: captionWords ?? piece.words } : {}),
        ...(segment.unrecognized !== undefined ? { unrecognized: segment.unrecognized } : {}),
      });
    }
  }
  if (!['ja', 'zh'].includes(normalizeLanguage(lang))) {
    moveDanglingFunctionWords(captions, { pauseSeconds, readoutSeconds, idStart });
  }
  for (let index = 0; index < captions.length; index += 1) {
    const caption = captions[index];
    const nextStart = captions[index + 1]?.start ?? Infinity;
    caption.end = Math.min(caption.end, nextStart);
    if (caption.end - caption.start < minDurationSeconds) {
      caption.end = Math.min(roundTime(caption.start + minDurationSeconds), nextStart);
    }
    if (caption.end - caption.start < minDurationSeconds - 1e-9) {
      warnings.push(toolsText('tools.captions.warning.shortDuration', { id: caption.id, seconds: minDurationSeconds }));
    }
  }
  if (Number.isFinite(sourceDurationSeconds)) {
    for (let index = captions.length - 1; index >= 0; index -= 1) {
      const caption = captions[index];
      caption.end = roundTime(Math.min(caption.end, sourceDurationSeconds));
      if (caption.end - caption.start < 0.2 - 1e-9) {
        warnings.push(toolsText('tools.captions.warning.sourceShort', { id: caption.id }));
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

function alignCaptionWords(text, words) {
  if (words.map((word) => word.text).join("") === text) return words;
  if (words.map((word) => word.text).join("").replace(/\s/gu, "") !== text.replace(/\s/gu, "")) return null;
  let cursor = 0;
  const aligned = [];
  for (const word of words) {
    const surface = String(word.text ?? "").replace(/\s/gu, "");
    if (!surface) return null;
    const position = text.slice(cursor).search(/\S/u) + cursor;
    if (position < cursor) return null;
    let end = position;
    for (const char of surface) {
      while (/\s/u.test(text[end] ?? "")) end += 1;
      if (!text.startsWith(char, end)) return null;
      end += char.length;
    }
    aligned.push({ ...word, text: text.slice(cursor, end) });
    cursor = end;
  }
  if (aligned.length) aligned.at(-1).text += text.slice(cursor);
  return aligned;
}

function transcriptTokens(text, words, lang) {
  const spaced = !['ja', 'zh'].includes(normalizeLanguage(lang));
  if (spaced) {
    const compact = text.replace(/\s/gu, '');
    const surfaces = words.map(word => word.text.trim().replace(/\s/gu, ''));
    if (compact === surfaces.join('')) {
      const tokens = [];
      let cursor = 0;
      for (const surface of surfaces) {
        let remaining = surface.length;
        const start = cursor;
        while (cursor < text.length && remaining > 0) {
          if (!/\s/u.test(text[cursor])) remaining -= 1;
          cursor += 1;
        }
        while (cursor < text.length && /\s/u.test(text[cursor])) cursor += 1;
        tokens.push(text.slice(start, cursor));
      }
      return attachLeadingPunctuation(tokens);
    }
  }
  const tokens = [];
  let cursor = 0;
  for (const word of words) {
    const surface = word.text.trim();
    const position = surface ? text.indexOf(surface, cursor) : -1;
    if (position < 0) {
      if (!spaced) return words.map(item => item.text);
      return attachLeadingPunctuation(words.map((item, index) => {
        const surface = item.text.trim();
        return index && !/^[\p{P}]/u.test(surface) ? ` ${surface}` : surface;
      }));
    }
    const gap = text.slice(cursor, position);
    if (tokens.length) tokens[tokens.length - 1] += gap;
    tokens.push((tokens.length ? '' : gap) + surface);
    cursor = position + surface.length;
  }
  if (cursor > 0 && tokens.length) tokens[tokens.length - 1] += text.slice(cursor);
  return spaced ? attachLeadingPunctuation(tokens) : tokens;
}

function attachLeadingPunctuation(tokens) {
  const result = [];
  for (const token of tokens) {
    const match = result.length && /^\s*([,.?!;:]+)(\s*)([\s\S]*)$/u.exec(token);
    if (!match) {
      result.push(token);
      continue;
    }
    // A transcriber may emit ",where" as one timed word. Keep its word timing,
    // but attach the comma to the preceding displayed word.
    const previous = result.at(-1);
    const trailingSpace = /\s*$/u.exec(previous)[0];
    result[result.length - 1] = previous.slice(0, previous.length - trailingSpace.length) + match[1];
    result.push(match[3] ? ` ${match[3].trimStart()}` : match[2] || trailingSpace);
  }
  return result;
}

function legacySplitWordTokens(text, words) {
  let cursor = 0;
  const tokens = [];
  for (const word of words) {
    const surface = word.text.trim();
    const position = surface ? text.indexOf(surface, cursor) : -1;
    if (position < 0) return words.map(item => item.text);
    const end = position + surface.length;
    tokens.push(text.slice(cursor, end));
    cursor = end;
  }
  if (cursor > 0) tokens[tokens.length - 1] += text.slice(cursor);
  return tokens;
}

function splitWords(text, words, maxCharacters, lang) {
  // 元の本文にある空白・句読点も語に付随させ、分割で消さない。
  const tokens = ['ja', 'zh'].includes(normalizeLanguage(lang))
    ? legacySplitWordTokens(text, words) : transcriptTokens(text, words, lang);
  const pieces = [];
  let piece = { text: "", words: [] };
  for (let index = 0; index < words.length; index += 1) {
    const candidate = piece.text + tokens[index];
    if (piece.words.length && measuredLength(candidate.trim(), lang) > maxCharacters) {
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
const functionWord = (text) => /(?:^|\s)(?:a|an|the|and|or|but|for|of|to|in|on|at|with|by|from|before)\s*$/iu.test(text);

function moveDanglingFunctionWords(captions, { pauseSeconds, readoutSeconds, idStart }) {
  let changed = false;
  for (let index = 0; index + 1 < captions.length; index += 1) {
    const current = captions[index];
    const next = captions[index + 1];
    const lastWord = current.words?.at(-1);
    const match = /(?:^|\s)(a|an|the|and|or|but|for|of|to|in|on|at|with|by|from|before)\s*$/iu.exec(current.text);
    // Intra-segment character splits are handled in splitPhrases. Only bridge
    // contiguous transcript segments here; intentional pauses stay intact.
    if (!lastWord || !next.words?.length || !match
      || current.sourceRef.segment === next.sourceRef.segment
      || lastWord.text.trim().toLowerCase() !== match[1].toLowerCase()
      || next.start - lastWord.end >= pauseSeconds - 1e-9
      || /^[,.?!;:]/u.test(next.text)) continue;
    current.words.pop();
    current.text = current.text.slice(0, match.index).trimEnd();
    next.words.unshift(lastWord);
    next.text = `${match[1]} ${next.text}`;
    next.start = roundTime(lastWord.start);
    if (current.words.length) current.end = roundTime(current.words.at(-1).end + readoutSeconds);
    else {
      captions.splice(index, 1);
      index -= 1;
    }
    changed = true;
  }
  if (changed) captions.forEach((caption, index) => {
    caption.id = `c-${String(idStart + index).padStart(4, '0')}`;
  });
}

function splitPhrases(text, words, { maxCharacters, maxSeconds, pauseSeconds, lang }) {
  // 本文を順に照合し、語間の句読点・空白は直前の語に付随させる。
  const tokens = transcriptTokens(text, words, lang).map((value, index) => ({ text: value, words: [words[index]] }));
  // 独立した句読点トークンも前の語と一体にし、句読点だけの cue を防ぐ。
  const attached = [];
  for (const token of tokens) {
    if (attached.length && (punctuationOnly(token.text) || token.text === '')) {
      attached.at(-1).text += token.text;
      attached.at(-1).words.push(...token.words);
    } else attached.push(token);
  }
  const pieces = [];
  let pending = [];
  const spaced = !['ja', 'zh'].includes(normalizeLanguage(lang));
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
      const overCharacters = maxCharacters && measuredLength(candidate.trim(), lang) > maxCharacters;
      const overSeconds = maxSeconds && seconds > maxSeconds;
      if (!overCharacters && !overSeconds) break;
      const boundary = pending.findLastIndex((item) => softBoundary(item.text));
      let count = boundary >= 0 ? boundary + 1 : pending.length;
      if (spaced && overCharacters && !overSeconds && boundary < 0) {
        while (count > 1 && functionWord(pending[count - 1].text)) count -= 1;
        // A lone article/preposition belongs with the next word, even if that
        // word itself exceeds the preferred character budget.
        if (count === 1 && functionWord(pending[0].text)) break;
      }
      emit(count);
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
    const start = segment.start + (segment.end - segment.start) * consumed / captionLength(text);
    consumed += captionLength(fragment);
    const end = segment.start + (segment.end - segment.start) * consumed / captionLength(text);
    if (!fragment.trim() || (punctuationOnly(fragment) && pieces.length)) {
      if (pieces.length) {
        pieces.at(-1).text += fragment.trim();
        pieces.at(-1).end = end;
      }
    } else pieces.push({ text: fragment.trim(), start, end });
  }
  return pieces;
}
