// AKARI チャットの L1 用 CDP 補助。AKARI_SHELL_DIR=<apps/shell> AKARI_CDP_PORT=<port> node cdp-l1.cjs <コマンド> ...
// コマンド: eval <js本体> | shot <png> | shotel <selector> <png> | clicktext <selector> [文字] | click <selector> | type <selector> <文字> | key <キー> | dropfiles <selector> <パス,パス>
const path = require('path'); const { createRequire } = require('module');
const req = createRequire(path.join(process.env.AKARI_SHELL_DIR, '..', '..', 'node_modules', 'puppeteer', 'package.json'));
const puppeteer = req('puppeteer-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:' + (process.env.AKARI_CDP_PORT || '9391'), defaultViewport: null, protocolTimeout: 60000, targetFilter: t => t.url().includes('lib/frontend') || t.type() === 'browser' });
  let page; for (let i = 0; i < 90; i++) { page = (await browser.pages()).find(p => p.url().includes('lib/frontend/index.html')); if (page && await page.evaluate(() => !!(window.theia && document.querySelector('.lm-TabBar-tab'))).catch(() => false)) break; await sleep(1000); }
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'eval') { const r = await page.evaluate(new Function(`return (async () => { ${a} })()`)); console.log(typeof r === 'string' ? r : JSON.stringify(r, null, 1)); }
  else if (cmd === 'shot') { await page.screenshot({ path: a }); console.log('saved', a); }
  else if (cmd === 'shotel') { const el = await page.$(a); await el.screenshot({ path: b }); console.log('saved', b); }
  else if (cmd === 'clicktext') { const r = await page.evaluate((sel, txt) => { const el = [...document.querySelectorAll(sel)].find(e => e.checkVisibility() && (!txt || (e.textContent || '').trim().includes(txt))); if (!el) return null; const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; }, a, b || ''); if (!r) { console.log('not found'); } else { await page.mouse.click(r[0], r[1]); console.log('clicked', r); } }
  else if (cmd === 'dropfiles') { const r = await page.evaluate(sel => { const b = document.querySelector(sel).getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; }, a); const files = b.split(','); const client = await page.target().createCDPSession(); const data = { items: [], files, dragOperationsMask: 1 }; for (const type of ['dragEnter', 'dragOver', 'drop']) { await client.send('Input.dispatchDragEvent', { type, x: r[0], y: r[1], data }); } console.log('dropped', files.length); }
  else if (cmd === 'click') { await page.click(a); console.log('clicked'); }
  else if (cmd === 'type') { await page.focus(a); await page.keyboard.type(b); console.log('typed'); }
  else if (cmd === 'key') { await page.keyboard.press(a); console.log('pressed'); }
  browser.disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
