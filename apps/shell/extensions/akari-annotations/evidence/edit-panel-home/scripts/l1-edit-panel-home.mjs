#!/usr/bin/env node
// 編集パネル（旧インスペクター）のホーム・「整える」・近日・空の枠の写真の道具を実機で撮る（BEFORE / AFTER 共通）。
//   node l1-edit-panel-home.mjs --phase=before|after [--port=9635]
// 一時ディレクトリにプロジェクト（ふつうの PNG 写真 + MP4 + 効果音 WAV）を作り、開発ビルドの Electron を
// 隔離した HOME / AKARI_HOME / THEIA_CONFIG_DIR / userData で起動して CDP で操作する。
//   01 写真のクリップを選んだ編集パネル全体（タイトル・タブの並び・最初に開くタブ）
//   02 写真のホーム（編集）タブ — 画像の AI・浮いたバーの写真の項目（写真は今どおり出る）
//   03 仮枠ツールで描いた空の枠のホーム（編集）タブと浮いたバー
//   04 写真で「静止画」の専用パネルを開いてから上のホーム（編集）タブを押した結果
//   05 音声クリップの音声タブ（ボイス分離）
//   06 （AFTER のみ）「整える」の「位置と大きさ」→ 映像タブの変形の節
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
const AFTER = PHASE === 'after';
const PORT = Number(process.argv.find(arg => arg.startsWith('--port='))?.slice(7) ?? 9635);
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const ISO = await realpath(await mkdtemp(path.join(os.tmpdir(), 'akari-edit-panel-home-')));
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
  await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    path.join(PROJECT, 'assets', 'se.wav')]);
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
    audio: { narration: [], sfx: [{ id: 's-0001', path: 'assets/se.wav', t: 0.5, track: 0 }] }
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
// 編集パネル全体: タイトル・タブ・節・ホームの中身・「近日」の件数（本文 + title/aria-label/placeholder）・浮いたバーの項目
const inspectPanel = `(()=>{const root=document.querySelector('[data-akari-ui="panel:inspector"]');
  const tabLabels=[...document.querySelectorAll('[class*="TabBar-tabLabel"]')].map(e=>e.textContent.trim());
  const sideTitles=[...document.querySelectorAll('.theia-sidepanel-title,.theia-sidepanel-toolbar .theia-sidepanel-title,.p-TabBar-tabLabel,.lm-TabBar-tabLabel')]
    .map(e=>e.textContent.trim()).filter(t=>/インスペクター|編集パネル/.test(t));
  const tabs=[...(root?.querySelectorAll('[data-akari-ui^="tab:inspector-"]')??[])].map(e=>({id:e.getAttribute('data-akari-ui').slice(14),
    label:e.textContent.trim(),active:e.classList.contains('is-active')||e.getAttribute('aria-selected')==='true',
    disabled:e.disabled===true||e.getAttribute('aria-disabled')==='true',title:e.getAttribute('title')}));
  const tablist=root?.querySelector('[role="tablist"]');
  const soonAttrs=[...(root?.querySelectorAll('*')??[])].flatMap(e=>['title','aria-label','placeholder'].map(a=>e.getAttribute(a)).filter(v=>v&&v.includes('近日')));
  const tiles=[...(root?.querySelectorAll('[data-akari-inspector-ai-tile]')??[])].map(e=>({id:e.getAttribute('data-akari-inspector-ai-tile'),enabled:e.getAttribute('aria-disabled')!=='true'}));
  const bar=[...document.querySelectorAll('[data-akari-ui="preview-context-bar"] [data-akari-bar-item]')].map(e=>e.getAttribute('data-akari-bar-item'));
  const barEl=document.querySelector('[data-akari-ui="preview-context-bar"]');
  return{panelLabel:root?.getAttribute('data-akari-ui-label')??null,sideTitles:[...new Set(sideTitles)],
    workbenchTabLabels:[...new Set(tabLabels.filter(t=>/インスペクター|編集パネル/.test(t)))],
    tablistLabel:tablist?.getAttribute('aria-label')??null,tabs,activeTab:tabs.find(t=>t.active)?.id??null,
    header:root?.querySelector('[data-akari-ui="inspector-selection-header"] strong')?.textContent?.trim()??null,
    sections:[...(root?.querySelectorAll('[data-akari-ui^="section:inspector-"]')??[])].map(e=>e.getAttribute('data-akari-ui').slice(18)),
    tiles,enabledTiles:tiles.filter(t=>t.enabled).length,
    stillPanel:!!root?.querySelector('[data-akari-inspector-ai-create="true"]'),
    imageAiPanel:!!root?.querySelector('[data-akari-image-ai-panel]'),
    imageAiButtons:[...(root?.querySelectorAll('[data-akari-image-ai-panel] button')??[])].map(e=>e.textContent.trim()),
    soonText:(root?.textContent.match(/近日/g)??[]).length,soonAttrs,
    soonChips:root?.querySelectorAll('[class*="section-soon"]').length??0,
    voiceIsolationRow:!!root?.querySelector('[data-akari-field="audio-voice-isolation"]'),
    bar,barHidden:barEl?barEl.hidden:null}})()`;
const editTab = '[data-akari-ui="tab:inspector-edit"]';
const tabActive = id => `(()=>{const t=document.querySelector('[data-akari-ui="tab:inspector-${id}"]');return !!t&&(t.classList.contains('is-active')||t.getAttribute('aria-selected')==='true')})()`;
async function openTab(cdp, id) {
  if (!await evalOn(cdp, tabActive(id))) await clickUntil(cdp, `[data-akari-ui="tab:inspector-${id}"]`, tabActive(id), `open ${id} tab`);
}
async function selectCut(cdp, index, title) {
  const selector = `[data-akari-ui="timeline:cut:${index}"]`;
  await clickUntil(cdp, selector, `document.querySelector(${S(selector)})?.classList.contains('akari-annotations-selected')
    && document.querySelector('[data-akari-ui="inspector-selection-header"] strong')?.textContent?.trim()===${S(title)}`, `select ${title}`);
}
/** 押せるタブを全部開いて「近日」を数える（画面ごとの DOM 検索）。 */
async function soonAcrossTabs(cdp) {
  const tabs = (await evalOn(cdp, inspectPanel)).tabs;
  const rows = [];
  for (const tab of tabs) {
    if (tab.disabled) { rows.push({ tab: tab.id, disabled: true, title: tab.title }); continue; }
    await openTab(cdp, tab.id);
    await settle(cdp);
    const seen = await evalOn(cdp, inspectPanel);
    rows.push({ tab: tab.id, label: tab.label, soonText: seen.soonText, soonAttrs: seen.soonAttrs, soonChips: seen.soonChips });
  }
  return rows;
}
async function waitForExit(child, ms = 10000) {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise(resolve => { const t = setTimeout(() => resolve(false), ms); child.once('exit', () => { clearTimeout(t); resolve(true); }); });
}
const PHOTO_BAR_KEYS = ['edit', 'cutout', 'eraser', 'photoColor', 'crop'];

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
  const target = await (async () => { const until = Date.now() + 600_000; while (Date.now() < until) {
    const page = await listTargets(PORT).then(rows => rows.find(row => row.type === 'page')).catch(() => undefined);
    if (page) return page;
    await sleep(300);
  } throw new Error('CDP page missing'); })();
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await waitEval(cdp, `Boolean(window.theia?.container&&document.getElementById('theia-app-shell'))`, 'Theia', 1_200_000);
  const command = (id, arg) => `(async()=>{const c=window.theia.container,d=c._bindingDictionary;
    const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');
    const r=await c.get(C).executeCommand(${S(id)}${arg === undefined ? '' : `,${S(arg)}`});try{return JSON.stringify(r??null)}catch{return String(r)}})()`;
  if (!await evalOn(cdp, `Boolean(document.querySelector('[data-akari-ui="timeline:cut:0"]'))`)) await evalOn(cdp, command('akari.annotations.open'));
  await waitEval(cdp, `Boolean(document.querySelector('[data-akari-ui="timeline:cut:1"]'))`, 'timeline', 900_000);
  await evalOn(cdp, command('akari.inspector.open')).catch(() => undefined);
  await waitEval(cdp, `Boolean(document.querySelector('[data-akari-ui="panel:inspector"]'))`, 'inspector');
  await stage('waiting for preload to clear');
  await waitEval(cdp, `(()=>{const e=document.querySelector('.theia-preload');if(!e)return true;const s=getComputedStyle(e),r=e.getBoundingClientRect();
    return !(s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0&&r.width&&r.height)})()`, 'preload', 1_200_000);
  // 浮いたバーは出力プレビューの上に出る
  const editUri = pathToFileURL(path.join(PROJECT, 'edit.json')).toString();
  for (let attempt = 0; attempt < 6; attempt++) {
    const opened = await evalOn(cdp, command('akari.preview.ensureVisible', { editUri })).catch(() => undefined);
    results.observations.previewOpen = opened;
    if (opened && opened.includes('opened')) break;
    await sleep(3000);
  }
  await waitEval(cdp, `Boolean(document.querySelector('[data-akari-ui="preview-context-bar"]'))`, 'preview context bar', 120_000);
  await pointOf(cdp, '[data-akari-ui="timeline:cut:1"]');

  await stage('01 photo: whole edit panel');
  // 浮いたバーの描画を全部記録する（初めて選んだ写真で、写真用の項目が欠けた描画が挟まらないか）
  await evalOn(cdp, `(()=>{const bar=document.querySelector('[data-akari-ui="preview-context-bar"]');window.__l1BarRenders=[];
    const read=()=>[...bar.querySelectorAll('[data-akari-bar-item]')].map(e=>e.getAttribute('data-akari-bar-item')).join(',');
    let last=read();window.__l1BarRenders.push(last);
    window.__l1BarObserver=new MutationObserver(()=>{const now=read();if(now!==last){last=now;window.__l1BarRenders.push(now)}});
    window.__l1BarObserver.observe(bar,{childList:true,subtree:true,attributes:true});return true})()`);
  await selectCut(cdp, 0, 'photo.png');
  const selectedAt = Date.now();
  const photoPanel = await evalOn(cdp, inspectPanel);
  results.observations.photoPanel = photoPanel;
  // 初めて選んだ写真で、浮いたバーに写真用の項目が揃うまでの時間（生成の状態の読み出し待ち）
  const barKeys = `[...document.querySelectorAll('[data-akari-ui="preview-context-bar"] [data-akari-bar-item]')].map(e=>e.getAttribute('data-akari-bar-item'))`;
  await waitEval(cdp, `(()=>{const k=${barKeys};return ${S(PHOTO_BAR_KEYS)}.every(x=>k.includes(x))})()`, 'photo bar items', 30_000).catch(() => undefined);
  const readyMs = Date.now() - selectedAt;
  await sleep(1500);
  const renders = await evalOn(cdp, `(()=>{window.__l1BarObserver?.disconnect();return window.__l1BarRenders})()`);
  results.observations.firstPhotoBar = { initial: photoPanel.bar, photoToolsReadyMs: readyMs, final: await evalOn(cdp, barKeys), renders };
  if (AFTER) check('初めて選んだ写真で、浮いたバーに写真用の項目が欠けた描画が挟まらない',
    renders.filter(row => row).every(row => PHOTO_BAR_KEYS.every(key => row.split(',').includes(key))), renders);
  await shot(cdp, `01-${PHASE}-photo-panel.png`);
  if (AFTER) {
    check('パネルのタイトルが「編集パネル」', photoPanel.panelLabel === '編集パネル' && photoPanel.sideTitles.every(t => !t.includes('インスペクター'))
      && photoPanel.sideTitles.some(t => t.includes('編集パネル')), photoPanel);
    check('映像のクリップのタブが ホーム / 映像 / 色 / 音声 / 動き / 情報 の順',
      S(photoPanel.tabs.map(t => t.label)) === S(['ホーム', '映像', '色', '音声', '動き', '情報']) && photoPanel.tabs[0].id === 'edit', photoPanel.tabs);
  }

  await stage('02 photo: home (edit) tab');
  await openTab(cdp, 'edit');
  await waitEval(cdp, `Boolean(document.querySelector('[data-akari-inspector-ai-tile]'))`, 'photo tiles', 60_000);
  const imagePanelPoint = await evalOn(cdp, `(()=>{const e=document.querySelector('[data-akari-image-ai-panel]');if(!e)return false;e.scrollIntoView({block:'center',behavior:'instant'});return true})()`);
  const photoHome = await evalOn(cdp, inspectPanel);
  results.observations.photoHome = { ...photoHome, imagePanelScrolled: imagePanelPoint };
  await shot(cdp, `02-${PHASE}-photo-home.png`);
  check(`${PHASE}: 写真のホームに画像の AI（高画質化）が出る`, photoHome.imageAiPanel && photoHome.imageAiButtons.some(t => t.includes('高画質化')), photoHome);
  check(`${PHASE}: 写真の浮いたバーに写真用の項目が出る`, PHOTO_BAR_KEYS.every(key => photoHome.bar.includes(key)), photoHome.bar);
  if (AFTER) {
    check('写真のホームに「背景生成（近日）」が無い', !photoHome.imageAiButtons.some(t => t.includes('背景生成') || t.includes('近日')), photoHome.imageAiButtons);
    const hasTidy = await evalOn(cdp, `(()=>{const root=document.querySelector('[data-akari-ui="panel:inspector"]');
      return ['位置と大きさ','色','音量','動き'].map(t=>[...root.querySelectorAll('button,[role="button"]')].some(b=>b.textContent.replace(/\\s+/g,'')===t||b.textContent.replace(/\\s+/g,'').startsWith(t)))})()`);
    results.observations.photoHomeTidyButtons = hasTidy;
  }
  results.observations.photoSoonByTab = await soonAcrossTabs(cdp);
  if (AFTER) check('写真の編集パネルの全タブで「近日」0 件', results.observations.photoSoonByTab.every(r => r.disabled ? !(r.title ?? '').includes('近日') : r.soonText === 0 && r.soonAttrs.length === 0 && r.soonChips === 0), results.observations.photoSoonByTab);

  await stage('03 draw an empty frame with the frame tool');
  // 選択を外して浮いたバーを空にしてから描く（描いた後に写真用の項目が出たら、それは空の枠のもの）
  const barEmpty = `![...document.querySelectorAll('[data-akari-ui="preview-context-bar"] [data-akari-bar-item]')].length`;
  for (let attempt = 1; attempt <= 3 && !await evalOn(cdp, barEmpty); attempt++) {
    const spot = await evalOn(cdp, `(()=>{const t=document.querySelector('[data-akari-ui="timeline:cut:1"]').getBoundingClientRect();
      const p=document.querySelector('[data-akari-ui="panel:timeline"]').getBoundingClientRect();return{x:Math.min(p.right-30,t.right+60),y:t.top+t.height/2}})()`);
    await realClick(cdp, spot.x, spot.y);
    await sleep(800);
    if (!await evalOn(cdp, barEmpty)) {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await sleep(800);
    }
  }
  results.observations.barEmptyBeforeDraw = await evalOn(cdp, barEmpty);
  // 空の枠を描いて選ぶまでの浮いたバーの描画を、そのときの編集パネルの見出しと一緒に全部記録する
  await evalOn(cdp, `(()=>{const bar=document.querySelector('[data-akari-ui="preview-context-bar"]');window.__l1FrameRenders=[];
    const read=()=>({bar:[...bar.querySelectorAll('[data-akari-bar-item]')].map(e=>e.getAttribute('data-akari-bar-item')).join(','),
      header:document.querySelector('[data-akari-ui="inspector-selection-header"] strong')?.textContent?.trim()??''});
    let last='';const push=()=>{const now=read(),key=JSON.stringify(now);if(key!==last){last=key;window.__l1FrameRenders.push(now)}};push();
    window.__l1FrameObserver=new MutationObserver(push);
    window.__l1FrameObserver.observe(bar,{childList:true,subtree:true,attributes:true});
    const head=document.querySelector('[data-akari-ui="panel:inspector"]');if(head)window.__l1FrameObserver.observe(head,{childList:true,subtree:true,characterData:true});
    return true})()`);
  const readFrame = async () => JSON.parse(await readFile(path.join(PROJECT, 'edit.json'), 'utf8'))
    .tracks.flatMap(track => track.items ?? []).find(row => String(row.id).startsWith('frame-'));
  let frame;
  for (let attempt = 1; attempt <= 3 && !frame; attempt++) {
    if (!await evalOn(cdp, `document.querySelector('button[aria-label="仮枠ツール"]')?.getAttribute('aria-pressed')==='true'`)) {
      await clickUntil(cdp, 'button[aria-label="仮枠ツール"]', `document.querySelector('button[aria-label="仮枠ツール"]')?.getAttribute('aria-pressed')==='true'`, 'frame tool');
    }
    await settle(cdp);
    await clearNotifications(cdp);
    // 下に映像がある B-roll の典型: V1 の上の「新しい映像トラック」の帯に、写真クリップと同じ区間で描く
    const geometry = await evalOn(cdp, `(()=>{const b=document.querySelector('[data-akari-ui="timeline:cut:0"]').getBoundingClientRect();
      return{left:b.left,right:b.right,top:b.top}})()`);
    results.observations.drawGeometry = geometry;
    const from = { x: geometry.left + 8, y: geometry.top - 14 }, to = { x: geometry.right - 8, y: geometry.top - 14 };
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none' });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
    for (let step = 1; step <= 10; step++) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + (to.x - from.x) * step / 10, y: from.y, button: 'left', buttons: 1 });
      await sleep(60);
    }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 });
    const until = Date.now() + 30_000;
    while (Date.now() < until && !(frame = await readFrame())) await sleep(200);
    results.clicks.push({ name: 'draw empty frame', attempt, passed: !!frame });
  }
  if (!frame) throw new Error('empty frame was not written to edit.json');
  results.observations.frame = { id: frame.id, name: frame.name, at: frame.at, duration: frame.duration, generation: frame.generation ?? frame.meta ?? null };
  await clickUntil(cdp, 'button[aria-label="選択ツール"]', `document.querySelector('button[aria-label="選択ツール"]')?.getAttribute('aria-pressed')==='true'`, 'select tool');
  await waitEval(cdp, `document.querySelector('[data-akari-ui="inspector-selection-header"]')?.textContent?.includes('frame-')`, 'empty frame selected');
  await openTab(cdp, 'edit');
  await waitEval(cdp, `Boolean(document.querySelector('[data-akari-inspector-ai-tile="still"]'))`, 'empty frame tiles', 60_000);
  await sleep(1500);
  const emptyFrame = await evalOn(cdp, inspectPanel);
  results.observations.emptyFrameHome = emptyFrame;
  const frameRenders = await evalOn(cdp, `(()=>{window.__l1FrameObserver?.disconnect();return window.__l1FrameRenders})()`);
  results.observations.emptyFrameBarRenders = frameRenders;
  if (AFTER) check('空の枠を描いて選んだ直後から、浮いたバーに写真用の項目が一度も出ない',
    results.observations.barEmptyBeforeDraw === true
      && frameRenders.every(row => !PHOTO_BAR_KEYS.some(key => row.bar.split(',').includes(key))), frameRenders);
  await shot(cdp, `03-${PHASE}-empty-frame-home.png`);
  if (!AFTER) check('BEFORE: 空の枠のホーム（編集）に画像の AI か写真用のバーの項目が出ている（再現）',
    emptyFrame.imageAiPanel || PHOTO_BAR_KEYS.some(key => emptyFrame.bar.includes(key)), emptyFrame);
  else {
    check('空の枠のホームに高画質化・背景生成（画像の AI の欄）が出ない', !emptyFrame.imageAiPanel && emptyFrame.imageAiButtons.length === 0, emptyFrame);
    check('空の枠の浮いたバーに写真用の項目（背景透過・消しゴム・写真の色・切り抜き・補正へ飛ぶ項目）が出ない',
      PHOTO_BAR_KEYS.every(key => !emptyFrame.bar.includes(key)) && ['opacity', 'anim', 'arrange'].every(key => emptyFrame.bar.includes(key)), emptyFrame.bar);
  }
  results.observations.emptyFrameSoonByTab = await soonAcrossTabs(cdp);
  if (AFTER) check('空の枠の編集パネルの全タブで「近日」0 件', results.observations.emptyFrameSoonByTab.every(r => r.disabled ? !(r.title ?? '').includes('近日') : r.soonText === 0 && r.soonAttrs.length === 0 && r.soonChips === 0), results.observations.emptyFrameSoonByTab);

  await stage('04 photo: still panel then the home (edit) tab');
  await selectCut(cdp, 0, 'photo.png');
  await openTab(cdp, 'edit');
  await waitEval(cdp, `Boolean(document.querySelector('[data-akari-inspector-ai-tile="still"]'))`, 'photo still tile', 60_000);
  results.observations.photoTilesBeforeStill = (await evalOn(cdp, inspectPanel)).tiles;
  await clickUntil(cdp, '[data-akari-inspector-ai-tile="still"]', `Boolean(document.querySelector('[data-akari-inspector-ai-create="true"]'))`, 'still panel');
  results.observations.photoStillPanel = await evalOn(cdp, inspectPanel);
  await settle(cdp);
  const tabPoint = await pointOf(cdp, editTab);
  await realClick(cdp, tabPoint.x, tabPoint.y);
  await sleep(1200);
  await settle(cdp);
  const afterHomeClick = await evalOn(cdp, inspectPanel);
  results.observations.photoAfterHomeClick = afterHomeClick;
  await shot(cdp, `04-${PHASE}-still-then-home-tab.png`);
  if (!AFTER) check('BEFORE: 静止画の専用パネルで上の編集タブを押しても一覧へ戻らない（再現）', afterHomeClick.stillPanel && afterHomeClick.tiles.length === 0, afterHomeClick);
  else check('静止画の専用パネルでホームのタブを押すとタイル一覧へ戻る', !afterHomeClick.stillPanel && afterHomeClick.tiles.length > 0 && afterHomeClick.activeTab === 'edit', afterHomeClick);

  await stage('05 audio clip: audio tab');
  await clickUntil(cdp, '[data-akari-item-id="s-0001"]', `document.querySelector('[data-akari-ui="inspector-selection-header"]')?.textContent?.includes('se.wav')`, 'select se.wav');
  const audioPanel = await evalOn(cdp, inspectPanel);
  results.observations.audioPanelOnSelect = audioPanel;
  await openTab(cdp, 'audio');
  await settle(cdp);
  const voice = await evalOn(cdp, `(()=>{const e=document.querySelector('[data-akari-field="audio-voice-isolation"]')??document.querySelector('[data-akari-ui="panel:inspector"] [data-akari-field^="audio-lowcut"]');
    if(e)e.scrollIntoView({block:'center',behavior:'instant'});return !!e})()`);
  await sleep(500);
  const audioTab = await evalOn(cdp, inspectPanel);
  results.observations.audioTab = { ...audioTab, scrolledToVoiceRow: voice };
  await shot(cdp, `05-${PHASE}-audio-tab.png`);
  if (!AFTER) check('BEFORE: 音声タブに「ボイス分離（近日）」の行がある（再現）', audioTab.voiceIsolationRow && audioTab.soonText > 0, audioTab);
  else {
    check('音声クリップのタブが ホーム / 音声 / 情報 の順', S(audioTab.tabs.map(t => t.label)) === S(['ホーム', '音声', '情報']), audioTab.tabs);
    check('音声タブに「ボイス分離」の近日の行が無い', !audioTab.voiceIsolationRow && audioTab.soonText === 0, audioTab);
  }
  results.observations.audioSoonByTab = await soonAcrossTabs(cdp);
  if (AFTER) check('音声の編集パネルの全タブで「近日」0 件', results.observations.audioSoonByTab.every(r => r.disabled ? !(r.title ?? '').includes('近日') : r.soonText === 0 && r.soonAttrs.length === 0 && r.soonChips === 0), results.observations.audioSoonByTab);
  if (AFTER) {
    await openTab(cdp, 'edit');
    await settle(cdp);
    const audioHome = await evalOn(cdp, inspectPanel);
    const audioTidy = await evalOn(cdp, `(()=>{const root=document.querySelector('[data-akari-ui="panel:inspector"]');
      return ['位置と大きさ','色','音量','動き'].filter(t=>[...root.querySelectorAll('button,[role="button"]')].some(b=>b.textContent.replace(/\\s+/g,'').startsWith(t)))})()`);
    results.observations.audioHome = { ...audioHome, tidyButtons: audioTidy };
    // 押せるタイルが 1 つだけ（音声 = 文字起こし）の対象: 専用パネルでホームのタブを押しても専用パネルのまま
    await stage('05b audio: sole tile panel then the home tab');
    check('音声のホームで押せるタイルは 1 つ（文字起こし）', audioHome.enabledTiles === 1 && audioHome.tiles.find(t => t.enabled)?.id === 'transcribe', audioHome.tiles);
    const inPanel = `(()=>{const root=document.querySelector('[data-akari-ui="panel:inspector"]');return !!root.querySelector('.akari-inspector-ai-back')&&!root.querySelector('[data-akari-inspector-ai-tile]')})()`;
    await clickUntil(cdp, '[data-akari-inspector-ai-tile="transcribe"]', inPanel, 'transcribe panel');
    const beforeHome = await evalOn(cdp, `document.querySelector('[data-akari-ui="panel:inspector"]').textContent.replace(/\\s+/g,' ').slice(0,200)`);
    await settle(cdp);
    const homePoint = await pointOf(cdp, editTab);
    await realClick(cdp, homePoint.x, homePoint.y);
    await sleep(1200);
    await settle(cdp);
    const soleAfter = { ...(await evalOn(cdp, inspectPanel)), inPanel: await evalOn(cdp, inPanel), beforeHome };
    results.observations.audioSoleTileAfterHomeClick = soleAfter;
    await shot(cdp, `05b-${PHASE}-audio-sole-tile-home-tab.png`);
    check('押せるタイルが 1 つだけの対象では、ホームのタブを押しても専用パネルのまま', soleAfter.inPanel && soleAfter.activeTab === 'edit', soleAfter);
  }

  if (AFTER) {
    await stage('06 tidy shortcuts: 位置と大きさ → video tab transform section');
    const shortcuts = {};
    const tuneIds = { '色': 'color', '音量': 'volume', '動き': 'motion', '位置と大きさ': 'position' };
    for (const [label, tab] of [['色', 'adjust'], ['音量', 'audio'], ['動き', 'motion'], ['位置と大きさ', 'video']]) {
      await selectCut(cdp, 1, 'clip.mp4');
      await openTab(cdp, 'edit');
      await waitEval(cdp, `Boolean(document.querySelector('[data-akari-inspector-ai-tile]'))`, 'video tiles', 60_000);
      const selector = `[data-akari-home-tune="${tuneIds[label]}"]`;
      results.observations[`tune-${tuneIds[label]}-tile`] = await evalOn(cdp, `(()=>{const e=document.querySelector(${S(selector)});return e?{text:e.textContent.trim(),disabled:e.getAttribute('aria-disabled')}:null})()`);
      await clickUntil(cdp, selector, tabActive(tab), `tidy ${label}`);
      await sleep(900);
      await settle(cdp);
      shortcuts[label] = await evalOn(cdp, `(()=>{const root=document.querySelector('[data-akari-ui="panel:inspector"]');
        const active=[...root.querySelectorAll('[data-akari-ui^="tab:inspector-"]')].find(e=>e.classList.contains('is-active')||e.getAttribute('aria-selected')==='true');
        const view=root.getBoundingClientRect();
        const sections=[...root.querySelectorAll('[data-akari-ui^="section:inspector-"]')].map(e=>{const b=e.getBoundingClientRect();
          const t=e.querySelector('.akari-inspector-section-toggle');
          return{id:e.getAttribute('data-akari-ui').slice(18),top:Math.round(b.top-view.top),visible:b.bottom>view.top&&b.top<view.bottom,
            expanded:t?t.getAttribute('aria-expanded'):null}});
        return{activeTab:active?.getAttribute('data-akari-ui').slice(14),label:active?.textContent.trim(),sections}})()`);
      if (label === '位置と大きさ') await shot(cdp, `06-${PHASE}-tidy-position-to-transform.png`);
    }
    results.observations.tidyShortcuts = shortcuts;
    for (const [label, tab] of [['色', 'adjust'], ['音量', 'audio'], ['動き', 'motion'], ['位置と大きさ', 'video']]) {
      check(`「整える」の「${label}」→ ${tab} タブ`, shortcuts[label].activeTab === tab, shortcuts[label]);
    }
    const transform = shortcuts['位置と大きさ'].sections.find(s => /transform/.test(s.id));
    check('「位置と大きさ」で映像タブの変形の節が見えて開いている', !!transform && transform.visible && transform.expanded !== 'false', shortcuts['位置と大きさ']);
  }
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
