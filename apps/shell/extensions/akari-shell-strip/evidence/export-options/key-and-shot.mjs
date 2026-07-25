import { chromium } from 'playwright-core';

const [key, outPath] = process.argv.slice(2);
if (!key || !outPath) throw new Error('usage: node key-and-shot.mjs <key> <out.png>');

const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const context = browser.contexts()[0];
const pages = context.pages();
const page = pages.find(p => !p.url().startsWith('devtools://')) ?? pages[0];
await page.keyboard.press(key);
await page.waitForTimeout(500);
await page.screenshot({ path: outPath });
console.error(`pressed ${key} -> ${outPath}`);
await browser.close();
