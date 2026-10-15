// AKARI チャットの L1 補助（プレビューのピン → チャットに添付）。
// AKARI_SHELL_DIR=<apps/shell> AKARI_CDP_PORT=<port> node preview-pin.cjs <コマンド> ...
// コマンド: open <プロジェクト内の相対パス> | pin [raw|output] [メモ] | send [raw|output]
// プレビューは Theia の webview（二重 iframe）なので、puppeteer の frame から review の道具を探して押す。
const path = require('path'); const { createRequire } = require('module');
const req = createRequire(path.join(process.env.AKARI_SHELL_DIR, '..', '..', 'node_modules', 'puppeteer', 'package.json'));
const puppeteer = req('puppeteer-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FIND = `(name, method) => { const d = window.theia.container._bindingDictionary; const k = [...d._map.keys()].find(c => typeof c === 'function' && c.prototype && method.every(m => typeof c.prototype[m] === 'function')); return window.theia.container.get(k); }`;
(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:' + (process.env.AKARI_CDP_PORT || '9391'), defaultViewport: null, protocolTimeout: 120000 });
  const page = (await browser.pages()).find(p => p.url().includes('lib/frontend/index.html'));
  const [cmd, a, b] = process.argv.slice(2);
  const previewFrame = async kind => {
    for (let i = 0; i < 60; i++) {
      for (const f of page.frames()) {
        const k = await f.evaluate(() => window.__akariPreview?.kind && document.querySelectorAll('[data-review-tool]').length >= 3 ? window.__akariPreview.kind : null).catch(() => null);
        if (k === kind) return f;
      }
      await sleep(500);
    }
    throw new Error('preview frame was not found');
  };
  if (cmd === 'open') {
    console.log(await page.evaluate(async (FIND, rel) => {
      const find = eval(FIND);
      const ws = find('WorkspaceService', ['tryGetRoots', 'containsSome']);
      const os = find('OpenerService', ['getOpener', 'getOpeners']);
      const uri = ws.tryGetRoots()[0].resource.resolve(rel);
      const opener = await os.getOpener(uri, {}); await opener.open(uri, {}); return opener.id;
    }, FIND, a));
  } else if (cmd === 'pin') {
    const f = await previewFrame(a || 'raw');
    await f.evaluate(() => { const s = document.getElementById('seek'); s.value = '2'; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); });
    await sleep(600);
    await (await f.$('[data-review-tool="pin"]')).click(); await sleep(300);
    const box = await (await f.$('#preview-stage')).boundingBox();
    await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.3); await sleep(800);
    await (await f.$('[data-review-memo]')).focus(); await page.keyboard.sendCharacter(b || '右上の色を暖かくして'); await sleep(200);
    await (await f.$('[data-review-add]')).click(); await sleep(800);
    console.log(await f.evaluate(() => document.querySelector('[data-review-attach-count]')?.textContent));
  } else if (cmd === 'send') {
    const f = await previewFrame(a || 'raw');
    await (await f.$('[data-review-attach-count]')).click(); await sleep(600);
    await (await f.$('[data-review-send]')).click(); await sleep(1000);
    console.log('sent');
  }
  browser.disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
