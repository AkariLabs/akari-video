import assert from 'node:assert/strict';
import test from 'node:test';
import { launchBrowser } from '../../../../../packages/overlay-runtime/test-harness/fixtures/browser.mjs';
import { captionWrapWidthDrag } from '../lib/common/caption-plate-handles.js';
import { captionOrientedFrame, captionWrapAnchorDelta, captionWrapResize } from '../lib/common/caption-edit-geometry.js';
import { captionWrapPosition } from '../lib/common/caption-wrap-position.js';
import { readHandlerSource } from './helpers/handler-source.mjs';

const handler = readHandlerSource();
const visual = handler.slice(handler.indexOf('const captionVisualRect ='),
  handler.indexOf('const frameCaptionPosition =', handler.indexOf('const captionVisualRect =')));
const layout = handler.slice(handler.indexOf('const captionLayoutRect ='),
  handler.indexOf('            // overlay-runtime', handler.indexOf('const captionLayoutRect =')));
const drag = handler.slice(handler.indexOf('const beginCaptionHandleDrag ='),
  handler.indexOf('const onCaptionPointerDown =', handler.indexOf('const beginCaptionHandleDrag =')));
assert.ok(visual.includes('getBoundingClientRect') && layout.includes('captionVisualRect') && drag.includes('captionWrapPositionFn'));

test('zero-sized caption lines and motion replay cannot write a displaced wrap position', async t => {
  let browser;
  try { browser = await launchBrowser(); }
  catch (error) {
    if (error?.message !== 'headless Chrome が見つかりません') throw error;
    t.skip('headless Chrome 不在');
    return;
  }
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 640, height: 360 });
    await page.setContent(`<style>
      .caption-row-plate{position:absolute;left:100px;top:80px;width:300px}
      .akari-caption__plate{position:relative;width:300px}
      .akari-caption__line{font:24px sans-serif;line-height:32px;white-space:nowrap}
      .akari-caption-handle{display:block;position:absolute;left:295px;top:0;width:12px;height:24px;background:red}
      </style><div id="stage" style="position:absolute;left:0;top:0;width:640px;height:360px">
      <div class="caption-row-plate"><div class="akari-caption__plate">
      <div class="akari-caption__line" id="hidden" style="display:none">旧行</div>
      <div class="akari-caption__line" id="visible"><span class="akari-caption__type-char" style="opacity:0">文字</span>字幕</div>
      <i class="akari-caption-handle" data-h="e"></i></div></div></div>`);
    await page.evaluate(({ visual, layout, drag, width, frame, anchor, resize, position }) => {
      window.__writes = [];
      window.akari = { engine: { captionWrite: async (_id, patch) => window.__writes.push(patch) },
        showWriteError: error => { throw error; } };
      const source = `
        const stage=document.getElementById('stage');
        const captionLayer=stage;
        const captionPlate=document.querySelector('.caption-row-plate');
        const selectedCaptionPlate=()=>captionPlate;
        const captionOutputPoint=(x,y)=>({x,y});
        ${visual}${layout}
        const caption={id:'c1',timeDomain:'output',textStyle:{text_anchor:'mc',position:{x:.2,y:.3}}};
        const selectedCaptionId='c1', captionAltAll=false,selectedCaptionIds=new Set(['c1']),captions=[caption];
        let selectionDragActive=false,pendingCaptionDragReload=false;
        const selectCaption=()=>{},setCaptionGroupMode=()=>{},captionHandleTargets=()=>['c1'];
        const captionWrapWidthDragFn=(${width});
        const captionOrientedFrameFn=(${frame});
        const captionWrapAnchorDeltaFn=(${anchor});
        const captionWrapResizeFn=(${resize});
        const captionWrapPositionFn=(${position});
        const summary={output:{width:640,height:360}},CLICK_THRESHOLD_PX=4;
        const updateCaptionSelectBoxForRect=()=>{},updateCaptionSelectBox=()=>{};
        ${drag}
        window.__measure=()=>captionVisualRect(captionPlate);
        stage.addEventListener('pointerdown',event=>{
          const handle=event.target.closest('.akari-caption-handle');
          if(handle)beginCaptionHandleDrag(event,handle,caption,'c1');
        });`;
      new Function('window', 'document', source)(window, document);
    }, { visual, layout, drag, width: captionWrapWidthDrag.toString(), frame: captionOrientedFrame.toString(),
      anchor: captionWrapAnchorDelta.toString(), resize: captionWrapResize.toString(),
      position: captionWrapPosition.toString() });
    const good = await page.evaluate(() => window.__measure());
    assert.ok(good.left >= 100 && good.top >= 80, '非表示の行は矩形に混ざらない');
    const handle = await page.$eval('[data-h="e"]', node => node.getBoundingClientRect().toJSON());
    const x = handle.x + handle.width / 2, y = handle.y + handle.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.evaluate(() => { document.getElementById('visible').style.display = 'none'; });
    assert.equal(await page.evaluate(() => window.__measure()), null);
    await page.mouse.move(x - 35, y);
    await page.mouse.up();
    assert.equal(await page.evaluate(() => window.__writes.length), 0, '矩形が無い move は保存しない');
    await page.evaluate(() => {
      const line = document.getElementById('visible');
      line.style.display = '';
      line.dataset.akariMotionReplay = '1';
    });
    assert.equal(await page.evaluate(() => window.__measure()), null, '実演中は測らない');
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 30, y);
    await page.mouse.up();
    assert.equal(await page.evaluate(() => window.__writes.length), 0, '実演中は保存しない');
    await page.evaluate(() => {
      delete document.getElementById('visible').dataset.akariMotionReplay;
      document.getElementById('visible').style.transform = 'translateX(-500px)';
    });
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 30, y);
    await page.mouse.up();
    assert.equal(await page.evaluate(() => window.__writes.length), 0, '範囲外の位置は保存しない');
    await page.evaluate(() => { document.getElementById('visible').style.transform = ''; });
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 30, y);
    await page.mouse.up();
    const patches = await page.evaluate(() => window.__writes);
    assert.equal(patches.length, 1, '選択中の文字 span は通常の折り返し操作を妨げない');
    assert.ok(patches[0].plateTransform.cuePosition.value.position.x >= -0.2);
    await page.evaluate(() => document.querySelectorAll('.akari-caption__line').forEach(line => line.remove()));
    assert.equal(await page.evaluate(() => window.__measure()), null, '描画前の空の行も測らない');
    await page.close();
  } finally { await browser.close(); }
});

test('wrap position rejects coordinates well outside the stage', () => {
  assert.throws(() => captionWrapPosition(-200, 100, 640, 360), RangeError);
  assert.throws(() => captionWrapPosition(100, 500, 640, 360), RangeError);
  assert.deepEqual(captionWrapPosition(100, 80, 640, 360), {
    anchor: 'tl', position: { x: 0.1563, y: 0.2222 }
  });
});
