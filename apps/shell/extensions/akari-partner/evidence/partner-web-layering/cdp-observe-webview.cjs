// webview 版の観察: 何も押さずに、webview 要素の有無・矩形・読み込み状態を読む（main renderer に接続）。
const path = require('path'); const { createRequire } = require('module');
const puppeteer = createRequire(path.join(process.env.AKARI_SHELL_DIR, 'package.json'))('puppeteer-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9381', defaultViewport: null, protocolTimeout: 40000, targetFilter: t => t.url().includes('lib/frontend') || t.type() === 'browser' });
  let page; for (let i = 0; i < 60; i++) { page = (await browser.pages()).find(p => p.url().includes('lib/frontend/index.html')); if (page && await page.evaluate(() => !!(window.theia && window.theia.container && document.querySelector('.lm-TabBar-tab'))).catch(() => false)) break; await sleep(1000); }
  const max = Number(process.argv[2] || 60) * 1000; const t0 = Date.now(); let s = {};
  while (Date.now() - t0 < max) {
    s = await page.evaluate(() => {
      const w = document.querySelector('#akari-partner-web'); const wv = w && w.querySelector('webview');
      const host = wv && wv.parentElement; const r = wv && wv.getBoundingClientRect(); const h = host && host.getBoundingClientRect();
      const loadingText = w ? /読み込んでいます/.test(w.textContent || '') : null;
      const tabs = [...new Set([...document.querySelectorAll('.lm-TabBar-tab')].map(t => (t.textContent || '').trim()).filter(Boolean))].filter(t => /DeepSeek|CLI$/.test(t));
      return { tabs, webview: !!wv, src: wv ? (wv.getAttribute('src') || '').replace(/token=.*/, 'token=***') : '', partition: wv ? wv.getAttribute('partition') : '', rect: r && [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)].join(','), host: h && [Math.round(h.left), Math.round(h.top), Math.round(h.width), Math.round(h.height)].join(','), loadingText, notice: [...document.querySelectorAll('[data-akari-autostart-notice]')].map(e => e.textContent.trim()).join('/') };
    }).catch(e => ({ err: e.message.slice(0, 60) }));
    if (s.webview && s.loadingText === false) break;
    await sleep(2000);
  }
  console.log(Math.round((Date.now() - t0) / 1000) + 's', JSON.stringify(s));
  if (process.argv[3]) await page.screenshot({ path: path.join(process.env.AKARI_OUT, process.argv[3]) });
  browser.disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
