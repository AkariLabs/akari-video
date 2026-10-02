import { maskHtmlFragmentContents } from "./html-fragment.mjs";

export function parseOverlayStyles(html) {
  const result = { keyframes: new Map(), rules: [] };
  const maskedHtml = maskHtmlFragmentContents(html);
  const stylePattern = /<style\b[^>]*>[\s\S]*?<\/style\s*>/gi;
  for (const match of maskedHtml.matchAll(stylePattern)) {
    const openingTag = match[0].match(/^<style\b[^>]*>/i);
    const closingOffset = match[0].toLowerCase().lastIndexOf("</style");
    if (openingTag === null || closingOffset < openingTag[0].length) continue;
    const start = match.index + openingTag[0].length;
    const end = match.index + closingOffset;
    const css = stripCssComments(html.slice(start, end));
    if (css !== null) parseCssRuleList(css, result);
  }
  return result;
}

function stripCssComments(css) {
  let output = "";
  let quote = null;
  for (let index = 0; index < css.length; index += 1) {
    const character = css[index];
    if (quote !== null) {
      output += character;
      if (character === "\\" && index + 1 < css.length) output += css[++index];
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      output += character;
      continue;
    }
    if (character === "/" && css[index + 1] === "*") {
      const close = css.indexOf("*/", index + 2);
      if (close < 0) return null;
      output += " ";
      index = close + 1;
      continue;
    }
    output += character;
  }
  return quote === null ? output : null;
}

function parseCssRuleList(css, result) {
  let cursor = 0;
  while (cursor < css.length) {
    while (cursor < css.length && /[\s;]/u.test(css[cursor])) cursor += 1;
    if (cursor >= css.length) return;
    const delimiter = nextCssRuleDelimiter(css, cursor);
    if (delimiter === null) return;
    if (delimiter.character === ";") {
      cursor = delimiter.index + 1;
      continue;
    }
    const header = css.slice(cursor, delimiter.index).trim();
    const close = matchingCssBrace(css, delimiter.index);
    if (header === "" || close < 0) return;
    const body = css.slice(delimiter.index + 1, close);
    const keyframesMatch = header.match(/^@(?:-webkit-)?keyframes\s+([_a-z][_a-z0-9-]*)$/i);
    if (keyframesMatch !== null) {
      const keyframes = parseKeyframeSteps(keyframesMatch[1], body);
      if (keyframes !== null) result.keyframes.set(keyframes.name, keyframes);
    } else if (header.startsWith("@")) {
      parseCssRuleList(body, result);
    } else {
      const declarations = parseCssDeclarations(body);
      if (declarations !== null) result.rules.push({ selector: header, declarations });
    }
    cursor = close + 1;
  }
}

function nextCssRuleDelimiter(css, start) {
  let quote = null;
  let parentheses = 0;
  let brackets = 0;
  for (let index = start; index < css.length; index += 1) {
    const character = css[index];
    if (quote !== null) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(") parentheses += 1;
    else if (character === ")") parentheses -= 1;
    else if (character === "[") brackets += 1;
    else if (character === "]") brackets -= 1;
    else if ((character === "{" || character === ";") && parentheses === 0 && brackets === 0) {
      return { character, index };
    }
    if (parentheses < 0 || brackets < 0) return null;
  }
  return null;
}

function matchingCssBrace(css, open) {
  let depth = 0;
  let quote = null;
  for (let index = open; index < css.length; index += 1) {
    const character = css[index];
    if (quote !== null) {
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

function parseKeyframeSteps(name, body) {
  const steps = new Map();
  let cursor = 0;
  while (cursor < body.length) {
    while (cursor < body.length && /[\s;]/u.test(body[cursor])) cursor += 1;
    if (cursor >= body.length) break;
    const delimiter = nextCssRuleDelimiter(body, cursor);
    if (delimiter === null || delimiter.character !== "{") return null;
    const close = matchingCssBrace(body, delimiter.index);
    if (close < 0) return null;
    const selectorText = body.slice(cursor, delimiter.index).trim();
    const selectors = splitCssTopLevel(selectorText, ",");
    const declarations = parseCssDeclarations(body.slice(delimiter.index + 1, close));
    if (selectors === null || declarations === null) return null;
    const offsets = selectors.map(keyframeOffset);
    if (offsets.some((offset) => offset === null)) return null;
    for (const offset of offsets) {
      const merged = steps.get(offset) ?? new Map();
      for (const [property, value] of declarations) merged.set(property, value);
      steps.set(offset, merged);
    }
    cursor = close + 1;
  }
  return { name, steps };
}

function keyframeOffset(value) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "from") return 0;
  if (normalized === "to") return 100;
  const match = normalized.match(/^((?:\d+(?:\.\d*)?|\.\d+))%$/);
  if (match === null) return null;
  const offset = Number(match[1]);
  return Number.isFinite(offset) && offset >= 0 && offset <= 100 ? offset : null;
}

function parseCssDeclarations(body) {
  const declarations = new Map();
  const parts = splitCssTopLevel(body, ";");
  if (parts === null) return null;
  for (const part of parts) {
    if (part.trim() === "") continue;
    const colon = cssTopLevelIndexOf(part, ":");
    if (colon < 0) return null;
    const property = part.slice(0, colon).trim().toLowerCase();
    const value = part.slice(colon + 1).trim().replace(/\s*!important\s*$/i, "");
    if (
      value === ""
      || (!/^--[_a-z0-9-]+$/i.test(property) && !/^-?[_a-z][_a-z0-9-]*$/i.test(property))
    ) return null;
    declarations.set(property, value);
  }
  return declarations;
}

export function splitCssTopLevel(value, separator) {
  const parts = [];
  let cursor = 0;
  let quote = null;
  let parentheses = 0;
  let brackets = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote !== null) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(") parentheses += 1;
    else if (character === ")") parentheses -= 1;
    else if (character === "[") brackets += 1;
    else if (character === "]") brackets -= 1;
    else if (character === separator && parentheses === 0 && brackets === 0) {
      parts.push(value.slice(cursor, index));
      cursor = index + 1;
    } else if ((character === "{" || character === "}") && parentheses === 0 && brackets === 0) {
      return null;
    }
    if (parentheses < 0 || brackets < 0) return null;
  }
  if (quote !== null || parentheses !== 0 || brackets !== 0) return null;
  parts.push(value.slice(cursor));
  return parts;
}

function cssTopLevelIndexOf(value, needle) {
  let quote = null;
  let parentheses = 0;
  let brackets = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote !== null) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(") parentheses += 1;
    else if (character === ")") parentheses -= 1;
    else if (character === "[") brackets += 1;
    else if (character === "]") brackets -= 1;
    else if (character === needle && parentheses === 0 && brackets === 0) return index;
  }
  return -1;
}

export function missingProperties(properties, declarations) {
  if (declarations === undefined) return [...properties].sort();
  return [...properties].filter((property) => !declarations.has(property)).sort();
}

export function normalizeMotionSelector(selector) {
  const collapsed = selector.trim().replace(/\s+/gu, " ");
  if (collapsed === "") return null;
  const gate = collapsed.match(/^\[data-(?:akari-active|no-timeline)\]\s+/i);
  const normalized = gate === null ? collapsed : collapsed.slice(gate[0].length).trim();
  return normalized === "" ? null : { selector: normalized, gated: gate !== null };
}

export function referencedKeyframeNames(declarations, keyframesByName) {
  const names = new Set();
  const animationName = declarations.get("animation-name");
  if (animationName !== undefined) {
    const values = splitCssTopLevel(animationName, ",");
    if (values !== null) {
      for (const value of values) {
        const name = value.trim();
        if (keyframesByName.has(name)) names.add(name);
      }
    }
  }
  const animation = declarations.get("animation");
  if (animation === undefined) return names;
  const animations = splitCssTopLevel(animation, ",");
  if (animations === null) return names;
  for (const value of animations) {
    const tokens = splitCssWhitespace(value);
    if (tokens === null) continue;
    for (const token of tokens) if (keyframesByName.has(token)) names.add(token);
  }
  return names;
}

function splitCssWhitespace(value) {
  const tokens = [];
  let cursor = null;
  let quote = null;
  let parentheses = 0;
  for (let index = 0; index <= value.length; index += 1) {
    const character = value[index];
    if (quote !== null) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(") parentheses += 1;
    else if (character === ")") parentheses -= 1;
    if (index === value.length || (parentheses === 0 && /\s/u.test(character))) {
      if (cursor !== null) tokens.push(value.slice(cursor, index));
      cursor = null;
    } else if (cursor === null) {
      cursor = index;
    }
    if (parentheses < 0) return null;
  }
  return quote === null && parentheses === 0 ? tokens : null;
}

export function baseHiddenState(declarations) {
  const opacity = declarations.has("opacity") && isCssNumericZero(declarations.get("opacity"), false);
  const transform = declarations.has("transform") && transformHasZeroScale(declarations.get("transform"));
  const visibility = declarations.get("visibility")?.trim().toLowerCase() === "hidden";
  return opacity || transform || visibility ? { opacity, transform, visibility } : null;
}

export function endpointClearsHiddenState(declarations, hiddenState) {
  if (hiddenState === null) return false;
  const opacity = declarations.get("opacity");
  const transform = declarations.get("transform");
  const visibility = declarations.get("visibility");
  if (opacity !== undefined && !isPositiveCssNumber(opacity)) return false;
  if (transform !== undefined && transformHasZeroScale(transform)) return false;
  if (visibility?.trim().toLowerCase() === "hidden") return false;
  if (hiddenState.opacity && (opacity === undefined || !isPositiveCssNumber(opacity))) return false;
  if (hiddenState.transform && (transform === undefined || transformHasZeroScale(transform))) return false;
  if (hiddenState.visibility && visibility?.trim().toLowerCase() !== "visible") return false;
  return true;
}

function isCssNumericZero(value, allowPercent) {
  const unit = allowPercent ? "%?" : "";
  return new RegExp(`^[+-]?(?:0+(?:\\.0*)?|\\.0+)${unit}$`).test(value.trim());
}

function isPositiveCssNumber(value) {
  const match = value.trim().match(/^([+]?(?:\d+(?:\.\d*)?|\.\d+))(%?)$/);
  return match !== null && Number(match[1]) > 0;
}

function transformHasZeroScale(value) {
  let cursor = 0;
  while (cursor < value.length) {
    while (cursor < value.length && /\s/u.test(value[cursor])) cursor += 1;
    if (cursor >= value.length) break;
    const match = value.slice(cursor).match(/^([_a-z][_a-z0-9-]*)\s*\(/i);
    if (match === null) return false;
    const open = cursor + match[0].lastIndexOf("(");
    const close = matchingCssParenthesis(value, open);
    if (close < 0) return false;
    const name = match[1].toLowerCase();
    const argumentsText = value.slice(open + 1, close);
    const args = splitCssTopLevel(argumentsText, ",");
    if (args === null) return false;
    if (["scale", "scalex", "scaley"].includes(name)
      && args.length === 1
      && isCssNumericZero(args[0], true)) return true;
    if (name === "scale3d" && args.length === 3 && args.some((arg) => isCssNumericZero(arg, true))) {
      return true;
    }
    cursor = close + 1;
  }
  return false;
}

function matchingCssParenthesis(value, open) {
  let depth = 0;
  let quote = null;
  for (let index = open; index < value.length; index += 1) {
    const character = value[index];
    if (quote !== null) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(") depth += 1;
    else if (character === ")" && --depth === 0) return index;
  }
  return -1;
}

