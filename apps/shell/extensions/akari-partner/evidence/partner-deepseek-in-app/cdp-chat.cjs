// L1 続き: 埋め込み target に入り、ワークスペース一覧とチャット 1 往復を確かめる。
const path = require('path'); const fs = require('fs'); const { createRequire } = require('module');
const SHELL = process.env.AKARI_SHELL_DIR; const OUT = process.env.AKARI_OUT; const PORT = process.env.AKARI_CDP_PORT || '9378';
const puppeteer = createRequire(path.join(SHELL, 'package.json'))('puppeteer-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = []; const note = (...a) => { const l = a.join(' '); log.push(l); console.log(l); };
(async () => {
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null });
  let target; for (let i = 0; i < 30 && !target; i++) { target = browser.targets().find(t => /^http:\/\/127\.0\.0\.1:\d+\//.test(t.url()) && !/lib\/frontend/.test(t.url())); if (!target) await sleep(1000); }
  if (!target) throw new Error('embedded target not found');
  const p = await target.page(); if (!p) throw new Error('no page for target type ' + target.type());
  await sleep(4000);
  const mode = process.argv[2] || 'explore';
  const snap = await p.evaluate(() => ({
    title: document.title,
    text: document.body.innerText.replace(/\n{2,}/g, '\n').slice(0, 900),
    inputs: [...document.querySelectorAll('textarea, [contenteditable="true"], input[type="text"]')].map(e => `${e.tagName}|${e.getAttribute('placeholder') || e.getAttribute('aria-label') || ''}|${e.className.toString().slice(0, 40)}`),
    buttons: [...document.querySelectorAll('button')].map(b => (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 30)).filter(Boolean).slice(0, 40)
  }));
  note('SNAP', JSON.stringify(snap));
  if (mode === 'chat') {
    await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === 'Continue'); if (b) b.click(); }); await sleep(1200);
    const sel = 'textarea, [contenteditable="true"]';
    await p.waitForSelector(sel, { timeout: 20000 });
    await p.click(sel); await p.keyboard.type('Reply with exactly: AKARI-OK', { delay: 10 }); await sleep(300); await p.keyboard.press('Enter');
    let ok = false; let last = '';
    for (let i = 0; i < 60; i++) { await sleep(2000); last = await p.evaluate(() => document.body.innerText); if ((last.match(/AKARI-OK/g) || []).length >= 2) { ok = true; break; } if (/Failed|failed|no API key|MissingSessionID/.test(last)) break; }
    note('CHAT', ok ? 'round trip ok' : 'NOT ok');
    note('TAIL', JSON.stringify(last.replace(/\n{2,}/g, '\n').slice(-700)));
  }
  const page = (await browser.pages()).find(x => x.url().includes('lib/frontend/index.html'));
  await page.screenshot({ path: path.join(OUT, mode === 'chat' ? '04-chat.png' : '03b-embedded.png') });
  fs.appendFileSync(path.join(OUT, 'flow-log.txt'), log.join('\n') + '\n'); browser.disconnect();
})().catch(e => { console.error('ERR', e && e.message); process.exit(1); });
