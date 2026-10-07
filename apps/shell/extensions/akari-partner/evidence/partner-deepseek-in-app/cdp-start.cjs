// L1: DeepSeek Harness(web) を「始める」→ 同意 → 右パネルに作業画面(WebContentsView)。
const path = require('path'); const fs = require('fs'); const { createRequire } = require('module');
const SHELL = process.env.AKARI_SHELL_DIR; const OUT = process.env.AKARI_OUT; const PORT = process.env.AKARI_CDP_PORT || '9378';
const puppeteer = createRequire(path.join(SHELL, 'package.json'))('puppeteer-core');
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = []; const note = (...a) => { const l = `${new Date().toISOString()} ${a.join(' ')}`; log.push(l); console.log(l); };
const save = () => fs.writeFileSync(path.join(OUT, 'flow-log.txt'), log.join('\n') + '\n');
(async () => {
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null });
  const pick = async () => (await browser.pages()).find(p => p.url().includes('lib/frontend/index.html'));
  let page; for (let i = 0; i < 60 && !(page = await pick()); i++) await sleep(1000);
  await page.screenshot({ path: path.join(OUT, '00-kick.png') });
  for (let i = 0; i < 90; i++) { if (await page.evaluate(() => !!(window.theia && window.theia.container))) break; await sleep(1000); }
  await sleep(4000);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === '開くだけ'); if (b) b.click(); });
  const getService = name => page.evaluateHandle(name => { for (const [, bs] of window.theia.container._bindingDictionary._map) for (const b of bs) { const c = b.cache; if (c && c.constructor && c.constructor.name === name) return c; } return null; }, name);
  const shell = await getService('ApplicationShell');
  note('activate', await page.evaluate(async s => { try { await s.activateWidget('akari-partner-onboarding'); return 'ok'; } catch (e) { return String(e); } }, shell));
  await sleep(2500);
  let rows = await page.evaluate(() => [...document.querySelectorAll('[data-partner-entry]')].map(e => `${e.getAttribute('data-partner-entry')}|${e.getAttribute('data-partner-form')}|${(e.textContent || '').trim().slice(0, 40)}`));
  if (!rows.length) { // 右端の「＋」から開く
    await page.evaluate(() => { const t = [...document.querySelectorAll('.lm-TabBar-tab')].find(t => /パートナー/.test(t.title || t.textContent || '')); if (t) t.click(); });
    await sleep(2000);
    rows = await page.evaluate(() => [...document.querySelectorAll('[data-partner-entry]')].map(e => `${e.getAttribute('data-partner-entry')}|${e.getAttribute('data-partner-form')}|${(e.textContent || '').trim().slice(0, 40)}`));
  }
  note('rows', JSON.stringify(rows));
  await page.screenshot({ path: path.join(OUT, '01-panel.png') });
  note('press', await page.evaluate(() => { const r = document.querySelector('[data-partner-entry="deepseek/dsh-web"]'); if (!r) return 'row missing'; r.click(); return 'clicked ' + (r.textContent || '').trim(); }));
  let dialog = '';
  for (let i = 0; i < 40; i++) {
    dialog = await page.evaluate(() => { const d = document.querySelector('.dialogBlock, .theia-dialog, .dialogOverlay'); return d ? (d.textContent || '').trim() : ''; });
    if (dialog.includes('導入しますか')) break;
    const st = await page.evaluate(() => [...document.querySelectorAll('[data-akari-flow-state]')].map(e => e.getAttribute('data-akari-flow-state')).join(','));
    if (/complete|failed/.test(st)) break;
    await sleep(1000);
  }
  if (dialog.includes('導入しますか')) {
    note('dialog', dialog.replace(/\s+/g, ' ').slice(0, 700));
    await page.screenshot({ path: path.join(OUT, '02-consent.png') });
    note('consent', await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === '導入する'); if (!b) return 'no button'; b.click(); return 'accepted'; }));
  } else note('dialog', 'none (already installed)');
  let last = ''; const t0 = Date.now(); let done = '';
  while (Date.now() - t0 < 420000) {
    const s = await page.evaluate(() => [...document.querySelectorAll('[data-akari-flow-state]')].map(e => `${e.getAttribute('data-akari-flow-state')}: ${(e.textContent || '').trim().slice(0, 400)}`).join(' | '));
    if (s !== last) { note('flow', s); last = s; }
    const tabs = await page.evaluate(() => [...document.querySelectorAll('.lm-TabBar-tab')].map(t => (t.textContent || '').trim()).filter(Boolean));
    if (tabs.includes('DeepSeek Harness')) { done = 'tab'; break; }
    if (/failed/.test(s)) { done = 'failed'; break; }
    await sleep(1500);
  }
  note('result', done);
  await sleep(6000);
  const facts = await page.evaluate(async () => {
    const host = document.querySelector('#akari-partner-web div[style*="flex: 1 1 auto"]') || document.querySelector('#akari-partner-web');
    const r = host ? host.getBoundingClientRect() : null;
    let inspect = null; try { inspect = await window.electronAkariPartner.web.inspect(); } catch (e) { inspect = { error: String(e) }; }
    const note = (document.querySelector('#akari-partner-web') || {}).textContent || '';
    return { hostRect: r && { x: r.left, y: r.top, w: r.width, h: r.height }, inspect, note: note.trim().slice(0, 300), inner: { w: window.innerWidth, h: window.innerHeight } };
  });
  note('facts', JSON.stringify(facts));
  await page.screenshot({ path: path.join(OUT, '03-embedded.png') });
  // 埋め込み側のページ(別 target)へ接続して中身を見る
  const targets = browser.targets().map(t => ({ type: t.type(), url: t.url().replace(/token=[^&#]+/, 'token=***') }));
  note('targets', JSON.stringify(targets.filter(t => /127\.0\.0\.1:\d+/.test(t.url) && !/lib\/frontend/.test(t.url))));
  save(); browser.disconnect();
})().catch(e => { console.error(e); log.push(String(e && e.stack || e)); save(); process.exit(1); });
