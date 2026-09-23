import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { computeCutTimelineOffsets, computeVideoRuns, cutSpeed, needsGapAwareCutTimeline, resolveCutSegments, segmentDuration } from "./cut-timeline.mjs";
import { CAPTION_FONT_FILE_URL } from "./caption-font.mjs";
import { predictedDuration } from "./plan.mjs";

// text_anchor / position → CSS 変数は共有カーネル単一定義（プレビューと同じ式で描く —
// packages/edit-store/src/caption-display.ts captionAnchorPositionVars 参照）。
const require = createRequire(import.meta.url);
// reference_height_px → scale（issue #40 §2）も同カーネル単一定義。GPU（gpu-export page-builder）と
// OSR（osr-export page-builder）は両方この generateCaptionOverlays の vars を使うので実効 px が揃う。
const {
  captionWindowSeconds,
  dedupeCaptionOccurrences,
  expandCaptionDisplayFragments,
  mergeCaptionLineTextStyles,
  normalizeCaptionClock,
  projectCaptionWords,
  resolveCaptionLineStyleVars,
  resolveCaptionStyleForOutput,
  resolveCaptionWordStyleVars,
  resolveCaptionStylePreset,
  TEXTSTYLE_CATALOG,
  usesExtendedPerLineBackground,
} = require("../../edit-store/lib/index.js");

const DEFAULT_MAX_CHARACTERS = 20;
// 縦長（output.height > output.width）の既定。横長より 1 行を短く・文字を大きくする
// （オーナー裁定 2026-08-03: 縦は 5〜10 文字級のチャンクを大きく順送りで見せる）。
const PORTRAIT_MAX_CHARACTERS = 10;
// 縦長の既定フォントサイズは出力幅比で決める（1080px 幅 → 65px）。
const PORTRAIT_FONT_SIZE_RATIO = 0.06;
const DEFAULT_FONT_SIZE_PX = 38;

// 焼き込みキャプションのフォント固定（win2-fonts-wire）。CI/Docker 等 Hiragino も Noto CJK も
// 無い/バージョン違いの環境でも同一グリフでレンダリングされるよう、同梱済み Noto Sans JP
// （win2-fonts-assets、assets/font/noto-sans-jp/、可変フォント 1 本）を @font-face で固定する。
// captions.mjs から見て ../../../ が repo root（packages/render-cut/src/ → render-cut → packages
// → repo root）。resolved caption は OS の同名フォントへ fall back しない固有 family alias を使う。
// compatibility caption は既存スナップショットのバイト互換性を保つため従来 family 名を維持する。
const CAPTION_FONT_STACK = '"Noto Sans JP", sans-serif';
const RESOLVED_CAPTION_FONT_STACK = '"AKARI Noto Sans JP", sans-serif';
const CAPTION_FONT_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../assets/font",
);
// 同梱フォント全家族を @font-face 宣言する（2026-08-03 textstyle v0: font_family ツマミ対応）。
// ブラウザは実際に使われる family しかフェッチしないため、全宣言を常に埋めてもコストは
// 参照分だけ。可変フォントは font-weight を範囲指定にして wght 軸を補間させる
// （範囲を省略すると単一ウェイトのみマッチし、font-weight:700 等が無視される）。
const BUNDLED_CAPTION_FONTS = [
  { family: "Noto Sans JP", file: "noto-sans-jp/NotoSansJP-Variable.ttf", weight: "100 900", variable: true },
  { family: "Noto Serif JP", file: "noto-serif-jp/NotoSerifJP-Variable.ttf", weight: "100 900", variable: true },
  { family: "M PLUS Rounded 1c", file: "mplus-rounded-1c/MPLUSRounded1c-Medium.ttf", weight: "500" },
  { family: "M PLUS Rounded 1c", file: "mplus-rounded-1c/MPLUSRounded1c-ExtraBold.ttf", weight: "800" },
  { family: "M PLUS Rounded 1c", file: "mplus-rounded-1c/MPLUSRounded1c-Black.ttf", weight: "900" },
  { family: "BIZ UDGothic", file: "biz-udgothic/BIZUDGothic-Regular.ttf", weight: "400" },
  { family: "BIZ UDGothic", file: "biz-udgothic/BIZUDGothic-Bold.ttf", weight: "700" },
  { family: "Dela Gothic One", file: "dela-gothic-one/DelaGothicOne-Regular.ttf", weight: "400" },
  { family: "Zen Maru Gothic", file: "zen-maru-gothic/ZenMaruGothic-Regular.ttf", weight: "400" },
  { family: "Zen Maru Gothic", file: "zen-maru-gothic/ZenMaruGothic-Bold.ttf", weight: "700" },
  { family: "Shippori Mincho", file: "shippori-mincho/ShipporiMincho-Regular.ttf", weight: "400" },
  { family: "DotGothic16", file: "dotgothic16/DotGothic16-Regular.ttf", weight: "400" },
  { family: "Klee One", file: "klee-one/KleeOne-Regular.ttf", weight: "400" },
];
// 既定出力（text_style なし）のバイト等価を守るため、従来どおりの単一 Noto 宣言を残す
const CAPTION_DEFAULT_FONT_FACE_CSS = `@font-face {
      font-family: "Noto Sans JP";
      src: url("${pathToFileURL(resolve(CAPTION_FONT_DIR, "noto-sans-jp/NotoSansJP-Variable.ttf")).href}") format("truetype-variations");
      font-weight: 100 900;
      font-style: normal;
    }`;
const CAPTION_FONT_FACE_CSS = BUNDLED_CAPTION_FONTS
  .map((font) => `@font-face {
      font-family: "${font.family}";
      src: url("${pathToFileURL(resolve(CAPTION_FONT_DIR, font.file)).href}") format("${font.variable ? "truetype-variations" : "truetype"}");
      font-weight: ${font.weight};
      font-style: normal;
    }`)
  .join("\n    ");
// resolved caption は OS の同名フォントへ fall back しない固有 family alias で単一 Noto に固定する。
// font-weight の 100 900 範囲指定は可変フォントの wght 軸を font-weight:700 等に補間させるため
// （範囲を省略すると単一ウェイトのみマッチする）。
const RESOLVED_CAPTION_FONT_FACE_CSS = `@font-face {
      font-family: "AKARI Noto Sans JP";
      src: url("${CAPTION_FONT_FILE_URL}") format("truetype-variations");
      font-weight: 100 900;
      font-style: normal;
    }`;

export const RESOLVED_CAPTION_WORD_PRESET_CSS = '.akari-caption__tok{display:inline-block;vertical-align:baseline;line-height:1;paint-order:stroke fill;white-space:pre;--caption-tok-color:initial;--caption-tok-font-size:initial;--caption-tok-font-family:initial;--caption-tok-font-weight:initial;--caption-tok-font-style:initial;--caption-tok-text-decoration:initial;--caption-tok-letter-spacing:initial;--caption-tok-line-height:initial;--caption-tok-text-transform:initial;--caption-tok-webkit-text-stroke:initial;--caption-tok-paint-order:initial;--caption-tok-text-shadow:initial;}.akari-caption__tok--preset{color:var(--caption-tok-color,inherit);font-size:var(--caption-tok-font-size,inherit);font-family:var(--caption-tok-font-family,inherit);font-weight:var(--caption-tok-font-weight,inherit);font-style:var(--caption-tok-font-style,inherit);text-decoration:var(--caption-tok-text-decoration,inherit);letter-spacing:var(--caption-tok-letter-spacing,inherit);line-height:var(--caption-tok-line-height,1);text-transform:var(--caption-tok-text-transform,inherit);-webkit-text-stroke:var(--caption-tok-webkit-text-stroke,inherit);paint-order:var(--caption-tok-paint-order,stroke fill);text-shadow:var(--caption-tok-text-shadow,inherit);}';

// opt-in word-level スタイル。横長では既定 = 未指定 = 従来のプレーン字幕（既定出力のバイト等価を保つ）。
// 縦長（portrait）だけは例外で、words[] があり複数行に折り返す字幕を reveal（行単位の順送り表示）へ
// 自動昇格させる（2026-08-03 オーナー要望: 縦で文章の壁を出さない）。words 未充填・未対応スタイル値は
// 従来どおり renderCaptionFragment に fall back する。
const KARAOKE_STYLE = "karaoke";
const POP_STYLE = "pop";
const REVEAL_STYLE = "reveal";
const REVEAL_WORD_STYLE = "reveal-word";
const SUPPORTED_WORD_STYLES = new Set([
  KARAOKE_STYLE,
  POP_STYLE,
  REVEAL_STYLE,
  REVEAL_WORD_STYLE,
]);
const EMPHASIS_STYLE_ONE_CHAR_BANG = "one-char-bang";
const EMPHASIS_STYLE_ONE_CHAR_JUMBLE = "one-char-jumble";
const EMPHASIS_STYLE_SIZE_PULSE = "size-pulse";
const EMPHASIS_STYLE_COLOR_ACCENT = "color-accent";
const EMPHASIS_STYLE_COLOR_ONLY = "color-only";
const EMPHASIS_STYLE_OUTLINE_BOLD = "outline-bold";
const EMPHASIS_STYLE_DANGER = "danger";
const EMPHASIS_STYLE_POSITIVE = "positive";
const EMPHASIS_STYLE_HIGHLIGHT = "highlight";
const SUPPORTED_EMPHASIS_STYLES = new Set([
  EMPHASIS_STYLE_ONE_CHAR_BANG,
  EMPHASIS_STYLE_ONE_CHAR_JUMBLE,
  EMPHASIS_STYLE_SIZE_PULSE,
  EMPHASIS_STYLE_COLOR_ACCENT,
  EMPHASIS_STYLE_COLOR_ONLY,
  EMPHASIS_STYLE_OUTLINE_BOLD,
  EMPHASIS_STYLE_DANGER,
  EMPHASIS_STYLE_POSITIVE,
  EMPHASIS_STYLE_HIGHLIGHT,
]);
// one-char-jumble の静的ジッター上限（オーナー目安「角度 ±8° から出発」に準拠）。
// --akari-jumble-amp（既定 1・0 でジッター無し）はこの上限に掛かる全体強度ツマミ。
const JUMBLE_MAX_ROTATE_DEG = 8;
const JUMBLE_MAX_OFFSET_EM = 0.1;
const JUMBLE_MAX_SCALE_AMP = 0.12;

export function generateCaptionOverlays(captions, cuts, options = {}) {
  // output（edit.output の {width,height}）が縦長なら、行を短く・文字を大きくする既定へ切り替える。
  // 明示指定（maxCharacters / text_style.size_px）は常に既定より優先。
  const output = options.output;
  const portrait = typeof output?.width === "number"
    && typeof output?.height === "number"
    && output.height > output.width;
  const baseFontSize = portrait
    ? Math.round(output.width * PORTRAIT_FONT_SIZE_RATIO)
    : DEFAULT_FONT_SIZE_PX;
  const emphasisWords = normalizeEmphasisWords(options.emphasisWords, output);
  const sourceCount = options.sourceCount ?? 1;
  const overlays = [];

  for (const caption of expandCaptionDisplayFragments(captions)) {
    const projectedCaption = projectCaptionWords(caption, cuts);
    if (!projectedCaption.renderable) continue;
    const displayText = projectedCaption.displayText;
    const captionSource = typeof caption.src === "string" && caption.src !== "" ? caption.src : null;
    if (captionSource === null && sourceCount > 1 && caption.time_domain !== "output") {
      options.onWarning?.(
        `captions.json item ${caption.id ?? "(unknown)"} omits src in a multi-source edit; skipped`,
      );
      continue;
    }
    const window = captionWindowSeconds(caption);
    const ranges = computeCaptionRanges(
      window.start,
      window.end,
      cuts,
      captionSource,
      caption.time_domain,
      caption.id,
    );
    let style = normalizeCaptionStyle(caption.style);
    const textStyle = mergeCaptionTextStyles(options.defaultTextStyle, caption.text_style);
    const maximum = textStyle?.max_characters
      ?? options.maxCharacters
      ?? (portrait ? PORTRAIT_MAX_CHARACTERS : DEFAULT_MAX_CHARACTERS);
    const textStyleVars = captionTextStyleVars(textStyle, output);
    const allWords = clipWordsToRange(projectedCaption.words, window.start, window.end);
    // 縦長の既定: 複数行へ折り返す長さの字幕は全行を一度に出さず、既存 reveal 機構で
    // 行単位に順送り表示する（words[] のタイミングが無い字幕は従来どおり静的表示）。
    if (
      portrait
      && style === null
      && allWords.length > 0
      && splitCaptionLines(displayText, maximum).length > 1
    ) {
      style = REVEAL_STYLE;
    }
    const wordText = allWords.map((word) => word.text).join("");
    const fullCoverage = wordText.replace(/\s/gu, "")
      === caption.text.replace(/\s/gu, "");
    const usesTimedRendering = style !== null || emphasisWords.length > 0;
    const mappedRendering = usesTimedRendering
      && (style === REVEAL_STYLE
        || displayText !== caption.text
        // Coverage ignores whitespace, but mapping still restores the exact display spaces.
        || (allWords.length > 0 && (!fullCoverage || wordText !== caption.text)));
    const warned = new Set();
    const warn = (code, message) => {
      if (warned.has(code)) return;
      warned.add(code);
      options.onWarning?.(message);
    };
    const displayTokens = mappedRendering && allWords.length > 0
      ? buildDisplayTokens(caption.text, displayText, allWords, (message) =>
          warn("display-mapping", `captions.json item ${caption.id ?? "(unknown)"} ${message}`),
          Boolean(captionCharRenderer(caption.animator)))
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
    if (style === REVEAL_WORD_STYLE && allWords.length === 0) {
      warn(
        "reveal-word-without-words",
        `captions.json item ${caption.id ?? "(unknown)"} requests reveal-word without words[]; rendered as plain text`,
      );
    }
    for (const [index, range] of ranges.entries()) {
      const words = style || emphasisWords.length > 0
        ? clipWordsToRange(projectedCaption.words, range.sourceStart, range.sourceEnd)
        : [];
      const hasEmphasis = words.some((word) => findMatchingEmphasis(word, emphasisWords));
      const rangeTokens = displayTokens
        ? clipDisplayTokensToRange(displayTokens, range.sourceStart, range.sourceEnd)
        : null;
      const captionAnimation = textStyle?.animation
        ? buildCaptionAnimation(textStyle.animation, range.duration, (message) =>
            warn("textanim", `captions.json item ${caption.id ?? "(unknown)"} ${message}`))
        : null;
      const html =
        words.length > 0 && (style || hasEmphasis)
          ? renderStyledCaptionFragment(words, style, {
              maximum,
              baseFontSize,
              rangeStart: range.sourceStart,
              rangeEnd: range.sourceEnd,
              emphasisTimeScale: range.emphasisTimeScale ?? 1,
              emphasisWords,
              displayTokens: rangeTokens,
              textStyleActive: textStyle !== null,
              backgroundMode: textStyle?.background?.mode,
              backgroundFit: textStyle?.background?.fit,
              extendedBackground: usesExtendedPerLineBackground(textStyle?.background),
              captionAnimation,
              animator: caption.animator,
              output,
            })
          : renderCaptionFragment(displayText, {
              maximum,
              baseFontSize,
              textStyleActive: textStyle !== null,
              backgroundMode: textStyle?.background?.mode,
              backgroundFit: textStyle?.background?.fit,
              extendedBackground: usesExtendedPerLineBackground(textStyle?.background),
              captionAnimation,
              animator: caption.animator,
              words: allWords,
            });
      overlays.push({
        id: `${caption.id}${caption.fragmentIndex ? `-f${caption.fragmentIndex}` : ""}-${String(index + 1).padStart(2, "0")}`,
        html,
        start: range.start,
        duration: range.duration,
        transform: captionTransform(),
        vars: { ...textStyleVars, ...captionTransformVars(textStyle) },
        generatedFrom: caption.id,
      });
    }
  }

  return overlays;
}

/**
 * Opt-in single-line policy renderer. Cues are already projected and split by
 * edit-store's Node kernel; this consumer never segments text again.
 */
export function generateResolvedCaptionOverlays(displayResult) {
  return displayResult.display_cues.map((cue) => ({
    id: cue.id,
    html: renderResolvedSingleLineCaption(cue.text, cue.display_lines, cue),
    start: cue.start,
    duration: cue.end - cue.start,
    transform: captionTransform(),
    vars: { ...(cue.style_vars ?? {}), ...captionTransformVars(cue.text_style) },
    generatedFrom: cue.source_cue_id,
    sourceCueId: cue.source_cue_id,
    displayCue: cue,
  }));
}

export function captionTransform(style) {
  const scale = finiteNumber(style?.scale) && style.scale >= 0.4 && style.scale <= 3 ? style.scale : 1;
  const rotate = finiteNumber(style?.rotate) && style.rotate >= -180 && style.rotate <= 180 ? style.rotate : 0;
  return { x: 0, y: 0, scale, rotate };
}

function captionTransformVars(style) {
  const { scale, rotate } = captionTransform(style);
  return {
    ...(scale !== 1 ? { "--caption-scale": String(scale) } : {}),
    ...(rotate !== 0 ? { "--caption-rotate": `${rotate}deg` } : {}),
  };
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function renderResolvedSingleLineCaption(text, lines, cue) {
  const hasWordStyles = Array.isArray(cue?.word_styles) && cue.word_styles.length > 0
    && Array.isArray(cue?.words) && cue.words.length > 0;
  const renderedText = hasWordStyles
    ? renderResolvedCaptionWords(cue.words, cue.word_styles)
    : Array.isArray(lines) && lines.length >= 2
      ? lines.map(escapeHtml).join('</p><p class="akari-caption__line">')
      : escapeHtml(text);
  const wordPresetCss = hasWordStyles ? `    ${RESOLVED_CAPTION_WORD_PRESET_CSS}\n` : '';
  const framePlateCss = cue?.style_vars?.['--caption-plate-fit'] === 'frame'
    ? `    .akari-caption--single-line .akari-caption__plate { left: 4%; right: 4%; width: auto; box-sizing: border-box; }
    .akari-caption--single-line .akari-caption__line { box-sizing: border-box; width: 100%; max-width: none; margin: 0; background: var(--plate-bg, var(--plate-ext-bg, transparent)); border-radius: var(--plate-radius, var(--plate-ext-radius, 0)); }
` : '';
  return `<div class="akari-caption akari-caption--single-line">
  <style>
    ${RESOLVED_CAPTION_FONT_FACE_CSS}
    .akari-caption--single-line {
      position:absolute;
      inset:0;
      pointer-events:none;
      color:var(--caption-color,#fff);
      text-shadow:var(--caption-text-shadow,-1.5px -1.5px 0 rgba(0,0,0,.85),1.5px -1.5px 0 rgba(0,0,0,.85),-1.5px 1.5px 0 rgba(0,0,0,.85),1.5px 1.5px 0 rgba(0,0,0,.85),0 0 8px rgba(0,0,0,.6));
      -webkit-text-stroke:var(--caption-webkit-text-stroke,0 transparent);
      paint-order:var(--caption-paint-order,stroke fill);
      font-family:var(--caption-font-family, ${RESOLVED_CAPTION_FONT_STACK});
      font-size:var(--caption-font-size,38px);
      font-style:var(--caption-font-style,normal);
      font-weight:var(--caption-font-weight,700);
      text-decoration:var(--caption-text-decoration,none);
      letter-spacing:var(--caption-letter-spacing,normal);
      text-transform:var(--caption-text-transform,none);
      line-height:var(--caption-word-line-height,var(--caption-line-height,1.42));
      writing-mode:var(--caption-writing-mode,horizontal-tb);
      text-align:center;
      animation:none;
      transform:none;
    }
    .akari-caption--single-line .akari-caption__plate {
      position:absolute;
      top:var(--caption-top,auto);
      translate:var(--caption-translate,none);
      left:var(--caption-left,0);
      right:var(--caption-right,0);
      bottom:var(--caption-bottom,7%);
      width:var(--caption-width,auto);
      max-width:100%;
      display:flex;
      flex-direction:column;
      justify-content:var(--caption-justify-content,flex-start);
      align-items:var(--caption-align-items,stretch);
      gap:0;
      padding:var(--plate-block-pad-y,0) var(--plate-block-pad-x,0);
      border-radius:var(--plate-block-radius,0);
      background:var(--plate-block-bg,transparent);
      animation:none;
      transform:rotate(var(--caption-rotate,0deg)) scale(var(--caption-scale,1));
      transform-origin:center;
    }
    .akari-caption--single-line .akari-caption__line {
      width:var(--caption-line-width,max-content);
      max-width:100%;
      margin:0 auto;
      padding:var(--plate-pad-y,0) var(--plate-pad-x,0);
      border-radius:var(--plate-radius,0);
      background:var(--plate-bg,transparent);
      text-align:var(--caption-text-align,center);
      white-space:nowrap;
      animation:none;
      transform:none;
    }
${wordPresetCss}${framePlateCss}  </style>
  <div class="akari-caption__plate"><p class="akari-caption__line">${renderedText}</p></div>
</div>`;
}

function renderResolvedCaptionWords(words, wordStyles) {
  let currentLine = words[0]?.line ?? 0;
  return words.map((word, index) => {
    const lineBreak = word.line !== currentLine
      ? '</p><p class="akari-caption__line">'
      : '';
    currentLine = word.line;
    const style = wordStyles.find(entry => entry.from <= index && index < entry.to);
    if (!style) return `${lineBreak}<span class="akari-caption__tok">${escapeHtml(word.text)}</span>`;
    return `${lineBreak}<span class="akari-caption__tok akari-caption__tok--preset" data-emphasis-preset="${escapeHtml(style.preset_id)}" style="${captionStyleVarsAttribute(style.style_vars)}">${escapeHtml(word.text)}</span>`;
  }).join('');
}

function captionStyleVarsAttribute(vars) {
  if (!vars || typeof vars !== 'object') return '';
  return Object.entries(vars)
    .filter(([name, value]) => name.startsWith('--') && typeof value === 'string')
    .map(([name, value]) => `${name}:${value};`)
    .join('')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function normalizeCaptionStyle(style) {
  return SUPPORTED_WORD_STYLES.has(style) ? style : null;
}

export const mergeCaptionTextStyles = mergeCaptionLineTextStyles;

/**
 * text_style → CSS 変数。`output`（{width,height}）を渡すと `reference_height_px`（issue #40 §2）
 * の scale = output.height / reference_height_px を宣言済みの px 系フィールド全部に掛ける
 * （size_px / stroke.width_px / shadow.blur_px / shadow.distance_px / glow.spread / glow.offset_x /
 * glow.offset_y / background.radius_px / padding_px / offset_x / offset_y）。宣言が無ければ scale = 1 で
 * 出力バイトは従来と同一。既定値（stroke 1.5 / glow spread 40 等）は宣言値ではないため掛けない
 * （カーネル resolveCaptionStyleForOutput の layout 経路と同じ扱い）。
 */
export const captionTextStyleVars = resolveCaptionLineStyleVars;

// --- テキストアニメーション語彙（presets/textanim・2026-08-03 textstyle v0） ---
// in / out / loop の 3 スロット（旧 video-on-os textAnimationAtf と同型）。
// out は in レシピの animation-direction: reverse（時間反転）で表現する。
// すべて paused + both で宣言し、rasterize の __akariSeek（getAnimations subtree）が
// currentTime を与える既存レール（karaoke / reveal と同一）に乗せる。
// 振幅ツマミ amp は距離・スケール系レシピ内の calc(var(--akari-anim-amp, 1) * …) に効く。
const DEFAULT_ANIMATION_DURATION_SEC = 0.6;
const DEFAULT_LOOP_PERIOD_SEC = 1.6;
const A = "var(--akari-anim-amp, 1)";
export const CAPTION_ANIMATION_RECIPES = {
  // フェード
  "fade-in-out": `from { opacity: 0; } to { opacity: 1; }`,
  "soft-fade": `from { opacity: 0; transform: scale(calc(1 + 0.04 * ${A})); } to { opacity: 1; transform: scale(1); }`,
  "fade-up": `from { opacity: 0; transform: translateY(calc(0.6em * ${A})); } to { opacity: 1; transform: translateY(0); }`,
  "fade-down": `from { opacity: 0; transform: translateY(calc(-0.6em * ${A})); } to { opacity: 1; transform: translateY(0); }`,
  "cinematic-fade": `from { opacity: 0; transform: scale(calc(1 - 0.06 * ${A})); } to { opacity: 1; transform: scale(1); }`,
  // スライド
  "slide-left": `from { opacity: 0; transform: translateX(calc(1.2em * ${A})); } to { opacity: 1; transform: translateX(0); }`,
  "slide-right": `from { opacity: 0; transform: translateX(calc(-1.2em * ${A})); } to { opacity: 1; transform: translateX(0); }`,
  "slide-up": `from { opacity: 0; transform: translateY(calc(1.2em * ${A})); } to { opacity: 1; transform: translateY(0); }`,
  "slide-down": `from { opacity: 0; transform: translateY(calc(-1.2em * ${A})); } to { opacity: 1; transform: translateY(0); }`,
  "push-left": `from { transform: translateX(calc(2em * ${A})); clip-path: inset(0 0 0 100%); } to { transform: translateX(0); clip-path: inset(0); }`,
  "push-right": `from { transform: translateX(calc(-2em * ${A})); clip-path: inset(0 100% 0 0); } to { transform: translateX(0); clip-path: inset(0); }`,
  "push-up": `from { transform: translateY(calc(1.4em * ${A})); clip-path: inset(100% 0 0 0); } to { transform: translateY(0); clip-path: inset(0); }`,
  "push-down": `from { transform: translateY(calc(-1.4em * ${A})); clip-path: inset(0 0 100% 0); } to { transform: translateY(0); clip-path: inset(0); }`,
  "rise-soft": `from { opacity: 0; transform: translateY(calc(0.35em * ${A})) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); }`,
  "drop-in": `0% { opacity: 0; transform: translateY(calc(-1.6em * ${A})); } 70% { opacity: 1; transform: translateY(calc(0.12em * ${A})); } 100% { opacity: 1; transform: translateY(0); }`,
  // ズーム
  "zoom-in-out": `from { opacity: 0; transform: scale(calc(1 - 0.4 * ${A})); } to { opacity: 1; transform: scale(1); }`,
  "zoom-pop": `0% { opacity: 0; transform: scale(0.4); } 70% { opacity: 1; transform: scale(calc(1 + 0.12 * ${A})); } 100% { opacity: 1; transform: scale(1); }`,
  "zoom-pulse": `0% { opacity: 0; transform: scale(0.7); } 55% { opacity: 1; transform: scale(calc(1 + 0.06 * ${A})); } 100% { opacity: 1; transform: scale(1); }`,
  // 弾性
  "pop": `0% { opacity: 0; transform: scale(0.5); } 65% { opacity: 1; transform: scale(calc(1 + 0.18 * ${A})); } 100% { opacity: 1; transform: scale(1); }`,
  "bounce": `0% { opacity: 0; transform: translateY(calc(-1.2em * ${A})); } 55% { opacity: 1; transform: translateY(calc(0.22em * ${A})); } 75% { transform: translateY(calc(-0.1em * ${A})); } 100% { opacity: 1; transform: translateY(0); }`,
  "squash-pop": `0% { opacity: 0; transform: scale(1.4, 0.4); } 60% { opacity: 1; transform: scale(0.92, 1.1); } 100% { opacity: 1; transform: scale(1); }`,
  "stretch-in": `0% { opacity: 0; transform: scaleX(0.2); } 70% { opacity: 1; transform: scaleX(calc(1 + 0.08 * ${A})); } 100% { opacity: 1; transform: scaleX(1); }`,
  "stomp": `0% { opacity: 0; transform: scale(calc(1 + 0.9 * ${A})); } 60% { opacity: 1; transform: scale(0.96); } 100% { opacity: 1; transform: scale(1); }`,
  "snap": `0% { opacity: 0; transform: rotate(calc(-6deg * ${A})) scale(0.8); } 70% { opacity: 1; transform: rotate(calc(2deg * ${A})) scale(1.04); } 100% { opacity: 1; transform: rotate(0) scale(1); }`,
  // 回転
  "rotate-in": `from { opacity: 0; transform: rotate(calc(-12deg * ${A})) scale(0.9); } to { opacity: 1; transform: rotate(0) scale(1); }`,
  "spin-in": `from { opacity: 0; transform: rotate(calc(-180deg * ${A})) scale(0.5); } to { opacity: 1; transform: rotate(0) scale(1); }`,
  "roll-in": `from { opacity: 0; transform: translateX(calc(-2em * ${A})) rotate(calc(-120deg * ${A})); } to { opacity: 1; transform: translateX(0) rotate(0); }`,
  "spiral-in": `from { opacity: 0; transform: rotate(calc(240deg * ${A})) scale(0.2); } to { opacity: 1; transform: rotate(0) scale(1); }`,
  "swing": `0% { opacity: 0; transform: rotate(calc(14deg * ${A})); transform-origin: top center; } 60% { opacity: 1; transform: rotate(calc(-6deg * ${A})); transform-origin: top center; } 100% { opacity: 1; transform: rotate(0); transform-origin: top center; }`,
  // 強調
  "shake": `0%, 100% { transform: translateX(0); } 20% { transform: translateX(calc(-0.16em * ${A})); } 40% { transform: translateX(calc(0.14em * ${A})); } 60% { transform: translateX(calc(-0.1em * ${A})); } 80% { transform: translateX(calc(0.06em * ${A})); }`,
  "jitter": `0%, 100% { transform: translate(0, 0); } 25% { transform: translate(calc(0.05em * ${A}), calc(-0.04em * ${A})); } 50% { transform: translate(calc(-0.05em * ${A}), calc(0.04em * ${A})); } 75% { transform: translate(calc(0.03em * ${A}), calc(0.05em * ${A})); }`,
  "glitch": `0% { opacity: 0; transform: translate(calc(-0.2em * ${A}), 0); clip-path: inset(0 0 60% 0); } 30% { opacity: 1; transform: translate(calc(0.12em * ${A}), 0); clip-path: inset(30% 0 20% 0); } 60% { transform: translate(calc(-0.06em * ${A}), 0); clip-path: inset(10% 0 45% 0); } 100% { opacity: 1; transform: translate(0, 0); clip-path: inset(0); }`,
  "flash": `0% { opacity: 0; } 30% { opacity: 1; } 45% { opacity: 0.2; } 60% { opacity: 1; } 75% { opacity: 0.5; } 100% { opacity: 1; }`,
  "heartbeat": `0% { transform: scale(1); } 25% { transform: scale(calc(1 + 0.12 * ${A})); } 45% { transform: scale(1); } 65% { transform: scale(calc(1 + 0.08 * ${A})); } 100% { transform: scale(1); }`,
  // 文字表示（ブロック近似 — 文字単位ではなく塗り出し）
  "typewriter": `from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); }`,
  "wipe-left": `from { clip-path: inset(0 0 0 100%); } to { clip-path: inset(0); }`,
  "wipe-right": `from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0); }`,
  // ループ
  "wobble": `0%, 100% { transform: rotate(calc(-1.6deg * ${A})); } 50% { transform: rotate(calc(1.6deg * ${A})); }`,
  "float": `0%, 100% { transform: translateY(0); } 50% { transform: translateY(calc(-0.22em * ${A})); }`,
  "breath": `0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(calc(1 + 0.03 * ${A})); opacity: 0.92; }`,
  "neon-flicker": `0%, 100% { opacity: 1; } 8% { opacity: 0.6; } 12% { opacity: 1; } 40% { opacity: 0.85; } 44% { opacity: 1; } 70% { opacity: 0.4; } 74% { opacity: 1; }`,
  "hologram": `0%, 100% { opacity: 1; transform: translateX(0); } 30% { opacity: 0.75; transform: translateX(calc(0.03em * ${A})); } 60% { opacity: 0.9; transform: translateX(calc(-0.03em * ${A})); }`,
  "retro-flicker": `0%, 100% { opacity: 1; } 25% { opacity: 0.7; } 50% { opacity: 1; } 75% { opacity: 0.8; }`,
  // テロップ
  "caption-rise": `from { opacity: 0; transform: translateY(calc(0.5em * ${A})); } to { opacity: 1; transform: translateY(0); }`,
  "news-ticker": `from { transform: translateX(100%); } to { transform: translateX(-100%); }`,
  "marquee-left": `from { transform: translateX(100%); } to { transform: translateX(-100%); }`,
  "crawl-up": `from { transform: translateY(100%); } to { transform: translateY(-100%); }`,
};
const LOOP_ANIMATION_IDS = new Set([
  "wobble", "float", "breath", "neon-flicker", "hologram", "retro-flicker",
  "news-ticker", "marquee-left", "crawl-up",
]);

// textStyle.animation → プレートに載せる animation プロパティ + 使用キーフレーム CSS。
// overlayDuration はこのオーバーレイ自身の表示秒（out の開始遅延に使う）。
export function buildCaptionAnimation(animation, overlayDuration, onWarning) {
  if (!animation || typeof animation !== "object") return null;
  const parts = [];
  const keyframes = new Map();
  const ampValues = [];

  const resolveSlot = (slot, kind) => {
    if (!slot) return;
    const recipe = CAPTION_ANIMATION_RECIPES[slot.id];
    if (!recipe) {
      onWarning?.(`unknown textanim id "${slot.id}" (${kind} slot); slot ignored`);
      return;
    }
    keyframes.set(slot.id, recipe);
    if (slot.amp !== undefined) ampValues.push(slot.amp);
    if (kind === "loop") {
      const period = slot.duration_sec ?? DEFAULT_LOOP_PERIOD_SEC;
      parts.push(`akari-anim-${slot.id} ${formatSeconds(period)}s linear 0s infinite both paused`);
      return;
    }
    const duration = Math.min(
      slot.duration_sec ?? DEFAULT_ANIMATION_DURATION_SEC,
      Math.max(0.05, overlayDuration),
    );
    const ease = slot.ease ?? "ease-out";
    if (kind === "in") {
      parts.push(`akari-anim-${slot.id} ${formatSeconds(duration)}s ${ease} 0s 1 normal both paused`);
    } else {
      const delay = Math.max(0, overlayDuration - duration);
      parts.push(`akari-anim-${slot.id} ${formatSeconds(duration)}s ${ease} ${formatSeconds(delay)}s 1 reverse forwards paused`);
    }
  };

  resolveSlot(animation.in, "in");
  resolveSlot(animation.loop, "loop");
  resolveSlot(animation.out, "out");
  if (parts.length === 0) return null;

  const keyframesCss = [...keyframes.entries()]
    .map(([id, recipe]) => `    @keyframes akari-anim-${id} { ${recipe} }`)
    .join("\n");
  return {
    animationCss: parts.join(", "),
    keyframesCss,
    // amp は全スロット共通の 1 変数（スロット別に分けたくなったら変数を分割する）
    ampCss: ampValues.length > 0 ? `--akari-anim-amp: ${ampValues[0]};` : "",
  };
}

// cuts 交差後の (timeline 秒) に加えて、当該レンジがカバーする (source 秒) の範囲も返す。
// words[] のクリップ・トークン遅延の基準点計算に使う内部形。公開 API
// (sourceRangeToTimeline) は既存の { start, duration } 形のみを返し続ける。
//
// task 2026-08-07-captions-linear-timeline: このカット境界オフセット計算はかつて
// v1（multi-source, generateCaptionOverlays が linearTimeline: true を渡す）向けに
// cuts.reduce() の素の累積和を自前で持っていたが、これは cut command /
// buildMultiSourceCutCommand が xfade 用に使う computeCutTimelineOffsets（cut-timeline.mjs）
// と同じ「順送りの区間積算」でありながら、cuts[].transition_out の重なり（オーバーラップ）を
// 一切減算しない別実装だった。v1 の transition_out 自体が render-cut 側で長らく no-op
// だったため無害だったが（task 2026-08-07-v1-transition-out で xfade を実装するまで）、
// 実装後は「動画は正しく縮むのに字幕だけ旧タイムラインに残る」という食い違いを生む
// （実測: 5 箇所の transition_out で計 0.9s 短縮されたのに captionsEnd は旧タイムライン
// のまま → computeContentDurationSeconds が captionsEnd を採用し、末尾に黒フレームが
// 追加された）。両実装は cuts と同じ index で参照されるだけの並列配列を返す点で同形なので、
// 常に computeCutTimelineOffsets(cuts) を使うよう統合する。
function computeCaptionRanges(start, end, cuts, sourceId = null, timeDomain = undefined, cueId = "caption") {
  if (timeDomain === "output") {
    const timelineEnd = Array.isArray(cuts) && cuts.length > 0 ? predictedDuration(cuts) : 0;
    const clampedEnd = Math.min(end, timelineEnd);
    return clampedEnd > start
      ? [{ start, duration: clampedEnd - start, sourceStart: start, sourceEnd: clampedEnd }]
      : [];
  }
  if (!Array.isArray(cuts) || cuts.length === 0) {
    return [{ start, duration: end - start, sourceStart: start, sourceEnd: end }];
  }

  if (needsGapAwareCutTimeline(cuts)) {
    const cutSegments = resolveCutSegments(cuts);
    const outputDuration = cutSegments.reduce((maximum, segment) => Math.max(maximum, segment.end), 0);
    const segments = computeVideoRuns(cutSegments, outputDuration).map((run) => {
      if (run.kind === "gap") {
        return { kind: "gap", outStart: run.outStart, outEnd: run.outEnd };
      }
      let winner = cutSegments.find(segment => segment.cut === run.cut);
      if (run.cut?.captions === "off") {
        const midpoint = (run.outStart + run.outEnd) / 2;
        winner = cutSegments
          .filter(segment => segment.start <= midpoint && segment.end > midpoint
            && segment.cut?.src === run.cut?.src && segment.cut?.captions !== "off")
          .sort((left, right) => right.track - left.track)[0];
      }
      if (!winner) return { kind: "gap", outStart: run.outStart, outEnd: run.outEnd };
      const speed = cutSpeed(winner.cut);
      return {
            kind: "src", outStart: run.outStart, outEnd: run.outEnd,
            src: winner.cut.src,
            in: winner.cut.in + (run.outStart - winner.start) * speed,
            out: winner.cut.in + (run.outEnd - winner.start) * speed,
            speed,
            cut: winner.cut,
          };
    });
    if (segments.length === 0) return [];
    // Share preview's projection over visible runs. Undeclared export cues remain source
    // cues; the preview's legacy gap-to-output heuristic must not promote them here.
    const occurrences = normalizeCaptionClock([{
      start, end, clockDomain: "source",
      ...(sourceId !== null ? { clockSourceId: sourceId } : {}),
    }], segments);
    const ranges = occurrences.map((occurrence) => {
      // Visible runs are disjoint and every occurrence is clipped to one run. Recover
      // its source window for word clipping and source-timed emphasis rendering.
      const midpoint = (occurrence.start + occurrence.end) / 2;
      const segment = segments.find((segment) => segment.kind === "src"
        && segment.outStart <= midpoint && midpoint < segment.outEnd);
      return {
        start: occurrence.start,
        duration: occurrence.end - occurrence.start,
        sourceStart: Math.max(start, segment.in),
        sourceEnd: Math.min(end, segment.out),
        emphasisTimeScale: 1 / segment.speed,
        track: Number.isInteger(segment.cut?.track) ? segment.cut.track : 0,
      };
    });
    return dedupeCaptionRanges(ranges, cueId, cuts);
  }

  const offsets = computeCutTimelineOffsets(cuts);
  const ranges = [];
  for (const [index, cut] of cuts.entries()) {
    if (cut.captions === "off") continue;
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
        track: Number.isInteger(cut.track) ? cut.track : 0,
        cutIndex: index,
      });
    }
  }
  return dedupeCaptionRanges(ranges, cueId, cuts);
}

function dedupeCaptionRanges(ranges, cueId, cuts) {
  const occurrences = ranges.map((range, index) => ({
    ...range,
    source_cue_id: String(cueId ?? "caption"),
    start: range.start,
    end: range.start + range.duration,
    source_start: range.sourceStart,
    source_end: range.sourceEnd,
    track: range.track ?? 0,
    rangeIndex: index,
  }));
  const trackOrder = [...new Set(cuts.map(cut => Number.isInteger(cut?.track) ? cut.track : 0))]
    .sort((left, right) => left - right);
  return dedupeCaptionOccurrences(occurrences, trackOrder).map((occurrence) => {
    const {
      source_cue_id: _sourceCueId,
      source_start: sourceStart,
      source_end: sourceEnd,
      end: occurrenceEnd,
      rangeIndex: _rangeIndex,
      ...range
    } = occurrence;
    return { ...range, duration: occurrenceEnd - occurrence.start, sourceStart, sourceEnd };
  });
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
  const baseFontSize = options.baseFontSize ?? DEFAULT_FONT_SIZE_PX;
  const platePlacementCss = options.textStyleActive
    ? `      top: var(--caption-top, auto);
      translate: var(--caption-translate, none);
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
  const fontFaceCss = options.textStyleActive ? CAPTION_FONT_FACE_CSS : CAPTION_DEFAULT_FONT_FACE_CSS;
  const typographyCss = options.textStyleActive
    ? `      font-family: var(--caption-font-family, ${CAPTION_FONT_STACK});
      font-size: var(--caption-font-size, ${baseFontSize}px);
      font-weight: var(--caption-font-weight, 700);
      font-style: var(--caption-font-style, normal);
      text-decoration: var(--caption-text-decoration, none);
      letter-spacing: var(--caption-letter-spacing, normal);
      text-transform: var(--caption-text-transform, none);
      line-height: var(--caption-line-height, 1.42);`
    : `      font-family: ${CAPTION_FONT_STACK};
      font-size: var(--caption-font-size, ${baseFontSize}px);
      font-weight: 700;
      line-height: 1.42;`;
  const writingModeCss = options.textStyleActive
    ? "      writing-mode: var(--caption-writing-mode, horizontal-tb);\n"
    : "";
  const plateAnimationCss = options.captionAnimation
    ? `${options.captionAnimation.ampCss ? `      ${options.captionAnimation.ampCss}\n` : ""}      animation: ${options.captionAnimation.animationCss};`
    : "      animation: akari-caption-fade 180ms ease-out both;";
  const animationKeyframesCss = options.captionAnimation
    ? `\n${options.captionAnimation.keyframesCss}`
    : "";
  const charText = captionCharRenderer(options.animator);
  const lines = splitCaptionLines(text, maximum, Boolean(charText));
  const markup = lines
    .map((line) => `<p class="akari-caption__line">${charText
      ? captionPlainWords(line, options.words).map(word => `<span class="akari-caption__tok">${charText(word)}</span>`).join("")
      : escapeHtml(line)}</p>`)
    .join("");
  const blockMode = options.backgroundMode === "block";
  const plateMarkup = blockMode
    ? `<div class="akari-caption__block">${markup}</div>`
    : markup;
  const blockPlateCss = blockMode
    ? `
    .akari-caption__block {
      display: flex;
      flex-direction: column;
      width: max-content;
      max-width: var(--caption-line-max-width, 92%);
      margin: var(--caption-line-margin, 0 auto);
      gap: var(--plate-gap, 4px);
      padding: var(--plate-pad-y, 0.08em) var(--plate-pad-x, 0.42em);
      border-radius: var(--plate-block-radius, 10px);
      background: var(--plate-block-bg, transparent);
    }
    .akari-caption__block .akari-caption__line {
      width: auto;
      max-width: none;
      margin: 0;
      padding: 0;
      border-radius: 0;
      background: transparent;
    }`
    : "";
  const extendedPlateCss = options.extendedBackground
    ? `
    .akari-caption__line {
      position: relative;
      isolation: isolate;
      padding: 0;
      border-radius: 0;
    }
    .akari-caption__line::before {
      content: "";
      position: absolute;
      inset: calc(0px - var(--plate-ext-height, 0px)) calc(0px - var(--plate-ext-width, 0px));
      z-index: -1;
      border-radius: var(--plate-ext-radius, 10px);
      background: var(--plate-ext-bg, transparent);
      transform: translate(var(--plate-offset-x, 0px), var(--plate-offset-y, 0px));
    }`
    : "";
  const framePlateCss = options.backgroundFit === "frame"
    ? `
    .akari-caption__plate { left: 4%; right: 4%; width: auto; }
    .akari-caption__line { box-sizing: border-box; width: 100%; max-width: none; margin: 0; }
    .akari-caption__line::before { left: 0; right: 0; }
    .akari-caption__block { box-sizing: border-box; width: 100%; max-width: none; margin: 0; }`
    : "";

  return `<div class="akari-caption">
  <style>
    ${fontFaceCss}
    .akari-caption {
      position: absolute;
      inset: 0;
      pointer-events: none;
      color: var(--caption-color, #fff);
      -webkit-text-stroke: var(--caption-stroke, 0.14em rgba(0,0,0,.9));
      paint-order: stroke fill;
      text-shadow: var(--caption-text-shadow, 0 2px 8px rgba(0,0,0,.35));
${typographyCss}
      text-align: center;
    }
    .akari-caption__plate {
      position: absolute;
${platePlacementCss}
      bottom: var(--caption-bottom, 7%);
      width: var(--caption-width, auto);
      display: flex;
      flex-direction: column;
${plateAlignmentCss}      gap: var(--plate-gap, 4px);
      opacity: 1;
      rotate: var(--caption-rotate, 0deg);
      scale: var(--caption-scale, 1);
      transform-origin: center;
${plateAnimationCss}
    }
    .akari-caption__line {
      width: max-content;
${linePlacementCss}
      padding: var(--plate-pad-y, 0.08em) var(--plate-pad-x, 0.42em);
      border-radius: var(--plate-radius, 10px);
      background: var(--plate-bg, transparent);
${lineTextAlignCss}      white-space: pre;
${writingModeCss}    }${blockPlateCss}${extendedPlateCss}${framePlateCss}
    @keyframes akari-caption-fade {
      from { opacity: 0; transform: translateY(0.18em); }
      to { opacity: 1; transform: translateY(0); }
    }${animationKeyframesCss}
  </style>
  <div class="akari-caption__plate">${plateMarkup}</div>
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
  const baseFontSize = options.baseFontSize ?? DEFAULT_FONT_SIZE_PX;
  const platePlacementCss = options.textStyleActive
    ? `      top: var(--caption-top, auto);
      translate: var(--caption-translate, none);
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
  const fontFaceCss = options.textStyleActive ? CAPTION_FONT_FACE_CSS : CAPTION_DEFAULT_FONT_FACE_CSS;
  const typographyCss = options.textStyleActive
    ? `      font-family: var(--caption-font-family, ${CAPTION_FONT_STACK});
      font-size: var(--caption-font-size, ${baseFontSize}px);
      font-weight: var(--caption-font-weight, 700);
      font-style: var(--caption-font-style, normal);
      text-decoration: var(--caption-text-decoration, none);
      letter-spacing: var(--caption-letter-spacing, normal);
      text-transform: var(--caption-text-transform, none);
      line-height: var(--caption-line-height, 1.42);`
    : `      font-family: ${CAPTION_FONT_STACK};
      font-size: var(--caption-font-size, ${baseFontSize}px);
      font-weight: 700;
      line-height: 1.42;`;
  const writingModeCss = options.textStyleActive
    ? "      writing-mode: var(--caption-writing-mode, horizontal-tb);\n"
    : "";
  const plateAnimationCss = options.captionAnimation
    ? `${options.captionAnimation.ampCss ? `      ${options.captionAnimation.ampCss}\n` : ""}      animation: ${options.captionAnimation.animationCss};`
    : "      animation: akari-caption-fade 180ms ease-out both;";
  const animationKeyframesCss = options.captionAnimation
    ? `\n${options.captionAnimation.keyframesCss}`
    : "";
  const rangeStart = options.rangeStart ?? 0;
  const rangeEnd = options.rangeEnd ?? Math.max(rangeStart, ...words.map((word) => word.end));
  const emphasisTimeScale = options.emphasisTimeScale ?? 1;
  const normalizedStyle = SUPPORTED_WORD_STYLES.has(style) ? style : null;
  const emphasisWords = normalizeEmphasisWords(options.emphasisWords, options.output);
  const renderTokens = Array.isArray(options.displayTokens)
    ? options.displayTokens
    : words.map((word) => ({ ...word, sourceText: word.text, untimed: false }));
  const hasEmphasis = renderTokens.some(
    (word) => !word.untimed && findMatchingEmphasis(word, emphasisWords),
  );
  const hasPresetEmphasis = renderTokens.some((word) => {
    const emphasis = !word.untimed && findMatchingEmphasis(word, emphasisWords);
    return Boolean(emphasis?._presetStyleVars);
  });
  const effectiveStyle = normalizedStyle ?? (hasEmphasis ? null : KARAOKE_STYLE);
  const rootStyle = effectiveStyle ?? "emphasis";
  const useMappedLines = Array.isArray(options.displayTokens) || effectiveStyle === REVEAL_STYLE;
  const charText = captionCharRenderer(options.animator);
  const lines = useMappedLines
    ? groupDisplayTokensIntoLines(renderTokens, maximum, Boolean(charText))
    : groupWordsIntoLines(words, maximum);
  const renderLine = (line) => line
    .map((word) => renderCaptionToken(
      word,
      rangeStart,
      effectiveStyle,
      emphasisWords,
      emphasisTimeScale,
      charText,
    ))
    .join("");
  const markup = effectiveStyle === REVEAL_STYLE
    ? renderRevealGroups(lines, rangeStart, rangeEnd, emphasisTimeScale, renderLine)
    : lines
        .map((line) => `<p class="akari-caption__line">${renderLine(line)}</p>`)
        .join("");
  const blockMode = options.backgroundMode === "block";
  const plateMarkup = blockMode
    ? `<div class="akari-caption__block">${markup}</div>`
    : markup;
  const blockPlateCss = blockMode
    ? `
    .akari-caption__block {
      display: flex;
      flex-direction: column;
      width: max-content;
      max-width: var(--caption-line-max-width, 92%);
      margin: var(--caption-line-margin, 0 auto);
      gap: var(--plate-gap, 4px);
      padding: var(--plate-pad-y, 0.08em) var(--plate-pad-x, 0.42em);
      border-radius: var(--plate-block-radius, 10px);
      background: var(--plate-block-bg, transparent);
    }
    .akari-caption__block .akari-caption__line {
      width: auto;
      max-width: none;
      margin: 0;
      padding: 0;
      border-radius: 0;
      background: transparent;
    }`
    : "";
  const extendedPlateCss = options.extendedBackground
    ? `
    .akari-caption__line {
      position: relative;
      isolation: isolate;
      padding: 0;
      border-radius: 0;
    }
    .akari-caption__line::before {
      content: "";
      position: absolute;
      inset: calc(0px - var(--plate-ext-height, 0px)) calc(0px - var(--plate-ext-width, 0px));
      z-index: -1;
      border-radius: var(--plate-ext-radius, 10px);
      background: var(--plate-ext-bg, transparent);
      transform: translate(var(--plate-offset-x, 0px), var(--plate-offset-y, 0px));
    }`
    : "";
  const framePlateCss = options.backgroundFit === "frame"
    ? `
    .akari-caption__plate { left: 4%; right: 4%; width: auto; }
    .akari-caption__line { box-sizing: border-box; width: 100%; max-width: none; margin: 0; }
    .akari-caption__line::before { left: 0; right: 0; }
    .akari-caption__block { box-sizing: border-box; width: 100%; max-width: none; margin: 0; }`
    : "";

  const emphasisCss = hasEmphasis ? renderEmphasisCss() : "";
  const revealWordCss = effectiveStyle === REVEAL_WORD_STYLE ? renderRevealWordCss() : "";
  const revealCss = effectiveStyle === REVEAL_STYLE ? renderRevealCss() : "";

  return `<div class="akari-caption akari-caption--${rootStyle}">
  <style>
    ${fontFaceCss}
    .akari-caption {
      position: absolute;
      inset: 0;
      pointer-events: none;
      color: var(--caption-color, #fff);
      -webkit-text-stroke: var(--caption-stroke, 0.14em rgba(0,0,0,.9));
      paint-order: stroke fill;
      text-shadow: var(--caption-text-shadow, 0 2px 8px rgba(0,0,0,.35));
${typographyCss}
      text-align: center;
    }
    .akari-caption__plate {
      position: absolute;
${platePlacementCss}
      bottom: var(--caption-bottom, 7%);
      width: var(--caption-width, auto);
      display: flex;
      flex-direction: column;
${plateAlignmentCss}      gap: var(--plate-gap, 4px);
      opacity: 1;
      rotate: var(--caption-rotate, 0deg);
      scale: var(--caption-scale, 1);
      transform-origin: center;
${plateAnimationCss}
    }
    .akari-caption__line {
      width: max-content;
${linePlacementCss}
      padding: var(--plate-pad-y, 0.08em) var(--plate-pad-x, 0.42em);
      border-radius: var(--plate-radius, 10px);
      background: var(--plate-bg, transparent);
${lineTextAlignCss}      white-space: pre;
${writingModeCss}    }${blockPlateCss}${extendedPlateCss}${framePlateCss}
    .akari-caption__tok {
      display: inline-block;
      vertical-align: baseline;
      line-height: 1;
      paint-order: stroke fill;
      will-change: transform, color;
    }
    @keyframes akari-caption-fade {
      from { opacity: 0; transform: translateY(0.18em); }
      to { opacity: 1; transform: translateY(0); }
    }${animationKeyframesCss}
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
    }${revealWordCss}${revealCss}${emphasisCss}${hasPresetEmphasis ? RESOLVED_CAPTION_WORD_PRESET_CSS : ''}
  </style>
  <div class="akari-caption__plate">${plateMarkup}</div>
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

function buildDisplayTokens(sourceText, displayText, words, onMappingFallback, graphemes = false) {
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
      return buildProportionalDisplayTokens(displayText, words, graphemes);
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

function buildProportionalDisplayTokens(displayText, words, graphemes = false) {
  const characters = graphemes ? captionGraphemes(displayText) : Array.from(displayText);
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
function groupDisplayTokensIntoLines(tokens, maximum, graphemes = false) {
  if (tokens.length === 0) return [];
  const charactersOf = graphemes ? captionGraphemes : Array.from;
  const text = tokens.map((token) => token.text).join("");
  const desiredLines = splitCaptionLines(text, maximum, graphemes);
  const desiredBoundaries = [];
  let desiredOffset = 0;
  for (const line of desiredLines.slice(0, -1)) {
    desiredOffset += charactersOf(line).length;
    desiredBoundaries.push(desiredOffset);
  }

  const tokenRanges = [];
  let tokenOffset = 0;
  for (const token of tokens) {
    const start = tokenOffset;
    tokenOffset += charactersOf(token.text).length;
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
        const characters = charactersOf(token.text);
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
      /* プレートは通常 flex-column で、水平の寄せは align-items（cross 軸）が担う。
         reveal は複数行グループを同一セルへ重ねるため grid へ切り替えるが、grid の
         align-items は block 軸にしか効かないので、そのままだと水平の寄せが失われて
         左端に張り付く（暗黙トラックが内容幅へシュリンクするため）。トラック自体の
         配置は justify-content の管轄なので、同じ変数をここへも渡して寄せを維持する
         （--caption-align-items の値 flex-start/center/flex-end はいずれも
         justify-content の正当な値）。 */
      justify-content: var(--caption-align-items, stretch);
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

function renderRevealWordCss() {
  return `
    @keyframes akari-caption-reveal-word {
      0% { opacity: 0; }
      100% { opacity: 1; }
    }
    .akari-caption__tok--reveal-word {
      animation: akari-caption-reveal-word 0.01s var(--akari-tok-delay, 0s) linear both paused;
    }`;
}

function renderCaptionToken(word, rangeStart, style, emphasisWords = [], emphasisTimeScale = 1, charText = null) {
  const text = charText ?? escapeHtml;
  if (word.untimed) {
    return `<span class="akari-caption__tok akari-caption__tok--unlit">${text(word.text)}</span>`;
  }
  if (style === REVEAL_WORD_STYLE) {
    const delay = formatSeconds(Math.max(0, word.start - rangeStart));
    return `<span class="akari-caption__tok akari-caption__tok--reveal-word" style="--akari-tok-delay: ${delay}s">${text(word.text)}</span>`;
  }
  const emphasis = findMatchingEmphasis(word, emphasisWords);
  // 語レベル演出は caption の karaoke/pop より該当 token だけ優先する。
  if (emphasis) return renderEmphasisCaptionToken(word, rangeStart, emphasis, emphasisTimeScale, charText);

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
  return `<span class="${className}" style="${vars}">${text(word.text)}</span>`;
}

function renderEmphasisCaptionToken(word, rangeStart, emphasis, timeScale, charText = null) {
  const text = charText ?? escapeHtml;
  if (emphasis._presetStyleVars) {
    return `<span class="akari-caption__tok akari-caption__tok--emphasis akari-caption__tok--preset" data-emphasis-id="${escapeHtml(emphasis.id)}" data-emphasis-preset="${escapeHtml(emphasis.style_preset)}" style="${captionStyleVarsAttribute(emphasis._presetStyleVars)}">${text(word.text)}</span>`;
  }
  const style = resolveEmphasisStyle(emphasis);
  const overlapStart = Math.max(word.start, emphasis.t_start);
  const overlapEnd = Math.min(word.end, emphasis.t_end);
  const delay = Math.max(0, overlapStart - rangeStart) * timeScale;
  const duration = Math.max(0.01, (overlapEnd - overlapStart) * timeScale);
  const baseClass = `akari-caption__tok akari-caption__tok--emphasis akari-caption__tok--${style}`;

  if (style === EMPHASIS_STYLE_ONE_CHAR_BANG || style === EMPHASIS_STYLE_ONE_CHAR_JUMBLE) {
    // one-char-jumble は one-char-bang の per-char 順次登場をそのまま再利用し（同一クラス・
    // 同一キーフレーム）、各文字に静的ジッター（rotate/translate/scale の個別プロパティ）を
    // 追加で乗せるだけ。--akari-jumble-amp が 0 のとき jitterSuffix の 3 プロパティは恒等値へ
    // 潰れるため、amp=0 の出力は one-char-bang と画素等価になる。
    const jumble = style === EMPHASIS_STYLE_ONE_CHAR_JUMBLE;
    const characters = charText ? captionGraphemes(word.text) : Array.from(word.text);
    const characterDuration = duration / characters.length;
    const markup = characters.map((character, index) => {
      const characterDelay = formatSeconds(delay + characterDuration * index);
      const jitterSuffix = jumble ? `; ${renderJumbleCharJitter(emphasis.id, index)}` : "";
      return `<span class="akari-caption__emphasis-char" style="--akari-emphasis-delay: ${characterDelay}s; --akari-emphasis-dur: ${formatSeconds(Math.max(0.01, characterDuration))}s${jitterSuffix}">${text(character)}</span>`;
    }).join("");
    return `<span class="${baseClass}" data-emphasis-id="${emphasis.id}">${markup}</span>`;
  }

  if (style === EMPHASIS_STYLE_SIZE_PULSE) {
    return `<span class="${baseClass}" data-emphasis-id="${emphasis.id}" style="--akari-emphasis-delay: ${formatSeconds(delay)}s; --akari-emphasis-dur: ${formatSeconds(duration)}s">${text(word.text)}</span>`;
  }

  if (style === EMPHASIS_STYLE_COLOR_ONLY) {
    return `<span class="${baseClass}" data-emphasis-id="${emphasis.id}" style="color: var(--akari-emphasis-color-only, var(--vscode-akariTheme-accent, #f97316))">${text(word.text)}</span>`;
  }

  if (style === EMPHASIS_STYLE_OUTLINE_BOLD) {
    return `<span class="${baseClass}" data-emphasis-id="${emphasis.id}">${text(word.text)}</span>`;
  }

  if (style === EMPHASIS_STYLE_DANGER
    || style === EMPHASIS_STYLE_POSITIVE
    || style === EMPHASIS_STYLE_HIGHLIGHT) {
    return `<span class="${baseClass}" data-emphasis-id="${emphasis.id}">${text(word.text)}</span>`;
  }

  return `<span class="${baseClass}" data-emphasis-id="${emphasis.id}" style="color: var(--akari-emphasis-${emphasisColorName(emphasis.emotion)})">${text(word.text)}</span>`;
}

// FNV-1a 32bit — 暗号用途ではなく one-char-jumble の決定論シード生成専用。
// 同一文字列は常に同一ハッシュを返すため Math.random 抜きで再現可能な擬似乱数が作れる。
function fnv1a32(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// ハッシュ値を [-1, 1) の決定論的な擬似乱数へ正規化する。
function jumbleSignedUnit(seed) {
  return (fnv1a32(seed) / 0x100000000) * 2 - 1;
}

function jumbleRound(value) {
  return Math.round(value * 1000) / 1000;
}

// emphasis.id + 文字 index をシードに、文字ごとの静的ジッター（角度・縦位置・拡大率）を
// 個別プロパティ（rotate/translate/scale）として生成する。transform を書き換える
// one-char-bang の登場キーフレームとは別プロパティなので、seek-safe な WAAPI 変換
// （rasterize.mjs の getAnimations({subtree:true}) 経由）と衝突しない。
function renderJumbleCharJitter(emphasisId, index) {
  const rotateDeg = jumbleRound(jumbleSignedUnit(`${emphasisId}:${index}:rotate`) * JUMBLE_MAX_ROTATE_DEG);
  const offsetEm = jumbleRound(jumbleSignedUnit(`${emphasisId}:${index}:offset`) * JUMBLE_MAX_OFFSET_EM);
  const scaleAmp = jumbleRound(jumbleSignedUnit(`${emphasisId}:${index}:scale`) * JUMBLE_MAX_SCALE_AMP);
  return `rotate: calc(${rotateDeg}deg * var(--akari-jumble-amp, 1)); `
    + `translate: 0 calc(${offsetEm}em * var(--akari-jumble-amp, 1)); `
    + `scale: calc(1 + ${scaleAmp} * var(--akari-jumble-amp, 1))`;
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
      -webkit-text-stroke: var(--akari-emphasis-outline-stroke, 0.2em rgba(17,17,17,.95));
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

function normalizeEmphasisWords(value, output) {
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
      && (item.style_hint === undefined || typeof item.style_hint === "string")
      && (item.style_preset === undefined || typeof item.style_preset === "string");
    if (!valid) continue;
    seenIds.add(item.id);
    if (item._presetStyleVars && typeof item._presetStyleVars === "object") {
      normalized.push(item);
      continue;
    }
    const preset = typeof item.style_preset === "string" && item.style_preset.length > 0
      ? resolveCaptionStylePreset({ style_preset: item.style_preset }, TEXTSTYLE_CATALOG)
      : null;
    normalized.push(preset?.resolved
      ? { ...item, _presetStyleVars: resolveCaptionWordStyleVars(preset.record.text_style, output) }
      : item);
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
  // disgust（生理的に無理・きつい系）は one-char-jumble を既定にする（2026-08-05 方針メモ §1）。
  if (emphasis.emotion === "disgust") return EMPHASIS_STYLE_ONE_CHAR_JUMBLE;
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

function captionGraphemes(text) {
  return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(String(text)), part => part.segment);
}

function captionCharRenderer(animators) {
  if (!Array.isArray(animators) || !animators.some(a => a?.basis === "chars")) return null;
  let index = 0;
  return text => captionGraphemes(text).map(char =>
    `<span class="akari-caption__char" data-akari-char="${index++}">${escapeHtml(char)}</span>`).join("");
}

// Keep declared word boundaries when available, including whitespace between words.
function captionPlainWords(text, words) {
  const result = [];
  let cursor = 0;
  for (const word of words ?? []) {
    if (!word.text) continue;
    const at = text.indexOf(word.text, cursor);
    if (at < 0) continue;
    if (at > cursor) result.push(text.slice(cursor, at));
    result.push(word.text);
    cursor = at + word.text.length;
  }
  if (cursor < text.length) {
    result.push(...Array.from(new Intl.Segmenter(undefined, { granularity: "word" }).segment(text.slice(cursor)), part => part.segment));
  }
  return result;
}

export function splitCaptionLines(text, maximum = DEFAULT_MAX_CHARACTERS, graphemes = false) {
  const limit = Number.isFinite(maximum) && maximum > 0 ? Math.floor(maximum) : DEFAULT_MAX_CHARACTERS;
  const explicit = String(text).split(/\r?\n/u);
  const lines = [];
  for (const value of explicit) {
    if (value.length === 0) {
      lines.push("");
      continue;
    }
    for (const segment of splitAfterPunctuation(value)) {
      lines.push(...splitAtNaturalBoundaries(segment, limit, graphemes));
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

function splitAtNaturalBoundaries(value, maximum, graphemes = false) {
  const lines = [];
  let remaining = graphemes ? captionGraphemes(value) : Array.from(value);
  while (remaining.length > maximum) {
    const spaceBoundary = findLastSpaceBoundary(remaining, maximum);
    const phraseBoundary = spaceBoundary ?? findLastPhraseBoundary(remaining, maximum, graphemes);
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

function findLastPhraseBoundary(characters, maximum, graphemes = false) {
  const prefix = characters.slice(0, maximum).join("");
  let best = null;
  for (const boundary of CAPTION_BOUNDARIES) {
    const index = prefix.lastIndexOf(boundary);
    if (index >= 0) {
      const part = prefix.slice(0, index + boundary.length);
      const candidate = (graphemes ? captionGraphemes(part) : Array.from(part)).length;
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
