// L1 harness (wrapper-owned verification fixture; lives outside the repo).
import pw from '/Users/ryoma/_edit/30_products/akari-video-wt/settings-dialog-backdrop/node_modules/playwright-core/index.js';
const { chromium } = pw;
import { mkdirSync, writeFileSync } from 'node:fs';

const PORT = process.env.L1_PORT || '9455';
const OUT = process.env.L1_OUT;
mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const measurements = { port: PORT, steps: [] };
const note = (k, v) => { measurements[k] = v; console.log(k, JSON.stringify(v)); };

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
const ctx = browser.contexts()[0];
let page = ctx.pages().find(p => !p.url().startsWith('devtools://'));
for (let i = 0; i < 60 && !page; i++) { await sleep(1000); page = ctx.pages().find(p => !p.url().startsWith('devtools://')); }
note('pageUrl', page.url());

const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') { consoleErrors.push(m.text().slice(0, 200)); } });

await page.waitForSelector('.theia-ApplicationShell', { timeout: 120000 });
await sleep(4000);

// --- 0. baseline: no settings overlay yet
note('overlayBefore', await page.$$eval('[data-akari-settings-dialog]', n => n.length));
await page.screenshot({ path: `${OUT}/00-shell.png` });

// --- 1. open the settings dialog through the gear tab in the left rail
const gear = await page.$('#shell-tab-akari-settings-opener');
note('gearTabFound', !!gear);
if (gear) { await gear.click(); } else {
  await page.evaluate(() => window.theia?.container?.get?.('CommandService'));
}
await page.waitForSelector('[data-akari-settings-dialog]', { timeout: 30000 });
await sleep(1200);
await page.screenshot({ path: `${OUT}/01-settings-open.png` });

// --- 2. computed style of the overlay (the blur/dim contract)
const style = await page.evaluate(() => {
  const overlay = document.querySelector('[data-akari-settings-dialog]');
  const block = overlay.querySelector('.dialogBlock');
  const cs = getComputedStyle(overlay);
  const ob = overlay.getBoundingClientRect();
  const bb = block.getBoundingClientRect();
  return {
    classes: overlay.className,
    backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter,
    webkitBackdropFilter: cs.webkitBackdropFilter,
    backgroundColor: cs.backgroundColor,
    transitionProperty: cs.transitionProperty,
    transitionDuration: cs.transitionDuration,
    opacity: cs.opacity,
    overlayRect: { x: ob.x, y: ob.y, w: ob.width, h: ob.height },
    blockRect: { x: bb.x, y: bb.y, w: bb.width, h: bb.height },
    styleTagPresent: !!document.getElementById('akari-settings-dialog-backdrop')
  };
});
note('overlayStyle', style);

// pick a point that is inside the overlay but outside the dialog block
const outside = { x: Math.round(style.blockRect.x / 2), y: Math.round(style.overlayRect.h / 2) };
const inside = { x: Math.round(style.blockRect.x + style.blockRect.w / 2), y: Math.round(style.blockRect.y + 40) };
note('points', { outside, inside });
note('outsideTargetIsOverlay', await page.evaluate(p => {
  const el = document.elementFromPoint(p.x, p.y);
  return el === document.querySelector('[data-akari-settings-dialog]');
}, outside));

// --- 3. drag that starts inside the dialog and ends on the overlay must NOT close
await page.mouse.move(inside.x, inside.y);
await page.mouse.down();
await page.mouse.move(outside.x, outside.y, { steps: 12 });
await page.mouse.up();
await sleep(800);
note('openAfterDragToOutside', await page.$$eval('[data-akari-settings-dialog]', n => n.length));
await page.screenshot({ path: `${OUT}/02-after-drag-out.png` });

// --- 3b. a click inside the dialog body must NOT close
await page.mouse.click(inside.x, inside.y);
await sleep(600);
note('openAfterInsideClick', await page.$$eval('[data-akari-settings-dialog]', n => n.length));

// --- 4. plain outside click closes
await page.mouse.click(outside.x, outside.y);
await sleep(1200);
note('openAfterOutsideClick', await page.$$eval('[data-akari-settings-dialog]', n => n.length));
await page.screenshot({ path: `${OUT}/03-closed-by-outside-click.png` });

// --- 5. reopen and close with Esc (regression: existing paths still work)
if (gear) { await gear.click(); }
await page.waitForSelector('[data-akari-settings-dialog]', { timeout: 30000 });
await sleep(800);
await page.keyboard.press('Escape');
await sleep(1000);
note('openAfterEscape', await page.$$eval('[data-akari-settings-dialog]', n => n.length));

// --- 6. right-click on the overlay must NOT close
if (gear) { await gear.click(); }
await page.waitForSelector('[data-akari-settings-dialog]', { timeout: 30000 });
await sleep(800);
await page.mouse.click(outside.x, outside.y, { button: 'right' });
await sleep(800);
note('openAfterRightClickOutside', await page.$$eval('[data-akari-settings-dialog]', n => n.length));
await page.keyboard.press('Escape');
await sleep(600);

// --- 7. other dialogs are unaffected: the CSS must not touch them
if (gear) { await gear.click(); }
await page.waitForSelector('[data-akari-settings-dialog]', { timeout: 30000 });
await sleep(600);
const otherDialogs = await page.evaluate(() => {
  const probe = document.createElement('div');
  probe.className = 'lm-Widget dialogOverlay';
  probe.setAttribute('data-akari-first-run-dialog', 'true');
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const out = { firstRunBackdropFilter: cs.backdropFilter, firstRunBackground: cs.backgroundColor };
  probe.remove();
  const probe2 = document.createElement('div');
  probe2.className = 'lm-Widget dialogOverlay';
  document.body.appendChild(probe2);
  const cs2 = getComputedStyle(probe2);
  out.plainOverlayBackdropFilter = cs2.backdropFilter;
  out.plainOverlayBackground = cs2.backgroundColor;
  probe2.remove();
  return out;
});
note('otherDialogs', otherDialogs);
await page.keyboard.press('Escape');
await sleep(500);

note('consoleErrors', consoleErrors);
writeFileSync(`${OUT}/measurements.json`, JSON.stringify(measurements, null, 2) + '\n');
await browser.close();
console.log('L1 OK');
