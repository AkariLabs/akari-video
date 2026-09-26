#!/usr/bin/env node
// 編集タブの「補正」を実機で撮る（BEFORE / AFTER 共通）。
//   node l1-edit-correction.mjs --phase=before|after [--port=9633]
// 一時ディレクトリにプロジェクト（ふつうの PNG 写真 + ふつうの MP4）を作り、開発ビルドの Electron を
// 隔離した HOME / AKARI_HOME / THEIA_CONFIG_DIR / userData で起動して CDP で操作する。
//   01 仮枠ツール（F）で空の枠を描く → 編集タブ
//   02 その枠で「静止画」を押して専用パネルを開く
//   03 ふつうの PNG 写真のクリップ → 編集タブ
//   04 03 で「補正」を開く → ふつうの動画へ移る → 写真へ戻る（開閉を覚えているか）
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick } from './cdp-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps/shell');
const localElectron = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const ELECTRON = await stat(localElectron).then(s => s.isFile()).catch(() => false)
  ? localElectron : path.join(REPO, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const BIN = path.join(REPO, 'apps/shell/extensions/akari-annotations/test/fixtures/ai-still-routes-bin');
const PHASE = process.argv.find(arg => arg.startsWith('--phase='))?.slice(8) ?? 'after';
if (!['before', 'after'].includes(PHASE)) throw new Error('--phase must be before or after');
const PORT = Number(process.argv.find(arg => arg.startsWith('--port='))?.slice(7) ?? 9633);
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const ISO = await mkdtemp(path.join(os.tmpdir(), 'akari-edit-correction-empty-frame-'));
const PROJECT = path.join(ISO, 'project');
const STATE = path.join(ISO, 'image-state');
const S = JSON.stringify;
const results = { phase: PHASE, status: 'running', step: '', checks: [], observations: {}, clicks: [], screenshots: [] };
const clean = value => String(value).replaceAll(REPO, '<WORKTREE>').replaceAll(ISO, '<TMP>').replaceAll(os.homedir(), '<HOME>')
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '<email>');
async function save() {
  const target = path.join(ROOT, `results-${PHASE}.json`);
  const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, `${clean(JSON.stringify(results, null, 2))}\n`);
  await rename(temp, target);
}
async function stage(name) { results.step = name; await save(); }
function check(name, pass, measured) {
  results.checks.push({ name, pass: !!pass, measured });
  if (!pass) throw new Error(`${name}: ${JSON.stringify(measured)}`);
}
async function waitEval(cdp, expression, name, timeout = 30_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const value = await evalOn(cdp, expression).catch(() => undefined);
    if (value) return value;
    await sleep(180);
  }
  throw new Error(`Timed out: ${name}`);
}
const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.once('error', reject);
  child.once('close', code => code === 0 ? resolve() : reject(new Error(`${command} failed (${code}): ${stderr.slice(-800)}`)));
});
async function makeFixture() {
  await mkdir(path.join(PROJECT, 'assets'), { recursive: true });
  await mkdir(path.join(PROJECT, '.akari'), { recursive: true });
  await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720',
    '-frames:v', '1', path.join(PROJECT, 'assets', 'photo.png')]);
  await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=#264653:s=1280x720:r=30',
    '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(PROJECT, 'assets', 'clip.mp4')]);
  await writeFile(path.join(PROJECT, '.akari', 'connections.json'), `${JSON.stringify({
    providers: [], defaults: { generate: { still: 'codex-image', video: 'fal:h3-i2v' } },
    policy: { currency: 'USD', monthly_budget: null, approval_threshold: null }, memory: []
  }, null, 2)}\n`);
  await writeFile(path.join(PROJECT, 'captions.json'), '{ "captions": [] }\n');
  await writeFile(path.join(PROJECT, 'edit.json'), `${JSON.stringify({
    version: 2, output: { width: 1280, height: 720, fps: 30 },
    sources: [{ id: 'src-photo', path: 'assets/photo.png' }, { id: 'src-clip', path: 'assets/clip.mp4' }],
    tracks: [{ id: 'visual-main', lane: 'visual', items: [
      { id: 'clip-photo', at: 0, duration: 90, source: { kind: 'media', src: 'src-photo', in: 0, out: 3 } },
      { id: 'clip-video', at: 90, duration: 90, source: { kind: 'media', src: 'src-clip', in: 0, out: 3 } }
    ] }],
    audio: { narration: [], sfx: [] }
  }, null, 2)}\n`);
}
async function clearNotifications(cdp) {
  await evalOn(cdp, `(async()=>{try{const c=window.theia?.container;const d=c?._bindingDictionary;
    const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');
    await c.get(C).executeCommand('notifications.commands.clearAll');}catch{}return true})()`).catch(() => undefined);
}
async function settle(cdp) {
  await evalOn(cdp, `(()=>new Promise(resolve=>{const roots=['[data-akari-ui="panel:inspector"]','[data-akari-ui="panel:timeline"]']
    .map(x=>document.querySelector(x)).filter(Boolean);if(!roots.length){resolve(true);return}
    let quiet,limit;const observers=roots.map(root=>{const o=new MutationObserver(reset);o.observe(root,{subtree:true,childList:true,attributes:true,characterData:true});return o});
    function finish(){clearTimeout(quiet);clearTimeout(limit);observers.forEach(o=>o.disconnect());resolve(true)}
    function reset(){clearTimeout(quiet);quiet=setTimeout(finish,500)}limit=setTimeout(finish,30000);reset()}) )()`);
}
async function pointOf(cdp, selector) {
  return waitEval(cdp, `(async()=>{const e=document.querySelector(${S(selector)});if(!e)return null;
    e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const b=e.getBoundingClientRect(),x=b.left+b.width/2,y=b.top+b.height/2;
    const hit=document.elementFromPoint(x,y);return b.width&&b.height&&hit&&(hit===e||e.contains(hit))?{x,y}:null})()`, `click target ${selector}`);
}
async function clickUntil(cdp, selector, expectation, name) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await settle(cdp);
    await clearNotifications(cdp);
    try {
      const point = await pointOf(cdp, selector);
      await realClick(cdp, point.x, point.y);
      await waitEval(cdp, expectation, name, 8000);
      results.clicks.push({ name, attempt, passed: true });
      return;
    } catch (error) {
      results.clicks.push({ name, attempt, passed: false, reason: clean(error?.message ?? error) });
      if (attempt === 3) throw error;
    }
  }
}
async function shot(cdp, name) {
  await settle(cdp);
  await clearNotifications(cdp);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const bytes = Buffer.from(data, 'base64');
  await writeFile(path.join(ROOT, name), bytes);
  results.screenshots.push({ name, bytes: bytes.length });
  await save();
}
// 編集タブの節の並び・「補正」の有無と開閉・開いたときの中身（入れ子の節名と欄）を読む
const inspectEdit = `(()=>{const root=document.querySelector('[data-akari-ui="panel:inspector"]');
  const tab=root?.querySelector('[data-akari-ui="tab:inspector-edit"]');
  const correction=root?.querySelector('[data-akari-ui="section:inspector-edit-correction"]');
  const toggle=correction?.querySelector(':scope > .akari-inspector-section-header .akari-inspector-section-toggle');
  const body=correction?.querySelector(':scope > .akari-inspector-section-body');
  return{editTabActive:!!tab&&(tab.classList.contains('is-active')||tab.getAttribute('aria-selected')==='true'),
    header:root?.querySelector('[data-akari-ui="inspector-selection-header"] strong')?.textContent?.trim()??null,
    sections:[...(root?.querySelectorAll('[data-akari-ui^="section:inspector-"]')??[])].map(e=>e.getAttribute('data-akari-ui').slice(18)),
    correction:!!correction,
    correctionExpanded:toggle?toggle.getAttribute('aria-expanded')==='true':null,
    correctionBodyHidden:body?body.hidden:null,
    correctionText:body?.textContent?.replace(/\\s+/g,' ').trim().slice(0,160)??null,
    materialChoice:!!root?.querySelector('[data-akari-ui="section:inspector-edit-material-choice"]'),
    correctionContents:body?{subsections:[...body.querySelectorAll('.akari-inspector-adjust-subtitle-label')].map(e=>e.textContent.trim()),
      fields:[...new Set([...body.querySelectorAll('[data-akari-field]')].map(e=>e.getAttribute('data-akari-field')))],
      buttons:[...body.querySelectorAll('button')].map(e=>e.textContent.trim()).filter(Boolean)}:null,
    stillPanel:!!root?.querySelector('[data-akari-inspector-ai-create="true"]'),
    tiles:!!root?.querySelector('[data-akari-inspector-ai-tile]')}})()`;
const editTab = '[data-akari-ui="tab:inspector-edit"]';
const editTabActive = `(()=>{const t=document.querySelector(${S(editTab)});return !!t&&(t.classList.contains('is-active')||t.getAttribute('aria-selected')==='true')})()`;
async function openEditTab(cdp) {
  if (!await evalOn(cdp, editTabActive)) await clickUntil(cdp, editTab, editTabActive, 'open edit tab');
}
async function selectCut(cdp, index, title) {
  const selector = `[data-akari-ui="timeline:cut:${index}"]`;
  await clickUntil(cdp, selector, `document.querySelector(${S(selector)})?.classList.contains('akari-annotations-selected')
    && document.querySelector('[data-akari-ui="inspector-selection-header"] strong')?.textContent?.trim()===${S(title)}`, `select ${title}`);
}
async function waitForExit(child, ms = 10000) {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise(resolve => { const t = setTimeout(() => resolve(false), ms); child.once('exit', () => { clearTimeout(t); resolve(true); }); });
}

let electron, cdp;
try {
  await stage('fixture');
  await stat(ELECTRON);
  await makeFixture();
  await writeFile(STATE, 'ready');
  for (const name of ['akari-home', 'theia-config', 'user-data', 'home']) await mkdir(path.join(ISO, name));
  await stage('Electron');
  const env = { ...process.env, HOME: path.join(ISO, 'home'), AKARI_HOME: path.join(ISO, 'akari-home'), THEIA_CONFIG_DIR: path.join(ISO, 'theia-config'),
    PATH: `${BIN}${path.delimiter}${process.env.PATH}`, AKARI_CODEX_BIN: path.join(BIN, 'codex'), AKARI_AGY_BIN: path.join(BIN, 'agy'),
    AKARI_GROK_BIN: path.join(BIN, 'grok'), FAKE_IMAGE_STATE_FILE: STATE };
  for (const name of ['FAL_KEY', 'GROQ_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'XAI_API_KEY']) delete env[name];
  electron = spawn(ELECTRON, [SHELL, PROJECT, `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${path.join(ISO, 'user-data')}`, '--window-size=1800,1000', '--no-sandbox'], { cwd: REPO, env, stdio: 'ignore' });
  results.observations.electronPid = electron.pid;
  const target = await (async () => { const until = Date.now() + 120_000; while (Date.now() < until) {
    const page = await listTargets(PORT).then(rows => rows.find(row => row.type === 'page')).catch(() => undefined);
    if (page) return page;
    await sleep(300);
  } throw new Error('CDP page missing'); })();
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await waitEval(cdp, `Boolean(window.theia?.container&&document.getElementById('theia-app-shell'))`, 'Theia', 120_000);
  const command = id => `(async()=>{const c=window.theia.container,d=c._bindingDictionary;
    const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');
    await c.get(C).executeCommand(${S(id)});return true})()`;
  if (!await evalOn(cdp, `Boolean(document.querySelector('[data-akari-ui="timeline:cut:0"]'))`)) await evalOn(cdp, command('akari.annotations.open'));
  await waitEval(cdp, `Boolean(document.querySelector('[data-akari-ui="timeline:cut:1"]'))`, 'timeline', 120_000);
  await evalOn(cdp, command('akari.inspector.open')).catch(() => undefined);
  await waitEval(cdp, `Boolean(document.querySelector('[data-akari-ui="panel:inspector"]'))`, 'inspector');
  await stage('waiting for preload to clear');
  await waitEval(cdp, `(()=>{const e=document.querySelector('.theia-preload');if(!e)return true;const s=getComputedStyle(e),r=e.getBoundingClientRect();
    return !(s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0&&r.width&&r.height)})()`, 'preload', 420_000);
  await pointOf(cdp, '[data-akari-ui="timeline:cut:1"]');

  await stage('01 draw an empty frame with the frame tool');
  await clickUntil(cdp, 'button[aria-label="仮枠ツール"]', `document.querySelector('button[aria-label="仮枠ツール"]')?.getAttribute('aria-pressed')==='true'`, 'frame tool');
  // 下に映像がある B-roll の典型: V1 の上の「新しい映像トラック」の帯に、写真クリップと同じ区間で描く
  const geometry = await evalOn(cdp, `(()=>{const b=document.querySelector('[data-akari-ui="timeline:cut:0"]').getBoundingClientRect();
    return{left:b.left,right:b.right,top:b.top}})()`);
  results.observations.drawGeometry = geometry;
  const from = { x: geometry.left + 8, y: geometry.top - 14 }, to = { x: geometry.right - 8, y: geometry.top - 14 };
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
  for (let step = 1; step <= 10; step++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + (to.x - from.x) * step / 10, y: from.y, button: 'left', buttons: 1 });
    await sleep(30);
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 });
  const frame = await (async () => { const until = Date.now() + 90_000; while (Date.now() < until) {
    const doc = JSON.parse(await readFile(path.join(PROJECT, 'edit.json'), 'utf8'));
    const item = doc.tracks.flatMap(track => track.items ?? []).find(row => String(row.id).startsWith('frame-'));
    if (item) return item;
    await sleep(200);
  } throw new Error('empty frame was not written to edit.json'); })();
  results.observations.frame = { id: frame.id, name: frame.name, at: frame.at, duration: frame.duration };
  await clickUntil(cdp, 'button[aria-label="選択ツール"]', `document.querySelector('button[aria-label="選択ツール"]')?.getAttribute('aria-pressed')==='true'`, 'select tool');
  await waitEval(cdp, `document.querySelector('[data-akari-ui="inspector-selection-header"]')?.textContent?.includes('frame-')`, 'empty frame selected');
  await openEditTab(cdp);
  await waitEval(cdp, `Boolean(document.querySelector('[data-akari-inspector-ai-tile="still"]'))`, 'empty frame tiles', 60_000);
  const emptyFrame = await evalOn(cdp, inspectEdit);
  results.observations.emptyFrameEdit = emptyFrame;
  await shot(cdp, `01-${PHASE}-empty-frame-edit.png`);
  if (PHASE === 'before') check('BEFORE: 空の枠の編集タブに「補正」が開いて出ている（再現）', emptyFrame.correction && emptyFrame.correctionExpanded === true, emptyFrame);
  else {
    check('空の枠の編集タブに「補正」が出ない', emptyFrame.editTabActive && !emptyFrame.correction, emptyFrame);
    check('空の枠の編集タブに「素材の選択」が出ない', !emptyFrame.materialChoice, emptyFrame);
  }

  await stage('02 open the still panel on the empty frame');
  await clickUntil(cdp, '[data-akari-inspector-ai-tile="still"]', `Boolean(document.querySelector('[data-akari-inspector-ai-create="true"]'))`, 'still panel');
  const stillPanel = await evalOn(cdp, inspectEdit);
  results.observations.stillPanel = stillPanel;
  await shot(cdp, `02-${PHASE}-still-panel.png`);
  if (PHASE === 'before') check('BEFORE: 静止画の専用画面の上にも「補正」が出ている（再現）', stillPanel.correction, stillPanel);
  else check('静止画の専用画面に「補正」「素材の選択」が出ない', stillPanel.stillPanel && !stillPanel.correction && !stillPanel.materialChoice, stillPanel);

  await stage('03 ordinary photo clip');
  await selectCut(cdp, 0, 'photo.png');
  await openEditTab(cdp);
  await waitEval(cdp, `Boolean(document.querySelector('[data-akari-ui="section:inspector-edit-correction"]'))`, 'photo correction', 60_000);
  const photo = await evalOn(cdp, inspectEdit);
  results.observations.photoEdit = photo;
  await shot(cdp, `03-${PHASE}-photo-edit.png`);
  if (PHASE === 'before') check('BEFORE: 写真の編集タブに「補正」が開いて出ている', photo.correction && photo.correctionExpanded === true, photo);
  else check('写真のタイル一覧に「補正」が閉じた状態で出る', photo.tiles && photo.correction && photo.correctionExpanded === false && photo.correctionBodyHidden === true, photo);

  await stage('04 open correction, move away and come back');
  if (!photo.correctionExpanded) {
    await clickUntil(cdp, '[data-akari-ui="section:inspector-edit-correction"] .akari-inspector-section-toggle',
      `document.querySelector('[data-akari-ui="section:inspector-edit-correction"] .akari-inspector-section-toggle')?.getAttribute('aria-expanded')==='true'`, 'open correction');
  }
  const opened = await evalOn(cdp, inspectEdit);
  results.observations.photoCorrectionOpened = opened;
  await selectCut(cdp, 1, 'clip.mp4');
  await openEditTab(cdp);
  await waitEval(cdp, `Boolean(document.querySelector('[data-akari-inspector-ai-tile]'))`, 'video tiles', 60_000);
  results.observations.videoEdit = await evalOn(cdp, inspectEdit);
  await selectCut(cdp, 0, 'photo.png');
  await openEditTab(cdp);
  await waitEval(cdp, `Boolean(document.querySelector('[data-akari-ui="section:inspector-edit-correction"]'))`, 'photo correction again', 60_000);
  const back = await evalOn(cdp, inspectEdit);
  results.observations.photoEditBack = back;
  await shot(cdp, `04-${PHASE}-photo-reopened-remembered.png`);
  check('ふつうの動画のタイル一覧にも「補正」節（まだありません）が出る', results.observations.videoEdit.correction, results.observations.videoEdit);
  check('写真へ戻ると「補正」は開いたまま', back.correction && back.correctionExpanded === true, back);
  results.status = 'PASS';
} catch (error) {
  results.status = 'FAIL';
  results.error = clean(error?.stack ?? error);
  if (cdp) { try { await shot(cdp, `error-${PHASE}.png`); } catch {} }
} finally {
  results.step = 'cleanup';
  try { cdp?.close(); } catch {}
  if (electron?.pid) {
    try {
      if (electron.exitCode === null && electron.signalCode === null) process.kill(electron.pid, 'SIGTERM');
      if (!await waitForExit(electron)) { process.kill(electron.pid, 'SIGKILL'); await waitForExit(electron); }
    } catch (error) { results.cleanupError = clean(error?.message ?? error); }
  }
  await rm(ISO, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(error => { results.cleanupError = clean(error); });
  await save();
}
if (results.status !== 'PASS' || results.checks.some(row => !row.pass)) process.exitCode = 1;
