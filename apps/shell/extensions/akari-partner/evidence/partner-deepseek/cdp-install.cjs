// L1-2: from a not-installed state, press setup on "DeepSeek Harness CLI" -> consent -> npm install -> PTY `dsh web`.
const path = require('path');
const fs = require('fs');
const { createRequire } = require('module');
const shellRequire = createRequire(path.resolve(__dirname, '../../../../package.json'));
const puppeteer = shellRequire('puppeteer-core');
const OUT = process.env.PARTNER_EVIDENCE_OUT || path.join(require('os').tmpdir(), 'partner-deepseek-out');
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = [];
const note = (...a) => { const line = `${new Date().toISOString()} ${a.join(' ')}`; log.push(line); console.log(line); };

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9377', defaultViewport: null });
  const pages = await browser.pages();
  const page = pages.find(p => p.url().includes('lib/frontend/index.html')) || pages[0];
  await page.screenshot({ path: path.join(OUT, '10-kick.png') });

  // Helper: find a Theia service instance by constructor name through the inversify container cache.
  const getService = async (name) => page.evaluateHandle((name) => {
    const map = window.theia.container._bindingDictionary._map;
    for (const [, bindings] of map) for (const b of bindings) {
      const c = b.cache; if (c && c.constructor && c.constructor.name === name) return c;
    }
    return null;
  }, name);

  // Dismiss the "use this folder as a project?" notification if present.
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === '開くだけ');
    if (btn) btn.click();
  });

  // Left catalog: activate the catalog widget through ApplicationShell.
  const shell = await getService('ApplicationShell');
  const catalogState = await page.evaluate((shell) => {
    if (!shell) return 'no shell';
    const w = shell.getWidgets('left').map(w => ({ id: w.id, label: w.title.label, hidden: w.isHidden }));
    try { shell.activateWidget('vsx-extensions-view-container'); } catch (e) { return { w, err: String(e) }; }
    return { w };
  }, shell);
  note('left widgets', JSON.stringify(catalogState));
  await sleep(2000);
  await page.screenshot({ path: path.join(OUT, '11-left-catalog.png') });
  const cards = await page.evaluate(() => [...document.querySelectorAll('[data-partner-agent]')].map(e => ({
    agent: e.getAttribute('data-partner-agent'), text: (e.textContent || '').trim().slice(0, 120), visible: e.offsetWidth > 0
  })));
  note('catalog cards', JSON.stringify(cards));

  // Press setup on the DeepSeek row.
  const pressed = await page.evaluate(() => {
    const row = document.querySelector('[data-partner-entry="deepseek/dsh-cli"]');
    if (!row) return 'row missing';
    row.click();
    return `clicked: ${(row.textContent || '').trim()}`;
  });
  note('press', pressed);

  // Wait for the consent dialog.
  let dialogText = '';
  for (let i = 0; i < 60; i++) {
    dialogText = await page.evaluate(() => {
      const d = document.querySelector('.dialogBlock, .theia-dialog, .dialogOverlay');
      return d ? (d.textContent || '').trim() : '';
    });
    if (dialogText.includes('導入しますか')) break;
    await sleep(1000);
  }
  note('dialog', dialogText.slice(0, 600));
  await page.screenshot({ path: path.join(OUT, '12-consent-dialog.png') });
  const links = await page.evaluate(() => [...document.querySelectorAll('.dialogOverlay a, .theia-dialog a')].map(a => a.getAttribute('href')));
  note('dialog links', JSON.stringify(links));
  const accepted = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === '導入する');
    if (!btn) return 'no accept button';
    btn.click();
    return 'accepted';
  });
  note('consent', accepted);

  // Poll the flow state and terminal content.
  let lastStatus = '';
  let terminalText = '';
  const started = Date.now();
  let shotProgress = false;
  while (Date.now() - started < 420000) {
    const snap = await page.evaluate(() => {
      const status = [...document.querySelectorAll('[data-akari-flow-state]')].map(e => `${e.getAttribute('data-akari-flow-state')}: ${(e.textContent || '').trim().slice(0, 300)}`).join(' | ');
      const rows = [...document.querySelectorAll('.xterm-rows > div')].map(r => r.textContent || '').filter(t => t.trim()).join('\n');
      const tabs = [...document.querySelectorAll('.lm-TabBar-tab')].map(t => (t.textContent || '').trim()).filter(Boolean);
      return { status, rows, tabs };
    });
    if (snap.status !== lastStatus) { note('flow', snap.status); lastStatus = snap.status; }
    if (snap.rows) terminalText = snap.rows;
    if (!shotProgress && /working/.test(snap.status)) { await page.screenshot({ path: path.join(OUT, '13-progress.png') }); shotProgress = true; }
    if (/3080/.test(snap.rows)) { note('terminal shows 3080'); break; }
    if (/failed|error/.test(snap.status)) { note('flow failed'); break; }
    await sleep(2000);
  }
  await sleep(3000);
  terminalText = await page.evaluate(() => [...document.querySelectorAll('.xterm-rows > div')].map(r => r.textContent || '').filter(t => t.trim()).join('\n'));
  const tabs = await page.evaluate(() => [...document.querySelectorAll('.lm-TabBar-tab')].map(t => ({ text: (t.textContent || '').trim(), icon: t.querySelector('.lm-TabBar-tabIcon') ? t.querySelector('.lm-TabBar-tabIcon').className : '' })).filter(t => t.text));
  note('tabs', JSON.stringify(tabs));
  await page.screenshot({ path: path.join(OUT, '14-pty-dsh-web.png') });
  fs.writeFileSync(path.join(OUT, '14-terminal.txt'), terminalText);
  fs.writeFileSync(path.join(OUT, '10-flow-log.txt'), log.join('\n') + '\n');
  console.log('---- terminal ----\n' + terminalText.slice(0, 3000));
  browser.disconnect();
})().catch(e => { console.error(e); fs.writeFileSync(path.join(OUT, '10-flow-log.txt'), log.join('\n') + '\n' + String(e) + '\n'); process.exit(1); });
