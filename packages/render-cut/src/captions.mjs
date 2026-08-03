import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { computeCutTimelineOffsets, cutSpeed, segmentDuration } from "./cut-timeline.mjs";

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
// → repo root）。preview（akari-preview-open-handler.ts）にも同一のフォントスタック文字列
// '"Noto Sans JP", sans-serif' を使うが、両パッケージ間に依存関係が無い（render-cut は
// CLI パッケージ、akari-preview は Electron 拡張で互いを import しない）ため定数の共有はせず、
// 文字列を意図的に重複させている（判断は report に記録）。
const CAPTION_FONT_STACK = '"Noto Sans JP", sans-serif';
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

// opt-in word-level スタイル。横長では既定 = 未指定 = 従来のプレーン字幕（既定出力のバイト等価を保つ）。
// 縦長（portrait）だけは例外で、words[] があり複数行に折り返す字幕を reveal（行単位の順送り表示）へ
// 自動昇格させる（2026-08-03 オーナー要望: 縦で文章の壁を出さない）。words 未充填・未対応スタイル値は
// 従来どおり renderCaptionFragment に fall back する。
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
  // output（edit.output の {width,height}）が縦長なら、行を短く・文字を大きくする既定へ切り替える。
  // 明示指定（maxCharacters / text_style.size_px）は常に既定より優先。
  const output = options.output;
  const portrait = typeof output?.width === "number"
    && typeof output?.height === "number"
    && output.height > output.width;
  const maximum = options.maxCharacters
    ?? (portrait ? PORTRAIT_MAX_CHARACTERS : DEFAULT_MAX_CHARACTERS);
  const baseFontSize = portrait
    ? Math.round(output.width * PORTRAIT_FONT_SIZE_RATIO)
    : DEFAULT_FONT_SIZE_PX;
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
    let style = normalizeCaptionStyle(caption.style);
    const textStyle = mergeCaptionTextStyles(options.defaultTextStyle, caption.text_style);
    const textStyleVars = captionTextStyleVars(textStyle);
    const allWords = clipWordsToRange(caption.words, caption.start, caption.end);
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
              extendedBackground: usesExtendedPerLineBackground(textStyle?.background),
              captionAnimation,
            })
          : renderCaptionFragment(displayText, {
              maximum,
              baseFontSize,
              textStyleActive: textStyle !== null,
              backgroundMode: textStyle?.background?.mode,
              extendedBackground: usesExtendedPerLineBackground(textStyle?.background),
              captionAnimation,
            });
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
  };
  for (const key of ["stroke", "background", "shadow", "glow", "position", "animation"]) {
    if (base[key] || override[key]) {
      merged[key] = { ...base[key], ...override[key] };
      if (Object.keys(merged[key]).length === 0) delete merged[key];
    }
  }
  return Object.keys(merged).length > 0 ? merged : null;
}

export function captionTextStyleVars(style) {
  if (!style || typeof style !== "object") return {};
  const vars = {};
  const extendedBackground = usesExtendedPerLineBackground(style.background);
  const percentageBackground = usesPercentageBackground(style.background);
  if (typeof style.color === "string") {
    vars["--caption-color"] = style.color;
  }
  if (typeof style.size_px === "number" && Number.isFinite(style.size_px)) {
    vars["--caption-font-size"] = `${style.size_px}px`;
  }
  if (style.stroke && (typeof style.stroke.color === "string"
    || (typeof style.stroke.width_px === "number" && Number.isFinite(style.stroke.width_px)))) {
    // -webkit-text-stroke はグリフ輪郭の中心に乗るので、外側に width_px 見えるよう 2 倍を指定する
    // （paint-order: stroke fill で塗りが上に乗り、内側半分は隠れる）。
    const strokeWidth = typeof style.stroke.width_px === "number"
      && Number.isFinite(style.stroke.width_px)
      ? style.stroke.width_px : 1.5;
    const strokeColor = typeof style.stroke.color === "string"
      ? style.stroke.color : "rgba(0,0,0,.9)";
    vars["--caption-stroke"] = `${strokeWidth * 2}px ${strokeColor}`;
  }
  if (style.background && (typeof style.background.color === "string"
    || (typeof style.background.opacity === "number" && Number.isFinite(style.background.opacity)))) {
    const backgroundVariable = style.background.mode === "block"
      ? "--plate-block-bg" : extendedBackground ? "--plate-ext-bg" : "--plate-bg";
    vars[backgroundVariable] = colorWithOpacity(
      typeof style.background.color === "string" ? style.background.color : "#000000",
      typeof style.background.opacity === "number" && Number.isFinite(style.background.opacity)
        ? style.background.opacity : undefined,
    );
  }
  if (typeof style.background?.radius_px === "number"
    && Number.isFinite(style.background.radius_px)) {
    const radiusVariable = style.background.mode === "block"
      ? "--plate-block-radius" : extendedBackground ? "--plate-ext-radius" : "--plate-radius";
    vars[radiusVariable] = `${style.background.radius_px}px`;
  }
  // --- 2026-08-03 textstyle v0 拡張 ---
  if (typeof style.font_family === "string") {
    vars["--caption-font-family"] = style.font_family;
  }
  if (typeof style.weight === "number") {
    vars["--caption-font-weight"] = String(style.weight);
  }
  if (style.italic) vars["--caption-font-style"] = "italic";
  if (style.underline) vars["--caption-text-decoration"] = "underline";
  if (typeof style.letter_spacing_em === "number") {
    vars["--caption-letter-spacing"] = `${style.letter_spacing_em}em`;
  }
  if (typeof style.line_height === "number") {
    vars["--caption-line-height"] = String(style.line_height);
  }
  if (typeof style.text_transform === "string") {
    vars["--caption-text-transform"] = style.text_transform;
  }
  if (typeof style.max_width_pct === "number") {
    vars["--caption-line-max-width"] = `${style.max_width_pct}%`;
  }
  if (style.vertical) vars["--caption-writing-mode"] = "vertical-rl";
  if (extendedBackground) {
    const horizontalExpansion = percentageBackground
      ? `${style.background.width_pct ?? 0}%`
      : `${style.background.padding_px ?? 0}px`;
    const verticalExpansion = percentageBackground
      ? `${style.background.height_pct ?? 0}%`
      : `${style.background.padding_px ?? 0}px`;
    vars["--plate-ext-width"] = horizontalExpansion;
    vars["--plate-ext-height"] = verticalExpansion;
    if (typeof style.background.offset_x === "number") {
      vars["--plate-offset-x"] = `${style.background.offset_x}px`;
    }
    if (typeof style.background.offset_y === "number") {
      vars["--plate-offset-y"] = `${style.background.offset_y}px`;
    }
  } else if (typeof style.background?.padding_px === "number") {
    vars["--plate-pad-y"] = `${style.background.padding_px}px`;
    vars["--plate-pad-x"] = `${style.background.padding_px}px`;
  }
  const textShadow = captionTextShadowValue(style.shadow, style.glow);
  if (textShadow !== null) {
    vars["--caption-text-shadow"] = textShadow;
  }
  Object.assign(vars, zoneVars(style.zone));
  Object.assign(vars, anchorPositionVars(style.text_anchor, style.position, style.vertical_align));
  if (style.align) {
    // 明示 align は zone / anchor の水平配置より優先する
    vars["--caption-text-align"] = style.align;
    vars["--caption-align-items"] = style.align === "left"
      ? "flex-start" : style.align === "right" ? "flex-end" : "center";
  }
  return vars;
}

// shadow（角度 + 距離 → オフセット）と glow（発光 = ぼかしのみの多重影）を
// 1 本の text-shadow 値へ合成する。どちらも無ければ null（既定の薄影を維持）。
function captionTextShadowValue(shadow, glow) {
  const parts = [];
  if (shadow && typeof shadow.color === "string") {
    const angle = ((shadow.angle_deg ?? 90) * Math.PI) / 180;
    const distance = shadow.distance_px ?? 0;
    const dx = Math.round(Math.cos(angle) * distance * 100) / 100;
    const dy = Math.round(Math.sin(angle) * distance * 100) / 100;
    parts.push(`${dx}px ${dy}px ${shadow.blur_px ?? 0}px ${colorWithOpacity(shadow.color, shadow.opacity)}`);
  }
  if (glow && typeof glow.color === "string") {
    const spread = glow.spread ?? 40;
    const alpha = Math.min(1, (glow.density ?? 50) / 60);
    const offsetX = glow.offset_x ?? 0;
    const offsetY = glow.offset_y ?? 0;
    parts.push(
      `${offsetX}px ${offsetY}px ${spread}px ${colorWithOpacity(glow.color, alpha)}`,
      `${offsetX}px ${offsetY}px ${spread * 2}px ${colorWithOpacity(glow.color, Number((alpha * 0.7).toFixed(4)))}`,
    );
  }
  return parts.length > 0 ? parts.join(", ") : null;
}

// text_anchor（9 点）+ position（0..1 相対）→ プレート配置の CSS 変数。
// position 未指定なら anchor は zone 相当の縁寄せとして効く。position 指定時は
// その座標へ anchor の縦成分（t/m/b）を合わせる（m は 100% を超えないよう近似で top 配置）。
function anchorPositionVars(anchor, position, verticalAlign) {
  if (!anchor && !position && !verticalAlign) return {};
  const vars = {};
  const vertical = anchor
    ? anchor[0]
    : verticalAlign === "top" ? "t" : verticalAlign === "middle" ? "m" : "b";
  const horizontal = anchor ? anchor[1] : "c";
  if (typeof position?.y === "number") {
    const clamped = Math.min(1, Math.max(0, position.y));
    vars["--caption-top"] = `${Math.round(clamped * 10000) / 100}%`;
    vars["--caption-bottom"] = "auto";
  } else if (anchor || verticalAlign) {
    vars["--caption-top"] = vertical === "t" ? "7%" : vertical === "m" ? "0" : "auto";
    vars["--caption-bottom"] = vertical === "b" ? "7%" : vertical === "m" ? "0" : "auto";
    if (vertical === "m") vars["--caption-justify-content"] = "center";
  }
  if (typeof position?.x === "number") {
    const clamped = Math.min(1, Math.max(0, position.x));
    vars["--caption-left"] = `${Math.round(clamped * 10000) / 100}%`;
    vars["--caption-right"] = "4%";
    vars["--caption-align-items"] = "flex-start";
    vars["--caption-line-margin"] = "0";
  } else if (anchor) {
    vars["--caption-left"] = "4%";
    vars["--caption-right"] = "4%";
    vars["--caption-align-items"] = horizontal === "l"
      ? "flex-start" : horizontal === "r" ? "flex-end" : "center";
    vars["--caption-text-align"] = horizontal === "l" ? "left" : horizontal === "r" ? "right" : "center";
    vars["--caption-line-margin"] = "0";
    vars["--caption-line-max-width"] = "100%";
  }
  return vars;
}

const TEXT_TRANSFORM_MAP = {
  upper: "uppercase",
  uppercase: "uppercase",
  lower: "lowercase",
  lowercase: "lowercase",
  title: "capitalize",
  capitalize: "capitalize",
  none: "none",
};
const TEXT_ANCHOR_VALUES = new Set(["tl", "tc", "tr", "ml", "mc", "mr", "bl", "bc", "br"]);
const VERTICAL_ALIGN_VALUES = new Set(["top", "middle", "bottom"]);

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeAnimationSlot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  if (typeof value.id !== "string" || value.id === "") return undefined;
  return {
    id: value.id,
    ...(finiteNumber(value.duration_sec) && value.duration_sec > 0
      ? { duration_sec: value.duration_sec } : {}),
    ...(typeof value.ease === "string" && value.ease !== "" ? { ease: value.ease } : {}),
    ...(finiteNumber(value.amp) && value.amp > 0 ? { amp: value.amp } : {}),
  };
}

function normalizeTextStyle(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const animationIn = normalizeAnimationSlot(value.animation?.in);
  const animationLoop = normalizeAnimationSlot(value.animation?.loop);
  const animationOut = normalizeAnimationSlot(value.animation?.out);
  return {
    ...(typeof value.color === "string" ? { color: value.color } : {}),
    ...(finiteNumber(value.size_px) ? { size_px: value.size_px } : {}),
    // --- 2026-08-03 textstyle v0 拡張（presets/textstyle と同語彙） ---
    ...(typeof value.font_family === "string" && value.font_family !== ""
      ? { font_family: value.font_family } : {}),
    ...(finiteNumber(value.weight) && value.weight >= 100 && value.weight <= 900
      ? { weight: value.weight } : {}),
    ...(value.italic === true ? { italic: true } : {}),
    ...(value.underline === true ? { underline: true } : {}),
    ...(finiteNumber(value.letter_spacing_em) ? { letter_spacing_em: value.letter_spacing_em } : {}),
    ...(finiteNumber(value.line_height) && value.line_height > 0
      ? { line_height: value.line_height } : {}),
    ...(value.align === "left" || value.align === "center" || value.align === "right"
      ? { align: value.align } : {}),
    ...(VERTICAL_ALIGN_VALUES.has(value.vertical_align)
      ? { vertical_align: value.vertical_align } : {}),
    ...(value.vertical === true ? { vertical: true } : {}),
    ...(TEXT_TRANSFORM_MAP[value.text_transform]
      ? { text_transform: TEXT_TRANSFORM_MAP[value.text_transform] } : {}),
    ...(finiteNumber(value.max_width_pct) && value.max_width_pct > 0 && value.max_width_pct < 100
      ? { max_width_pct: value.max_width_pct } : {}),
    ...(typeof value.text_anchor === "string" && TEXT_ANCHOR_VALUES.has(value.text_anchor)
      ? { text_anchor: value.text_anchor } : {}),
    ...(value.position && typeof value.position === "object" && !Array.isArray(value.position)
      && (finiteNumber(value.position.x) || finiteNumber(value.position.y))
      ? {
          position: {
            ...(finiteNumber(value.position.x) ? { x: value.position.x } : {}),
            ...(finiteNumber(value.position.y) ? { y: value.position.y } : {}),
          },
        } : {}),
    ...(value.shadow && typeof value.shadow === "object" && !Array.isArray(value.shadow)
      && typeof value.shadow.color === "string"
      ? {
          shadow: {
            color: value.shadow.color,
            ...(finiteNumber(value.shadow.opacity) ? { opacity: value.shadow.opacity } : {}),
            ...(finiteNumber(value.shadow.blur_px) ? { blur_px: value.shadow.blur_px } : {}),
            ...(finiteNumber(value.shadow.distance_px) ? { distance_px: value.shadow.distance_px } : {}),
            ...(finiteNumber(value.shadow.angle_deg) ? { angle_deg: value.shadow.angle_deg } : {}),
          },
        } : {}),
    ...(value.glow && typeof value.glow === "object" && !Array.isArray(value.glow)
      && typeof value.glow.color === "string"
      ? {
          glow: {
            color: value.glow.color,
            ...(finiteNumber(value.glow.density) ? { density: value.glow.density } : {}),
            ...(finiteNumber(value.glow.spread) ? { spread: value.glow.spread } : {}),
            ...(finiteNumber(value.glow.offset_x) ? { offset_x: value.glow.offset_x } : {}),
            ...(finiteNumber(value.glow.offset_y) ? { offset_y: value.glow.offset_y } : {}),
          },
        } : {}),
    ...(animationIn || animationLoop || animationOut
      ? {
          animation: {
            ...(animationIn ? { in: animationIn } : {}),
            ...(animationLoop ? { loop: animationLoop } : {}),
            ...(animationOut ? { out: animationOut } : {}),
          },
        } : {}),
    ...(value.stroke && typeof value.stroke === "object" && !Array.isArray(value.stroke)
      ? {
          stroke: {
            ...(typeof value.stroke.color === "string" ? { color: value.stroke.color } : {}),
            ...(finiteNumber(value.stroke.width_px) ? { width_px: value.stroke.width_px } : {}),
          },
        } : {}),
    ...(value.background && typeof value.background === "object" && !Array.isArray(value.background)
      ? {
          background: {
            ...(typeof value.background.color === "string" ? { color: value.background.color } : {}),
            ...(finiteNumber(value.background.opacity) ? { opacity: value.background.opacity } : {}),
            ...(finiteNumber(value.background.radius_px) ? { radius_px: value.background.radius_px } : {}),
            ...(finiteNumber(value.background.padding_px) ? { padding_px: value.background.padding_px } : {}),
            ...(finiteNumber(value.background.height_pct) ? { height_pct: value.background.height_pct } : {}),
            ...(finiteNumber(value.background.width_pct) ? { width_pct: value.background.width_pct } : {}),
            ...(finiteNumber(value.background.offset_x) ? { offset_x: value.background.offset_x } : {}),
            ...(finiteNumber(value.background.offset_y) ? { offset_y: value.background.offset_y } : {}),
            ...(value.background.mode === "per-line" || value.background.mode === "block"
              ? { mode: value.background.mode } : {}),
          },
        } : {}),
    ...(typeof value.zone === "string" ? { zone: value.zone } : {}),
  };
}

function usesPercentageBackground(background) {
  return (finiteNumber(background?.width_pct) && background.width_pct > 0)
    || (finiteNumber(background?.height_pct) && background.height_pct > 0);
}

function usesExtendedPerLineBackground(background) {
  if (!background || background.mode === "block") return false;
  return usesPercentageBackground(background)
    || (finiteNumber(background.offset_x) && background.offset_x !== 0)
    || (finiteNumber(background.offset_y) && background.offset_y !== 0);
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
  const baseFontSize = options.baseFontSize ?? DEFAULT_FONT_SIZE_PX;
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
  const lines = splitCaptionLines(text, maximum);
  const markup = lines
    .map((line) => `<p class="akari-caption__line">${escapeHtml(line)}</p>`)
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
      display: flex;
      flex-direction: column;
${plateAlignmentCss}      gap: var(--plate-gap, 4px);
      opacity: 1;
${plateAnimationCss}
    }
    .akari-caption__line {
      width: max-content;
${linePlacementCss}
      padding: var(--plate-pad-y, 0.08em) var(--plate-pad-x, 0.42em);
      border-radius: var(--plate-radius, 10px);
      background: var(--plate-bg, transparent);
${lineTextAlignCss}      white-space: pre;
${writingModeCss}    }${blockPlateCss}${extendedPlateCss}
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

  const emphasisCss = hasEmphasis ? renderEmphasisCss() : "";
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
      display: flex;
      flex-direction: column;
${plateAlignmentCss}      gap: var(--plate-gap, 4px);
      opacity: 1;
${plateAnimationCss}
    }
    .akari-caption__line {
      width: max-content;
${linePlacementCss}
      padding: var(--plate-pad-y, 0.08em) var(--plate-pad-x, 0.42em);
      border-radius: var(--plate-radius, 10px);
      background: var(--plate-bg, transparent);
${lineTextAlignCss}      white-space: pre;
${writingModeCss}    }${blockPlateCss}${extendedPlateCss}
    .akari-caption__tok {
      display: inline-block;
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
    }${revealCss}${emphasisCss}
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
