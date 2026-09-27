#!/usr/bin/env node
// 手順 0（BEFORE）/ 手順 3（AFTER）: ホームの「補正」と「整える」のタイルを実機で撮る。
//   node l1.mjs --phase=before|after [--port=9646] [--repo=<ビルド済みのリポ>]
// 一時ディレクトリにプロジェクト（V1 = 動画 0〜3 秒 + 写真 3〜6 秒 / V2 = 写真のレイヤー 0〜6 秒 / V3 = 図形 0〜6 秒）を作り、
// 開発ビルドの Electron を隔離した HOME / AKARI_HOME / THEIA_CONFIG_DIR / userData で起動して CDP で操作する。有償 API は呼ばない。
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick } from './cdp-lib.mjs';

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const PHASE = arg('phase') ?? 'after';
const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(SCRIPTS);
const REPO = path.resolve(arg('repo') ?? path.resolve(ROOT, '..', '..', '..', '..', '..', '..'));
const SHELL = path.join(REPO, 'apps/shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const PORT = Number(arg('port') ?? 9646);
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const ISO = await realpath(await mkdtemp(path.join(os.tmpdir(), `akari-l1-home-correction-and-tune-tiles-${PHASE}-`)));
const PROJECT = path.join(ISO, 'project');
const S = JSON.stringify;
const results = { phase: PHASE, status: 'running', step: '', checks: [], observations: {}, screenshots: [], notes: [] };
const clean = value => String(value).replaceAll(REPO, '<REPO>').replaceAll(ISO, '<TMP>').replaceAll(os.homedir(), '<HOME>')
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '<email>');
async function save() {
  const target = path.join(ROOT, `results-${PHASE}.json`);
  await writeFile(`${target}.tmp`, `${clean(JSON.stringify(results, null, 2))}\n`);
  await rename(`${target}.tmp`, target);
}
async function stage(name) { results.step = name; console.log(`[${PHASE}] ${name}`); await save(); }
function check(name, pass, measured) {
  results.checks.push({ name, pass: !!pass, measured });
  console.log(`  ${pass ? 'PASS' : 'FAIL'} ${name}`);
  return !!pass;
}
async function waitEval(cdp, expression, name, timeout = 30_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const value = await evalOn(cdp, expression).catch(() => undefined);
    if (value) return value;
    await sleep(150);
  }
  throw new Error(`Timed out: ${name}`);
}
const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', chunk => { out += chunk; });
  child.stderr.on('data', chunk => { out += chunk; });
  child.once('error', reject);
  child.once('close', code => resolve({ code, out }));
});
const mustRun = async (command, args) => { const r = await run(command, args); if (r.code !== 0) throw new Error(`${command} failed: ${r.out.slice(-800)}`); };
async function makeFixture() {
  await mkdir(path.join(PROJECT, 'assets'), { recursive: true });
  await mkdir(path.join(PROJECT, '.akari'), { recursive: true });
  await mustRun(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30',
    '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(PROJECT, 'assets', 'clip.mp4')]);
  // 写真: 空色の背景に、はっきりした前景（赤い丸 + 黄色い四角）。背景を消す（この Mac で）の前景の検出が掴めるように
  await mustRun(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=#9fd3ee:s=1280x720', '-vf',
    "geq=r='if(lt(hypot(X-640,Y-380),230),220,if(between(X,560,720)*between(Y,120,200),250,160))':g='if(lt(hypot(X-640,Y-380),230),60,if(between(X,560,720)*between(Y,120,200),200,211))':b='if(lt(hypot(X-640,Y-380),230),50,if(between(X,560,720)*between(Y,120,200),40,238))'",
    '-frames:v', '1', path.join(PROJECT, 'assets', 'photo.png')]);
  await writeFile(path.join(PROJECT, '.akari', 'connections.json'), `${JSON.stringify({
    providers: [], defaults: { generate: { still: 'codex:image', video: 'fal:h3-i2v' } },
    policy: { currency: 'USD', monthly_budget: null, approval_threshold: null }, memory: []
  }, null, 2)}\n`);
  await writeFile(path.join(PROJECT, 'captions.json'), '{ "captions": [] }\n');
  await writeFile(path.join(PROJECT, 'edit.json'), `${JSON.stringify({
    version: 2, output: { width: 1920, height: 1080, fps: 30 },
    sources: [{ id: 'src-clip', path: 'assets/clip.mp4' }, { id: 'src-photo', path: 'assets/photo.png' }],
    tracks: [
      { id: 'visual-main', lane: 'visual', items: [
        { id: 'clip-video', at: 0, duration: 90, source: { kind: 'media', src: 'src-clip', in: 0, out: 3 } },
        { id: 'clip-photo', at: 90, duration: 90, source: { kind: 'media', src: 'src-photo', in: 0, out: 3 } }
      ] },
      { id: 'visual-photo', lane: 'visual', items: [
        { id: 'layer-photo', at: 0, duration: 180, transform: { x: 0, y: 0, scale: 0.6 }, source: { kind: 'media', src: 'src-photo', in: 0, out: 6 } }
      ] },
      { id: 'visual-shape', lane: 'visual', items: [
        { id: 'shape-1', at: 0, duration: 180, transform: { x: 620, y: -300 }, source: { kind: 'shape', shape: 'rect', params: { fill: '#ff3131', width: 360, height: 200 } } }
      ] }
    ],
    audio: { narration: [], sfx: [] }
  }, null, 2)}\n`);
}
const readEdit = async () => JSON.parse(await readFile(path.join(PROJECT, 'edit.json'), 'utf8'));
const itemOf = async id => (await readEdit()).tracks.flatMap(t => t.items ?? []).find(i => i.id === id);
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
    function reset(){clearTimeout(quiet);quiet=setTimeout(finish,500)}limit=setTimeout(finish,8000);reset()}) )()`);
}
async function pointOf(cdp, selector) {
  return waitEval(cdp, `(async()=>{const e=document.querySelector(${S(selector)});if(!e)return null;
    e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const b=e.getBoundingClientRect();if(!b.width||!b.height)return null;
    for(const f of [0.5,0.25,0.75,0.15,0.85]){const x=b.left+b.width*f,y=b.top+b.height/2;const hit=document.elementFromPoint(x,y);
      if(hit&&(hit===e||e.contains(hit)))return{x,y}}return null})()`, `click target ${selector}`);
}
async function clickUntil(cdp, selector, expectation, name) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await settle(cdp);
    await clearNotifications(cdp);
    try {
      const point = await pointOf(cdp, selector);
      await realClick(cdp, point.x, point.y);
      await waitEval(cdp, expectation, name, 8000);
      return;
    } catch (error) { if (attempt === 3) throw error; }
  }
}
async function shot(cdp, name, { clear = true, clipSelector = '[data-akari-ui="panel:inspector"]' } = {}) {
  if (clear) await clearNotifications(cdp);
  await sleep(300);
  const file = `${PHASE}-${name}.png`;
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(ROOT, file), Buffer.from(data, 'base64'));
  results.screenshots.push(file);
  if (clipSelector) {
    const box = await evalOn(cdp, `(()=>{const r=document.querySelector(${S(clipSelector)})?.getBoundingClientRect();return r&&r.width?{x:r.left,y:r.top,width:r.width,height:r.height}:null})()`);
    if (box) {
      const clipped = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { ...box, scale: 1 } });
      const clipFile = `${PHASE}-${name}-panel.png`;
      await writeFile(path.join(ROOT, clipFile), Buffer.from(clipped.data, 'base64'));
      results.screenshots.push(clipFile);
    }
  }
  await save();
}
// 編集パネルの今の状態
const inspect = `(()=>{const root=document.querySelector('[data-akari-ui="panel:inspector"]');
  const q=s=>root?.querySelector(s);const qa=s=>[...(root?.querySelectorAll(s)??[])];
  const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0};
  return{header:document.querySelector('[data-akari-ui="inspector-selection-header"]')?.textContent?.trim()??null,
    activeTab:qa('[data-akari-ui^="tab:inspector-"]').find(t=>t.classList.contains('is-active'))?.getAttribute('data-akari-ui')?.slice('tab:inspector-'.length)??null,
    sections:qa('[data-akari-ui^="section:inspector-"]').filter(vis).map(s=>({id:s.getAttribute('data-akari-ui').slice('section:inspector-'.length),
      title:(s.querySelector('.akari-inspector-section-toggle,.akari-inspector-section-header')?.textContent??'').trim(),
      open:!s.querySelector(':scope > .akari-inspector-section-body')?.hasAttribute('hidden'),
      fields:[...s.querySelectorAll('[data-akari-field]')].filter(vis).map(f=>f.getAttribute('data-akari-field'))})),
    aiTiles:qa('[data-akari-inspector-ai-tile]').map(t=>({id:t.getAttribute('data-akari-inspector-ai-tile'),disabled:t.getAttribute('aria-disabled')==='true',
      img:!!t.querySelector('img.akari-inspector-ai-image')?.getAttribute('src')?.startsWith('data:image/webp'),cloud:!!t.querySelector('.akari-inspector-cloud'),
      reason:t.querySelector('.akari-inspector-ai-reason')?.textContent?.trim()??null,title:t.querySelector('.akari-inspector-ai-title')?.textContent?.trim()??null})),
    tuneTiles:qa('[data-akari-home-tune]').map(t=>({id:t.getAttribute('data-akari-home-tune'),disabled:t.getAttribute('aria-disabled')==='true',
      img:!!t.querySelector('img')?.getAttribute('src')?.startsWith('data:image/webp'),imgSize:(()=>{const i=t.querySelector('img');if(!i)return null;const r=i.getBoundingClientRect();return[Math.round(r.width),Math.round(r.height)]})(),
      svg:!!t.querySelector('svg'),title:t.querySelector('.akari-inspector-ai-title')?.textContent?.trim()??null,box:(()=>{const r=t.getBoundingClientRect();return[Math.round(r.width),Math.round(r.height)]})()})),
    aiTileBox:(()=>{const t=q('[data-akari-inspector-ai-tile]');if(!t)return null;const r=t.getBoundingClientRect();return[Math.round(r.width),Math.round(r.height)]})(),
    panelTitle:q('.akari-inspector-ai-panel-title')?.textContent?.trim()??null,
    back:!!q('.akari-inspector-ai-back')}})()`;
const selectTimelineItem = async (cdp, selector, headerNeedle) => {
  await clickUntil(cdp, selector,
    `(document.querySelector('[data-akari-ui="inspector-selection-header"]')?.textContent??'').length>0`, `select ${selector}`);
  await settle(cdp);
  results.observations[`header:${selector}`] = await evalOn(cdp, `document.querySelector('[data-akari-ui="inspector-selection-header"]')?.textContent?.trim()??null`);
};
const tabActive = id => `(()=>{const t=document.querySelector('[data-akari-ui="tab:inspector-${id}"]');return !!t&&t.classList.contains('is-active')})()`;
const openTab = async (cdp, id) => {
  if (!await evalOn(cdp, tabActive(id))) await clickUntil(cdp, `[data-akari-ui="tab:inspector-${id}"]`, tabActive(id), `${id} tab`);
  await settle(cdp);
};
const scrollTo = (cdp, selector, block = 'start') => evalOn(cdp, `(()=>{const e=document.querySelector(${S(selector)});e?.scrollIntoView({block:${S(block)},behavior:'instant'});return !!e})()`);
const scrollTop = cdp => evalOn(cdp, `(()=>{const r=document.querySelector('[data-akari-ui="panel:inspector"]');r&&(r.scrollTop=0);r?.querySelectorAll('*').forEach(e=>{if(e.scrollTop)e.scrollTop=0});return true})()`);
const V2_PHOTO = '[data-akari-ui="panel:timeline"] [data-akari-item-id="layer-photo"]';
const SHAPE = '[data-akari-ui="panel:timeline"] [data-akari-item-id="shape-1"]';
const CUT_VIDEO = '[data-akari-ui="timeline:cut:0"]';
const CUT_PHOTO = '[data-akari-ui="timeline:cut:1"]';

let electron, cdp;
try {
  await stage('fixture');
  await stat(ELECTRON);
  await makeFixture();
  for (const name of ['akari-home', 'theia-config', 'user-data', 'home']) await mkdir(path.join(ISO, name));
  await stage('Electron');
  const env = { ...process.env, HOME: path.join(ISO, 'home'), AKARI_HOME: path.join(ISO, 'akari-home'), THEIA_CONFIG_DIR: path.join(ISO, 'theia-config') };
  for (const name of ['ELECTRON_RUN_AS_NODE', 'FAL_KEY', 'GROQ_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'XAI_API_KEY']) delete env[name];
  electron = spawn(ELECTRON, [SHELL, PROJECT, `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${path.join(ISO, 'user-data')}`, '--window-size=1800,1100', '--no-sandbox'], { cwd: REPO, env, stdio: 'ignore' });
  results.observations.electronPid = electron.pid;
  console.log(`[${PHASE}] electron pid ${electron.pid}`);
  const target = await (async () => { const until = Date.now() + 600_000; while (Date.now() < until) {
    const page = await listTargets(PORT).then(rows => rows.find(row => row.type === 'page')).catch(() => undefined);
    if (page) return page;
    await sleep(300);
  } throw new Error('CDP page missing'); })();
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await waitEval(cdp, `Boolean(window.theia?.container&&document.getElementById('theia-app-shell'))`, 'Theia', 1_200_000);
  const command = (id, a) => `(async()=>{const c=window.theia.container,d=c._bindingDictionary;
    const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');
    const r=await c.get(C).executeCommand(${S(id)}${a === undefined ? '' : `,${S(a)}`});try{return JSON.stringify(r??null)}catch{return String(r)}})()`;
  const exec = (id, a) => evalOn(cdp, command(id, a));
  if (!await evalOn(cdp, `Boolean(document.querySelector('[data-akari-ui="timeline:cut:0"]'))`)) await exec('akari.annotations.open');
  await waitEval(cdp, `Boolean(document.querySelector('[data-akari-ui="timeline:cut:1"]'))`, 'timeline', 900_000);
  await exec('akari.inspector.open').catch(() => undefined);
  await waitEval(cdp, `Boolean(document.querySelector('[data-akari-ui="panel:inspector"]'))`, 'inspector');
  await waitEval(cdp, `(()=>{const e=document.querySelector('.theia-preload');if(!e)return true;const s=getComputedStyle(e),r=e.getBoundingClientRect();
    return !(s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0&&r.width&&r.height)})()`, 'preload', 480_000);
  const editUri = pathToFileURL(path.join(PROJECT, 'edit.json')).toString();
  for (let attempt = 0; attempt < 6; attempt++) {
    const opened = await exec('akari.preview.ensureVisible', { editUri }).catch(() => undefined);
    if (opened && opened.includes('opened')) break;
    await sleep(3000);
  }
  await waitEval(cdp, `Boolean(document.querySelector('[data-akari-ui="preview-context-bar"]'))`, 'preview context bar', 120_000).catch(() => undefined);
  await sleep(1500);

  // ---- (i) 写真（V2 のレイヤー）のホーム ----
  await stage('(i) photo home');
  await selectTimelineItem(cdp, V2_PHOTO);
  await openTab(cdp, 'edit');
  await waitEval(cdp, `Boolean(document.querySelector('[data-akari-inspector-ai-tile], [data-akari-home-tune]'))`, 'home tiles', 60_000);
  await settle(cdp);
  await scrollTop(cdp);
  let state = await evalOn(cdp, inspect);
  results.observations.photoHome = state;
  const hasCorrection = s => s.sections.some(x => x.id === 'edit-correction');
  check(PHASE === 'before' ? '(i) BEFORE: 写真のホームの先頭に「補正」がある' : '(i) 写真のホームに「補正」（edit-correction）が無い',
    PHASE === 'before' ? hasCorrection(state) : !hasCorrection(state), state.sections.map(s => s.id));
  await shot(cdp, '01-photo-home');

  // ---- (ii) 補正を開いた状態 ----
  await stage('(ii) correction opened');
  if (hasCorrection(state)) {
    await clickUntil(cdp, '[data-akari-ui="section:inspector-edit-correction"] .akari-inspector-section-toggle',
      `!document.querySelector('[data-akari-ui="section:inspector-edit-correction"] > .akari-inspector-section-body')?.hasAttribute('hidden')`, 'open correction');
    await settle(cdp);
    await scrollTop(cdp);
    state = await evalOn(cdp, inspect);
    results.observations.correctionOpened = state.sections.find(s => s.id === 'edit-correction');
    results.observations.correctionOpenedAll = state.sections.map(s => ({ id: s.id, fields: s.fields.length }));
    await shot(cdp, '02-correction-open');
  } else {
    results.observations.correctionOpened = null;
    results.notes.push('(ii) 補正の節が無いので開けない（AFTER の期待どおり）');
  }

  // ---- (iii) 整えるのタイル ----
  await stage('(iii) tune tiles');
  await scrollTo(cdp, '[data-akari-ui="section:inspector-home-tune"]', 'center');
  state = await evalOn(cdp, inspect);
  results.observations.tuneTiles = state.tuneTiles;
  results.observations.aiTiles = state.aiTiles;
  results.observations.aiTileBox = state.aiTileBox;
  if (PHASE === 'after') {
    check('(iii) 整えるの 4 枚すべてに webp の絵（320×180 の比率）があり、線のアイコンが無い',
      state.tuneTiles.length === 4 && state.tuneTiles.every(t => t.img && !t.svg), state.tuneTiles);
    check('(iii) 整えるのタイルの大きさが作る / 直すのタイルと同じ',
      !!state.aiTileBox && state.tuneTiles.every(t => Math.abs(t.box[0] - state.aiTileBox[0]) <= 1 && Math.abs(t.box[1] - state.aiTileBox[1]) <= 2),
      { ai: state.aiTileBox, tune: state.tuneTiles.map(t => t.box) });
    const cutout = state.aiTiles.find(t => t.id === 'cutout'), eraser = state.aiTiles.find(t => t.id === 'eraser');
    check('(iii) 直すに「背景を消す」「消しゴム」: 写真では押せる・絵あり・☁ なし',
      !!cutout && !!eraser && !cutout.disabled && !eraser.disabled && cutout.img && eraser.img && !cutout.cloud && !eraser.cloud, { cutout, eraser });
  }
  await shot(cdp, '03-tune-tiles');

  // ---- (iv) 浮いたバーの近道 ----
  await stage('(iv) context bar shortcuts');
  const barItems = await evalOn(cdp, `[...document.querySelectorAll('[data-akari-ui="preview-context-bar"] [data-akari-bar-item]')].map(e=>e.getAttribute('data-akari-bar-item'))`);
  results.observations.barItems = barItems;
  const barDestinations = {};
  for (const key of ['cutout', 'border', 'eraser', 'photoRadius', 'crop', 'edit', 'photoColor']) {
    if (!barItems.includes(key)) { barDestinations[key] = { missing: true }; continue; }
    // 毎回ホームの一覧に戻してから押す（前の行き先の続きで判定しない）
    await openTab(cdp, 'edit');
    const back = await evalOn(cdp, `Boolean(document.querySelector('[data-akari-ui="panel:inspector"] .akari-inspector-ai-back'))`);
    if (back) await clickUntil(cdp, '[data-akari-ui="panel:inspector"] .akari-inspector-ai-back', `!document.querySelector('[data-akari-ui="panel:inspector"] .akari-inspector-ai-back')`, 'back home');
    await settle(cdp);
    const p = await pointOf(cdp, `[data-akari-ui="preview-context-bar"] [data-akari-bar-item="${key}"]`);
    await realClick(cdp, p.x, p.y);
    await sleep(800);
    await settle(cdp);
    const s = await evalOn(cdp, inspect);
    const focused = await evalOn(cdp, `(()=>{const e=document.activeElement;return{field:e?.closest?.('[data-akari-field]')?.getAttribute('data-akari-field')??null,
      section:e?.closest?.('[data-akari-ui^="section:inspector-"]')?.getAttribute('data-akari-ui')??null,
      highlighted:[...document.querySelectorAll('[data-akari-ui="panel:inspector"] [data-akari-field]')].filter(f=>/flash|highlight|reveal|focus/i.test(String(f.className))).map(f=>f.getAttribute('data-akari-field'))}})()`);
    barDestinations[key] = { activeTab: s.activeTab, panelTitle: s.panelTitle, sections: s.sections.map(x => x.id), openSections: s.sections.filter(x => x.open).map(x => x.id), focused,
      photoDialog: await evalOn(cdp, `(()=>{const d=document.getElementById('akari-photo-edit-panel');return d instanceof HTMLDialogElement&&d.open?d.querySelector('h2')?.textContent??'open':null})()`) };
    if (key === 'cutout' || key === 'border') await shot(cdp, `04-bar-${key}`, { clipSelector: null });
    await evalOn(cdp, `(()=>{const d=document.getElementById('akari-photo-edit-panel');if(d instanceof HTMLDialogElement&&d.open)d.close();return true})()`);
  }
  results.observations.barDestinations = barDestinations;
  if (PHASE === 'after') {
    const d = barDestinations;
    check('(iv) 背景透過 → ホームの「背景を消す」の専用パネル', d.cutout?.activeTab === 'edit' && d.cutout?.panelTitle === '背景を消す' && d.cutout?.sections.includes('photo-cutout'), d.cutout);
    check('(iv) 消しゴム → ホームの「消しゴム」の専用パネル', d.eraser?.activeTab === 'edit' && d.eraser?.panelTitle === '消しゴム' && d.eraser?.sections.includes('photo-eraser'), d.eraser);
    for (const key of ['border', 'photoRadius', 'crop']) {
      check(`(iv) ${key} → 映像タブの外観`, d[key]?.activeTab === 'video' && d[key]?.openSections.includes('appearance'), d[key]);
    }
    check('(iv) 編集 → ホーム（タイル一覧）', d.edit?.activeTab === 'edit' && !d.edit?.panelTitle && !d.edit?.sections.includes('edit-correction'), d.edit);
    check('(iv) 写真の色 → 色タブ', d.photoColor?.activeTab === 'adjust', d.photoColor);
  }

  if (PHASE === 'after') {
    // ---- 背景を消すの専用パネル → 効くこと ----
    await stage('cutout panel');
    await openTab(cdp, 'edit');
    if (await evalOn(cdp, `Boolean(document.querySelector('[data-akari-ui="panel:inspector"] .akari-inspector-ai-back'))`)) {
      await clickUntil(cdp, '[data-akari-ui="panel:inspector"] .akari-inspector-ai-back', `!document.querySelector('[data-akari-ui="panel:inspector"] .akari-inspector-ai-back')`, 'back home');
    }
    await clickUntil(cdp, '[data-akari-inspector-ai-tile="cutout"]', `(document.querySelector('.akari-inspector-ai-panel-title')?.textContent??'').includes('背景を消す')`, 'cutout panel');
    await settle(cdp);
    state = await evalOn(cdp, inspect);
    results.observations.cutoutPanel = state;
    check('背景を消すの専用パネル: ← ホーム + 背景透過・マスクの欄', state.back && state.sections.some(s => s.id === 'photo-cutout'
      && s.fields.includes('photo-cutout-panel') && s.fields.includes('photo-mask-generate')), state.sections);
    await shot(cdp, '05-cutout-panel');
    const before = await itemOf('layer-photo');
    await clickUntil(cdp, '[data-akari-field="photo-mask-generate"] button', 'true', 'mask generate');
    { const until = Date.now() + 120_000; while (Date.now() < until && !(await itemOf('layer-photo'))?.mask) await sleep(500); }
    const after = await itemOf('layer-photo');
    results.observations.cutoutEffect = { before: before?.mask ?? null, after: after?.mask ?? null };
    check('背景を消す（この Mac で）を専用パネルから押すと写真にマスクが付く（edit.json の mask）', !before?.mask && !!after?.mask, results.observations.cutoutEffect);
    await sleep(2500);
    await shot(cdp, '06-cutout-effect', { clipSelector: null });

    // ---- 消しゴムの専用パネル → 効くこと ----
    await stage('eraser panel');
    // マスクを外して元の写真に戻してから消しゴム（効き目を見やすく）
    await clickUntil(cdp, '[data-akari-field="photo-mask-remove"] button', 'true', 'mask remove').catch(() => undefined);
    { const until = Date.now() + 20_000; while (Date.now() < until && (await itemOf('layer-photo'))?.mask) await sleep(300); }
    await clickUntil(cdp, '[data-akari-ui="panel:inspector"] .akari-inspector-ai-back', `!document.querySelector('[data-akari-ui="panel:inspector"] .akari-inspector-ai-back')`, 'back home');
    await clickUntil(cdp, '[data-akari-inspector-ai-tile="eraser"]', `(document.querySelector('.akari-inspector-ai-panel-title')?.textContent??'').includes('消しゴム')`, 'eraser panel');
    await settle(cdp);
    state = await evalOn(cdp, inspect);
    results.observations.eraserPanel = state;
    check('消しゴムの専用パネル: ← ホーム + 消す/戻す・大きさ・硬さ・消しゴム', state.back && state.sections.some(s => s.id === 'photo-eraser'
      && ['photo-brush-mode', 'photo-brush-size', 'photo-brush-hardness', 'photo-brush-start'].every(f => s.fields.includes(f))), state.sections);
    await shot(cdp, '07-eraser-panel');
    const eraseBefore = (await itemOf('layer-photo'))?.erase ?? null;
    await clickUntil(cdp, '[data-akari-field="photo-brush-start"] button', `document.querySelector('[data-akari-ui="action:inspector-photo-brush-start"]')?.getAttribute('aria-pressed')==='true'`, 'brush start');
    await sleep(1200);
    // プレビューの写真の中央を横切ってなぞる
    const pv = await evalOn(cdp, `(()=>{const f=[...document.querySelectorAll('iframe,webview')].map(e=>e.getBoundingClientRect()).filter(r=>r.width>300&&r.height>200).sort((a,b)=>b.width*b.height-a.width*a.height)[0];
      return f?{x:f.left,y:f.top,w:f.width,h:f.height}:null})()`);
    results.observations.previewBox = pv;
    if (pv) {
      // 出力 16:9 の中の画面の位置: 中央付近を左右に
      const cy = pv.y + pv.h * 0.5, x0 = pv.x + pv.w * 0.38, x1 = pv.x + pv.w * 0.62;
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y: cy, button: 'none' });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: cy, button: 'left', buttons: 1, clickCount: 1 });
      for (let step = 1; step <= 16; step++) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + (x1 - x0) * step / 16, y: cy + Math.sin(step / 2) * 20, button: 'left', buttons: 1 });
        await sleep(40);
      }
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: cy, button: 'left', buttons: 0, clickCount: 1 });
    }
    { const until = Date.now() + 20_000; while (Date.now() < until && S((await itemOf('layer-photo'))?.erase ?? null) === S(eraseBefore)) await sleep(300); }
    const eraseAfter = (await itemOf('layer-photo'))?.erase ?? null;
    results.observations.eraserEffect = { before: eraseBefore, afterStrokes: Array.isArray(eraseAfter?.strokes) ? eraseAfter.strokes.length : eraseAfter };
    check('消しゴムを専用パネルから入れてプレビューをなぞると写真に消した跡が付く（edit.json の erase）', S(eraseAfter) !== S(eraseBefore) && !!eraseAfter, results.observations.eraserEffect);
    await sleep(1500);
    await shot(cdp, '08-eraser-effect', { clipSelector: null });
    await evalOn(cdp, `(()=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return true})()`);
    if (await evalOn(cdp, `document.querySelector('[data-akari-ui="action:inspector-photo-brush-start"]')?.getAttribute('aria-pressed')==='true'`)) {
      await clickUntil(cdp, '[data-akari-field="photo-brush-start"] button', `document.querySelector('[data-akari-ui="action:inspector-photo-brush-start"]')?.getAttribute('aria-pressed')!=='true'`, 'brush stop').catch(() => undefined);
    }

    // ---- 色タブの範囲の選択 ----
    await stage('color tab scope');
    await openTab(cdp, 'adjust');
    await scrollTop(cdp);
    state = await evalOn(cdp, inspect);
    results.observations.colorTab = state.sections.map(s => ({ id: s.id, fields: s.fields }));
    check('色タブの一番上に「範囲」（対象: 画像全体 / 選択エリア）', state.sections[0]?.id === 'adjust-scope' && state.sections[0]?.fields.includes('edit-adjust-scope'), results.observations.colorTab.slice(0, 3));
    await shot(cdp, '09-color-scope');
    await evalOn(cdp, `(()=>{const s=document.querySelector('[data-akari-field="edit-adjust-scope"] select');if(!s)return false;s.value='選択エリア';s.dispatchEvent(new Event('change',{bubbles:true}));s.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
    await sleep(800); await settle(cdp);
    state = await evalOn(cdp, inspect);
    results.observations.colorTabRegion = state.sections.map(s => ({ id: s.id, fields: s.fields }));
    check('色タブで「選択エリア」にすると「エリアを選択」の欄が出る', state.sections[0]?.fields.includes('photo-region-panel'), results.observations.colorTabRegion.slice(0, 2));
    await shot(cdp, '10-color-scope-region');
    await evalOn(cdp, `(()=>{const s=document.querySelector('[data-akari-field="edit-adjust-scope"] select');if(!s)return false;s.value='画像全体';s.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
    await sleep(500);

    // ---- 映像タブの外観の写真の欄 ----
    await stage('video tab appearance');
    await openTab(cdp, 'video');
    await scrollTo(cdp, '[data-akari-ui="section:inspector-appearance"]', 'start');
    await settle(cdp);
    state = await evalOn(cdp, inspect);
    const appearance = state.sections.find(s => s.id === 'appearance');
    results.observations.videoAppearance = appearance;
    check('映像タブの外観に切り抜き・枠線・角の丸み（写真のレイヤー）', !!appearance && ['photo-crop-open', 'photo-frame-width', 'photo-frame-radius'].every(f => appearance.fields.includes(f)), appearance);
    await shot(cdp, '11-video-appearance-photo');

    // V1 のカットの写真: 外観の欄とホーム
    await stage('V1 cut photo');
    await selectTimelineItem(cdp, CUT_PHOTO);
    await openTab(cdp, 'video');
    await scrollTo(cdp, '[data-akari-ui="section:inspector-appearance"]', 'start');
    await settle(cdp);
    state = await evalOn(cdp, inspect);
    results.observations.cutAppearance = state.sections.find(s => s.id === 'appearance');
    check('V1 の写真（カット）も外観に切り抜き・枠線・角の丸み', ['photo-crop-open', 'photo-frame-width', 'photo-frame-radius'].every(f => results.observations.cutAppearance?.fields.includes(f)), results.observations.cutAppearance);
    await shot(cdp, '12-cut-photo-appearance');
  }

  // ---- 写真でないもの（動画・図形）・V1 の写真のホーム ----
  await stage('video / shape / cut-photo home');
  for (const [name, selector] of [['13-video-home', CUT_VIDEO], ['14-shape-home', SHAPE], ['15-cut-photo-home', CUT_PHOTO]]) {
    await selectTimelineItem(cdp, selector);
    await openTab(cdp, 'edit');
    if (await evalOn(cdp, `Boolean(document.querySelector('[data-akari-ui="panel:inspector"] .akari-inspector-ai-back'))`)) {
      await clickUntil(cdp, '[data-akari-ui="panel:inspector"] .akari-inspector-ai-back', `!document.querySelector('[data-akari-ui="panel:inspector"] .akari-inspector-ai-back')`, 'back home');
    }
    await sleep(800); await settle(cdp); await scrollTop(cdp);
    state = await evalOn(cdp, inspect);
    results.observations[name] = { header: state.header, sections: state.sections.map(s => s.id), aiTiles: state.aiTiles, tuneTiles: state.tuneTiles.map(t => ({ id: t.id, img: t.img, disabled: t.disabled })) };
    if (PHASE === 'after') {
      check(`${name}: ホームに「補正」が無い`, !hasCorrection(state), state.sections.map(s => s.id));
      if (name === '13-video-home') {
        const cutout = state.aiTiles.find(t => t.id === 'cutout');
        check('13 動画: 「背景を消す」はグレー + 理由', !!cutout && cutout.disabled && !!cutout.reason, cutout);
      }
    } else {
      results.notes.push(`${name}: 補正 ${hasCorrection(state) ? 'あり' : 'なし'}`);
    }
    await shot(cdp, name);
  }
  results.status = results.checks.every(c => c.pass) ? 'PASS' : 'FAIL';
  await save();
} catch (error) {
  results.status = 'ERROR';
  results.notes.push(clean(error instanceof Error ? error.stack ?? error.message : String(error)));
  await save();
  console.error(error);
  if (cdp) await shot(cdp, 'error', { clipSelector: null }).catch(() => undefined);
} finally {
  cdp?.close();
  if (electron?.pid) { try { process.kill(electron.pid); } catch { /* already gone */ } }
  await sleep(1500);
  if (!process.argv.includes('--keep-tmp')) await rm(ISO, { recursive: true, force: true }).catch(() => undefined);
  console.log(`[${PHASE}] ${results.status}`);
}
