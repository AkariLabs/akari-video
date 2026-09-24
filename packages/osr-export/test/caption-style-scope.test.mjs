import assert from "node:assert/strict";
import test from "node:test";

import { buildOsrPage } from "../src/page-builder.mjs";
import { scopeCaptionStylesInSheet } from "../src/caption-style-scope.mjs";
import { startStaticServer } from "../src/static-server.mjs";

// Read top-level CSS blocks only. Keyframe steps and declarations inside a scope
// must not be mistaken for another rule in the shared overlay document.
function topLevelBlocks(css) {
  const blocks = [];
  let start = 0;
  let depth = 0;
  let quote = null;
  let comment = false;
  for (let index = 0; index < css.length; index += 1) {
    const char = css[index];
    const next = css[index + 1];
    if (comment) {
      if (char === "*" && next === "/") { comment = false; index += 1; }
      continue;
    }
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "/" && next === "*") { comment = true; index += 1; continue; }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (char === "{") depth += 1;
    if (char === "}" && --depth === 0) {
      blocks.push(css.slice(start, index + 1).trim());
      start = index + 1;
    }
  }
  assert.equal(depth, 0);
  assert.equal(css.slice(start).trim(), "");
  return blocks;
}

function captionStyles(sheet) {
  return [...sheet.matchAll(/<div class="akari-caption[^"\n]*" data-akari-caption-scope="([^"]+)">\s*<style>([\s\S]*?)<\/style>/gu)]
    .map(match => ({ scope: match[1], css: match[2] }));
}

test("OSR の複数字幕では配信シートの全セレクタ規則が自分の caption root に閉じる", async (t) => {
  const animation = id => ({ in: { id }, out: { id } });
  const captions = {
    emphasis_words: [{ id: "e-0001", t_start: 4.4, t_end: 5.4, word: "強調", emotion: "surprise", style_hint: "one-char-bang" }],
    captions: [
      { id: "fade", start: 0, end: 3, text: "色つき字幕", time_domain: "output",
        text_style: { animation: animation("fade-up"), background: { mode: "block", fit: "frame" } },
        runs: [{ from: 0, to: 2, style: { color: "#b388ff" }, animation: { loop: { id: "float" } } }] },
      { id: "pop", start: 4, end: 7, text: "強調です", time_domain: "output",
        text_style: { animation: animation("pop"), background: { mode: "per-line", fit: "frame" } },
        words: [{ start: 4.4, end: 5.4, text: "強調" }, { start: 5.4, end: 6.4, text: "です" }] },
      { id: "still", start: 8, end: 11, text: "静止字幕", time_domain: "output" },
    ],
  };
  const edit = { version: 2, output: { width: 1280, height: 720, fps: 30 },
    sources: [], cuts: [{ in: 0, out: 12 }], overlays: [] };
  const page = buildOsrPage({ edit, captions, projectRoot: "/unused", duration: 12,
    frameEngineBundle: "", pageRuntime: "" }).overlaySheetHtml;
  const sheet = scopeCaptionStylesInSheet(page);
  const server = await startStaticServer({ pageHtml: "", overlaySheetHtml: page, projectRoot: "/unused" });
  t.after(() => server.close());
  assert.equal(await (await fetch(`${server.url}overlay-sheet.html`)).text(), sheet);
  const styles = captionStyles(sheet);
  assert.equal(styles.length, 3);
  assert.equal(new Set(styles.map(style => style.scope)).size, 3);
  for (const { scope, css } of styles) {
    const blocks = topLevelBlocks(css);
    const selectors = blocks.filter(block => !/^@(?:font-face|keyframes)\b/u.test(block));
    assert.ok(selectors.length > 0);
    assert.ok(selectors.every(block => block.slice(0, block.indexOf("{")).includes(`[data-akari-caption-scope="${scope}"]`)),
      "caption selector escaped into the shared sheet");
    assert.ok(blocks.filter(block => /^@(?:font-face|keyframes)\b/u.test(block)).every(block =>
      !block.includes("data-akari-caption-scope")), "global at-rule was changed");
  }
  assert.match(styles[0].css, /\.akari-caption\[data-akari-caption-scope="[^"]+"\] \.akari-caption__plate \{[^}]*akari-anim-fade-up/u);
  assert.match(styles[0].css, /\.akari-caption\[data-akari-caption-scope="[^"]+"\] \.akari-caption__block \{/u);
  assert.match(sheet, /class="akari-caption__run"/u);
  assert.doesNotMatch(styles[0].css, /akari-anim-pop/u);
  assert.match(styles[1].css, /\.akari-caption\[data-akari-caption-scope="[^"]+"\] \.akari-caption__plate \{[^}]*akari-anim-pop/u);
  assert.match(styles[1].css, /\.akari-caption\[data-akari-caption-scope="[^"]+"\] \.akari-caption__line \{[^}]*box-sizing: border-box/u);
  assert.match(styles[1].css, /\.akari-caption\[data-akari-caption-scope="[^"]+"\] \.akari-caption__emphasis-char/u);
  assert.doesNotMatch(styles[1].css, /akari-anim-fade-up/u);
  assert.doesNotMatch(styles[2].css, /akari-anim-(?:fade-up|pop)/u);
});

test("null/undefined の overlay sheet は GPU 経路で変換せず配信を開始できる", async (t) => {
  for (const value of [null, undefined]) {
    assert.equal(scopeCaptionStylesInSheet(value), value);
    const server = await startStaticServer({ pageHtml: "gpu page", overlaySheetHtml: value, projectRoot: "/unused" });
    t.after(() => server.close());
    const response = await fetch(`${server.url}page.html`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "gpu page");
  }
});

test("未知の CSS 規則を残し、カンマ区切りの字幕セレクタを個別に限定する", () => {
  const fragment = '<div class="akari-caption"><style>'
    + '.akari-caption__line, .akari-caption__tok { color:red; }'
    + '.a, .b { font-weight:700; }'
    + '.outside { color:blue; }'
    + '@media screen { .akari-caption__plate { opacity:.5; } }'
    + '</style><div class="akari-caption__plate"></div></div>';
  const result = scopeCaptionStylesInSheet(fragment);
  const root = '.akari-caption[data-akari-caption-scope="c-30"]';
  assert.ok(result.includes(`${root} .akari-caption__line, ${root} .akari-caption__tok { color:red; }`));
  assert.ok(result.includes(`${root} .a, ${root} .b { font-weight:700; }`));
  assert.ok(result.includes('.outside { color:blue; }'));
  assert.ok(result.includes('@media screen { .akari-caption__plate { opacity:.5; } }'));
  assert.equal((result.match(/data-akari-caption-scope="c-30"/gu) ?? []).length, 5);

  const malformed = '<div class="akari-caption"><style>.akari-caption__plate { color:red;</style></div>';
  assert.equal(scopeCaptionStylesInSheet(malformed), malformed);
});
