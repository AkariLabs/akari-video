// L1 — 設定 › AI モデルの商用の札を記録する（wrapper 所掌の検証 fixture）。
//
//   L1_PORT=<CDP ポート> L1_OUT=<出力ディレクトリ> L1_STAGE=before|after node capture.mjs
//
// 「まだ呼べないモデルも表示」を入れ、各種類の「▾ ほかに N 種類」をすべて開いたうえで
// 全カードの札（.akari-ai-flags の先頭）を読み、対象 3 枚のカードを撮る。
import { mkdirSync, writeFileSync } from 'node:fs';
import pw from 'playwright-core';
const { chromium } = pw;

const PORT = process.env.L1_PORT || '9651';
const OUT = process.env.L1_OUT;
const STAGE = process.env.L1_STAGE || 'before';
mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let browser;
for (let i = 0; i < 240 && !browser; i++) { try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`); } catch { await sleep(1000); } }
const ctx = browser.contexts()[0];
let page = ctx.pages().find(p => !p.url().startsWith('devtools://'));
for (let i = 0; i < 60 && !page; i++) { await sleep(1000); page = ctx.pages().find(p => !p.url().startsWith('devtools://')); }
await page.setViewportSize({ width: 1600, height: 1000 }).catch(() => undefined);
await page.waitForSelector('.theia-ApplicationShell', { timeout: 240000 });
await page.waitForFunction(() => {
    const preload = document.querySelector('.theia-preload');
    return !preload || getComputedStyle(preload).display === 'none' || preload.offsetParent === null;
}, undefined, { timeout: 240000 });
await sleep(5000);
await page.keyboard.press('Escape');
await sleep(800);

await page.click('#shell-tab-akari-settings-opener');
await page.waitForSelector('[data-akari-settings-dialog]', { timeout: 60000 });
await sleep(1000);
await page.click('[data-settings-nav="ai-models"]');
await page.waitForSelector('[data-ai-models-view] [data-ai-model-card]', { timeout: 60000 });
await sleep(800);
if (await page.$eval('[data-ai-model-show-unavailable]', n => n.getAttribute('aria-pressed')) !== 'true') {
    await page.click('[data-ai-model-show-unavailable]');
    await sleep(700);
}

const cards = () => page.$$eval('[data-ai-model-card]', ns => ns.map(n => ({
    id: n.getAttribute('data-ai-model-card'),
    name: n.querySelector('h4')?.textContent,
    license: n.querySelector('.akari-ai-flags span')?.textContent
})));
const expandAll = async () => {
    for (let i = 0; i < 20; i++) {
        const closed = await page.$$('[data-ai-model-variants]');
        let opened = false;
        for (const toggle of closed) {
            if ((await toggle.textContent()).startsWith('▾')) { await toggle.click(); await sleep(400); opened = true; break; }
        }
        if (!opened) { return; }
    }
};
const shotCard = async (id, name) => {
    const card = await page.$(`[data-ai-model-card="${id}"]`);
    await card.scrollIntoViewIfNeeded();
    await sleep(300);
    await card.screenshot({ path: `${OUT}/${STAGE}-${name}.png` });
};

const badges = {};
for (const kind of ['image', 'video', 'voice', 'transcribe']) {
    await page.click(`[data-ai-model-kind="${kind}"]`);
    await sleep(600);
    await expandAll();
    for (const card of await cards()) { badges[card.id] = { name: card.name, license: card.license }; }
    if (kind === 'image') {
        await shotCard('fal:gpt-image-2.5-flare', 'gpt-image-2.5-flare');
        await shotCard('still:grok', 'still-grok');
    }
    if (kind === 'transcribe') {
        await shotCard('transcribe:whisper-cpp', 'whisper-cpp');
        await page.$eval('[data-ai-models-view]', n => n.scrollIntoView({ block: 'start' }));
        await sleep(300);
    }
}
await page.click('[data-ai-model-kind="image"]');
await sleep(600);
await expandAll();
await page.$eval('[data-ai-model-card="still:grok"]', n => n.scrollIntoView({ block: 'center' }));
await sleep(300);
await page.screenshot({ path: `${OUT}/${STAGE}-image-list.png` });

writeFileSync(`${OUT}/${STAGE}-badges.json`, `${JSON.stringify(badges, null, 2)}\n`);
console.log(JSON.stringify(badges, null, 2));
await browser.close();
