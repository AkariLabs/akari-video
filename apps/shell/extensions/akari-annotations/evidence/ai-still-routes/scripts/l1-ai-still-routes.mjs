#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
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
const PROJECT = path.join(ROOT, 'fixture/project');
const BIN = path.join(REPO, 'apps/shell/extensions/akari-annotations/test/fixtures/ai-still-routes-bin');
const PORT = Number(process.argv.find(arg => arg.startsWith('--port='))?.slice(7) ?? 22224);
const ISO = await mkdtemp(path.join(os.tmpdir(), 'akari-ai-still-routes-l1-'));
const STATE = path.join(ISO, 'image-state');
const S = JSON.stringify;
const results = { status: 'running', step: '', boot: {}, checks: [], clicks: [], screenshots: [],
  measurements: { badgeTextIntersect: null, clickableButtonsStyled: null, disabledCreate: null,
    timelineThumbnailBefore: null, timelineThumbnailAfter: null, timelineThumbnailUndo: null,
    previewBefore: null, previewAfter: null, previewUndo: null,
    timelineThumbnailChanged: null, previewChanged: null } };
const clean = value => String(value).replaceAll(REPO, '<WORKTREE>').replaceAll(os.homedir(), '<HOME>')
  .replaceAll(ISO, '<TMP>').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '<email>');
async function save() {
  const target = path.join(ROOT, 'results.json');
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
const cutHitState = `(async()=>{const e=document.querySelector('[data-akari-ui="timeline:cut:1"]');
  if(!e)return{ready:false,target:false,hit:null};e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const b=e.getBoundingClientRect(),x=b.left+b.width/2,y=b.top+b.height/2,hit=document.elementFromPoint(x,y);
  const className=hit?.className;return{ready:!!(b.width&&b.height&&hit&&(hit===e||e.contains(hit))),
    target:true,hit:hit?{tag:hit.tagName,class:String(typeof className==='string'?className:className?.baseVal??'').slice(0,80)}:null}})()`;
async function waitBoot(cdp, expression, name, timeout) {
  const bucket = { checks: 0, last: null, samples: [] };
  results.boot[name] = bucket;
  const until = Date.now() + timeout;
  let lastSample = 0, lastSaved = 0, previous = '';
  while (Date.now() < until) {
    const state = await evalOn(cdp, `(async()=>{const result=await (${expression});
      const cut=document.querySelector('[data-akari-ui="timeline:cut:1"]'),r=cut?.getBoundingClientRect();
      const hit=r?document.elementFromPoint(r.left+r.width/2,r.top+r.height/2):null,c=hit?.className;
      return{...result,preloadPresent:!!document.querySelector('.theia-preload'),
        hitAtCut:hit?{tag:hit.tagName,class:String(typeof c==='string'?c:c?.baseVal??'').slice(0,80)}:null}})()`)
      .catch(error => ({ ready: false, error: clean(error?.message ?? error) }));
    bucket.checks++;
    bucket.last = state;
    const now = Date.now(), signature = JSON.stringify(state);
    if (signature !== previous || now - lastSample >= 5000) {
      bucket.samples.push({ elapsedMs: timeout - (until - now), ...state });
      if (bucket.samples.length > 200) bucket.samples.shift();
      lastSample = now; previous = signature;
    }
    if (state.ready || now - lastSaved >= 5000) { await save(); lastSaved = now; }
    if (state.ready) return state;
    await sleep(400);
  }
  await save();
  throw new Error(`Timed out: ${name}: ${JSON.stringify(bucket.last)}`);
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
async function clickUntil(cdp, selector, expectation, name) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await settle(cdp);
    await clearNotifications(cdp);
    try {
      const point = await waitEval(cdp, `(async()=>{const e=document.querySelector(${S(selector)});if(!e)return null;
        e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        const b=e.getBoundingClientRect(),x=b.left+b.width/2,y=b.top+b.height/2;
        const hit=document.elementFromPoint(x,y);return b.width&&b.height&&hit&&(hit===e||e.contains(hit))?{x,y}:null})()`, `click target ${selector}`);
      await realClick(cdp, point.x, point.y);
      await waitEval(cdp, expectation, name, 5000);
      results.clicks.push({ name, attempt, passed: true });
      return;
    } catch (error) {
      const hit = await evalOn(cdp, `(async()=>{const e=document.querySelector(${S(selector)});if(!e)return{target:false,hit:null};
        const b=e.getBoundingClientRect(),h=document.elementFromPoint(b.left+b.width/2,b.top+b.height/2),c=h?.className;
        return{target:true,hit:h?{tag:h.tagName,class:String(typeof c==='string'?c:c?.baseVal??'').slice(0,80)}:null}})()`).catch(() => null);
      results.clicks.push({ name, attempt, passed: false,
        reason: `${clean(error?.message ?? error)}; elementFromPoint=${JSON.stringify(hit?.hit ?? null)}` });
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
const previewSelectors = ['[data-akari-ui="panel:preview"]', '[id^="plugin-webview:akari-output-preview-"]'];
async function clippedHash(cdp, selectors, waitMs = 20_000) {
  const expression = `(()=>{for(const selector of ${S(selectors)}){for(const e of document.querySelectorAll(selector)){
    const r=e.getBoundingClientRect(),s=getComputedStyle(e),x=Math.max(0,r.left),y=Math.max(0,r.top);
    const width=Math.min(innerWidth,r.right)-x,height=Math.min(innerHeight,r.bottom)-y;
    if(s.display!=='none'&&s.visibility!=='hidden'&&width>2&&height>2)return{x,y,width,height,selector}}}return null})()`;
  const rect = await waitEval(cdp, expression, `visible clip ${selectors.join(' or ')}`, waitMs).catch(() => null);
  if (!rect) return null;
  try {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false,
      clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 } });
    return createHash('sha256').update(Buffer.from(data, 'base64')).digest('hex');
  } catch { return null; }
}
async function measureVisual(cdp, phase, beforeThumbnail) {
  await settle(cdp);
  await clearNotifications(cdp);
  const key = phase[0].toUpperCase() + phase.slice(1);
  let thumbnail = await clippedHash(cdp, ['[data-akari-ui="timeline:cut:1"]']);
  if (phase === 'after' && beforeThumbnail && thumbnail === beforeThumbnail) {
    const until = Date.now() + 20_000;
    while (Date.now() < until && thumbnail === beforeThumbnail) {
      await sleep(250);
      thumbnail = await clippedHash(cdp, ['[data-akari-ui="timeline:cut:1"]'], 1000);
    }
  }
  results.measurements[`timelineThumbnail${key}`] = thumbnail;
  results.measurements[`preview${key}`] = await clippedHash(cdp, previewSelectors);
  if (phase === 'after') {
    results.measurements.timelineThumbnailChanged = Boolean(beforeThumbnail && thumbnail && beforeThumbnail !== thumbnail);
    const beforePreview = results.measurements.previewBefore;
    results.measurements.previewChanged = Boolean(beforePreview && results.measurements.previewAfter && beforePreview !== results.measurements.previewAfter);
  }
  await save();
}
async function waitUndoVisual(cdp, afterThumbnail) {
  const until = Date.now() + 90_000;
  let last = { title: null, thumbnail: null };
  while (Date.now() < until) {
    const title = await evalOn(cdp, `document.querySelector('[data-akari-ui="inspector-selection-header"] strong')?.textContent?.trim() ?? null`).catch(() => null);
    const thumbnail = await clippedHash(cdp, ['[data-akari-ui="timeline:cut:1"]'], 1000);
    last = { title, thumbnail };
    if (title === 'b.png' && afterThumbnail && thumbnail && thumbnail !== afterThumbnail) return last;
    await sleep(350);
  }
  throw new Error(`Undo visual did not update within 90 seconds: ${JSON.stringify(last)}`);
}
async function checkNoAspectMismatch(cdp, phase) {
  const notice = await evalOn(cdp, `(()=>{const root=document.querySelector('[data-akari-ui="panel:inspector"]');
    return{hasMismatch:!!root?.textContent?.includes('頼んだ 16:9 と違う'),
      notices:[...(root?.querySelectorAll('.akari-inspector-ai-still-notice,.akari-inspector-ai-still-mismatch')??[])].map(e=>e.textContent)}})()`);
  check(`${phase} has no aspect mismatch notice`, !notice.hasMismatch, notice);
}
async function selectCut(cdp, index) {
  const selector = `[data-akari-ui="timeline:cut:${index}"]`;
  await clickUntil(cdp, selector, `document.querySelector(${S(selector)})?.classList.contains('akari-annotations-selected')`, `select cut ${index}`);
}
const tab = '[data-akari-ui="tab:inspector-generation"]';
const tile = '[data-akari-inspector-ai-tile="still"]';
const create = '[data-akari-inspector-ai-create="true"]';
const refresh = '[data-akari-inspector-ai-refresh="true"]';
async function openAi(cdp) {
  if (!await evalOn(cdp, `document.querySelector(${S(tab)})?.getAttribute('aria-selected')==='true'`))
    await clickUntil(cdp, tab, `document.querySelector(${S(tab)})?.getAttribute('aria-selected')==='true'`, 'open AI');
}
async function panelMetrics(cdp) {
  const measured = await evalOn(cdp, `(()=>{const badge=document.querySelector('.akari-inspector-ai-still-badge');
    const text=document.querySelector('.akari-inspector-ai-still-route-name');
    const b=badge?.getBoundingClientRect(),t=text?.getBoundingClientRect();
    const intersects=!!b&&!!t&&b.left<t.right&&b.right>t.left&&b.top<t.bottom&&b.bottom>t.top;
    const buttons=[...document.querySelectorAll('.akari-inspector-ai-still-panel button')];
    const styled=buttons.filter(e=>!e.disabled).every(e=>{const s=getComputedStyle(e);return s.backgroundColor!=='rgba(0, 0, 0, 0)'||parseFloat(s.borderWidth)>0});
    return{intersects,styled,disabled:document.querySelector(${S(create)})?.disabled,badge:badge?.textContent,buttons:buttons.length}})()`);
  results.measurements.badgeTextIntersect = measured.intersects;
  results.measurements.clickableButtonsStyled = measured.styled;
  results.measurements.disabledCreate = measured.disabled;
  check('badge and route text do not intersect', !measured.intersects, measured);
  check('clickable buttons have a background or border', measured.styled, measured);
  return measured;
}
async function edit() { return JSON.parse(await readFile(path.join(PROJECT, 'edit.json'), 'utf8')); }
async function waitSource(old) {
  const until = Date.now() + 90_000;
  while (Date.now() < until) {
    const doc = await edit();
    const item = doc.tracks[0].items.find(row => row.id === 'clip-b');
    if (item?.source?.src !== old) return { doc, item };
    await sleep(200);
  }
  throw new Error('generated still was not placed in the selected frame');
}
async function runFixture() {
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts/gen-fixture.mjs')], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', error = '';
  child.stdout.on('data', chunk => out += chunk);
  child.stderr.on('data', chunk => error += chunk);
  const code = await new Promise(resolve => child.once('close', resolve));
  if (code !== 0) throw new Error(error);
  return JSON.parse(out.trim());
}
async function waitForExit(child, ms = 10000) {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise(resolve => { const t = setTimeout(() => resolve(false), ms); child.once('exit', () => { clearTimeout(t); resolve(true); }); });
}

let electron, cdp;
try {
  await stage('fixture');
  await stat(ELECTRON);
  results.fixture = await runFixture();
  await writeFile(STATE, 'ready');
  for (const name of ['akari-home', 'theia-config', 'user-data', 'home']) await mkdir(path.join(ISO, name));
  const initial = await edit();
  const oldSource = initial.tracks[0].items.find(row => row.id === 'clip-b').source.src;
  await stage('Electron');
  const electronEnv = { ...process.env, HOME: path.join(ISO, 'home'), AKARI_HOME: path.join(ISO, 'akari-home'), THEIA_CONFIG_DIR: path.join(ISO, 'theia-config'),
    PATH: `${BIN}${path.delimiter}${process.env.PATH}`, AKARI_CODEX_BIN: path.join(BIN, 'codex'), AKARI_AGY_BIN: path.join(BIN, 'agy'), AKARI_GROK_BIN: path.join(BIN, 'grok'), FAKE_IMAGE_STATE_FILE: STATE };
  for (const name of ['FAL_KEY', 'GROQ_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'XAI_API_KEY']) delete electronEnv[name];
  electron = spawn(ELECTRON, [SHELL, PROJECT, `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${path.join(ISO, 'user-data')}`, '--window-size=1600,1000', '--no-sandbox'], {
    cwd: REPO, env: electronEnv, stdio: 'ignore'
  });
  const target = await (async () => { const until = Date.now() + 90_000; while (Date.now() < until) {
    const page = await listTargets(PORT).then(rows => rows.find(row => row.type === 'page')).catch(() => undefined);
    if (page) return page;
    await sleep(300);
  } throw new Error('CDP page missing'); })();
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await waitEval(cdp, `Boolean(window.theia?.container&&document.getElementById('theia-app-shell'))`, 'Theia', 90_000);
  const command = id => `(async()=>{const c=window.theia.container,d=c._bindingDictionary;
    const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');
    await c.get(C).executeCommand(${S(id)});return true})()`;
  if (!await evalOn(cdp, `Boolean(document.querySelector('[data-akari-ui="timeline:cut:0"]'))`)) await evalOn(cdp, command('akari.annotations.open'));
  await waitEval(cdp, `Boolean(document.querySelector('[data-akari-ui="timeline:cut:3"]'))`, 'timeline', 90_000);
  await evalOn(cdp, command('akari.inspector.open')).catch(() => undefined);
  await waitEval(cdp, `Boolean(document.querySelector('[data-akari-ui="panel:inspector"]'))`, 'inspector');
  await stage('waiting for preload to clear');
  await waitBoot(cdp, `(()=>{const e=document.querySelector('.theia-preload'),s=e&&getComputedStyle(e),r=e?.getBoundingClientRect();
    const visible=!!e&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0&&!!r?.width&&!!r?.height;
    return{ready:!visible,present:!!e,visible,display:s?.display??null,visibility:s?.visibility??null,opacity:s?.opacity??null}})()`,
    'preload', 180_000);
  await stage('waiting for unobstructed cut');
  await waitBoot(cdp, cutHitState, 'cutHit', 90_000);

  await stage('01 empty frame and three routes');
  await selectCut(cdp, 1); await openAi(cdp);
  await clickUntil(cdp, tile, `Boolean(document.querySelector(${S(create)}))`, 'still panel');
  await waitEval(cdp, `document.querySelectorAll('[data-akari-inspector-ai-route]').length===3 &&
    [...document.querySelectorAll('[data-akari-inspector-ai-route] .akari-inspector-ai-still-badge')].every(e=>e.textContent==='使える')`, 'three ready routes', 90_000);
  const routeRows = await evalOn(cdp, `[...document.querySelectorAll('[data-akari-inspector-ai-route]')].map(e=>({id:e.getAttribute('data-akari-inspector-ai-route'),status:e.querySelector('.akari-inspector-ai-still-badge')?.textContent}))`);
  check('three ready route rows', JSON.stringify(routeRows.map(x=>x.id))===JSON.stringify(['codex','antigravity','grok']) && routeRows.every(x=>x.status==='使える'), routeRows);
  await panelMetrics(cdp);
  await shot(cdp, '01-three-routes.png');

  await stage('02 Antigravity creates and replaces');
  await clickUntil(cdp, '[data-akari-inspector-ai-route="antigravity"] input', `document.querySelector('[data-akari-inspector-ai-route="antigravity"] input')?.checked`, 'select Antigravity');
  await evalOn(cdp, `(()=>{const e=document.querySelector('[data-akari-inspector-ai-prompt]');e.value='A clear blue garden';e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  await shot(cdp, '02-antigravity-selected.png');
  await measureVisual(cdp, 'before');
  await clickUntil(cdp, create, `Boolean(document.querySelector('.akari-inspector-ai-still-progress'))`, 'Antigravity progress');
  await shot(cdp, '03-antigravity-progress.png');
  const agyPlaced = await waitSource(oldSource);
  check('Antigravity placed image in same frame', agyPlaced.item.id==='clip-b' && agyPlaced.item.at===initial.tracks[0].items.find(x=>x.id==='clip-b').at && agyPlaced.doc.sources.length===initial.sources.length+1, agyPlaced.item);
  await waitEval(cdp, `Boolean(document.querySelector(${S(tile)}))`, 'AI list after Antigravity');
  await measureVisual(cdp, 'after', results.measurements.timelineThumbnailBefore);
  await checkNoAspectMismatch(cdp, 'Antigravity');
  await shot(cdp, '04-antigravity-replaced.png');

  await stage('03 undo once');
  await clickUntil(cdp, 'button[title^="元に戻す"]', `Boolean(document.querySelector(${S(tile)}))`, 'undo click');
  const undone = await (async()=>{const until=Date.now()+90_000;while(Date.now()<until){const doc=await edit();if(doc.tracks[0].items.find(x=>x.id==='clip-b').source.src===oldSource)return doc;await sleep(150)}throw new Error('undo did not restore source')})();
  check('one undo restored source', undone.tracks[0].items.find(x=>x.id==='clip-b').source.src===oldSource, undone.tracks[0].items.find(x=>x.id==='clip-b'));
  const undoVisual = await waitUndoVisual(cdp, results.measurements.timelineThumbnailAfter);
  await measureVisual(cdp, 'undo');
  check('undo heading and thumbnail have redrawn', undoVisual.title==='b.png' &&
    !!results.measurements.timelineThumbnailUndo && results.measurements.timelineThumbnailUndo!==results.measurements.timelineThumbnailAfter,
    { ...undoVisual, after: results.measurements.timelineThumbnailAfter, measuredUndo: results.measurements.timelineThumbnailUndo });
  await shot(cdp, '05-undo.png');
  check('undo screenshot differs from replacement', !(await readFile(path.join(ROOT, '04-antigravity-replaced.png')))
    .equals(await readFile(path.join(ROOT, '05-undo.png'))), '04 and 05 screenshot bytes');

  await stage('04 Grok signed out');
  await writeFile(STATE, 'signed-out');
  await openAi(cdp);
  await clickUntil(cdp, tile, `Boolean(document.querySelector(${S(refresh)}))`, 'open still panel');
  await clickUntil(cdp, '[data-akari-inspector-ai-route="grok"] input', `document.querySelector('[data-akari-inspector-ai-route="grok"] input')?.checked`, 'select Grok');
  const storedRoute = await evalOn(cdp, `localStorage.getItem('akari-inspector-ai-still-route')`);
  results.measurements.selectedRouteStorage = storedRoute;
  check('Grok selection is remembered', storedRoute==='grok', storedRoute);
  await clickUntil(cdp, refresh, `document.querySelector('[data-akari-inspector-ai-route="grok"] .akari-inspector-ai-still-badge')?.textContent==='サインインが必要'`, 'Grok signed out');
  const signedOut = await evalOn(cdp, `({disabled:document.querySelector(${S(create)})?.disabled,next:document.querySelector('.akari-inspector-ai-still-next')?.textContent})`);
  check('Grok signed out blocks create', signedOut.disabled===true && signedOut.next?.includes('grok login'), signedOut);
  await shot(cdp, '06-grok-signed-out.png');

  await stage('05 Grok creates and replaces');
  await writeFile(STATE, 'ready');
  await clickUntil(cdp, refresh, `document.querySelector('[data-akari-inspector-ai-route="grok"] .akari-inspector-ai-still-badge')?.textContent==='使える'`, 'Grok ready');
  await evalOn(cdp, `(()=>{const e=document.querySelector('[data-akari-inspector-ai-prompt]');e.value='A green mountain';e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  await clickUntil(cdp, create, `Boolean(document.querySelector('.akari-inspector-ai-still-progress'))`, 'Grok progress');
  await shot(cdp, '07-grok-progress.png');
  const grokPlaced = await waitSource(oldSource);
  check('Grok placed image in same frame', grokPlaced.item.id==='clip-b' && grokPlaced.doc.sources.length===initial.sources.length+1, grokPlaced.item);
  await waitEval(cdp, `Boolean(document.querySelector(${S(tile)}))`, 'AI list after Grok');
  await checkNoAspectMismatch(cdp, 'Grok');
  await shot(cdp, '08-grok-replaced.png');
  check('at least five screenshots', results.screenshots.length>=5, results.screenshots.map(x=>x.name));
  results.status = 'PASS';
} catch (error) {
  results.status = 'FAIL';
  results.error = clean(error?.stack ?? error);
  if (cdp) { try { await shot(cdp, 'error-full.png'); } catch {} }
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
