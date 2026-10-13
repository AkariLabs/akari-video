// L1-1: パートナーの一覧を開き、Muse Code の行とアイコンの見え方を記録する。
// 使い方: PARTNER_CDP_PORT=<port> PARTNER_EVIDENCE_OUT=<出力先> node cdp-catalog.cjs
const path = require('path');
const fs = require('fs');
const { createRequire } = require('module');
const shellRequire = createRequire(path.resolve(__dirname, '../../../../package.json'));
const puppeteer = shellRequire('puppeteer-core');
const PORT = process.env.PARTNER_CDP_PORT || '9461';
const OUT = process.env.PARTNER_EVIDENCE_OUT || path.join(require('os').tmpdir(), 'partner-muse-code-out');
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null });
  const pages = await browser.pages();
  const page = pages.find(p => p.url().includes('lib/frontend/index.html')) || pages[0];
  await page.screenshot({ path: path.join(OUT, '00-kick.png') });
  await sleep(1500);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => ['開くだけ'].includes((b.textContent || '').trim()));
    if (btn) btn.click();
  });
  const facts = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-partner-entry]')].map(e => ({
      entry: e.getAttribute('data-partner-entry'), form: e.getAttribute('data-partner-form'),
      action: e.getAttribute('data-partner-action'), text: (e.textContent || '').trim().slice(0, 80), visible: e.offsetWidth > 0
    }));
    const icon = document.querySelector('.akari-partner-muse-cli-icon');
    const style = icon ? getComputedStyle(icon) : null;
    const sideTabs = [...document.querySelectorAll('.lm-TabBar.theia-app-sides .lm-TabBar-tab')].map(t => t.getAttribute('title') || t.textContent);
    return {
      rows, sideTabs,
      museIcon: icon ? { mask: (style.maskImage || style.webkitMaskImage || '').slice(0, 40), bg: style.backgroundColor, w: icon.offsetWidth, h: icon.offsetHeight } : null
    };
  });
  fs.writeFileSync(path.join(OUT, '01-dom-facts.json'), JSON.stringify(facts, null, 2));
  console.log(JSON.stringify(facts, null, 2));
  await page.screenshot({ path: path.join(OUT, '01-partner-list.png') });
  browser.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
