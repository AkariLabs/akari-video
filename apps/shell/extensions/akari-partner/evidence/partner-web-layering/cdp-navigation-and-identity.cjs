// 差し戻し r1 の L1: ゲスト内の再読み込み / attach 後の行き先変更 / タブ切替・最大化で作り直されない / コンテキストメニューの重なり順
const path = require('path'); const { createRequire } = require('module');
const puppeteer = createRequire(path.join(process.env.AKARI_SHELL_DIR, 'package.json'))('puppeteer-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9381', defaultViewport: null, protocolTimeout: 60000 });
  const main = (await browser.pages()).find(p => p.url().includes('lib/frontend/index.html'));
  const guestTarget = () => browser.targets().find(t => t.type() === 'webview' && /^http:\/\/127\.0\.0\.1:\d+\//.test(t.url()));
  const wvId = () => main.evaluate(() => { const w = document.querySelector('#akari-partner-web webview'); if (!w) return 'no-webview'; try { return w.getWebContentsId(); } catch (e) { return 'no-guest'; } });
  const shell = await main.evaluateHandle(() => { for (const [, bs] of window.theia.container._bindingDictionary._map) for (const b of bs) { const c = b.cache; if (c && c.constructor && c.constructor.name === 'ApplicationShell') return c; } return null; });
  const id0 = await wvId(); console.log('guest id at start:', id0);
  // 1) ゲスト内の location.reload()
  const g = await guestTarget().asPage();
  await g.evaluate(() => { window.__akariMark = 'before-reload'; });
  await g.evaluate(() => { location.reload(); }).catch(() => {}); await sleep(6000);
  const g2 = await guestTarget().asPage();
  console.log('in-guest reload: mark after =', await g2.evaluate(() => String(window.__akariMark)), '| title =', await g2.evaluate(() => document.title), '| guest id =', await wvId());
  // 2) タブ切替・最大化の前後で作り直されない
  await main.evaluate(async s => { await s.activateWidget('akari-partner-onboarding'); }, shell); await sleep(1200);
  const hiddenId = await wvId();
  await main.evaluate(async s => { await s.activateWidget('akari-partner-web'); }, shell); await sleep(1200);
  await main.evaluate(() => window.electronTheiaCore && window.electronTheiaCore.maximize && window.electronTheiaCore.maximize()); await sleep(1500);
  const r = await main.evaluate(() => { const w = document.querySelector('#akari-partner-web webview'); const a = w.getBoundingClientRect(), b = w.parentElement.getBoundingClientRect(); return [Math.round(a.left), Math.round(a.width), Math.round(b.left), Math.round(b.width)].join(','); });
  console.log('tab switch / maximize: id hidden =', hiddenId, '| id after =', await wvId(), '| same as start:', (await wvId()) === id0, '| rect(webview x,w / host x,w) =', r);
  // 3) コンテキストメニューの重なり順（右パネルのタブを右クリック）
  const tab = await main.evaluate(() => { const t = [...document.querySelectorAll('.lm-TabBar-tab')].find(t => /DeepSeek/.test(t.textContent || '')); const b = t.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  await main.mouse.click(tab.x, tab.y, { button: 'right' }); await sleep(1200);
  const menu = await main.evaluate(() => { const m = document.querySelector('.lm-Menu, .p-Menu'); if (!m) return null; const b = m.getBoundingClientRect(); const wv = document.querySelector('#akari-partner-web webview').getBoundingClientRect(); const cx = Math.min(b.right - 5, Math.max(b.left + 5, wv.left + 20)), cy = Math.min(b.bottom - 5, Math.max(b.top + 5, wv.top + 20)); const e = document.elementFromPoint(cx, cy); return { menu: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)].join(','), overlapsWebview: b.right > wv.left && b.bottom > wv.top, topIsMenu: !!(e && e.closest('.lm-Menu, .p-Menu')) }; });
  console.log('context menu:', JSON.stringify(menu)); await main.screenshot({ path: path.join(process.env.AKARI_OUT, '44-layer-contextmenu.png') });
  await main.keyboard.press('Escape'); await sleep(600);
  // 4) attach 後の行き先変更（番人を通らない経路）→ ゲストが閉じる
  const before = await wvId();
  await main.evaluate(() => { const w = document.querySelector('#akari-partner-web webview'); return w.loadURL('https://example.com/').then(() => 'loaded', e => 'rejected: ' + String(e).slice(0, 80)); }).then(v => console.log('webview.loadURL(https://example.com) ->', v), e => console.log('loadURL threw', e.message.slice(0, 80)));
  await sleep(3000);
  const targetsNow = browser.targets().filter(t => t.type() === 'webview').map(t => t.url().replace(/token=.*/, 'token=***').slice(0, 60));
  console.log('after off-origin load: guest id =', await wvId(), '(before', before + ') | webview targets =', JSON.stringify(targetsNow));
  browser.disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
