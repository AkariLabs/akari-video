#!/usr/bin/env node
// L1（CDP）— generation-states + 2026-09-21-timeline-planned-video
//   1. 6 状態（静止画 / planned / 生成中 / 応答なし・再取得 / 生成 / 失敗）が 1 枚のタイムラインに出る
//   2. サイドカーを書き換える（planned → failed）と 1 秒以内にチップの state / className / badge が変わる
//   3. 動画予定 3 種のセル数・鎖、next 更新前後、再生通知中の新規サムネ取得数
//   4. その間 edit.json / captions.json は 1 バイトも書かれない（mtime で確認）
// Electron の AKARI_HOME / user-data-dir は一時ディレクトリへ向け、自分が起動した PID だけを kill する。
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, screenshot } from './cdp-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL_DIR = path.join(REPO, 'apps', 'shell');
const ELECTRON_CANDIDATES = [SHELL_DIR, REPO].map(directory =>
  path.join(directory, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'));
const ELECTRON = (await stat(ELECTRON_CANDIDATES[0]).catch(() => null))?.isFile()
  ? ELECTRON_CANDIDATES[0] : ELECTRON_CANDIDATES[1];
const PROJECT = path.join(ROOT, 'fixture', 'project');
const GENERATED = path.join(PROJECT, 'assets', 'generated');
const RESULTS = path.join(ROOT, 'results.json');
const PORT = Number(process.argv.find(value => value.startsWith('--port='))?.slice(7) ?? 22197);
const ISO = await mkdtemp(path.join(tmpdir(), 'akari-generation-states-l1-'));
const LOG = path.join(ROOT, 'runs', 'l1.log');
const S = value => JSON.stringify(value);
const out = { status: 'running', steps: [], screenshots: [], cleanup: null };

const sanitizeText = value => {
  let text = String(value);
  text = text.replaceAll(REPO, '<WORKTREE>');
  if (process.env.HOME) text = text.replaceAll(process.env.HOME, '<HOME>');
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
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', closed = false;
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const timer = setTimeout(() => { if (!closed) child.kill('SIGKILL'); }, timeoutMs);
  child.once('error', reject);
  child.once('close', code => {
    closed = true; clearTimeout(timer);
    code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} failed (${code}): ${stderr.slice(-1600)}`));
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
    try { const value = await evalOn(cdp, expression); if (value) return value; }
    catch (error) { last = error; }
    await sleep(150);
  }
  throw new Error(`${label} not reached${last ? `: ${sanitize(last)}` : ''}`);
}

async function settlePreloadOverlay(cdp) {
  // 他レーンと同居した実機では frontend の初期化に 220 秒かかった実測があるため長めに取る。
  // 高負荷では frontend contributions の途中で止まることがあるので、一定時間で 1 回だけ再読込する。
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

// 失敗時の診断: どの selector が何件ヒットしたかを残す（次の 1 回で原因が分かるように）。
const DIAGNOSTIC = `(()=>{const q=s=>document.querySelectorAll(s).length;
return{widget:q('.akari-annotations-widget'),itemKind:q('[data-akari-item-kind]'),
itemKindItem:q('[data-akari-item-kind="item"]'),genState:q('[data-akari-generation-state]'),
genBadge:q('[data-akari-generation-badge]'),dialogs:q('.dialogBlock,.p-Widget.dialogOverlay'),
sample:[...document.querySelectorAll('[data-akari-generation-state]')].slice(0,8).map(e=>({
kind:e.dataset.akariItemKind,id:e.dataset.akariItemId,state:e.dataset.akariGenerationState,
inWidget:Boolean(e.closest('.akari-annotations-widget')),cls:String(e.className).slice(0,90)}))}})()`;

// 起動直後に出る「タイムラインを作成」等のモーダルを閉じる（証跡 SS を覆わせない）。
const DISMISS_DIALOGS = `(()=>{let closed=0;
for(const dialog of document.querySelectorAll('.dialogBlock')){
const button=[...dialog.querySelectorAll('button')].find(b=>/キャンセル|Cancel|閉じる|Close/u.test(b.textContent||''))
||dialog.querySelector('.closeButton');
if(button){button.click();closed++}}
for(const overlay of document.querySelectorAll('.dialogOverlay')){overlay.remove();closed++}
return closed})()`;

const command = id => `(async()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');if(!C)throw new Error('CommandService binding unavailable');const r=await window.theia.container.get(C).executeCommand(${S(id)});return r!==null&&typeof r==='object'?'[object]':r??null})()`;

// 生成状態チップの観測点（指示 3 の data 属性）。
const CLIPS = `(()=>{const els=[...document.querySelectorAll('[data-akari-generation-state][data-akari-item-id]')].filter(e=>e.closest('.akari-annotations-widget'));
return{count:els.length,clips:els.map(e=>{const b=e.querySelector('[data-akari-generation-badge]');
const p=e.querySelector('[data-akari-generation-progress]');const cs=getComputedStyle(e);
const h=e.querySelector('.akari-annotations-strip-clip-header-label');
return{id:e.dataset.akariItemId,label:h?h.textContent:null,ui:e.dataset.akariUi||e.getAttribute('data-akari-ui'),
state:e.dataset.akariGenerationState,className:e.className,
imageCellCount:e.querySelectorAll('[data-akari-generation-frame]').length,
imageCells:[...e.querySelectorAll('[data-akari-generation-frame]')].map(c=>({side:c.dataset.akariGenerationFrame,left:c.style.left,width:c.style.width,ready:!!c.style.backgroundImage,image:c.style.backgroundImage})),
linked:!!e.querySelector('.akari-generation-link'),prompt:e.querySelector('.akari-generation-prompt')?.textContent??null,
title:b?.title??null,
badge:b?b.textContent:null,badgeColor:b?getComputedStyle(b).color:null,
borderStyle:cs.borderTopStyle,borderColor:cs.borderTopColor,opacity:cs.opacity,
backgroundImage:(cs.backgroundImage||'none').slice(0,64),
progress:p?{width:p.style.width,value:p.dataset.akariGenerationProgress,className:p.className,
background:getComputedStyle(p).backgroundColor,height:getComputedStyle(p).height}:null}})}})()`;

// Geometry is measured from the actual mounted DOM, including ancestor clipping/visibility.
// Perforations: two child rects at top/bottom + nontransparent gradient + visible hole samples.
// For occlusion sampling only, temporarily enable pointer events on descendants, then restore them.
// This makes elementFromPoint see covering badges/text even though production disables their hit tests.
const PLANNED_LAYOUT = `(${function () {
  const rect = el => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  };
  const visible = el => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    for (let n = el; n instanceof Element; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility !== 'visible' || Number(cs.opacity) === 0) return false;
    }
    return true;
  };
  return [...document.querySelectorAll('.akari-generation-planned-video[data-akari-item-kind="cut"]')].map(e => {
    const changed = [...e.querySelectorAll('*')].map(n => [n, n.style.getPropertyValue('pointer-events'), n.style.getPropertyPriority('pointer-events')]);
    const isFront = (el, x, y) => {
      const front = document.elementFromPoint(x, y);
      return front === el || el.contains(front);
    };
    try {
      changed.forEach(([n]) => n.style.setProperty('pointer-events', 'auto', 'important'));
      const measure = (el, role) => {
        if (!el) return { role, visible: false, rect: null };
        const r = rect(el), shown = visible(el);
        return { role, text: el.textContent, visible: shown, rect: r,
          zIndex: getComputedStyle(el).zIndex,
          color: getComputedStyle(el).color,
          frontmost: shown && [.2, .5, .8].every(f => isFront(el, r.left + r.width * f, r.top + r.height / 2)) };
      };
      const texts = [
        ...[...e.querySelectorAll('[data-akari-generation-badge]')].map(el => measure(el, 'badge')),
        measure(e.querySelector('.akari-annotations-strip-clip-header-duration'), 'duration'),
        ...[...e.querySelectorAll('.akari-generation-frame-label')].map((el, i) => measure(el, 'frame-label-' + i)),
        measure(e.querySelector('.akari-generation-prompt'), 'name-or-prompt'),
        measure(e.querySelector('.akari-generation-link'), 'link')
      ];
      const holes = [...e.querySelectorAll('.akari-generation-perforations')].map(el => {
        const r = rect(el), cs = getComputedStyle(el);
        const samples = [];
        // Sample centers of the painted ellipses, not the transparent gaps of the 8px repeat.
        for (let x = r.left + 4; x < r.right; x += 8) {
          if (isFront(el, x, r.top + 2.5)) samples.push({ x, y: r.top + 2.5 });
        }
        return { edge: el.classList.contains('akari-generation-perforations-top') ? 'top' : 'bottom',
          rect: r, visible: visible(el), background: cs.backgroundImage, opacity: cs.opacity,
          zIndex: cs.zIndex, paintedSamples: samples };
      });
      const kind = e.querySelector('.akari-clip-kind-badge');
      return { label: e.querySelector('.akari-annotations-strip-clip-header-label')?.textContent,
        rect: rect(e), texts, holes,
        kindBadge: { exists: !!kind, visible: visible(kind), display: kind ? getComputedStyle(kind).display : null },
        header: rect(e.querySelector('.akari-annotations-strip-clip-header')),
        cells: [...e.querySelectorAll('[data-akari-generation-frame]')].map(c => ({
          side: c.dataset.akariGenerationFrame, rect: rect(c), cover: getComputedStyle(c).backgroundSize
        })) };
    } finally {
      changed.forEach(([n, value, priority]) => value ? n.style.setProperty('pointer-events', value, priority) : n.style.removeProperty('pointer-events'));
    }
  });
}})()`;

function assertPlannedLayout(clips) {
  const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > .1
    && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > .1;
  assert(clips.length === 4, `動画予定は4本必要: ${clips.length}`);
  for (const c of clips) {
    assert(c.header.left >= c.rect.left && c.header.right <= c.rect.right
      && c.header.top >= c.rect.top && c.header.bottom <= c.rect.bottom,
    `${c.label}: header outside clip`);
    const shown = c.texts.filter(t => t.visible);
    assert(c.texts.filter(t => t.role === 'badge').length === 1, `${c.label}: badge count`);
    const narrow = c.label === 'next-narrow.png';
    // Border-box >=130 means the named clip container has at least 128px content width.
    assert(narrow ? c.rect.width >= 40 && c.rect.width < 64 : c.rect.width >= 130,
      `${c.label}: unexpected actual width ${c.rect.width}`);
    for (const role of ['badge', 'name-or-prompt', ...(!narrow ? ['duration'] : [])]) {
      assert(shown.some(t => t.role === role && t.text?.trim()), `${c.label}: ${role} missing`);
    }
    for (const [i, a] of shown.entries()) {
      assert(a.rect.left >= c.rect.left && a.rect.right <= c.rect.right
        && a.rect.top >= c.rect.top && a.rect.bottom <= c.rect.bottom, `${c.label}: ${a.role} clipped`);
      for (const b of shown.slice(i + 1)) assert(!overlaps(a.rect, b.rect), `${c.label}: ${a.role} overlaps ${b.role}`);
    }
    const nameRect = shown.find(t => t.role === 'name-or-prompt').rect;
    assert(nameRect.width > 0, `${c.label}: name has no display width`);
    assert(Math.abs((nameRect.top + nameRect.bottom - c.rect.top - c.rect.bottom) / 2) <= 1,
      `${c.label}: name is not vertically centered`);
    if (!narrow) {
      const duration = shown.find(t => t.role === 'duration');
      const badge = shown.find(t => t.role === 'badge');
      assert(duration.rect.width > 0 && duration.frontmost, `${c.label}: duration not in front`);
      assert(duration.text === '00:05:00' && duration.color === 'rgb(229, 229, 229)', `${c.label}: duration format/color`);
      assert(duration.rect.left > badge.rect.right && duration.rect.top - c.rect.top <= 3
        && c.rect.right - duration.rect.right <= 5, `${c.label}: duration is not at top right`);
    }
    assert(!overlaps(nameRect, c.header), `${c.label}: header covers name`);
    for (const cell of c.cells) {
      assert(cell.rect.height >= c.rect.height * .7, `${c.label}: cell too short (${cell.rect.height}/${c.rect.height})`);
      assert(Math.abs(cell.rect.width - Math.min(cell.rect.height * 16 / 9, c.rect.width * .4)) < 1,
        `${c.label}: cell width formula`);
      assert(cell.cover === 'cover', `${c.label}: cell is not cover`);
      assert(!overlaps(cell.rect, shown.find(t => t.role === 'name-or-prompt').rect), `${c.label}: name overlaps image`);
    }
    assert(c.holes.length === 2 && new Set(c.holes.map(h => h.edge)).size === 2, `${c.label}: need top and bottom holes`);
    for (const row of c.holes) {
      assert(row.visible && row.rect.height > 0 && row.rect.width > 0
        && Number(row.opacity) > 0 && /radial-gradient/.test(row.background) && row.paintedSamples.length > 0,
      `${c.label}: ${row.edge} holes not painted`);
      assert(!overlaps(row.rect, nameRect), `${c.label}: holes cover name`);
      const distance = row.edge === 'top' ? row.rect.top - c.rect.top : c.rect.bottom - row.rect.bottom;
      assert(distance >= 0 && distance <= 2, `${c.label}: ${row.edge} holes misplaced`);
      for (const t of shown.filter(t => ['badge', 'duration'].includes(t.role)))
        assert(Number(t.zIndex) > Number(row.zIndex), `${c.label}: ${t.role} below holes`);
    }
    assert(!c.kindBadge.exists || c.kindBadge.display === 'none', `${c.label}: 画像 kind badge remains`);
    assert(Math.abs(c.header.top - c.rect.top) <= 2, `${c.label}: header is not at top`);
    assert(shown.find(t => t.role === 'badge').text === (narrow ? '▶' : '▶ 動画予定'), `${c.label}: badge text`);
    if (narrow) assert(!shown.some(t => t.role.startsWith('frame-label') || t.role === 'duration'), '狭幅のラベル/時刻は非表示');
    else assert(shown.filter(t => t.role.startsWith('frame-label')).length === c.cells.length, `${c.label}: frame labels missing`);
    const link = shown.find(t => t.role === 'link');
    if (link) assert(Math.abs((link.rect.top + link.rect.bottom - c.rect.top - c.rect.bottom) / 2) <= 1
      && Math.abs(link.rect.right - c.rect.right) <= 2, `${c.label}: link is not at right center`);
  }
}

// サイドカー書き換え → チップ更新までを DOM で監視する。
const INSTALL_WATCH = label => `(()=>{
const pick=()=>{const e=[...document.querySelectorAll('[data-akari-generation-state][data-akari-item-id]')]
.find(x=>x.querySelector('.akari-annotations-strip-clip-header-label')?.textContent===${S(label)});
if(!e)return null;const b=e.querySelector('[data-akari-generation-badge]');
return{state:e.dataset.akariGenerationState,className:e.className,
imageCellCount:e.querySelectorAll('[data-akari-generation-frame]').length,
imageCells:[...e.querySelectorAll('[data-akari-generation-frame]')].map(c=>({side:c.dataset.akariGenerationFrame,left:c.style.left,width:c.style.width,ready:!!c.style.backgroundImage,image:c.style.backgroundImage})),
linked:!!e.querySelector('.akari-generation-link'),prompt:e.querySelector('.akari-generation-prompt')?.textContent??null,
title:b?.title??null,badge:b?b.textContent:null}};
const first=pick();if(!first)return null;
const w={baseline:first,changes:[],startedAt:performance.now(),markedAt:null};
let last=JSON.stringify(first);
const sample=()=>{const now=pick();if(!now)return;const key=JSON.stringify(now);
if(key!==last){last=key;w.changes.push({...now,at:performance.now()})}};
w.observer=new MutationObserver(sample);
w.observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','data-akari-generation-state']});
w.timer=setInterval(sample,20);
window.__akariGenWatch=w;return{baseline:first}})()`;

const MARK_WRITE = `(()=>{const w=window.__akariGenWatch;if(!w)return false;w.markedAt=performance.now();return true})()`;

const READ_WATCH = state => `(()=>{const w=window.__akariGenWatch;if(!w)return null;
const hit=w.changes.find(c=>c.state===${S(state)});if(!hit)return null;
return{baseline:w.baseline,reached:{state:hit.state,badge:hit.badge,className:hit.className},
msFromWrite:w.markedAt===null?null:Math.round((hit.at-w.markedAt)*10)/10,
changes:w.changes.map(c=>({state:c.state,badge:c.badge}))}})()`;

const STOP_WATCH = `(()=>{const w=window.__akariGenWatch;if(!w)return false;w.observer?.disconnect();clearInterval(w.timer);delete window.__akariGenWatch;return true})()`;

async function shot(cdp, number, label) {
  const name = `${String(number).padStart(2, '0')}-${label}.png`;
  await screenshot(cdp, path.join(ROOT, name));
  out.screenshots.push(name);
  await save();
}

/** タイムライン帯だけを 2 倍で切り出す（9px のバッジ文字を証跡で読めるようにする）。 */
async function stripShot(cdp, number, label) {
  const name = `${String(number).padStart(2, '0')}-${label}.png`;
  const rect = await evalOn(cdp, `(()=>{const w=document.querySelector('.akari-annotations-widget');if(!w)return null;
const r=w.getBoundingClientRect();return{x:Math.max(0,r.left),y:Math.max(0,r.top),width:r.width,height:r.height}})()`);
  if (!rect) return shot(cdp, number, label);
  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: false,
    clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 2 }
  });
  await writeFile(path.join(ROOT, name), Buffer.from(data, 'base64'));
  out.screenshots.push(name);
  await save();
}

let spawnedChild;
async function launch() {
  await rm(ISO, { recursive: true, force: true });
  await mkdir(ISO, { recursive: true });
  await mkdir(path.join(ROOT, 'runs'), { recursive: true });
  const akariHome = path.join(ISO, 'akari-home');
  await mkdir(akariHome, { recursive: true });
  await writeFile(LOG, '');
  const child = spawn(ELECTRON, [
    SHELL_DIR, PROJECT, `--remote-debugging-port=${PORT}`, `--user-data-dir=${ISO}`, '--no-sandbox'
  ], {
    cwd: REPO,
    env: { ...process.env, AKARI_HOME: akariHome, THEIA_CONFIG_DIR: ISO },
    stdio: ['ignore', 'pipe', 'pipe']
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
  await waitEval(cdp, `Boolean(window.theia&&window.theia.container&&document.getElementById('theia-app-shell'))`, { label: 'Theia workbench', timeoutMs: 1_500_000 });
  return { child, cdp };
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
  const count = shellCommand => new Promise(resolve => {
    const child = spawn('/bin/sh', ['-c', shellCommand]);
    let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.once('close', () => resolve(Number(stdout.trim())));
  });
  const survivors = await count(`ps -eo pid,ppid,args | grep -F ${JSON.stringify(ISO)} | grep -v grep | wc -l`);
  const backendSurvivors = await count(`ps -eo pid,ppid,args | grep -F ${JSON.stringify(path.join(SHELL_DIR, 'lib/backend/main.js'))} | grep -v grep | wc -l`);
  try {
    const log = await readFile(LOG, 'utf8');
    await writeFile(LOG, sanitizeText(log));
  } catch {}
  out.cleanup = { killedPid: pid ?? null, survivingProcesses: survivors, survivingBackendMain: backendSurvivors };
  await save();
  if (survivors === 0) await rm(ISO, { recursive: true, force: true });
  return survivors;
}

// 識別はクリップのヘッダ名（= 素材ファイル名）で行う。v2 の映像 item はカットチップとして描かれ、
// data-akari-item-id はカット番号（0..5）になるため、ファイル名で束ねるほうが読み違えない。
const EXPECTED = [
  ['still.png', 'none', '静止画'],
  ['planned.png', 'planned', 'planned'],
  ['generating.png', 'generating', '生成中 62%'],
  ['stale.png', 'stale', '応答なし・再取得'],
  ['done.mp4', 'done', '生成'],
  ['failed.png', 'failed', '失敗'],
  ['next-first-last.png', 'planned-video', '▶ 動画予定'],
  ['next-first.png', 'planned-video', '▶ 動画予定'],
  ['next-prompt.png', 'planned-video', '▶ 動画予定'],
  ['next-narrow.png', 'planned-video', '▶']
];

let session;
try {
  out.fixture = JSON.parse((await run(process.execPath, [path.join(ROOT, 'scripts', 'gen-fixture.mjs')], { timeoutMs: 240_000 })).stdout.trim());
  const editPath = path.join(PROJECT, 'edit.json');
  const captionsPath = path.join(PROJECT, 'captions.json');
  const mtimesBefore = {
    edit: (await stat(editPath)).mtimeMs, captions: (await stat(captionsPath)).mtimeMs
  };
  await save();

  session = await launch();
  const { cdp } = session;
  out.preloadOverlay = await settlePreloadOverlay(cdp);
  for (let attempt = 0; attempt < 5; attempt++) {
    const closed = await evalOn(cdp, DISMISS_DIALOGS).catch(() => 0);
    if (!closed) break;
    await sleep(400);
  }
  // タイムラインが自力で開かないときだけコマンドを打つ（打つと作成ダイアログが出るため）。
  const opened = await evalOn(cdp, `document.querySelectorAll('[data-akari-generation-state]').length`).catch(() => 0);
  if (!opened) {
    await evalOn(cdp, command('akari.annotations.open')).catch(() => {});
    await sleep(1500);
    await evalOn(cdp, DISMISS_DIALOGS).catch(() => {});
  }

  await evalOn(cdp, `(()=>{
    const keys=[...window.theia.container._bindingDictionary._map.keys()];
    const key=keys.find(k=>typeof k==='function'&&typeof k.prototype?.getCurrentWidget==='function'
      &&typeof k.prototype?.addWidget==='function'&&typeof k.prototype?.activateWidget==='function');
    const shell=window.theia.container.get(key);
    window.__akariGenerationWidget=shell.widgets.find(w=>w.node?.classList.contains('akari-annotations-widget'));
    if(!window.__akariGenerationWidget)throw new Error('timeline widget unavailable');
    // 既定レイアウトでは 10 クリップが 64px 未満になり動画予定が狭幅表示へ落ちるため、タイムラインを最大化する。
    shell.toggleMaximized(window.__akariGenerationWidget);
    document.querySelector('[data-testid="akari-timeline-zoom-percent"]')?.click();
    return true;
  })()`);

  // ---- 手順 1: 6 状態が 1 枚のタイムラインに出る ----
  const six = await step('1. 映像トラックの 6 クリップが 6 種の生成状態を出す', async () => {
    let view;
    try {
      view = await waitEval(cdp, `(()=>{const v=${CLIPS};return v.count>=10?v:null})()`,
        { label: 'タイムラインに映像 6 クリップ', timeoutMs: 600_000 });
    } catch (error) {
      out.diagnostic = await evalOn(cdp, DIAGNOSTIC).catch(() => null);
      await save();
      throw error;
    }
    await evalOn(cdp, DISMISS_DIALOGS).catch(() => {});
    const byId = new Map(view.clips.map(clip => [clip.label, clip]));
    for (const [label, state, badge] of EXPECTED) {
      const clip = byId.get(label);
      assert(clip, `${label} のクリップが出ていない: ${JSON.stringify([...byId.keys()])}`);
      assert(clip.state === state, `${label} の state が ${state} でない: ${clip.state}`);
      assert(clip.badge === badge, `${label} のバッジが「${badge}」でない: ${JSON.stringify(clip.badge)}`);
      assert(clip.className.includes(`akari-generation-${state}`),
        `${label} に className akari-generation-${state} が無い: ${clip.className}`);
    }
    const planned = byId.get('planned.png');
    const generating = byId.get('generating.png');
    const stale = byId.get('stale.png');
    const failed = byId.get('failed.png');
    assert(planned.borderStyle === 'dashed', `planned の枠が点線でない: ${planned.borderStyle}`);
    assert(Number(planned.opacity) < 1, `planned が半透明でない: ${planned.opacity}`);
    assert(/repeating-linear-gradient/.test(generating.backgroundImage), `generating が縞でない: ${generating.backgroundImage}`);
    assert(/repeating-linear-gradient/.test(stale.backgroundImage), `stale が縞でない: ${stale.backgroundImage}`);
    assert(generating.progress && generating.progress.width === '62%',
      `生成中の進捗バーが 62% でない: ${JSON.stringify(generating.progress)}`);
    assert(parseFloat(generating.progress.height) > 0, `進捗バーの高さが 0: ${generating.progress.height}`);
    assert(failed.borderColor !== generating.borderColor,
      `失敗の枠色が警告色と同じ: ${failed.borderColor}`);
    // explainer §2: 静止画 = 青枠 + 青バッジ / done = 通常のクリップ（枠は既定・バッジは色を付けない）
    const still = byId.get('still.png');
    const done = byId.get('done.mp4');
    assert(still.borderColor !== generating.borderColor && still.borderColor !== failed.borderColor,
      `静止画の枠色が警告色・エラー色と同じ: ${still.borderColor}`);
    assert(still.badgeColor === still.borderColor,
      `静止画のバッジ色が枠色と揃っていない: ${still.badgeColor} / ${still.borderColor}`);
    assert(done.borderColor !== still.borderColor && done.borderColor !== generating.borderColor
      && done.borderColor !== failed.borderColor,
      `done の枠が既定でない: ${done.borderColor}`);
    assert(done.badgeColor !== still.badgeColor,
      `done のバッジに静止画と同じ色が付いている: ${done.badgeColor}`);
    assert(stale.progress === null, 'stale に進捗バーが出ている');
    return { clips: view.clips.map(clip => ({
      id: clip.id, label: clip.label, state: clip.state, badge: clip.badge, badgeColor: clip.badgeColor,
      borderStyle: clip.borderStyle, borderColor: clip.borderColor, opacity: clip.opacity,
      progress: clip.progress
    })) };
  });
  await stripShot(cdp, 1, 'six-generation-states');
  await step('動画予定 3 種は絵 2 / 1 / 0 枚、両端の絵は別で境目に鎖', async () => {
    const view = await waitEval(cdp, `(()=>{const v=${CLIPS};
      const clips=v.clips.filter(c=>c.state==='planned-video');
      return clips.length===4&&clips.every(c=>c.imageCells.every(i=>i.ready))?v:null})()`,
      {label:'動画予定の絵',timeoutMs:60000});
    for (const [label,count,linked,variety] of [
      ['next-first-last.png',2,true,'最初→最後'], ['next-first.png',1,false,'画像から'],
      ['next-prompt.png',0,false,'プロンプトだけ'], ['next-narrow.png',1,false,'画像から']
    ]) {
      const clip=view.clips.find(c=>c.label===label);
      assert(clip?.imageCellCount===count, `${label}: expected ${count} cells, got ${clip?.imageCellCount}`);
      assert(clip.linked===linked, `${label}: chain mismatch`);
      assert(clip.title===`動画予定（${variety}）`, `${label}: title mismatch`);
      assert(clip.borderStyle==='dashed', `${label}: dashed border missing`);
      if(count===2) assert(clip.imageCells[0].image!==clip.imageCells[1].image,'両端が同じ絵');
      if(count===0) assert(clip.prompt?.length>0,'プロンプトが空');
    }
    // data URI 自体は残さず、セル数・左右・取得済みの事実を記録する。
    return {clips:view.clips.map(({imageCells,...c})=>({...c,imageCells:imageCells.map(({image,...cell})=>cell)}))};
  });
  await stripShot(cdp, 4, 'planned-video-and-generation-states');
  await step('動画予定の実寸・文字の非交差・上下2列の穴・狭幅の札', async () => {
    const clips = await evalOn(cdp, PLANNED_LAYOUT);
    // Save measured rectangles even when an assertion fails, for wrapper review.
    out.plannedLayout = { holeMeasurement: 'child rects + computed gradient/opacity + frontmost ellipse-center samples', clips };
    await save();
    const rects = clips.map(c => c.rect);
    const x = Math.max(0, Math.min(...rects.map(r => r.left)) - 4);
    const y = Math.max(0, Math.min(...rects.map(r => r.top)) - 4);
    const viewport = await evalOn(cdp, `({width:innerWidth,height:innerHeight})`);
    const clip = { x, y,
      width: Math.min(viewport.width, Math.max(...rects.map(r => r.right)) + 4) - x,
      height: Math.min(viewport.height, Math.max(...rects.map(r => r.bottom)) + 4) - y, scale: 3 };
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, clip });
    const name = '07-planned-video-zoom.png';
    await writeFile(path.join(ROOT, name), Buffer.from(data, 'base64'));
    out.screenshots.push(name);
    out.plannedLayout.screenshotClip = clip;
    await save();
    assertPlannedLayout(clips);
    return out.plannedLayout;
  });

  await step('next の書き換えで再読込せず両端の絵と鎖が変わる', async () => {
    const file=path.join(GENERATED,'next-first-last.png.meta.json');
    const meta=JSON.parse(await readFile(file,'utf8'));
    const before=(await evalOn(cdp,CLIPS)).clips.find(c=>c.label==='next-first-last.png');
    await stripShot(cdp,5,'before-next-rewrite');
    await evalOn(cdp,`window.__akariGenerationBefore=document.querySelector('[data-akari-item-kind="cut"][data-akari-item-id="6"]');true`);
    meta.next.inputs={prompt:'新しい指示文 — 雲がゆっくり流れる'};
    meta.next.updated_at=new Date().toISOString();
    const started=performance.now();
    await writeFile(file,JSON.stringify(meta,null,2)+'\n');
    const after=await waitEval(cdp,`(()=>{const c=(${CLIPS}).clips.find(c=>c.label==='next-first-last.png');
      return c?.imageCellCount===0&&c.prompt===${S(meta.next.inputs.prompt)}&&!c.linked?c:null})()`,
      {label:'next 書き換えの描画',timeoutMs:30000});
    const replaced=await evalOn(cdp,`!window.__akariGenerationBefore.isConnected`);
    assert(replaced,'next 更新で keyed clip が描き直されない');
    await stripShot(cdp,6,'after-next-rewrite');
    const compact=({imageCells,...c})=>({...c,imageCells:imageCells.map(({image,...cell})=>cell)});
    return {before:compact(before),after:compact(after),nodeReplaced:replaced,elapsedMs:Math.round(performance.now()-started)};
  });

  await step('再生中の cold next サムネ取得回数は 0、停止後に取得する', async () => {
    await evalOn(cdp,`(()=>{
      const w=window.__akariGenerationWidget;
      // RPC プロキシへの代入は横取りできないため、widget の fetchThumbnail を包み、
      // キャッシュに無い planned-video キー（= 新規取得が始まる呼び出し）だけを数える。
      const original=w.fetchThumbnail;
      window.__akariGenerationThumbnailProbe={original,calls:[],startedAt:performance.now()};
      w.fetchThumbnail=function(key,cut,uri){
        if(key.startsWith('planned-video:')&&!w.thumbnailCache.has(key))
          window.__akariGenerationThumbnailProbe.calls.push({playing:w.visualPlaying,uri});
        return original.call(this,key,cut,uri);
      };
      for(const key of w.thumbnailCache.keys())if(key.startsWith('planned-video:'))w.thumbnailCache.delete(key);
      return true;
    })()`);
    // 通常のプレビュー再生通知と同じ受信口へ、時刻を進めながら通知する。
    try {
      await evalOn(cdp,`(()=>{const w=window.__akariGenerationWidget;
        w.handlePlaybackTick({videoUri:w.location.editUri.toString(),time:0,playing:true});return true})()`);
      for(let tick=0;tick<12;tick++) {
        await evalOn(cdp,`(()=>{const w=window.__akariGenerationWidget;
          w.handlePlaybackTick({videoUri:w.location.editUri.toString(),time:${tick/10},playing:true});w.renderStrip();return true})()`);
        await sleep(100);
      }
      const during=await evalOn(cdp,`(()=>{const p=window.__akariGenerationThumbnailProbe;
        return{playing:window.__akariGenerationWidget.visualPlaying,requests:p.calls.length,
          elapsedMs:Math.round(performance.now()-p.startedAt)}})()`);
      assert(during.playing,'再生状態に入っていない');
      assert(during.requests===0,`再生中にサムネ取得: ${during.requests}`);
      await evalOn(cdp,`(()=>{const w=window.__akariGenerationWidget;
        w.handlePlaybackTick({videoUri:w.location.editUri.toString(),time:1.2,playing:false});w.renderStrip();return true})()`);
      const after=await waitEval(cdp,`(()=>{const p=window.__akariGenerationThumbnailProbe;
        return p.calls.length?{requests:p.calls.length,playing:window.__akariGenerationWidget.visualPlaying}:null})()`,
        {label:'停止後のサムネ取得',timeoutMs:10000}).catch(async error=>{
          out.thumbnailDiagnostic=await evalOn(cdp,`(()=>{const w=window.__akariGenerationWidget;
            return{playing:w.visualPlaying,pointerDown:w.visualPointerDown,drag:!!w.dragState,
              cache:[...w.thumbnailCache.entries()].filter(([k])=>k.startsWith('planned-video:')).map(([k,v])=>[k.slice(-40),typeof v==='string'?v.slice(0,20):v]),
              clips:[...document.querySelectorAll('[data-akari-generation-state="planned-video"]')].map(e=>({id:e.dataset.akariItemId,
                cells:e.querySelectorAll('[data-akari-generation-frame]').length}))}})()`).catch(e=>String(e));
          throw error;
        });
      return {driver:'handlePlaybackTick',during,after};
    } finally {
      await evalOn(cdp,`(()=>{const w=window.__akariGenerationWidget,p=window.__akariGenerationThumbnailProbe;
        w.handlePlaybackTick({videoUri:w.location.editUri.toString(),time:1.2,playing:false});delete w.fetchThumbnail;
        delete window.__akariGenerationThumbnailProbe;return true})()`);
    }
  });
  await stripShot(cdp, 2, 'before-sidecar-rewrite');

  // ---- 手順 2: サイドカー書き換え → 1 秒以内にチップが変わる ----
  await step('2. planned のサイドカーを failed へ書き換えると 1 秒以内にチップが変わる', async () => {
    const installed = await evalOn(cdp, INSTALL_WATCH('planned.png'));
    assert(installed && installed.baseline.state === 'planned', `監視を仕込めない: ${JSON.stringify(installed)}`);
    await evalOn(cdp, MARK_WRITE);
    await writeFile(path.join(GENERATED, 'planned.png.meta.json'), `${JSON.stringify({
      version: 1, kind: 'still', status: 'failed',
      history: [{ at: new Date().toISOString(), status: 'failed', reason: 'timeout' }]
    }, null, 2)}\n`);
    const watch = await waitEval(cdp, READ_WATCH('failed'), { label: 'clip-planned が failed へ', timeoutMs: 30_000 });
    await evalOn(cdp, STOP_WATCH);
    assert(watch.msFromWrite !== null && watch.msFromWrite <= 1000,
      `書き換えから反映までが 1 秒を超えた: ${watch.msFromWrite}ms`);
    assert(watch.reached.badge === '失敗', `バッジが「失敗」でない: ${JSON.stringify(watch.reached.badge)}`);
    assert(watch.reached.className.includes('akari-generation-failed'),
      `className が failed でない: ${watch.reached.className}`);
    const after = await evalOn(cdp, CLIPS);
    const others = after.clips.filter(clip => clip.label !== 'planned.png');
    assert(others.length === 9, `他のクリップが消えた: ${JSON.stringify(after.clips.map(c => c.id))}`);
    for (const [label, state] of EXPECTED.filter(([label]) => label !== 'planned.png')) {
      const clip = others.find(candidate => candidate.label === label);
      assert(clip?.state === state, `${label} の state が巻き添えで変わった: ${clip?.state}`);
    }
    return { watch, afterStates: after.clips.map(clip => ({ label: clip.label, state: clip.state, badge: clip.badge })) };
  });
  await stripShot(cdp, 3, 'after-sidecar-rewrite');

  // ---- 手順 3: edit.json / captions.json を書いていない ----
  await step('3. 生成状態の表示は edit.json / captions.json を 1 バイトも書かない', async () => {
    const mtimesAfter = {
      edit: (await stat(editPath)).mtimeMs, captions: (await stat(captionsPath)).mtimeMs
    };
    assert(mtimesAfter.edit === mtimesBefore.edit, `edit.json が書かれた: ${mtimesBefore.edit} -> ${mtimesAfter.edit}`);
    assert(mtimesAfter.captions === mtimesBefore.captions,
      `captions.json が書かれた: ${mtimesBefore.captions} -> ${mtimesAfter.captions}`);
    return { mtimesBefore, mtimesAfter };
  });

  out.expected = EXPECTED.map(([label, state, badge]) => ({ label, state, badge }));
  out.sixStates = six.clips;
  out.status = 'pass';
  await save();
} catch (error) {
  out.status = 'fail';
  out.error = sanitize(error);
  try {
    if (session?.cdp) {
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
    out.status = out.status === 'pass' ? 'fail' : out.status;
    out.cleanupError = `surviving processes: ${survivors}`;
    await save();
    process.exitCode = 1;
  }
}
