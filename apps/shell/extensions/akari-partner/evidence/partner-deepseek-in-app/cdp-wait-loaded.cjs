// 「始める」→ 埋め込みが実寸で開き、読み込みが完了するまで待つ（最大 N 秒）。main renderer だけに接続。
const path = require('path'); const { createRequire } = require('module');
const puppeteer = createRequire(path.join(process.env.AKARI_SHELL_DIR, 'package.json'))('puppeteer-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9380', defaultViewport: null, protocolTimeout: 40000, targetFilter: t => /lib\/frontend/.test(t.url()) || t.type() === 'browser' });
  let page; for (let i = 0; i < 60; i++) { page = (await browser.pages()).find(p => p.url().includes('lib/frontend/index.html')); if (page && await page.evaluate(() => !!(window.theia && window.theia.container && document.querySelector('.lm-TabBar-tab'))).catch(() => false)) break; await sleep(1000); }
  await sleep(3000);
  const shell = await page.evaluateHandle(() => { for (const [, bs] of window.theia.container._bindingDictionary._map) for (const b of bs) { const c = b.cache; if (c && c.constructor && c.constructor.name === 'ApplicationShell') return c; } return null; });
  await page.evaluate(async s => { try { await s.activateWidget('akari-partner-onboarding'); } catch {} }, shell); await sleep(1500);
  const pressed = await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === '開くだけ'); if (b) b.click(); const r = document.querySelector('[data-partner-entry="deepseek/dsh-web"]'); if (!r) return 'row missing'; r.click(); return 'clicked'; });
  const t0 = Date.now(); let last = ''; const max = Number(process.argv[2] || 150) * 1000; let result = 'TIMEOUT';
  while (Date.now() - t0 < max) {
    const s = await page.evaluate(async () => {
      let view = 'none', url = ''; try { const i = await window.electronAkariPartner.web.inspect(); view = i.viewBounds.width + 'x' + i.viewBounds.height; url = i.url; } catch {}
      const w = document.querySelector('#akari-partner-web'); const loading = w ? /読み込んでいます/.test(w.textContent || '') : null;
      const st = [...document.querySelectorAll('[data-akari-flow-state]')].map(e => e.getAttribute('data-akari-flow-state') + ':' + (e.textContent || '').trim().slice(0, 60)).join('|');
      return JSON.stringify({ view, loading, widget: !!w, st, url });
    }).catch(e => 'eval-error ' + e.message.slice(0, 40));
    if (s !== last) { console.log(`t+${Math.round((Date.now() - t0) / 1000)}s`, s); last = s; }
    try { const j = JSON.parse(s); if (j.widget && j.loading === false && j.view !== 'none' && !/^0x/.test(j.view)) { result = 'OPEN+LOADED'; break; } if (/failed/.test(j.st)) { result = 'FAILED'; break; } } catch {}
    await sleep(1500);
  }
  console.log('RESULT', pressed, result, Math.round((Date.now() - t0) / 1000) + 's'); browser.disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
