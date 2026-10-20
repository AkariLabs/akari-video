import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { renderOverlaySheet } from "../../render-cut/src/rasterize.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = join(packageRoot, "..", "..");
const fragment = `<div class="root">
  <style>
    .root { position: absolute; inset: 0; }
    .panel {
      position: absolute;
      top: 200px;
      width: 760px;
      height: 240px;
      padding: 26px 32px;
      background: #f00;
    }
    #panel-a { left: 90px; }
    #panel-b { left: 900px; }
  </style>
  <div class="panel" id="panel-a"></div>
  <div class="panel" id="panel-b"></div>
</div>`;

function roundedRects(rects) {
  return rects.map((rect) => Object.fromEntries(
    Object.entries(rect).map(([key, value]) => [key, Math.round(value * 1000) / 1000]),
  ));
}

test("preview and export compute the same border-box layout for a fixed-width padded fragment", async (t) => {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    t.skip("playwright is unavailable");
    return;
  }
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    t.skip(`chromium is unavailable: ${error.message}`);
    return;
  }
  try {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 1920, height: 1080 },
    });
    const page = await context.newPage();
    const previewHtml = await readFile(join(packageRoot, "public", "index.html"), "utf8");
    const previewStyles = previewHtml.match(/<style>([\s\S]*?)<\/style>/u)?.[1] ?? "";
    await page.setContent(`<!doctype html><html><head>
      <style>${previewStyles}</style>
      <style>#overlay-stage { position: relative; width: 1920px; height: 1080px; }</style>
      </head><body><div id="overlay-stage">${fragment}</div></body></html>`);
    const previewRects = roundedRects(await page.evaluate(() =>
      [...document.querySelectorAll(".panel")].map((element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      })));

    const sheet = renderOverlaySheet({
      overlays: [{ id: "panels", html: fragment, start: 0, duration: 1 }],
      edit: { version: 1, sources: [], cuts: [], output: { width: 1920, height: 1080, fps: 30 } },
      projectRoot,
      duration: 1,
    });
    await page.setContent(sheet);
    const exportRects = roundedRects(await page.evaluate(() =>
      [...document.querySelectorAll(".panel")].map((element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      })));

    assert.equal(previewRects.length, 2);
    assert.equal(previewRects[0].width, 760);
    assert.deepEqual(exportRects, previewRects);
  } finally {
    await browser.close();
  }
});
