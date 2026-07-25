import { chromium } from 'playwright-core';
import { writeFile } from 'node:fs/promises';

const outPath = process.argv[2];
if (!outPath) throw new Error('usage: node screenshot.mjs <out.png>');

const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const contexts = browser.contexts();
const context = contexts[0];
const pages = context.pages();
console.error(`pages: ${pages.length}`);
for (const p of pages) {
    console.error(' -', p.url());
}
const page = pages.find(p => !p.url().startsWith('devtools://')) ?? pages[0];
await page.screenshot({ path: outPath, fullPage: false });
console.error(`screenshot saved to ${outPath}`);
await browser.close();
