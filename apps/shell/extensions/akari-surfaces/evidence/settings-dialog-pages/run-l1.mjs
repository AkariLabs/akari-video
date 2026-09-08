// L1 harness — 設定ダイアログのページ切替（wrapper 所掌の検証 fixture）。
//
//   L1_PORT=<CDP ポート> L1_OUT=<出力ディレクトリ> node run-l1.mjs
//
// 観測すること:
//   1. ナビの 8 項目それぞれで、表示中の section がちょうど 1 つ（= ページ切替）
//   2. 各ページ先頭に h2 見出し + 1 行説明が立つ
//   3. 本文ペイン（main）はページをまたいでスクロールしない（scrollHeight <= clientHeight）
//   4. 最後に見ていたページを localStorage（akari.settings.lastSection）が覚え、開き直しで戻る
//   5. akari.settings.open({ section: 'connections' }) が接続ページを直接開く
import { mkdirSync, writeFileSync } from 'node:fs';
import pw from 'playwright-core';
const { chromium } = pw;

const PORT = process.env.L1_PORT || '9466';
const OUT = process.env.L1_OUT;
mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const measurements = { port: PORT, pages: [] };
const note = (k, v) => { measurements[k] = v; console.log(k, JSON.stringify(v)); };

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
const ctx = browser.contexts()[0];
let page = ctx.pages().find(p => !p.url().startsWith('devtools://'));
for (let i = 0; i < 60 && !page; i++) { await sleep(1000); page = ctx.pages().find(p => !p.url().startsWith('devtools://')); }
note('pageUrl', page.url());

const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') { consoleErrors.push(m.text().slice(0, 200)); } });

await page.waitForSelector('.theia-ApplicationShell', { timeout: 180000 });
// プリロードの覆いが残っているとナビのクリックがそこへ吸われる（Playwright が
// "theia-preload intercepts pointer events" で失敗する）。消えるまで待つ。
await page.waitForFunction(() => {
    const preload = document.querySelector('.theia-preload');
    return !preload || getComputedStyle(preload).display === 'none' || preload.offsetParent === null;
}, undefined, { timeout: 180000 });
await sleep(5000);

const SECTIONS = ['start', 'export', 'quality', 'transcribe', 'connections', 'notifications', 'tools', 'developer'];

// 決定論のため、保存済みの最後のページを消してから始める。
note('clearedLastSection', await page.evaluate(() => {
    try { localStorage.removeItem('akari.settings.lastSection'); return true; } catch { return false; }
}));

const overlayCount = () => page.$$eval('[data-akari-settings-dialog]', nodes => nodes.length);

/** Esc で閉じる。macOS の Chromium はボタンのクリックでフォーカスを移さないため、
 * ダイアログ内の要素へ明示的にフォーカスしてから押す（押下先は実装と同じ node）。 */
const closeByEscape = async () => {
    await page.evaluate(() => {
        const dialog = document.querySelector('[data-akari-settings-dialog]');
        (dialog?.querySelector('[data-settings-nav]') ?? dialog)?.focus?.();
    });
    await page.keyboard.press('Escape');
    await sleep(1200);
    return overlayCount();
};

const openByGear = async () => {
    if (await overlayCount() > 0) { await closeByEscape(); }
    const gear = await page.$('#shell-tab-akari-settings-opener');
    if (!gear) { throw new Error('gear tab not found'); }
    await gear.click();
    await page.waitForSelector('[data-akari-settings-dialog]', { timeout: 60000 });
    await sleep(1500);
};

/** 表示中の section・見出し・説明・スクロール状況を DOM から直接読む。 */
const observe = () => page.evaluate(() => {
    const dialog = document.querySelector('[data-akari-settings-dialog]');
    if (!dialog) { return { open: false }; }
    const nodes = [...dialog.querySelectorAll('[data-akari-settings-section]')];
    const visible = nodes.filter(n => !n.hidden && getComputedStyle(n).display !== 'none');
    const body = nodes[0]?.parentElement;
    const shown = visible[0];
    const heading = shown?.querySelector('h2');
    const lead = heading?.nextElementSibling;
    return {
        open: true,
        sections: nodes.length,
        visible: visible.map(n => n.getAttribute('data-akari-settings-section')),
        activeNav: [...dialog.querySelectorAll('[data-settings-nav][aria-current="true"]')]
            .map(n => n.getAttribute('data-settings-nav')),
        heading: heading?.textContent ?? null,
        headingTag: heading?.tagName ?? null,
        lead: lead?.tagName === 'P' ? lead.textContent : null,
        // 本文ペインはページをまたがずスクロールしない（縦スクロールはページ内だけ）
        bodyScrollHeight: body?.scrollHeight ?? null,
        bodyClientHeight: body?.clientHeight ?? null,
        pageScrollable: shown ? shown.scrollHeight > shown.clientHeight + 1 : null,
        pageOverflowY: shown ? getComputedStyle(shown).overflowY : null,
        pageScrollTop: shown?.scrollTop ?? null,
        lastSection: (() => { try { return localStorage.getItem('akari.settings.lastSection'); } catch { return null; } })()
    };
});

// --- 1. 歯車から開く（保存値なし = 既定の「はじめかた」から）
await openByGear();
note('initialOpen', await observe());
await page.screenshot({ path: `${OUT}/00-open-default-start.png` });

// --- 2. ナビの 8 項目を順に押して 1 ページずつ観測 + SS
for (const [index, id] of SECTIONS.entries()) {
    await page.click(`[data-settings-nav="${id}"]`);
    await sleep(1200);
    const observation = { id, ...(await observe()) };
    measurements.pages.push(observation);
    console.log('page', JSON.stringify(observation));
    await page.screenshot({ path: `${OUT}/${String(index + 1).padStart(2, '0')}-${id}.png` });
}

// --- 3. 閉じて開き直すと、最後に見ていたページ（developer）へ戻る
note('overlaysAfterEscape', await closeByEscape());
await openByGear();
note('reopenRestored', await observe());
await page.screenshot({ path: `${OUT}/09-reopen-restores-last-page.png` });
await closeByEscape();

// --- 4. akari.settings.open({ section: 'connections' }) で接続ページが直接開く
note('commandOpen', await page.evaluate(async () => {
    const bindings = window.theia.container._bindingDictionary;
    const klass = [...bindings._map.keys()].find(key => typeof key === 'function'
        && typeof key.prototype?.executeCommand === 'function');
    // executeCommand の戻り値はダイアログが閉じるまで解決しない（open() の Promise）ので待たない。
    void window.theia.container.get(klass).executeCommand('akari.settings.open', { section: 'connections' });
    return true;
}));
await page.waitForSelector('[data-akari-settings-dialog]', { timeout: 60000 });
await sleep(2500);
note('commandOpenedSection', await observe());
await page.screenshot({ path: `${OUT}/10-command-opens-connections.png` });
note('overlaysAfterFinalEscape', await closeByEscape());

note('consoleErrors', consoleErrors);
writeFileSync(`${OUT}/measurements.json`, JSON.stringify(measurements, null, 2) + '\n');
await browser.close();
console.log('L1 OK');
