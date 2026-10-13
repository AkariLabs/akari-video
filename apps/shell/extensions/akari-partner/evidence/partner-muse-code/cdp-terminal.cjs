// 使い方: PARTNER_CDP_PORT=<port> node cdp-terminal.cjs [<送る文字列>] — 右パネルの端末の中身（xterm のバッファ）を読む。文字列があれば先に送る。
const path = require('path');
const { createRequire } = require('module');
const puppeteer = createRequire(path.resolve(__dirname, '../../../../package.json'))('puppeteer-core');
(async () => {
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${process.env.PARTNER_CDP_PORT || '9461'}`, defaultViewport: null });
  const pages = await browser.pages();
  const page = pages.find(p => p.url().includes('lib/frontend/index.html')) || pages[0];
  const result = await page.evaluate(async (send) => {
    const map = window.theia.container._bindingDictionary._map;
    // production ビルドは class 名が潰れるので、端末の一覧を持つサービスを形で探す。
    let terminals = [];
    for (const [, bindings] of map) for (const b of bindings) {
      const c = b.cache;
      if (c && typeof c.newTerminal === 'function' && Array.isArray(c.all)) terminals = c.all.filter(w => w.term && w.term.buffer);
    }
    if (send && terminals[0]) { await terminals[0].sendText(send); await new Promise(r => setTimeout(r, 2500)); }
    return terminals.map(w => {
      const buffer = w.term.buffer.active; const lines = [];
      for (let i = 0; i < buffer.length; i++) { const line = buffer.getLine(i); if (line) lines.push(line.translateToString(true)); }
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      return { id: w.id, title: w.title.label, caption: w.title.caption, icon: w.title.iconClass, cols: w.term.cols, rows: w.term.rows, text: lines.join('\n') };
    });
  }, process.argv[2] || '');
  console.log(JSON.stringify(result, null, 1).replace(/\n/g, '\n'));
  browser.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
