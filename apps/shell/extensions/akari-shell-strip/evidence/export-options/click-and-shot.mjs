import { chromium } from 'playwright-core';

const [x, y, outPath] = process.argv.slice(2);
if (!x || !y || !outPath) throw new Error('usage: node click-and-shot.mjs <x> <y> <out.png>');

const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const context = browser.contexts()[0];
const pages = context.pages();
const page = pages.find(p => !p.url().startsWith('devtools://')) ?? pages[0];
await page.mouse.click(Number(x), Number(y));
await page.waitForTimeout(600);
await page.screenshot({ path: outPath });
console.error(`clicked (${x},${y}) -> ${outPath}`);
await browser.close();
