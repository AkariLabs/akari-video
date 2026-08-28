import { CAPTION_ANIMATION_RECIPES } from "../../render-cut/src/captions.mjs";

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
  for (const [index, cue] of captionList.entries()) {
    const id = cue?.id ?? `caption-${index}`;
    if (Array.isArray(cue?.words) && cue.words.length > 0) {
      entries.push(entry("caption", id, "unsupported", "karaoke-words-unsupported-in-v0", ["words"]));
      continue;
    }
    if (cue?.style !== null && cue?.style !== undefined && cue.style !== "") {
      entries.push(entry("caption", id, "unsupported", "word-level-style-unsupported-in-v0", [String(cue.style)]));
      continue;
    }
    const animation = mergeTextStyle(inheritedTextStyle, cue?.text_style)?.animation ?? null;
    const motionSupport = isCaptionMotionSupported(animation);
    if (!motionSupport.supported) {
      entries.push(entry("caption", id, "unsupported", `caption-motion-${motionSupport.unsupported[0]}-unsupported`, motionSupport.unsupported));
      continue;
    }
    entries.push(entry("caption", id, "same", "caption-sprite", []));
  }

  const resolvedEmphasis = emphasisWords.length > 0
    ? emphasisWords
    : Array.isArray(captions) ? edit.emphasis_words ?? [] : captions?.emphasis_words ?? edit.emphasis_words ?? [];
  if (Array.isArray(resolvedEmphasis) && resolvedEmphasis.length > 0) {
    entries.push(entry("edit", "emphasis_words", "unsupported", "emphasis-words-unsupported-in-v0", ["emphasis_words"]));
  }

  const summary = { same: 0, three: 0, dom: 0, degraded: 0, unsupported: 0 };
  for (const value of entries) summary[value.classification] += 1;
  return {
    eligible: summary.degraded === 0 && summary.unsupported === 0,
    entries,
    summary,
  };
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
