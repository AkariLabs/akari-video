import { readFileSync } from "node:fs";

import { lintLanguage } from "../i18n.mjs";
import { maskHtmlFragmentContents, parseHtmlAttributes } from "./html-fragment.mjs";
import { normalizeMotionSelector, parseOverlayStyles, splitCssTopLevel } from "./overlay-css.mjs";
import { addFinding } from "./shared.mjs";

// box-sizing は継承しないので、要素ごとに「その要素へ実際に効く」宣言を解決する。
// メッセージ本文だけを JSON に置くのは、i18n カタログ（packages/i18n）がこのレーンの
// ファイル境界の外にあるため。文言は将来カタログへ移せる。
const MESSAGES = (() => {
  try {
    return JSON.parse(readFileSync(new URL("./box-sizing-messages.json", import.meta.url), "utf8"));
  } catch {
    return { en: "Overlay fragment element {element} has no effective box-sizing." };
  }
})();

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
  "meta", "param", "source", "track", "wbr",
]);

const DYNAMIC_PSEUDO_CLASSES = new Set([
  "active", "checked", "default", "disabled", "empty", "enabled", "focus",
  "focus-visible", "focus-within", "hover", "indeterminate", "invalid", "link",
  "optional", "out-of-range", "paused", "placeholder-shown", "playing", "read-only",
  "read-write", "required", "target", "valid", "visited",
]);

const PADDING_PROPERTY = /^padding(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?$/u;
const BORDER_PROPERTY = /^border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?(?:-width)?|-width)?$/u;
const BORDER_STYLE_PROPERTY = /^border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?-style$/u;

export function validateFragmentBoxSizing(html, path, findings) {
  if (typeof html !== "string" || !/<[A-Za-z!/]/u.test(html)) return;
  const elements = parseElements(html);
  if (elements.length === 0) return;
  const parsed = parseOverlayStyles(html);
  const rules = [];
  for (const rule of parsed.rules) {
    const selectors = splitCssTopLevel(rule.selector, ",");
    if (selectors === null) continue;
    for (const raw of selectors) {
      const parsedSelector = parseSelector(raw);
      if (parsedSelector === null) continue;
      rules.push({
        selector: raw.trim(),
        parsed: parsedSelector,
        specificity: selectorSpecificity(raw),
        declarations: rule.declarations,
      });
    }
  }

  const computedBoxSizing = new Map();
  for (const element of elements) {
    const declarations = cascade(element, rules);
    let boxSizing = "content-box";
    const declared = declarations.get("box-sizing")?.value;
    if (declared !== undefined) boxSizing = normalizeBoxSizing(declared, element, computedBoxSizing);
    computedBoxSizing.set(element, boxSizing);
    if (boxSizing === "border-box") continue;

    const width = firstDeclaration(declarations, ["width", "inline-size"]);
    const height = firstDeclaration(declarations, ["height", "block-size"]);
    if (!isFixedSize(width) && !isFixedSize(height)) continue;
    if (!hasNonZeroPadding(declarations) && !hasNonZeroBorder(declarations)) continue;

    const elementLabel = describeElement(element);
    const message = (MESSAGES[lintLanguage()] ?? MESSAGES.en).replace("{element}", elementLabel);
    addFinding(findings, {
      severity: "warning",
      check: "overlays.box-sizing",
      message,
      path,
    });
  }
}

function parseElements(html) {
  const masked = maskHtmlFragmentContents(html);
  const tokenPattern = /<!--[\s\S]*?-->|<![^>]*>|<\/?[A-Za-z][^>]*>/gu;
  const elements = [];
  const stack = [];
  for (const match of masked.matchAll(tokenPattern)) {
    const token = match[0];
    if (token.startsWith("<!--") || token.startsWith("<!")) continue;
    const nameMatch = token.match(/^<\/?\s*([A-Za-z][\w:-]*)/u);
    if (nameMatch === null) continue;
    const tag = nameMatch[1].toLowerCase();
    if (/^<\//u.test(token)) {
      for (let index = stack.length - 1; index >= 0; index -= 1) {
        if (stack[index].tag === tag) {
          stack.length = index;
          break;
        }
      }
      continue;
    }
    const attributes = parseHtmlAttributes(token);
    const element = {
      tag,
      id: attributes.id ?? "",
      classes: (attributes.class ?? "").split(/\s+/u).filter(Boolean),
      attributes,
      parent: stack.at(-1) ?? null,
      inline: parseInlineDeclarations(attributes.style ?? ""),
    };
    if (tag !== "style" && tag !== "script") elements.push(element);
    if (!VOID_ELEMENTS.has(tag) && !/\/\s*>$/u.test(token)) stack.push(element);
  }
  return elements;
}

function parseInlineDeclarations(style) {
  const declarations = new Map();
  if (style.trim() === "") return declarations;
  for (const part of style.split(";")) {
    const colon = part.indexOf(":");
    if (colon < 0) continue;
    const property = part.slice(0, colon).trim().toLowerCase();
    const value = part.slice(colon + 1).trim().replace(/\s*!important\s*$/iu, "");
    if (property !== "" && value !== "") declarations.set(property, value);
  }
  return declarations;
}

function cascade(element, rules) {
  const declarations = new Map();
  const apply = (property, value, weight) => {
    const previous = declarations.get(property);
    if (previous !== undefined && previous.weight > weight) return;
    declarations.set(property, { value, weight });
  };
  for (const rule of rules) {
    if (!selectorMatches(element, rule.parsed)) continue;
    for (const [property, value] of rule.declarations) apply(property, value, rule.specificity);
  }
  // インライン style は詳細度で最優先（!important はここでは区別しない）。
  for (const [property, value] of element.inline) apply(property, value, Number.MAX_SAFE_INTEGER);
  return declarations;
}

function normalizeBoxSizing(value, element, computedBoxSizing) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "border-box") return "border-box";
  if (normalized === "inherit") return element.parent === null
    ? "content-box" : computedBoxSizing.get(element.parent) ?? "content-box";
  return "content-box";
}

function firstDeclaration(declarations, properties) {
  for (const property of properties) {
    const entry = declarations.get(property);
    if (entry !== undefined) return entry.value;
  }
  return undefined;
}

function isFixedSize(value) {
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  if (normalized === "" || normalized === "0") return false;
  if (/^(?:auto|none|initial|inherit|unset|revert|revert-layer)$/u.test(normalized)) return false;
  if (/^(?:min|max|fit|stretch|available|fill)-content$/u.test(normalized)) return false;
  if (/\bvar\(/u.test(normalized)) return true;
  if (/^(?:calc|clamp|min|max)\(/u.test(normalized)) return true;
  const length = normalized.match(/^([-+]?(?:\d*\.\d+|\d+))(?:[a-z%]+)$/iu);
  return length !== null && Number(length[1]) > 0;
}

function hasNonZeroPadding(declarations) {
  for (const [property, entry] of declarations) {
    if (PADDING_PROPERTY.test(property) && valueAddsSpace(entry.value, false)) return true;
  }
  return false;
}

function hasNonZeroBorder(declarations) {
  for (const [property, entry] of declarations) {
    if (BORDER_PROPERTY.test(property) && valueAddsSpace(entry.value, true)) return true;
    if (BORDER_STYLE_PROPERTY.test(property) && !/^(?:none|hidden|initial|inherit|unset)$/iu.test(entry.value.trim())) return true;
  }
  return false;
}

function valueAddsSpace(value, border) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "") return false;
  if (/\bvar\(/u.test(normalized)) return true;
  if (border && /^(?:none|hidden)$/u.test(normalized)) return false;
  if (border && /^(?:thin|medium|thick)$/u.test(normalized)) return true;
  const numbers = [...normalized.matchAll(/[-+]?(?:\d*\.\d+|\d+)/gu)].map((match) => Number(match[0]));
  if (numbers.length > 0) return numbers.some((number) => number !== 0);
  return !/^(?:initial|inherit|unset|revert|revert-layer|auto)$/u.test(normalized);
}

function describeElement(element) {
  let label = element.tag;
  if (element.id !== "") label += `#${element.id}`;
  for (const className of element.classes) label += `.${className}`;
  return label;
}

function parseSelector(raw) {
  const normalized = normalizeMotionSelector(raw);
  if (normalized === null) return null;
  if (/::|:(?:before|after)\b/iu.test(normalized.selector)) return null;
  const tokens = normalized.selector.replace(/>/gu, " > ").trim().split(/\s+/u);
  const compounds = [];
  const combinators = [];
  for (const token of tokens) {
    if (token === "" || token === "+" || token === "~") return null;
    if (token === ">") {
      if (compounds.length === 0 || combinators.length === compounds.length) return null;
      combinators.push(">");
      continue;
    }
    const parsedCompound = parseCompound(token);
    if (parsedCompound === null) return null;
    compounds.push(parsedCompound);
    if (compounds.length > 1 && combinators.length < compounds.length - 1) combinators.push(" ");
  }
  if (compounds.length === 0 || combinators.length !== compounds.length - 1) return null;
  return { compounds, combinators };
}

function parseCompound(text) {
  const tests = [];
  let index = 0;
  const tagMatch = /^([A-Za-z][\w:-]*|\*)/u.exec(text);
  if (tagMatch !== null) {
    if (tagMatch[0] !== "*") tests.push({ type: "tag", value: tagMatch[0].toLowerCase() });
    index = tagMatch[0].length;
  }
  while (index < text.length) {
    const character = text[index];
    if (character === "#" || character === ".") {
      const ident = readIdentifier(text, index + 1);
      if (ident === null) return null;
      tests.push({ type: character === "#" ? "id" : "class", value: ident.value });
      index = ident.end;
    } else if (character === "[") {
      const close = findClosing(text, index, "[", "]");
      if (close < 0) return null;
      const attribute = parseAttributeSelector(text.slice(index + 1, close));
      if (attribute === null) return null;
      tests.push(attribute);
      index = close + 1;
    } else if (character === ":") {
      if (text[index + 1] === ":") return null;
      const ident = readIdentifier(text, index + 1);
      if (ident === null) return null;
      let end = ident.end;
      let argument = null;
      if (text[end] === "(") {
        const close = findClosing(text, end, "(", ")");
        if (close < 0) return null;
        argument = text.slice(end + 1, close);
        end = close + 1;
      }
      const name = ident.value.toLowerCase();
      if (DYNAMIC_PSEUDO_CLASSES.has(name)) return null;
      if (name === "not") {
        const inner = argument === null ? null : parseSelector(argument);
        if (inner === null) return null;
        tests.push({ type: "not", selector: inner });
      } else if (name === "is" || name === "where" || name === "matches") {
        const inner = argument === null ? null : splitCssTopLevel(argument, ",");
        if (inner === null) return null;
        const selectors = inner.map(parseSelector);
        if (selectors.some((selector) => selector === null)) return null;
        tests.push({ type: "is", selectors });
      } else if (name === "root") {
        // 断片はページの html ではない。:root の box-sizing は断片要素へ効かない。
        tests.push({ type: "never" });
      }
      index = end;
    } else {
      return null;
    }
  }
  return tests;
}

function parseAttributeSelector(text) {
  const match = text.trim().match(/^([:\w-]+)\s*(?:([~^$*|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?$/u);
  if (match === null) return null;
  return {
    type: "attribute",
    name: match[1].toLowerCase(),
    operator: match[2] ?? null,
    value: match[3] ?? match[4] ?? match[5] ?? null,
  };
}

function readIdentifier(text, start) {
  let index = start;
  let value = "";
  while (index < text.length) {
    const character = text[index];
    if (character === "\\" && index + 1 < text.length) {
      value += text[index + 1];
      index += 2;
      continue;
    }
    if (!/[-_a-zA-Z0-9\u00a0-\uffff]/u.test(character)) break;
    value += character;
    index += 1;
  }
  return value === "" ? null : { value, end: index };
}

function findClosing(text, openIndex, open, close) {
  let depth = 0;
  let quote = null;
  for (let index = openIndex; index < text.length; index += 1) {
    const character = text[index];
    if (quote !== null) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === open) depth += 1;
    else if (character === close && --depth === 0) return index;
  }
  return -1;
}

function selectorMatches(element, selector) {
  const { compounds, combinators } = selector;
  let index = compounds.length - 1;
  let current = element;
  if (!compoundMatches(current, compounds[index])) return false;
  while (index > 0) {
    const combinator = combinators[index - 1];
    if (combinator === ">") {
      current = current.parent;
      if (current === null || !compoundMatches(current, compounds[index - 1])) return false;
    } else {
      current = current.parent;
      while (current !== null && !compoundMatches(current, compounds[index - 1])) current = current.parent;
      if (current === null) return false;
    }
    index -= 1;
  }
  return true;
}

function compoundMatches(element, tests) {
  for (const test of tests) {
    if (test.type === "tag" && element.tag !== test.value) return false;
    if (test.type === "id" && element.id !== test.value) return false;
    if (test.type === "class" && !element.classes.includes(test.value)) return false;
    if (test.type === "attribute" && !attributeMatches(element, test)) return false;
    if (test.type === "not" && selectorMatches(element, test.selector)) return false;
    if (test.type === "is" && !test.selectors.some((selector) => selectorMatches(element, selector))) return false;
    if (test.type === "never") return false;
  }
  return true;
}

function attributeMatches(element, test) {
  const value = element.attributes[test.name];
  if (value === undefined) return false;
  if (test.operator === null || test.value === null) return true;
  const actual = String(value);
  if (test.operator === "=") return actual === test.value;
  if (test.operator === "~=") return actual.split(/\s+/u).includes(test.value);
  if (test.operator === "^=") return actual.startsWith(test.value);
  if (test.operator === "$=") return actual.endsWith(test.value);
  if (test.operator === "*=") return actual.includes(test.value);
  if (test.operator === "|=") return actual === test.value || actual.startsWith(`${test.value}-`);
  return false;
}

function selectorSpecificity(selector) {
  const ids = (selector.match(/#[\w-]+/gu) ?? []).length;
  const classes = (selector.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/gu) ?? []).length;
  const types = (selector.replace(/#[\w-]+|\.[\w-]+|\[[^\]]*\]|::?[\w-]+(?:\([^)]*\))?|\*/gu, " ")
    .match(/[A-Za-z][\w-]*/gu) ?? []).length;
  return ids * 1_000_000 + classes * 1_000 + types;
}
