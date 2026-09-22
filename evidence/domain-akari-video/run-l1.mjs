// L1 harness — 既定ドメイン akari.video への切り替え（wrapper 所掌の検証 fixture）。
//
//   L1_PORT=9455 L1_OUT=<出力ディレクトリ> L1_AKARI_HOME=<一時 AKARI_HOME> NODE_PATH=<playwright-core の node_modules> node run-l1.mjs
//
// 前提: Electron が --remote-debugging-port=$L1_PORT で起動済み。AKARI_HOME には旧ドメインの
// url を持つ store-credentials.json が置いてある（AKARI_ASSETS_CATALOG は未設定 = 既定のカタログ）。
//
// 観測すること:
//   1. 設定 > 接続 の Store「ストアを開く」が開こうとする URL（WindowService.openNewWindow を記録用に差し替え、外部ブラウザは開かない）
//   2. 素材ライブラリの件数と、有料素材の購入ボタンが開こうとする URL
//   3. 既定カタログ https://akari.video/assets/catalog.json の実フェッチ件数
//   4. 旧ドメイン url の store-credentials.json で entitlements の問い合わせ先が決まり、例外にならないこと
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(path.join(process.env.NODE_PATH, 'noop.js'));
const { chromium } = require('playwright-core');
const repo = fileURLToPath(new URL('../../', import.meta.url));
const PORT = process.env.L1_PORT || '9455';
const OUT = process.env.L1_OUT;
const AKARI_HOME = process.env.L1_AKARI_HOME;
mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const log = { port: PORT, startedAt: new Date().toISOString() };
const note = (key, value) => { log[key] = value; console.log(key, JSON.stringify(value)); };
const fail = message => { note('failure', message); writeFileSync(path.join(OUT, 'run-log.json'), JSON.stringify(log, null, 2)); throw new Error(message); };

// --- 4. entitlements の問い合わせ先（アプリと同じ resolver 実装・同じ AKARI_HOME）
const credentials = JSON.parse(readFileSync(path.join(AKARI_HOME, 'store-credentials.json'), 'utf8'));
note('storedCredentialsUrl', credentials.url);
const { fetchEntitlements } = await import(pathToFileURL(path.join(repo, 'packages/asset-resolver/src/entitlements.mjs')));
const { resolveEntitlementsUrl } = await import(pathToFileURL(path.join(repo, 'packages/asset-resolver/src/env.mjs')));
const entitlementCalls = [];
let entitlements;
try {
    entitlements = await fetchEntitlements({
        env: { AKARI_HOME },
        fetchImpl: async (url, init) => {
            const response = await fetch(url, init);
            entitlementCalls.push({ url: String(url), status: response.status });
            return response;
        }
    });
} catch (error) {
    fail(`fetchEntitlements threw: ${error?.message ?? error}`);
}
note('entitlementsUrl', resolveEntitlementsUrl({ AKARI_HOME }, credentials));
note('entitlementsCalls', entitlementCalls);
note('entitlementsResult', { status: entitlements.status, ids: [...(entitlements.ids ?? [])] });

// --- 3. 既定カタログの実フェッチ
const catalogResponse = await fetch('https://akari.video/assets/catalog.json');
const catalogJson = await catalogResponse.json();
note('defaultCatalog', {
    url: 'https://akari.video/assets/catalog.json',
    status: catalogResponse.status,
    base: catalogJson.base,
    items: catalogJson.items?.length,
    paidItems: catalogJson.items?.filter(item => (item.price ?? 0) > 0).length
});

// --- アプリへ接続
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
const context = browser.contexts()[0];
let page = context.pages().find(candidate => !candidate.url().startsWith('devtools://'));
for (let i = 0; i < 120 && !page; i++) { await sleep(1000); page = context.pages().find(candidate => !candidate.url().startsWith('devtools://')); }
note('pageUrl', page.url());
const consoleErrors = [];
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 300)); });
await page.waitForSelector('.theia-ApplicationShell', { timeout: 300000 });
await page.waitForFunction(() => {
    const preload = document.querySelector('.theia-preload');
    return !preload || getComputedStyle(preload).display === 'none' || preload.offsetParent === null;
}, undefined, { timeout: 300000 });
await sleep(5000);

// WindowService.openNewWindow を記録用に差し替える（外部ブラウザは開かない）。
note('patchedWindowServices', await page.evaluate(() => {
    window.__akariOpened = [];
    let patched = 0;
    for (const bindings of window.theia.container._bindingDictionary._map.values()) {
        for (const binding of bindings) {
            const instance = binding.cache;
            if (instance && typeof instance.openNewWindow === 'function' && !instance.__akariPatched) {
                instance.openNewWindow = (url, options) => { window.__akariOpened.push({ url, options }); return undefined; };
                instance.__akariPatched = true;
                patched++;
            }
        }
    }
    return patched;
}));

// --- 1. 設定 > 接続 の Store「ストアを開く」
await page.evaluate(() => {
    const bindings = window.theia.container._bindingDictionary;
    const klass = [...bindings._map.keys()].find(key => typeof key === 'function' && typeof key.prototype?.executeCommand === 'function');
    void window.theia.container.get(klass).executeCommand('akari.settings.open', { section: 'connections' });
});
await page.waitForSelector('[data-akari-settings-dialog] [data-akari-store-settings]', { timeout: 60000 });
await sleep(3000);
const storeRow = await page.evaluate(() => {
    const row = document.querySelector('[data-akari-store-settings]');
    const button = Array.from(row.querySelectorAll('button')).find(candidate => candidate.textContent.trim() === 'ストアを開く');
    return { text: row.textContent.replace(/\s+/g, ' ').trim().slice(0, 300), hasOpenButton: Boolean(button) };
});
note('storeRow', storeRow);
if (!storeRow.hasOpenButton) fail('Store row has no ストアを開く button');
await page.screenshot({ path: path.join(OUT, '01-settings-store.png') });
await page.evaluate(() => Array.from(document.querySelector('[data-akari-store-settings]').querySelectorAll('button')).find(candidate => candidate.textContent.trim() === 'ストアを開く').click());
await sleep(500);
note('storeOpened', await page.evaluate(() => window.__akariOpened.slice()));
await page.evaluate(() => {
    const dialog = document.querySelector('[data-akari-settings-dialog]');
    (dialog?.querySelector('[data-settings-nav]') ?? dialog)?.focus?.();
});
await page.keyboard.press('Escape');
await sleep(1500);

// --- 2. 素材ライブラリ（素材パネル → カタログ）
for (let attempt = 0; attempt < 60; attempt++) {
    const state = await page.evaluate(() => {
        const root = document.querySelector('[data-akari-top-view]');
        if (root && root.getBoundingClientRect().width > 0) return 'ready';
        const icon = Array.from(document.querySelectorAll('.codicon-files')).find(element => element.getBoundingClientRect().width > 0);
        if (!icon) return null;
        icon.click();
        return 'clicked';
    });
    if (state === 'ready') break;
    await sleep(700);
}
// ライブラリのホームはカテゴリカード。有料素材（既定カタログでは 3 件とも scene3d）を開く。
await page.waitForSelector('[data-akari-library-category="scene3d"], [data-akari-open-catalog]', { timeout: 60000 });
await page.evaluate(() => {
    const category = document.querySelector('[data-akari-library-category="scene3d"]');
    if (category) { category.click(); return; }
    document.querySelector('[data-akari-open-catalog]').click();
    setTimeout(() => document.querySelector('[data-akari-library-category="scene3d"]')?.click(), 1500);
});
let count = -1;
for (let i = 0; i < 180; i++) {
    count = await page.evaluate(() => Number(document.querySelector('[data-akari-catalog-item-count]')?.getAttribute('data-akari-catalog-item-count') ?? -1));
    const purchase = await page.evaluate(() => document.querySelectorAll('[data-akari-catalog-action="purchase"]').length);
    if (count > 0 && purchase > 0) break;
    await sleep(1000);
}
const library = await page.evaluate(() => {
    const purchases = Array.from(document.querySelectorAll('[data-akari-catalog-action="purchase"]'));
    return {
        itemCount: Number(document.querySelector('[data-akari-catalog-item-count]')?.getAttribute('data-akari-catalog-item-count') ?? -1),
        purchaseButtons: purchases.length,
        purchaseTitles: purchases.slice(0, 5).map(button => button.title)
    };
});
note('library', library);
await page.screenshot({ path: path.join(OUT, '02-library-purchase.png') });
if (library.purchaseButtons > 0) {
    await page.evaluate(() => document.querySelector('[data-akari-catalog-action="purchase"]').click());
    await sleep(500);
}
const opened = await page.evaluate(() => window.__akariOpened.slice());
note('allOpened', opened);
note('consoleErrors', consoleErrors.slice(0, 20));

const checks = {
    storeOpensNewLab: opened[0]?.url === 'https://akari.video/lab/',
    purchaseOpensNewLab: /^https:\/\/akari\.video\/lab\/asset\.html\?id=/.test(opened[1]?.url ?? ''),
    purchaseTitlesNewLab: library.purchaseTitles.length > 0 && library.purchaseTitles.every(title => title.includes('https://akari.video/lab/asset.html?id=')),
    libraryLoaded: library.itemCount > 0,
    defaultCatalogOk: log.defaultCatalog.status === 200 && log.defaultCatalog.items > 0,
    entitlementsToNewDomain: entitlementCalls.length === 1 && entitlementCalls[0].url === 'https://akari.video/api/store/v1/entitlements',
    entitlementsNoThrow: typeof entitlements.status === 'string'
};
note('checks', checks);
writeFileSync(path.join(OUT, 'run-log.json'), JSON.stringify(log, null, 2));
await browser.close().catch(() => {});
if (!Object.values(checks).every(Boolean)) { console.error('L1 FAIL'); process.exit(1); }
console.log('L1 PASS');
