export function groupWordsIntoLines(words, maxLen = 13) {
  const lines = [];
  let cur = [], len = 0;
  for (const w of words) {
    const wlen = Array.from(w.text).length;
    if (len + wlen > maxLen && cur.length > 0) { lines.push(cur); cur = []; len = 0; }
    cur.push(w); len += wlen;
  }
  if (cur.length > 0) lines.push(cur);
  return lines;
}
// --- render-cut とのパリティ層（正本: packages/render-cut/src/captions.mjs）---
// 縦長出力では「行を短く（10 字）・文字を大きく（幅 6%）・複数行字幕は行単位の順送り（reveal）」
// が焼き込み側の既定。プレビューも同じ既定で描く。ロジックは意図的な文字列/コード重複
// （render-cut は CLI パッケージで相互 import しない方針）。
export function isPortraitOutput(summary) {
  const os = summary?.output || {};
  return Number(os.height) > Number(os.width);
}
export function captionLineBudget(summary) { return isPortraitOutput(summary) ? 10 : 20; }
export function captionLineBudgetFor(caption, summary) {
  // render-cut mergeCaptionTextStyles と同じく各段を先に検証し、不正値は次の段へ落とす。
  for (const value of [caption?.text_style?.max_characters, summary?.default_text_style?.max_characters]) {
    if (Number.isInteger(value) && value > 0) return value;
  }
  return captionLineBudget(summary);
}
export function defaultCaptionFontSize(summary) {
  const os = summary?.output || {};
  return isPortraitOutput(summary) ? Math.round(Number(os.width) * 0.06) : 38;
}
const CAPTION_BOUNDARIES = ['から', 'まで', 'ので', 'のに', 'けど', 'て', 'で', 'は', 'が', 'を', 'に', 'へ', 'と', 'も', 'の'];
export function splitCaptionLines(text, maximum) {
  const limit = Number.isFinite(maximum) && maximum > 0 ? Math.floor(maximum) : 20;
  const lines = [];
  for (const value of String(text).split(/\r?\n/u)) {
    if (value.length === 0) { lines.push(''); continue; }
    for (const segment of splitAfterPunctuation(value)) {
      lines.push(...splitAtNaturalBoundaries(segment, limit));
    }
  }
  return lines;
}
function splitAfterPunctuation(value) {
  const characters = Array.from(value);
  const segments = [];
  let start = 0;
  for (let index = 0; index < characters.length; index += 1) {
    if (characters[index] === '。' && index + 1 < characters.length) {
      segments.push(characters.slice(start, index + 1).join(''));
      start = index + 1;
    }
  }
  segments.push(characters.slice(start).join(''));
  return segments;
}
function splitAtNaturalBoundaries(value, maximum) {
  const lines = [];
  let remaining = Array.from(value);
  while (remaining.length > maximum) {
    const commaBoundary = findLastCommaBoundary(remaining, maximum);
    const spaceBoundary = commaBoundary ?? findLastSpaceBoundary(remaining, maximum);
    const phraseBoundary = spaceBoundary ?? findLastPhraseBoundary(remaining, maximum);
    const boundary = phraseBoundary ?? maximum;
    lines.push(remaining.slice(0, boundary).join(''));
    remaining = remaining.slice(boundary);
  }
  if (remaining.length > 0) lines.push(remaining.join(''));
  return lines;
}
function findLastCommaBoundary(characters, maximum) {
  for (let index = maximum - 1; index > 0; index -= 1) {
    if (characters[index] === '、') return index + 1;
  }
  return null;
}
function findLastSpaceBoundary(characters, maximum) {
  for (let index = maximum - 1; index > 0; index -= 1) {
    if (characters[index] === ' ' || characters[index] === '　') return index + 1;
  }
  return null;
}
function findLastPhraseBoundary(characters, maximum) {
  const prefix = characters.slice(0, maximum).join('');
  let best = null;
  for (const boundary of CAPTION_BOUNDARIES) {
    const index = prefix.lastIndexOf(boundary);
    if (index >= 0) {
      const candidate = Array.from(prefix.slice(0, index + boundary.length)).length;
      if (candidate > 0 && (best === null || candidate > best)) best = candidate;
    }
  }
  return best;
}
// splitCaptionLines の分割点を word 境界へスナップして words を行へ配る
// （captions.mjs groupDisplayTokensIntoLines の words 専用ポート）。
export function groupWordsIntoDisplayLines(words, maximum) {
  if (words.length === 0) return [];
  const text = words.map(w => w.text).join('');
  const desiredBoundaries = [];
  let desiredOffset = 0;
  for (const line of splitCaptionLines(text, maximum).slice(0, -1)) {
    desiredOffset += Array.from(line).length;
    desiredBoundaries.push(desiredOffset);
  }
  const ranges = [];
  let offset = 0;
  for (const word of words) {
    const start = offset;
    offset += Array.from(word.text).length;
    ranges.push({ word, start, end: offset });
  }
  const boundaries = [];
  let previous = 0;
  for (const desired of desiredBoundaries) {
    const containing = ranges.find(({ start, end }) => start < desired && desired < end);
    let snapped = desired;
    if (containing) {
      const candidates = [containing.start, containing.end]
        .filter(candidate => candidate > previous && candidate < offset);
      const withinTolerance = candidates.filter(candidate => candidate - previous <= maximum + 2);
      const eligible = withinTolerance.length > 0 ? withinTolerance : candidates;
      if (eligible.length === 0) continue;
      snapped = eligible.reduce((best, candidate) =>
        Math.abs(candidate - desired) < Math.abs(best - desired) ? candidate : best);
    }
    if (snapped > previous && snapped < offset) { boundaries.push(snapped); previous = snapped; }
  }
  const lines = [];
  let start = 0;
  for (const end of [...boundaries, offset]) {
    const line = ranges.filter(r => r.end > start && r.start < end).map(r => r.word);
    if (line.length > 0) lines.push(line);
    start = end;
  }
  return lines;
}
