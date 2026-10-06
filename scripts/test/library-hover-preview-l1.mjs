import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(join(root, 'apps/shell/package.json'));
const { chromium } = require('playwright-core');
const endpoint = process.env.AKARI_LIBRARY_L1_CDP;
if (!endpoint) throw new Error('AKARI_LIBRARY_L1_CDP に隔離アプリの CDP URL を指定してください。');
const browser = await chromium.connectOverCDP(endpoint);
try {
    const page = browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().includes('index.html'));
    assert.ok(page, 'アプリの画面が見つかりません');
    const shots = process.env.AKARI_LIBRARY_L1_SHOTS;
    if (shots) await mkdir(shots, { recursive: true });
    const popup = page.locator('[data-akari-library-hover-preview]');
    const backHome = async () => {
        for (let index = 0; index < 3 && await page.locator('[data-akari-library-back]').count(); index++) {
            await page.locator('[data-akari-library-back]').first().click();
        }
    };
    const hover = async (name, selector) => {
        const card = page.locator(selector).first();
        await card.hover();
        await popup.waitFor({ timeout: 5000 });
        assert.equal(await popup.count(), 1, `${name}: 小窓は一つ`);
        if (shots) await page.screenshot({ path: join(shots, `${name}.png`) });
        return card;
    };

    await page.locator('[data-akari-open-catalog]').first().click();
    await backHome();
    await page.getByRole('button', { name: 'テキスト', exact: true }).first().click();
    const tab = page.locator('[data-akari-library-text-switch=telop]');
    await tab.click();
    const telops = '[data-akari-text-look-section=telop] [data-akari-library-card]';
    assert.ok(await page.locator(telops).count() <= 24, '初回テロップは 24 枚以下');
    await hover('telop', telops);
    await page.locator(telops).nth(1).hover();
    await page.waitForTimeout(350);
    assert.equal(await popup.count(), 1, 'カード間を移動しても小窓は一つ');
    await page.mouse.move(700, 100);
    assert.equal(await popup.count(), 0, 'カードから離れると閉じる');
    await tab.focus();
    await page.keyboard.press('Tab');
    await popup.waitFor({ timeout: 5000 });
    assert.equal(await page.evaluate(selector => !!document.activeElement?.matches(selector), telops), true, 'Tab でカードにフォーカスする');
    assert.equal(await popup.count(), 1, 'Tab でも小窓は一つ');
    await page.keyboard.press('Escape');
    assert.equal(await popup.count(), 0, 'Esc で閉じる');
    await backHome();
    await page.getByRole('button', { name: 'オーバーレイ', exact: true }).first().click();
    await hover('overlay', '[data-akari-library-category=overlay] [data-akari-hover-preview-src]');
    await page.evaluate(() => document.dispatchEvent(new Event('dragstart', { bubbles: true })));
    assert.equal(await popup.count(), 0, 'ドラッグ開始で閉じる');
    await page.evaluate(() => document.dispatchEvent(new Event('dragend', { bubbles: true })));
    await backHome();
    await page.getByRole('button', { name: 'トランジション', exact: true }).first().click();
    await hover('transition', '[data-akari-library-transition][data-akari-hover-preview-src]');
    console.log('library hover L1 PASS');
} finally {
    await browser.close();
}
