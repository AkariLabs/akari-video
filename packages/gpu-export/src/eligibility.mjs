import { CAPTION_ANIMATION_RECIPES, splitCaptionLines } from "../../render-cut/src/captions.mjs";

export const CAPTION_MEASURE_UNSTABLE_REASON = "caption-measure-unstable";

const OVERLAY_CONDITIONS = [
  ["absolute-external-url", /(?:file:\/\/\/|https?:\/\/)/iu, "external"],
  ["font-face-external-resource", /@font-face[\s\S]{0,2000}?src\s*:\s*url\((?!["']?data:)/iu, "external"],
  ["image-external-resource", /<img\b[^>]*\bsrc\s*=\s*["'](?!data:)/iu, "external"],
  ["background-image-external-resource", /background(?:-image)?\s*:[^;}]*url\((?!["']?data:)/iu, "external"],
  ["embedded-context", /<(?:iframe|object|embed)\b/iu, "dynamic"],
  ["css-3d-transform", /perspective\s*:|perspective\s*\(|transform-style\s*:\s*preserve-3d|rotateX\s*\(|rotateY\s*\(|rotate3d\s*\(|matrix3d\s*\(|translateZ\s*\(|translate3d\s*\(/iu, "dynamic"],
  ["self-driving-clock", /requestAnimationFrame\s*\(|setTimeout\s*\(|setInterval\s*\(|Date\.now\s*\(|performance\.now\s*\(/iu, "dynamic"],
  ["media-element", /<(?:video|audio)\b/iu, "dynamic"],
  ["three-or-canvas-runtime", /data-akari-3d-scene|<canvas\b/iu, "dynamic"],
  ["script-runtime", /<script\b(?![^>]*type=["']application\/json)/iu, "dynamic"],
  ["animation-timing", /@keyframes|@property|\banimation(?:-[a-z-]+)?\s*:|\btransition(?:-[a-z-]+)?\s*:/iu, "dynamic"],
  ["advanced-css", /backdrop-filter|mix-blend-mode|filter\s*:|mask(?:-image)?\s*:|clip-path\s*:/iu, "dynamic"],
];

const DOM_LAYER_CONDITIONS = new Set(["animation-timing", "advanced-css"]);

const UNSUPPORTED_MOTIONS = new Set([
  "push-left", "push-right", "push-up", "push-down", "typewriter", "wipe-left", "wipe-right",
  "glitch", "swing",
]);

const SUPPORTED_WORD_STYLES = new Set(["karaoke", "pop", "reveal", "reveal-word"]);
const GEOMETRY_EMPHASIS_STYLES = new Set(["one-char-bang", "one-char-jumble", "size-pulse"]);
const DEFAULT_MAX_CHARACTERS = 20;
const PORTRAIT_MAX_CHARACTERS = 10;

export function evaluateGpuEligibility({
  edit = {},
  captions = [],
  defaultTextStyle = null,
  emphasisWords = [],
} = {}) {
  const entries = [];
  for (const [index, overlay] of (edit.overlays ?? []).entries()) {
    if (overlay?.enabled === false) continue;
    const html = typeof overlay?.html === "string" ? overlay.html : "";
    const conditions = OVERLAY_CONDITIONS
      .filter(([, pattern]) => pattern.test(html))
      .map(([condition, , kind]) => ({ condition, kind }));
    const names = conditions.map((entry) => entry.condition);
    if (isThreeOnlyOverlay(html, names)) {
      entries.push(entry("overlay", overlay.id ?? `overlay-${index}`, "three", "three-scene-canvas-direct", names));
    } else if (names.length === 0) {
      entries.push(entry("overlay", overlay.id ?? `overlay-${index}`, "same", "static-html-sprite", []));
    } else if (names.every((name) => DOM_LAYER_CONDITIONS.has(name))) {
      entries.push(entry("overlay", overlay.id ?? `overlay-${index}`, "dom", "dom-layer-draw-element", names));
    } else {
      entries.push(entry("overlay", overlay.id ?? `overlay-${index}`, "degraded", names.join(", "), names));
    }
  }

  const captionList = Array.isArray(captions) ? captions : captions?.captions ?? [];
  const inheritedTextStyle = defaultTextStyle ?? (Array.isArray(captions) ? null : captions?.default_text_style ?? null);
  const resolvedEmphasis = emphasisWords.length > 0
    ? emphasisWords
    : Array.isArray(captions) ? edit.emphasis_words ?? [] : captions?.emphasis_words ?? edit.emphasis_words ?? [];
  const validEmphasis = Array.isArray(resolvedEmphasis) ? resolvedEmphasis.filter(isValidEmphasis) : [];
  for (const [index, cue] of captionList.entries()) {
    const id = cue?.id ?? `caption-${index}`;
    const style = typeof cue?.style === "string" && cue.style !== "" ? cue.style : null;
    if (style !== null && !SUPPORTED_WORD_STYLES.has(style)) {
      entries.push(entry("caption", id, "unsupported", `caption-style-unsupported:${style}`, [style]));
      continue;
    }
    const textStyle = mergeTextStyle(inheritedTextStyle, cue?.text_style);
    const animation = textStyle?.animation ?? null;
    const motionSupport = isCaptionMotionSupported(animation);
    if (!motionSupport.supported) {
      entries.push(entry("caption", id, "unsupported", `caption-motion-${motionSupport.unsupported[0]}-unsupported`, motionSupport.unsupported));
      continue;
    }
    const wordSupport = classifyCaptionWordMode({
      cue,
      output: edit.output,
      inheritedTextStyle,
      emphasisWords: validEmphasis,
    });
    if (wordSupport.hasWordDisplay && textStyle?.vertical === true) {
      entries.push(entry("caption", id, "unsupported", "caption-text-style-vertical-unsupported", ["text_style.vertical"]));
      continue;
    }
    if (wordSupport.mixedColorAndGeometry) {
      entries.push(entry("caption", id, "unsupported", "words-native-color-and-geometry-mixed", ["words", "emphasis_words"]));
      continue;
    }
    entries.push(entry(
      "caption",
      id,
      "same",
      wordSupport.hasWordDisplay ? "words-native" : "caption-sprite",
      wordSupport.hasWordDisplay ? ["words"] : [],
    ));
  }
  const summary = { same: 0, three: 0, dom: 0, degraded: 0, unsupported: 0 };
  for (const value of entries) summary[value.classification] += 1;
  return {
    eligible: summary.degraded === 0 && summary.unsupported === 0,
    entries,
    summary,
  };
}

function isValidEmphasis(value) {
  return value && typeof value.id === "string" && /^e-\d{4}$/u.test(value.id)
    && typeof value.word === "string" && /\S/u.test(value.word)
    && typeof value.emotion === "string" && /\S/u.test(value.emotion)
    && Number.isFinite(value.t_start) && value.t_start >= 0
    && Number.isFinite(value.t_end) && value.t_end > value.t_start
    && (value.src === undefined || (typeof value.src === "string" && /\S/u.test(value.src)))
    && (value.style_hint === undefined || typeof value.style_hint === "string");
}

export function classifyCaptionWordMode({ cue = {}, output = {}, inheritedTextStyle = null, emphasisWords = [] } = {}) {
  const portrait = Number(output?.height) > Number(output?.width);
  const textStyle = mergeTextStyle(inheritedTextStyle, cue?.text_style);
  const maximum = textStyle?.max_characters ?? (portrait ? PORTRAIT_MAX_CHARACTERS : DEFAULT_MAX_CHARACTERS);
  const words = clipWordsToRange(cue?.words, cue?.start, cue?.end);
  const displayText = typeof cue?.display_text === "string" ? cue.display_text : String(cue?.text ?? "");
  let effectiveStyle = SUPPORTED_WORD_STYLES.has(cue?.style) ? cue.style : null;
  if (portrait && effectiveStyle === null && words.length > 0 && splitCaptionLines(displayText, maximum).length > 1) {
    effectiveStyle = "reveal";
  }
  const normalizedEmphasis = Array.isArray(emphasisWords) ? emphasisWords.filter(isValidEmphasis) : [];
  const matches = words.map((word) => matchingEmphasis(word, normalizedEmphasis));
  const emphasisStyles = [...new Set(matches.filter(Boolean).map(resolveEmphasisStyle))];
  const hasGeometry = emphasisStyles.some((style) => GEOMETRY_EMPHASIS_STYLES.has(style));
  const hasKaraoke = effectiveStyle === "karaoke" && matches.some((match) => !match);
  const hasWordDisplay = effectiveStyle !== null || matches.some(Boolean);
  const wordMode = hasKaraoke ? "karaoke" : hasGeometry || effectiveStyle === "pop" || effectiveStyle === "reveal-word"
    ? "geometry" : "sprite";
  return {
    effectiveStyle,
    emphasisStyles,
    hasWordDisplay,
    mixedColorAndGeometry: hasKaraoke && hasGeometry,
    wordMode,
    wordCount: words.length,
  };
}

function clipWordsToRange(words, rangeStart, rangeEnd) {
  if (!Array.isArray(words)) return [];
  const start = Number.isFinite(rangeStart) ? rangeStart : 0;
  const end = Number.isFinite(rangeEnd) ? rangeEnd : Number.POSITIVE_INFINITY;
  return words
    .filter((word) => word && typeof word.text === "string" && word.text.length > 0
      && Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start)
    .filter((word) => word.end > start && word.start < end)
    .map((word) => ({ ...word, start: Math.max(word.start, start), end: Math.min(word.end, end) }))
    .sort((left, right) => left.start - right.start);
}

function matchingEmphasis(word, emphasisWords) {
  if (!Array.isArray(emphasisWords)) return null;
  const wordText = String(word.sourceText ?? word.text).normalize("NFKC").toLowerCase();
  return emphasisWords.find((emphasis) => {
    if (!emphasis || typeof emphasis.word !== "string") return false;
    const emphasisText = emphasis.word.normalize("NFKC").toLowerCase();
    return Number(emphasis.t_end) > word.start && Number(emphasis.t_start) < word.end
      && (wordText === emphasisText || emphasisText.includes(wordText));
  }) ?? null;
}

function resolveEmphasisStyle(emphasis) {
  if (typeof emphasis?.style_hint === "string") {
    return [
      "one-char-bang", "one-char-jumble", "size-pulse", "color-accent", "color-only",
      "outline-bold", "danger", "positive", "highlight",
    ].includes(emphasis.style_hint) ? emphasis.style_hint : "color-accent";
  }
  if (["pain", "surprise", "anger"].includes(emphasis?.emotion)) return "one-char-bang";
  if (emphasis?.emotion === "disgust") return "one-char-jumble";
  if (["joy", "emphasis"].includes(emphasis?.emotion)) return "size-pulse";
  return "color-accent";
}

function isThreeOnlyOverlay(html, conditions) {
  if (conditions.length !== 1 || conditions[0] !== "three-or-canvas-runtime") return false;
  const scripts = html.match(/<script\b[^>]*>/giu) ?? [];
  const declarations = scripts.filter((tag) =>
    /\btype\s*=\s*["']application\/json["']/iu.test(tag)
    && /\bdata-akari-3d-scene(?:\s|=|>)/iu.test(tag));
  return scripts.length === 1 && declarations.length === 1;
}

export function isCaptionMotionSupported(animation) {
  if (!animation || typeof animation !== "object") return { supported: true, unsupported: [] };
  const ids = [animation.in?.id, animation.loop?.id, animation.out?.id].filter(Boolean);
  const unsupported = [...new Set(ids.filter((id) => UNSUPPORTED_MOTIONS.has(id) || !Object.hasOwn(CAPTION_ANIMATION_RECIPES, id)))];
  return { supported: unsupported.length === 0, unsupported };
}

function mergeTextStyle(base, override) {
  if (!base && !override) return null;
  const animation = base?.animation || override?.animation
    ? { ...(base?.animation ?? {}), ...(override?.animation ?? {}) }
    : undefined;
  return { ...(base ?? {}), ...(override ?? {}), ...(animation ? { animation } : {}) };
}

function entry(kind, id, classification, reason, conditions) {
  return { kind, id: String(id), classification, reason, conditions };
}
