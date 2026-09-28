// UTF-16 offsets match RegExp.lastIndex. Regular expressions below inspect
// fixed prefixes or one character; they never walk a data URI.
const STYLE_OPEN = /<style\b/iyu;
const SCRIPT_OPEN = /<script\b/iyu;
const SPACE = /\s/u;
const WORD = /\w/iu;

export const isHtmlSpace = char => char !== undefined && SPACE.test(char);
export const isRegexWord = char => char !== undefined && WORD.test(char);
export const asciiFold = char => char === "ſ" ? "s" : char === "K" ? "k" : char.toLowerCase();

export function startsWithFold(source, word, at) {
  if (at + word.length > source.length) return false;
  for (let i = 0; i < word.length; i += 1) if (asciiFold(source[at + i]) !== word[i]) return false;
  return true;
}

export function findAttribute(source, name, start, end, boundary = true) {
  // Search only the current tag. Searching the full document from each tag
  // makes a missing attribute quadratic in the number of tags.
  if (start >= end) return -1;
  let pattern = ATTRIBUTE_SEARCHES.get(name);
  if (!pattern) {
    pattern = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "giu");
    ATTRIBUTE_SEARCHES.set(name, pattern);
  }
  const segment = source.slice(start, end);
  pattern.lastIndex = 0;
  for (let match = pattern.exec(segment); match; match = pattern.exec(segment)) {
    const at = start + match.index;
    if (!boundary || !isRegexWord(source[at - 1])) return at;
  }
  return -1;
}
const ATTRIBUTE_SEARCHES = new Map();

export function findCloseTag(source, name, start) {
  let at = source.indexOf("<", start);
  while (at >= 0) {
    if (source[at + 1] === "/" && startsWithFold(source, name, at + 2)) {
      let end = at + 2 + name.length;
      while (isHtmlSpace(source[end])) end += 1;
      if (source[end] === ">") return { start: at, end: end + 1 };
    }
    at = source.indexOf("<", at + 1);
  }
  return null;
}

export function findRawTextOpen(source, name, at, attributeTest = null) {
  const prefix = name === "style" ? STYLE_OPEN : SCRIPT_OPEN;
  prefix.lastIndex = at;
  if (!prefix.test(source)) return null;
  const end = source.indexOf(">", at + 1);
  if (end < 0 || (attributeTest && !attributeTest(source, at + 1 + name.length, end))) return null;
  return end + 1;
}

export function* rawTextElements(source, name, attributeTest = null) {
  let cursor = 0;
  let noClose = false;
  const lastAngle = source.lastIndexOf(">");
  while (cursor < source.length && !noClose) {
    const at = source.indexOf("<", cursor);
    if (at < 0) break;
    const bodyStart = at <= lastAngle ? findRawTextOpen(source, name, at, attributeTest) : null;
    if (bodyStart !== null) {
      const close = findCloseTag(source, name, bodyStart);
      if (close) {
        yield { start: at, bodyStart, bodyEnd: close.start, end: close.end };
        cursor = close.end;
        continue;
      }
      noClose = true;
    }
    cursor = at + 1;
  }
}

export function* htmlTags(source, { noInnerAngle = false } = {}) {
  let cursor = 0;
  let greaterAt = -1;
  while (cursor < source.length) {
    const at = source.indexOf("<", cursor);
    if (at < 0) break;
    if (at >= greaterAt) greaterAt = source.indexOf(">", at + 1);
    const end = greaterAt;
    if (end < 0) break;
    const inner = noInnerAngle ? source.indexOf("<", at + 1) : -1;
    if (end > at + 1 && (inner < 0 || inner >= end)) {
      yield { start: at, end: end + 1, text: source.slice(at, end + 1) };
      cursor = end + 1;
    } else cursor = inner >= 0 && inner < end ? inner : at + 1;
  }
}

function jsonType(source, start, end) {
  for (let at = findAttribute(source, "type", start, end); at >= 0;
    at = findAttribute(source, "type", at + 1, end)) {
    let cursor = at + 4;
    while (isHtmlSpace(source[cursor])) cursor += 1;
    if (source[cursor++] !== "=") continue;
    while (isHtmlSpace(source[cursor])) cursor += 1;
    const quote = source[cursor] === '"' || source[cursor] === "'" ? source[cursor++] : null;
    if (!startsWithFold(source, "application/json", cursor)) continue;
    cursor += "application/json".length;
    if (quote ? source[cursor] === quote : isHtmlSpace(source[cursor]) || source[cursor] === ">") return true;
  }
  return false;
}

// Complete style and JSON script blocks shield their inner comments. An
// incomplete opener does not shield later tokens, as in the old alternation.
export function stripHtmlComments(html) {
  const source = String(html ?? "");
  const parts = [];
  let cursor = 0;
  let copied = 0;
  let noCommentClose = false;
  let noStyleClose = false;
  let noScriptClose = false;
  let scriptWithoutJsonUntil = -1;
  const lastAngle = source.lastIndexOf(">");
  while (cursor < source.length) {
    const at = source.indexOf("<", cursor);
    if (at < 0) break;
    if (!noCommentClose && source.startsWith("<!--", at)) {
      const close = source.indexOf("-->", at + 4);
      if (close >= 0) {
        parts.push(source.slice(copied, at));
        cursor = close + 3;
        copied = cursor;
        continue;
      }
      noCommentClose = true;
    }
    const styleStart = !noStyleClose && at <= lastAngle ? findRawTextOpen(source, "style", at) : null;
    if (styleStart !== null) {
      const close = findCloseTag(source, "style", styleStart);
      if (close) { cursor = close.end; continue; }
      noStyleClose = true;
    }
    if (!noScriptClose && at > scriptWithoutJsonUntil && at <= lastAngle) {
      SCRIPT_OPEN.lastIndex = at;
      if (SCRIPT_OPEN.test(source)) {
        const tagEnd = source.indexOf(">", at + 7);
        if (!jsonType(source, at + 7, tagEnd)) scriptWithoutJsonUntil = tagEnd;
        else {
          const close = findCloseTag(source, "script", tagEnd + 1);
          if (close) { cursor = close.end; continue; }
          noScriptClose = true;
        }
      }
    }
    cursor = at + 1;
  }
  if (copied === 0) return source;
  parts.push(source.slice(copied));
  return parts.join("");
}

export function stripCssComments(source) {
  const parts = [];
  let cursor = 0;
  let copied = 0;
  while (true) {
    const at = source.indexOf("/*", cursor);
    if (at < 0) break;
    const end = source.indexOf("*/", at + 2);
    if (end < 0) break;
    parts.push(source.slice(copied, at));
    cursor = end + 2;
    copied = cursor;
  }
  if (copied === 0) return source;
  parts.push(source.slice(copied));
  return parts.join("");
}
