import assert from "node:assert/strict";
import test from "node:test";
import { evaluateGpuEligibility, hasAuthoredDepthAnimation, hasExternalImageSource, withoutXmlNamespaceDeclarations } from "../src/eligibility.mjs";
import { hasDepthTransform, inlineStyles, parseThreeEntrance, rootElement, sampledElements, scanThreeComposite, scanThreeSampled, stripComments, styleBodies } from "../src/three-entrance.mjs";

const oldXml = html => html.replace(/<[A-Za-z][^<>]*>/gu, tag => tag.replace(/(?<=\s)xmlns(?::[A-Za-z_][\w.-]*)?\s*=\s*(?:"[^"'\s<>]*"|'[^"'\s<>]*')/gu, ""));
const oldImage = html => /<img\b[^>]*\bsrc\s*=\s*["'](?!data:)/iu.test(html);
const oldRoot = html => {
  const source = html.replace(/^\s*(?:<!doctype[^>]*>\s*)?/iu, "");
  const match = source.match(/^<([a-z][a-z0-9-]*)\b([^>]*)>/iu);
  if (!match || ["script", "style", "link", "meta"].includes(match[1].toLowerCase())) return null;
  const classMatch = match[2].match(/\bclass\s*=\s*(["'])(.*?)\1/iu);
  return { tag: match[1].toLowerCase(), classes: classMatch ? classMatch[2].trim().split(/\s+/u).filter(Boolean) : [] };
};
const randomFor = seed => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  };
};

function oldBalancedBody(source, open, close, start) {
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
function oldFirstArgument(args) {
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
function oldDepthAnimation(html) {
  for (const style of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/giu)) {
    const css = style[1].replace(/\/\*[\s\S]*?\*\//gu, "");
    for (const keyframes of css.matchAll(/@(?:-[a-z]+-)?keyframes\s+[\w-]+\s*\{/giu)) {
      const body = oldBalancedBody(css, "{", "}", keyframes.index + keyframes[0].length);
      if (body === null || hasDepthTransform(body)) return true;
    }
  }
  for (const tag of html.matchAll(/<[^>]+>/gu)) {
    const style = tag[0].match(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/iu);
    if (style && hasDepthTransform(style[1] ?? style[2] ?? style[3])) return true;
  }
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu)) {
    if (/\btype\s*=\s*["']application\/json["']/iu.test(script[1])) continue;
    const body = script[2];
    for (const animate of body.matchAll(/\.animate\s*\(/gu)) {
      const args = oldBalancedBody(body, "(", ")", animate.index + animate[0].length);
      if (args === null || hasDepthTransform(oldFirstArgument(args))) return true;
    }
  }
  return false;
}
function oldSampledElements(html) {
  const withoutRawText = html.replace(/<(style|script)\b([^>]*)>([\s\S]*?)<\/\1\s*>/giu,
    (_match, tag, attributes, body) => `<${tag}${attributes}>${" ".repeat(body.length)}</${tag}>`);
  const voidElements = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
  const elements = [];
  const stack = [];
  const tags = [];
  let cursor = 0;
  while (cursor < withoutRawText.length) {
    const open = withoutRawText.indexOf("<", cursor);
    if (open < 0) break;
    let quote = null;
    let close = -1;
    for (let index = open + 1; index < withoutRawText.length; index += 1) {
      const character = withoutRawText[index];
      if (quote) {
        if (character === "\\") index += 1;
        else if (character === quote) quote = null;
      } else if (character === '"' || character === "'") quote = character;
      else if (character === ">") { close = index; break; }
    }
    if (close < 0) { tags.push("<invalid>"); break; }
    tags.push(withoutRawText.slice(open, close + 1));
    cursor = close + 1;
  }
  for (const token of tags) {
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
    for (const attribute of body.matchAll(pattern)) attributes.set(attribute[1].toLowerCase(), attribute[3] ?? attribute[4] ?? "");
    const tag = match[1].toLowerCase();
    const element = { tag, attributes, parent: stack.at(-1) ?? null };
    elements.push(element);
    if (!voidElements.has(tag) && !/\/\s*>$/u.test(token)) stack.push(element);
  }
  return stack.length === 0 ? { ok: true, elements } : { ok: false, elements: [] };
}

test("changed HTML predicates match their previous expressions", () => {
  const pieces = ["<img", " src=\"data:x\"", " src='https:x'", " xmlns=\"http://x\"", " xmlns:xlink='http://x'", " class=\"a b\"", " style=\"transform:rotateX(2deg)\"", "style=\"\"", "style=\"a>b\"", "style=\"x", "type=\"application/json'", '<!-- <script type="application/json" data-akari-glass-scene> -->', '{ "a" : 1 }', "<ſtyle>", "</ſtyle>", "<STYLE>", "</STYLE>", "<Script>", "<style>", "</style>", "<script>", "</script>", "/*", "*/", "<!--", "-->", '"', "'", ">", "<", " ", "\n", "日本語", "ſ", "K", "a"];
  for (const seed of [1, 2, 3]) {
    const next = randomFor(seed);
    for (let caseIndex = 0; caseIndex < 20000; caseIndex += 1) {
      let html = "";
      for (let i = next() % 14; i > 0; i -= 1) html += pieces[next() % pieces.length];
      assert.equal(withoutXmlNamespaceDeclarations(html), oldXml(html), `xmlns seed ${seed} case ${caseIndex}`);
      assert.equal(hasExternalImageSource(html), oldImage(html), `image seed ${seed} case ${caseIndex}`);
      assert.equal(stripComments(html), html.replace(/\/\*[\s\S]*?\*\//gu, ""), `css seed ${seed} case ${caseIndex}`);
      assert.deepEqual(styleBodies(html), [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/giu)].map(match => match[1]), `style seed ${seed} case ${caseIndex}`);
      assert.deepEqual(inlineStyles(html), [...html.matchAll(/<[^>]+\bstyle\s*=\s*(["'])([\s\S]*?)\1[^>]*>/giu)].map(match => match[2]), `inline style seed ${seed} case ${caseIndex}`);
      assert.deepEqual(rootElement(html), oldRoot(html), `root seed ${seed} case ${caseIndex}: ${JSON.stringify(html)}`);
      assert.equal(hasAuthoredDepthAnimation(html), oldDepthAnimation(html), `depth animation seed ${seed} case ${caseIndex}`);
      assert.deepEqual(sampledElements(html), oldSampledElements(html), `sampled elements seed ${seed} case ${caseIndex}: ${JSON.stringify(html)}`);
    }
  }
});

test("quoted values and raw text closing tags keep legacy edge cases", () => {
  for (const html of ['<img style="a>b"<style>', '<!--  style="a>b"-->', '<div style="" style="rotateX(1deg)">', '<!-- style="rotateX(1deg)</style >', '<script type="application/json\'">.animate([{transform:"rotateX(1deg)"}])</script>', '<ſtyle></style >', '<style></ſtyle>', '<ſtyle></STYLE>', '<img"> style="animation: y" >']) {
    assert.deepEqual(inlineStyles(html), [...html.matchAll(/<[^>]+\bstyle\s*=\s*(["'])([\s\S]*?)\1[^>]*>/giu)].map(match => match[2]), html);
    assert.equal(hasAuthoredDepthAnimation(html), oldDepthAnimation(html), html);
    assert.deepEqual(sampledElements(html), oldSampledElements(html), html);
  }
});

test("tag-name word boundary backs through every candidate character", () => {
  const sampled = "n<imgta-c_/>";
  assert.deepEqual(sampledElements(sampled), oldSampledElements(sampled));
  for (const html of [
    '<a-b_ class="x">',
    '<div-c_ class="x">',
    '<imgta-c_ class="a">',
    '<ab1_ class="x">',
  ]) {
    assert.deepEqual(rootElement(html), oldRoot(html), html);
  }
});

test("authored depth animation agrees on generated valid style and script bodies", () => {
  const pieces = ["", "rotateX(30deg)", "translateZ(0)", "translateZ(2px)", "opacity:0", "/* rotateX(90deg) */", ".animate([{transform:'rotateY(8deg)'}])"];
  for (const css of pieces) for (const script of pieces) {
    const html = `<style>@keyframes x {from{${css}} to{opacity:1}}</style><div style="${css}"></div><script>${script}</script>`;
    assert.equal(hasAuthoredDepthAnimation(html), oldDepthAnimation(html), `${css} / ${script}`);
  }
});

test("large two-byte HTML keeps GPU classification and all scanners running", () => {
  const large = "日本語".repeat(3 * 1024 * 1024);
  const small = "日本語".repeat(8 * 1024);
  const build = data => [
    `<div class="x"><style>@font-face{src:url(data:font/ttf;base64,${data})}</style><canvas></canvas><script type="application/json" data-akari-3d-scene>{"texts":[{"id":"a","text":"x"}]}</script></div>`,
    `<!--${data}--><div class="x"></div>`,
    `<!--${data}<div class="x"></div>`,
    `<div class="x"><script type="application/json" data-akari-3d-scene>{"texts":[{"id":"a","text":"${data}"}]}</script><canvas></canvas></div>`,
    `<div class="x" style="background:url(data:image/png;base64,${data})"></div>`,
    `<img src="data:image/png;base64,${data}">`,
    `<style>/*${data}*/</style><div class="x"></div>`,
    `<style>/*${data}</style><div class="x"></div>`,
  ];
  const largeCases = build(large);
  const smallCases = build(small);
  for (let index = 0; index < largeCases.length; index += 1) {
    const html = largeCases[index];
    const compact = smallCases[index];
    const classify = value => evaluateGpuEligibility({ edit: { overlays: [{ id: "large", html: value }], output: {} } });
    const actual = classify(html).entries[0];
    const expected = classify(compact).entries[0];
    assert.deepEqual({ classification: actual.classification, reason: actual.reason, conditions: actual.conditions },
      { classification: expected.classification, reason: expected.reason, conditions: expected.conditions });
    for (const scan of [scanThreeSampled, scanThreeComposite, parseThreeEntrance, hasDepthTransform]) {
      assert.doesNotThrow(() => scan(html), `${scan.name} case ${index}`);
    }
  }
});
