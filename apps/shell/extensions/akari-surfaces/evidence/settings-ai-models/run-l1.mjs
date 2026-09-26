// L1 harness — 設定 › AI モデル（wrapper 所掌の検証 fixture）。
//
//   L1_PORT=<CDP ポート> L1_OUT=<出力ディレクトリ> L1_APP_HOME=<一時 AKARI_HOME> L1_PROJECT=<一時プロジェクト> node run-l1.mjs
//
// 観測すること（契約の指示 3 の (i)〜(viii) + まだ呼べないモデルの表示）:
//   (i) 4 種類それぞれのカード (ii) 動画で「Seedance」を検索 (iii) 会社で絞る（Google）
//   (iv) ★ と ⋯ メニュー (v) 「▾ ほかに N 種類」を開く (vi) 比べる（表 + レーダー・列の切り替え）
//   (vii) この動画で固定 → プロジェクトの .akari/ai-models.json (viii) おすすめのセット「高品質」
//   (ix) 「まだ呼べないモデルも表示」で「まだ呼べない」の札つきで出る
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import pw from 'playwright-core';
const { chromium } = pw;

const PORT = process.env.L1_PORT || '9640';
const OUT = process.env.L1_OUT;
const APP_FILE = join(process.env.L1_APP_HOME, 'ai-models.json');
const PROJECT_FILE = join(process.env.L1_PROJECT, '.akari', 'ai-models.json');
mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const measurements = { port: PORT, steps: {} };
const note = (k, v) => { measurements.steps[k] = v; console.log(k, JSON.stringify(v)); };
const readJson = file => existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;

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
note('nav', await page.$$eval('[data-settings-nav]', ns => ns.map(n => n.getAttribute('data-settings-nav'))));
await page.click('[data-settings-nav="ai-models"]');
await page.waitForSelector('[data-ai-models-view] [data-ai-model-card]', { timeout: 60000 });
await sleep(800);

const cards = () => page.$$eval('[data-ai-model-card]', ns => ns.map(n => ({
    id: n.getAttribute('data-ai-model-card'),
    name: n.querySelector('h4')?.textContent,
    flags: [...n.querySelectorAll('.akari-ai-flags span')].map(s => s.textContent),
    starred: n.querySelector('[data-ai-model-star]')?.getAttribute('aria-pressed') === 'true',
    variants: n.querySelector('[data-ai-model-variants]')?.textContent ?? null
})));
const shot = async (name, selector) => {
    if (selector) { await page.$eval(selector, n => n.scrollIntoView({ block: 'start' })); await sleep(300); }
    await page.screenshot({ path: `${OUT}/${name}.png` });
};
const kind = async id => { await page.click(`[data-ai-model-kind="${id}"]`); await sleep(600); };
const cardSelector = id => `[data-ai-model-card="${id}"]`;
const menuAction = async (id, action) => {
    await page.click(`${cardSelector(id)} [data-ai-model-menu]`);
    await sleep(300);
    await page.click(`[data-ai-model-menu-items="${id}"] [data-ai-model-action="${action}"]`);
    await sleep(900);
};

// (i) 4 種類
note('kindButtons', await page.$$eval('[data-ai-model-kind]', ns => ns.map(n => n.textContent.trim())));
for (const [index, id] of ['image', 'video', 'voice', 'transcribe'].entries()) {
    await kind(id);
    note(`i-${id}`, await cards());
    await shot(`01${'abcd'[index]}-${id}`, '[data-ai-models-view]');
}

// (ii) 動画で「Seedance」
await kind('video');
await page.fill('[data-ai-model-search]', 'Seedance');
await sleep(600);
note('ii-search-seedance', await cards());
await shot('02-video-search-seedance', '[data-ai-models-view]');
await page.fill('[data-ai-model-search]', '');
await sleep(400);

// (iii) 会社で絞る（Google）— 静止画
await kind('image');
await page.click('[data-ai-model-maker="google"]');
await sleep(600);
note('iii-maker-google', await cards());
await shot('03-image-maker-google', '[data-ai-models-view]');
await page.click('[data-ai-model-maker="all"]');
await sleep(400);

// (iv) ★ と ⋯ メニュー
const before = (await cards()).find(c => c.id === 'fal:nano-banana-pro-edit');
await page.click(`${cardSelector('fal:nano-banana-pro-edit')} [data-ai-model-star]`);
await sleep(900);
const after = (await cards()).find(c => c.id === 'fal:nano-banana-pro-edit');
note('iv-star', { before: before?.starred, after: after?.starred, appFile: readJson(APP_FILE) });
await page.click(`${cardSelector('still:antigravity')} [data-ai-model-menu]`);
await sleep(400);
note('iv-menu-items', await page.$$eval('[data-ai-model-menu-items="still:antigravity"] [data-ai-model-action]',
    ns => ns.map(n => ({ action: n.getAttribute('data-ai-model-action'), label: n.textContent, disabled: n.disabled }))));
await shot('04-star-and-menu', '[data-ai-models-view]');
await page.click(`[data-ai-model-menu-items="still:antigravity"] [data-ai-model-action="default"]`);
await sleep(900);
note('iv-default-app', { card: (await cards()).find(c => c.id === 'still:antigravity'), appFile: readJson(APP_FILE) });
await shot('04b-default-app', '[data-ai-models-view]');

// (v) ▾ ほかに N 種類（動画）
await kind('video');
const variantsBefore = (await cards()).map(c => c.id);
const kling = await page.$('[data-ai-model-variants="kling-v3"]');
note('v-toggle-label', await kling?.textContent());
await kling.click();
await sleep(600);
note('v-expanded', { before: variantsBefore, after: (await cards()).map(c => c.id) });
await shot('05-variants-expanded', cardSelector('fal:kling-v3-pro-i2v'));

// (vi) 比べる（表 + レーダー・列の切り替え）
for (const id of ['fal:kling-v3-pro-i2v', 'fal:veo-3.1-flf', 'fal:seedance-2.0-i2v']) { await menuAction(id, 'compare'); }
const compareState = () => page.evaluate(() => ({
    columns: [...document.querySelectorAll('[data-ai-model-compare-select]')].map(s => s.value),
    radars: [...document.querySelectorAll('[data-ai-model-radar]')].map(s => ({
        id: s.getAttribute('data-ai-model-radar'),
        axes: [...s.querySelectorAll('text')].map(t => t.textContent),
        series: [...s.querySelectorAll('[data-ai-model-radar-series]')].map(g => ({ id: g.getAttribute('data-ai-model-radar-series'), points: g.getAttribute('points'), stroke: g.getAttribute('stroke') }))
    })),
    rows: [...document.querySelectorAll('[data-ai-model-compare-table] tr')].map(tr => [...tr.children].map(td => td.tagName === 'TH' && td.querySelector('select') ? td.querySelector('select').value : td.textContent.trim()))
}));
note('vi-compare', await compareState());
await shot('06a-compare-table-radar', '[data-ai-model-compare]');
await page.selectOption('[data-ai-model-compare-select="1"]', 'fal:wan-2.7-i2v');
await sleep(800);
note('vi-compare-switched', await compareState());
await shot('06b-compare-switched-column', '[data-ai-model-compare]');
await page.click('[data-ai-model-compare-remove="fal:seedance-2.0-i2v"]');
await sleep(700);
const afterRemove = (await compareState()).columns;
await page.click('[data-ai-model-compare-add]');
await sleep(700);
note('vi-compare-remove-add', { afterRemove, afterAdd: (await compareState()).columns });

// (vii) この動画で固定
await page.$eval('[data-ai-models-view]', n => n.scrollIntoView({ block: 'start' }));
await menuAction('fal:veo-3.1-flf', 'project');
note('vii-project-fixed', { card: (await cards()).find(c => c.id === 'fal:veo-3.1-flf'), projectFile: readJson(PROJECT_FILE) });
await shot('07-project-fixed', cardSelector('fal:veo-3.1-flf'));
writeFileSync(`${OUT}/07-project-ai-models.json`, `${JSON.stringify(readJson(PROJECT_FILE), null, 2)}\n`);

// (viii) おすすめのセット「高品質」（アプリ全体）
await page.$eval('[data-ai-models-view]', n => n.scrollIntoView({ block: 'start' }));
await page.click('[data-ai-model-scope="app"]');
await page.click('[data-ai-model-set="quality"]');
await sleep(1200);
const perKind = {};
for (const id of ['image', 'video', 'voice', 'transcribe']) {
    await kind(id);
    perKind[id] = (await cards()).filter(c => c.flags.some(f => f === 'いつもの' || f === 'この動画で固定')).map(c => ({ id: c.id, flags: c.flags }));
}
note('viii-set-quality', { perKind, appFile: readJson(APP_FILE), projectFile: readJson(PROJECT_FILE) });
await kind('image');
await shot('08-set-quality', '[data-ai-models-view]');
writeFileSync(`${OUT}/08-app-ai-models.json`, `${JSON.stringify(readJson(APP_FILE), null, 2)}\n`);

// (ix) まだ呼べないモデル
const hidden = (await cards()).map(c => c.id);
await page.click('[data-ai-model-show-unavailable]');
await sleep(700);
const shown = await cards();
note('ix-unavailable', { defaultIds: hidden, withUnavailable: shown.filter(c => c.flags.includes('まだ呼べない')).map(c => c.id) });
await shot('09-show-unavailable', '[data-ai-models-view]');

note('consoleErrors', consoleErrors);
writeFileSync(`${OUT}/measurements.json`, `${JSON.stringify(measurements, null, 2)}\n`);
await browser.close();
