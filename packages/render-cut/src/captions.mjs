const DEFAULT_MAX_CHARACTERS = 13;

// opt-in word-level スタイル（既定 = 未指定 = 従来のプレーン字幕。既定出力はバイト等価を保つため、
// このセットに含まれないスタイル値・words 未充填の場合は必ず renderCaptionFragment に fall back する）。
const KARAOKE_STYLE = "karaoke";
const POP_STYLE = "pop";
const SUPPORTED_WORD_STYLES = new Set([KARAOKE_STYLE, POP_STYLE]);

export function generateCaptionOverlays(captions, cuts, options = {}) {
  const maximum = options.maxCharacters ?? DEFAULT_MAX_CHARACTERS;
  const overlays = [];

  for (const caption of captions) {
    const ranges = computeCaptionRanges(caption.start, caption.end, cuts);
    const style = normalizeCaptionStyle(caption.style);
    for (const [index, range] of ranges.entries()) {
      const words = style ? clipWordsToRange(caption.words, range.sourceStart, range.sourceEnd) : [];
      const html =
        words.length > 0
          ? renderStyledCaptionFragment(words, style, { maximum, rangeStart: range.sourceStart })
          : renderCaptionFragment(caption.text, { maximum });
      overlays.push({
        id: `${caption.id}-${String(index + 1).padStart(2, "0")}`,
        html,
        start: range.start,
        duration: range.duration,
        transform: { x: 0, y: 0, scale: 1, rotate: 0 },
        vars: {},
        generatedFrom: caption.id,
      });
    }
  }

  return overlays;
}

function normalizeCaptionStyle(style) {
  return SUPPORTED_WORD_STYLES.has(style) ? style : null;
}

// cuts 交差後の (timeline 秒) に加えて、当該レンジがカバーする (source 秒) の範囲も返す。
// words[] のクリップ・トークン遅延の基準点計算に使う内部形。公開 API
// (sourceRangeToTimeline) は既存の { start, duration } 形のみを返し続ける。
function computeCaptionRanges(start, end, cuts) {
  if (!Array.isArray(cuts) || cuts.length === 0) {
    return [{ start, duration: end - start, sourceStart: start, sourceEnd: end }];
  }

  const ranges = [];
  let timelineCursor = 0;
  for (const cut of cuts) {
    const overlapStart = Math.max(start, cut.in);
    const overlapEnd = Math.min(end, cut.out);
    if (overlapEnd > overlapStart) {
      ranges.push({
        start: timelineCursor + overlapStart - cut.in,
        duration: overlapEnd - overlapStart,
        sourceStart: overlapStart,
        sourceEnd: overlapEnd,
      });
    }
    timelineCursor += cut.out - cut.in;
  }
  return ranges;
}

export function sourceRangeToTimeline(start, end, cuts) {
  return computeCaptionRanges(start, end, cuts).map(({ start, duration }) => ({ start, duration }));
}

// caption.words（analysis.json の transcriptSegment.words と同形: { start, end, text }、source 秒）
// を、cut 交差後の 1 レンジがカバーする source 秒区間へクリップする。区間外の word は落とし、
// 区間境界にかかる word は境界で切り詰める。words が無い/不正な要素のみなら空配列を返し、
// 呼び出し側は従来のプレーン字幕へ fall back する。
function clipWordsToRange(words, rangeSourceStart, rangeSourceEnd) {
  if (!Array.isArray(words) || words.length === 0) return [];
  return words
    .filter(isValidWord)
    .filter((word) => word.end > rangeSourceStart && word.start < rangeSourceEnd)
    .map((word) => ({
      text: word.text,
      start: Math.max(word.start, rangeSourceStart),
      end: Math.min(word.end, rangeSourceEnd),
    }))
    .sort((a, b) => a.start - b.start);
}

function isValidWord(word) {
  return (
    word !== null &&
    typeof word === "object" &&
    typeof word.text === "string" &&
    word.text.length > 0 &&
    typeof word.start === "number" &&
    typeof word.end === "number" &&
    Number.isFinite(word.start) &&
    Number.isFinite(word.end) &&
    word.end > word.start
  );
}

export function renderCaptionFragment(text, options = {}) {
  const maximum = options.maximum ?? DEFAULT_MAX_CHARACTERS;
  const lines = splitCaptionLines(text, maximum);
  const markup = lines
    .map((line) => `<p class="akari-caption__line">${escapeHtml(line)}</p>`)
    .join("");

  return `<div class="akari-caption">
  <style>
    .akari-caption {
      position: absolute;
      inset: 0;
      pointer-events: none;
      color: var(--caption-color, #fff);
      font-family: system-ui, -apple-system, sans-serif;
      font-size: var(--caption-font-size, 38px);
      font-weight: 700;
      line-height: 1.42;
      text-align: center;
    }
    .akari-caption__plate {
      position: absolute;
      left: 0;
      right: 0;
      bottom: var(--caption-bottom, 7%);
      display: flex;
      flex-direction: column;
      gap: var(--plate-gap, 4px);
      opacity: 1;
      animation: akari-caption-fade 180ms ease-out both;
    }
    .akari-caption__line {
      width: max-content;
      max-width: 92%;
      margin: 0 auto;
      padding: var(--plate-pad-y, 0.08em) var(--plate-pad-x, 0.42em);
      border-radius: var(--plate-radius, 10px);
      background: var(--plate-bg, rgba(8, 12, 22, 0.74));
      white-space: pre;
    }
    @keyframes akari-caption-fade {
      from { opacity: 0; transform: translateY(0.18em); }
      to { opacity: 1; transform: translateY(0); }
    }
  </style>
  <div class="akari-caption__plate">${markup}</div>
</div>`;
}

// opt-in word-level スタイル（karaoke / pop）のフラグメント。renderCaptionFragment と同じ
// プレート構造（akari-caption / akari-caption__plate / akari-caption__line）の上に、行内を
// 1 word = 1 span（akari-caption__tok）へ分解し、各トークンへ発話時刻由来の遅延を
// CSS カスタムプロパティで渡す。アニメは sub-c5.html 実証パターン（fieldtest
// 2026-07-15-vlog-mvp/project/overlays/subtitles/sub-c5.html）の一般化: paused + `both` で
// 静止させ、rasterize.mjs の __akariSeek が container.getAnimations({subtree:true}) 経由で
// 全トークンへ同一の currentTime（= オーバーレイ自身の start からのローカル秒）を与える前提。
// 個々のトークン要素に data-start は不要（sub-c5 が想定する別ランタイムと異なり、render-cut の
// __akariSeek はコンテナ単位でしか data-start を見ないため）。
export function renderStyledCaptionFragment(words, style, options = {}) {
  const maximum = options.maximum ?? DEFAULT_MAX_CHARACTERS;
  const rangeStart = options.rangeStart ?? 0;
  const normalizedStyle = SUPPORTED_WORD_STYLES.has(style) ? style : KARAOKE_STYLE;
  const lines = groupWordsIntoLines(words, maximum);
  const markup = lines
    .map(
      (line) =>
        `<p class="akari-caption__line">${line
          .map((word) => renderCaptionToken(word, rangeStart, normalizedStyle))
          .join("")}</p>`,
    )
    .join("");

  return `<div class="akari-caption akari-caption--${normalizedStyle}">
  <style>
    .akari-caption {
      position: absolute;
      inset: 0;
      pointer-events: none;
      color: var(--caption-color, #fff);
      font-family: system-ui, -apple-system, sans-serif;
      font-size: var(--caption-font-size, 38px);
      font-weight: 700;
      line-height: 1.42;
      text-align: center;
    }
    .akari-caption__plate {
      position: absolute;
      left: 0;
      right: 0;
      bottom: var(--caption-bottom, 7%);
      display: flex;
      flex-direction: column;
      gap: var(--plate-gap, 4px);
      opacity: 1;
      animation: akari-caption-fade 180ms ease-out both;
    }
    .akari-caption__line {
      width: max-content;
      max-width: 92%;
      margin: 0 auto;
      padding: var(--plate-pad-y, 0.08em) var(--plate-pad-x, 0.42em);
      border-radius: var(--plate-radius, 10px);
      background: var(--plate-bg, rgba(8, 12, 22, 0.74));
      white-space: pre;
    }
    .akari-caption__tok {
      display: inline-block;
      will-change: transform, color;
    }
    @keyframes akari-caption-fade {
      from { opacity: 0; transform: translateY(0.18em); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes akari-caption-karaoke-lit {
      from { color: var(--caption-color, #fff); }
      to { color: var(--caption-highlight-color, #ffd94a); }
    }
    @keyframes akari-caption-pop {
      0% { transform: translateY(0) scale(1); }
      50% { transform: translateY(-0.08em) scale(1.12); }
      100% { transform: translateY(0) scale(1); }
    }
    .akari-caption__tok--karaoke {
      animation: akari-caption-karaoke-lit var(--akari-tok-dur, 0.2s) var(--akari-tok-delay, 0s) linear both paused;
    }
    .akari-caption__tok--pop {
      animation: akari-caption-pop 0.2s var(--akari-tok-delay, 0s) ease-out both paused;
    }
  </style>
  <div class="akari-caption__plate">${markup}</div>
</div>`;
}

// maximum 文字を予算に word を行へ詰める。1 行の文字数上限は超え得る（word 途中では
// 折り返さない = splitCaptionLines の文字単位スライスと異なり word 単位を優先する）。
function groupWordsIntoLines(words, maximum) {
  const lines = [];
  let current = [];
  let currentLength = 0;
  for (const word of words) {
    const wordLength = Array.from(word.text).length;
    if (current.length > 0 && currentLength + wordLength > maximum) {
      lines.push(current);
      current = [];
      currentLength = 0;
    }
    current.push(word);
    currentLength += wordLength;
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

function renderCaptionToken(word, rangeStart, style) {
  const delay = formatSeconds(Math.max(0, word.start - rangeStart));
  const className =
    style === KARAOKE_STYLE ? "akari-caption__tok akari-caption__tok--karaoke" : "akari-caption__tok akari-caption__tok--pop";
  const vars =
    style === KARAOKE_STYLE
      ? `--akari-tok-delay: ${delay}s; --akari-tok-dur: ${formatSeconds(Math.max(0.01, word.end - word.start))}s`
      : `--akari-tok-delay: ${delay}s`;
  return `<span class="${className}" style="${vars}">${escapeHtml(word.text)}</span>`;
}

function formatSeconds(value) {
  return (Math.round(value * 1000) / 1000).toString();
}

export function splitCaptionLines(text, maximum = DEFAULT_MAX_CHARACTERS) {
  const explicit = String(text).split(/\r?\n/u);
  const lines = [];
  for (const value of explicit) {
    const characters = Array.from(value);
    if (characters.length === 0) {
      lines.push("");
      continue;
    }
    for (let index = 0; index < characters.length; index += maximum) {
      lines.push(characters.slice(index, index + maximum).join(""));
    }
  }
  return lines;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
