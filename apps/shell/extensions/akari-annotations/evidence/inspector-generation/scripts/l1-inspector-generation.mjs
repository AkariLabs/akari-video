#!/usr/bin/env node
// L1（CDP）— 生成インスペクターのモデル別欄・費用承認・生成中チップを実機観測する。
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick, screenshot } from './cdp-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL_DIR = path.join(REPO, 'apps', 'shell');
const electronRelativePath = 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron';
const shellElectron = path.join(SHELL_DIR, electronRelativePath);
const ELECTRON = await stat(shellElectron).then(entry => entry.isFile()).catch(() => false)
  ? shellElectron : path.join(REPO, electronRelativePath);
const PROJECT = path.join(ROOT, 'fixture', 'project');
const RESULTS = path.join(ROOT, 'results.json');
const PORT = Number(process.argv.find(value => value.startsWith('--port='))?.slice(7) ?? 22213);
const ISO = await mkdtemp(path.join(os.tmpdir(), 'akari-generation-l1-'));
const LOG = path.join(ROOT, 'runs', 'l1.log');
const FAKE_CLI = path.join(ROOT, 'scripts', 'fake-generate.mjs');
const S = value => JSON.stringify(value);
const out = { status: 'running', steps: [], screenshots: [], screenshotDetails: [], cleanup: null };

export const sanitizeText = value => {
  let text = String(value);
  text = text.replaceAll(REPO, '<WORKTREE>');
  if (process.env.HOME) text = text.replaceAll(process.env.HOME, '<HOME>');
  text = text.replaceAll(ISO, '<TMP>');
  return text
    .replace(/\/(?:private\/)?(?:tmp|var\/folders)\/[^\s)'"\]]+/gu, '<TMP>')
    .replace(/\/Users\/[^\s)'"\]]+/gu, '<HOME>');
};
const sanitize = value => sanitizeText(value?.stack || value?.message || value);
const save = async () => {
  const temporary = `${RESULTS}.tmp-${process.pid}`;
  await writeFile(temporary, `${sanitizeText(JSON.stringify(out, null, 2))}\n`);
  await rename(temporary, RESULTS);
};
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const run = (command, args, { cwd = ROOT, timeoutMs = 240_000 } = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: false });
  let stdout = '', stderr = '', closed = false;
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const timer = setTimeout(() => { if (!closed) child.kill('SIGKILL'); }, timeoutMs);
  child.once('error', reject);
  child.once('close', code => {
    closed = true;
    clearTimeout(timer);
    code === 0 ? resolve({ stdout, stderr })
      : reject(new Error(`${command} failed (${code}): ${stderr.slice(-1600)}`));
  });
});

async function step(name, operation) {
  const record = { name, pass: false };
  out.steps.push(record);
  try {
    record.detail = await operation();
    record.pass = true;
    await save();
    return record.detail;
  } catch (error) {
    record.error = sanitize(error);
    await save();
    throw error;
  }
}

async function waitEval(cdp, expression, { timeoutMs = 60_000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      const value = await evalOn(cdp, expression);
      if (value) return value;
    } catch (error) { last = error; }
    await sleep(150);
  }
  throw new Error(`${label} not reached${last ? `: ${sanitize(last)}` : ''}`);
}

async function waitForJsonStatus(file, expected, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = JSON.parse(await readFile(file, 'utf8'));
      if (value?.status === expected) return value;
    } catch {}
    await sleep(150);
  }
  throw new Error(`${path.relative(PROJECT, file)} did not reach status ${expected}`);
}

async function settlePreloadOverlay(cdp) {
  const deadline = Date.now() + 1_500_000;
  let reloadAt = Date.now() + 300_000;
  let reloads = 0;
  let hiddenSince = null;
  while (Date.now() < deadline) {
    if (Date.now() > reloadAt && reloads < 2) {
      reloads += 1;
      reloadAt = Date.now() + 300_000;
      hiddenSince = null;
      out.preloadReloads = reloads;
      await cdp.send('Page.reload', { ignoreCache: false }).catch(() => {});
      await sleep(3000);
    }
    const state = await evalOn(cdp, `(()=>{const el=document.querySelector('.theia-preload');return{exists:Boolean(el),hidden:Boolean(el?.classList.contains('theia-hidden'))}})()`);
    if (!state.exists) return 'removed';
    if (state.hidden) {
      hiddenSince ??= Date.now();
      if (Date.now() - hiddenSince >= 15_000) {
        const neutralized = await evalOn(cdp, `(()=>{const el=document.querySelector('.theia-preload');if(!el||!el.classList.contains('theia-hidden'))return false;el.style.pointerEvents='none';return true})()`);
        if (neutralized) return 'neutralized';
      }
    } else hiddenSince = null;
    await sleep(200);
  }
  throw new Error('theia preload overlay did not settle');
}

const command = id => `(async()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');if(!C)throw new Error('CommandService binding unavailable');const r=await window.theia.container.get(C).executeCommand(${S(id)});return r!==null&&typeof r==='object'?'[object]':r??null})()`;
const SECTION = '[data-akari-ui="section:inspector-generation"]';
const field = name => `[data-akari-ui="field:inspector-${name}"]`;
const action = name => `[data-akari-generation-action="${name}"]`;
const sectionSnapshot = `(()=>{const s=document.querySelector(${S(SECTION)});if(!s)return null;
const rows=[...s.querySelectorAll('.akari-inspector-row')].map(r=>({
label:r.querySelector('.akari-inspector-row-label')?.textContent?.trim()||'',
value:r.querySelector('.akari-inspector-row-value')?.textContent?.trim()||'',
input:r.querySelector('.akari-inspector-row-input')?.value||'',className:r.className}));
return{hidden:Boolean(s.querySelector('.akari-inspector-section-body')?.hidden),text:s.textContent,rows}})()`;

const DISMISS_TRANSIENT_UI = `(()=>{let dialogs=0,notifications=0;
for(const dialog of document.querySelectorAll('.dialogBlock')){
const button=[...dialog.querySelectorAll('button')].find(b=>/キャンセル|Cancel|閉じる|Close/u.test(b.textContent||b.getAttribute('aria-label')||''))||dialog.querySelector('.closeButton,.codicon-close');
if(button){button.click();dialogs++}}
for(const overlay of document.querySelectorAll('.dialogOverlay')){overlay.remove();dialogs++}
const notices=[...document.querySelectorAll('.theia-notification-list,.theia-Notification-list,.theia-Notification,.theia-notification-toast')];
for(const notice of notices){
const closes=[...notice.querySelectorAll('button,[role="button"]')].filter(b=>/close|閉じる/u.test(b.getAttribute('aria-label')||b.getAttribute('title')||'')||b.classList.contains('codicon-close'));
for(const close of closes){close.click();notifications++}
notice.style.setProperty('display','none','important')}
return{dialogs,notifications,noticeContainers:notices.length}})()`;

async function dismissTransientUi(cdp, attempts = 5) {
  let total = { dialogs: 0, notifications: 0, noticeContainers: 0 };
  for (let attempt = 0; attempt < attempts; attempt++) {
    const result = await evalOn(cdp, DISMISS_TRANSIENT_UI).catch(() => null);
    if (result) total = {
      dialogs: total.dialogs + result.dialogs,
      notifications: total.notifications + result.notifications,
      noticeContainers: Math.max(total.noticeContainers, result.noticeContainers)
    };
    await sleep(400);
  }
  return total;
}

async function ensureInspectorVisible(cdp) {
  await evalOn(cdp, command('akari.inspector.open')).catch(() => null);
  const visible = await waitEval(cdp,
    `(()=>{const e=document.querySelector('[data-akari-ui="panel:inspector"]');return Boolean(e&&e.offsetParent!==null)})()`,
    { label: 'visible inspector panel', timeoutMs: 60_000 }).then(() => true).catch(() => false);
  if (!visible) {
    const clicked = await evalOn(cdp, `(()=>{const candidates=[
...document.querySelectorAll('.p-TabBar-tab[title*="インスペクター"],.lm-TabBar-tab[title*="インスペクター"],[aria-label*="インスペクター"]'),
...document.querySelectorAll('.codicon-inspect')].map(e=>e.closest('.p-TabBar-tab,.lm-TabBar-tab,button,[role="tab"]')||e);
const target=candidates.find(e=>e instanceof HTMLElement&&e.offsetParent!==null);if(!target)return false;target.click();return true})()`);
    assert(clicked, '右レールのインスペクターアイコンが見つからない');
  }
  await waitEval(cdp,
    `(()=>{const e=document.querySelector('[data-akari-ui="panel:inspector"]');return Boolean(e&&e.offsetParent!==null)})()`,
    { label: 'inspector panel foreground', timeoutMs: 600_000 });
}

async function ensureSection(cdp) {
  await evalOn(cdp, `(()=>{const b=[...document.querySelectorAll('[role=tab]')].find(e=>e.textContent.includes('生成'));if(b&&b.getAttribute('aria-selected')!=='true')b.click()})()`);
  const section = await waitEval(cdp, sectionSnapshot, { label: '生成セクション', timeoutMs: 600_000 });
  if (section.hidden) {
    const toggled = await evalOn(cdp, `(()=>{const s=document.querySelector(${S(SECTION)});const body=s?.querySelector('.akari-inspector-section-body');if(!s||!body)return false;if(!body.hidden)return true;const toggle=s.querySelector('.akari-inspector-section-toggle');if(!toggle)return false;toggle.click();return true})()`);
    assert(toggled, '生成セクションのトグルが見つからない');
    await waitEval(cdp, `(()=>{const body=document.querySelector(${S(SECTION)})?.querySelector('.akari-inspector-section-body');return Boolean(body&&!body.hidden)})()`, { label: '生成セクション展開', timeoutMs: 600_000 });
  }
  await evalOn(cdp, `(()=>{const s=document.querySelector(${S(SECTION)});if(!s)return false;s.scrollIntoView({block:'start'});return true})()`);
}

async function chooseModel(cdp, modelId) {
  const changed = await evalOn(cdp, `(()=>{const e=document.querySelector(${S(field('generation-model'))});if(!e)return null;
const o=[...e.options].find(x=>x.title===${S(modelId)});if(!o)return{error:'option not found',titles:[...e.options].map(x=>x.title)};
e.value=o.value;e.dispatchEvent(new Event('change',{bubbles:true}));return{value:o.value,title:o.title}})()`);
  assert(changed && !changed.error, `モデル ${modelId} を選べない: ${JSON.stringify(changed)}`);
  await waitEval(cdp, `(()=>{const e=document.querySelector(${S(field('generation-model'))});return e?.selectedOptions?.[0]?.title===${S(modelId)}})()`, { label: `${modelId} 選択`, timeoutMs: 600_000 });
  await sleep(500);
  await ensureSection(cdp);
  return changed.value;
}

async function ensureActionVisible(cdp, selector) {
  const visibility = await evalOn(cdp, `(async()=>{
    const panel=document.querySelector('[data-akari-ui="panel:inspector"]');
    const button=panel?.querySelector(${S(selector)});
    if(!panel||!button)throw new Error('Inspector action not found');
    button.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const rect=element=>{const r=element.getBoundingClientRect();return{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
    const buttonRect=rect(button), inspectorRect=rect(panel);
    const visibleRect={left:0,top:0,right:innerWidth,bottom:innerHeight};
    // Intersect client boxes, excluding borders and scrollbars, for every clipping ancestor.
    for(let element=button.parentElement;element;element=element.parentElement){
      const r=element.getBoundingClientRect(), style=getComputedStyle(element);
      if(element===panel||/auto|scroll|hidden|clip/.test(style.overflowX)){
        visibleRect.left=Math.max(visibleRect.left,r.left+element.clientLeft);
        visibleRect.right=Math.min(visibleRect.right,r.left+element.clientLeft+element.clientWidth);
      }
      if(element===panel||/auto|scroll|hidden|clip/.test(style.overflowY)){
        visibleRect.top=Math.max(visibleRect.top,r.top+element.clientTop);
        visibleRect.bottom=Math.min(visibleRect.bottom,r.top+element.clientTop+element.clientHeight);
      }
    }
    const fullyVisible=buttonRect.width>0&&buttonRect.height>0&&getComputedStyle(button).visibility==='visible'
      &&buttonRect.left>=visibleRect.left&&buttonRect.right<=visibleRect.right
      &&buttonRect.top>=visibleRect.top&&buttonRect.bottom<=visibleRect.bottom;
    return{selector:${S(selector)},buttonRect,inspectorRect,visibleRect,fullyVisible};
  })()`);
  assert(visibility.fullyVisible, `操作ボタンがインスペクターの可視範囲に収まらない: ${JSON.stringify(visibility)}`);
  return visibility;
}

async function measureStickyTabStrip(cdp) {
  const measurement = await evalOn(cdp, `(async()=>{
    const strip=document.querySelector('.akari-inspector-tab-strip');
    if(!strip)throw new Error('Inspector tab strip not found');
    let container=strip.parentElement;
    while(container&&!/auto|scroll/.test(getComputedStyle(container).overflowY))container=container.parentElement;
    if(!container)throw new Error('Inspector scroll container not found');
    container.scrollTop=container.scrollHeight;
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const stripRect=strip.getBoundingClientRect(), containerRect=container.getBoundingClientRect();
    return{scrollTop:container.scrollTop,scrollHeight:container.scrollHeight,clientHeight:container.clientHeight,
      tabStripTop:stripRect.top,containerTop:containerRect.top,topDifference:Math.abs(stripRect.top-containerRect.top),
      visible:stripRect.height>0&&stripRect.bottom<=containerRect.bottom};
  })()`);
  out.r1 = { ...out.r1, stickyTabStrip: measurement };
  await save();
  assert(measurement.scrollTop > 0, 'タブ帯の検証でスクロールが発生していない');
  assert(measurement.topDifference <= 1 && measurement.visible,
    `スクロール後のタブ帯がパネル上端に留まらない: ${JSON.stringify(measurement)}`);
  return measurement;
}

async function shot(cdp, name, actionSelector, { scrollToBottom = false } = {}) {
  const destination = path.join(ROOT, name);
  for (let attempt = 1; attempt <= 3; attempt++) {
    await ensureInspectorVisible(cdp);
    await ensureSection(cdp);
    const actionVisibility = actionSelector ? await ensureActionVisible(cdp, actionSelector) : undefined;
    const stickyTabStrip = scrollToBottom ? await measureStickyTabStrip(cdp) : undefined;
    await screenshot(cdp, destination);
    const state = await evalOn(cdp, `(()=>{const panel=document.querySelector('[data-akari-ui="panel:inspector"]');const section=${sectionSnapshot};const body=document.querySelector(${S(SECTION)})?.querySelector('.akari-inspector-section-body');return{
inspectorFront:Boolean(panel&&panel.offsetParent!==null),
sectionVisible:Boolean(section&&body&&!body.hidden&&body.offsetParent!==null),
modelRow:section?.rows.find(row=>row.label==='モデル')?.input||''}})()`);
    if (state.inspectorFront && state.sectionVisible) {
      const sha256 = createHash('sha256').update(await readFile(destination)).digest('hex');
      out.screenshots.push(name);
      out.screenshotDetails.push({
        name,
        sha256,
        inspectorFront: true,
        sectionVisible: true,
        modelRow: state.modelRow,
        ...(stickyTabStrip ? { stickyTabStrip } : {}),
        ...(actionVisibility ? { actionVisibility } : {})
      });
      await save();
      return actionVisibility;
    }
  }
  throw new Error(`${name}: インスペクター前面・生成セクション可視の状態で 3 回撮影できなかった`);
}

const frameSelector = slot => `[data-akari-generation-pick-slot="${slot}"]`;
const materialScope = '#akari-role-buckets-widget';
const pickBand = `${materialScope} .akari-gen-pick-band`;
const materialCard = name => `${materialScope} [data-akari-material-path="assets/stills/${name}.png"]`;

async function clickElement(cdp, selector) {
  const point = await evalOn(cdp, `(async()=>{
    const element=document.querySelector(${S(selector)});
    if(!element)throw new Error('Missing click target: '+${S(selector)});
    element.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const r=element.getBoundingClientRect();
    const x=r.left+r.width/2,y=r.top+r.height/2;
    if(!r.width||!r.height||!element.contains(document.elementFromPoint(x,y)))throw new Error('Click target obscured: '+${S(selector)});
    return{x,y};
  })()`);
  await realClick(cdp, point.x, point.y); // CDP Input.dispatchMouseEvent, not DOM click().
}

async function measureFrames(cdp, pendingSlot) {
  const frames = await evalOn(cdp, `(()=>{
    const rect=e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
    return [...document.querySelectorAll('[data-akari-generation-pick-slot]')].map(frame=>{
      const style=getComputedStyle(frame),r=rect(frame);
      const buttons=[...frame.closest('.akari-inspector-generation-cell').querySelectorAll('button')].map(button=>{
        const b=rect(button);return{text:button.textContent,rect:b,intersects:r.left<b.right&&r.right>b.left&&r.top<b.bottom&&r.bottom>b.top};
      });
      return{slot:frame.getAttribute('data-akari-generation-pick-slot'),role:frame.getAttribute('role'),tabindex:frame.tabIndex,
        pressed:frame.getAttribute('aria-pressed'),disabled:frame.getAttribute('aria-disabled'),cursor:style.cursor,
        borderWidth:style.borderTopWidth,borderStyle:style.borderTopStyle,background:style.backgroundColor,
        boxShadow:style.boxShadow,outline:style.outline,rect:r,buttons,src:frame.querySelector('img')?.src??null};
    });
  })()`);
  assert(frames.length === 2, '最初・最後の枠が揃っていない');
  for (const frame of frames) {
    assert(frame.role === 'button' && frame.tabindex === 0 && frame.cursor === 'pointer' && frame.disabled === 'false', `枠が押せない: ${JSON.stringify(frame)}`);
    assert((Number.parseFloat(frame.borderWidth) > 0 && frame.borderStyle !== 'none')
      || !['transparent', 'rgba(0, 0, 0, 0)'].includes(frame.background), '枠に背景も枠線もない');
    assert(frame.rect.width > 0 && frame.rect.height > 0 && frame.buttons.every(button => !button.intersects), `枠と近道が交差: ${JSON.stringify(frame)}`);
    assert(frame.pressed === String(frame.slot === pendingSlot), '選択待ちの aria-pressed が不正');
    if (frame.slot === pendingSlot) {
      assert(frame.boxShadow.includes('2px') && frame.boxShadow.includes('4px') && frame.boxShadow.includes('167, 139, 250'), `紫の二重の輪がない: ${frame.boxShadow}`);
    } else assert(frame.boxShadow === 'none', '待機していない枠に輪が残る');
  }
  return frames;
}

async function beginFramePick(cdp, slot, label) {
  await clickElement(cdp, frameSelector(slot));
  const band = await waitEval(cdp, `document.querySelector(${S(pickBand)})?.textContent`, { label: '素材選択の帯' });
  assert(band.includes(`${label} に入れる素材を選ぶ`), `帯が違う: ${band}`);
  await clickElement(cdp, `${materialScope} [data-akari-panel-segment="materials"]`);
  await waitEval(cdp, `Boolean(document.querySelector(${S(materialCard('a'))}))`, { label: 'プロジェクト画像カード' });
  return band;
}

async function waitFrameSaved(cdp, slot, expected) {
  const deadline = Date.now() + 30_000;
  let next;
  while (Date.now() < deadline) {
    next = JSON.parse(await readFile(path.join(PROJECT, 'assets/stills/a.png.meta.json'), 'utf8')).next;
    if (next?.inputs?.[slot]?.path === expected) break;
    await sleep(100);
  }
  assert(next?.inputs?.[slot]?.path === expected, `next.inputs.${slot} が ${expected} でない`);
  await waitEval(cdp, `!document.querySelector(${S(pickBand)})`, { label: '選択完了で帯が消える' });
  const src = await waitEval(cdp, `(()=>{const image=document.querySelector(${S(frameSelector(slot))})?.querySelector('img');return image?.complete&&image.naturalWidth>0?image.src:null})()`, { label: `${slot} thumbnail` });
  return { path: next.inputs[slot].path, src };
}

let spawnedChild;
async function launch() {
  await mkdir(path.join(ISO, 'akari-home'), { recursive: true });
  await mkdir(path.join(ISO, 'theia-config'), { recursive: true });
  await mkdir(path.join(ISO, 'user-data'), { recursive: true });
  await mkdir(path.join(ROOT, 'runs'), { recursive: true });
  await writeFile(LOG, '');
  const child = spawn(ELECTRON, [
    SHELL_DIR, PROJECT, `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${path.join(ISO, 'user-data')}`, '--no-sandbox'
  ], {
    cwd: REPO,
    env: {
      ...process.env,
      AKARI_HOME: path.join(ISO, 'akari-home'),
      THEIA_CONFIG_DIR: path.join(ISO, 'theia-config'),
      AKARI_GENERATE_CLI: FAKE_CLI
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false
  });
  spawnedChild = child;
  const append = chunk => void writeFile(LOG, sanitizeText(chunk), { flag: 'a' }).catch(() => {});
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  let target;
  const deadline = Date.now() + 600_000;
  while (Date.now() < deadline && !target) {
    try { target = (await listTargets(PORT)).find(item => item.type === 'page'); } catch {}
    if (!target) await sleep(300);
  }
  assert(target, 'CDP page target did not appear');
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await waitEval(cdp, `Boolean(window.theia&&window.theia.container&&document.getElementById('theia-app-shell'))`, {
    label: 'Theia workbench', timeoutMs: 1_500_000
  });
  return { child, cdp };
}

async function processCount(fragment) {
  return new Promise(resolve => {
    const child = spawn('/bin/sh', ['-c', `ps -eo pid,ppid,args | grep -F ${JSON.stringify(fragment)} | grep -v grep | wc -l`], {
      stdio: ['ignore', 'pipe', 'ignore'], detached: false
    });
    let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.once('close', () => resolve(Number(stdout.trim())));
  });
}

async function stop(session) {
  session?.cdp?.close();
  const pid = (session?.child ?? spawnedChild)?.pid;
  if (pid) {
    try { process.kill(pid, 'SIGTERM'); } catch {}
    await sleep(2500);
    try { process.kill(pid, 0); process.kill(pid, 'SIGKILL'); } catch {}
    await sleep(800);
  }
  const survivors = await processCount(ISO);
  const backendSurvivors = await processCount(path.join(SHELL_DIR, 'lib', 'backend', 'main.js'));
  try { await writeFile(LOG, sanitizeText(await readFile(LOG, 'utf8'))); } catch {}
  out.cleanup = {
    killedPid: pid ?? null,
    survivingProcesses: survivors,
    survivingBackendMain: backendSurvivors,
    alive: pid ? (() => { try { process.kill(pid, 0); return 1; } catch { return 0; } })() : 0
  };
  await rm(path.join(ROOT, 'fixture'), { recursive: true, force: true });
  out.cleanup.fixtureRemoved = true;
  await save();
  await rm(ISO, { recursive: true, force: true });
  return survivors + out.cleanup.alive;
}

let session;
try {
  out.fixture = JSON.parse((await run(process.execPath, [path.join(ROOT, 'scripts', 'gen-fixture.mjs')])).stdout.trim());
  const editPath = path.join(PROJECT, 'edit.json');
  const captionsPath = path.join(PROJECT, 'captions.json');
  const mtimesBefore = { edit: (await stat(editPath)).mtimeMs, captions: (await stat(captionsPath)).mtimeMs };
  await save();

  session = await launch();
  const { cdp } = session;
  out.preloadOverlay = await settlePreloadOverlay(cdp);
  out.dismissedAtStartup = await dismissTransientUi(cdp);

  // 保存レイアウトからタイムラインが自力で復元されるのを先に待つ。open は最後の fallback だけ。
  const restoredTimeline = await waitEval(cdp,
    `Boolean(document.querySelector('[data-akari-ui="timeline:cut:0"]'))`,
    { label: 'restored timeline', timeoutMs: 60_000 }).then(() => true).catch(() => false);
  if (!restoredTimeline) {
    await evalOn(cdp, command('akari.annotations.open'));
    await dismissTransientUi(cdp);
  }
  const clipRect = await waitEval(cdp, `(()=>{const e=document.querySelector('[data-akari-ui="timeline:cut:0"]');if(!e)return null;const r=e.getBoundingClientRect();return r.width>0&&r.height>0?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`, {
    label: 'clip-a timeline chip', timeoutMs: 600_000
  });
  await realClick(cdp, clipRect.x, clipRect.y);
  await ensureInspectorVisible(cdp);
  await ensureSection(cdp);

  await step('1. H3 の最初→最後に 2 枚のサムネと種類を表示', async () => {
    await chooseModel(cdp, 'fal:h3-i2v');
    const frames = await waitEval(cdp, `(()=>{const images=[...document.querySelectorAll('.akari-inspector-generation-frame img')];return images.length===2&&images.every(image=>image.complete&&image.naturalWidth>0)?images.map(image=>({alt:image.alt,width:image.naturalWidth})):null})()`, { label: 'two frame thumbnails' });
    const view = await evalOn(cdp, sectionSnapshot);
    assert(view.text.includes('最初→最後'), '種類が最初→最後でない');
    assert(view.text.includes('常に付く・既定は消音'), '常時音声表示がない');
    assert(view.text.includes('送る絵は素材のまま（色・サイズは送りません）'), '素材の説明がない');
    return { frames, view };
  });
  await shot(cdp, '01-h3-first-to-last.png');
  out.r1 = { controls: await evalOn(cdp, `(()=>{
    const primary=document.querySelector(${S(action('generate'))});
    const secondary=document.querySelector(${S(action('copy-adjacent'))});
    const cameras=[...document.querySelectorAll('[data-akari-generation-camera]')];
    const selected=cameras.filter(button=>button.getAttribute('aria-pressed')==='true');
    return{primaryBackgroundColor:primary?getComputedStyle(primary).backgroundColor:null,
      secondaryBorderTopWidth:secondary?getComputedStyle(secondary).borderTopWidth:null,
      selectedCamera:selected.map(button=>({label:button.textContent,ariaPressed:button.getAttribute('aria-pressed')})),
      cameraButtons:cameras.map(button=>({label:button.textContent,ariaPressed:button.getAttribute('aria-pressed')}))};
  })()`) };
  await save();
  const controls = out.r1.controls;
  assert(controls.primaryBackgroundColor && !['transparent', 'rgba(0, 0, 0, 0)'].includes(controls.primaryBackgroundColor),
    `主ボタンの地が透明: ${controls.primaryBackgroundColor}`);
  assert(Number.parseFloat(controls.secondaryBorderTopWidth) > 0,
    `副ボタンに枠がない: ${controls.secondaryBorderTopWidth}`);
  assert(controls.selectedCamera.length === 1 && controls.selectedCamera[0].ariaPressed === 'true'
    && controls.cameraButtons.every(button => ['true', 'false'].includes(button.ariaPressed)),
    `カメラの選択状態が不正: ${JSON.stringify(controls.cameraButtons)}`);

  await step('2. 両枠を外すとプロンプトだけ・空枠に外すはない', async () => {
    for (const slot of ['first-frame', 'last_frame']) {
      await evalOn(cdp, `document.querySelector('[data-akari-generation-action="${slot}-remove"]').click()`);
      await waitEval(cdp, `!document.querySelector('[data-akari-generation-action="${slot}-remove"]')`, { label: `${slot} cleared` });
    }
    const view = await evalOn(cdp, sectionSnapshot);
    assert(view.text.includes('プロンプトだけ'), '種類がプロンプトだけでない');
    assert(!await evalOn(cdp, `Boolean(document.querySelector('.akari-inspector-generation-frame img'))`), '空枠にサムネが残る');
    return view;
  });
  await shot(cdp, '02-prompt-only.png');

  await step('3. 見積の横から送信すると費用承認が 1 回開く', async () => {
    const sendButtonVisibility = await ensureActionVisible(cdp, action('generate'));
    const clicked = await evalOn(cdp, `(()=>{const b=document.querySelector(${S(action('generate'))});if(!b||b.disabled)return false;b.click();return true})()`);
    assert(clicked, '動画にするボタンを押せない');
    const dialog = await waitEval(cdp, `(()=>{const dialogs=[...document.querySelectorAll('.dialogBlock')].filter(e=>e.textContent.includes('費用承認'));return dialogs.length===1?{text:dialogs[0].textContent,count:dialogs.length}:null})()`, { label: '費用承認 dialog' });
    assert(/\$\d/.test(dialog.text) && dialog.text.includes('as_of') && dialog.text.includes('fal:h3-i2v'), '金額・日付・モデルが不足');
    return { ...dialog, sendButtonVisibility };
  });
  // Do not refocus the inspector while a modal is open.
  await screenshot(cdp, path.join(ROOT, '03-cost-approval-dialog.png'));
  out.screenshots.push('03-cost-approval-dialog.png');

  await step('4. 偽 CLI の起動引数に --inputs がない', async () => {
    await evalOn(cdp, `(()=>{const d=[...document.querySelectorAll('.dialogBlock')].find(e=>e.textContent.includes('費用承認'));[...d.querySelectorAll('button')].find(b=>b.textContent.includes('費用承認する')).click()})()`);
    await waitForJsonStatus(path.join(PROJECT, 'assets/generated/gen-clip-a.mp4.meta.json'), 'failed');
    const invocation = JSON.parse(await readFile(path.join(PROJECT, 'fake-invocation.json'), 'utf8'));
    assert(!invocation.args.includes('--inputs'), '--inputs が残っている');
    assert(invocation.next.inputs.first_frame === null && invocation.next.inputs.last_frame === null, 'next の入力を使っていない');
    return invocation;
  });

  await step('5. 失敗に同じ入力でもう一度を表示', async () => {
    const retry = await waitEval(cdp, `(()=>{const b=document.querySelector(${S(action('retry'))});return b&&b.textContent==='同じ入力でもう一度'?b.textContent:null})()`, { label: 'retry after failure' });
    const retryButtonVisibility = await shot(cdp, '04-failed-retry.png', action('retry'));
    return { retry, retryButtonVisibility };
  });

  const footerRow = await evalOn(cdp, `(()=>{
    const retry=document.querySelector(${S(action('retry'))});
    const primary=document.querySelector(${S(action('generate'))});
    if(!retry||!primary)throw new Error('Retry or primary button not found');
    const estimateLabel=document.querySelector('.akari-inspector-generation-submit-group > .akari-inspector-generation-estimate > .akari-inspector-row-label');
    if(!estimateLabel)throw new Error('Estimate label not found');
    const rect=element=>{const r=element.getBoundingClientRect();return{top:r.top,right:r.right,left:r.left,width:r.width,height:r.height}};
    const retryRect=rect(retry),primaryRect=rect(primary);
    return{retry:retryRect,primary:primaryRect,topDifference:Math.abs(retryRect.top-primaryRect.top),
      estimateLabel:{...rect(estimateLabel),lineHeight:Number.parseFloat(getComputedStyle(estimateLabel).lineHeight)}};
  })()`);
  out.r1.footerRow = footerRow;
  await save();
  assert(footerRow.retry.width > 0 && footerRow.retry.height > 0
    && footerRow.primary.width > 0 && footerRow.primary.height > 0
    && footerRow.topDifference <= 2 && footerRow.retry.right <= footerRow.primary.left,
    `再試行と動画にするが同じ行の左右に並んでいない: ${JSON.stringify(footerRow)}`);
  assert(footerRow.estimateLabel.height > 0 && Number.isFinite(footerRow.estimateLabel.lineHeight)
    && footerRow.estimateLabel.height <= footerRow.estimateLabel.lineHeight + 2,
    `見積ラベルが1行に収まっていない: ${JSON.stringify(footerRow.estimateLabel)}`);

  await step('6. edit.json / captions.json は不変', async () => {
    const after = { edit: (await stat(editPath)).mtimeMs, captions: (await stat(captionsPath)).mtimeMs };
    assert(after.edit === mtimesBefore.edit && after.captions === mtimesBefore.captions, 'edit/captions の mtime が変化');
    return { before: mtimesBefore, after };
  });

  await shot(cdp, '07-sticky-tab-strip.png', undefined, { scrollToBottom: true });

  await step('7. 空の最初の絵を実クリック → 素材パネル → next と画像から', async () => {
    await shot(cdp, '08-frame-empty.png', frameSelector('first_frame'));
    assert(await evalOn(cdp, `document.querySelector(${S(frameSelector('first_frame'))}).textContent.includes('＋ 画像を選ぶ')`), '空枠の選択文言がない');
    const idle = await measureFrames(cdp);
    const band = await beginFramePick(cdp, 'first_frame', '最初の絵');
    const pending = await measureFrames(cdp, 'first_frame');
    await shot(cdp, '09-frame-picking.png', frameSelector('first_frame'));
    await clickElement(cdp, materialCard('c'));
    const picked = await waitFrameSaved(cdp, 'first_frame', 'assets/stills/c.png');
    await waitEval(cdp, `(${sectionSnapshot})?.rows.some(row=>row.label==='種類'&&row.value==='画像から')`, { label: '種類 = 画像から' });
    await shot(cdp, '10-frame-picked.png', frameSelector('first_frame'));
    return { band, idle, pending, picked, after: await measureFrames(cdp) };
  });

  await step('8. 入っている最後の絵を実クリックで差し替える', async () => {
    await beginFramePick(cdp, 'last_frame', '最後の絵');
    await clickElement(cdp, materialCard('b'));
    const before = await waitFrameSaved(cdp, 'last_frame', 'assets/stills/b.png');
    await beginFramePick(cdp, 'last_frame', '最後の絵');
    const pending = await measureFrames(cdp, 'last_frame');
    await clickElement(cdp, materialCard('a'));
    const after = await waitFrameSaved(cdp, 'last_frame', 'assets/stills/a.png');
    assert(before.src !== after.src, '差し替え後もサムネ src が同じ');
    await shot(cdp, '11-frame-replaced.png', frameSelector('last_frame'));
    return { before, pending, after, frames: await measureFrames(cdp) };
  });

  await step('9. 選択待ちで Esc → 元の絵のまま輪を外す', async () => {
    const metaPath = path.join(PROJECT, 'assets/stills/a.png.meta.json');
    const beforeMeta = await readFile(metaPath, 'utf8');
    const before = await measureFrames(cdp);
    await beginFramePick(cdp, 'last_frame', '最後の絵');
    const pending = await measureFrames(cdp, 'last_frame');
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await waitEval(cdp, `!document.querySelector(${S(pickBand)})&&document.querySelector(${S(frameSelector('last_frame'))})?.getAttribute('aria-pressed')==='false'`, { label: 'Esc clears band and ring' });
    await sleep(450);
    const after = await measureFrames(cdp);
    assert(before.every((frame, index) => frame.src === after[index].src), 'Esc でサムネが変化');
    assert(await readFile(metaPath, 'utf8') === beforeMeta, 'Esc で meta が変化');
    await shot(cdp, '12-frame-cancelled.png', frameSelector('last_frame'));
    const mtimesAfter = { edit: (await stat(editPath)).mtimeMs, captions: (await stat(captionsPath)).mtimeMs };
    assert(mtimesAfter.edit === mtimesBefore.edit && mtimesAfter.captions === mtimesBefore.captions, '枠の選択で edit/captions が変化');
    return { before, pending, after, metaUnchanged: true, mtimesAfter };
  });

  out.status = 'pass';
  await save();
} catch (error) {
  out.status = 'fail';
  out.error = sanitize(error);
  try {
    if (session?.cdp) {
      out.diagnostic = {
        sectionSnapshot: await evalOn(session.cdp, sectionSnapshot).catch(diagnosticError => ({
          error: sanitize(diagnosticError)
        })),
        inspectorFields: await evalOn(session.cdp, `(()=>[...document.querySelectorAll('[data-akari-ui^="field:inspector-"]')].map(e=>String(e.getAttribute('data-akari-ui')||'')))()`).catch(diagnosticError => [
          `diagnostic error: ${sanitize(diagnosticError)}`
        ])
      };
      const name = '99-failure.png';
      await screenshot(session.cdp, path.join(ROOT, name));
      if (!out.screenshots.includes(name)) out.screenshots.push(name);
    }
  } catch {}
  await save();
  process.exitCode = 1;
} finally {
  const survivors = await stop(session);
  if (survivors !== 0) {
    out.status = 'fail';
    out.cleanupError = `surviving processes: ${survivors}`;
    await save();
    process.exitCode = 1;
  }
}
