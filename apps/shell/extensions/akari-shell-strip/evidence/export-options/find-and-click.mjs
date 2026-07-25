import { chromium } from 'playwright-core';

const [text, outPath] = process.argv.slice(2);
if (!text || !outPath) throw new Error('usage: node find-and-click.mjs <button-text> <out.png>');

const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const context = browser.contexts()[0];
const page = context.pages().find(p => !p.url().startsWith('devtools://'));
const locator = page.locator(`button:has-text("${text}")`).first();
await locator.waitFor({ state: 'visible', timeout: 5000 });
await locator.click();
await page.waitForTimeout(600);
await page.screenshot({ path: outPath });
console.error(`clicked button with text "${text}" -> ${outPath}`);
await browser.close();
