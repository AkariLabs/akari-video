// public/app.js から逐語移動。DOM とモジュール変数に依存しない純関数（F-69）。

export function collectExcludedCaptionIds(edit) {
  const result = new Set();
  const visit = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const source = value.source;
    if (source?.kind === 'captions' && Array.isArray(source.exclude)) {
      for (const id of source.exclude) if (typeof id === 'string') result.add(id);
    }
    for (const key of ['items', 'children']) {
      if (Array.isArray(value[key])) value[key].forEach(visit);
    }
  };
  for (const track of edit?.tracks ?? []) {
    for (const key of ['items', 'children']) {
      if (Array.isArray(track?.[key])) track[key].forEach(visit);
    }
  }
  return result;
}
export function filterCaptionRootByExcludedIds(root, excluded) {
  const filter = captions => captions.filter(caption => !excluded.has(caption?.id));
  if (Array.isArray(root)) return filter(root);
  if (root && typeof root === 'object' && Array.isArray(root.captions)) {
    return { ...root, captions: filter(root.captions) };
  }
  return root;
}

export function normalizeWords(words) {
  if (!Array.isArray(words) || !words.length) return [];
  return words.map(w => ({
    start: w.start ?? w.t ?? 0,
    end: w.end ?? (w.t ?? 0) + (w.d ?? 0.3),
    text: w.text ?? w.word ?? w.w ?? '',
  }));
}
const EMPHASIS_STYLE_MAP = { pain: 'one-char-bang', surprise: 'one-char-bang', anger: 'one-char-bang', joy: 'size-pulse', emphasis: 'size-pulse' };
export function findMatchingEmphasis(word, list) {
  return list?.find(e =>
    e.t_end > word.start && e.t_start < word.end &&
    (word.text === e.word || e.word.includes(word.text))
  ) || null;
}
export function resolveEmphasisStyle(emphasis) {
  return emphasis.style_hint || EMPHASIS_STYLE_MAP[emphasis.emotion] || 'color-accent';
}

// 行グループを開始時刻ごとに束ねて順送り表示の markup を作る
// （captions.mjs renderRevealGroups のポート。preview は速度リマップ無しの source 秒）。
export function renderRevealGroupsMarkup(lines, rangeStart, rangeEnd, renderLine) {
  const groups = [];
  for (const line of lines) {
    const start = line[0]?.start ?? rangeStart;
    const previous = groups[groups.length - 1];
    if (previous && previous.start === start) previous.lines.push(line);
    else groups.push({ start, lines: [line] });
  }
  return groups.map((group, index) => {
    const nextStart = groups[index + 1]?.start ?? rangeEnd;
    const delay = Math.max(0, group.start - rangeStart);
    const duration = Math.max(0.01, nextStart - group.start);
    const lineMarkup = group.lines
      .map(line => `<p class="akari-caption__line">${renderLine(line)}</p>`)
      .join('');
    return `<div class="akari-caption__reveal-group" style="--akari-reveal-delay:${delay.toFixed(3)}s;--akari-reveal-dur:${duration.toFixed(3)}s">${lineMarkup}</div>`;
  }).join('');
}
