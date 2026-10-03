import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { collectFragmentCodepoints, fragmentFontFaces } from "../src/fragment-text.mjs";

const chars = result => [...result.codepoints].map(cp => String.fromCodePoint(cp)).join("");
const points = (html, options = {}) => collectFragmentCodepoints(html, options).codepoints;
const has = (set, char) => set.has(char.codePointAt(0));

test("decimal, hexadecimal and HTML 4 named references decode", () => {
  const set = points("<div>&#38634;&#x96EA;&hellip;&copy;&mdash;&yen;&times;&rarr;</div>");
  for (const char of "雪…©—¥×→") assert.ok(has(set, char), char);
  assert.equal(has(set, "r"), false);
  assert.equal(has(points("<div>&MadeUp;</div>"), "M"), false);
});

test("invalid numeric references become replacement characters", () => {
  const set = points("<div>&#0;&#xD800;&#x110000;</div>");
  assert.deepEqual(set, new Set([0xfffd]));
});

test("unclosed ampersands stay linear in text and attributes", () => {
  const repeated = "&a".repeat(160_000);
  for (const html of [`<div>字${repeated}</div>`, `<div data-akari-font-chars="${repeated}">字</div>`]) {
    const start = performance.now();
    assert.doesNotThrow(() => collectFragmentCodepoints(html, { mode: "render" }));
    assert.ok(performance.now() - start < 1000, "160,000 ampersands exceeded one second");
  }
});

test("CSS escapes and attr values are decoded", () => {
  const set = points(`<div data-x="雪"><style>.a::before{content:"\\201C"}.b::after{content:attr(data-x)}</style></div>`);
  assert.ok(has(set, "“"));
  assert.ok(has(set, "雪"));
  assert.equal(has(set, "2"), false);
});

test("style and script bodies, JSON keys, and ordinary attributes are excluded", () => {
  const html = `<div alt="鱻" title="魑"><style>.a{font-family:秘}</style><script type="application/json">{"hiddenKey":"星"}</script><script>隠</script>字</div>`;
  const set = points(html);
  for (const char of "鱻魑秘隠h") assert.equal(has(set, char), false, char);
  for (const char of "星字") assert.ok(has(set, char), char);
});

test("declared characters are read only from the root", () => {
  const set = points(`<div data-akari-font-chars="雪"><span data-akari-font-chars="鱻">字</span></div>`);
  assert.ok(has(set, "雪"));
  assert.equal(has(set, "鱻"), false);
});

test("text-transform values add only their corresponding forms", () => {
  for (const [value, present, absent] of [
    ["none", "a", "A"], ["uppercase", "A", "ａ"],
    ["lowercase", "a", "ａ"], ["capitalize", "A", "ａ"],
    ["full-width", "ａ", "A"],
  ]) {
    const set = points(`<div style="text-transform:${value}">a</div>`);
    assert.ok(has(set, present), value);
    assert.equal(has(set, absent), false, value);
  }
});

test("JSON scripts are static; module and external scripts are dynamic", () => {
  assert.equal(collectFragmentCodepoints(`<div><script type="application/json">{"x":"字"}</script></div>`).hasDynamicScript, false);
  assert.equal(collectFragmentCodepoints(`<div><script type="module">void 0</script></div>`).hasDynamicScript, true);
  assert.equal(collectFragmentCodepoints(`<div><script src="logic.js"></script></div>`).hasDynamicScript, true);
});

test("default ignorable characters are absent in both modes", () => {
  const html = "<div>a\u200bb\ufe0fc\u00add\u200de</div>";
  for (const mode of ["render", "source"]) {
    const set = points(html, { mode });
    for (const cp of [0x200b, 0xfe0f, 0xad, 0x200d]) assert.equal(set.has(cp), false, `${mode} U+${cp.toString(16)}`);
  }
});

test("Object.prototype attribute names are safe", () => {
  for (const name of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]) {
    const html = `<div ${name}="雪">字<style>.a::after{content:attr(${name})}</style></div>`;
    assert.doesNotThrow(() => collectFragmentCodepoints(html));
    assert.ok(has(points(html), "雪"), name);
  }
});

test("source contains render for varied generated fragments", () => {
  let state = 0x12345678;
  const next = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) >>> 8);
  const choose = values => values[next() % values.length];
  const glyphs = ["字", "𠮷", "星", "😺", "雪", "雲"];
  const parts = [
    glyph => glyph,
    glyph => `&#${glyph.codePointAt(0)};`,
    glyph => `&#x${glyph.codePointAt(0).toString(16)};`,
    () => choose(["&hellip;", "&copy;", "&rarr;"]),
    glyph => `<style>.a{content:"\\${glyph.codePointAt(0).toString(16)} "}</style>`,
    () => `<style>.a{content:attr(data-x)}</style>`,
    glyph => `<script type="application/json">{"key":"${glyph}"}</script>`,
    glyph => `<!--${glyph}-->`,
    glyph => `<script>${glyph}</script>`,
    glyph => `<span style="content:'${glyph}'">${choose(glyphs)}</span>`,
  ];
  const transforms = ["none", "uppercase", "lowercase", "capitalize", "full-width"];
  const seen = new Set();
  for (let i = 0; i < 400; i++) {
    const count = 1 + next() % 10;
    const selected = Array.from({ length: count }, () => choose(parts)(choose(glyphs))).join("");
    const chars = next() % 2 ? ` data-akari-font-chars="${choose(glyphs)}"` : "";
    const html = `<div data-x="${choose(glyphs)}"${chars} style="text-transform:${choose(transforms)}">${selected}</div>`;
    seen.add(html);
    const options = {
      ...(next() % 2 ? { params: { title: choose(glyphs) } } : {}),
      ...(next() % 2 ? { vars: { label: choose(glyphs) } } : {}),
    };
    const render = points(html, { ...options, mode: "render" });
    const source = points(html, { ...options, mode: "source" });
    for (const cp of render) assert.ok(source.has(cp), `case ${i}: U+${cp.toString(16)}`);
  }
  assert.ok(seen.size > 300, `only ${seen.size} distinct fragments`);
});

test("large attribute values and CSS strings do not overflow either mode", () => {
  const long = "A".repeat(12 * 1024 * 1024);
  for (const html of [
    `<div>字<img src="data:image/png;base64,${long}"><style>@font-face{src:url(a.ttf)}</style></div>`,
    `<div style="background:url(data:image/png;base64,${long})">字</div>`,
    `<div>字<style>.a{content:"${long}"}</style></div>`,
    `<div data-akari-font-chars="${long}">字</div>`,
  ]) for (const mode of ["render", "source"]) assert.doesNotThrow(() => collectFragmentCodepoints(html, { mode }));
});

test("render collects visible, CSS, declarations and supplied strings", () => {
  const html = `<div data-title="虹" data-akari-font-chars="漢" style="text-transform:uppercase;content:'\\65'">甲&amp;乙<span>丙</span><style>.a{content:"雪;雨"}.b{content:attr(data-title)}</style><script type="application/json">{"title":"風"}</script><!--隠--><script>秘()</script></div>`;
  const result = collectFragmentCodepoints(html, { params: { title: "星" }, vars: { label: "月" } });
  for (const char of "甲&乙丙雪;雨虹漢風星月E") assert.ok(chars(result).includes(char), char);
  for (const char of "隠秘") assert.equal(chars(result).includes(char), false, char);
  assert.equal(result.hasDynamicScript, true);
});

test("source contains render and safety characters", () => {
  for (let i = 0; i < 50; i++) {
    const html = `<div data-akari-font-chars="${String.fromCodePoint(0x4e00 + i)}">字&#x96ea;<style>.x{content:'\\65'}</style></div>`;
    const render = collectFragmentCodepoints(html, { mode: "render", params: { x: "星" } });
    const source = collectFragmentCodepoints(html, { mode: "source", params: { x: "星" } });
    for (const cp of render.codepoints) assert.ok(source.codepoints.has(cp));
    assert.ok(source.codepoints.has("…".codePointAt(0)));
  }
});

test("font faces use the fragment asset scanner", () => {
  const html = `<div><style>@font-face{font-family:"Demo";src:url('../assets/font/demo.ttf')}@font-face{font-family:Inline;src:url(data:font/ttf;base64,AA==)}</style></div>`;
  const faces = fragmentFontFaces(html, "overlays/item.html");
  assert.equal(faces.length, 2);
  assert.equal(faces[0].family, "Demo");
  assert.equal(faces[0].sources[0].path, "assets/font/demo.ttf");
  assert.match(faces[1].sources[0].data, /^data:font\/ttf/u);
});

test("comments do not introduce scripts or font faces", () => {
  const html = `<div><!-- <script>秘</script><style>@font-face{src:url(fake.ttf)}</style> --><span>字</span></div>`;
  assert.equal(collectFragmentCodepoints(html).hasDynamicScript, false);
  assert.equal(chars(collectFragmentCodepoints(html)).includes("秘"), false);
  assert.deepEqual(fragmentFontFaces(html, "item.html"), []);
});

test("large data URI does not overflow either scan", () => {
  const html = `<div>日本<style>@font-face{font-family:A;src:url(data:font/ttf;base64,${"A".repeat(32 * 1024 * 1024)})}</style></div>`;
  assert.doesNotThrow(() => collectFragmentCodepoints(html, { mode: "render" }));
  assert.doesNotThrow(() => collectFragmentCodepoints(html, { mode: "source" }));
  assert.doesNotThrow(() => fragmentFontFaces(html, "overlay.html"));
  const quoted = `<div>日本<style>@font-face{font-family:A;src:url("data:font/ttf;base64,${"A".repeat(32 * 1024 * 1024)}")}</style></div>`;
  assert.doesNotThrow(() => fragmentFontFaces(quoted, "overlay.html"));
});
