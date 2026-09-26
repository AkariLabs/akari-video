import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { launchBrowser } from '../../../../../packages/overlay-runtime/test-harness/fixtures/browser.mjs';
import { captionControlScale } from '../lib/common/caption-control-scale.js';
import { previewSelectionHandlesStyle } from '../lib/browser/preview-selection-handles-style.js';

const handler = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const from = handler.indexOf('#caption-select-box .akari-caption-handle-box {');
const to = handler.indexOf('.caption-row-plate.akari-caption-host--editing,', from);
assert.ok(from >= 0 && to > from);
const baseCss = handler.slice(from, to);

test('caption handles stay at display sizes when the output stage is scaled to 332×187', async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    const widthScale = 332 / 1920, heightScale = 187 / 1080;
    const vars = captionControlScale(1920, 332, 1080, 187);
    const declarations = Object.entries(vars).map(([key, value]) => `${key}:${value}`).join(';');
    await page.setViewport({ width: 640, height: 360 });
    await page.setContent(`<style>${baseCss}${previewSelectionHandlesStyle}</style>
      <div style="position:absolute;left:20px;top:20px;width:1920px;height:1080px;transform-origin:0 0;transform:scale(${widthScale},${heightScale})">
        <div id="caption-select-box" class="caption-row-plate" style="position:absolute;left:100px;top:100px;width:500px;height:200px">
          <div class="akari-caption-handle-box" style="position:absolute;left:0;top:0;width:400px;height:100px;${declarations}">
            <i class="akari-caption-handle" data-h="nw"></i>
            <i class="akari-caption-handle" data-h="e"></i>
            <i class="akari-caption-handle" data-h="rot"></i>
            <i class="akari-caption-handle" data-h="move"></i>
          </div>
        </div>
      </div>`);
    const boxes = await page.evaluate(() => Object.fromEntries(['nw', 'e', 'rot', 'move'].map(kind => {
      const rect = document.querySelector(`[data-h="${kind}"]`).getBoundingClientRect();
      return [kind, { width: rect.width, height: rect.height }];
    })));
    for (const [kind, width, height] of [['nw', 11, 11], ['e', 11, 20], ['rot', 25, 25], ['move', 25, 25]]) {
      assert.ok(Math.abs(boxes[kind].width - width) < .1, `${kind}.width ${boxes[kind].width}`);
      assert.ok(Math.abs(boxes[kind].height - height) < .1, `${kind}.height ${boxes[kind].height}`);
    }
    await page.close();
  } finally { await browser.close(); }
});
