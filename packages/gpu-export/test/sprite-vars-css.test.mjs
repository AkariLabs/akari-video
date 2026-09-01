import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

// page-runtime.js は browser IIFE なので、既存テストと同じく関数本文を切り出して import する。
const source = await readFile(join(import.meta.dirname, "..", "src", "page-runtime.js"), "utf8");

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated ${name}`);
}

async function loadExtracted(moduleSource) {
  const dir = await mkdtemp(join(tmpdir(), "akari-sprite-vars-css-"));
  const file = join(dir, "extracted.mjs");
  await writeFile(file, moduleSource, "utf8");
  return import(pathToFileURL(file).href);
}

const { varsCss } = await loadExtracted(
  `${functionSource("escapeAttributeValue")}\n${functionSource("varsCss")}\nexport { varsCss };`,
);

test("double-quoted font families survive the SVG style attribute (export used to fail at every resolution)", () => {
  const css = varsCss({ "--caption-font-family": '"Noto Sans JP", "AKARI Noto Sans JP", sans-serif' });
  assert.equal(css, "--caption-font-family:&quot;Noto Sans JP&quot;, &quot;AKARI Noto Sans JP&quot;, sans-serif");
  assert.doesNotMatch(css, /"/u, "a raw double quote would terminate the style attribute");
});

test("XML-significant characters are escaped so the foreignObject SVG still parses", () => {
  assert.equal(varsCss({ "--a": "x & y" }), "--a:x &amp; y");
  assert.equal(varsCss({ "--a": "a<b>c" }), "--a:a&lt;b&gt;c");
  // 実体参照らしき値も素通しせず & を二重にエスケープする（; は宣言終端として先に剥がれる）
  assert.equal(varsCss({ "--a": "&amp" }), "--a:&amp;amp");
  assert.equal(varsCss({ "--a": "&quot;" }), "--a:&amp;quot");
});

test("declaration terminators are still stripped and invalid names are still dropped", () => {
  assert.equal(varsCss({ "--x": "12px; color: red } body {" }), "--x:12px color: red  body ");
  assert.equal(varsCss({ "--ok": "1", "not-a-var": "2", "--bad name": "3", "--ok2": "4" }), "--ok:1;--ok2:4");
  assert.equal(varsCss(undefined), "");
  assert.equal(varsCss({}), "");
});

test("the escaped attribute round-trips through an XML parser into the original CSS value", async () => {
  // Node には DOMParser が無いので、最小限の実体参照デコードで parser 側の挙動を再現する。
  const decode = (value) => value
    .replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
  const original = '"Noto Sans JP", sans-serif';
  assert.equal(decode(varsCss({ "--caption-font-family": original })), `--caption-font-family:${original}`);
});
