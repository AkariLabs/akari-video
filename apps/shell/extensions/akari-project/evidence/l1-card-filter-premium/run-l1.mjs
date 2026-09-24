// L1: ライブラリのカード（顔 + 名前 + ⋯）・情報カード・ライセンスの窓・右クリックのメニュー・フィルター・促しのシート。
// 使い方: `apps/shell` を `npm run build` した後に `node run-l1.mjs before|after`。
// playwright-core は root の node_modules（PLAYWRIGHT_CORE で上書き可）。CDP ポートは L1_CDP_PORT（既定 9544）。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { deflateSync } from 'node:zlib';

const mode = process.argv[2] === 'after' ? 'after' : 'before';
const require = createRequire(import.meta.url);
const repo = resolve(import.meta.dirname, '../../../../../..');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || join(repo, 'node_modules/playwright-core'));
const shell = join(repo, 'apps/shell');
const electron = join(shell, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const out = join(import.meta.dirname, mode);
const temp = await mkdtemp(join(tmpdir(), `libcanvas-l1-${mode}-`));
const home = join(temp, 'home'), library = join(temp, 'library'), creator = join(temp, 'creator');
const project = join(temp, 'project'), base = join(temp, 'base');
const catalog = join(temp, 'catalog.json');
const port = Number(process.env.L1_CDP_PORT || 9544);
const observations = { mode, verified: [], passed: false };
let child, browser, stderr = '';

function sanitize(value) {
    return String(value).replaceAll(temp, '<fixture>').replace(/\/private\/(var|tmp)\/[^\s'"]*/g, '<tmp>')
        .replace(/\/Users\/[^/]+\//g, '<user>/').replaceAll(['akari-video', 'wt'].join('-'), '<worktree>');
}
function record(name, value) {
    observations[name] = value;
    observations.verified.push(name);
    console.log(`${name}: ${sanitize(JSON.stringify(value))}`);
}
async function waitFor(fn, timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        if (child && (child.exitCode !== null || child.signalCode !== null)) throw new Error('Electron exited during L1');
        try { const value = await fn(); if (value) return value; } catch { /* renderer may reload */ }
        await sleep(250);
    }
    throw new Error(`L1 timed out after ${timeout} ms`);
}

// --- fixture --------------------------------------------------------------------------------
function crc32(buffer) {
    let c, crc = 0xffffffff;
    for (const byte of buffer) {
        c = (crc ^ byte) & 0xff;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crc = (crc >>> 8) ^ c;
    }
    return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
}
/** 320×180 のグラデーション PNG（2 色の斜め + 丸）。 */
function png([r1, g1, b1], [r2, g2, b2], width = 320, height = 180) {
    const rows = [];
    for (let y = 0; y < height; y++) {
        const row = Buffer.alloc(1 + width * 3);
        for (let x = 0; x < width; x++) {
            const t = (x / width + y / height) / 2;
            const dx = x - width * 0.68, dy = y - height * 0.42, sun = dx * dx + dy * dy < (height * 0.16) ** 2;
            const px = sun ? [255, 236, 190] : [r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t];
            px.forEach((v, i) => { row[1 + x * 3 + i] = Math.round(v); });
        }
        rows.push(row);
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
        chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
function wav() {
    const samples = 8000, buffer = Buffer.alloc(44 + samples * 2);
    buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
    buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(8000, 24); buffer.writeUInt32LE(16000, 28);
    buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36);
    buffer.writeUInt32LE(samples * 2, 40);
    for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(Math.sin(i / 6) * 8000), 44 + i * 2);
    return buffer;
}
const LICENSES = {
    cc0: { spdx: 'CC0-1.0', scope: 'commercial-ok', attribution_required: false, ai_training_allowed: true },
    by: { spdx: 'CC-BY-4.0', scope: 'commercial-ok', attribution_required: true, ai_training_allowed: false },
    nc: { spdx: 'CC-BY-NC-4.0', scope: 'non-commercial', attribution_required: true, ai_training_allowed: false },
    own: { spdx: 'LicenseRef-user-owned', scope: 'private-owned', attribution_required: false, ai_training_allowed: false }
};
async function localAsset({ category, id, title, tags, license, media, colors, author, credit }) {
    const dir = join(library, category, id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'meta.json'), JSON.stringify({ id, category, title, description: 'L1 fixture', when_to_use: 'L1 fixture only',
        tags, knobs: [], ai_usage: 'L1 fixture only', requires: [], provenance: { origin: 'L1 fixture', generator: null },
        author, license: LICENSES[license], price: 0 }, null, 2));
    if (media === 'wav') await writeFile(join(dir, `${id}.wav`), wav());
    if (media === 'png') await writeFile(join(dir, `${id}.png`), png(...colors));
    await writeFile(join(dir, 'preview.png'), png(...colors));
    if (credit) await writeFile(join(dir, 'CREDIT.txt'), `${credit}\n`);
}
async function fixture() {
    for (const dir of [home, library, creator, base]) await mkdir(dir, { recursive: true });
    await cp(join(repo, 'templates/project-default'), project, { recursive: true });
    await localAsset({ category: 'still', id: 'sunset-coast', title: '夕暮れの海岸', tags: ['origin:own', '風景', '夕方', '海', '空', '旅行', '夏'],
        license: 'own', media: 'png', colors: [[255, 140, 60], [90, 40, 140]] });
    await localAsset({ category: 'still', id: 'mountain-morning', title: '朝の山並み', tags: ['origin:site', 'site:photo-free', '山', '朝'],
        license: 'cc0', media: 'png', colors: [[80, 170, 230], [30, 90, 60]], author: 'Photo Free' });
    await localAsset({ category: 'audio', id: 'pop-click', title: 'ポンと鳴るクリック', tags: ['origin:own', 'sfx', 'UI'],
        license: 'own', media: 'wav', colors: [[40, 40, 40], [70, 70, 70]] });
    await localAsset({ category: 'audio', id: 'bright-morning-bgm', title: '明るい朝の BGM', tags: ['origin:site', 'site:music-lab', 'bgm', '明るい'],
        license: 'by', media: 'wav', colors: [[50, 50, 60], [80, 60, 90]], author: 'Music Lab', credit: 'Music: Bright Morning / Music Lab (CC BY 4.0)' });
    await localAsset({ category: 'broll', id: 'city-night', title: '夜の街並み', tags: ['origin:site', 'site:clips', '夜', '街'],
        license: 'nc', media: 'png', colors: [[20, 30, 70], [200, 60, 120]], author: 'Clips NC' });
    await writeFile(join(base, 'premium-frame.png'), png([240, 200, 90], [150, 60, 20]));
    await writeFile(join(base, 'lab-texture.png'), png([200, 200, 210], [120, 130, 150]));
    await writeFile(join(base, 'premium-bgm.png'), png([60, 30, 80], [20, 20, 30]));
    await writeFile(catalog, JSON.stringify({ schema: 'akari-assets-catalog/v0', version: 'l1', base,
        items: [
            { id: 'premium-gold-frame', category: 'still', title: '金色の飾り枠', tags: ['still', '枠', '豪華'], preview: 'premium-frame.png',
                license: { spdx: 'LicenseRef-AKARI-Assets-v0', scope: 'commercial-ok', attribution_required: false, ai_training_allowed: false },
                author: 'AKARI Video Lab', price: 2980, version: 1, files: [{ name: 'frame.png', key: 'premium-frame.png' }] },
            { id: 'premium-cinematic-bgm', category: 'audio', title: 'シネマティックな BGM', tags: ['bgm', '壮大'], preview: 'premium-bgm.png',
                license: { spdx: 'LicenseRef-AKARI-Assets-v0', scope: 'commercial-ok', attribution_required: false, ai_training_allowed: false },
                author: 'AKARI Video Lab', price: 1480, version: 1, files: [] },
            { id: 'lab-paper-texture', category: 'still', title: '紙のテクスチャ', tags: ['still', '背景'], preview: 'lab-texture.png',
                license: { spdx: 'LicenseRef-AKARI-Sounds-Terms-v0', scope: 'commercial-ok', attribution_required: false, ai_training_allowed: false },
                author: 'AKARI Video Lab', price: 0, version: 1, files: [{ name: 'texture.png', key: 'lab-texture.png' }] }
        ] }, null, 2));
    const { createMyStyle } = await import(join(repo, 'apps/shell/extensions/akari-project/lib/common/my-style.js'));
    const style = createMyStyle({ id: 'orange-title', name: 'オレンジの見出し', when_to_use: '強調したい見出し', sample_text: '見出し',
        parts: [{ kind: 'look', scope: 'caption', mode: 'modify', text_style: { reference_height_px: 1080, color: '#ff8a3d', font_size: 72, font_weight: 800 } }] },
    '2026-09-25T00:00:00.000Z');
    await mkdir(join(library, 'styles', style.id), { recursive: true });
    await writeFile(join(library, 'styles', style.id, 'style.json'), JSON.stringify(style, null, 2));
}

// --- drive ----------------------------------------------------------------------------------
async function evaluate(page, fn, arg) { return page.evaluate(fn, arg); }
const SERVICES = `const c=window.theia.container;const keys=[...c._bindingDictionary._map.keys()];
const svc=(...m)=>{const k=keys.find(k=>typeof k==='function'&&m.every(n=>typeof k.prototype?.[n]==='function'));if(!k)throw new Error('missing '+m.join(','));return c.get(k)};`;
async function command(page, id, ...args) {
    return page.evaluate(`(async()=>{${SERVICES}return svc('executeCommand','getCommand').executeCommand(${JSON.stringify(id)},...${JSON.stringify(args)})})()`);
}
async function theme(page, type) {
    return page.evaluate(`(async()=>{${SERVICES}const t=svc('setCurrentTheme','getCurrentTheme','getThemes');await t.initialized;
        const th=t.getThemes().find(x=>x.type===${JSON.stringify(type)});t.setCurrentTheme(th.id,true);return th.id})()`);
}
async function widgetCall(page, method, ...args) {
    return page.evaluate(`(async()=>{${SERVICES}const shell=svc('addWidget','getTabBarFor');const w=shell.widgets.find(v=>v.id==='akari-role-buckets-widget');
        return w[${JSON.stringify(method)}](...${JSON.stringify(args)})})()`);
}
async function shot(page, name, clip) {
    await mkdir(out, { recursive: true });
    await sleep(350);
    const file = join(out, `${name}.png`);
    // 証跡にローカルの絶対パスを写さない（ホーム画面のプロジェクトの場所の表示を伏せる）。
    await page.evaluate(() => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (/\/(private\/)?(var|tmp)\/|\/Users\//.test(node.nodeValue)) node.nodeValue = node.nodeValue.replace(/\/(private\/)?(var|tmp)\/\S*|\/Users\/\S*/g, '…/project');
        }
    });
    if (clip === 'left') {
        const box = await page.locator('#akari-role-buckets-widget').boundingBox();
        await page.screenshot({ path: file, clip: { x: box.x, y: Math.max(0, box.y - 4), width: box.width, height: box.height + 4 } });
    } else if (clip) {
        await page.screenshot({ path: file, clip });
    } else {
        await page.screenshot({ path: file });
    }
    return `${mode}/${name}.png`;
}
const card = (page, key) => page.locator(`[data-akari-catalog-item="${key}"]`).first();
async function openCategory(page, key) {
    await widgetCall(page, 'showLibraryHome');
    await widgetCall(page, 'selectLibraryCategory', key);
    await sleep(400);
}
async function cardSummary(page) {
    return page.locator('[data-akari-catalog-item]').evaluateAll(nodes => nodes.map(node => ({
        key: node.getAttribute('data-akari-catalog-item'),
        text: node.innerText.replace(/\s+/g, ' ').trim(),
        draggable: node.getAttribute('draggable'),
        crown: !!node.querySelector('[data-akari-premium-crown]'),
        mark: node.querySelector('[data-akari-asset-mark]')?.getAttribute('data-akari-asset-mark') ?? null,
        dots: !!node.querySelector('[data-akari-library-dots]'),
        buttons: [...node.querySelectorAll('button')].map(button => button.getAttribute('aria-label') || button.innerText.trim())
    })));
}

async function before(page) {
    for (const [category, name] of [['image', 'cards-image'], ['bgm', 'cards-bgm'], ['sfx', 'cards-sfx']]) {
        await openCategory(page, category);
        record(`${name}-summary`, await cardSummary(page));
        record(name, await shot(page, name, 'left'));
    }
    await openCategory(page, 'image');
    const own = card(page, 'still/sunset-coast');
    const dots = own.getByRole('button', { name: /のメニュー/ });
    record('dotsCountOnImages', await page.getByRole('button', { name: /のメニュー/ }).count());
    await dots.click();
    await sleep(300);
    record('dotsMenu', await page.locator('[data-akari-context-menu] button').allInnerTexts());
    record('dots-menu', await shot(page, 'dots-menu'));
    await page.keyboard.press('Escape'); await page.mouse.click(5, 5);
    await card(page, 'still/premium-gold-frame').click({ button: 'right' });
    await sleep(300);
    record('premiumRightClickMenuItems', await page.locator('[data-akari-context-menu] button').count());
    await page.mouse.click(5, 5);
    await card(page, 'still/mountain-morning').click({ button: 'right' });
    await sleep(300);
    record('rightClickMenu', await page.locator('[data-akari-context-menu] button').allInnerTexts());
    record('right-click-menu', await shot(page, 'right-click-menu'));
    await page.mouse.click(5, 5);
    await openCategory(page, 'textstyle');
    record('mystyle', await shot(page, 'mystyle', 'left'));
    record('sourceRow', await page.locator('[data-source-filter]').allInnerTexts());
    await theme(page, 'light');
    await openCategory(page, 'image');
    record('cards-image-light', await shot(page, 'cards-image-light', 'left'));
    await theme(page, 'dark');
}

async function openMenu(page, key) {
    await page.mouse.click(5, 5);
    await card(page, key).click({ button: 'right' });
    await page.locator('[data-akari-context-menu]').waitFor();
    await sleep(200);
    return page.locator('[data-akari-context-menu] [data-akari-context-item]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-akari-context-item')));
}

async function after(page, themeType) {
    const suffix = themeType === 'light' ? '-light' : '';
    await theme(page, themeType);
    await openCategory(page, 'image');
    const summary = await cardSummary(page);
    record(`cards-image-summary${suffix}`, summary);
    record(`cards-image${suffix}`, await shot(page, `cards-image${suffix}`, 'left'));
    if (!suffix) {
        // カードに出さないもの
        for (const row of summary) {
            assert.doesNotMatch(row.text, /回|CC|License|¥|サブスク|使う|＋|風景|still/, `${row.key}: ${row.text}`);
            assert.ok(row.dots, `${row.key} has ⋯`);
        }
        assert.equal(summary.find(row => row.key === 'still/premium-gold-frame').crown, true);
        assert.equal(summary.filter(row => row.crown).length, 1, 'crown only on premium');
        assert.equal(await page.locator('[data-source-filter]').count(), 0, 'source row removed');
        record('cardChecks', { noLicenseTagUsageButtons: true, crownOnlyPremium: true, sourceRowRemoved: true,
            marks: Object.fromEntries(summary.map(row => [row.key, row.mark])) });
    }
    // ⋯ = 情報カード
    await card(page, 'still/sunset-coast').locator('[data-akari-library-dots]').click();
    const info = page.locator('[data-akari-library-info-card]');
    await info.waitFor();
    const infoText = (await info.innerText()).replace(/\s+/g, ' ');
    record(`infoCard${suffix}`, { text: infoText, spotlight: await page.locator('[data-akari-library-spotlight]').count() });
    record(`info-card${suffix}`, await shot(page, `info-card${suffix}`));
    if (!suffix) {
        await info.locator('[data-akari-info-keywords-all]').click();
        record('infoKeywordsAll', (await info.locator('[data-akari-info-keyword]').allInnerTexts()));
    }
    await page.keyboard.press('Escape');
    await waitFor(async () => (await page.locator('[data-akari-library-info-card]').count()) === 0, 5000);
    // ライセンスの窓（CC BY の BGM）
    await openCategory(page, 'bgm');
    await card(page, 'audio/bright-morning-bgm').locator('[data-akari-library-dots]').click();
    await info.waitFor();
    record(`info-card-bgm${suffix}`, await shot(page, `info-card-bgm${suffix}`));
    await info.locator('[data-akari-license-open]').click();
    const license = page.locator('[data-akari-license-dialog]');
    await license.waitFor();
    record(`licenseDialog${suffix}`, (await license.innerText()).replace(/\s+/g, ' '));
    record(`license-dialog${suffix}`, await shot(page, `license-dialog${suffix}`));
    if (!suffix) {
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
        await license.locator('[data-akari-license-credit]').click();
        record('creditCopied', await page.evaluate(() => navigator.clipboard.readText()));
    }
    await license.locator('[data-akari-license-close]').first().click();
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 5);
    // 右クリック = 操作のメニュー
    await openCategory(page, 'image');
    const placeable = await openMenu(page, 'still/sunset-coast');
    record(`right-click-menu${suffix}`, await shot(page, `right-click-menu${suffix}`));
    if (!suffix) {
        record('menuPlaceable', placeable);
        record('menuPremium', await openMenu(page, 'still/premium-gold-frame'));
        record('right-click-menu-premium', await shot(page, 'right-click-menu-premium'));
        record('menuLabFree', await openMenu(page, 'still/lab-paper-texture'));
        // ★
        await openMenu(page, 'still/mountain-morning');
        await page.locator('[data-akari-context-item="favorite"]').click();
        await waitFor(async () => JSON.parse(await readFile(join(home, 'library-favorites.json'), 'utf8')).keys.includes('still/mountain-morning'), 10000);
        record('favoriteSaved', JSON.parse(await readFile(join(home, 'library-favorites.json'), 'utf8')));
    }
    await page.mouse.click(5, 5);
    // フィルター
    await page.locator('[data-akari-library-filter-button]').click();
    const pop = page.locator('[data-akari-library-filter-popover]');
    await pop.waitFor();
    if (!suffix) {
        await pop.locator('[data-akari-filter-option="price:premium"]').click();
        await sleep(300);
        record('filterPremium', (await cardSummary(page)).map(row => row.key));
        await pop.locator('[data-akari-filter-option="price:premium"]').click();
        await pop.locator('[data-akari-filter-option="license:commercial"]').click();
        await pop.locator('[data-akari-filter-option="status:cached"]').click();
        await sleep(300);
        record('filterCommercialCached', (await cardSummary(page)).map(row => row.key));
        record('filterBadge', await page.locator('[data-akari-library-filter-count]').innerText());
        record('filter-popover', await shot(page, 'filter-popover'));
        await pop.locator('[data-akari-filter-clear]').click();
        await pop.locator('[data-akari-filter-option="status:favorite"]').click();
        await sleep(300);
        record('filterFavorite', (await cardSummary(page)).map(row => row.key));
        await pop.locator('[data-akari-filter-option="source:own"]').click();
        await sleep(300);
        record('filterFavoriteOwn', (await cardSummary(page)).map(row => row.key));
        await pop.locator('[data-akari-filter-clear]').click();
    } else {
        await pop.locator('[data-akari-filter-option="license:commercial"]').click();
        record('filter-popover-light', await shot(page, 'filter-popover-light'));
        await pop.locator('[data-akari-filter-clear]').click();
    }
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 5);
    // 促しのシート（プレミアムを「プレイヘッドに置く」）
    await openMenu(page, 'still/premium-gold-frame');
    const editBefore = await readFile(join(project, 'edit.json'), 'utf8').catch(() => '');
    await page.locator('[data-akari-context-item="place"]').click();
    const sheet = page.locator('[data-akari-premium-prompt]');
    await sheet.waitFor();
    record(`premiumPrompt${suffix}`, (await sheet.innerText()).replace(/\s+/g, ' '));
    record(`premium-prompt${suffix}`, await shot(page, `premium-prompt${suffix}`));
    await sleep(800);
    const editAfter = await readFile(join(project, 'edit.json'), 'utf8').catch(() => '');
    if (!suffix) record('premiumNotPlaced', { editJsonUnchanged: editBefore === editAfter });
    await sheet.locator('[data-akari-premium-close]').click();
    if (!suffix) {
        // コマンドからも同じシート
        await command(page, 'akari.library.showPremiumPrompt', { key: 'audio/premium-cinematic-bgm' });
        await sheet.waitFor();
        record('premiumPromptByCommand', (await sheet.innerText()).replace(/\s+/g, ' '));
        await sheet.locator('[data-akari-premium-close]').click();
        // ドラッグの payload
        const payload = await page.evaluate(() => new Promise(resolve => {
            const node = document.querySelector('[data-akari-catalog-item="still/premium-gold-frame"]');
            window.addEventListener('akari.library.dragStart', event => resolve({ detail: event.detail, draggable: node.getAttribute('draggable') }), { once: true });
            const transfer = new DataTransfer();
            node.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
            setTimeout(() => resolve({ timeout: true, draggable: node.getAttribute('draggable') }), 2000);
        }));
        record('premiumDragPayload', payload);
        assert.equal(payload.detail?.locked, true);
        await page.evaluate(() => document.querySelector('[data-akari-catalog-item="still/premium-gold-frame"]')
            .dispatchEvent(new DragEvent('dragend', { bubbles: true })));
    }
    // マイスタイル
    await openCategory(page, 'textstyle');
    record(`mystyle${suffix}`, await shot(page, `mystyle${suffix}`, 'left'));
    if (!suffix) {
        await page.locator('[data-akari-my-style-card]').first().click({ button: 'right' });
        await page.locator('[data-akari-context-menu]').waitFor();
        record('menuMyStyle', await page.locator('[data-akari-context-menu] [data-akari-context-item]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-akari-context-item'))));
        record('right-click-menu-mystyle', await shot(page, 'right-click-menu-mystyle'));
        await page.mouse.click(5, 5);
        await page.locator('[data-akari-catalog-preset-item]').first().click({ button: 'right' });
        await page.locator('[data-akari-context-menu]').waitFor();
        record('menuTextStyle', await page.locator('[data-akari-context-menu] [data-akari-context-item]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-akari-context-item'))));
        await page.mouse.click(5, 5);
        await openCategory(page, 'bgm');
        record('cards-bgm', await shot(page, 'cards-bgm', 'left'));
        await openCategory(page, 'broll');
        record('cards-broll', await shot(page, 'cards-broll', 'left'));
        await widgetCall(page, 'setCatalogViewMode', 'list');
        await openCategory(page, 'image');
        record('list-image', await shot(page, 'list-image', 'left'));
        record('list-image-summary', await cardSummary(page));
        await widgetCall(page, 'setCatalogViewMode', 'grid');
    }
}

try {
    await fixture();
    child = spawn(electron, [shell, project, `--remote-debugging-port=${port}`,
        `--user-data-dir=${join(temp, 'electron-profile')}`, '--no-sandbox'], { cwd: shell,
        env: { ...process.env, HOME: temp, XDG_CONFIG_HOME: join(temp, 'xdg-config'), XDG_CACHE_HOME: join(temp, 'xdg-cache'),
            THEIA_CONFIG_DIR: join(temp, 'theia'), AKARI_HOME: home,
            AKARI_LIBRARY_ROOT: library, AKARI_CREATOR_ROOT: creator, AKARI_ASSETS_CATALOG: catalog },
        stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-4000); });
    console.log(`pid ${child.pid}`);
    browser = await waitFor(() => chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => undefined), 120000);
    const page = await waitFor(async () => {
        for (const candidate of browser.contexts().flatMap(context => context.pages())) {
            if (await candidate.evaluate(() => Boolean(window.theia?.container)).catch(() => false)) return candidate;
        }
    }, 120000);
    await page.setViewportSize?.({ width: 1280, height: 800 }).catch(() => {});
    await waitFor(() => command(page, 'akari.catalog.open').then(() => true), 60000);
    await page.evaluate(`(()=>{${SERVICES}svc('addWidget','getTabBarFor').resize(360,'left')})()`);
    await page.locator('[data-akari-panel-segment="catalog"]').click();
    await waitFor(async () => (await widgetCall(page, 'catalogCategorySummaries')).length > 0, 60000);
    await sleep(1500);
    if (mode === 'before') await before(page);
    else { await after(page, 'dark'); await after(page, 'light'); await theme(page, 'dark'); }
    observations.passed = true;
} catch (error) {
    observations.failure = sanitize(error?.stack ?? error);
    console.error('L1 failed:', observations.failure, sanitize(stderr));
    process.exitCode = 1;
} finally {
    await mkdir(out, { recursive: true });
    await writeFile(join(out, 'observations.json'), `${sanitize(JSON.stringify(observations, null, 2))}\n`);
    await browser?.close().catch(() => {});
    if (child && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        child.kill('SIGTERM');
        await Promise.race([exited, sleep(10000)]);
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    await rm(temp, { recursive: true, force: true }).catch(() => {});
}
