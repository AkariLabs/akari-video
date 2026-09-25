import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { launchBrowser } from '../../../../../packages/overlay-runtime/test-harness/fixtures/browser.mjs';
import { captionControlScale } from '../lib/common/caption-control-scale.js';
import { captionWrapWidthDrag } from '../lib/common/caption-plate-handles.js';
import { previewSelectionHandlesStyle } from '../lib/browser/preview-selection-handles-style.js';

const handler = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const start = handler.indexOf('const beginCaptionHandleDrag =');
const end = handler.indexOf("captionLayer.addEventListener('pointerdown', event =>", start);
assert.ok(start >= 0 && end > start);
const handleDragSource = handler.slice(start, end);
const cssStart = handler.indexOf('.caption-row-plate .akari-caption-handle-box {');
const cssEnd = handler.indexOf('.caption-row-plate.akari-caption-host--editing,', cssStart);
const baseCss = handler.slice(cssStart, cssEnd);

test('a selected output caption keeps its grabbed edge and writes wrap width without changing size', async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    const sx = 332 / 1920, sy = 187 / 1080;
    const vars = captionControlScale(1920, 332, 1080, 187);
    const declarations = Object.entries(vars).map(([key, value]) => `${key}:${value}`).join(';');
    await page.setViewport({ width: 640, height: 360 });
    await page.setContent(`<style>${baseCss}${previewSelectionHandlesStyle}</style>
      <div id="overlay-stage" style="position:absolute;left:20px;top:20px;width:1920px;height:1080px;transform-origin:0 0;transform:scale(${sx},${sy})">
        <div class="caption-row-plate" style="position:absolute;left:0;top:0;width:1920px;height:1080px">
          <div class="akari-caption-handle-box" style="position:absolute;left:100px;top:100px;width:400px;height:100px;${declarations}">
            <i class="akari-caption-handle" data-h="e"></i>
          </div>
        </div>
      </div>`);
    await page.evaluate(({ handleDragSource, wrapSource }) => {
      window.__writes = [];
      window.akari = { engine: { captionWrite: async (_id, patch) => { window.__writes.push(patch); } },
        showWriteError: error => { throw error; } };
      const setup = `
        const captionLayer=document.getElementById('overlay-stage');
        const captionPlate=document.querySelector('.caption-row-plate');
        const caption={id:'c1',timeDomain:'output',textStyle:{text_anchor:'tl',position:{x:.05,y:.1},size_px:38}};
        const selectedCaptionId='c1',captionAltAll=false,selectedCaptionIds=new Set(['c1']),captions=[caption];
        let selectionDragActive=false,pendingCaptionDragReload=false;
        const selectCaption=()=>{throw Error('selected handle was replaced')};
        const setCaptionGroupMode=()=>{};
        const captionHandleTargets=()=>['c1'];
        const stage=document.getElementById('overlay-stage');
        const outputPoint=(x,y)=>{const r=stage.getBoundingClientRect();return {x:(x-r.left)/(r.width/1920),y:(y-r.top)/(r.height/1080)}};
        const captionOutputPoint=outputPoint;
        const captionVisualRect=()=>{const r=document.querySelector('.akari-caption-handle-box').getBoundingClientRect();const a=outputPoint(r.left,r.top),b=outputPoint(r.right,r.bottom);return {left:a.x,right:b.x,top:a.y,bottom:b.y}};
        const captionLayoutRect=captionVisualRect;
        const summary={output:{width:1920,height:1080}},CLICK_THRESHOLD_PX=4;
        const updateCaptionSelectBoxForRect=()=>{},updateCaptionSelectBox=()=>{};
        const captionWrapWidthDragFn=(${wrapSource});
        ${handleDragSource}
        captionLayer.addEventListener('pointerdown',event=>{const handle=event.target.closest('.akari-caption-handle');if(handle)beginCaptionHandleDrag(event,handle,caption,'c1')});
      `;
      new Function('window', 'document', setup)(window, document);
    }, { handleDragSource, wrapSource: captionWrapWidthDrag.toString() });
    const before = await page.$eval('[data-h="e"]', node => node.getBoundingClientRect().toJSON());
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    await page.mouse.move(before.x + before.width / 2 - 45, before.y + before.height / 2, { steps: 5 });
    await page.mouse.up();
    await page.waitForFunction(() => window.__writes.length === 1);
    const result = await page.evaluate(() => ({ patch: window.__writes[0].plateTransform,
      handleConnected: document.querySelector('[data-h="e"]')?.isConnected }));
    assert.ok(result.patch.wrapWidthPct > 0 && result.patch.wrapWidthPct < 400 / 1920 * 100);
    assert.equal(result.patch.scale, undefined);
    assert.ok(Math.abs(result.patch.cuePosition.value.position.x - 100 / 1920) < .001);
    assert.equal(result.handleConnected, true);
    await page.close();
  } finally { await browser.close(); }
});
