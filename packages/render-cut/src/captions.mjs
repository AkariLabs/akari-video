import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { computeCutTimelineOffsets, cutSpeed } from "./cut-timeline.mjs";

const DEFAULT_MAX_CHARACTERS = 20;

// 焼き込みキャプションのフォント固定（win2-fonts-wire）。CI/Docker 等 Hiragino も Noto CJK も
// 無い/バージョン違いの環境でも同一グリフでレンダリングされるよう、同梱済み Noto Sans JP
// （win2-fonts-assets、assets/font/noto-sans-jp/、可変フォント 1 本）を @font-face で固定する。
// captions.mjs から見て ../../../ が repo root（packages/render-cut/src/ → render-cut → packages
// → repo root）。preview（akari-preview-open-handler.ts）にも同一のフォントスタック文字列
// '"Noto Sans JP", sans-serif' を使うが、両パッケージ間に依存関係が無い（render-cut は
// CLI パッケージ、akari-preview は Electron 拡張で互いを import しない）ため定数の共有はせず、
// 文字列を意図的に重複させている（判断は report に記録）。
const CAPTION_FONT_STACK = '"Noto Sans JP", sans-serif';
const CAPTION_FONT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../assets/font/noto-sans-jp/NotoSansJP-Variable.ttf",
);
// font-weight を 100 900 の範囲指定にすることで、可変フォントの wght 軸を
// font-weight:700 等の指定に応じて実際に補間させる（範囲を省略すると単一ウェイトのみ
// マッチし、キャプションの font-weight:700 が無視される）。
const CAPTION_FONT_FACE_CSS = `@font-face {
      font-family: "Noto Sans JP";
      src: url("${pathToFileURL(CAPTION_FONT_PATH).href}") format("truetype-variations");
      font-weight: 100 900;
      font-style: normal;
    }`;

// opt-in word-level スタイル（既定 = 未指定 = 従来のプレーン字幕。既定出力はバイト等価を保つため、
// このセットに含まれないスタイル値・words 未充填の場合は必ず renderCaptionFragment に fall back する）。
const KARAOKE_STYLE = "karaoke";
const POP_STYLE = "pop";
const SUPPORTED_WORD_STYLES = new Set([KARAOKE_STYLE, POP_STYLE]);
const EMPHASIS_STYLE_ONE_CHAR_BANG = "one-char-bang";
const EMPHASIS_STYLE_SIZE_PULSE = "size-pulse";
const EMPHASIS_STYLE_COLOR_ACCENT = "color-accent";
const SUPPORTED_EMPHASIS_STYLES = new Set([
  EMPHASIS_STYLE_ONE_CHAR_BANG,
  EMPHASIS_STYLE_SIZE_PULSE,
  EMPHASIS_STYLE_COLOR_ACCENT,
]);

export function generateCaptionOverlays(captions, cuts, options = {}) {
  const maximum = options.maxCharacters ?? DEFAULT_MAX_CHARACTERS;
  const emphasisWords = normalizeEmphasisWords(options.emphasisWords);
  const overlays = [];

  for (const caption of captions) {
    const ranges = computeCaptionRanges(caption.start, caption.end, cuts);
    const style = normalizeCaptionStyle(caption.style);
    for (const [index, range] of ranges.entries()) {
      const words = style || emphasisWords.length > 0
        ? clipWordsToRange(caption.words, range.sourceStart, range.sourceEnd)
        : [];
      const hasEmphasis = words.some((word) => findMatchingEmphasis(word, emphasisWords));
      const html =
        words.length > 0 && (style || hasEmphasis)
          ? renderStyledCaptionFragment(words, style, {
              maximum,
              rangeStart: range.sourceStart,
              emphasisTimeScale: range.emphasisTimeScale ?? 1,
              emphasisWords,
            })
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

  const offsets = computeCutTimelineOffsets(cuts);
  const ranges = [];
  for (const [index, cut] of cuts.entries()) {
    const overlapStart = Math.max(start, cut.in);
    const overlapEnd = Math.min(end, cut.out);
    if (overlapEnd > overlapStart) {
      const speed = cutSpeed(cut);
      ranges.push({
        start: offsets[index].start + (overlapStart - cut.in) / speed,
        duration: (overlapEnd - overlapStart) / speed,
        sourceStart: overlapStart,
        sourceEnd: overlapEnd,
        emphasisTimeScale: 1 / speed,
      });
    }
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
    ${CAPTION_FONT_FACE_CSS}
    .akari-caption {
      position: absolute;
      inset: 0;
      pointer-events: none;
      color: var(--caption-color, #fff);
      text-shadow: var(--caption-text-shadow, -1.5px -1.5px 0 rgba(0,0,0,.85), 1.5px -1.5px 0 rgba(0,0,0,.85), -1.5px 1.5px 0 rgba(0,0,0,.85), 1.5px 1.5px 0 rgba(0,0,0,.85), 0 0 8px rgba(0,0,0,.6));
      font-family: ${CAPTION_FONT_STACK};
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
      background: var(--plate-bg, transparent);
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
  const emphasisTimeScale = options.emphasisTimeScale ?? 1;
  const normalizedStyle = SUPPORTED_WORD_STYLES.has(style) ? style : null;
  const emphasisWords = normalizeEmphasisWords(options.emphasisWords);
  const hasEmphasis = words.some((word) => findMatchingEmphasis(word, emphasisWords));
  const effectiveStyle = normalizedStyle ?? (hasEmphasis ? null : KARAOKE_STYLE);
  const rootStyle = effectiveStyle ?? "emphasis";
  const lines = groupWordsIntoLines(words, maximum);
  const markup = lines
    .map(
      (line) =>
        `<p class="akari-caption__line">${line
          .map((word) => renderCaptionToken(word, rangeStart, effectiveStyle, emphasisWords, emphasisTimeScale))
          .join("")}</p>`,
    )
    .join("");

  const emphasisCss = hasEmphasis ? renderEmphasisCss() : "";

  return `<div class="akari-caption akari-caption--${rootStyle}">
  <style>
    ${CAPTION_FONT_FACE_CSS}
    .akari-caption {
      position: absolute;
      inset: 0;
      pointer-events: none;
      color: var(--caption-color, #fff);
      text-shadow: var(--caption-text-shadow, -1.5px -1.5px 0 rgba(0,0,0,.85), 1.5px -1.5px 0 rgba(0,0,0,.85), -1.5px 1.5px 0 rgba(0,0,0,.85), 1.5px 1.5px 0 rgba(0,0,0,.85), 0 0 8px rgba(0,0,0,.6));
      font-family: ${CAPTION_FONT_STACK};
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
      background: var(--plate-bg, transparent);
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
    }${emphasisCss}
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

function renderCaptionToken(word, rangeStart, style, emphasisWords = [], emphasisTimeScale = 1) {
  const emphasis = findMatchingEmphasis(word, emphasisWords);
  // 語レベル演出は caption の karaoke/pop より該当 token だけ優先する。
  if (emphasis) return renderEmphasisCaptionToken(word, rangeStart, emphasis, emphasisTimeScale);

  const delay = formatSeconds(Math.max(0, word.start - rangeStart));
  const className = style === KARAOKE_STYLE
    ? "akari-caption__tok akari-caption__tok--karaoke"
    : style === POP_STYLE
      ? "akari-caption__tok akari-caption__tok--pop"
      : "akari-caption__tok";
  const vars = style === KARAOKE_STYLE
    ? `--akari-tok-delay: ${delay}s; --akari-tok-dur: ${formatSeconds(Math.max(0.01, word.end - word.start))}s`
    : style === POP_STYLE
      ? `--akari-tok-delay: ${delay}s`
      : "";
  return `<span class="${className}" style="${vars}">${escapeHtml(word.text)}</span>`;
}

function renderEmphasisCaptionToken(word, rangeStart, emphasis, timeScale) {
  const style = resolveEmphasisStyle(emphasis);
  const overlapStart = Math.max(word.start, emphasis.t_start);
  const overlapEnd = Math.min(word.end, emphasis.t_end);
  const delay = Math.max(0, overlapStart - rangeStart) * timeScale;
  const duration = Math.max(0.01, (overlapEnd - overlapStart) * timeScale);
  const baseClass = `akari-caption__tok akari-caption__tok--emphasis akari-caption__tok--${style}`;

  if (style === EMPHASIS_STYLE_ONE_CHAR_BANG) {
    const characters = Array.from(word.text);
    const characterDuration = duration / characters.length;
    const markup = characters.map((character, index) => {
      const characterDelay = formatSeconds(delay + characterDuration * index);
      return `<span class="akari-caption__emphasis-char" style="--akari-emphasis-delay: ${characterDelay}s; --akari-emphasis-dur: ${formatSeconds(Math.max(0.01, characterDuration))}s">${escapeHtml(character)}</span>`;
    }).join("");
    return `<span class="${baseClass}" data-emphasis-id="${emphasis.id}">${markup}</span>`;
  }

  if (style === EMPHASIS_STYLE_SIZE_PULSE) {
    return `<span class="${baseClass}" data-emphasis-id="${emphasis.id}" style="--akari-emphasis-delay: ${formatSeconds(delay)}s; --akari-emphasis-dur: ${formatSeconds(duration)}s">${escapeHtml(word.text)}</span>`;
  }

  return `<span class="${baseClass}" data-emphasis-id="${emphasis.id}" style="color: var(--akari-emphasis-${emphasisColorName(emphasis.emotion)})">${escapeHtml(word.text)}</span>`;
}

function renderEmphasisCss() {
  return `
    .akari-caption {
      --akari-emphasis-joy: var(--vscode-akariTheme-accentLighter, #fdba74);
      --akari-emphasis-pain: var(--vscode-errorForeground, #ff798c);
      --akari-emphasis-surprise: var(--vscode-akariTheme-accentLight, #fb923c);
      --akari-emphasis-anger: var(--vscode-errorForeground, #ff798c);
      --akari-emphasis-sadness: var(--vscode-descriptionForeground, #a3a3a3);
      --akari-emphasis-emphasis: var(--vscode-akariTheme-accent, #f97316);
    }
    @keyframes akari-emphasis-one-char-bang {
      from { opacity: 0; transform: scale(1.6); }
      to { opacity: 1; transform: scale(1); }
    }
    @keyframes akari-emphasis-size-pulse {
      0% { transform: scale(1); }
      50% { transform: scale(1.25); }
      100% { transform: scale(1); }
    }
    .akari-caption__emphasis-char {
      display: inline-block;
      opacity: 0;
      animation: akari-emphasis-one-char-bang var(--akari-emphasis-dur, 0.1s) var(--akari-emphasis-delay, 0s) ease-out both paused;
    }
    .akari-caption__tok--size-pulse {
      animation: akari-emphasis-size-pulse var(--akari-emphasis-dur, 0.2s) var(--akari-emphasis-delay, 0s) ease-in-out both paused;
    }`;
}

function normalizeEmphasisWords(value) {
  if (!Array.isArray(value)) return [];
  const seenIds = new Set();
  const normalized = [];
  for (const item of value) {
    const valid = item !== null
      && typeof item === "object"
      && typeof item.id === "string"
      && /^e-\d{4}$/u.test(item.id)
      && !seenIds.has(item.id)
      && typeof item.t_start === "number"
      && Number.isFinite(item.t_start)
      && item.t_start >= 0
      && typeof item.t_end === "number"
      && Number.isFinite(item.t_end)
      && item.t_end > item.t_start
      && typeof item.word === "string"
      && /\S/u.test(item.word)
      && typeof item.emotion === "string"
      && /\S/u.test(item.emotion)
      && (item.src === undefined || (typeof item.src === "string" && /\S/u.test(item.src)))
      && (item.style_hint === undefined || typeof item.style_hint === "string");
    if (!valid) continue;
    seenIds.add(item.id);
    normalized.push(item);
  }
  return normalized;
}

function findMatchingEmphasis(word, emphasisWords) {
  return emphasisWords.find((emphasis) =>
    emphasis.t_end > word.start
      && emphasis.t_start < word.end
      && (word.text === emphasis.word || emphasis.word.includes(word.text)),
  );
}

function resolveEmphasisStyle(emphasis) {
  if (SUPPORTED_EMPHASIS_STYLES.has(emphasis.style_hint)) return emphasis.style_hint;
  if (emphasis.style_hint !== undefined) return EMPHASIS_STYLE_COLOR_ACCENT;
  if (["pain", "surprise", "anger"].includes(emphasis.emotion)) return EMPHASIS_STYLE_ONE_CHAR_BANG;
  if (["joy", "emphasis"].includes(emphasis.emotion)) return EMPHASIS_STYLE_SIZE_PULSE;
  return EMPHASIS_STYLE_COLOR_ACCENT;
}

function emphasisColorName(emotion) {
  return ["joy", "pain", "surprise", "anger", "sadness", "emphasis"].includes(emotion)
    ? emotion
    : "emphasis";
}

function formatSeconds(value) {
  return (Math.round(value * 1000) / 1000).toString();
}

export function splitCaptionLines(text, maximum = DEFAULT_MAX_CHARACTERS) {
  const limit = Number.isFinite(maximum) && maximum > 0 ? Math.floor(maximum) : DEFAULT_MAX_CHARACTERS;
  const explicit = String(text).split(/\r?\n/u);
  const lines = [];
  for (const value of explicit) {
    if (value.length === 0) {
      lines.push("");
      continue;
    }
    for (const segment of splitAfterPunctuation(value)) {
      lines.push(...splitAtNaturalBoundaries(segment, limit));
    }
  }
  return lines;
}

const CAPTION_BOUNDARIES = ["から", "まで", "ので", "のに", "けど", "て", "で", "は", "が", "を", "に", "へ", "と", "も", "の"];

function splitAfterPunctuation(value) {
  const characters = Array.from(value);
  const segments = [];
  let start = 0;
  for (let index = 0; index < characters.length; index += 1) {
    if ((characters[index] === "、" || characters[index] === "。") && index + 1 < characters.length) {
      segments.push(characters.slice(start, index + 1).join(""));
      start = index + 1;
    }
  }
  segments.push(characters.slice(start).join(""));
  return segments;
}

function splitAtNaturalBoundaries(value, maximum) {
  const lines = [];
  let remaining = Array.from(value);
  while (remaining.length > maximum) {
    const spaceBoundary = findLastSpaceBoundary(remaining, maximum);
    const phraseBoundary = spaceBoundary ?? findLastPhraseBoundary(remaining, maximum);
    const boundary = phraseBoundary ?? maximum;
    lines.push(remaining.slice(0, boundary).join(""));
    remaining = remaining.slice(boundary);
  }
  if (remaining.length > 0) lines.push(remaining.join(""));
  return lines;
}

function findLastSpaceBoundary(characters, maximum) {
  for (let index = maximum - 1; index > 0; index -= 1) {
    if (characters[index] === " " || characters[index] === "　") return index + 1;
  }
  return null;
}

function findLastPhraseBoundary(characters, maximum) {
  const prefix = characters.slice(0, maximum).join("");
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
