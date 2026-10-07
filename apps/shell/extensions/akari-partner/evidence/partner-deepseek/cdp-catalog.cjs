// L1-1: open the partner panel + catalog in the dev shell and capture a screenshot + DOM facts.
const path = require('path');
const fs = require('fs');
const { createRequire } = require('module');
const shellRequire = createRequire(path.resolve(__dirname, '../../../../package.json'));
const puppeteer = shellRequire('puppeteer-core');
const OUT = process.env.PARTNER_EVIDENCE_OUT || path.join(require('os').tmpdir(), 'partner-deepseek-out');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9377', defaultViewport: null });
  const pages = await browser.pages();
  const page = pages.find(p => p.url().includes('lib/frontend/index.html')) || pages[0];
  await page.screenshot({ path: path.join(OUT, '00-kick.png') });
  try { await page.evaluate(() => window.electronTheiaCore && window.electronTheiaCore.maximize && window.electronTheiaCore.maximize()); } catch {}
  await new Promise(r => setTimeout(r, 1500));

  // Open the right panel "パートナーを追加" and the left catalog via the side tab bars.
  const clickTab = async (label) => page.evaluate((label) => {
    const tabs = [...document.querySelectorAll('.lm-TabBar.theia-app-sides .lm-TabBar-tab')];
    const tab = tabs.find(t => (t.getAttribute('title') || t.textContent || '').includes(label));
    if (!tab) return { ok: false, tabs: tabs.map(t => t.getAttribute('title') || t.textContent) };
    const cls = tab.className;
    if (!cls.includes('lm-mod-current')) tab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    return { ok: true, cls };
  }, label);
  console.log('right tab', JSON.stringify(await clickTab('パートナーを追加')));
  await new Promise(r => setTimeout(r, 1500));
  const r1 = await clickTab('パートナー / 拡張');
  console.log('left tab (パートナー / 拡張)', JSON.stringify(r1));
  if (!r1.ok) {
    // fall back: ask Theia to open the catalog view container through the command registry
    const res = await page.evaluate(async () => {
      try {
        const map = window.theia && window.theia.container && window.theia.container._bindingDictionary._map;
        let registry;
        for (const [, bindings] of map) for (const b of bindings) { const c = b.cache; if (c && c._commands && c._handlers) { registry = c; break; } }
        if (!registry) return 'no registry';
        const ids = [...registry._commands.keys()].filter(id => /vsx|partner|catalog|extension/i.test(id));
        return ids.slice(0, 40);
      } catch (e) { return String(e); }
    });
    console.log('commands', JSON.stringify(res));
  }
  await new Promise(r => setTimeout(r, 2500));
  await page.screenshot({ path: path.join(OUT, '01-partner-panel-and-catalog.png') });

  const facts = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-partner-entry]')].map(e => ({
      entry: e.getAttribute('data-partner-entry'), form: e.getAttribute('data-partner-form'),
      action: e.getAttribute('data-partner-action'), text: (e.textContent || '').trim().slice(0, 80)
    }));
    const cards = [...document.querySelectorAll('[data-partner-agent]')].map(e => ({
      agent: e.getAttribute('data-partner-agent'), text: (e.textContent || '').trim().slice(0, 80)
    }));
    const icon = document.querySelector('.akari-partner-deepseek-cli-icon');
    const iconStyle = icon ? getComputedStyle(icon) : null;
    return {
      rows, cards,
      deepseekIcon: icon ? { maskImage: (iconStyle.maskImage || iconStyle.webkitMaskImage || '').slice(0, 60), bg: iconStyle.backgroundColor, w: icon.offsetWidth, h: icon.offsetHeight } : null
    };
  });
  fs.writeFileSync(path.join(OUT, '01-dom-facts.json'), JSON.stringify(facts, null, 2));
  console.log(JSON.stringify(facts, null, 2));
  browser.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
