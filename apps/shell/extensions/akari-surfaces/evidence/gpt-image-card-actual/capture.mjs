// L1 harness — 設定 › AI モデルの GPT Image 2.5 Flare のカード・比べるの表・レーダー（wrapper 所掌の検証 fixture）。
//
//   L1_PORT=<CDP ポート> L1_OUT=<出力ディレクトリ> L1_PHASE=before|after node capture.mjs
//
// playwright-core はリポ外のスクラッチディレクトリに入れ、NODE_PATH で渡す。
// 観測: (1) 静止画の GPT Image 2.5 Flare のカード（料金・出力の解像度）
//       (2) 比べる（Flare + Nano Banana 2 + Sunburst）の表とレーダーの値
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const PORT = process.env.L1_PORT || '9659';
const OUT = process.env.L1_OUT;
const PHASE = process.env.L1_PHASE || 'after';
mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const result = { phase: PHASE };

let browser;
for (let i = 0; i < 180 && !browser; i++) { try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`); } catch { await sleep(1000); } }
const ctx = browser.contexts()[0];
let page = ctx.pages().find(p => !p.url().startsWith('devtools://'));
for (let i = 0; i < 60 && !page; i++) { await sleep(1000); page = ctx.pages().find(p => !p.url().startsWith('devtools://')); }
const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') { consoleErrors.push(m.text().slice(0, 200)); } });
await page.setViewportSize({ width: 1600, height: 1000 }).catch(() => undefined);
await page.waitForSelector('.theia-ApplicationShell', { timeout: 180000 });
await page.waitForFunction(() => {
    const preload = document.querySelector('.theia-preload');
    return !preload || getComputedStyle(preload).display === 'none' || preload.offsetParent === null;
}, undefined, { timeout: 180000 });
await sleep(5000);
await page.keyboard.press('Escape');
await sleep(800);

await page.click('#shell-tab-akari-settings-opener');
await page.waitForSelector('[data-akari-settings-dialog]', { timeout: 60000 });
await sleep(1000);
await page.click('[data-settings-nav="ai-models"]');
await page.waitForSelector('[data-ai-models-view] [data-ai-model-card]', { timeout: 60000 });
await sleep(800);
await page.click('[data-ai-model-kind="image"]');
await sleep(600);
// Sunburst は「まだ呼べない」なので、比べるの候補に入れるため表示を広げる
await page.click('[data-ai-model-show-unavailable]');
await sleep(700);

const FLARE = 'fal:gpt-image-2.5-flare';
const SUNBURST = 'fal:gpt-image-2.5-sunburst';
const card = id => page.$eval(`[data-ai-model-card="${id}"]`, n => ({
    id: n.getAttribute('data-ai-model-card'),
    name: n.querySelector('h4')?.textContent,
    price: n.querySelector('.akari-ai-price')?.textContent,
    text: n.innerText.replace(/\s+/g, ' ').trim()
}));
result.flareCard = await card(FLARE);
result.sunburstCard = await card(SUNBURST);
console.log(JSON.stringify(result.flareCard));
await page.$eval(`[data-ai-model-card="${FLARE}"]`, n => n.scrollIntoView({ block: 'center' }));
await sleep(400);
await page.screenshot({ path: `${OUT}/${PHASE}-01-flare-card.png` });

const addCompare = async id => {
    await page.click(`[data-ai-model-card="${id}"] [data-ai-model-menu]`);
    await sleep(300);
    await page.click(`[data-ai-model-menu-items="${id}"] [data-ai-model-action="compare"]`);
    await sleep(900);
};
for (const id of [FLARE, 'fal:nano-banana-2', SUNBURST]) {
    if (await page.$(`[data-ai-model-card="${id}"]`)) { await addCompare(id); }
}
result.compare = await page.evaluate(() => ({
    columns: [...document.querySelectorAll('[data-ai-model-compare-select]')].map(s => s.value),
    radar: [...document.querySelectorAll('[data-ai-model-radar] [data-ai-model-radar-series]')].map(g => ({ id: g.getAttribute('data-ai-model-radar-series'), points: g.getAttribute('points') })),
    radarAxes: [...document.querySelectorAll('[data-ai-model-radar] text')].map(t => t.textContent),
    rows: [...document.querySelectorAll('[data-ai-model-compare-table] tr')].map(tr => [...tr.children].map(td => td.tagName === 'TH' && td.querySelector('select') ? td.querySelector('select').value : td.textContent.trim()))
}));
await page.$eval('[data-ai-model-compare]', n => n.scrollIntoView({ block: 'start' }));
await sleep(400);
await page.screenshot({ path: `${OUT}/${PHASE}-02-compare-table-radar.png` });
const table = await page.$('[data-ai-model-compare-table]');
await table.scrollIntoViewIfNeeded();
await sleep(300);
await table.screenshot({ path: `${OUT}/${PHASE}-03-compare-table.png` });
result.consoleErrors = consoleErrors;
writeFileSync(`${OUT}/${PHASE}-observed.json`, `${JSON.stringify(result, null, 2)}\n`);
await browser.close();
