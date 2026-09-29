// l1-run.mjs <tag> <port> <outDir> — 隔離環境で A → B の順に 2 窓を開き、A の窓で edit.json の出力プレビューを開く。
// 1 つの backend に 2 窓がぶら下がる（singleInstance の second-instance 経路）。自分が spawn した PID だけを片付ける。
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const tag = process.argv[2] ?? 'before';
const port = Number(process.argv[3] ?? 9431);
const outDir = process.argv[4];
const wt = process.env.AKARI_WT; // worktree root (forward slashes)
const shell = `${wt}/apps/shell`;
const electron = `${wt}/node_modules/electron/dist/electron.exe`;
const base = `C:/t/pwr/${tag}`;
const require = createRequire(`${wt}/package.json`);
const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
mkdirSync(outDir, { recursive: true });

const env = { ...process.env, THEIA_CONFIG_DIR: `${base}/theia-config`, AKARI_HOME: `${base}/akari-home` };
delete env.ELECTRON_RUN_AS_NODE;
const log = [];
const note = (o) => { const e = { t: new Date().toISOString(), ...o }; log.push(e); console.log(JSON.stringify(e)); };
const commonArgs = [`--user-data-dir=${base}/userdata`, '--no-sandbox'];
const spawned = [];
function launch(ws, extra = []) {
  const child = spawn(electron, [shell, ws, ...commonArgs, ...extra], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false });
  const lines = [];
  child.stdout.on('data', d => lines.push(String(d)));
  child.stderr.on('data', d => lines.push(String(d)));
  spawned.push({ child, lines, ws });
  return child;
}

const STATE = `(() => {
  const n = [...document.querySelectorAll('.theia-notification-list-item, .theia-notification-message')].map(e => e.innerText.trim()).filter(Boolean);
  return { title: document.title, hash: location.hash, preloadGone: !document.querySelector('.theia-preload'),
    notifications: [...new Set(n)].slice(0, 20),
    hasOutsideText: document.body.innerText.includes('outside the workspace'),
    hasCannotOpen: document.body.innerText.includes('動画プレビューを開けませんでした') };
})()`;
const PREVIEW = `(() => {
  const stage = document.getElementById('preview-stage');
  const video = document.getElementById('preview-video');
  if (!stage && !video) return null;
  return { stage: !!stage, frameEngineReady: stage ? stage.dataset.frameEngineReady ?? null : null,
    canvas: !!document.querySelector('#preview-stage canvas'),
    video: video ? { readyState: video.readyState, src: (video.currentSrc || '').replace(/^.*\\//, '') } : null,
    bodyError: document.body.innerText.includes('outside the workspace') };
})()`;

async function pagesByWs(browser) {
  const out = {};
  for (const ctx of browser.contexts()) for (const p of ctx.pages()) {
    const url = p.url();
    if (!/index\.html/.test(url)) continue;
    let st; try { st = await p.evaluate(STATE); } catch { continue; }
    const key = /ws-a/.test(st.hash + st.title) ? 'a' : /ws-b/.test(st.hash + st.title) ? 'b' : 'other';
    out[key] = { page: p, st };
  }
  return out;
}

let browser;
// ステータスバー（左端に OS ユーザー名が出る）を除いて撮る
async function shot(page, name) {
  const vp = await page.evaluate('({ w: innerWidth, h: innerHeight })');
  await page.screenshot({ path: join(outDir, name), clip: { x: 0, y: 0, width: vp.w, height: vp.h - 26 } });
}
try {
  launch(`${base}/ws-a`, [`--remote-debugging-port=${port}`]);
  let t0 = Date.now();
  while (Date.now() - t0 < 180000) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); break; } catch { await sleep(1000); }
  }
  if (!browser) throw new Error('CDP connect timeout');
  let pages;
  t0 = Date.now();
  while (Date.now() - t0 < 180000) { pages = await pagesByWs(browser); if (pages.a?.st.preloadGone) break; await sleep(1000); }
  note({ step: 'window-a-ready', ok: !!pages.a?.st.preloadGone, title: pages.a?.st.title });
  await sleep(4000);
  launch(`${base}/ws-b`, [`--remote-debugging-port=${port + 1}`]);
  t0 = Date.now();
  while (Date.now() - t0 < 180000) { pages = await pagesByWs(browser); if (pages.b?.st.preloadGone) break; await sleep(1000); }
  note({ step: 'window-b-ready', ok: !!pages.b?.st.preloadGone, title: pages.b?.st.title });
  await sleep(5000);
  const recentPath = `${base}/theia-config/recentworkspace.json`;
  const recent = existsSync(recentPath) ? JSON.parse(readFileSync(recentPath, 'utf8')) : null;
  note({ step: 'recent-workspaces', recent: recent && (recent.recentRoots ?? recent).map?.(r => String(r).replace(/^.*\/pwr\//, '<pwr>/')) });
  const a = pages.a.page;
  await a.bringToFront();
  await shot(a, `${tag}-00-two-windows-a.png`);
  await shot(pages.b.page, `${tag}-00-two-windows-b.png`);
  let attempt = 0; let st = null; let preview = null;
  for (attempt = 1; attempt <= 3; attempt++) {
    await a.keyboard.press('Escape').catch(() => {});
    await a.keyboard.press('Control+P');
    await sleep(1200);
    await a.keyboard.type('edit.json');
    await sleep(1500);
    await a.keyboard.press('Enter');
    note({ step: 'open-edit-json-in-a', attempt });
    t0 = Date.now();
    const before = (await a.evaluate(STATE)).notifications.length;
    while (Date.now() - t0 < 60000) {
      st = await a.evaluate(STATE);
      preview = null;
      for (const f of a.frames()) { try { const s2 = await f.evaluate(PREVIEW); if (s2) { preview = s2; break; } } catch {} }
      if (st.notifications.length > before && (st.hasOutsideText || st.hasCannotOpen)) break;
      if (preview && (preview.frameEngineReady === 'true' || preview.canvas || (preview.video && preview.video.readyState >= 2))) break;
      await sleep(1000);
    }
    await sleep(3000);
    st = await a.evaluate(STATE);
    preview = null;
    for (const f of a.frames()) { try { const s2 = await f.evaluate(PREVIEW); if (s2) { preview = s2; break; } } catch {} }
    note({ step: 'result', attempt, elapsedMs: Date.now() - t0, notifications: st.notifications, hasOutsideText: st.hasOutsideText, hasCannotOpen: st.hasCannotOpen, preview });
    await shot(a, `${tag}-01-window-a-output-preview-attempt${attempt}.png`);
    if (preview || st.hasOutsideText) break;
  }
  const mainLog = spawned[0].lines.join('');
  const errLines = mainLog.split(/\r?\n/).filter(l => /outside the workspace|動画プレビュー|resolveProjectAssetUri/.test(l)).slice(0, 10)
    .map(l => l.replace(/C:[\\/]Users[\\/][^\\/]+/gi, '<HOME>'));
  note({ step: 'backend-log-matches', lines: errLines });
  writeFileSync(join(outDir, `${tag}-electron-stdio.log`), spawned.map(s => `== ${s.ws}\n${s.lines.join('')}`).join('\n'));
} catch (error) {
  note({ step: 'error', message: String(error && error.message || error) });
} finally {
  try { const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); await new Promise(res => { const ws = new WebSocket(v.webSocketDebuggerUrl); ws.onopen = () => { ws.send(JSON.stringify({ id: 1, method: 'Browser.close' })); setTimeout(res, 500); }; ws.onerror = res; }); } catch {}
  await sleep(4000);
  for (const s of spawned) { try { if (s.child.exitCode === null) execFileSync('taskkill', ['/PID', String(s.child.pid), '/T', '/F']); } catch {} }
  writeFileSync(join(outDir, `${tag}-l1.json`), JSON.stringify(log, null, 2));
  process.exit(0);
}
