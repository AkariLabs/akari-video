import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { launchBrowser } from '../../../../../packages/overlay-runtime/test-harness/fixtures/browser.mjs';
import { captionWrapHeightDrag } from '../lib/common/caption-plate-handles.js';
import { captionOrientedFrame } from '../lib/common/caption-edit-geometry.js';
import { captionWrapPosition } from '../lib/common/caption-wrap-position.js';
import { captionTextStyleVars, renderCaptionFragment, renderResolvedSingleLineCaption } from '../../../../../packages/render-cut/src/captions.mjs';

const output = { width: 1920, height: 1080 };
const text = '今日は天気が良いので散歩';
const style = { vertical: true, size_px: 60, text_anchor: 'tl',
  position: { x: .4, y: .1 }, background: { color: '#111111', padding_px: 14, radius_px: 10 } };

const bootstrap = readFileSync(new URL('../src/browser/preview-script-bootstrap.ts', import.meta.url), 'utf8');
const selectionStart = bootstrap.indexOf('const applyCaptionSelectionAttrs =');
const selectionEnd = bootstrap.indexOf('const setCaptionAltAll =', selectionStart);
const dragStart = bootstrap.indexOf('const beginCaptionHandleDrag =');
const dragEnd = bootstrap.indexOf('const onCaptionPointerDown =', dragStart);
assert.ok(selectionStart >= 0 && selectionEnd > selectionStart && dragStart >= 0 && dragEnd > dragStart);
const selectionSource = bootstrap.slice(selectionStart, selectionEnd);
const dragSource = bootstrap.slice(dragStart, dragEnd);
const previewVerticalCss = bootstrap.match(/if \(style\.vertical\) css \+= '([^']+)';/u)?.[1];
assert.ok(previewVerticalCss);

function htmlFor(lines, pct, explicit = false) {
  const cueStyle = { ...style, wrap_width_pct: pct };
  const vars = captionTextStyleVars(cueStyle, output);
  const declarations = Object.entries(vars).map(([key, value]) => `${key}:${value}`).join(';');
  const html = explicit
    ? renderCaptionFragment(lines.join('\n'), { vertical: true, contextStyle: cueStyle,
      textStyleActive: true })
    : renderResolvedSingleLineCaption(lines.join(''), lines,
      { text_style: cueStyle, style_vars: vars });
  return `<style>html,body{margin:0;width:1920px;height:1080px}.caption-row-plate{position:absolute;inset:0}
    .akari-caption{font-family:sans-serif!important}</style>
    <div class="caption-row-plate" style="${declarations}">${html}</div>`;
}

test('vertical columns use output height even when the viewport is shorter', async t => {
  let browser;
  try { browser = await launchBrowser(); }
  catch (error) {
    if (error?.message !== 'headless Chrome が見つかりません') throw error;
    t.skip('headless Chrome 不在（ラッパーの L1 で実行）');
    return;
  }
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 600 });
    for (const renderer of ['osr', 'preview']) {
      for (const explicit of [false, true]) {
        const lines = explicit ? ['短い文', 'あ'.repeat(25)] : ['あ'.repeat(25)];
        await page.setContent(`<div style="position:relative;width:1920px;height:1080px">`
          + htmlFor(lines, undefined, explicit)
          + (renderer === 'preview' ? `<style>${previewVerticalCss}</style>` : '')
          + '</div>');
        const heights = await page.$$eval('.akari-caption__line', nodes => nodes.map(node => ({
          height: node.getBoundingClientRect().height,
          maxHeight: getComputedStyle(node).maxHeight
        })));
        assert.equal(heights.length, explicit ? 2 : 1, renderer);
        const longLine = heights.at(-1);
        assert.equal(longLine.maxHeight, '972px', renderer);
        assert.ok(Math.abs(longLine.height - 972) <= 2,
          `${renderer} ${explicit ? 'explicit' : 'plain'}: ${longLine.height}px`);
      }
    }
    await page.close();
  } finally { await browser.close(); }
});

test('vertical line cushions cover every wrapped column and expand sideways as height shrinks', async t => {
  let browser;
  try { browser = await launchBrowser(); }
  catch (error) {
    if (error?.message !== 'headless Chrome が見つかりません') throw error;
    t.skip('headless Chrome 不在（ラッパーの L1 で実行）');
    return;
  }
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    const boxes = [];
    for (const pct of [90, 50, 30]) {
      await page.setContent(htmlFor([text], pct));
      boxes.push(await page.evaluate(() => {
        const line = document.querySelector('.akari-caption__line');
        const plate = document.querySelector('.akari-caption__plate');
        const range = document.createRange(); range.selectNodeContents(line);
        return { line: line.getBoundingClientRect().toJSON(),
          plate: plate.getBoundingClientRect().toJSON(),
          ink: [...range.getClientRects()].map(rect => rect.toJSON()) };
      }));
    }
    assert.ok(boxes[0].line.width < boxes[1].line.width);
    assert.ok(boxes[1].line.width < boxes[2].line.width);
    assert.ok(boxes[0].line.height > boxes[1].line.height);
    assert.ok(boxes[1].line.height > boxes[2].line.height);
    for (const box of boxes) {
      assert.ok(Math.abs(box.line.width - box.plate.width) <= 2);
      for (const rect of box.ink) {
        assert.ok(rect.left >= box.line.left - 2 && rect.right <= box.line.right + 2);
      }
    }
    const drag = captionWrapHeightDrag('s', { top: boxes[0].line.top,
      bottom: boxes[0].line.bottom }, { x: 0, y: -432 }, 0, 1, output.height);
    assert.ok(drag.heightPct < 90);
    await page.setContent(htmlFor(['一行目の文', '二行目は少し長い文'], 50, true));
    const columns = await page.$$eval('.akari-caption__line', nodes => nodes.map(node =>
      node.getBoundingClientRect().toJSON()));
    assert.equal(columns.length, 2);
    assert.ok(columns[0].left > columns[1].left);
    assert.ok(Math.abs(columns[0].top - columns[1].top) <= 2);
    await page.close();
  } finally { await browser.close(); }
});

test('vertical grips are hollow hit targets and dragging holds the first column at the right edge', async t => {
  let browser;
  try { browser = await launchBrowser(); }
  catch (error) {
    if (error?.message !== 'headless Chrome が見つかりません') throw error;
    t.skip('headless Chrome 不在（ラッパーの L1 で実行）');
    return;
  }
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 640, height: 360 });
    const handleCss = '<style>#stage{position:absolute;left:0;top:0;width:1920px;height:1080px;'
      + 'transform-origin:0 0;transform:scale(0.3333333333)}'
      + '#caption-select-box{position:absolute}'
      + '#caption-select-box .akari-caption-handle-box{position:absolute;inset:0;pointer-events:none}'
      + '#caption-select-box .akari-caption-handle{position:absolute;width:11px;height:11px;'
      + 'border-radius:50%;background:#fff;border:1px solid #f70;box-shadow:0 1px 4px #000;'
      + 'pointer-events:auto}</style>';
    await page.setContent(handleCss + '<div id="stage">'
      + htmlFor([text], 75) + '<div id="caption-select-box"></div></div>');
    await page.evaluate(({ selectionSource, dragSource, heightSource, frameSource, positionSource }) => {
      window.__writes = [];
      window.akari = { engine: { captionWrite: async (_id, patch) => { window.__writes.push(patch); } },
        showWriteError: error => { throw error; } };
      const prelude = [
        "const stage=document.getElementById('stage');",
        "const row=stage.querySelector('.caption-row-plate');",
        "const captionSelectBox=document.getElementById('caption-select-box');",
        "const selectedCaptionId='c1',selectedCaptionIds=new Set(['c1']),captionAltAll=false;",
        "const captions=[{id:'c1',textStyle:{vertical:true}}],captionRows=new Map();",
        'let selectionDragActive=false,pendingCaptionDragReload=false;',
        'const applyCaptionRowSelectionAttrs=()=>{},syncCaptionHandleBox=()=>{},renderCaptionRow=()=>{};',
        'const selectedCaptionPlate=()=>row;',
        "const selectCaption=()=>{throw Error('selected grip was replaced')};",
        "const captionHandleTargets=()=>['c1'],setCaptionGroupMode=()=>{};",
        'const captionOutputPoint=(x,y)=>{const r=stage.getBoundingClientRect();'
          + 'return {x:(x-r.left)*1920/r.width,y:(y-r.top)*1080/r.height}};',
        "const captionVisualRect=()=>{const r=row.querySelector('.akari-caption__line').getBoundingClientRect();"
          + 'const a=captionOutputPoint(r.left,r.top),b=captionOutputPoint(r.right,r.bottom);'
          + 'return {left:a.x,top:a.y,right:b.x,bottom:b.y}};',
        "const captionLayoutRect=()=>{const ink=captionVisualRect(),"
          + "p=row.querySelector('.akari-caption__plate').getBoundingClientRect(),"
          + 'a=captionOutputPoint(p.left,p.top),b=captionOutputPoint(p.right,p.bottom);'
          + 'return {...ink,pivot:{x:(a.x+b.x)/2,y:(a.y+b.y)/2}}};',
        'const initial=captionVisualRect();captionSelectBox.style.left=initial.left+"px";'
          + 'captionSelectBox.style.top=initial.top+"px";'
          + 'captionSelectBox.style.width=(initial.right-initial.left)+"px";'
          + 'captionSelectBox.style.height=(initial.bottom-initial.top)+"px";',
        'const summary={output:{width:1920,height:1080}},CLICK_THRESHOLD_PX=4;',
        'const updateCaptionSelectBoxForRect=()=>{},updateCaptionSelectBox=()=>{};',
        'const captionWrapHeightDragFn=(' + heightSource + ');',
        'const captionOrientedFrameFn=(' + frameSource + ');',
        'const captionWrapPositionFn=(' + positionSource + ');'
      ].join('\n');
      new Function('window', 'document', prelude + '\n' + selectionSource + '\n'
        + dragSource + '\napplyCaptionSelectionAttrs();'
        + "stage.addEventListener('pointerdown',event=>{const h=event.target.closest('.akari-caption-handle');"
        + "if(h)beginCaptionHandleDrag(event,h,captions[0],'c1')});")(window, document);
    }, { selectionSource, dragSource, heightSource: captionWrapHeightDrag.toString(),
      frameSource: captionOrientedFrame.toString(), positionSource: captionWrapPosition.toString() });
    const grips = await page.evaluate(() => {
      const inspect = kind => {
        const node = document.querySelector('[data-h="' + kind + '"]');
        const bar = node.querySelector('span');
        const outer = getComputedStyle(node), inner = getComputedStyle(bar);
        return { cursor: outer.cursor, width: outer.width, height: outer.height,
          background: outer.backgroundColor, border: outer.borderTopWidth, shadow: outer.boxShadow,
          barWidth: inner.width, barHeight: inner.height, barBackground: inner.backgroundColor,
          barShadow: inner.boxShadow };
      };
      return { n: inspect('n'), s: inspect('s'),
        horizontalCount: document.querySelectorAll('[data-h="e"],[data-h="w"]').length };
    });
    assert.equal(grips.horizontalCount, 0);
    for (const grip of [grips.n, grips.s]) {
      assert.equal(grip.cursor, 'ns-resize');
      assert.equal(grip.width, '20px');
      assert.equal(grip.height, '11px');
      assert.match(grip.background, /rgba\(0, 0, 0, 0\)/u);
      assert.equal(grip.border, '0px');
      assert.equal(grip.shadow, 'none');
      assert.equal(grip.barWidth, '14px');
      assert.equal(grip.barHeight, '5px');
      assert.equal(grip.barBackground, 'rgb(255, 255, 255)');
      assert.match(grip.barShadow, /0px 1px 4px/u);
    }
    const measure = () => page.evaluate(() => {
      const stage = document.getElementById('stage').getBoundingClientRect();
      const rect = document.querySelector('.akari-caption__line').getBoundingClientRect();
      const sx = 1920 / stage.width, sy = 1080 / stage.height;
      return { left: (rect.left - stage.left) * sx, right: (rect.right - stage.left) * sx,
        top: (rect.top - stage.top) * sy, bottom: (rect.bottom - stage.top) * sy,
        width: rect.width * sx, height: rect.height * sy };
    });
    const before = await measure();
    const s = await page.$eval('[data-h="s"]', node => node.getBoundingClientRect().toJSON());
    const centerX = s.x + s.width / 2, centerY = s.y + s.height / 2;
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX, centerY - 90, { steps: 6 });
    const live = await measure();
    await page.mouse.up();
    await page.waitForFunction(() => window.__writes.length === 1);
    const patch = await page.evaluate(() => window.__writes[0].plateTransform);
    assert.ok(live.width > before.width && live.height < before.height);
    assert.ok(live.left < before.left);
    assert.ok(Math.abs(live.right - before.right) <= 2);
    assert.ok(Math.abs(live.top - before.top) <= 2);
    assert.ok(Math.abs(patch.cuePosition.value.position.x * output.width - live.left) <= 2);
    const savedVars = captionTextStyleVars({ ...style, wrap_width_pct: patch.wrapWidthPct,
      text_anchor: patch.cuePosition.value.anchor,
      position: patch.cuePosition.value.position }, output);
    await page.evaluate(vars => {
      const row = document.querySelector('.caption-row-plate');
      row.style.cssText = Object.entries(vars).map(([key, value]) => key + ':' + value).join(';');
    }, savedVars);
    const reloaded = await measure();
    for (const edge of ['left', 'right', 'top', 'bottom']) {
      assert.ok(Math.abs(reloaded[edge] - live[edge]) <= 2, edge);
    }
    await page.close();
  } finally { await browser.close(); }
});
