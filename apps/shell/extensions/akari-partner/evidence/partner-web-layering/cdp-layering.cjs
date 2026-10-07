const path = require('path'); const { createRequire } = require('module');
const puppeteer = createRequire(path.join(process.env.AKARI_SHELL_DIR, 'package.json'))('puppeteer-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9381', defaultViewport: null, protocolTimeout: 40000, targetFilter: t => t.url().includes('lib/frontend') || t.type() === 'browser' });
  const page = (await browser.pages()).find(p => p.url().includes('lib/frontend/index.html'));
  const OUT = process.env.AKARI_OUT;
  const wvRect = () => page.evaluate(() => { const wv = document.querySelector('#akari-partner-web webview'); const r = wv.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const topAt = (x, y) => page.evaluate((x, y) => { const e = document.elementFromPoint(x, y); if (!e) return 'null'; const chain = []; let n = e; for (let i = 0; i < 4 && n; i++, n = n.parentElement) chain.push(n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (n.className && typeof n.className === 'string' ? '.' + n.className.split(' ').slice(0, 2).join('.') : '')); return chain.join(' < '); }, x, y);
  const r = await wvRect(); const cx = Math.round(r.x + r.w / 2), cy = Math.round(r.y + r.h / 2);
  console.log('webview rect', JSON.stringify(r), 'top at center BEFORE:', await topAt(cx, cy));
  // (a) 設定のポップアップ: 左下の歯車
  const gear = await page.evaluate(() => { const c = [...document.querySelectorAll('[title], [aria-label]')].filter(e => /設定/.test(e.getAttribute('title') || e.getAttribute('aria-label') || '')); const e = c.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0]; if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, t: e.getAttribute('title') || e.getAttribute('aria-label') }; });
  console.log('gear', JSON.stringify(gear));
  if (gear) { await page.mouse.click(gear.x, gear.y); await sleep(2500); }
  const dlg = await page.evaluate(() => { const c = [...document.querySelectorAll('.dialogOverlay, .theia-dialog, [role="dialog"], .akari-settings-dialog, .dialogBlock')].filter(e => e.offsetWidth > 0); return c.map(e => { const b = e.getBoundingClientRect(); return (e.className || '').toString().slice(0, 50) + ' ' + [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)].join(','); }); });
  console.log('dialogs', JSON.stringify(dlg));
  console.log('top at webview center WITH SETTINGS:', await topAt(cx, cy));
  await page.screenshot({ path: path.join(OUT, '41-layer-settings.png') });
  await page.keyboard.press('Escape'); await sleep(1200);
  // (d) 通知
  console.log('notify', await page.evaluate(() => { for (const [, bs] of window.theia.container._bindingDictionary._map) for (const b of bs) { const c = b.cache; if (c && c.constructor && c.constructor.name === 'MessageService') { c.info('重なり順の確認用の通知です（DeepSeek の上に出るはず）', { timeout: 15000 }); return 'sent'; } } return 'no MessageService'; }));
  await sleep(2000);
  const toast = await page.evaluate(() => { const e = document.querySelector('.theia-notification-list-item, .theia-notifications-container .theia-notification-list-item-container'); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
  console.log('toast', JSON.stringify(toast));
  if (toast) console.log('top at toast center:', await topAt(Math.round(toast.x + toast.w / 2), Math.round(toast.y + toast.h / 2)), '| overlaps webview:', toast.x + toast.w > r.x && toast.y + toast.h > r.y);
  await page.screenshot({ path: path.join(OUT, '42-layer-toast.png') });
  browser.disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
