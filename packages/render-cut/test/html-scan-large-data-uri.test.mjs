import assert from "node:assert/strict";
import test from "node:test";
import { stripHtmlComments } from "../src/html-scan.mjs";
import { renderOverlaySheet } from "../src/rasterize.mjs";

const payload = "日本語".repeat(3 * 1024 * 1024);
const uri = `data:font/ttf;base64,${payload}`;
const fragment = '<script type="application/json" data-akari-3d-scene>{"texts":[{"id":"a","text":"x"}]}</script>';

test("large data URIs and incomplete comments preserve the old comment semantics", () => {
  const inputs = [
    `<style>@font-face{src:url(${uri})}/* <!-- kept --> */</style>${fragment}`,
    `<!--${uri}-->${fragment}`,
    `<!--${uri}${fragment}`,
    `<script type="application/json">{"uri":"${uri}","note":"<!-- kept -->"}</script>${fragment}`,
    `<style>/*${uri}*/</style>${fragment}`,
  ];
  for (const html of inputs) {
    const expected = html.startsWith("<!--") && html.includes("-->") ? html.slice(html.indexOf("-->") + 3) : html;
    assert.equal(stripHtmlComments(html), expected);
    assert.doesNotThrow(() => renderOverlaySheet({
      overlays: [{ id: "large", start: 0, duration: 1, html }],
      edit: { output: { width: 320, height: 180, fps: 30 } },
      projectRoot: process.cwd(), duration: 1,
    }));
  }
});

test("many incomplete openers still permit later complete comments", () => {
  const html = "<style<script".repeat(50000) + "<!--discard-->tail";
  assert.equal(stripHtmlComments(html), "<style<script".repeat(50000) + "tail");
});
