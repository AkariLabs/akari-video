import assert from "node:assert/strict";
import test from "node:test";

import { stripHtmlComments } from "../src/html-scan.mjs";

test("stripHtmlComments removes only complete HTML comments", () => {
  const html = `<div>before</div>
<!-- data-akari-3d-scene
<script>ignored()</script> -->
<style>/* <!-- keep CSS comments --> */ .x { color: red; }</style>
<script type="application/json">{"note":"<!-- keep JSON text -->"}</script>`;
  assert.equal(
    stripHtmlComments(html),
    `<div>before</div>

<style>/* <!-- keep CSS comments --> */ .x { color: red; }</style>
<script type="application/json">{"note":"<!-- keep JSON text -->"}</script>`,
  );
  assert.equal(stripHtmlComments("<div><!-- unfinished"), "<div><!-- unfinished");
  assert.equal(
    stripHtmlComments("<!-- <script type=\"application/json\">{}</script> -->"),
    "",
  );
});

const legacyPattern = /<!--[\s\S]*?-->|<style\b[^>]*>[\s\S]*?<\/style\s*>|<script\b(?=[^>]*\btype\s*=\s*(?:"application\/json"|'application\/json'|application\/json(?=[\s>])))\s*[^>]*>[\s\S]*?<\/script\s*>/giu;
const legacy = html => html.replace(legacyPattern, token => token.startsWith("<!--") ? "" : token);
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

test("stripHtmlComments matches the previous expression on generated HTML", () => {
  const pieces = ["<!--", "-->", "<!-->", "<style", "<STYLE", "<ſtyle", "<ſtyle>", "</style >", "</style", "</ſtyle>", "</STYLE>", '<script type="application/json">', "<Script>", "type='application/json'", "type=application/json>", "type=application/jſon", "type=\"application/json'", "</script\t>", "style=\"\"", "style=\"a>b\"", "style=\"x", '"', "'", ">", "<", "-", "ſ", "K", "\u00a0", "\n", "日本語", "a1", " ", '<!-- <script type="application/json" data-akari-glass-scene> -->', '{ "a" : 1 }'];
  for (const seed of [1, 2, 3]) {
    const next = randomFor(seed);
    for (let caseIndex = 0; caseIndex < 20000; caseIndex += 1) {
      let html = "";
      const count = next() % 22;
      for (let index = 0; index < count; index += 1) html += pieces[next() % pieces.length];
      assert.equal(stripHtmlComments(html), legacy(html), `seed ${seed} case ${caseIndex}: ${JSON.stringify(html)}`);
    }
  }
});
