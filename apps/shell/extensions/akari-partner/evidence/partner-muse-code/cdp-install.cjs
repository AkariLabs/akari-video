// L1-2: 未導入の状態から「Muse Code CLI」の「始める」→ 同意 → 公式スクリプトで導入 → PTY タブで muse が起動するまで。
// 使い方: PARTNER_CDP_PORT=<port> PARTNER_EVIDENCE_OUT=<出力先> node cdp-install.cjs
const path = require('path');
const fs = require('fs');
const { createRequire } = require('module');
const shellRequire = createRequire(path.resolve(__dirname, '../../../../package.json'));
const puppeteer = shellRequire('puppeteer-core');
const PORT = process.env.PARTNER_CDP_PORT || '9461';
const OUT = process.env.PARTNER_EVIDENCE_OUT || path.join(require('os').tmpdir(), 'partner-muse-code-out');
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = [];
const note = (...a) => { const line = `${new Date().toISOString()} ${a.join(' ')}`; log.push(line); console.log(line); };
const save = () => fs.writeFileSync(path.join(OUT, '10-flow-log.txt'), log.join('\n') + '\n');

(async () => {
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null });
  const pages = await browser.pages();
  const page = pages.find(p => p.url().includes('lib/frontend/index.html')) || pages[0];
  await page.screenshot({ path: path.join(OUT, '10-kick.png') });

  // 右の「パートナー」を開く。
  const opened = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.lm-TabBar.theia-app-sides .lm-TabBar-tab')];
    const tab = tabs.find(t => (t.getAttribute('title') || t.textContent || '').trim() === 'パートナー' && t.offsetWidth > 0);
    if (!tab) return 'tab missing';
    if (!tab.className.includes('lm-mod-current')) tab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    return 'opened';
  });
  note('partner panel', opened);
  await sleep(2500);
  await page.screenshot({ path: path.join(OUT, '11-partner-panel.png') });
  const row = await page.evaluate(() => {
    const e = document.querySelector('[data-partner-entry="meta/muse-code-cli"]');
    if (!e) return null;
    e.scrollIntoView({ block: 'center' });
    const icon = e.querySelector('.akari-partner-muse-cli-icon') || document.querySelector('.akari-partner-muse-cli-icon');
    const style = icon ? getComputedStyle(icon) : null;
    return { text: (e.textContent || '').trim(), visible: e.offsetWidth > 0,
      icon: icon ? { w: icon.offsetWidth, h: icon.offsetHeight, bg: style.backgroundColor } : null };
  });
  note('muse row', JSON.stringify(row));
  await sleep(800);
  await page.screenshot({ path: path.join(OUT, '12-muse-row.png') });
  if (!row) { save(); process.exit(2); }

  note('press', await page.evaluate(() => {
    const e = document.querySelector('[data-partner-entry="meta/muse-code-cli"]');
    e.click();
    return `clicked: ${(e.textContent || '').trim()}`;
  }));

  let dialogText = '';
  for (let i = 0; i < 60; i++) {
    dialogText = await page.evaluate(() => {
      const d = document.querySelector('.dialogBlock, .theia-dialog, .dialogOverlay');
      return d ? (d.textContent || '').trim() : '';
    });
    if (dialogText.includes('導入しますか')) break;
    await sleep(1000);
  }
  note('dialog', dialogText.slice(0, 700));
  await page.screenshot({ path: path.join(OUT, '13-consent-dialog.png') });
  note('dialog links', JSON.stringify(await page.evaluate(() =>
    [...document.querySelectorAll('.dialogOverlay a, .theia-dialog a')].map(a => a.getAttribute('href')))));
  note('consent', await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === '導入する');
    if (!btn) return 'no accept button';
    btn.click();
    return 'accepted';
  }));

  let lastStatus = '';
  const started = Date.now();
  let shotProgress = false;
  while (Date.now() - started < 600000) {
    const snap = await page.evaluate(() => {
      const status = [...document.querySelectorAll('[data-akari-flow-state]')].map(e => `${e.getAttribute('data-akari-flow-state')}: ${(e.textContent || '').trim().slice(0, 300)}`).join(' | ');
      const rows = [...document.querySelectorAll('.xterm-rows > div')].map(r => r.textContent || '').filter(t => t.trim()).join('\n');
      return { status, rows };
    });
    if (snap.status !== lastStatus) { note('flow', snap.status); lastStatus = snap.status; }
    if (!shotProgress && /working/.test(snap.status)) { await page.screenshot({ path: path.join(OUT, '14-progress.png') }); shotProgress = true; }
    if (snap.rows.trim().length > 40) { note('terminal has content'); break; }
    if (/failed|error/.test(snap.status)) { note('flow failed'); break; }
    await sleep(2000);
    save();
  }
  await sleep(6000);
  const terminalText = await page.evaluate(() => [...document.querySelectorAll('.xterm-rows > div')].map(r => r.textContent || '').filter(t => t.trim()).join('\n'));
  const tabs = await page.evaluate(() => [...document.querySelectorAll('.lm-TabBar-tab')].map(t => ({ text: (t.textContent || '').trim(), title: t.getAttribute('title') || '', icon: t.querySelector('.lm-TabBar-tabIcon') ? t.querySelector('.lm-TabBar-tabIcon').className : '' })).filter(t => /muse/i.test(t.text + t.icon + t.title)));
  note('tabs', JSON.stringify(tabs));
  await page.screenshot({ path: path.join(OUT, '15-pty-muse.png') });
  fs.writeFileSync(path.join(OUT, '15-terminal.txt'), terminalText);
  save();
  console.log('---- terminal ----\n' + terminalText.slice(0, 3000));
  browser.disconnect();
})().catch(e => { console.error(e); log.push(String(e)); save(); process.exit(1); });
