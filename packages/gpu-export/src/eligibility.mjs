import { CAPTION_ANIMATION_RECIPES, splitCaptionLines } from "../../render-cut/src/captions.mjs";
import { stripHtmlComments, stripCssComments, rawTextElements, htmlTags, findAttribute, isHtmlSpace, startsWithFold } from "../../render-cut/src/html-scan.mjs";
import { hasDepthTransform, parseThreeEntrance, scanThreeComposite, scanThreeSampled } from "./three-entrance.mjs";
import { runtimes as overlayRuntimes } from "../../overlay-runtime/runtimes.mjs";
import { captionFontFaces, captionFontFamilies } from '../../render-cut/src/caption-font-faces.mjs';
import { accessSync, constants, statSync } from 'node:fs';

export const CAPTION_MEASURE_UNSTABLE_REASON = "caption-measure-unstable";

function hasBackfaceHiddenWithDepthTransform(html) {
  return /backface-visibility\s*:\s*hidden/iu.test(html) && hasDepthTransform(html);
}

function balancedBody(source, open, close, start) {
  let depth = 1;
  let quote = null;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === "\\") { index += 1; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") { quote = char; continue; }
    if (char === open) depth += 1;
    else if (char === close && --depth === 0) return source.slice(start, index);
  }
  return null;
}

function firstArgument(args) {
  const closing = new Map([["(", ")"], ["[", "]"], ["{", "}"]]);
  const stack = [];
  let quote = null;
  for (let index = 0; index < args.length; index += 1) {
    const char = args[index];
    if (quote) {
      if (char === "\\") { index += 1; continue; }
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'" || char === "`") quote = char;
    else if (closing.has(char)) stack.push(closing.get(char));
    else if (char === stack.at(-1)) stack.pop();
    else if (char === "," && stack.length === 0) return args.slice(0, index);
  }
  return args;
}

export function hasAuthoredDepthAnimation(html) {
  for (const style of rawTextElements(html, "style")) {
    const css = stripCssComments(html.slice(style.bodyStart, style.bodyEnd));
    for (const keyframes of css.matchAll(/@(?:-[a-z]+-)?keyframes\s+[\w-]+\s*\{/giu)) {
      const body = balancedBody(css, "{", "}", keyframes.index + keyframes[0].length);
      if (body === null || hasDepthTransform(body)) return true;
    }
  }
  for (const tag of htmlTags(html)) {
    const style = attributeValue(tag.text, "style");
    if (style !== null && hasDepthTransform(style)) return true;
  }
  for (const script of rawTextElements(html, "script")) {
    if (quotedJsonType(html, script.start + 7, script.bodyStart - 1)) continue;
    const body = html.slice(script.bodyStart, script.bodyEnd);
    for (const animate of body.matchAll(/\.animate\s*\(/gu)) {
      const args = balancedBody(body, "(", ")", animate.index + animate[0].length);
      if (args === null || hasDepthTransform(firstArgument(args))) return true;
    }
  }
  return false;
}

function attributeValue(tag, name) {
  for (let at = findAttribute(tag, name, 0, tag.length); at >= 0;
    at = findAttribute(tag, name, at + 1, tag.length)) {
    let cursor = at + name.length;
    while (isHtmlSpace(tag[cursor])) cursor += 1;
    if (tag[cursor++] !== "=") continue;
    while (isHtmlSpace(tag[cursor])) cursor += 1;
    const quote = tag[cursor] === '"' || tag[cursor] === "'" ? tag[cursor] : null;
    if (quote) {
      const end = tag.indexOf(quote, cursor + 1);
      if (end >= 0) return tag.slice(cursor + 1, end);
    }
    // The old unquoted alternative also accepts an unmatched opening quote.
    const start = cursor;
    while (cursor < tag.length && !isHtmlSpace(tag[cursor]) && tag[cursor] !== ">") cursor += 1;
    if (cursor > start) return tag.slice(start, cursor);
  }
  return null;
}

function quotedJsonType(source, from, to) {
  for (let at = findAttribute(source, "type", from, to); at >= 0;
    at = findAttribute(source, "type", at + 1, to)) {
    let cursor = at + 4;
    while (isHtmlSpace(source[cursor])) cursor += 1;
    if (source[cursor++] !== "=") continue;
    while (isHtmlSpace(source[cursor])) cursor += 1;
    const quote = source[cursor++];
    if ((quote === '"' || quote === "'") && cursor + 16 < to
      && startsWithFold(source, "application/json", cursor)
      && (source[cursor + 16] === '"' || source[cursor + 16] === "'")) return true;
  }
  return false;
}

// XML 名前空間宣言（xmlns="http://www.w3.org/2000/svg" / xmlns:xlink="…"）の値は名前を区別する識別子で、
// 取得されるリソースではない。図形アイテム（source.kind: "shape"）はインライン SVG へ降下するため必ず
// xmlns を持ち、素の文字列走査のままだと全図形が absolute-external-url で OSR へ落ちていた。
// 外すのはタグ内・空白直後の xmlns 属性で、値が引用符付きかつ空白・引用符・<> を含まないものだけ。
// src / href / xlink:href / url(…) / xml:base は残るので、実際の外部参照は従来どおり拒否する。
// タグ境界が読めない（属性値に > がある等）ときは外さない側に倒れる（fail-closed）。
export function withoutXmlNamespaceDeclarations(html) {
  const pieces = [];
  let copied = 0;
  for (const tag of htmlTags(html, { noInnerAngle: true })) {
    if (!/[A-Za-z]/u.test(html[tag.start + 1])) continue;
    const replaced = stripXmlnsAttributes(tag.text);
    if (replaced === tag.text) continue;
    pieces.push(html.slice(copied, tag.start), replaced);
    copied = tag.end;
  }
  if (copied === 0) return html;
  pieces.push(html.slice(copied));
  return pieces.join("");
}

function stripXmlnsAttributes(tag) {
  const parts = [];
  let copied = 0;
  let at = tag.indexOf("xmlns");
  while (at >= 0) {
    let cursor = at + 5;
    if (isHtmlSpace(tag[at - 1])) {
      if (tag[cursor] === ":" && /[A-Za-z_]/u.test(tag[cursor + 1] ?? "")) {
        cursor += 2;
        while (/[\w.-]/u.test(tag[cursor] ?? "")) cursor += 1;
      }
      while (isHtmlSpace(tag[cursor])) cursor += 1;
      if (tag[cursor++] === "=") {
        while (isHtmlSpace(tag[cursor])) cursor += 1;
        const quote = tag[cursor++];
        if (quote === '"' || quote === "'") {
          let end = cursor;
          while (end < tag.length && tag[end] !== quote && tag[end] !== '"' && tag[end] !== "'"
            && tag[end] !== "<" && tag[end] !== ">" && !isHtmlSpace(tag[end])) end += 1;
          if (tag[end] === quote) {
            parts.push(tag.slice(copied, at));
            copied = end + 1;
          }
        }
      }
    }
    at = tag.indexOf("xmlns", Math.max(at + 1, copied));
  }
  if (copied === 0) return tag;
  parts.push(tag.slice(copied));
  return parts.join("");
}

export function hasExternalImageSource(html) {
  const opener = /<img\b/iyu;
  let cursor = 0;
  while (cursor < html.length) {
    const at = html.indexOf("<", cursor);
    if (at < 0) return false;
    opener.lastIndex = at;
    if (opener.test(html)) {
      const tagEnd = html.indexOf(">", at + 4);
      const end = tagEnd < 0 ? html.length : tagEnd;
      for (let src = findAttribute(html, "src", at + 4, end); src >= 0;
        src = findAttribute(html, "src", src + 1, end)) {
        let p = src + 3;
        while (isHtmlSpace(html[p])) p += 1;
        if (html[p++] !== "=") continue;
        while (isHtmlSpace(html[p])) p += 1;
        if ((html[p] === '"' || html[p] === "'") && !startsWithFold(html, "data:", p + 1)) return true;
      }
      // The first <img can consume every later opener up to the same >.
      // Once its candidate attributes fail, later openers cannot succeed.
      cursor = tagEnd < 0 ? html.length : tagEnd + 1;
      continue;
    }
    cursor = at + 1;
  }
  return false;
}

// CSS の url()・<img src>・SVG の <image href> から画像として読む SVG は外部リソースを一切読まない。
// よって data:image/ 内の URL は外部参照ではない。data:text/* は中から外部を読めるので残す。
// withoutXmlNamespaceDeclarations は性質テストで旧正規表現版との一致を固定しており、前段で組み合わせる。
// data: URI は数十 MB になり、V8 の正規表現量指定子は 2 バイト文字列で約 8M 文字進むと RangeError（#112）。
// indexOf と添字で線形に走査し、終端が閉じない・改行・生の < を跨ぐときは外さない（fail-closed）。
export function withoutImageDataUriPayloads(html) {
  const pieces = [];
  let copied = 0;
  let searchFrom = 0;
  while (searchFrom < html.length) {
    const colon = html.indexOf(":", searchFrom);
    if (colon < 0) break;
    searchFrom = colon + 1;
    if (colon < 4 || !startsWithFold(html, "data", colon - 4)
      || !startsWithFold(html, "image/", colon + 1)) continue;

    let before = colon - 5;
    const quote = html[before] === "'" || html[before] === '"' ? html[before--] : null;
    while (before >= 0 && isHtmlSpace(html[before])) before -= 1;
    const cssUrl = before >= 3 && startsWithFold(html, "url(", before - 3);
    let imageAttribute = false;
    if (quote && !cssUrl && html[before] === "=") {
      before -= 1;
      while (before >= 0 && isHtmlSpace(html[before])) before -= 1;
      for (const name of ["xlink:href", "href", "src"]) {
        const nameStart = before - name.length + 1;
        if (nameStart > 0 && isHtmlSpace(html[nameStart - 1])
          && startsWithFold(html, name, nameStart)) {
          imageAttribute = true;
          break;
        }
      }
    }
    if (!cssUrl && !imageAttribute) continue;

    const payloadStart = colon + 7;
    let end = -1;
    if (quote) {
      for (let index = payloadStart; index < html.length; index += 1) {
        const char = html[index];
        if (char === "<") break;
        if (cssUrl && char === "\\") {
          if (html[index + 1] === "<") break;
          index += 1;
          continue;
        }
        if (cssUrl && (char === "\n" || char === "\r" || char === "\f")) break;
        if (char === quote) { end = index; break; }
      }
    } else {
      for (let index = payloadStart; index < html.length; index += 1) {
        const char = html[index];
        if (char === ")") { end = index; break; }
        if (char === "<" || char === "'" || char === '"' || isHtmlSpace(char)) break;
      }
    }
    if (end < 0) break;
    pieces.push(html.slice(copied, payloadStart));
    copied = end;
    searchFrom = end + 1;
  }
  if (copied === 0) return html;
  pieces.push(html.slice(copied));
  return pieces.join("");
}

function hasAbsoluteExternalUrl(html) {
  return /(?:file:\/\/\/|https?:\/\/)/iu.test(withoutXmlNamespaceDeclarations(withoutImageDataUriPayloads(html)));
}

const OVERLAY_CONDITIONS = [
  ["absolute-external-url", hasAbsoluteExternalUrl, "external"],
  ["font-face-external-resource", /@font-face[\s\S]{0,2000}?src\s*:\s*url\((?!["']?data:)/iu, "external"],
  ["image-external-resource", hasExternalImageSource, "external"],
  // 走査は CSS 宣言の区切り（; }）に加えて引用符とタグ境界で止める。止めないと、末尾に ; の無い
  // インライン style から後続 SVG の fill="url(#id)" まで到達して誤検出する（issue #33）。
  // url(#…) の同一文書内フラグメント参照は外部リソースではない。
  ["background-image-external-resource", /background(?:-image)?\s*:[^;}"'<>]*url\((?!["']?(?:data:|#))/iu, "external"],
  ["embedded-context", /<(?:iframe|object|embed)\b/iu, "dynamic"],
  ["css-3d-transform", hasDepthTransform, "dynamic"],
  ["css-3d-backface-hidden", hasBackfaceHiddenWithDepthTransform, "dynamic"],
  ["self-driving-clock", /requestAnimationFrame\s*\(|setTimeout\s*\(|setInterval\s*\(|Date\.now\s*\(|performance\.now\s*\(/iu, "dynamic"],
  ["media-element", /<(?:video|audio)\b/iu, "dynamic"],
  ["vgpu-runtime", /data-akari-vgpu-scene/iu, "dynamic"],
  ["three-or-canvas-runtime", /data-akari-3d-scene|<canvas\b/iu, "dynamic"],
  ["script-runtime", /<script\b(?![^>]*type=["']application\/json)/iu, "dynamic"],
  ["animation-timing", /@keyframes|@property|\banimation(?:-[a-z-]+)?\s*:|\btransition(?:-[a-z-]+)?\s*:/iu, "dynamic"],
  ["advanced-css", /backdrop-filter|mix-blend-mode|filter\s*:|mask(?:-image)?\s*:|clip-path\s*:/iu, "dynamic"],
];
// ランタイム宣言（data-akari-*-scene）は overlay-runtime の runtimes.mjs（マニフェスト）から導出する。
// three / vgpu は上の表で個別に扱う。それ以外（world / glass / 今後の追加）は「動的・DOM 適格でない」として
// fail-closed に落とす（--engine auto は OSR へ）。条件表に手で足し忘れて GPU が黙って別の絵を焼く事故の再発防止。
const RUNTIME_DECLARATION_CONDITIONS = overlayRuntimes
  .filter((entry) => !["three", "vgpu"].includes(entry.id))
  .map((entry) => [`${entry.id}-runtime`, new RegExp(entry.declaration.attr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu"), "dynamic"]);
OVERLAY_CONDITIONS.push(...RUNTIME_DECLARATION_CONDITIONS);


// 2026-09-03 の実測では CSS 3D 幾何は e 0.5222 / f 0.2364 / h 0.1757 / d 0.5336 と
// 予算 1.0 内だった。一方 backface-hidden は a 13.4318、GPU にだけ最大 207,679 px が現れたため、
// 幾何は DOM 層へ通し、裏面除去だけを別条件で fail-closed に保つ。
const DOM_LAYER_CONDITIONS = new Set(["css-3d-transform", "animation-timing", "advanced-css"]);
const SAMPLED_CONDITIONS = new Set(["three-or-canvas-runtime", "animation-timing"]);
const COMPOSITE_CONDITIONS = new Set(["three-or-canvas-runtime", "animation-timing", "css-3d-transform", "advanced-css"]);

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
  forceDegraded = false,
} = {}) {
  const entries = [];
  for (const [index, overlay] of (edit.overlays ?? []).entries()) {
    if (overlay?.enabled === false) continue;
    const html = typeof overlay?.html === "string" ? overlay.html : "";
    const source = stripHtmlComments(html);
    const depthTransform = hasAuthoredDepthAnimation(source)
      || (Array.isArray(overlay?.keyframes) && hasDepthTransform(JSON.stringify(overlay.keyframes)));
    const conditions = OVERLAY_CONDITIONS
      .filter(([, pattern]) => (typeof pattern === "function" ? pattern(source) : pattern.test(source)))
      .map(([condition, , kind]) => ({ condition, kind }));
    if (Array.isArray(overlay?.keyframes)) {
      conditions.unshift({ condition: "item-keyframes", kind: "dynamic" });
    }
    const names = conditions.map((entry) => entry.condition);
    const animated = names.includes("animation-timing");
    const entrance = names.includes("three-or-canvas-runtime") && animated
      ? parseThreeEntrance(html, { vars: overlay.vars, transform: overlay.transform, role: overlay.role })
      : null;
    if (names.includes("item-keyframes")) {
      entries.push(entry("overlay", overlay.id ?? `overlay-${index}`, "dom", "item-keyframes", names));
    } else if (names.includes("vgpu-runtime")) {
      const result = classifyVgpuOverlay(source, names);
      entries.push(entry("overlay", overlay.id ?? `overlay-${index}`, result.classification, result.reason, names));
    } else if (isThreeOnlyOverlay(source, names)) {
      entries.push(entry("overlay", overlay.id ?? `overlay-${index}`, "three", "three-scene-canvas-direct", names));
    } else if (names.includes("three-or-canvas-runtime")) {
      // entranceCandidate が animation を要求していたため、静止 3D + CSS が分岐から漏れていた。
      // 方式 B は断片全体を転写するため animation の有無に依存せず、U3 実測済みの
      // composite 経路へ静止 3D も通せる（条件外の断片は引き続き fail-closed）。
      const withinSampledConditions = names.every((name) => SAMPLED_CONDITIONS.has(name));
      if (names.includes("css-3d-backface-hidden")) {
        entries.push(entry("overlay", overlay.id ?? `overlay-${index}`, "degraded", "css-3d-backface-hidden", names));
      } else if (animated && entrance.ok && withinSampledConditions) {
        entries.push(entry("overlay", overlay.id ?? `overlay-${index}`, "three", "three-scene-entrance-curve", names));
      } else if (animated && withinSampledConditions) {
        const sampled = scanThreeSampled(html);
        if (sampled.ok) {
          entries.push(entry("overlay", overlay.id ?? `overlay-${index}`,
            depthTransform ? "degraded" : "three",
            depthTransform ? "css-3d-transform" : "three-scene-entrance-sampled", names));
          continue;
        }
        const composite = scanThreeComposite(html);
        entries.push(composite.ok
          ? entry("overlay", overlay.id ?? `overlay-${index}`, "three", "three-scene-sampled-composite", names)
          : entry("overlay", overlay.id ?? `overlay-${index}`, "degraded", composite.reason, names));
      } else if (names.every((name) => COMPOSITE_CONDITIONS.has(name))) {
        const composite = scanThreeComposite(html);
        entries.push(composite.ok
          ? entry("overlay", overlay.id ?? `overlay-${index}`, "three", "three-scene-sampled-composite", names)
          : entry("overlay", overlay.id ?? `overlay-${index}`, "degraded", composite.reason, names));
      } else {
        const unsupported = names.filter((name) => !COMPOSITE_CONDITIONS.has(name));
        entries.push(entry(
          "overlay",
          overlay.id ?? `overlay-${index}`,
          "degraded",
          `three-sampled-condition:${unsupported.join(",")}`,
          names,
        ));
      }
    } else if (names.length === 0) {
      entries.push(entry("overlay", overlay.id ?? `overlay-${index}`, "same", "static-html-sprite", []));
    } else if (names.every((name) => DOM_LAYER_CONDITIONS.has(name))) {
      entries.push(entry("overlay", overlay.id ?? `overlay-${index}`, "dom", "dom-layer-draw-element", names));
    } else {
      entries.push(entry("overlay", overlay.id ?? `overlay-${index}`, "degraded", names.join(", "), names));
    }
    const result = entries[entries.length - 1];
    if (depthTransform && result.classification !== "degraded" && result.classification !== "unsupported") {
      const depthConditions = names.includes("css-3d-transform") ? names : [...names, "css-3d-transform"];
      entries[entries.length - 1] = entry("overlay", overlay.id ?? `overlay-${index}`, "degraded", "css-3d-transform", depthConditions);
    }
  }

  const captionList = Array.isArray(captions) ? captions : captions?.captions ?? [];
  const inheritedTextStyle = defaultTextStyle ?? (Array.isArray(captions) ? null : captions?.default_text_style ?? null);
  const resolvedEmphasis = emphasisWords.length > 0
    ? emphasisWords
    : Array.isArray(captions) ? edit.emphasis_words ?? [] : captions?.emphasis_words ?? edit.emphasis_words ?? [];
  const validEmphasis = Array.isArray(resolvedEmphasis) ? resolvedEmphasis.filter(isValidEmphasis) : [];
  const availableFonts = new Set(captionFontFaces().filter(face => {
    try { accessSync(face.path, constants.R_OK); return statSync(face.path).isFile(); } catch { return false; }
  }).map(face => face.family));
  for (const [index, cue] of captionList.entries()) {
    const id = cue?.id ?? `caption-${index}`;
    const style = typeof cue?.style === "string" && cue.style !== "" ? cue.style : null;
    if (style !== null && !SUPPORTED_WORD_STYLES.has(style)) {
      entries.push(entry("caption", id, "unsupported", `caption-style-unsupported:${style}`, [style]));
      continue;
    }
    const textStyle = mergeTextStyle(inheritedTextStyle, cue?.text_style);
    const unavailableFont = captionFontFamilies(textStyle?.font_family).find(family => !availableFonts.has(family));
    if (unavailableFont) {
      entries.push(entry('caption', id, 'unsupported', `caption-font-unavailable:${unavailableFont}`, ['text_style.font_family']));
      continue;
    }
    const richLooks = ["stroke_inner", "fill_gradient", "extrude"]
      .filter((name) => textStyle?.[name] != null);
    if (richLooks.length > 0) {
      entries.push(entry("caption", id, "unsupported", `caption-rich-look-${richLooks[0]}-unsupported`, richLooks));
      continue;
    }
    const karaoke = inheritedTextStyle?.karaoke || cue?.text_style?.karaoke
      ? { ...(inheritedTextStyle?.karaoke ?? {}), ...(cue?.text_style?.karaoke ?? {}) } : null;
    if (style === 'karaoke' && karaoke?.fill !== undefined
      && !['char', 'word', 'smooth'].includes(karaoke.fill)) {
      entries.push(entry('caption', id, 'unsupported', 'caption-karaoke-fill-unsupported', ['text_style.karaoke.fill']));
      continue;
    }
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
  const originalDegraded = entries.filter((value) => value.classification === "degraded").length;
  const forcedEntries = forceDegraded
    ? entries.map((value) => value.kind === "overlay" && value.classification === "degraded"
      ? { ...value, classification: "dom", reason: `forced-dom:${value.reason}`, forced: true }
      : value)
    : entries;
  const summary = { same: 0, three: 0, dom: 0, degraded: 0, unsupported: 0 };
  for (const value of forcedEntries) summary[value.classification] = (summary[value.classification] ?? 0) + 1;
  summary.degraded = originalDegraded;
  if (forceDegraded) summary.forced = forcedEntries.filter((value) => value.forced === true).length;
  return {
    eligible: summary.degraded === 0 && summary.unsupported === 0,
    entries: forcedEntries,
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

// data-style や属性値中の style= を本物の style と誤読すると、後続の危険な指定を見逃す。
// 属性名を順に読み、重複や読めない並びは null にして直描きから外す。
function threeTagAttributes(tag, nameEnd) {
  const attributes = { style: null, type: null, fallback: false, scene: false };
  const seen = new Set();
  for (let at = nameEnd; at < tag.length;) {
    const beforeSpace = at;
    while (isHtmlSpace(tag[at])) at += 1;
    if (tag[at] === ">" || (tag[at] === "/" && tag[at + 1] === ">")) return attributes;
    if (at === beforeSpace) return null;
    const start = at;
    while (at < tag.length && !isHtmlSpace(tag[at]) && !["=", "/", ">"].includes(tag[at])) at += 1;
    if (at === start) return null;
    const name = tag.slice(start, at).toLowerCase();
    if (/["'<=]/u.test(name) || seen.has(name)) return null;
    seen.add(name);
    let equalsAt = at;
    while (isHtmlSpace(tag[equalsAt])) equalsAt += 1;
    let value = null;
    if (tag[equalsAt] === "=") {
      at = equalsAt + 1;
      while (isHtmlSpace(tag[at])) at += 1;
      const quote = tag[at] === '"' || tag[at] === "'" ? tag[at++] : null;
      const valueStart = at;
      if (quote) {
        at = tag.indexOf(quote, at);
        if (at < 0) return null;
        if (name === "style" || name === "type") value = tag.slice(valueStart, at);
        at += 1;
      } else {
        while (at < tag.length && !isHtmlSpace(tag[at]) && tag[at] !== ">") at += 1;
        if (at === valueStart || /["'<=`]/u.test(tag.slice(valueStart, at))) return null;
        if (name === "style" || name === "type") value = tag.slice(valueStart, at);
      }
      if (!isHtmlSpace(tag[at]) && tag[at] !== ">" && !(tag[at] === "/" && tag[at + 1] === ">")) return null;
    }
    if (name === "style") attributes.style = value;
    else if (name === "type") attributes.type = value;
    else if (name === "data-akari-3d-fallback") attributes.fallback = true;
    else if (name === "data-akari-3d-scene") attributes.scene = true;
  }
  return null;
}

const THREE_LAYOUT_TAGS = new Set(["div", "span", "section", "article", "main"]);
const THREE_VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
// 未知の CSS が絵を変える可能性を残さないため、拒否リストではなく許可リストにする。
// 文字用の指定は、テキストを置けるフォールバックが準備完了時に隠れるため許す。
// display:none は canvas 自体を消すので、許可プロパティでも値を別途拒否する。
const THREE_LAYOUT_PROPERTIES = new Set((
  "position inset inset-block inset-inline inset-block-start inset-block-end inset-inline-start inset-inline-end "
  + "top right bottom left width height min-width min-height max-width max-height margin margin-top margin-right margin-bottom margin-left "
  + "display box-sizing z-index pointer-events aspect-ratio flex flex-direction flex-wrap flex-flow flex-grow flex-shrink flex-basis order "
  + "grid grid-template grid-template-columns grid-template-rows grid-template-areas grid-area grid-row grid-column grid-auto-flow grid-auto-rows grid-auto-columns "
  + "align-items align-self align-content justify-items justify-self justify-content place-items place-self place-content gap row-gap column-gap "
  + "color font font-family font-size font-weight font-style line-height letter-spacing text-align white-space"
).split(" "));

function threeLayoutDeclarations(body) {
  for (const part of body.split(";")) {
    const declaration = part.trim();
    if (!declaration) continue;
    const colon = declaration.indexOf(":");
    if (colon <= 0) return false;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim();
    if (!value || !/^(?:--[a-z0-9_-]+|[a-z][a-z-]*)$/u.test(property)
      || (!property.startsWith("--") && !THREE_LAYOUT_PROPERTIES.has(property))
      || (property === "display" && /^none(?=[^a-z0-9-]|$)/iu.test(value))) return false;
  }
  return true;
}

function threeLayoutStyle(css) {
  const source = stripCssComments(css);
  let cursor = 0;
  while (cursor < source.length) {
    const open = source.indexOf("{", cursor);
    if (open < 0) return !source.slice(cursor).trim();
    const selector = source.slice(cursor, open).trim();
    if (!selector || selector.includes("@") || selector.includes("}")) return false;
    const close = source.indexOf("}", open + 1);
    if (close < 0 || source.slice(open + 1, close).includes("{")
      || !threeLayoutDeclarations(source.slice(open + 1, close))) return false;
    cursor = close + 1;
  }
  return true;
}

// #128: 直描きが出すのは 3D canvas のテクスチャ 1 枚だけ。見出し・画像・箱の背景や枠、
// CSS の変形や不透明度は出ない。canvas とレイアウトだけを残し、他は既存の composite へ回す。
// 静的に読めない断片も偽にする（fail-closed）。
function isThreeOnlyOverlay(html, conditions) {
  if (conditions.length !== 1 || conditions[0] !== "three-or-canvas-runtime") return false;
  const raw = new Map();
  for (const name of ["style", "script"]) {
    for (const element of rawTextElements(html, name)) raw.set(element.start, element);
  }
  let cursor = 0;
  let fallbacks = 0;
  let fallbackDepth = 0;
  const stack = [];
  let scripts = 0;
  for (const tag of htmlTags(html, { noInnerAngle: true })) {
    if (tag.start < cursor) continue;
    if (fallbackDepth === 0 && html.slice(cursor, tag.start).trim()) return false;
    cursor = tag.end;
    const match = /^<(\/?)([a-z][\w:-]*)(?=[\s/>])/iu.exec(tag.text);
    if (!match) return false;
    const [, closing, nameText] = match;
    const name = nameText.toLowerCase();
    if (closing) {
      if (!/^\s*>$/u.test(tag.text.slice(match[0].length))) return false;
      const opened = stack.pop();
      if (opened?.name !== name) return false;
      if (opened.fallback) fallbackDepth -= 1;
      continue;
    }
    const attributes = threeTagAttributes(tag.text, match[0].length);
    if (!attributes) return false;
    const inFallback = fallbackDepth > 0;
    const fallback = attributes.fallback;
    // ランタイムが隠すのは最初のフォールバックだけなので、外側に 2 個目があれば直描きできない。
    if (fallback && !inFallback && ++fallbacks > 1) return false;
    if (!inFallback && !fallback && name !== "canvas" && name !== "style" && name !== "script" && !THREE_LAYOUT_TAGS.has(name)) return false;
    if (!inFallback && !fallback) {
      const inline = attributes.style;
      // HTML の文字参照で &#59 と &#58 が ; と : になり、CSS 宣言を隠せる。
      if (inline !== null && (inline.includes("&") || !threeLayoutDeclarations(stripCssComments(inline)))) return false;
    }
    if (name === "style" || name === "script") {
      const element = raw.get(tag.start);
      if (!element) return false;
      // <style> は置き場所によらず文書全体に効くため、フォールバック内も検査する。
      if (name === "style" && !threeLayoutStyle(html.slice(element.bodyStart, element.bodyEnd))) return false;
      if (name === "script") {
        scripts += 1;
        if (scripts > 1 || attributes.type?.toLowerCase() !== "application/json" || !attributes.scene) return false;
      }
      cursor = element.end;
      continue;
    }
    if (!THREE_VOID_TAGS.has(name) && !tag.text.endsWith("/>")) {
      stack.push({ name, fallback: inFallback || fallback });
      if (inFallback || fallback) fallbackDepth += 1;
    }
  }
  return stack.length === 0 && !html.slice(cursor).trim() && scripts === 1;
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

// Mirrors the browser descriptor validator; agreement is exercised by vgpu-direct tests.
function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function keys(value, allowed, label) {
  if (!object(value)) throw new TypeError(`${label} must be an object`);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new TypeError(`${label}: unsupported key ${key}`);
  }
}
function validateVgpuDescriptor(value) {
  if (object(value) && value.mode === 'stateful') return validateVgpuStatefulDescriptor(value);
  keys(value, ['version', 'mode', 'alphaMode', 'seed', 'uniforms', 'passes'], 'vgpu');
  if (value.version !== 0) throw new TypeError('vgpu version must be 0');
  if (value.mode !== 'pure') throw new TypeError('vgpu mode must be pure');
  if (value.alphaMode !== undefined && value.alphaMode !== 'premultiplied') throw new TypeError('vgpu alphaMode must be premultiplied');
  if (value.seed !== undefined && !Number.isFinite(value.seed)) throw new TypeError('vgpu seed must be finite');
  const uniforms = value.uniforms === undefined ? {} : value.uniforms;
  if (!object(uniforms)) throw new TypeError('vgpu uniforms must be an object');
  for (const [key, uniform] of Object.entries(uniforms)) {
    if (!Number.isFinite(uniform) && !(Array.isArray(uniform) && uniform.length >= 2
      && uniform.length <= 4 && uniform.every(Number.isFinite))) throw new TypeError(`vgpu uniform ${key} must be f32 or vec2f/3f/4f`);
  }
  if (!Array.isArray(value.passes) || !value.passes.length) throw new TypeError('vgpu passes must be nonempty');
  const seen = new Set();
  const passes = value.passes.map((pass) => {
    keys(pass, ['id', 'wgsl', 'inputs', 'scale', 'format'], 'vgpu pass');
    if (typeof pass.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(pass.id) || seen.has(pass.id)) throw new TypeError('vgpu pass id must be valid and unique');
    if (typeof pass.wgsl !== 'string' || !pass.wgsl.trim()) throw new TypeError('vgpu pass wgsl must be nonempty');
    const inputs = pass.inputs === undefined ? [] : pass.inputs;
    if (!Array.isArray(inputs) || inputs.length > 8 || inputs.some(id => typeof id !== 'string' || !seen.has(id))) throw new TypeError('vgpu inputs must reference up to 8 earlier passes');
    if (pass.scale !== undefined && (!Number.isFinite(pass.scale) || pass.scale <= 0)) throw new TypeError('vgpu pass scale must be positive');
    if (pass.format !== undefined && !['rgba8unorm', 'rgba16float'].includes(pass.format)) throw new TypeError('vgpu pass format must be rgba8unorm or rgba16float');
    seen.add(pass.id);
    return { ...pass, inputs, scale: pass.scale === undefined ? 1 : pass.scale };
  });
  return { ...value, alphaMode: 'premultiplied', seed: value.seed === undefined ? 0 : value.seed, uniforms, passes };
}

function validateVgpuStatefulDescriptor(value) {
  keys(value, ['version', 'mode', 'alphaMode', 'seed', 'maxReplaySteps', 'uniforms', 'state', 'passes'], 'vgpu');
  if (value.version !== 0) throw new TypeError('vgpu version must be 0');
  if (value.alphaMode !== undefined && value.alphaMode !== 'premultiplied') throw new TypeError('vgpu alphaMode must be premultiplied');
  if (value.seed !== undefined && !Number.isFinite(value.seed)) throw new TypeError('vgpu seed must be finite');
  if (!Number.isInteger(value.maxReplaySteps) || value.maxReplaySteps < 1) throw new TypeError('vgpu maxReplaySteps must be a positive integer');
  const uniforms = value.uniforms === undefined ? {} : value.uniforms;
  if (!object(uniforms)) throw new TypeError('vgpu uniforms must be an object');
  for (const [key, uniform] of Object.entries(uniforms)) {
    if (!Number.isFinite(uniform) && !(Array.isArray(uniform) && uniform.length >= 2
      && uniform.length <= 4 && uniform.every(Number.isFinite))) throw new TypeError(`vgpu uniform ${key} must be f32 or vec2f/3f/4f`);
  }
  if (!Array.isArray(value.state) || value.state.length < 1 || value.state.length > 8) throw new TypeError('vgpu state must contain 1 to 8 resources');
  const stateIds = new Set();
  const state = value.state.map(resource => {
    keys(resource, resource?.kind === 'buffer' ? ['id', 'kind', 'bytes'] : ['id', 'kind', 'format', 'size'], 'vgpu state');
    if (typeof resource.id !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(resource.id) || stateIds.has(resource.id)) throw new TypeError('vgpu state id must be valid and unique');
    if (resource.kind === 'buffer') {
      if (!Number.isInteger(resource.bytes) || resource.bytes <= 0 || resource.bytes > 67108864 || resource.bytes % 4 !== 0) throw new TypeError('vgpu buffer bytes must be a positive multiple of 4 up to 67108864');
    } else if (resource.kind === 'texture') {
      if (!['rgba16float', 'rgba8unorm', 'r32float', 'rg32float', 'rgba32float'].includes(resource.format)) throw new TypeError('vgpu state texture format is unsupported');
      if (!Array.isArray(resource.size) || resource.size.length !== 2 || !resource.size.every(n => Number.isInteger(n) && n > 0 && n <= 4096)) throw new TypeError('vgpu state texture size must contain two positive integers up to 4096');
    } else throw new TypeError('vgpu state kind must be buffer or texture');
    stateIds.add(resource.id);
    return { ...resource };
  });
  if (!Array.isArray(value.passes) || !value.passes.length) throw new TypeError('vgpu passes must be nonempty');
  const seen = new Set();
  let computing = false;
  const passes = value.passes.map((pass, index) => {
    keys(pass, pass?.kind === 'fragment' ? ['id', 'kind', 'wgsl', 'reads', 'writes'] : ['id', 'kind', 'wgsl', 'reads', 'writes', 'dispatch'], 'vgpu pass');
    if (typeof pass.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(pass.id) || seen.has(pass.id)) throw new TypeError('vgpu pass id must be valid and unique');
    if (typeof pass.wgsl !== 'string' || !pass.wgsl.trim()) throw new TypeError('vgpu pass wgsl must be nonempty');
    if (!['init', 'compute', 'fragment'].includes(pass.kind)) throw new TypeError('vgpu pass kind must be init, compute or fragment');
    const reads = pass.reads === undefined ? [] : pass.reads;
    const writes = pass.writes === undefined ? [] : pass.writes;
    for (const list of [reads, writes]) {
      if (!Array.isArray(list) || list.some(id => typeof id !== 'string' || !stateIds.has(id)) || new Set(list).size !== list.length) throw new TypeError('vgpu reads/writes must reference unique state ids');
    }
    if (pass.kind === 'fragment') {
      if (index !== value.passes.length - 1 || writes.length) throw new TypeError('vgpu fragment must be last and cannot write state');
    } else {
      if (index === value.passes.length - 1) throw new TypeError('vgpu requires one final fragment');
      if (!Array.isArray(pass.dispatch) || pass.dispatch.length !== 3 || !pass.dispatch.every(n => Number.isInteger(n) && n >= 1)) throw new TypeError('vgpu dispatch must contain three positive integers');
      if (pass.kind === 'init' && (computing || reads.length || !writes.length)) throw new TypeError('vgpu init must precede compute, write state and have no reads');
      if (pass.kind === 'compute') computing = true;
    }
    seen.add(pass.id);
    return { ...pass, reads, writes };
  });
  return { ...value, alphaMode: 'premultiplied', seed: value.seed === undefined ? 0 : value.seed, uniforms, state, passes };
}

function classifyVgpuOverlay(source, names) {
  const degraded = reason => ({ classification: "degraded", reason });
  if (/data-akari-3d-scene/iu.test(source)) return degraded("vgpu-condition:three-or-canvas-runtime(data-akari-3d-scene)");
  const remaining = names.filter(name => !["vgpu-runtime", "three-or-canvas-runtime"].includes(name));
  if (remaining.length) return degraded(`vgpu-condition:${remaining.join(",")}`);
  const scripts = [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu)]
    .filter(([, tag]) => /\btype\s*=\s*["']application\/json["']/iu.test(tag) && /\bdata-akari-vgpu-scene(?:\s|=|$)/iu.test(tag));
  if (scripts.length !== 1) return degraded("vgpu-invalid-declaration");
  try {
    const descriptor = validateVgpuDescriptor(JSON.parse(scripts[0][2]));
    return { classification: "vgpu", reason: descriptor.mode === "stateful" ? "vgpu-scene-stateful-direct" : "vgpu-scene-canvas-direct" };
  } catch {
    return degraded("vgpu-invalid-declaration");
  }
}
