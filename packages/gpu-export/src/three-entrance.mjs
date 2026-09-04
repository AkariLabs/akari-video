import { stripHtmlComments } from "../../render-cut/src/html-scan.mjs";

const TIMING_KEYWORDS = new Map([
  ["linear", "linear"],
  ["ease", { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 }],
  ["ease-in", { x1: 0.42, y1: 0, x2: 1, y2: 1 }],
  ["ease-out", { x1: 0, y1: 0, x2: 0.58, y2: 1 }],
  ["ease-in-out", { x1: 0.42, y1: 0, x2: 0.58, y2: 1 }],
]);

const fail = (reason) => ({ ok: false, reason });
const SAMPLED_CHAIN_CSS_PROPERTIES = ["filter", "clip-path", "mask", "backdrop-filter", "mix-blend-mode"];

export function scanThreeSampled(html) {
  const source = stripComments(stripHtmlComments(html));
  const scripts = source.match(/<script\b[^>]*>/giu) ?? [];
  const declarations = scripts.filter((tag) =>
    /\btype\s*=\s*["']application\/json["']/iu.test(tag)
    && /\bdata-akari-3d-scene(?:\s|=|>)/iu.test(tag));
  if (scripts.length !== 1 || declarations.length !== 1) return fail("three-entrance-script-count");

  const parsedElements = sampledElements(source);
  if (!parsedElements.ok) return fail("three-html-animated-descendants");
  const { elements } = parsedElements;
  const root = elements.find((element) => !["script", "style", "link", "meta"].includes(element.tag));
  if (!root) return fail("three-entrance-root-missing");
  const canvas = elements.find((element) => element.tag === "canvas");
  const chain = sampledAncestorChain(root, canvas);
  if (chain === null) return fail("three-entrance-canvas-missing");
  const chainSet = new Set(chain);

  let inlineChainCssProperty = null;
  for (const element of elements) {
    if (!chainSet.has(element) || !element.attributes.has("style")) continue;
    const parsed = parseDeclarations(element.attributes.get("style"));
    if (!parsed.ok) return fail("three-html-animated-descendants");
    inlineChainCssProperty = firstSampledChainCssProperty(parsed.values);
    if (inlineChainCssProperty !== null) break;
  }

  for (const element of elements) {
    const inlineStyle = element.attributes.get("style") ?? "";
    if (/\b(?:animation|transition)(?:-[a-z-]+)?\s*:/iu.test(inlineStyle) && !chainSet.has(element)) {
      return fail("three-html-animated-descendants");
    }
  }

  const styleText = [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/giu)]
    .map((match) => match[1]).join("\n");
  const withoutKeyframes = extractKeyframes(styleText);
  if (!withoutKeyframes.ok) return fail("three-html-animated-descendants");
  const withoutProperties = removeSampledAtRules(withoutKeyframes.css, /@property\s+--[a-z0-9_-]+\s*\{/gimu);
  if (!withoutProperties.ok || /@[a-z_-]+\b/iu.test(withoutProperties.css)) {
    return fail("three-html-animated-descendants");
  }
  const parsedRules = parseRules(withoutProperties.css);
  if (!parsedRules.ok) return fail("three-html-animated-descendants");
  for (const rule of parsedRules.rules) {
    if (!hasDeclaration(rule.declarations, "animation") && !hasDeclaration(rule.declarations, "transition")) continue;
    for (const selector of splitTopLevel(rule.selector, ",")) {
      const compound = rightmostSampledCompound(selector);
      if (compound === null) return fail("three-html-animated-descendants");
      const matches = elements.filter((element) => sampledCompoundMatches(compound, element));
      if (matches.length === 0 || matches.some((element) => !chainSet.has(element))) {
        return fail("three-html-animated-descendants");
      }
    }
  }
  if (inlineChainCssProperty !== null) return fail(`three-sampled-chain-css:${inlineChainCssProperty}`);
  for (const rule of parsedRules.rules) {
    const property = firstSampledChainCssProperty(rule.declarations);
    if (property === null) continue;
    for (const selector of splitTopLevel(rule.selector, ",")) {
      const compound = rightmostSampledCompound(selector);
      if (compound === null) return fail(`three-sampled-chain-css:${property}`);
      if (elements.some((element) => chainSet.has(element) && sampledCompoundMatches(compound, element))) {
        return fail(`three-sampled-chain-css:${property}`);
      }
    }
  }
  const inlineChainStyles = chain
    .map((element) => element.attributes.get("style") ?? "")
    .join("\n");
  for (const keyframe of withoutKeyframes.keyframes) {
    if (!sampledCssNameAppears(withoutKeyframes.css, keyframe.name)
      && !sampledCssNameAppears(inlineChainStyles, keyframe.name)) continue;
    const parsedKeyframe = parseRules(keyframe.body);
    if (!parsedKeyframe.ok) return fail("three-html-animated-descendants");
    for (const rule of parsedKeyframe.rules) {
      const property = firstSampledChainCssProperty(rule.declarations);
      if (property !== null) return fail(`three-sampled-chain-css:${property}`);
    }
  }
  return { ok: true };
}

export function parseThreeEntrance(html, { vars = {}, transform = {}, role = null } = {}) {
  const source = stripComments(stripHtmlComments(html));
  const scripts = source.match(/<script\b[^>]*>/giu) ?? [];
  const declarations = scripts.filter((tag) =>
    /\btype\s*=\s*["']application\/json["']/iu.test(tag)
    && /\bdata-akari-3d-scene(?:\s|=|>)/iu.test(tag));
  if (scripts.length !== 1 || declarations.length !== 1) return fail("three-entrance-script-count");
  if (/@property\b/iu.test(source)) return fail("three-entrance-property");

  const root = rootElement(source);
  if (!root || root.classes.length === 0) return fail("three-entrance-root-element");
  const styleText = [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/giu)]
    .map((match) => match[1]).join("\n");
  if (styleText === "") return fail("three-entrance-animation-rule");

  for (const match of source.matchAll(/<[^>]+\bstyle\s*=\s*(["'])([\s\S]*?)\1[^>]*>/giu)) {
    if (/\btransition(?:-[a-z-]+)?\s*:/iu.test(match[2])) return fail("three-entrance-transition");
    if (/\banimation(?:-[a-z-]+)?\s*:/iu.test(match[2])) return fail("three-entrance-multi-animated-element");
  }

  const extracted = extractKeyframes(styleText);
  if (!extracted.ok) return extracted;
  if (extracted.keyframes.length !== 1) {
    return fail(extracted.keyframes.length > 1
      ? "three-entrance-multiple-keyframes"
      : "three-entrance-keyframes-missing");
  }
  const rules = parseRules(extracted.css);
  if (!rules.ok) return rules;
  if (rules.rules.some((rule) => hasDeclaration(rule.declarations, "transition"))) {
    return fail("three-entrance-transition");
  }
  const animatedRules = rules.rules.filter((rule) => hasDeclaration(rule.declarations, "animation"));
  if (animatedRules.length !== 1) {
    return fail(animatedRules.length > 1
      ? "three-entrance-multi-animated-element"
      : "three-entrance-animation-rule");
  }

  const selector = parseEntranceSelector(animatedRules[0].selector, root.classes);
  if (!selector.ok) return selector;
  const animation = parseAnimation(animatedRules[0].declarations);
  if (!animation.ok) return animation;
  if (animation.name !== extracted.keyframes[0].name) return fail("three-entrance-keyframes-name");

  const keyframes = parseKeyframeEndpoints(extracted.keyframes[0].body, variableEnvironment(vars, transform, role));
  if (!keyframes.ok) return keyframes;
  return {
    ok: true,
    entrance: {
      durationSec: animation.durationSec,
      delaySec: animation.delaySec,
      timing: animation.timing,
      fill: animation.fill,
      from: keyframes.from,
      to: keyframes.to,
    },
  };
}

function stripComments(value) {
  return value.replace(/\/\*[\s\S]*?\*\//gu, "");
}

function sampledElements(html) {
  const withoutRawText = html.replace(
    /<(style|script)\b([^>]*)>([\s\S]*?)<\/\1\s*>/giu,
    (_match, tag, attributes, body) => `<${tag}${attributes}>${" ".repeat(body.length)}</${tag}>`,
  );
  const voidElements = new Set([
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
  ]);
  const elements = [];
  const stack = [];
  for (const token of sampledHtmlTags(withoutRawText)) {
    const closing = token.match(/^<\s*\/\s*([a-z][a-z0-9-]*)\s*>$/iu);
    if (closing) {
      const tag = closing[1].toLowerCase();
      if (stack.length === 0 || stack.at(-1).tag !== tag) return { ok: false, elements: [] };
      stack.pop();
      continue;
    }
    if (/^<\s*[!?]/u.test(token)) continue;
    const match = token.match(/^<\s*([a-z][a-z0-9-]*)\b([\s\S]*?)>$/iu);
    if (!match) return { ok: false, elements: [] };
    const attributes = new Map();
    const body = match[2].replace(/\/\s*$/u, "");
    const pattern = /([^\s=/>]+)(?:\s*=\s*(?:(["'])([\s\S]*?)\2|([^\s>]+)))?/gu;
    for (const attribute of body.matchAll(pattern)) {
      attributes.set(attribute[1].toLowerCase(), attribute[3] ?? attribute[4] ?? "");
    }
    const tag = match[1].toLowerCase();
    const element = { tag, attributes, parent: stack.at(-1) ?? null };
    elements.push(element);
    if (!voidElements.has(tag) && !/\/\s*>$/u.test(token)) stack.push(element);
  }
  return stack.length === 0 ? { ok: true, elements } : { ok: false, elements: [] };
}

function sampledHtmlTags(html) {
  const tags = [];
  let cursor = 0;
  while (cursor < html.length) {
    const open = html.indexOf("<", cursor);
    if (open < 0) break;
    let quote = null;
    let close = -1;
    for (let index = open + 1; index < html.length; index += 1) {
      const character = html[index];
      if (quote) {
        if (character === "\\") index += 1;
        else if (character === quote) quote = null;
      } else if (character === '"' || character === "'") quote = character;
      else if (character === ">") {
        close = index;
        break;
      }
    }
    if (close < 0) return ["<invalid>"];
    tags.push(html.slice(open, close + 1));
    cursor = close + 1;
  }
  return tags;
}

function sampledAncestorChain(root, canvas) {
  if (!canvas) return null;
  const reverse = [];
  for (let element = canvas; element; element = element.parent) {
    reverse.push(element);
    if (element === root) return reverse.reverse();
  }
  return null;
}

function removeSampledAtRules(css, pattern) {
  const spans = [];
  for (const match of css.matchAll(pattern)) {
    const open = match.index + match[0].lastIndexOf("{");
    const close = matchingBrace(css, open);
    if (close < 0) return { ok: false, css: "" };
    spans.push([match.index, close + 1]);
    pattern.lastIndex = close + 1;
  }
  let output = "";
  let cursor = 0;
  for (const [start, end] of spans) {
    output += css.slice(cursor, start);
    cursor = end;
  }
  return { ok: true, css: output + css.slice(cursor) };
}

function rightmostSampledCompound(selector) {
  const value = selector.trim();
  let bracketDepth = 0;
  let quote = null;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "[") bracketDepth += 1;
    else if (character === "]") bracketDepth -= 1;
    else if (bracketDepth === 0 && (/\s/u.test(character) || ">+~".includes(character))) start = index + 1;
  }
  const compound = value.slice(start).trim();
  return compound === "" || bracketDepth !== 0 || /[:*\s>+~]/u.test(compound) ? null : compound;
}

function sampledCompoundMatches(compound, element) {
  let cursor = 0;
  const tag = compound.match(/^[a-z][a-z0-9-]*/iu);
  if (tag) {
    if (tag[0].toLowerCase() !== element.tag) return false;
    cursor = tag[0].length;
  }
  while (cursor < compound.length) {
    const rest = compound.slice(cursor);
    const className = rest.match(/^\.([a-z_][a-z0-9_-]*)/iu);
    if (className) {
      const classes = (element.attributes.get("class") ?? "").split(/\s+/u).filter(Boolean);
      if (!classes.includes(className[1])) return false;
      cursor += className[0].length;
      continue;
    }
    const id = rest.match(/^#([a-z_][a-z0-9_-]*)/iu);
    if (id) {
      if (element.attributes.get("id") !== id[1]) return false;
      cursor += id[0].length;
      continue;
    }
    const attribute = rest.match(/^\[\s*([a-z_][a-z0-9_-]*)(?:\s*=\s*(?:(["'])(.*?)\2|([^\]\s]+)))?\s*\]/iu);
    if (attribute) {
      const name = attribute[1].toLowerCase();
      if (!element.attributes.has(name)) return false;
      const expected = attribute[3] ?? attribute[4];
      if (expected !== undefined && element.attributes.get(name) !== expected) return false;
      cursor += attribute[0].length;
      continue;
    }
    return false;
  }
  return true;
}

function rootElement(html) {
  const withoutLeading = html.replace(/^\s*(?:<!doctype[^>]*>\s*)?/iu, "");
  const match = withoutLeading.match(/^<([a-z][a-z0-9-]*)\b([^>]*)>/iu);
  if (!match || ["script", "style", "link", "meta"].includes(match[1].toLowerCase())) return null;
  const classMatch = match[2].match(/\bclass\s*=\s*(["'])(.*?)\1/iu);
  return {
    tag: match[1].toLowerCase(),
    classes: classMatch ? classMatch[2].trim().split(/\s+/u).filter(Boolean) : [],
  };
}

function extractKeyframes(css) {
  const keyframes = [];
  const spans = [];
  const pattern = /@(?:-webkit-)?keyframes\s+([a-z_][a-z0-9_-]*)\s*\{/giu;
  for (const match of css.matchAll(pattern)) {
    const open = match.index + match[0].lastIndexOf("{");
    const close = matchingBrace(css, open);
    if (close < 0) return fail("three-entrance-css-syntax");
    keyframes.push({ name: match[1], body: css.slice(open + 1, close) });
    spans.push([match.index, close + 1]);
    pattern.lastIndex = close + 1;
  }
  let rest = "";
  let cursor = 0;
  for (const [start, end] of spans) {
    rest += css.slice(cursor, start);
    cursor = end;
  }
  rest += css.slice(cursor);
  return { ok: true, keyframes, css: rest };
}

function matchingBrace(value, open) {
  let depth = 0;
  let quote = null;
  for (let index = open; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) return index;
  }
  return -1;
}

function parseRules(css) {
  const rules = [];
  let cursor = 0;
  while (cursor < css.length) {
    while (cursor < css.length && /\s|;/u.test(css[cursor])) cursor += 1;
    if (cursor >= css.length) break;
    const open = css.indexOf("{", cursor);
    if (open < 0) return fail("three-entrance-css-syntax");
    const close = matchingBrace(css, open);
    if (close < 0) return fail("three-entrance-css-syntax");
    const selector = css.slice(cursor, open).trim();
    if (selector.startsWith("@")) return fail("three-entrance-css-at-rule");
    const declarations = parseDeclarations(css.slice(open + 1, close));
    if (!declarations.ok) return declarations;
    rules.push({ selector, declarations: declarations.values });
    cursor = close + 1;
  }
  return { ok: true, rules };
}

function parseDeclarations(body) {
  const values = new Map();
  for (const declaration of splitTopLevel(body, ";")) {
    if (declaration.trim() === "") continue;
    const colon = topLevelIndexOf(declaration, ":");
    if (colon < 0) return fail("three-entrance-css-syntax");
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim().replace(/\s*!important\s*$/iu, "");
    if (!/^--[a-z0-9_-]+$/iu.test(property) && !/^-?[a-z][a-z0-9-]*$/iu.test(property)) {
      return fail("three-entrance-css-syntax");
    }
    if (values.has(property)) return fail(`three-entrance-duplicate-property:${property}`);
    values.set(property, value);
  }
  return { ok: true, values };
}

function hasDeclaration(declarations, prefix) {
  return [...declarations.keys()].some((property) => property === prefix || property.startsWith(`${prefix}-`));
}

function firstSampledChainCssProperty(declarations) {
  for (const prefix of SAMPLED_CHAIN_CSS_PROPERTIES) {
    const property = [...declarations.keys()]
      .find((name) => name === prefix || name.startsWith(`${prefix}-`));
    if (property !== undefined) return property;
  }
  return null;
}

function sampledCssNameAppears(css, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "iu").test(css);
}

function parseEntranceSelector(value, rootClasses) {
  const selectors = splitTopLevel(value, ",").map((part) => part.trim().replace(/\s+/gu, " "));
  if (selectors.length !== 2) return fail("three-entrance-selector");
  const matched = selectors.map((selector) => selector.match(/^\[data-(akari-active|no-timeline)\]\s+\.([a-z_][a-z0-9_-]*)$/iu));
  if (matched.some((match) => !match)) return fail("three-entrance-selector");
  const modes = new Set(matched.map((match) => match[1].toLowerCase()));
  const classes = new Set(matched.map((match) => match[2]));
  if (modes.size !== 2 || classes.size !== 1 || !rootClasses.includes(matched[0][2])) {
    return fail("three-entrance-selector");
  }
  return { ok: true };
}

function parseAnimation(declarations) {
  const supported = new Set([
    "animation", "animation-name", "animation-duration", "animation-timing-function",
    "animation-delay", "animation-iteration-count", "animation-direction", "animation-fill-mode",
    "animation-play-state",
  ]);
  for (const property of declarations.keys()) {
    if (property.startsWith("animation") && !supported.has(property)) {
      return fail(`three-entrance-animation-property:${property}`);
    }
  }
  if (declarations.has("animation") && [...declarations.keys()].some((key) => key !== "animation" && key.startsWith("animation-"))) {
    return fail("three-entrance-animation-mixed-syntax");
  }
  if (declarations.has("animation")) return parseAnimationShorthand(declarations.get("animation"));
  return parseAnimationLonghands(declarations);
}

function parseAnimationShorthand(value) {
  if (splitTopLevel(value, ",").length !== 1) return fail("three-entrance-multiple-animation");
  const tokens = splitWhitespace(value);
  let name = null;
  let durationSec = null;
  let delaySec = 0;
  let timeCount = 0;
  let timing = null;
  let fill = null;
  let iteration = 1;
  let direction = "normal";
  let playState = "running";
  for (const token of tokens) {
    const time = parseTime(token);
    if (time !== null) {
      if (timeCount === 0) durationSec = time;
      else if (timeCount === 1) delaySec = time;
      else return fail("three-entrance-animation-shorthand");
      timeCount += 1;
      continue;
    }
    const parsedTiming = parseTiming(token);
    if (parsedTiming !== null) {
      if (timing !== null) return fail("three-entrance-animation-shorthand");
      timing = parsedTiming;
      continue;
    }
    if (["both", "forwards", "backwards", "none"].includes(token.toLowerCase())) {
      if (fill !== null) return fail("three-entrance-animation-shorthand");
      fill = token.toLowerCase();
      continue;
    }
    if (["normal", "reverse", "alternate", "alternate-reverse"].includes(token.toLowerCase())) {
      direction = token.toLowerCase();
      continue;
    }
    if (["running", "paused"].includes(token.toLowerCase())) {
      playState = token.toLowerCase();
      continue;
    }
    if (token.toLowerCase() === "infinite" || /^\d*\.?\d+$/u.test(token)) {
      iteration = token.toLowerCase() === "infinite" ? Number.POSITIVE_INFINITY : Number(token);
      continue;
    }
    if (name !== null) return fail("three-entrance-multiple-animation");
    name = token;
  }
  return validateAnimation({ name, durationSec, delaySec, timing: timing ?? TIMING_KEYWORDS.get("ease"), fill, iteration, direction, playState });
}

function parseAnimationLonghands(declarations) {
  const single = (name, fallback = null) => {
    const value = declarations.get(name) ?? fallback;
    return value !== null && splitTopLevel(value, ",").length === 1 ? value.trim() : null;
  };
  const name = single("animation-name");
  const durationValue = single("animation-duration");
  const timingValue = single("animation-timing-function", "ease");
  const delayValue = single("animation-delay", "0s");
  const iterationValue = single("animation-iteration-count", "1");
  const direction = single("animation-direction", "normal")?.toLowerCase();
  const fill = single("animation-fill-mode")?.toLowerCase();
  const playState = single("animation-play-state", "running")?.toLowerCase();
  if ([name, durationValue, timingValue, delayValue, iterationValue, direction, playState].some((value) => value === null)) {
    return fail("three-entrance-multiple-animation");
  }
  const timing = parseTiming(timingValue);
  const iteration = iterationValue.toLowerCase() === "infinite" ? Number.POSITIVE_INFINITY : Number(iterationValue);
  return validateAnimation({
    name,
    durationSec: parseTime(durationValue),
    delaySec: parseTime(delayValue),
    timing,
    fill,
    iteration,
    direction,
    playState,
  });
}

function validateAnimation(value) {
  if (!value.name || value.name.toLowerCase() === "none") return fail("three-entrance-animation-name");
  if (!(Number.isFinite(value.durationSec) && value.durationSec > 0)) return fail("three-entrance-duration");
  if (!(Number.isFinite(value.delaySec) && value.delaySec >= 0)) return fail("three-entrance-delay");
  if (value.timing === null) return fail("three-entrance-timing");
  if (!Number.isFinite(value.iteration) || value.iteration !== 1) return fail("three-entrance-iteration-count");
  if (value.direction !== "normal") {
    return fail(value.direction?.startsWith("alternate") ? "three-entrance-alternate" : "three-entrance-direction");
  }
  if (value.playState !== "running") return fail("three-entrance-play-state");
  if (!new Set(["both", "forwards"]).has(value.fill)) return fail("three-entrance-fill-mode");
  return { ok: true, ...value };
}

function parseTime(value) {
  const match = String(value).trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(ms|s)$/iu);
  if (!match) return null;
  return Number(match[1]) / (match[2].toLowerCase() === "ms" ? 1000 : 1);
}

function parseTiming(value) {
  const normalized = String(value).trim().toLowerCase();
  if (TIMING_KEYWORDS.has(normalized)) return TIMING_KEYWORDS.get(normalized);
  const match = normalized.match(/^cubic-bezier\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^\)]+)\)$/u);
  if (!match) return null;
  const numbers = match.slice(1).map(Number);
  if (!numbers.every(Number.isFinite) || numbers[0] < 0 || numbers[0] > 1 || numbers[2] < 0 || numbers[2] > 1) return null;
  return { x1: numbers[0], y1: numbers[1], x2: numbers[2], y2: numbers[3] };
}

function parseKeyframeEndpoints(body, environment) {
  const parsed = parseRules(body);
  if (!parsed.ok) return parsed;
  const endpoints = new Map();
  for (const rule of parsed.rules) {
    for (const selector of splitTopLevel(rule.selector, ",").map((value) => value.trim().toLowerCase())) {
      const position = selector === "from" || selector === "0%" ? 0
        : selector === "to" || selector === "100%" ? 100 : null;
      if (position === null || endpoints.has(position)) return fail("three-entrance-multi-keyframe");
      endpoints.set(position, rule.declarations);
    }
  }
  if (endpoints.size !== 2 || !endpoints.has(0) || !endpoints.has(100)) return fail("three-entrance-multi-keyframe");
  const from = parseKeyframeState(endpoints.get(0), environment);
  if (!from.ok) return from;
  const to = parseKeyframeState(endpoints.get(100), environment);
  if (!to.ok) return to;
  return { ok: true, from: from.state, to: to.state };
}

function parseKeyframeState(declarations, environment) {
  for (const property of declarations.keys()) {
    if (!new Set(["opacity", "transform"]).has(property)) {
      return fail(`three-entrance-unsupported-property:${property}`);
    }
  }
  if (!declarations.has("opacity") || !declarations.has("transform")) return fail("three-entrance-incomplete-keyframe");
  const opacity = Number(declarations.get("opacity"));
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) return fail("three-entrance-unresolved-value");
  const transform = parseTransform(declarations.get("transform"), environment);
  if (!transform.ok) return transform;
  return { ok: true, state: { opacity, ...transform.state } };
}

function parseTransform(value, environment) {
  const state = { tx: 0, ty: 0, sx: 1, sy: 1 };
  const assigned = new Set();
  let cursor = 0;
  while (cursor < value.length) {
    while (/\s/u.test(value[cursor] ?? "")) cursor += 1;
    if (cursor >= value.length) break;
    const match = value.slice(cursor).match(/^([a-z][a-z0-9]*)\s*\(/iu);
    if (!match) return fail("three-entrance-unresolved-value");
    const name = match[1].toLowerCase();
    if (!["translate", "translatex", "translatey", "scale", "scalex", "scaley"].includes(name)) {
      return fail(`three-entrance-unsupported-property:${name}`);
    }
    const open = cursor + match[0].lastIndexOf("(");
    const close = matchingParen(value, open);
    if (close < 0) return fail("three-entrance-unresolved-value");
    const args = splitFunctionArguments(value.slice(open + 1, close));
    const result = applyTransformFunction(state, assigned, name, args, environment);
    if (!result.ok) return result;
    cursor = close + 1;
  }
  return { ok: true, state };
}

function applyTransformFunction(state, assigned, name, args, environment) {
  const set = (key, value) => {
    if (assigned.has(key) || value === null) return false;
    assigned.add(key);
    state[key] = value;
    return true;
  };
  if (name === "translate") {
    if (args.length < 1 || args.length > 2) return fail("three-entrance-unresolved-value");
    const x = resolveCssValue(args[0], "length", environment);
    const y = args.length === 2 ? resolveCssValue(args[1], "length", environment) : 0;
    return set("tx", x) && set("ty", y) ? { ok: true } : fail("three-entrance-unresolved-value");
  }
  if (name === "translatex" || name === "translatey") {
    if (args.length !== 1) return fail("three-entrance-unresolved-value");
    const key = name === "translatex" ? "tx" : "ty";
    return set(key, resolveCssValue(args[0], "length", environment)) ? { ok: true } : fail("three-entrance-unresolved-value");
  }
  if (name === "scale") {
    if (args.length < 1 || args.length > 2) return fail("three-entrance-unresolved-value");
    const x = resolveCssValue(args[0], "scale", environment);
    const y = args.length === 2 ? resolveCssValue(args[1], "scale", environment) : x;
    return set("sx", x) && set("sy", y) ? { ok: true } : fail("three-entrance-unresolved-value");
  }
  if (args.length !== 1) return fail("three-entrance-unresolved-value");
  const key = name === "scalex" ? "sx" : "sy";
  return set(key, resolveCssValue(args[0], "scale", environment)) ? { ok: true } : fail("three-entrance-unresolved-value");
}

function variableEnvironment(vars, transform, role) {
  const background = role === "background";
  const environment = {
    "--x": `${background ? 0 : Number(transform?.x ?? 0)}px`,
    "--y": `${background ? 0 : Number(transform?.y ?? 0)}px`,
    "--scale": String(background ? 1 : Number(transform?.scale ?? 1)),
    ...(vars ?? {}),
  };
  Object.defineProperty(environment, "semanticTransform", {
    enumerable: false,
    value: background
      ? { x: "0px", y: "0px", scale: "1" }
      : {
        ...(Object.hasOwn(transform ?? {}, "x") ? { x: `${Number(transform.x)}px` } : {}),
        ...(Object.hasOwn(transform ?? {}, "y") ? { y: `${Number(transform.y)}px` } : {}),
        ...(Object.hasOwn(transform ?? {}, "scale") ? { scale: String(Number(transform.scale)) } : {}),
      },
  });
  return environment;
}

function resolveCssValue(value, kind, environment, seen = new Set()) {
  const source = String(value).trim();
  const plain = kind === "length"
    ? source.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(px)?$/iu)
    : source.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))$/u);
  if (plain && (kind !== "length" || plain[2] || Number(plain[1]) === 0)) return Number(plain[1]);

  const variable = parseVariable(source);
  if (variable) return resolveVariable(variable, kind, environment, seen);
  if (!/^calc\([\s\S]*\)$/iu.test(source)) return null;
  const inner = source.slice(source.indexOf("(") + 1, -1).trim();
  if (kind === "length") {
    const match = inner.match(/^(var\([\s\S]*\))\s*\+\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))px$/iu);
    if (!match) return null;
    const base = resolveCssValue(match[1], kind, environment, seen);
    return base === null ? null : base + Number(match[2]);
  }
  const match = inner.match(/^(var\([\s\S]*\))\s*\*\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))$/iu);
  if (!match) return null;
  const base = resolveCssValue(match[1], kind, environment, seen);
  return base === null ? null : base * Number(match[2]);
}

function parseVariable(value) {
  const match = value.match(/^var\(\s*(--[a-z0-9_-]+)\s*(?:,\s*([\s\S]*))?\)$/iu);
  return match ? { name: match[1], fallback: match[2]?.trim() } : null;
}

function resolveVariable(variable, kind, environment, seen) {
  if (seen.has(variable.name)) return null;
  const nextSeen = new Set(seen).add(variable.name);
  let source = environment[variable.name];
  if (!Object.hasOwn(environment, variable.name)) {
    const semantic = kind === "scale" && /-scale$/iu.test(variable.name) ? "scale"
      : kind === "length" && /-x$/iu.test(variable.name) ? "x"
      : kind === "length" && /-y$/iu.test(variable.name) ? "y"
      : null;
    source = semantic && Object.hasOwn(environment.semanticTransform, semantic)
      ? environment.semanticTransform[semantic]
      : variable.fallback ?? (kind === "length" ? "0px" : "1");
  }
  return resolveCssValue(source, kind, environment, nextSeen);
}

function matchingParen(value, open) {
  let depth = 0;
  for (let index = open; index < value.length; index += 1) {
    if (value[index] === "(") depth += 1;
    else if (value[index] === ")" && --depth === 0) return index;
  }
  return -1;
}

function splitFunctionArguments(value) {
  const commaSeparated = splitTopLevel(value, ",").map((argument) => argument.trim());
  return commaSeparated.length > 1 ? commaSeparated : splitWhitespace(value);
}

function splitWhitespace(value) {
  const tokens = [];
  let start = null;
  let depth = 0;
  for (let index = 0; index <= value.length; index += 1) {
    const character = value[index];
    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    if (index === value.length || (depth === 0 && /\s/u.test(character))) {
      if (start !== null) tokens.push(value.slice(start, index));
      start = null;
    } else if (start === null) start = index;
  }
  return tokens;
}

function splitTopLevel(value, separator) {
  const parts = [];
  let cursor = 0;
  let depth = 0;
  let quote = null;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    else if (character === separator && depth === 0) {
      parts.push(value.slice(cursor, index));
      cursor = index + 1;
    }
  }
  parts.push(value.slice(cursor));
  return parts;
}

function topLevelIndexOf(value, needle) {
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "(") depth += 1;
    else if (value[index] === ")") depth -= 1;
    else if (value[index] === needle && depth === 0) return index;
  }
  return -1;
}
