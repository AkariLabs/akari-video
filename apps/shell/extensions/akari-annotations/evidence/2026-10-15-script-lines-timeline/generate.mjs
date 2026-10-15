import { scriptFixture } from './fixtures.mjs';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { parseScriptLines } from '../../lib/common/script-lines.js';

const here = dirname(fileURLToPath(import.meta.url));
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);
const fixture = scriptFixture;
const lines = parseScriptLines(JSON.stringify(fixture));
assert.equal(lines.plans.length, 2);
assert.equal(lines.plans.filter(plan => plan.done).length, 1);
assert.equal(lines.memos.length, 1);

// Extract the exact selectors used by the live timeline; do not copy their colors into evidence.
const styleSource = await readFile(resolve(here, '../../src/browser/style/annotations-widget-style.ts'), 'utf8');
const begin = '/* BEGIN script band CSS */';
const end = '/* END script band CSS */';
const first = styleSource.indexOf(begin);
const last = styleSource.indexOf(end, first + begin.length);
assert.ok(first >= 0 && last > first);
const scriptCss = styleSource.slice(first + begin.length, last);
const duration = 20;
const percent = seconds => `${seconds / duration * 100}%`;
const plans = lines.plans.map(plan => `<button class="akari-script-plan${plan.done ? ' is-done' : ''}"
    style="top: 3px; left: ${percent(plan.at)}; width: ${plan.duration ? percent(plan.duration) : '8px'}; height: 22px"
    title="${escapeHtml(plan.text)}">${escapeHtml(plan.text)}</button>`).join('\n');
const memos = lines.memos.map(memo => `<button class="akari-script-memo"
    style="top: 8px; left: calc(${percent(memo.at)} - 6px)"
    title="${escapeHtml(memo.text)}" aria-label="${escapeHtml(memo.text)}"></button>`).join('\n');
const html = `<!doctype html>
<html lang="ja"><meta charset="utf-8"><title>台本段の描画証跡</title>
<style>
  body { margin: 0; padding: 42px; background: #191a20; color: #f6f4ff; font: 13px sans-serif; }
  .akari-annotations-widget { --theia-foreground: #f6f4ff; --theia-editorWidget-background: #25262e;
    --theia-focusBorder: #a893f2; --theia-widget-border: #4c4d55; }
  .timeline { display: grid; grid-template-columns: 136px 1fr; width: 960px; border: 1px solid #4c4d55; }
  .akari-track-header-row { position: relative; box-sizing: border-box; }
  .akari-track-band { position: relative; box-sizing: border-box; }
  ${scriptCss}
  .evidence-tooltip { margin: 16px 0 0 136px; padding: 6px 9px; width: fit-content;
    border: 1px solid #4c4d55; border-radius: 4px; background: #25262e; }
</style>
<div class="akari-annotations-widget"><div class="timeline">
  <div class="akari-track-header-row akari-script-header" style="height: 28px">台本</div>
  <div class="akari-track-band akari-script-band" style="height: 28px">${plans}${memos}</div>
</div><div class="evidence-tooltip" aria-label="memo title"></div></div>
</html>\n`;
await writeFile(resolve(here, 'script-band.html'), html);

const browser = await chromium.launch({ headless: true });
try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 180 }, deviceScaleFactor: 1 });
    await page.setContent(html);
    const memo = page.locator('.akari-script-memo');
    await memo.hover();
    const title = await memo.getAttribute('title');
    assert.equal(title, lines.memos[0].text);
    // Native title bubbles are not included in headless screenshots. Show its asserted text below the row.
    await page.locator('.evidence-tooltip').evaluate((element, text) => { element.textContent = text; }, `title: ${title}`);
    await page.screenshot({ path: resolve(here, 'script-band.png') });
    await page.close();
} finally {
    await browser.close();
}
