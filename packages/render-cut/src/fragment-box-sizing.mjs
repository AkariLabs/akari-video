// Page/CSS defaults that decide whether a fragment's padding and border are
// included in its declared width or height. The lint check and the render
// pages share the same intent, but this helper only answers "could a global
// border-box default change this fragment's boxes?" so legacy sheets keep
// their pinned bytes when no fragment declares a size together with padding
// or a border.

const SIZE_PROPERTY = /^(?:width|height|inline-size|block-size)$/u;
const PADDING_PROPERTY = /^padding(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?$/u;
const BORDER_PROPERTY = /^border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?(?:-width)?|-width)?$/u;
const BORDER_STYLE_PROPERTY = /^border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?-style$/u;
const SCAN_LIMIT = 4_000_000;

export function fragmentNeedsBoxSizingDefault(html) {
  if (typeof html !== "string" || html === "") return false;
  let hasSize = false;
  let hasSpace = false;
  const scan = (css) => {
    const length = Math.min(css.length, SCAN_LIMIT);
    let index = 0;
    let depth = 0;
    while (index < length) {
      const character = css[index];
      if (character === "/" && css[index + 1] === "*") {
        const close = css.indexOf("*/", index + 2);
        if (close < 0 || close >= length) return;
        index = close + 2;
        continue;
      }
      if (character === '"' || character === "'") {
        index = skipQuoted(css, index, length);
        continue;
      }
      if (character === "{") {
        depth += 1;
        index += 1;
        continue;
      }
      if (character === "}") {
        depth = Math.max(0, depth - 1);
        index += 1;
        continue;
      }
      if (depth === 0 || !/[-_a-z]/iu.test(character)) {
        index += 1;
        continue;
      }
      const start = index;
      index += 1;
      while (index < length && /[-_a-z0-9]/iu.test(css[index])) index += 1;
      const property = css.slice(start, index).toLowerCase();
      let colon = index;
      while (colon < length && /\s/u.test(css[colon])) colon += 1;
      if (css[colon] !== ":") continue;
      index = colon + 1;
      let parentheses = 0;
      while (index < length) {
        const valueCharacter = css[index];
        if (valueCharacter === '"' || valueCharacter === "'") {
          index = skipQuoted(css, index, length);
          continue;
        }
        if (valueCharacter === "(") parentheses += 1;
        else if (valueCharacter === ")") parentheses = Math.max(0, parentheses - 1);
        else if (parentheses === 0 && (valueCharacter === ";" || valueCharacter === "}" || valueCharacter === "{")) break;
        index += 1;
      }
      if (SIZE_PROPERTY.test(property)) hasSize = true;
      else if (PADDING_PROPERTY.test(property) || BORDER_PROPERTY.test(property)
        || BORDER_STYLE_PROPERTY.test(property)) hasSpace = true;
    }
  };
  for (const css of styleBlocks(html)) scan(css);
  const inlineSource = html.length > 1_000_000 ? html.slice(0, 1_000_000) : html;
  for (const match of inlineSource.matchAll(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/giu)) {
    scan(`{${match[1] ?? match[2] ?? ""}}`);
  }
  return hasSize && hasSpace;
}

function styleBlocks(html) {
  const lower = html.toLowerCase();
  const blocks = [];
  let cursor = 0;
  while (cursor < lower.length) {
    const open = lower.indexOf("<style", cursor);
    if (open < 0) break;
    const afterName = open + 6;
    const boundary = lower[afterName];
    if (boundary !== undefined && boundary !== ">" && boundary !== "/" && !/\s/u.test(boundary)) {
      cursor = afterName;
      continue;
    }
    const openEnd = lower.indexOf(">", afterName);
    if (openEnd < 0) break;
    const close = lower.indexOf("</style", openEnd + 1);
    if (close < 0) break;
    blocks.push(html.slice(openEnd + 1, close));
    cursor = close + 7;
  }
  return blocks;
}

function skipQuoted(css, start, length) {
  const quote = css[start];
  let index = start + 1;
  while (index < length) {
    if (css[index] === "\\") index += 2;
    else if (css[index] === quote) return index + 1;
    else index += 1;
  }
  return index;
}
