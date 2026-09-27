#!/usr/bin/env node
// 手順 0（BEFORE）/ 手順 3（AFTER）: 生成まわりの仕上げ B を実機で撮る。
//   node l1.mjs --phase=before|after [--port=9644] [--repo=<ビルド済みのリポ>] [--keep-tmp]
// 一時ディレクトリにプロジェクト（V1 = 動画 0〜3 秒 + すき間 + 写真 5〜7 秒）を作り、開発ビルドの Electron を
// 隔離した HOME / AKARI_HOME / THEIA_CONFIG_DIR / userData で起動して CDP で操作する。
// 画像生成の CLI は scripts/stub-bin/ のスタブ（手段ごとの寸法・待ち時間で PNG を書くだけ）。有償 API は呼ばない。
//  5) V1 の上に描いた枠（V2 のレイヤー）のタイムラインの札・オーロラ: 空の枠 / 3 手段の同時生成中 1/3 / 候補 3
//  1) 専用パネルを開いたまま完了 → 切りそろえの 1 行がパネルの中（候補・結果の横）に出るか（3 手段 / 1 手段）
//  2) 設定 › AI モデル › 比べる: 「入力: 指示文」の値（静止画・動画・声・文字起こし）
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
const BIN = path.join(SCRIPTS, 'stub-bin');
const PORT = Number(arg('port') ?? 9644);
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const ISO = await realpath(await mkdtemp(path.join(os.tmpdir(), `akari-l1-${PHASE}-`)));
const PROJECT = path.join(ISO, 'project');
const STUB_LOG = path.join(ISO, 'stub-log.jsonl');
const STUB_PLAN = path.join(ISO, 'stub-plan.json');
const S = JSON.stringify;
const results = { phase: PHASE, status: 'running', step: '', checks: [], observations: {}, screenshots: [], notes: [] };
const WORKTREE = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const clean = value => String(value).replaceAll(REPO, '<REPO>').replaceAll(WORKTREE, '<REPO>').replaceAll(ISO, '<TMP>').replaceAll(os.homedir(), '<HOME>')
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
  await mustRun(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=#2a9d8f:s=1920x1080',
    '-frames:v', '1', path.join(PROJECT, 'assets', 'photo.png')]);
  await writeFile(path.join(PROJECT, '.akari', 'connections.json'), `${JSON.stringify({
    providers: [], defaults: { generate: { still: 'codex:image', video: 'fal:h3-i2v' } },
    policy: { currency: 'USD', monthly_budget: null, approval_threshold: null }, memory: []
  }, null, 2)}\n`);
  await writeFile(path.join(PROJECT, 'captions.json'), '{ "captions": [] }\n');
  await writeFile(path.join(PROJECT, 'edit.json'), `${JSON.stringify({
    version: 2, output: { width: 1920, height: 1080, fps: 30 },
    sources: [{ id: 'src-clip', path: 'assets/clip.mp4' }, { id: 'src-photo', path: 'assets/photo.png' }],
    tracks: [{ id: 'visual-main', lane: 'visual', items: [
      { id: 'clip-video', at: 0, duration: 90, source: { kind: 'media', src: 'src-clip', in: 0, out: 3 } },
      { id: 'clip-photo', at: 150, duration: 60, source: { kind: 'media', src: 'src-photo', in: 0, out: 2 } }
    ] }],
    audio: { narration: [], sfx: [] }
  }, null, 2)}\n`);
}
const readEdit = async () => JSON.parse(await readFile(path.join(PROJECT, 'edit.json'), 'utf8'));
const allItems = doc => doc.tracks.flatMap(track => (track.items ?? []).map(item => ({ ...item, trackId: track.id, lane: track.lane })));
const frameItems = async () => allItems(await readEdit()).filter(row => String(row.id).startsWith('frame-'));
const stubLog = async () => (await readFile(STUB_LOG, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => JSON.parse(line));
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
async function shot(cdp, name, { clear = true, clipSelector } = {}) {
  if (clear) await clearNotifications(cdp);
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
// タイムラインの枠（V2 のレイヤー）の札・オーロラ
const layerChip = id => `(()=>{const els=[...document.querySelectorAll('[data-akari-ui="panel:timeline"] [data-akari-item-id=${S(id)}]')];
  return els.map(e=>{const r=e.getBoundingClientRect();return{cls:String(e.className).split(/\\s+/).filter(c=>c.startsWith('akari-annotations-strip')||c.startsWith('akari-generation')),
    kind:e.dataset.akariItemKind??null,state:e.dataset.akariGenerationState??null,
    badge:e.querySelector('.akari-generation-badge-label')?.textContent?.trim()??e.querySelector('[data-akari-generation-badge]')?.textContent?.trim()??null,
    aurora:!!e.querySelector(':scope > .akari-generation-aurora-layer'),
    auroraAnimation:(()=>{const a=e.querySelector(':scope > .akari-generation-aurora-layer');if(!a)return null;const s=getComputedStyle(a),b=getComputedStyle(a,'::before');return{opacity:s.opacity,animation:s.animationName,beforeAnimation:b.animationName}})(),
    progress:e.querySelector(':scope > [data-akari-generation-progress]')?.className??null,
    spinner:(()=>{const b=e.querySelector('[data-akari-generation-badge]');if(!b)return null;const s=getComputedStyle(b,'::before');return{content:s.content,animation:s.animationName}})(),
    visible:r.width>0&&r.height>0}}).filter(x=>x.visible)})()`;
// V1 の cut（比べる相手）の札
const cutChip = `(()=>[...document.querySelectorAll('[data-akari-ui="panel:timeline"] [data-akari-generation-state]')].filter(e=>e.getBoundingClientRect().width>0)
  .map(e=>({id:e.dataset.akariItemId??null,kind:e.dataset.akariItemKind??null,state:e.dataset.akariGenerationState,badge:e.querySelector('.akari-generation-badge-label')?.textContent?.trim()??null,
    aurora:!!e.querySelector(':scope > .akari-generation-aurora-layer')})))()`;
// 静止画の専用パネルの今の状態（切りそろえの 1 行がどこに出ているか）
const inspectStill = `(()=>{const root=document.querySelector('[data-akari-ui="panel:inspector"]');
  const q=s=>root?.querySelector(s);const qa=s=>[...(root?.querySelectorAll(s)??[])];
  const panel=q('.akari-inspector-ai-still-panel');
  const cropLines=[...(root?.querySelectorAll('*')??[])].filter(e=>e.children.length===0&&/切りそろえ(ました|済)/u.test(e.textContent??''))
    .map(e=>({text:e.textContent.trim(),inStillPanel:!!e.closest('.akari-inspector-ai-still-panel'),
      candidate:e.closest('[data-akari-inspector-ai-candidate]')?.getAttribute('data-akari-inspector-ai-candidate')??null,
      progressRoute:e.closest('[data-akari-inspector-ai-progress-route]')?.getAttribute('data-akari-inspector-ai-progress-route')??null,
      attrs:[...e.attributes].map(a=>a.name).filter(n=>n.startsWith('data-')),cls:String(e.className)}));
  return{stillPanel:!!panel,
    routes:qa('[data-akari-inspector-ai-route]').map(e=>({id:e.getAttribute('data-akari-inspector-ai-route'),checked:!!e.querySelector('input')?.checked,
      disabled:!!e.querySelector('input')?.disabled,state:e.querySelector('[data-akari-inspector-ai-route-state]')?.getAttribute('data-akari-inspector-ai-route-state')??null})),
    create:q('[data-akari-inspector-ai-create="true"]')?.textContent?.trim()??null,
    progress:q('[data-akari-inspector-ai-progress]')?.getAttribute('data-akari-inspector-ai-progress')??null,
    progressRows:qa('[data-akari-inspector-ai-progress-route]').map(e=>({route:e.getAttribute('data-akari-inspector-ai-progress-route'),state:e.getAttribute('data-akari-inspector-ai-progress-state'),text:e.textContent.trim()})),
    candidates:qa('[data-akari-inspector-ai-candidate]').map(e=>({path:e.getAttribute('data-akari-inspector-ai-candidate'),text:e.textContent.trim()})),
    cropLines,
    cropped:q('[data-akari-inspector-ai-cropped]')?.textContent?.trim()??null,
    estimateTexts:qa('.akari-inspector-ai-still-panel *').filter(e=>e.children.length===0&&/\\$\\d/u.test(e.textContent??'')).map(e=>e.textContent.trim()),
    header:document.querySelector('[data-akari-ui="inspector-selection-header"]')?.textContent?.trim()??null,
    homeNotices:qa('.akari-inspector-home *, [data-akari-inspector-home] *').filter(e=>e.children.length===0&&/切りそろえ/u.test(e.textContent??'')).map(e=>e.textContent.trim())}})()`;

let electron, cdp;
try {
  await stage('fixture');
  await stat(ELECTRON);
  await makeFixture();
  // codex は 3 秒で正方形（9:16 を頼むので切りそろえ）、grok は 12 秒、Antigravity は 20 秒
  await writeFile(STUB_PLAN, S({ codex: { size: '1254x1254', delayMs: 3000 }, grok: { size: '720x1280', delayMs: 12000 }, agy: { size: '1254x1254', delayMs: 20000 } }));
  for (const name of ['akari-home', 'theia-config', 'user-data', 'home']) await mkdir(path.join(ISO, name));
  await stage('Electron');
  const env = { ...process.env, HOME: path.join(ISO, 'home'), AKARI_HOME: path.join(ISO, 'akari-home'), THEIA_CONFIG_DIR: path.join(ISO, 'theia-config'),
    PATH: `${BIN}${path.delimiter}${process.env.PATH}`, AKARI_CODEX_BIN: path.join(BIN, 'codex'), AKARI_AGY_BIN: path.join(BIN, 'agy'),
    AKARI_GROK_BIN: path.join(BIN, 'grok'), STUB_LOG, STUB_PLAN_FILE: STUB_PLAN };
  for (const name of ['ELECTRON_RUN_AS_NODE', 'FAL_KEY', 'GROQ_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'XAI_API_KEY']) delete env[name];
  electron = spawn(ELECTRON, [SHELL, PROJECT, `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${path.join(ISO, 'user-data')}`, '--window-size=1800,1000', '--no-sandbox'], { cwd: REPO, env, stdio: 'ignore' });
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

  // ---- 5) V1 の上に枠を描く（V2 のレイヤー） ----
  await stage('draw an empty frame above V1');
  let created;
  for (let attempt = 1; attempt <= 3 && !created; attempt++) {
    await exec('akari.timeline.setTool', { tool: 'frame' });
    await waitEval(cdp, `document.querySelector('button[aria-label="仮枠ツール"]')?.getAttribute('aria-pressed')==='true'`, 'frame tool');
    await settle(cdp);
    await clearNotifications(cdp);
    // V1 の動画の頭から写真の終わりまで（0〜7 秒）V1 の上に描く。札の文言が切れずに読める幅にする
    const g = await evalOn(cdp, `(()=>{const b=document.querySelector('[data-akari-ui="timeline:cut:0"]').getBoundingClientRect();const e=document.querySelector('[data-akari-ui="timeline:cut:1"]').getBoundingClientRect();return{left:b.left,right:e.right,top:b.top}})()`);
    const from = { x: g.left + 8, y: g.top - 14 }, to = { x: g.right - 8, y: g.top - 14 };
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none' });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
    for (let step = 1; step <= 10; step++) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + (to.x - from.x) * step / 10, y: from.y, button: 'left', buttons: 1 });
      await sleep(60);
    }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 });
    const until = Date.now() + 30_000;
    while (Date.now() < until && !(created = (await frameItems())[0])) await sleep(200);
  }
  if (!created) throw new Error('empty frame was not written to edit.json');
  await exec('akari.timeline.setTool', { tool: 'select' });
  const FRAME = created.id;
  const doc = await readEdit();
  results.observations.frame = { id: FRAME, track: created.trackId, lane: created.lane, tracks: doc.tracks.map(t => ({ id: t.id, lane: t.lane, items: (t.items ?? []).map(i => i.id) })) };
  check('枠は V1 とは別のトラック（V2 のレイヤー）に書かれる', created.trackId !== 'visual-main', results.observations.frame);
  await settle(cdp);
  await sleep(1000);
  let chip = await evalOn(cdp, layerChip(FRAME));
  results.observations.emptyLayerChip = chip;
  const layerEl = c => c.find(x => x.kind === 'layer') ?? c[0];
  check('(i) 空の枠（V2 のレイヤー）の札 = 淡いオーロラ（planned・オーロラの層あり）', layerEl(chip)?.state === 'planned' && layerEl(chip)?.aurora, chip);
  await shot(cdp, '05i-layer-empty-aurora', { clipSelector: '[data-akari-ui="panel:timeline"]' });

  // ---- 静止画の専用パネルを開く ----
  const selectFrame = async () => {
    if (await evalOn(cdp, `(document.querySelector('[data-akari-ui="inspector-selection-header"]')?.textContent??'').includes('frame-')`)) return;
    await clickUntil(cdp, `[data-akari-ui="panel:timeline"] [data-akari-item-id="${FRAME}"]`,
      `(document.querySelector('[data-akari-ui="inspector-selection-header"]')?.textContent??'').length>0`, 'select frame');
  };
  await waitEval(cdp, `(document.querySelector('[data-akari-ui="inspector-selection-header"]')?.textContent??'').includes('frame-')`, 'frame selected', 15_000)
    .catch(() => selectFrame());
  const openStillPanel = async () => {
    const tabActive = `(()=>{const t=document.querySelector('[data-akari-ui="tab:inspector-edit"]');return !!t&&(t.classList.contains('is-active')||t.getAttribute('aria-selected')==='true')})()`;
    if (await evalOn(cdp, `Boolean(document.querySelector('[data-akari-inspector-ai-create="true"]'))`)) return;
    if (!await evalOn(cdp, tabActive)) await clickUntil(cdp, '[data-akari-ui="tab:inspector-edit"]', tabActive, 'edit tab');
    if (!await evalOn(cdp, `Boolean(document.querySelector('[data-akari-inspector-ai-create="true"]'))`)) {
      await waitEval(cdp, `Boolean(document.querySelector('[data-akari-inspector-ai-tile="still"]'))`, 'still tile', 60_000);
      await clickUntil(cdp, '[data-akari-inspector-ai-tile="still"]', `Boolean(document.querySelector('[data-akari-inspector-ai-create="true"]'))`, 'still panel');
    }
    await settle(cdp);
  };
  await stage('open the still panel');
  await openStillPanel();
  await waitEval(cdp, `[...document.querySelectorAll('[data-akari-inspector-ai-route-state]')].every(e=>e.getAttribute('data-akari-inspector-ai-route-state')!=='checking')`, 'route probe', 60_000).catch(() => undefined);
  let panel = await evalOn(cdp, inspectStill);
  results.observations.panelOpened = panel;
  await clickUntil(cdp, '[data-akari-inspector-ai-aspect="9:16"]', `document.querySelector('[data-akari-inspector-ai-aspect="9:16"]')?.getAttribute('aria-pressed')==='true'`, 'aspect 9:16');
  // fal（使った分だけ）は外し、追加料金なしの 3 手段だけにする
  const setRoute = async (id, on) => {
    const now = await evalOn(cdp, `document.querySelector('[data-akari-inspector-ai-route="${id}"] input')?.checked??null`);
    if (now === null || now === on) return;
    await clickUntil(cdp, `[data-akari-inspector-ai-route="${id}"] input`, `document.querySelector('[data-akari-inspector-ai-route="${id}"] input')?.checked===${on}`, `route ${id} ${on}`);
  };
  await setRoute('fal', false);
  for (const id of ['codex', 'grok', 'antigravity']) await setRoute(id, true);
  const typePrompt = async text => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const p = await pointOf(cdp, '[data-akari-inspector-ai-prompt="true"]');
      await realClick(cdp, p.x, p.y);
      await evalOn(cdp, `(()=>{const t=document.querySelector('[data-akari-inspector-ai-prompt="true"]');t.select();return true})()`);
      await cdp.send('Input.insertText', { text });
      await settle(cdp);
      const value = await evalOn(cdp, `document.querySelector('[data-akari-inspector-ai-prompt="true"]')?.value??''`);
      results.observations.promptTyping = [...(results.observations.promptTyping ?? []), { attempt, kept: value === text }];
      if (value === text) return;
    }
    throw new Error('prompt text was not kept');
  };
  await typePrompt('夕焼けの海辺に立つ猫');
  panel = await evalOn(cdp, inspectStill);
  results.observations.beforeRun = panel;
  check('追加料金なしの 3 手段（ChatGPT・Grok・Antigravity）が選ばれている', ['codex', 'grok', 'antigravity'].every(id => panel.routes.find(r => r.id === id)?.checked)
    && !panel.routes.find(r => r.id === 'fal')?.checked, panel.routes);

  // ---- (ii) 3 手段の同時生成中 ----
  await stage('(ii) three routes running');
  await waitEval(cdp, `document.querySelector('[data-akari-inspector-ai-create="true"]')?.disabled===false`, 'create enabled', 60_000);
  const createPoint = await pointOf(cdp, '[data-akari-inspector-ai-create="true"]');
  await realClick(cdp, createPoint.x, createPoint.y);
  const badgeOf = async () => layerEl(await evalOn(cdp, layerChip(FRAME)) ?? [])?.badge ?? '';
  const waitBadge = async (re, name, timeout) => {
    const until = Date.now() + timeout; let last = '';
    while (Date.now() < until) { last = await badgeOf().catch(() => ''); if (re.test(last)) return last; await sleep(150); }
    results.observations[`timeout-${name}`] = { last, chip: await evalOn(cdp, layerChip(FRAME)).catch(() => null), cuts: await evalOn(cdp, cutChip).catch(() => null) };
    return null;
  };
  const running0 = await waitBadge(/3 案作成中/u, 'running', 6000);
  results.observations.runningStart = { badge: running0, chip: await evalOn(cdp, layerChip(FRAME)), panel: await evalOn(cdp, inspectStill) };
  const running1 = await waitBadge(/3 案作成中 · 1\/3/u, 'running-1-of-3', 11000);
  chip = await evalOn(cdp, layerChip(FRAME));
  results.observations.running1of3 = { badge: running1, chip, panel: await evalOn(cdp, inspectStill), cuts: await evalOn(cdp, cutChip) };
  const el = layerEl(chip);
  check('(ii) 生成中の枠（V2 のレイヤー）: generating・流れるオーロラ・くるくる（進み具合の帯）', el?.state === 'generating' && el?.aurora && !!el?.progress, el);
  check('(ii) 札「3 案作成中 · 1/3」', /3 案作成中 · 1\/3/u.test(el?.badge ?? ''), { badge: el?.badge });
  await shot(cdp, '05ii-layer-running-1-of-3', { clipSelector: '[data-akari-ui="panel:timeline"]' });
  // 経過秒の更新（札が 1 秒ごとに書き換わるか）
  // 「N 案作成中 · k/N」は秒を出さない文言（V1 の cut と同じ）。経過秒の更新の仕掛け（1 秒ごとのタイマー）がレイヤーにも付いているかを V1 と同じ条件で見る
  const timer = await evalOn(cdp, `(()=>{const e=[...document.querySelectorAll('[data-akari-ui="panel:timeline"] [data-akari-item-id=${S(FRAME)}]')].find(x=>x.dataset.akariItemKind==='layer');
    return{timer:e?.dataset.akariGenerationElapsedTimer??null,state:e?.dataset.akariGenerationState??null}})()`);
  results.observations.elapsedTimer = timer;
  check('(ii) 生成中のレイヤーに経過秒の更新のタイマーが付く（applyGenerationChip の経路）', timer.state === 'generating' && !!timer.timer, timer);

  // ---- (iii) 候補 3 ----
  await stage('(iii) candidates');
  const done = await waitBadge(/候補 3/u, 'candidates', 60_000);
  await settle(cdp);
  chip = await evalOn(cdp, layerChip(FRAME));
  panel = await evalOn(cdp, inspectStill);
  results.observations.candidates = { badge: done, chip, panel, stub: (await stubLog()).filter(r => r.wrote).map(r => ({ route: r.route, wrote: { width: r.wrote.width, height: r.wrote.height, delayMs: r.wrote.delayMs } })) };
  check('(iii) 札「候補 3」', /候補 3/u.test(layerEl(chip)?.badge ?? ''), layerEl(chip));
  await shot(cdp, '05iii-layer-candidates-3', { clipSelector: '[data-akari-ui="panel:timeline"]' });

  // ---- 1) 切りそろえの 1 行が専用パネルの中に出る（3 手段） ----
  await stage('1) crop line inside the still panel (three routes)');
  check('1) 完了後も静止画の専用パネルが開いたまま', panel.stillPanel, { stillPanel: panel.stillPanel, header: panel.header });
  const codexLine = panel.cropLines.find(l => l.inStillPanel && /切りそろえました/u.test(l.text));
  check('1) 専用パネルの中の ChatGPT の候補の横に「9:16 を頼んで正方形 → 切りそろえました」（「頼んで」と「正方形」の間に空白なし）',
    !!codexLine && codexLine.text.includes('9:16 を頼んで正方形 → 切りそろえました') && (codexLine.candidate?.includes('codex') || codexLine.progressRoute === 'codex' || /ChatGPT|Codex/u.test(codexLine.text)),
    panel.cropLines);
  await evalOn(cdp, `(()=>{const e=document.querySelector('.akari-inspector-ai-still-panel [data-akari-inspector-ai-cropped]')
    ??document.querySelector('.akari-inspector-ai-still-candidates');e?.scrollIntoView({block:'center',behavior:'instant'});return true})()`);
  await shot(cdp, '01a-crop-line-three-routes', { clear: false, clipSelector: '[data-akari-ui="panel:inspector"]' });

  // ---- 1) 1 手段（ChatGPT だけ）でも専用パネルの中に出る ----
  await stage('1) crop line inside the still panel (one route)');
  await selectFrame();
  await openStillPanel();
  for (const id of ['grok', 'antigravity', 'fal']) await setRoute(id, false);
  await setRoute('codex', true);
  await typePrompt('夜の港の灯り');
  const logBefore = (await stubLog()).length;
  await waitEval(cdp, `document.querySelector('[data-akari-inspector-ai-create="true"]')?.disabled===false`, 'create enabled (single)', 60_000);
  const p2 = await pointOf(cdp, '[data-akari-inspector-ai-create="true"]');
  await realClick(cdp, p2.x, p2.y);
  await waitEval(cdp, `(async()=>true)()`, 'noop');
  { const until = Date.now() + 60_000; while (Date.now() < until && !(await stubLog()).slice(logBefore).some(r => r.wrote)) await sleep(300); }
  await sleep(2500);
  await settle(cdp);
  panel = await evalOn(cdp, inspectStill);
  results.observations.single = { panel, badge: await badgeOf(), edit: (await frameItems()).map(i => ({ id: i.id, src: i.source?.src })) };
  check('1) 1 手段で完了しても専用パネルが開いたまま', panel.stillPanel, { stillPanel: panel.stillPanel, header: panel.header });
  check('1) 1 手段: 専用パネルの中に「9:16 を頼んで正方形 → 切りそろえました」', panel.cropLines.some(l => l.inStillPanel && l.text.includes('9:16 を頼んで正方形 → 切りそろえました')), panel.cropLines);
  await evalOn(cdp, `(()=>{const e=document.querySelector('.akari-inspector-ai-still-panel [data-akari-inspector-ai-cropped]')
    ??document.querySelector('.akari-inspector-ai-still-candidates');e?.scrollIntoView({block:'center',behavior:'instant'});return true})()`);
  await shot(cdp, '01b-crop-line-one-route', { clear: false, clipSelector: '[data-akari-ui="panel:inspector"]' });

  // ---- 3) パネルの見積もり（fal を選んだときの表示） ----
  await stage('3) fal estimate in the panel');
  // fal は未接続（キー無し）なので選べないが、詳細の見積もりの行は出る
  panel = await evalOn(cdp, inspectStill);
  results.observations.falEstimate = { create: panel.create, estimateTexts: panel.estimateTexts, fal: panel.routes.find(r => r.id === 'fal') };
  check('3) パネルの fal の見積もりが「$0.053 / 枚」（高品質・ai-models.json の値。変更前と同じ）', panel.estimateTexts.some(t => t.includes('見積もり $0.053 / 枚')), results.observations.falEstimate);
  await evalOn(cdp, `(()=>{const e=[...document.querySelectorAll('.akari-inspector-ai-still-panel *')].find(e=>e.children.length===0&&/見積もり \\$/u.test(e.textContent??''))
    ??document.querySelector('[data-akari-inspector-ai-route="fal"]');e?.scrollIntoView({block:'center',behavior:'instant'});return true})()`);
  await shot(cdp, '03-fal-estimate', { clipSelector: '[data-akari-ui="panel:inspector"]' });

  // ---- 2) 設定 › AI モデル › 比べる: 入力: 指示文 ----
  await stage('2) settings › ai models › compare');
  await evalOn(cdp, `(()=>{const c=window.theia.container,d=c._bindingDictionary;
    const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');
    void c.get(C).executeCommand('akari.settings.open');return true})()`);
  await waitEval(cdp, `Boolean(document.querySelector('[data-akari-settings-dialog]'))`, 'settings dialog', 60_000);
  await sleep(1000);
  await evalOn(cdp, `(()=>{document.querySelector('[data-settings-nav="ai-models"]')?.click();return true})()`);
  await waitEval(cdp, `Boolean(document.querySelector('[data-ai-models-view] [data-ai-model-card]'))`, 'ai model cards', 60_000);
  results.observations.compare = {};
  for (const kind of ['image', 'video', 'voice', 'transcribe']) {
    await evalOn(cdp, `(()=>{document.querySelector('[data-ai-model-kind="${kind}"]')?.click();return true})()`);
    await sleep(800);
    for (let i = 0; i < 3; i++) {
      if (!await evalOn(cdp, `Boolean(document.querySelector('[data-ai-model-compare-add]'))`)) break;
      await evalOn(cdp, `(()=>{document.querySelector('[data-ai-model-compare-add]')?.click();return true})()`);
      await sleep(500);
    }
    const table = await evalOn(cdp, `(()=>{const t=document.querySelector('[data-ai-model-compare-table]');if(!t)return null;
      const rows=[...t.querySelectorAll('tr')].map(tr=>[...tr.children].map(c=>c.querySelector('select')?c.querySelector('select').selectedOptions[0]?.textContent?.trim():c.textContent.trim()));
      return{models:rows[0]?.slice(1).filter(x=>x&&x!=='＋ 足す'),prompt:rows.find(r=>r[0]==='入力: 指示文')??null,labels:rows.map(r=>r[0])}})()`);
    results.observations.compare[kind] = table;
    const cells = table?.prompt?.slice(1) ?? [];
    if (kind === 'transcribe') {
      check('2) 文字起こし: 「入力: 指示文」は「—」（行があれば全部「—」、無ければ行ごと出ない）', !table?.prompt || cells.every(c => c === '—'), table);
    } else {
      check(`2) ${kind}: 「入力: 指示文」が全モデル「可」`, cells.length > 0 && cells.every(c => c === '可'), table);
    }
    await evalOn(cdp, `(()=>{const t=document.querySelector('[data-ai-model-compare-table]');const r=[...(t?.querySelectorAll('tr')??[])].find(tr=>tr.firstElementChild?.textContent?.trim()==='入力: 指示文');
      (r??t??document.querySelector('[data-ai-model-compare]'))?.scrollIntoView({block:'center',behavior:'instant'});return true})()`);
    await sleep(400);
    await shot(cdp, `02-compare-${kind}`, { clear: false });
  }
  results.status = results.checks.every(c => c.pass) ? 'pass' : 'fail';
  if (results.status !== 'pass') process.exitCode = 1;
} catch (error) {
  results.status = 'error';
  results.error = clean(error?.stack ?? error);
  console.error(error);
  process.exitCode = 2;
  if (cdp) await shot(cdp, 'zz-failure').catch(() => undefined);
} finally {
  await save();
  try { cdp?.close(); } catch {}
  if (electron && electron.exitCode === null) {
    electron.kill('SIGTERM');
    await new Promise(resolve => { const t = setTimeout(resolve, 10_000); electron.once('exit', () => { clearTimeout(t); resolve(); }); });
    if (electron.exitCode === null && electron.signalCode === null) electron.kill('SIGKILL');
  }
  if (!process.argv.includes('--keep-tmp')) await rm(ISO, { recursive: true, force: true }).catch(() => undefined);
}
