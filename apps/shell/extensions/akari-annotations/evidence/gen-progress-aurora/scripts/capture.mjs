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
const SHELL = process.env.GEN_PROGRESS_SHELL || path.join(REPO, 'apps/shell');
const localElectron = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const ELECTRON = await stat(localElectron).then(s => s.isFile()).catch(() => false)
  ? localElectron : path.join(path.resolve(SHELL, '../..'), 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const CODEX = path.join(ROOT, 'scripts/fake-codex.mjs');
const PORT = Number(process.argv.find(arg => arg.startsWith('--port='))?.slice(7) ?? 9634);
const ISO = await mkdtemp(path.join(path.sep, 'tmp', 'gen-progress-aurora-'));
const PROJECT = path.join(ISO, 'workspace');
const STATE = path.join(ISO, 'codex-state');
const S = JSON.stringify;
const results = { status: 'running', step: '', boot: {}, checks: [], clicks: [], screenshots: [],
  measurements: { badgeTextIntersect: null, clickableButtonsStyled: null, disabledCreate: null,
    timelineThumbnailBefore: null, timelineThumbnailAfter: null, timelineThumbnailUndo: null,
    previewBefore: null, previewAfter: null, previewUndo: null,
    timelineThumbnailChanged: null, previewChanged: null } };
const clean = value => String(value).replaceAll(REPO, '<WORKTREE>').replaceAll(os.homedir(), '<HOME>')
  .replaceAll(ISO, '<TMP>').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '<email>');
async function save() {
  const target = path.join(ROOT, process.argv.includes('--before') ? 'before-results.json' : 'visual-after.json');
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
    try {
      const point = await waitEval(cdp, `(()=>{const e=document.querySelector(${S(selector)});if(!e)return null;
        e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
        const b=e.getBoundingClientRect();return b.width&&b.height?{x:b.left+b.width/2,y:b.top+b.height/2}:null})()`, `click target ${selector}`);
      if (selector.includes('timeline:cut') || selector.includes('akari-item-id')) await realClick(cdp, point.x, point.y);
      else await evalOn(cdp, `document.querySelector(${S(selector)}).click(); true`);
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
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const bytes = Buffer.from(data, 'base64');
  await writeFile(path.join(ROOT, name), bytes);
  results.screenshots.push({ name, bytes: bytes.length });
  if (/^(before|after)-(?:planned|generating|done|failed|audio-generating|video-generating)/u.test(name)) {
    const cropped = async (selector, suffix, padX, padY) => {
      const rect = await evalOn(cdp, `(()=>{const e=document.querySelector(${S(selector)});if(!e)return null;
        const r=e.getBoundingClientRect();return{x:Math.max(0,r.x-${padX}),y:Math.max(0,r.y-${padY}),
          width:Math.min(innerWidth-Math.max(0,r.x-${padX}),r.width+${padX * 2}),
          height:Math.min(innerHeight-Math.max(0,r.y-${padY}),r.height+${padY * 2})}})()`);
      if (!rect || rect.width < 5 || rect.height < 5) return;
      const crop = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false,
        clip: { ...rect, scale: 2 } });
      const file = name.replace(/\.png$/u, `-${suffix}-2x.png`);
      await writeFile(path.join(ROOT, file), Buffer.from(crop.data, 'base64'));
      results.screenshots.push({ name: file, bytes: Buffer.from(crop.data, 'base64').length });
    };
    const timelineSelector = name.includes('audio-generating') ? '[data-akari-item-id="audio-frame"]'
      : name.includes('video-generating') ? '[data-akari-ui="timeline:cut:4"]'
        : '[data-akari-ui="timeline:cut:1"]';
    await cropped(timelineSelector, 'timeline', 36, 22);
    await cropped('[id^="plugin-webview:akari-output-preview-"]', 'preview', 10, 10);
  }
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
async function selectCut(cdp, index) {
  const selector = `[data-akari-ui="timeline:cut:${index}"]`;
  await clickUntil(cdp, selector, `document.querySelector(${S(selector)})?.classList.contains('akari-annotations-selected')`, `select cut ${index}`);
}
const tab = '[data-akari-ui="tab:inspector-edit"]';
const tile = '[data-akari-inspector-ai-tile="still"]';
const create = '[data-akari-inspector-ai-create="true"]';
const refresh = '[data-akari-inspector-ai-refresh="true"]';
let previewCdp, previewContext;
async function previewEval(expression) {
  try { return await evalOn(previewCdp, expression, previewContext); }
  catch {
    await ensurePreviewWebview(true);
    return evalOn(previewCdp, expression, previewContext);
  }
}
async function ensurePreviewWebview(force = false) {
  if (previewCdp && !force) return;
  if (previewCdp) try { previewCdp.close(); } catch {}
  previewCdp = undefined; previewContext = undefined;
  const until = Date.now() + 120000;
  let target;
  while (Date.now() < until && !target) {
    target = await listTargets(PORT).then(rows => rows.filter(row => row.type === 'iframe'
      && /webview\/index\.html/u.test(row.url)).at(-1)).catch(() => undefined);
    if (!target) await sleep(250);
  }
  if (!target) throw new Error('preview webview target missing');
  previewCdp = new CDP(target.webSocketDebuggerUrl);
  await previewCdp.connect();
  const contexts = [];
  previewCdp.on('Runtime.executionContextCreated', event => contexts.push(event.context.id));
  await previewCdp.send('Page.enable'); await previewCdp.send('Runtime.enable');
  const end = Date.now() + 120000;
  while (Date.now() < end) {
    for (const id of [undefined, ...contexts]) {
      if (await evalOn(previewCdp, `Boolean(document.getElementById('preview-stage'))`, id).catch(() => false)) {
        previewContext = id;
        return;
      }
    }
    await sleep(250);
  }
  throw new Error('preview stage did not render');
}
async function openAi(cdp) {
  if (!await evalOn(cdp, `document.querySelector(${S(tab)})?.getAttribute('aria-selected')==='true'`))
    await clickUntil(cdp, tab, `document.querySelector(${S(tab)})?.getAttribute('aria-selected')==='true'`, 'open AI');
}
async function revealPreviewAt(cdp, time) {
  const editUri = `file://${PROJECT}/edit.json`;
  await evalOn(cdp, `(async()=>{const c=window.theia.container,d=c._bindingDictionary;
    const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');
    await c.get(C).executeCommand('akari.preview.ensureVisible',{editUri:${S(editUri)}});
    await c.get(C).executeCommand('akari.preview.seekOutput',{editUri:${S(editUri)},time:${time},seek:true});
    return true})()`);
  await waitEval(cdp, `(()=>{const e=document.querySelector('[id^="plugin-webview:akari-output-preview-"]');const r=e?.getBoundingClientRect();return !!r&&r.width>300&&r.height>200})()`, 'visible preview', 90000);
  await ensurePreviewWebview(true);
  results.measurements.previewStageReady = await previewEval(`Boolean(document.getElementById('preview-stage'))`);
  await previewEval(`(()=>{const e=document.getElementById('seek');if(!e)return false;e.value=${S(String(time))};
    e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`).catch(() => undefined);
  await sleep(1200);
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
  const until = Date.now() + 120_000;
  while (Date.now() < until) {
    const doc = await edit();
    const item = doc.tracks[0].items.find(row => row.id === 'clip-b');
    if (item?.source?.src !== old) return { doc, item };
    await sleep(200);
  }
  throw new Error('generated still was not placed in the selected frame');
}
async function waitMeta(relativePath, predicate, label, timeout = 45000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const meta = await readFile(path.join(PROJECT, `${relativePath}.meta.json`), 'utf8')
      .then(JSON.parse).catch(() => null);
    if (meta && predicate(meta)) return meta;
    await sleep(180);
  }
  throw new Error(`Timed out: ${label}`);
}
const elapsed = value => Number(/(\d+)\s*秒/u.exec(String(value))?.[1] ?? NaN);
async function recordSecondsTick(cdp) {
  const selector = '[data-akari-ui="timeline:cut:1"] [data-akari-generation-badge]';
  await stage('seconds tick: timeline ready');
  await waitEval(cdp, `document.querySelector(${S(selector)})?.textContent?.includes('生成中')`, 'timeline generating badge');
  await stage('seconds tick: preview ready');
  const until = Date.now() + 30000;
  while (Date.now() < until) {
    const text = await previewEval(`document.getElementById('akari-gen-band-text')?.textContent ?? ''`).catch(() => '');
    if (Number.isFinite(elapsed(text))) break;
    await sleep(250);
  }
  const firstTimeline = await evalOn(cdp, `(()=>{const b=document.querySelector(${S(selector)});
    const a=b.closest('[data-akari-generation-state]')?.querySelector('.akari-generation-aurora-layer');
    window.__genProgressBadge=b;window.__genProgressAurora=a;
    b.dataset.genProgressEvidence='same-node';return{ text:b.textContent,
      auroraPosition:a?getComputedStyle(a).backgroundPosition:null,
      auroraAnimation:a?getComputedStyle(a).animationName:null }})()`);
  const firstPreview = await previewEval(`(()=>{const b=document.getElementById('akari-gen-band-text');
    window.__genProgressBand=b;b.dataset.genProgressEvidence='same-node';return{text:b.textContent}})()`);
  await sleep(3200);
  await stage('seconds tick: second reading');
  const secondTimeline = await evalOn(cdp, `(()=>{const b=document.querySelector(${S(selector)});
    const a=b?.closest('[data-akari-generation-state]')?.querySelector('.akari-generation-aurora-layer');
    return{text:b?.textContent,same:b===window.__genProgressBadge,
      marker:b?.dataset.genProgressEvidence,auroraPosition:a?getComputedStyle(a).backgroundPosition:null,
      sameAurora:a===window.__genProgressAurora}})()`);
  const secondPreview = await previewEval(`(()=>{const b=document.getElementById('akari-gen-band-text');
    return{text:b?.textContent,same:b===window.__genProgressBand,
      marker:b?.dataset.genProgressEvidence}})()`);
  results.measurements.secondsTick = { timeline: { first: firstTimeline.text, second: secondTimeline.text,
      sameElement: secondTimeline.same, marker: secondTimeline.marker,
      auroraFirst: firstTimeline.auroraPosition, auroraSecond: secondTimeline.auroraPosition,
      auroraAnimation: firstTimeline.auroraAnimation, sameAurora: secondTimeline.sameAurora },
    preview: { first: firstPreview.text, second: secondPreview.text,
      sameElement: secondPreview.same, marker: secondPreview.marker } };
  check('timeline seconds update on same badge', secondTimeline.same && secondTimeline.marker === 'same-node'
    && elapsed(secondTimeline.text) >= elapsed(firstTimeline.text) + 2, results.measurements.secondsTick.timeline);
  check('preview seconds update on same band', secondPreview.same && secondPreview.marker === 'same-node'
    && elapsed(secondPreview.text) >= elapsed(firstPreview.text) + 2, results.measurements.secondsTick.preview);
  check('aurora moves on the same layer', secondTimeline.sameAurora
    && firstTimeline.auroraAnimation === 'akari-generation-aurora'
    && firstTimeline.auroraPosition !== secondTimeline.auroraPosition,
  results.measurements.secondsTick.timeline);
}
async function reducedMotion(cdp) {
  const features = [{ name: 'prefers-reduced-motion', value: 'reduce' }];
  await cdp.send('Emulation.setEmulatedMedia', { features });
  await previewCdp.send('Emulation.setEmulatedMedia', { features });
  const timeline = await evalOn(cdp, `(()=>{const e=document.querySelector('[data-akari-ui="timeline:cut:1"]');
    const b=e?.querySelector('[data-akari-generation-badge]');
    const a=e?.querySelector('.akari-generation-aurora-layer');
    return{frame:e?getComputedStyle(e).animationName:null,
      spinner:b?getComputedStyle(b,'::before').animationName:null,
      aurora:a?getComputedStyle(a).animationName:null,
      auroraColor:a?getComputedStyle(a).backgroundImage:null}})()`);
  const preview = await previewEval(`(()=>{const s=document.getElementById('akari-gen-shimmer');
    const i=document.getElementById('akari-gen-icon');
    return{shimmer:s?getComputedStyle(s).animationName:null,icon:i?getComputedStyle(i).animationName:null}})()`);
  results.measurements.reducedMotion = { timeline, preview };
  check('reduced motion stops five animations but keeps the aurora color', [timeline.frame, timeline.spinner,
    timeline.aurora, preview.shimmer, preview.icon].every(value => value === 'none')
    && timeline.auroraColor?.includes('linear-gradient'), results.measurements.reducedMotion);
  await shot(cdp, 'after-reduced-motion.png');
  await cdp.send('Emulation.setEmulatedMedia', { features: [] });
  await previewCdp.send('Emulation.setEmulatedMedia', { features: [] });
}
async function runFixture() {
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts/gen-fixture.mjs')], { cwd: REPO,
    env: { ...process.env, GEN_PROGRESS_PROJECT: PROJECT,
      GEN_PROGRESS_TRANSFORM: process.argv.includes('--before') ? '0' : '1',
      FFMPEG: process.env.FFMPEG || 'ffmpeg' }, stdio: ['ignore', 'pipe', 'pipe'] });
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
  electron = spawn(ELECTRON, [SHELL, PROJECT, `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${path.join(ISO, 'user-data')}`, '--window-size=1600,1000', '--no-sandbox'], {
    cwd: REPO, env: { ...process.env, HOME: path.join(ISO, 'home'), AKARI_HOME: path.join(ISO, 'akari-home'), THEIA_CONFIG_DIR: path.join(ISO, 'theia-config'),
      AKARI_CODEX_BIN: CODEX, FAKE_CODEX_STATE_FILE: STATE,
      FAKE_CODEX_DELAY_MS: process.argv.includes('--before') ? '30000' : '45000',
      AKARI_GENERATE_CLI: path.join(ROOT, 'scripts/fake-narration.mjs'),
      FAKE_NARRATION_STATE_FILE: path.join(ISO, 'narration-state'), FAKE_NARRATION_DELAY_MS: '30000' }, stdio: 'ignore'
  });
  const target = await (async () => { const until = Date.now() + 600_000; while (Date.now() < until) {
    const page = await listTargets(PORT).then(rows => rows.find(row => row.type === 'page')).catch(() => undefined);
    if (page) return page;
    await sleep(300);
  } throw new Error('CDP page missing'); })();
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 2000, height: 1100,
    deviceScaleFactor: 1, mobile: false });
  await waitEval(cdp, `Boolean(window.theia?.container&&document.getElementById('theia-app-shell'))`, 'Theia', 1_500_000);
  const command = id => `(async()=>{const c=window.theia.container,d=c._bindingDictionary;
    const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');
    await c.get(C).executeCommand(${S(id)});return true})()`;
  if (!await evalOn(cdp, `Boolean(document.querySelector('[data-akari-ui="timeline:cut:0"]'))`)) {
    await waitEval(cdp, `(async()=>{try{return await ${command('akari.annotations.open')}}catch{return false}})()`,
      'timeline command', 120000);
  }
  await waitEval(cdp, `Boolean(document.querySelector('[data-akari-ui="timeline:cut:3"]'))`, 'timeline', 600_000);
  await evalOn(cdp, command('akari.inspector.open')).catch(() => undefined);
  await waitEval(cdp, `Boolean(document.querySelector('[data-akari-ui="panel:inspector"]'))`, 'inspector');
  await evalOn(cdp, `document.querySelector('.theia-preload')?.remove(); true`);

  await stage('01 empty frame list');
  await selectCut(cdp, 1); await openAi(cdp);
  await revealPreviewAt(cdp, 7);
  if (process.argv.includes('--before')) {
    const tag = await previewEval(`document.getElementById('akari-gen-tag')?.textContent ?? ''`);
    check('before preview shows planned frame', tag.includes('planned'), tag);
    results.measurements.beforePlannedPreviewTag = tag;
  }
  const titles = await waitEval(cdp, `(()=>{const x=[...document.querySelectorAll('.akari-inspector-ai-title')].map(e=>e.textContent);
    return x.length>=2?x:null})()`, 'AI tiles');
  check('still precedes video', titles[0] === '静止画' && titles[1] === '動画にする', titles);
  await shot(cdp, process.argv.includes('--before') ? 'before-planned.png' : 'after-planned.png');

  await stage('02 still panel');
  await clickUntil(cdp, tile, `Boolean(document.querySelector(${S(create)}))`, 'still panel');
  await waitEval(cdp, `document.querySelector('.akari-inspector-ai-still-badge')?.textContent==='使える'`, 'Codex ready');
  let metrics = await panelMetrics(cdp);
  check('empty prompt disables 作る', metrics.disabled === true, metrics);
  check('prompt and aspects exist', await evalOn(cdp, `Boolean(document.querySelector('[data-akari-inspector-ai-prompt]')&&
    document.querySelectorAll('[data-akari-inspector-ai-aspect]').length===3)`), metrics);

  await stage('03 generate and replace');
  await evalOn(cdp, `(()=>{const e=document.querySelector('[data-akari-inspector-ai-prompt]');e.value='A clear blue garden';e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  await measureVisual(cdp, 'before');
  await clickUntil(cdp, create, `Boolean(document.querySelector('.akari-inspector-ai-still-progress'))`, 'progress');
  await revealPreviewAt(cdp, 7);
  if (process.argv.includes('--before')) {
    const tag = await previewEval(`document.getElementById('akari-gen-tag')?.textContent ?? ''`);
    check('before generation leaves preview planned', tag.includes('planned'), tag);
    results.measurements.beforeGeneratingPreviewTag = tag;
  }
  if (!process.argv.includes('--before')) {
    const activeMeta = await waitMeta('assets/stills/b.png', meta => meta.status === 'generating', 'still meta generating');
    results.measurements.stillGeneratingMeta = { provider: activeMeta.job?.provider,
      startedAt: activeMeta.job?.started_at, staleAfterSeconds: activeMeta.job?.stale_after_s };
    await shot(cdp, 'after-generating.png');
    await recordSecondsTick(cdp);
    const rect = await evalOn(cdp, `(()=>{const e=document.querySelector('[data-akari-ui="timeline:cut:1"]');
      const r=e.getBoundingClientRect(),x=Math.max(0,r.x-36),y=Math.max(0,r.y-22);
      return{x,y,width:Math.min(innerWidth-x,r.width+72),height:Math.min(innerHeight-y,r.height+44)}})()`);
    const crop = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false,
      clip: { ...rect, scale: 2 } });
    const file = 'after-generating-timeline-2x-t3.png';
    const bytes = Buffer.from(crop.data, 'base64');
    await writeFile(path.join(ROOT, file), bytes);
    results.screenshots.push({ name: file, bytes: bytes.length });
    await save();
  } else {
    await shot(cdp, 'before-generating.png');
  }
  if (!process.argv.includes('--before')) {
  await reducedMotion(cdp);
  const placed = await waitSource(oldSource);
  check('one source added and item geometry intact', placed.doc.sources.length === initial.sources.length + 1 &&
    placed.item.id === 'clip-b' && placed.item.at === initial.tracks[0].items.find(x => x.id === 'clip-b').at &&
    placed.item.duration === initial.tracks[0].items.find(x => x.id === 'clip-b').duration, placed.item);
  await waitEval(cdp, `Boolean(document.querySelector(${S(tile)})&&document.querySelector('[data-akari-inspector-ai-tile="video"]')?.getAttribute('aria-disabled')==='false')`, 'AI list after replacement');
  await measureVisual(cdp, 'after', results.measurements.timelineThumbnailBefore);
  await shot(cdp, 'after-done.png');

  await stage('04 undo');
  await clickUntil(cdp, 'button[title^="元に戻す"]', `Boolean(document.querySelector(${S(tile)}))`, 'undo click');
  const undone = await (async () => { const until = Date.now() + 5000; while (Date.now() < until) {
    const doc = await edit();
    if (doc.tracks[0].items.find(x => x.id === 'clip-b').source.src === oldSource) return doc;
    await sleep(150);
  } throw new Error('undo did not restore the source'); })();
  check('one undo restores empty frame', undone.tracks[0].items.find(x => x.id === 'clip-b').source.src === oldSource, undone.tracks[0].items.find(x => x.id === 'clip-b'));
  await measureVisual(cdp, 'undo');
  await shot(cdp, 'after-undo.png');

  await stage('05 failure and retry');
  const beforeFailure = await readFile(path.join(PROJECT, 'assets/stills/b.png.meta.json'), 'utf8');
  await writeFile(STATE, 'fail');
  await openAi(cdp);
  if (!await evalOn(cdp, `Boolean(document.querySelector(${S(create)}))`)) {
    await clickUntil(cdp, tile, `Boolean(document.querySelector(${S(create)}))`, 'open still for retry');
  }
  await waitEval(cdp, `document.querySelector(${S(create)})?.disabled === false`, 'retry enabled');
  await evalOn(cdp, `(()=>{const e=document.querySelector('[data-akari-inspector-ai-prompt]');e.value='A clear blue garden';e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  await clickUntil(cdp, create, `Boolean(document.querySelector('.akari-inspector-ai-still-progress'))`, 'failure progress');
  await waitEval(cdp, `Boolean(document.querySelector('.akari-inspector-ai-still-error')&&document.querySelector('[data-akari-inspector-ai-retry]'))`, 'failure reason');
  const errorText = await evalOn(cdp, `document.querySelector('.akari-inspector-ai-still-error')?.textContent`);
  check('failure reason redacts email', errorText.includes('画像を作れません') && !errorText.includes('@'), errorText);
  await panelMetrics(cdp);
  await shot(cdp, 'after-failed.png');
  const afterFailure = await readFile(path.join(PROJECT, 'assets/stills/b.png.meta.json'), 'utf8');
  check('failure restores original frame meta', JSON.stringify(JSON.parse(afterFailure))
    === JSON.stringify(JSON.parse(beforeFailure)), 'content equality');
  await stage('audio generation');
  await writeFile(path.join(ISO, 'narration-state'), 'ready');
  await clickUntil(cdp, '[data-akari-item-id="audio-frame"]',
    `document.querySelector('[data-akari-item-id="audio-frame"]')?.classList.contains('akari-annotations-selected')`, 'audio frame');
  await openAi(cdp);
  const narrationTile = await waitEval(cdp,
    `Boolean(document.querySelector('[data-akari-inspector-ai-tile="narration"]'))`,
    'narration tile', 6000).catch(() => false);
  results.measurements.audioRoute = narrationTile ? 'ui' : 'frontend-rpc';
  if (narrationTile) {
    await clickUntil(cdp, '[data-akari-inspector-ai-tile="narration"]',
      `Boolean(document.querySelector('.akari-inspector-ai-narration-textarea'))`, 'narration panel');
    await waitEval(cdp, `Boolean(document.querySelector('.akari-inspector-ai-narration-voice option'))`, 'fake voice');
    await evalOn(cdp, `(()=>{const e=document.querySelector('.akari-inspector-ai-narration-textarea');e.value='こんにちは';e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
    await clickUntil(cdp, '.akari-inspector-ai-narration-button',
      `Boolean(document.querySelector('.akari-inspector-ai-narration-progress'))`, 'narration progress');
  } else {
    const started = await evalOn(cdp, `(()=>{const c=window.theia.container,d=c._bindingDictionary;
      const S=[...d._map.keys()].find(k=>typeof k==='symbol'&&String(k)==='Symbol(AkariAnnotationsService)');
      if(!S)return false;const service=c.get(S);
      window.__genProgressNarrationPromise=service.generateNarration({
        projectRootUri:${S(`file://${PROJECT}`)},engine:'voicevox',voice:'1',script:'こんにちは',
        reading:'こんにちは',t:6,approved:false
      }).then(value=>({ok:true,value}),error=>({ok:false,error:String(error)}));
      return true})()`);
    check('frontend reached narration RPC', started, started);
  }
  const audioPath = 'assets/generated/frame-audio-fixture.wav';
  const audioGenerating = await waitMeta(audioPath, meta => meta.status === 'generating', 'audio meta generating');
  results.measurements.audioGeneratingMeta = { provider: audioGenerating.job?.provider,
    startedAt: audioGenerating.job?.started_at, staleAfterSeconds: audioGenerating.job?.stale_after_s };
  await revealPreviewAt(cdp, 7);
  await shot(cdp, 'after-audio-generating.png');
  const audioRestored = await waitMeta(audioPath, meta => meta.status === 'planned'
    && meta.history?.at(-1)?.status === 'planned', 'audio meta restored', 120000);
  results.measurements.audioAfterCompletion = { status: audioRestored.status,
    lastHistory: audioRestored.history.at(-1).status };
  let rpcNarration;
  if (!narrationTile) {
    rpcNarration = await evalOn(cdp, `window.__genProgressNarrationPromise`);
    check('narration RPC succeeds', rpcNarration?.ok && rpcNarration.value?.status === 'ok', rpcNarration);
  }
  const audioResultPath = narrationTile ? await (async () => { const until = Date.now() + 45000;
    while (Date.now() < until) {
      const finalEdit = await edit();
      const sourceId = finalEdit.tracks.find(track => track.lane === 'audio')?.items
        .find(item => item.id === 'audio-frame')?.source?.src;
      const value = finalEdit.sources.find(source => source.id === sourceId)?.path;
      if (value?.startsWith('out/narration/')) return value;
      await sleep(200);
    }
    return null;
  })() : rpcNarration.value.path;
  const audioDone = audioResultPath?.startsWith('out/narration/')
    ? await readFile(path.join(PROJECT, `${audioResultPath}.meta.json`), 'utf8').then(JSON.parse).catch(() => null)
    : null;
  results.measurements.audioAfterCompletion.doneMeta = audioDone?.status ?? null;
  check('app narration places done source', audioDone?.status === 'done', audioResultPath ?? null);

  await stage('video percentage and bar');
  const at = new Date().toISOString();
  await writeFile(path.join(PROJECT, 'assets/recorded.mp4.meta.json'), JSON.stringify({
    version: 1, kind: 'video', status: 'generating', progress: { percent: 42 },
    job: { provider: 'fal', request_id: 'stub', progress: 42, started_at: at, stale_after_s: 600 },
    history: [{ at, status: 'generating', reason: null }]
  }));
  await revealPreviewAt(cdp, 25);
  const videoBadge = await waitEval(cdp, `document.querySelector('[data-akari-ui="timeline:cut:4"] [data-akari-generation-badge]')?.textContent?.includes('42%')`, 'video percentage');
  let videoPreview = '';
  const previewUntil = Date.now() + 30000;
  while (Date.now() < previewUntil) {
    videoPreview = await previewEval(`document.getElementById('akari-gen-band-text')?.textContent ?? ''`);
    if (videoPreview.includes('42%')) break;
    await sleep(250);
  }
  results.measurements.video = { badgeHasPercent: videoBadge, previewText: videoPreview,
    progressWidth: await evalOn(cdp, `document.querySelector('[data-akari-ui="timeline:cut:4"] [data-akari-generation-progress]')?.style.width ?? ''`) };
  check('video percentage and progress bar remain', videoBadge && videoPreview.includes('42%')
    && results.measurements.video.progressWidth === '42%', results.measurements.video);
  await shot(cdp, 'after-video-generating.png');
  check('at least six screenshots', results.screenshots.length >= 6, results.screenshots.map(x => x.name));
  }
  results.status = 'PASS';
} catch (error) {
  results.status = 'FAIL';
  results.error = clean(error?.stack ?? error);
  if (cdp) { try { await shot(cdp, 'error-full.png'); } catch {} }
} finally {
  results.step = 'cleanup';
  try { previewCdp?.close(); } catch {}
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
