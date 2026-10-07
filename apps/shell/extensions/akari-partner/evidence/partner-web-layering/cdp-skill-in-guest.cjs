// 埋め込み（webview ゲスト）に入り、スキルを実行させて結果を待つ。
const path = require('path'); const { createRequire } = require('module');
const puppeteer = createRequire(path.join(process.env.AKARI_SHELL_DIR, 'package.json'))('puppeteer-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9381', defaultViewport: null, protocolTimeout: 60000 });
  const t = browser.targets().find(t => /^http:\/\/127\.0\.0\.1:\d+\//.test(t.url()));
  if (!t) throw new Error('guest target not found: ' + browser.targets().map(x => x.type() + ':' + x.url().slice(0, 40)).join(' | '));
  console.log('guest target type:', t.type());
  const p = await t.asPage();
  await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === 'Continue'); if (b) b.click(); }); await sleep(1200);
  const sel = '[contenteditable="true"], textarea';
  await p.waitForSelector(sel, { timeout: 20000 }); await p.click(sel);
  await p.keyboard.type('/', { delay: 30 }); await sleep(1500);
  const slash = await p.evaluate(() => document.body.innerText.split('\n').filter(l => /^(\/)?(edit-lint|analyze-footage|render-cut|verify|edit-plan)\b/.test(l.trim())).slice(0, 6));
  console.log('slash menu shows AKARI skills:', JSON.stringify(slash));
  await p.keyboard.press('Escape'); await sleep(300);
  for (let i = 0; i < 3; i++) await p.keyboard.press('Backspace');
  await p.keyboard.type('edit-lint スキルを読み込んで、このプロジェクトの edit.json を検査してください。最後の行に SKILL_USED=<スキル名> RESULT=<pass|fail|could-not-run> と書いてください。', { delay: 5 });
  await sleep(300); await p.keyboard.press('Enter');
  let txt = ''; const t0 = Date.now();
  while (Date.now() - t0 < 270000) { await sleep(4000); txt = await p.evaluate(() => document.body.innerText); const after = txt.split('と書いてください。').pop() || ''; if (/SKILL_USED=[A-Za-z-]+s+RESULT=(pass|fail|could-not-run)/.test(after)) break; if (/Waiting for approval/.test(after)) break; }
  const tail = (txt.split('書いてください。').pop() || '').replace(/\n{2,}/g, '\n').slice(-600);
  console.log('ELAPSED', Math.round((Date.now() - t0) / 1000) + 's'); console.log('RESULT_TAIL', JSON.stringify(tail));
  const main = (await browser.pages()).find(x => x.url().includes('lib/frontend/index.html')); if (main) await main.screenshot({ path: path.join(process.env.AKARI_OUT, '43-skill-in-embedded.png') });
  browser.disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
