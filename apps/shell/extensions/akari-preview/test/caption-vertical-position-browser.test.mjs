import assert from 'node:assert/strict';
import test from 'node:test';
import { launchBrowser } from '../../../../../packages/overlay-runtime/test-harness/fixtures/browser.mjs';
import { captionTextStyleVars } from '../../../../../packages/render-cut/src/captions.mjs';
import { applyCaptionContextField } from '../../akari-annotations/lib/common/caption-context-edit.js';

const output = { width: 1920, height: 1080 };
const css = `body{margin:0}.stage{position:relative;width:1920px;height:1080px}
  .akari-caption{position:absolute;inset:0;writing-mode:var(--caption-writing-mode,horizontal-tb);
    font:45px/1 sans-serif}
  .akari-caption__plate{position:absolute;top:var(--caption-top,auto);bottom:var(--caption-bottom,7%);
    left:var(--caption-left,0);right:var(--caption-right,0);width:var(--caption-width,auto);
    display:flex;flex-direction:column;align-items:var(--caption-align-items,stretch);
    translate:var(--caption-translate,none);scale:var(--caption-scale,1);transform-origin:center}
  .akari-caption__line{margin:0;padding:var(--plate-pad-y,.08em) var(--plate-pad-x,.42em);
    white-space:pre;writing-mode:horizontal-tb;width:max-content}
  .akari-caption--vertical .akari-caption__line{writing-mode:vertical-rl}
  .akari-caption.akari-caption--vertical .akari-caption__plate{left:var(--caption-left,0);
    right:var(--caption-right,0);width:var(--caption-width,max-content);margin-inline:0;
    writing-mode:horizontal-tb;align-items:var(--caption-align-items,center)}`;

function markup(style) {
  const vars = captionTextStyleVars(style, output);
  if (style.scale) vars['--caption-scale'] = String(style.scale);
  const declarations = Object.entries(vars).map(([name, value]) => `${name}:${value}`).join(';');
  return `<style>${css}</style><div class="stage"><div class="akari-caption ${style.vertical ? 'akari-caption--vertical' : ''}"
    style="${declarations}"><div class="akari-caption__plate"><p class="akari-caption__line">日本語字</p></div></div></div>`;
}

const measure = page => page.evaluate(() => {
  const plate = document.querySelector('.akari-caption__plate').getBoundingClientRect();
  return { left: plate.left, top: plate.top, width: plate.width, height: plate.height };
});

test('horizontal and vertical plates share the requested visible left edge; toggling keeps the center', async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: output.width, height: output.height });
    const position = { x: 0.4351, y: 0.5556 };
    const base = { text_anchor: 'tl', position, size_px: 45 };
    await page.setContent(markup(base));
    const horizontal = await measure(page);
    await page.setContent(markup({ ...base, vertical: true }));
    const vertical = await measure(page);
    assert.ok(Math.abs(horizontal.left - vertical.left) <= 2, `${horizontal.left} vs ${vertical.left}`);
    assert.ok(Math.abs(vertical.left - position.x * output.width) <= 2, `${vertical.left}`);

    const scaled = { ...base, scale: 3 };
    await page.setContent(markup(scaled));
    const before = await measure(page);
    let source = JSON.stringify({ captions: [{ id: 'a', text_style: scaled }] });
    await applyCaptionContextField('a', 'vertical', { enabled: true, box: before,
      stage: { left: 0, top: 0, ...output } }, [], {
      readSource: async () => source, writeSource: async next => { source = next; },
      recordHistory: () => undefined, reload: async () => undefined
    });
    await page.setContent(markup(JSON.parse(source).captions[0].text_style));
    const after = await measure(page);
    assert.ok(Math.abs(before.left + before.width / 2 - after.left - after.width / 2) <= 2);
    assert.ok(Math.abs(before.top + before.height / 2 - after.top - after.height / 2) <= 2);
    await applyCaptionContextField('a', 'vertical', { enabled: false, box: after,
      stage: { left: 0, top: 0, ...output } }, [], {
      readSource: async () => source, writeSource: async next => { source = next; },
      recordHistory: () => undefined, reload: async () => undefined
    });
    await page.setContent(markup(JSON.parse(source).captions[0].text_style));
    const restored = await measure(page);
    assert.ok(Math.abs(before.left + before.width / 2 - restored.left - restored.width / 2) <= 2);
    assert.ok(Math.abs(before.top + before.height / 2 - restored.top - restored.height / 2) <= 2);
    for (const withoutX of [{ text_anchor: 'tl', position: { y: 0.5556 } },
      { zone: 'top-left' }, {}]) {
      await page.setContent(markup({ ...withoutX, vertical: true, size_px: 45 }));
      const box = await measure(page);
      const expectedLeft = withoutX.text_anchor || withoutX.zone
        ? output.width * 0.04 : (output.width - box.width) / 2;
      assert.ok(Math.abs(box.left - expectedLeft) <= 2, `${JSON.stringify(withoutX)}: ${box.left}`);
      assert.ok(box.left >= -2 && box.top >= -2
        && box.left + box.width <= output.width + 2
        && box.top + box.height <= output.height + 2, JSON.stringify(box));
    }
    await page.close();
  } finally { await browser.close(); }
});
