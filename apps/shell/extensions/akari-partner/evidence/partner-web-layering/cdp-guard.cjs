const path = require('path'); const { createRequire } = require('module');
const puppeteer = createRequire(path.join(process.env.AKARI_SHELL_DIR, 'package.json'))('puppeteer-core');
(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9381', defaultViewport: null, protocolTimeout: 40000, targetFilter: t => t.url().includes('lib/frontend') || t.type() === 'browser' });
  const page = (await browser.pages()).find(p => p.url().includes('lib/frontend/index.html'));
  const tryAttach = (src, partition) => page.evaluate((src, partition) => new Promise(res => {
    const w = document.createElement('webview'); if (partition) w.setAttribute('partition', partition); w.setAttribute('src', src);
    w.style.cssText = 'position:fixed;left:0;top:0;width:200px;height:120px;z-index:99999';
    let done = false; const fin = v => { if (!done) { done = true; w.remove(); res(v); } };
    w.addEventListener('did-attach', () => fin('ATTACHED')); w.addEventListener('did-start-loading', () => fin('LOADING'));
    document.body.appendChild(w); setTimeout(() => { let id = 'none'; try { id = String(w.getWebContentsId()); } catch (e) { id = 'no-guest'; } fin('blocked (' + id + ')'); }, 3500);
  }), src, partition);
  console.log('https://example.com (no partition)        ->', await tryAttach('https://example.com/', ''));
  console.log('https://example.com (deepseek partition)  ->', await tryAttach('https://example.com/', 'persist:akari-partner-deepseek'));
  console.log('http://127.0.0.1:9 (wrong partition)      ->', await tryAttach('http://127.0.0.1:9/', 'persist:other'));
  console.log('http://localhost:9 (deepseek partition)   ->', await tryAttach('http://localhost:9/', 'persist:akari-partner-deepseek'));
  browser.disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
