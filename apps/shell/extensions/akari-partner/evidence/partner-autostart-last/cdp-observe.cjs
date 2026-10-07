// 何も押さずに、起動後の自動起動の結果を観察する。main renderer だけに接続。
const path = require('path'); const { createRequire } = require('module');
const puppeteer = createRequire(path.join(process.env.AKARI_SHELL_DIR, 'package.json'))('puppeteer-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:' + (process.env.AKARI_CDP_PORT || '9381'), defaultViewport: null, protocolTimeout: 40000, targetFilter: t => t.url().includes('lib/frontend') || t.type() === 'browser' });
  let page; for (let i = 0; i < 60; i++) { page = (await browser.pages()).find(p => p.url().includes('lib/frontend/index.html')); if (page && await page.evaluate(() => !!(window.theia && window.theia.container && document.querySelector('.lm-TabBar-tab'))).catch(() => false)) break; await sleep(1000); }
  const max = Number(process.argv[2] || 45) * 1000; const want = process.argv[3] || ''; const t0 = Date.now(); let s = {};
  while (Date.now() - t0 < max) {
    s = await page.evaluate(async () => {
      let view = 'none'; try { const i = await window.electronAkariPartner.web.inspect(); view = i.viewBounds.width + 'x' + i.viewBounds.height; } catch {}
      const tabs = [...new Set([...document.querySelectorAll('.lm-TabBar-tab')].map(t => (t.textContent || '').trim()).filter(Boolean))];
      const partnerTabs = tabs.filter(t => /DeepSeek|CLI$|Claude|Codex/.test(t));
      const dialog = !!document.querySelector('.dialogOverlay, .theia-dialog, .dialogBlock');
      const notice = [...document.querySelectorAll('[data-akari-autostart-notice]')].map(e => (e.textContent || '').trim()).join(' / ');
      const ae = document.activeElement; const focusIn = ae ? (ae.closest('#akari-partner-web') ? 'partner-web' : ae.closest('.terminal-container, .xterm') ? 'terminal' : ae.closest('#theia-right-content-panel') ? 'right-panel' : ae.tagName.toLowerCase()) : 'none';
      let last; try { for (const [, bs] of window.theia.container._bindingDictionary._map) for (const b of bs) { const c = b.cache; if (c && c.constructor && c.constructor.name === 'AkariPartnerWidget') last = await c.storageService.getData('akari.partner.last'); } } catch {}
      return { partnerTabs, view, dialog, notice, focusIn, last: last === undefined ? 'undefined' : JSON.stringify(last).slice(0, 60) };
    }).catch(e => ({ err: e.message.slice(0, 50) }));
    if (want && (s.partnerTabs || []).some(t => t.includes(want))) break;
    await sleep(2000);
  }
  console.log(Math.round((Date.now() - t0) / 1000) + 's', JSON.stringify(s)); browser.disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
