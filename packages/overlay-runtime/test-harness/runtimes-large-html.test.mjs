import assert from "node:assert/strict";
import test from "node:test";
import { declarationPattern, readDeclarations, replaceDeclarations, runtimes, stripHtmlComments, validateRuntimeDeclarations } from "../runtimes.mjs";

const entry = runtimes.find(value => value.id === "three");
const oldStrip = html => html.replace(/<!--[\s\S]*?-->/gu, "");
const oldRead = html => [...oldStrip(html).matchAll(declarationPattern(entry))].map(match => match[2]);
const context = { meta: {}, category: "overlay", name: "fragment.html", payloadFiles: [], validateReference() {} };
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

test("runtime comment and declaration scans match previous expressions", () => {
  const pieces = ["<!--", "-->", "<script", "<Script>", "</script>", "</script\t>", ' type="application/json"', " type='application/json'", " type=\"application/json'", " data-akari-3d-scene", '<script type="application/json" data-akari-3d-scene>{ "a" : 1 }</script>', "style=\"\"", "style=\"a>b\"", "style=\"x", '"', "'", "<ſtyle>", "</ſtyle>", "<STYLE>", "</STYLE>", '<!-- <script type="application/json" data-akari-glass-scene> -->', ">", "<", "ſ", "K", "日本語", "\u00a0", "\n", "{}", "x"];
  for (const seed of [1, 2, 3]) {
    const next = randomFor(seed);
    for (let caseIndex = 0; caseIndex < 20000; caseIndex += 1) {
      let html = "";
      for (let i = next() % 18; i > 0; i -= 1) html += pieces[next() % pieces.length];
      assert.equal(stripHtmlComments(html), oldStrip(html), `comments seed ${seed} case ${caseIndex}`);
      const oldDeclarations = oldRead(html);
      assert.deepEqual(readDeclarations(html, entry).map(value => value.json), oldDeclarations, `declarations seed ${seed} case ${caseIndex}`);
      const errors = [];
      for (const json of oldDeclarations) {
        try {
          const value = JSON.parse(json);
          if (value === null || typeof value !== "object" || Array.isArray(value)) errors.push("data-akari-3d-scene は JSON object である必要があります");
        } catch (error) { errors.push(`data-akari-3d-scene の JSON を読めません: ${error.message}`); }
      }
      assert.deepEqual(validateRuntimeDeclarations(html, context), errors, `validation seed ${seed} case ${caseIndex}`);
    }
  }
});

test("large two-byte declarations and comments do not overflow", () => {
  const data = "日本語".repeat(3 * 1024 * 1024);
  const declaration = `<script type="application/json" data-akari-3d-scene>{"texts":[{"id":"a","text":"${data}"}]}</script>`;
  for (const html of [`<!--${data}-->${declaration}`, `<!--${data}${declaration}`, declaration]) {
    assert.equal(readDeclarations(html, entry).length, 1);
    assert.doesNotThrow(() => validateRuntimeDeclarations(html, context));
  }
});

test("glass embedding keeps the previous comment and declaration bytes", () => {
  const glass = runtimes.find(value => value.id === "glass");
  const declaration = '<script type="application/json" data-akari-glass-scene> { } </script>';
  const pattern = new RegExp("<!--[\\s\\S]*?-->|" + declarationPattern(glass).source, "giu");
  for (const html of [
    declaration,
    `<!--${declaration}-->${declaration}`,
    `<!-- unfinished ${declaration}`,
    `<div>${declaration}<!--${declaration}--></div>`,
    `${declaration}<!--${declaration}-->${declaration}`,
    `<!-- <script type="application/json" data-akari-glass-scene> -->${declaration}`,
  ]) {
    const expected = html.replace(pattern, (match, opening, json, closing) =>
      opening ? opening + JSON.stringify(JSON.parse(json)).replace(/</gu, "\\u003c") + closing : match);
    assert.equal(glass.embed({ id: "g", html }, { projectRoot: process.cwd() }), expected);
  }
});

test("comment-protected replacement agrees on generated overlapping tokens", () => {
  const glass = runtimes.find(value => value.id === "glass");
  const pattern = new RegExp("<!--[\\s\\S]*?-->|" + declarationPattern(glass).source, "giu");
  const pieces = ["<!--", "-->", '<script type="application/json" data-akari-glass-scene>{ "a" : 1 }</script>', '<!-- <script type="application/json" data-akari-glass-scene> -->', "<script", "<Script>", "</script>", "style=\"\"", "style=\"a>b\"", "style=\"x", "type=\"application/json'", '"', "'", "<ſtyle>", "</ſtyle>", "<STYLE>", "</STYLE>", "x", "日本語"];
  for (const seed of [1, 2, 3]) {
    const next = randomFor(seed);
    for (let caseIndex = 0; caseIndex < 20000; caseIndex += 1) {
      let html = "";
      for (let i = next() % 15; i > 0; i -= 1) html += pieces[next() % pieces.length];
      const expected = html.replace(pattern, (match, opening) => opening ? `[${match}]` : match);
      const actual = replaceDeclarations(html, glass, match => `[${match.opening}${match.json}${match.closing}]`, true);
      assert.equal(actual, expected, `seed ${seed} case ${caseIndex}: ${JSON.stringify(html)}`);
    }
  }
});
