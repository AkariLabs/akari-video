import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { computeCutTimelineOffsets, cutSpeed, segmentDuration } from "./cut-timeline.mjs";

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
const REVEAL_STYLE = "reveal";
const SUPPORTED_WORD_STYLES = new Set([KARAOKE_STYLE, POP_STYLE, REVEAL_STYLE]);
const EMPHASIS_STYLE_ONE_CHAR_BANG = "one-char-bang";
const EMPHASIS_STYLE_SIZE_PULSE = "size-pulse";
const EMPHASIS_STYLE_COLOR_ACCENT = "color-accent";
const EMPHASIS_STYLE_COLOR_ONLY = "color-only";
const EMPHASIS_STYLE_OUTLINE_BOLD = "outline-bold";
const EMPHASIS_STYLE_DANGER = "danger";
const EMPHASIS_STYLE_POSITIVE = "positive";
const EMPHASIS_STYLE_HIGHLIGHT = "highlight";
const SUPPORTED_EMPHASIS_STYLES = new Set([
  EMPHASIS_STYLE_ONE_CHAR_BANG,
  EMPHASIS_STYLE_SIZE_PULSE,
  EMPHASIS_STYLE_COLOR_ACCENT,
  EMPHASIS_STYLE_COLOR_ONLY,
  EMPHASIS_STYLE_OUTLINE_BOLD,
  EMPHASIS_STYLE_DANGER,
  EMPHASIS_STYLE_POSITIVE,
  EMPHASIS_STYLE_HIGHLIGHT,
]);

export function generateCaptionOverlays(captions, cuts, options = {}) {
  const maximum = options.maxCharacters ?? DEFAULT_MAX_CHARACTERS;
  const emphasisWords = normalizeEmphasisWords(options.emphasisWords);
  const sourceCount = options.sourceCount ?? 1;
  const linearTimeline = options.linearTimeline === true;
  const overlays = [];

  for (const caption of captions) {
    const displayText = typeof caption.display_text === "string"
      ? caption.display_text
      : caption.text;
    const captionSource = typeof caption.src === "string" && caption.src !== "" ? caption.src : null;
    if (captionSource === null && sourceCount > 1) {
      options.onWarning?.(
        `captions.json item ${caption.id ?? "(unknown)"} omits src in a multi-source edit; skipped`,
      );
      continue;
    }
    const ranges = computeCaptionRanges(
      caption.start,
      caption.end,
      cuts,
      captionSource,
      linearTimeline,
    );
    const style = normalizeCaptionStyle(caption.style);
    const textStyle = mergeCaptionTextStyles(options.defaultTextStyle, caption.text_style);
    const textStyleVars = captionTextStyleVars(textStyle);
    const allWords = clipWordsToRange(caption.words, caption.start, caption.end);
    const fullCoverage = allWords.map((word) => word.text).join("") === caption.text;
    const usesTimedRendering = style !== null || emphasisWords.length > 0;
    const mappedRendering = usesTimedRendering
      && (style === REVEAL_STYLE
        || displayText !== caption.text
        || (allWords.length > 0 && !fullCoverage));
    const warned = new Set();
    const warn = (code, message) => {
      if (warned.has(code)) return;
      warned.add(code);
      options.onWarning?.(message);
    };
    const displayTokens = mappedRendering && allWords.length > 0
      ? buildDisplayTokens(caption.text, displayText, allWords, (message) =>
          warn("display-mapping", `captions.json item ${caption.id ?? "(unknown)"} ${message}`))
      : null;
    if (displayTokens?.some((token) => token.untimed)) {
      warn(
        "partial-word-cover",
        `captions.json item ${caption.id ?? "(unknown)"} has text not covered by words[]; rendered as unlit text`,
      );
    }
    if (style === REVEAL_STYLE && allWords.length === 0) {
      warn(
        "reveal-without-words",
        `captions.json item ${caption.id ?? "(unknown)"} requests reveal without words[]; rendered as plain text`,
      );
    }
    for (const [index, range] of ranges.entries()) {
      const words = style || emphasisWords.length > 0
        ? clipWordsToRange(caption.words, range.sourceStart, range.sourceEnd)
        : [];
      const hasEmphasis = words.some((word) => findMatchingEmphasis(word, emphasisWords));
      const rangeTokens = displayTokens
        ? clipDisplayTokensToRange(displayTokens, range.sourceStart, range.sourceEnd)
        : null;
      const html =
        words.length > 0 && (style || hasEmphasis)
          ? renderStyledCaptionFragment(words, style, {
              maximum,
              rangeStart: range.sourceStart,
              rangeEnd: range.sourceEnd,
              emphasisTimeScale: range.emphasisTimeScale ?? 1,
              emphasisWords,
              displayTokens: rangeTokens,
              textStyleActive: textStyle !== null,
            })
          : renderCaptionFragment(displayText, { maximum, textStyleActive: textStyle !== null });
      overlays.push({
        id: `${caption.id}-${String(index + 1).padStart(2, "0")}`,
        html,
        start: range.start,
        duration: range.duration,
        transform: { x: 0, y: 0, scale: 1, rotate: 0 },
        vars: textStyleVars,
        generatedFrom: caption.id,
      });
    }
  }

  return overlays;
}

function normalizeCaptionStyle(style) {
  return SUPPORTED_WORD_STYLES.has(style) ? style : null;
}

export function mergeCaptionTextStyles(defaultStyle, captionStyle) {
  const base = normalizeTextStyle(defaultStyle);
  const override = normalizeTextStyle(captionStyle);
  const merged = {
    ...base,
    ...override,
    ...((base.stroke || override.stroke)
      ? { stroke: { ...base.stroke, ...override.stroke } } : {}),
    ...((base.background || override.background)
      ? { background: { ...base.background, ...override.background } } : {}),
  };
  if (merged.stroke && Object.keys(merged.stroke).length === 0) delete merged.stroke;
  if (merged.background && Object.keys(merged.background).length === 0) delete merged.background;
  return Object.keys(merged).length > 0 ? merged : null;
}

export function captionTextStyleVars(style) {
  if (!style || typeof style !== "object") return {};
  const vars = {};
  if (typeof style.color === "string") {
    vars["--caption-color"] = style.color;
  }
  if (typeof style.size_px === "number" && Number.isFinite(style.size_px)) {
    vars["--caption-font-size"] = `${style.size_px}px`;
  }
  if (style.stroke && (typeof style.stroke.color === "string"
    || (typeof style.stroke.width_px === "number" && Number.isFinite(style.stroke.width_px)))) {
    vars["--caption-text-shadow"] = strokeShadow(
      typeof style.stroke.color === "string" ? style.stroke.color : "rgba(0,0,0,.85)",
      typeof style.stroke.width_px === "number" && Number.isFinite(style.stroke.width_px)
        ? style.stroke.width_px : 1.5,
    );
  }
  if (style.background && (typeof style.background.color === "string"
    || (typeof style.background.opacity === "number" && Number.isFinite(style.background.opacity)))) {
    vars["--plate-bg"] = colorWithOpacity(
      typeof style.background.color === "string" ? style.background.color : "#000000",
      typeof style.background.opacity === "number" && Number.isFinite(style.background.opacity)
        ? style.background.opacity : undefined,
    );
  }
  if (typeof style.background?.radius_px === "number"
    && Number.isFinite(style.background.radius_px)) {
    vars["--plate-radius"] = `${style.background.radius_px}px`;
  }
  Object.assign(vars, zoneVars(style.zone));
  return vars;
}

function normalizeTextStyle(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return {
    ...(typeof value.color === "string" ? { color: value.color } : {}),
    ...(typeof value.size_px === "number" && Number.isFinite(value.size_px)
      ? { size_px: value.size_px } : {}),
    ...(value.stroke && typeof value.stroke === "object" && !Array.isArray(value.stroke)
      ? {
          stroke: {
            ...(typeof value.stroke.color === "string" ? { color: value.stroke.color } : {}),
            ...(typeof value.stroke.width_px === "number" && Number.isFinite(value.stroke.width_px)
              ? { width_px: value.stroke.width_px } : {}),
          },
        } : {}),
    ...(value.background && typeof value.background === "object" && !Array.isArray(value.background)
      ? {
          background: {
            ...(typeof value.background.color === "string" ? { color: value.background.color } : {}),
            ...(typeof value.background.opacity === "number" && Number.isFinite(value.background.opacity)
              ? { opacity: value.background.opacity } : {}),
            ...(typeof value.background.radius_px === "number"
              && Number.isFinite(value.background.radius_px)
              ? { radius_px: value.background.radius_px } : {}),
          },
        } : {}),
    ...(typeof value.zone === "string" ? { zone: value.zone } : {}),
  };
}

function strokeShadow(color, width) {
  const negative = width === 0 ? "0" : `-${width}px`;
  const positive = width === 0 ? "0" : `${width}px`;
  return `${negative} ${negative} 0 ${color}, ${positive} ${negative} 0 ${color}, `
    + `${negative} ${positive} 0 ${color}, ${positive} ${positive} 0 ${color}, `
    + "0 0 8px rgba(0,0,0,.6)";
}

function colorWithOpacity(color, explicitOpacity) {
  const raw = color.slice(1);
  const expanded = raw.length === 3
    ? raw.split("").map((character) => character + character).join("")
    : raw;
  const rgb = expanded.slice(0, 6).padEnd(6, "0");
  const alphaFromColor = expanded.length === 8 ? parseInt(expanded.slice(6, 8), 16) / 255 : 1;
  const alpha = explicitOpacity ?? alphaFromColor;
  return `rgba(${parseInt(rgb.slice(0, 2), 16)},${parseInt(rgb.slice(2, 4), 16)},`
    + `${parseInt(rgb.slice(4, 6), 16)},${Number(alpha.toFixed(4))})`;
}

function zoneVars(zone) {
  if (!zone || zone === "bottom") return {};
  const [vertical, horizontal] = zone.includes("-")
    ? zone.split("-")
    : zone === "top" || zone === "center"
      ? [zone, "center"]
      : ["center", zone];
  return {
    "--caption-top": vertical === "top" ? "7%" : vertical === "center" ? "0" : "auto",
    "--caption-bottom": vertical === "bottom" ? "7%" : vertical === "center" ? "0" : "auto",
    "--caption-left": "4%",
    "--caption-right": "4%",
    "--caption-justify-content": vertical === "center" ? "center" : "flex-start",
    "--caption-align-items": horizontal === "left"
      ? "flex-start" : horizontal === "right" ? "flex-end" : "center",
    "--caption-line-margin": "0",
    "--caption-line-max-width": "100%",
    "--caption-text-align": horizontal,
  };
}

// cuts 交差後の (timeline 秒) に加えて、当該レンジがカバーする (source 秒) の範囲も返す。
// words[] のクリップ・トークン遅延の基準点計算に使う内部形。公開 API
// (sourceRangeToTimeline) は既存の { start, duration } 形のみを返し続ける。
function computeCaptionRanges(start, end, cuts, sourceId = null, linearTimeline = false) {
  if (!Array.isArray(cuts) || cuts.length === 0) {
    return [{ start, duration: end - start, sourceStart: start, sourceEnd: end }];
  }

  const offsets = linearTimeline
    ? cuts.reduce((result, cut) => {
        const previous = result[result.length - 1];
        result.push({
          start: previous ? previous.start + previous.duration : 0,
          duration: segmentDuration(cut),
        });
        return result;
      }, [])
    : computeCutTimelineOffsets(cuts);
  const ranges = [];
  for (const [index, cut] of cuts.entries()) {
    if (sourceId !== null && cut.src !== sourceId) continue;
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
  const platePlacementCss = options.textStyleActive
    ? `      top: var(--caption-top, auto);
      left: var(--caption-left, 0);
      right: var(--caption-right, 0);`
    : `      left: 0;
      right: 0;`;
  const plateAlignmentCss = options.textStyleActive
    ? `      justify-content: var(--caption-justify-content, flex-start);
      align-items: var(--caption-align-items, stretch);
`
    : "";
  const linePlacementCss = options.textStyleActive
    ? `      max-width: var(--caption-line-max-width, 92%);
      margin: var(--caption-line-margin, 0 auto);`
    : `      max-width: 92%;
      margin: 0 auto;`;
  const lineTextAlignCss = options.textStyleActive
    ? "      text-align: var(--caption-text-align, center);\n"
    : "";
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
${platePlacementCss}
      bottom: var(--caption-bottom, 7%);
      display: flex;
      flex-direction: column;
${plateAlignmentCss}      gap: var(--plate-gap, 4px);
      opacity: 1;
      animation: akari-caption-fade 180ms ease-out both;
    }
    .akari-caption__line {
      width: max-content;
${linePlacementCss}
      padding: var(--plate-pad-y, 0.08em) var(--plate-pad-x, 0.42em);
      border-radius: var(--plate-radius, 10px);
      background: var(--plate-bg, transparent);
${lineTextAlignCss}      white-space: pre;
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
  const platePlacementCss = options.textStyleActive
    ? `      top: var(--caption-top, auto);
      left: var(--caption-left, 0);
      right: var(--caption-right, 0);`
    : `      left: 0;
      right: 0;`;
  const plateAlignmentCss = options.textStyleActive
    ? `      justify-content: var(--caption-justify-content, flex-start);
      align-items: var(--caption-align-items, stretch);
`
    : "";
  const linePlacementCss = options.textStyleActive
    ? `      max-width: var(--caption-line-max-width, 92%);
      margin: var(--caption-line-margin, 0 auto);`
    : `      max-width: 92%;
      margin: 0 auto;`;
  const lineTextAlignCss = options.textStyleActive
    ? "      text-align: var(--caption-text-align, center);\n"
    : "";
  const rangeStart = options.rangeStart ?? 0;
  const rangeEnd = options.rangeEnd ?? Math.max(rangeStart, ...words.map((word) => word.end));
  const emphasisTimeScale = options.emphasisTimeScale ?? 1;
  const normalizedStyle = SUPPORTED_WORD_STYLES.has(style) ? style : null;
  const emphasisWords = normalizeEmphasisWords(options.emphasisWords);
  const renderTokens = Array.isArray(options.displayTokens)
    ? options.displayTokens
    : words.map((word) => ({ ...word, sourceText: word.text, untimed: false }));
  const hasEmphasis = renderTokens.some(
    (word) => !word.untimed && findMatchingEmphasis(word, emphasisWords),
  );
  const effectiveStyle = normalizedStyle ?? (hasEmphasis ? null : KARAOKE_STYLE);
  const rootStyle = effectiveStyle ?? "emphasis";
  const useMappedLines = Array.isArray(options.displayTokens) || effectiveStyle === REVEAL_STYLE;
  const lines = useMappedLines
    ? groupDisplayTokensIntoLines(renderTokens, maximum)
    : groupWordsIntoLines(words, maximum);
  const renderLine = (line) => line
    .map((word) => renderCaptionToken(
      word,
      rangeStart,
      effectiveStyle,
      emphasisWords,
      emphasisTimeScale,
    ))
    .join("");
  const markup = effectiveStyle === REVEAL_STYLE
    ? renderRevealGroups(lines, rangeStart, rangeEnd, emphasisTimeScale, renderLine)
    : lines
        .map((line) => `<p class="akari-caption__line">${renderLine(line)}</p>`)
        .join("");

  const emphasisCss = hasEmphasis ? renderEmphasisCss() : "";
  const revealCss = effectiveStyle === REVEAL_STYLE ? renderRevealCss() : "";

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
${platePlacementCss}
      bottom: var(--caption-bottom, 7%);
      display: flex;
      flex-direction: column;
${plateAlignmentCss}      gap: var(--plate-gap, 4px);
      opacity: 1;
      animation: akari-caption-fade 180ms ease-out both;
    }
    .akari-caption__line {
      width: max-content;
${linePlacementCss}
      padding: var(--plate-pad-y, 0.08em) var(--plate-pad-x, 0.42em);
      border-radius: var(--plate-radius, 10px);
      background: var(--plate-bg, transparent);
${lineTextAlignCss}      white-space: pre;
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
    }${revealCss}${emphasisCss}
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

function normalizeMatchKey(text) {
  return text.normalize("NFKC").toLowerCase();
}

// text の各 UTF-16 code unit を個別に正規化して連結し、正規化後の文字列と、
// 「正規化後の何文字目までが元の何文字目に対応するか」の境界配列を返す。
// (境界配列の長さは text.length + 1。boundaries[i] = 元の先頭 i 文字を正規化して連結した長さ)
function buildNormalizedTextIndex(text) {
  let normalized = "";
  const boundaries = [0];
  for (let i = 0; i < text.length; i += 1) {
    normalized += normalizeMatchKey(text[i]);
    boundaries.push(normalized.length);
  }
  return { normalized, boundaries };
}

// 正規化後インデックスを元の文字列インデックスへ写像する
// (boundaries は単調増加。normalizedIndex 以上になる最小の境界を二分探索で探す)
function mapNormalizedIndexToOriginal(boundaries, normalizedIndex) {
  let lo = 0;
  let hi = boundaries.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (boundaries[mid] < normalizedIndex) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function buildDisplayTokens(sourceText, displayText, words, onMappingFallback) {
  const tokens = [];
  let cursor = 0;
  const displayIndex = buildNormalizedTextIndex(displayText);
  for (const [wordIndex, word] of words.entries()) {
    const normalizedWordText = normalizeMatchKey(word.text);
    const normalizedCursor = displayIndex.boundaries[cursor];
    const foundNorm = displayIndex.normalized.indexOf(
      normalizedWordText,
      normalizedCursor,
    );
    if (foundNorm < 0) {
      onMappingFallback?.(
        "display_text could not be aligned to text/words[]; used proportional timing fallback",
      );
      return buildProportionalDisplayTokens(displayText, words);
    }
    const found = mapNormalizedIndexToOriginal(
      displayIndex.boundaries,
      foundNorm,
    );
    const foundEnd = mapNormalizedIndexToOriginal(
      displayIndex.boundaries,
      foundNorm + normalizedWordText.length,
    );
    if (found > cursor) {
      tokens.push({
        text: displayText.slice(cursor, found),
        untimed: true,
        previousWordIndex: wordIndex - 1,
        nextWordIndex: wordIndex,
      });
    }
    tokens.push({
      ...word,
      text: displayText.slice(found, foundEnd),
      sourceText: word.text,
      untimed: false,
      wordIndex,
    });
    cursor = foundEnd;
  }
  if (cursor < displayText.length) {
    tokens.push({
      text: displayText.slice(cursor),
      untimed: true,
      previousWordIndex: words.length - 1,
      nextWordIndex: words.length,
    });
  }

  // sourceText は表示用文字列へ置換しても timing の正本として保持する。ここでは直接マッチに
  // 成功しているため未使用だが、引数を明示して display_text が text を上書きしないことを示す。
  void sourceText;
  return tokens;
}

function buildProportionalDisplayTokens(displayText, words) {
  const characters = Array.from(displayText);
  const weights = words.map((word) => Math.max(1, Array.from(word.text).length));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const tokens = [];
  let consumedWeight = 0;
  let previousBoundary = 0;
  for (const [wordIndex, word] of words.entries()) {
    consumedWeight += weights[wordIndex];
    const boundary = wordIndex === words.length - 1
      ? characters.length
      : Math.round((characters.length * consumedWeight) / totalWeight);
    const text = characters.slice(previousBoundary, boundary).join("");
    if (text !== "") {
      tokens.push({
        ...word,
        text,
        sourceText: word.text,
        untimed: false,
        wordIndex,
      });
    }
    previousBoundary = boundary;
  }
  return tokens;
}

function clipDisplayTokensToRange(tokens, rangeStart, rangeEnd) {
  const includedWordIndices = new Set(
    tokens
      .filter((token) =>
        !token.untimed && token.end > rangeStart && token.start < rangeEnd)
      .map((token) => token.wordIndex),
  );
  return tokens.flatMap((token) => {
    if (token.untimed) {
      const adjacent = includedWordIndices.has(token.previousWordIndex)
        || includedWordIndices.has(token.nextWordIndex);
      return adjacent ? [{ ...token }] : [];
    }
    if (!includedWordIndices.has(token.wordIndex)) return [];
    return [{
      ...token,
      start: Math.max(token.start, rangeStart),
      end: Math.min(token.end, rangeEnd),
    }];
  });
}

// splitCaptionLines を唯一の優先順位（句読点 → 空白 → 文節境界 → 文字上限）として使い、
// その分割点が発話 word の中なら最寄りの word 境界へスナップする。通常は 20±2 字に収まり、
// それを超える単一 word だけは表示完全性を優先して分割しない。
function groupDisplayTokensIntoLines(tokens, maximum) {
  if (tokens.length === 0) return [];
  const text = tokens.map((token) => token.text).join("");
  const desiredLines = splitCaptionLines(text, maximum);
  const desiredBoundaries = [];
  let desiredOffset = 0;
  for (const line of desiredLines.slice(0, -1)) {
    desiredOffset += Array.from(line).length;
    desiredBoundaries.push(desiredOffset);
  }

  const tokenRanges = [];
  let tokenOffset = 0;
  for (const token of tokens) {
    const start = tokenOffset;
    tokenOffset += Array.from(token.text).length;
    tokenRanges.push({ token, start, end: tokenOffset });
  }

  const boundaries = [];
  let previous = 0;
  for (const desired of desiredBoundaries) {
    const containing = tokenRanges.find(({ start, end }) => start < desired && desired < end);
    let snapped = desired;
    if (containing && !containing.token.untimed) {
      const candidates = [containing.start, containing.end]
        .filter((candidate) => candidate > previous && candidate < tokenOffset);
      const withinTolerance = candidates.filter(
        (candidate) => candidate - previous <= maximum + 2,
      );
      const eligible = withinTolerance.length > 0 ? withinTolerance : candidates;
      if (eligible.length === 0) continue;
      snapped = eligible.reduce((best, candidate) =>
        Math.abs(candidate - desired) < Math.abs(best - desired) ? candidate : best);
    }
    if (snapped > previous && snapped < tokenOffset) {
      boundaries.push(snapped);
      previous = snapped;
    }
  }

  const intervals = [];
  let start = 0;
  for (const end of [...boundaries, tokenOffset]) {
    const line = [];
    for (const { token, start: tokenStart, end: tokenEnd } of tokenRanges) {
      const overlapStart = Math.max(start, tokenStart);
      const overlapEnd = Math.min(end, tokenEnd);
      if (overlapEnd <= overlapStart) continue;
      if (!token.untimed) {
        line.push(token);
      } else {
        const characters = Array.from(token.text);
        line.push({
          ...token,
          text: characters
            .slice(overlapStart - tokenStart, overlapEnd - tokenStart)
            .join(""),
        });
      }
    }
    if (line.length > 0) intervals.push(line);
    start = end;
  }
  return intervals;
}

function renderRevealGroups(lines, rangeStart, rangeEnd, timeScale, renderLine) {
  const starts = lines.map((line, index) => {
    const ownStart = line.find((token) => !token.untimed)?.start;
    if (ownStart !== undefined) return ownStart;
    for (let next = index + 1; next < lines.length; next += 1) {
      const nextStart = lines[next].find((token) => !token.untimed)?.start;
      if (nextStart !== undefined) return nextStart;
    }
    return index > 0 ? null : rangeStart;
  });
  for (let index = 0; index < starts.length; index += 1) {
    if (starts[index] === null) starts[index] = starts[index - 1] ?? rangeStart;
  }

  const groups = [];
  for (const [index, line] of lines.entries()) {
    const start = starts[index] ?? rangeStart;
    const previous = groups.at(-1);
    if (previous && previous.start === start) {
      previous.lines.push(line);
    } else {
      groups.push({ start, lines: [line] });
    }
  }

  return groups.map((group, index) => {
    const nextStart = groups[index + 1]?.start ?? rangeEnd;
    const delay = Math.max(0, group.start - rangeStart) * timeScale;
    const duration = Math.max(0.01, nextStart - group.start) * timeScale;
    const lineMarkup = group.lines
      .map((line) => `<p class="akari-caption__line">${renderLine(line)}</p>`)
      .join("");
    return `<div class="akari-caption__reveal-group" style="--akari-reveal-delay: ${formatSeconds(delay)}s; --akari-reveal-dur: ${formatSeconds(duration)}s">${lineMarkup}</div>`;
  }).join("");
}

function renderRevealCss() {
  return `
    .akari-caption--reveal .akari-caption__plate {
      display: grid;
      animation: none;
    }
    .akari-caption__reveal-group {
      grid-area: 1 / 1;
      display: flex;
      flex-direction: column;
      gap: var(--plate-gap, 4px);
      opacity: 0;
      animation: akari-caption-reveal var(--akari-reveal-dur, 0.2s) var(--akari-reveal-delay, 0s) linear both paused;
    }
    @keyframes akari-caption-reveal {
      0% { opacity: 0; transform: translateY(0.18em); }
      12% { opacity: 1; transform: translateY(0); }
      99.99% { opacity: 1; transform: translateY(0); }
      100% { opacity: 0; transform: translateY(0); }
    }`;
}

function renderCaptionToken(word, rangeStart, style, emphasisWords = [], emphasisTimeScale = 1) {
  if (word.untimed) {
    return `<span class="akari-caption__tok akari-caption__tok--unlit">${escapeHtml(word.text)}</span>`;
  }
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

  if (style === EMPHASIS_STYLE_COLOR_ONLY) {
    return `<span class="${baseClass}" data-emphasis-id="${emphasis.id}" style="color: var(--akari-emphasis-color-only, var(--vscode-akariTheme-accent, #f97316))">${escapeHtml(word.text)}</span>`;
  }

  if (style === EMPHASIS_STYLE_OUTLINE_BOLD) {
    return `<span class="${baseClass}" data-emphasis-id="${emphasis.id}">${escapeHtml(word.text)}</span>`;
  }

  if (style === EMPHASIS_STYLE_DANGER
    || style === EMPHASIS_STYLE_POSITIVE
    || style === EMPHASIS_STYLE_HIGHLIGHT) {
    return `<span class="${baseClass}" data-emphasis-id="${emphasis.id}">${escapeHtml(word.text)}</span>`;
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
    }
    .akari-caption__tok--outline-bold {
      font-weight: var(--akari-emphasis-outline-weight, 900);
      text-shadow: var(--akari-emphasis-outline, -2px -2px 0 #111, 2px -2px 0 #111, -2px 2px 0 #111, 2px 2px 0 #111);
    }
    .akari-caption__tok--danger {
      color: var(--akari-emphasis-danger, var(--vscode-errorForeground, #ff5c72));
      font-weight: var(--akari-emphasis-danger-weight, 850);
    }
    .akari-caption__tok--positive {
      color: var(--akari-emphasis-positive, var(--vscode-testing-iconPassed, #45c86f));
      font-weight: var(--akari-emphasis-positive-weight, 800);
    }
    .akari-caption__tok--highlight {
      color: var(--akari-emphasis-highlight, var(--vscode-akariTheme-accentLighter, #ffd94a));
      font-weight: var(--akari-emphasis-highlight-weight, 800);
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
  const wordText = word.sourceText ?? word.text;
  const normalizedWordText = normalizeMatchKey(wordText);
  return emphasisWords.find((emphasis) => {
    const normalizedEmphasisWord = normalizeMatchKey(emphasis.word);
    return emphasis.t_end > word.start
      && emphasis.t_start < word.end
      && (normalizedWordText === normalizedEmphasisWord
        || normalizedEmphasisWord.includes(normalizedWordText));
  });
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
