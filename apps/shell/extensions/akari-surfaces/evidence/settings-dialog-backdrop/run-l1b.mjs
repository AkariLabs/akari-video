import pw from '/Users/ryoma/_edit/30_products/akari-video-wt/settings-dialog-backdrop/node_modules/playwright-core/index.js';
const { chromium } = pw;
import { writeFileSync } from 'node:fs';
const OUT = process.env.L1_OUT;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.L1_PORT}`);
const page = browser.contexts()[0].pages().find(p => !p.url().startsWith('devtools://'));
const out = {};

// widen the window so the area outside the 1040px dialog is large enough to judge the blur by eye
const session = await browser.contexts()[0].newCDPSession(page);
await session.send('Emulation.setDeviceMetricsOverride', { width: 1800, height: 1050, deviceScaleFactor: 2, mobile: false });
await sleep(1500);

const gear = await page.$('#shell-tab-akari-settings-opener');
await gear.click();
await page.waitForSelector('[data-akari-settings-dialog]', { timeout: 30000 });
await sleep(1500);
await page.screenshot({ path: `${OUT}/04-wide-blur-on.png` });
out.blurOn = await page.evaluate(() => {
  const o = document.querySelector('[data-akari-settings-dialog]');
  const cs = getComputedStyle(o);
  const b = o.querySelector('.dialogBlock').getBoundingClientRect();
  return { backdropFilter: cs.backdropFilter, background: cs.backgroundColor, block: { x: b.x, w: b.width }, viewport: [innerWidth, innerHeight] };
});

// A/B: disable the injected <style> at runtime only (no source change) to show the same frame unblurred
await page.evaluate(() => { document.getElementById('akari-settings-dialog-backdrop').disabled = true; });
await sleep(800);
await page.screenshot({ path: `${OUT}/05-wide-blur-off-control.png` });
out.blurOff = await page.evaluate(() => {
  const cs = getComputedStyle(document.querySelector('[data-akari-settings-dialog]'));
  return { backdropFilter: cs.backdropFilter, background: cs.backgroundColor };
});
await page.evaluate(() => { document.getElementById('akari-settings-dialog-backdrop').disabled = false; });
await sleep(800);

// outside click at the wide layout too, then screenshot the restored (sharp) app
const p = { x: Math.round(out.blurOn.block.x / 2), y: 500 };
await page.mouse.click(p.x, p.y);
await sleep(1200);
out.openAfterOutsideClickWide = await page.$$eval('[data-akari-settings-dialog]', n => n.length);
await page.screenshot({ path: `${OUT}/06-wide-closed-sharp.png` });
console.log(JSON.stringify(out, null, 2));
writeFileSync(`${OUT}/measurements-wide.json`, JSON.stringify(out, null, 2) + '\n');
await browser.close();
