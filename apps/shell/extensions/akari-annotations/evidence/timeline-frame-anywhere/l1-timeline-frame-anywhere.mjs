#!/usr/bin/env node
// Build the shell bundle first. No provider/paid calls. Node >=22 (native WebSocket).
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, screenshot, realClick } from './cdp-lib.mjs';
import { createFixture } from './gen-fixture.mjs';
import { validateGenerationMeta } from '../../../../../../packages/generate/src/cli/meta-validate.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(ROOT, '../../../../../..');
const SHELL = path.join(REPO, 'apps/shell');
const ISO = await mkdtemp(path.join(tmpdir(), 'akari-frame-anywhere-l1-'));
const PROJECT = path.join(ISO, 'project');
const PORT = Number(process.argv.find(x => x.startsWith('--port='))?.slice(7) ?? 22218);
const output = { status: 'running', driver: 'Electron + CDP Input.dispatchMouseEvent', steps: [], screenshots: [], falRequests: [] };
const started = performance.now();
let child, cdp;
let log = '';
const clean = text => String(text).replaceAll(ISO, '<TEMP>').replaceAll(REPO, '<WORKTREE>');
const save = () => writeFile(path.join(ROOT, 'measurements.json'), clean(JSON.stringify(output, null, 2)) + '\n');
async function waitFor(operation, timeout = 90000) {
  const deadline = Date.now() + timeout;
  let error;
  while (Date.now() < deadline) {
    try { const value = await operation(); if (value) return value; } catch (e) { error = e; }
    await sleep(150);
  }
  throw new Error(`Timed out: ${error?.message ?? 'condition'}`);
}
const evaluate = expression => evalOn(cdp, expression);
const waitEval = (expression, timeout) => waitFor(() => evaluate(expression), timeout);
const readEdit = async () => JSON.parse(await readFile(path.join(PROJECT, 'edit.json'), 'utf8'));
async function step(name, operation, continueOnFailure = false) {
  const result = { name, pass: false }; output.steps.push(result);
  const start = performance.now();
  try { result.measurements = await operation(); result.pass = true; }
  catch (error) { result.error = clean(error.stack ?? error); if (!continueOnFailure) throw error; }
  finally { result.elapsedMs = Math.round(performance.now() - start); await save(); }
}
async function shot(name) {
  await screenshot(cdp, path.join(ROOT, name)); output.screenshots.push(name); await save();
}
async function key(key, code, modifiers = 0) {
  const params = { key, code, modifiers, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) };
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...params });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
}
async function dismissOverlappingNotifications(x, y, action) {
  // Theia renders toasts as list items inside .theia-notifications-container.
  // Check the actual press point, rather than clearing unrelated notifications.
  const check = await evaluate(`(async()=>{
    const x=${JSON.stringify(x)},y=${JSON.stringify(y)};
    const items=[...document.querySelectorAll('.theia-notifications-container.open .theia-notification-list-item-container')]
      .filter(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);
        return r.width>0&&r.height>0&&x>=r.left&&x<r.right&&y>=r.top&&y<r.bottom
          &&s.display!=='none'&&s.visibility==='visible'&&Number(s.opacity)!==0;});
    const overlaps=items.map(e=>({text:e.textContent.trim().slice(0,200),
      rect:(()=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom};})()}));
    let closedByButton=0;
    for(const item of items){const button=item.querySelector('.theia-notification-actions .codicon-close');
      if(button){button.click();closedByButton++;}}
    let clearedAll=false;
    if(closedByButton<items.length){
      const c=window.theia?.container,k=[...c._bindingDictionary._map.keys()]
        .find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');
      if(!k)throw new Error('Theia CommandService unavailable for notification dismissal');
      await c.get(k).executeCommand('notifications.commands.clearAll');clearedAll=true;
    }
    return {overlaps,closedByButton,clearedAll};
  })()`);
  const record = { action, point: { x, y }, ...check, remaining: null };
  (output.steps.at(-1).notificationChecks ??= []).push(record);
  if (check.overlaps.length) {
    await waitFor(async () => {
      const remaining = await evaluate(`(()=>[...document.querySelectorAll('.theia-notifications-container.open .theia-notification-list-item-container')]
        .filter(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);
          return r.width>0&&r.height>0&&${JSON.stringify(x)}>=r.left&&${JSON.stringify(x)}<r.right
            &&${JSON.stringify(y)}>=r.top&&${JSON.stringify(y)}<r.bottom
            &&s.display!=='none'&&s.visibility==='visible'&&Number(s.opacity)!==0;}).length)()`);
      record.remaining = remaining;
      return remaining === 0;
    });
  } else record.remaining = 0;
}
async function point(time, lane = 'video') {
  return evaluate(`(()=>{const w=window.__akariFrameWidget,r=w.strip.getBoundingClientRect(),
    rows=[...w.laneLayout.tracks].sort((a,b)=>a.top-b.top),l=rows.find(l=>l.id==='${lane}');
    const y='${lane}'==='above'?rows[0].top-12:'${lane}'==='below'?
      rows[rows.length-1].top+rows[rows.length-1].height+12:l.top+l.height/2;
    return {x:r.left+(${time}-w.viewStart)*r.width/w.visibleDuration(),y:r.top+y,
      stripLeft:r.left,stripRight:r.right,windowHeight:innerHeight,
      viewStart:w.viewStart,visibleDuration:w.visibleDuration(),
      pxPerSecond:r.width/w.visibleDuration(),trackHeight:l?.height};})()`);
}
function assertDragPoint(p, time, lane) {
  assert.ok(Number.isFinite(p.x) && p.x > p.stripLeft && p.x < p.stripRight
    && Number.isFinite(p.y) && p.y > 0 && p.y < p.windowHeight,
  `ドラッグ座標が画面外です: ${JSON.stringify({ time, lane, x: p.x, y: p.y,
    stripLeft: p.stripLeft, stripRight: p.stripRight, windowHeight: p.windowHeight,
    viewStart: p.viewStart, visibleDuration: p.visibleDuration })}`);
}
async function down(time, lane) {
  const p = await point(time, lane);
  assertDragPoint(p, time, lane);
  await dismissOverlappingNotifications(p.x, p.y, `drag ${lane} at ${time}s`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
  return p;
}
async function move(from, to, lane) {
  for (let i = 1; i <= 12; i++) {
    const p = await point(from + (to - from) * i / 12, lane);
    assertDragPoint(p, from + (to - from) * i / 12, lane);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'left', buttons: 1 });
    await sleep(20);
  }
}
async function up(time, lane) {
  const p = await point(time, lane);
  assertDragPoint(p, time, lane);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 });
}
const DRAW = `(()=>{const e=document.querySelector('.akari-annotations-frame-draw');if(!e)return null;
 const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {text:e.textContent,
 rect:{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height},
 display:s.display,borderStyle:s.borderTopStyle,borderColor:s.borderTopColor,background:s.backgroundColor};})()`;
const BUTTONS = `(()=>{return [...document.querySelectorAll('.akari-annotations-widget button[aria-label]')]
 .filter(e=>['選択ツール','分割ツール','仮枠ツール','元に戻す'].includes(e.getAttribute('aria-label')))
 .map(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();
 const opaque=c=>c!=='transparent'&&!/rgba\\([^)]*,\\s*0\\)/.test(c);
 return {label:e.getAttribute('aria-label'),pressed:e.getAttribute('aria-pressed'),width:r.width,height:r.height,
 left:r.left,right:r.right,top:r.top,bottom:r.bottom,
 background:s.backgroundColor,border:s.borderTopColor,borderWidth:s.borderTopWidth,
 painted:opaque(s.backgroundColor)||(parseFloat(s.borderTopWidth)>0&&s.borderTopStyle!=='none'&&opaque(s.borderTopColor))};});})()`;
// Shared DOM measurements preserve actual text bounds and ancestor visibility.
const GEOMETRY = `
 const rect=n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
 const visible=n=>{if(!n||!n.getClientRects().length)return false;const r=n.getBoundingClientRect();
   if(r.width<=0||r.height<=0||r.right<=0||r.bottom<=0||r.left>=innerWidth||r.top>=innerHeight)return false;
   for(let a=n;a instanceof Element;a=a.parentElement){const s=getComputedStyle(a);
     if(s.display==='none'||s.visibility!=='visible'||Number(s.opacity)===0)return false;}return true;};
 const measure=n=>({role:n.className,text:n.textContent,...rect(n)});
`;
const DRAW_TEXT_RECTS = `(()=>{${GEOMETRY}
 const e=document.querySelector('.akari-annotations-frame-draw');if(!visible(e))return null;
 const text=document.createRange();text.selectNodeContents(e);
 const widget=e.closest('.akari-annotations-widget');
 return {text:{text:e.textContent,...rect(text)},frame:rect(e),
   obstacles:[...widget.querySelectorAll('[data-akari-generation-badge],.akari-clip-kind-badge,button')].filter(visible).map(measure)};
})()`;
const CHIP_TEXT_RECTS = `(()=>{${GEOMETRY}
 return [...document.querySelectorAll('.akari-annotations-widget [data-akari-generation-state][data-akari-item-kind]')]
 .filter(e=>visible(e)&&(e.dataset.akariGenerationState==='planned'||
   e.querySelector('.akari-annotations-strip-clip-header-label')?.textContent.includes('neighbor.png')))
 .map(e=>({state:e.dataset.akariGenerationState,itemId:e.dataset.akariItemId,
   label:e.querySelector('.akari-annotations-strip-clip-header-label')?.textContent,
   rects:[...e.querySelectorAll('[data-akari-generation-badge],.akari-annotations-strip-clip-header-label,.akari-annotations-strip-clip-header-duration,.akari-clip-kind-badge')]
     .filter(visible).map(measure)}));
})()`;
const intersects = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > .1
  && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > .1;
const overlapPairs = rects => rects.flatMap((a, i) => rects.slice(i + 1)
  .filter(b => intersects(a, b)).map(b => ({ a, b })));
async function checkDrawLayout() {
  const drawing = await waitEval(DRAW_TEXT_RECTS), buttons = await evaluate(BUTTONS);
  const measurement = { drawing, buttons, buttonOverlaps: overlapPairs(buttons),
    textOverlaps: drawing.obstacles.filter(rect => intersects(drawing.text, rect)) };
  (output.frameToolLayout ??= []).push(measurement); await save();
  assert.equal(buttons.length, 4);
  assert.equal(measurement.buttonOverlaps.length, 0, 'toolbar buttons intersect');
  assert.equal(measurement.textOverlaps.length, 0, 'frame drawing text intersects a badge or button');
  assert.ok(drawing.text.width > 0 && drawing.text.height > 0);
  assert.ok(drawing.text.left >= drawing.frame.left && drawing.text.right <= drawing.frame.right
    && drawing.text.top >= drawing.frame.top && drawing.text.bottom <= drawing.frame.bottom, 'drawing text escapes its rectangle');
  return measurement;
}
async function recordPreExistingChipOverlap() {
  // Informational only: shared chip CSS is outside this task's ownership. Continue on failure.
  try {
    const chips = await evaluate(CHIP_TEXT_RECTS);
    output.preExistingChipOverlap = { affectsVerdict: false,
      chips: chips.map(chip => ({ ...chip, overlaps: overlapPairs(chip.rects) })) };
  } catch (error) {
    output.preExistingChipOverlap = { affectsVerdict: false, error: clean(error.stack ?? error) };
  }
  await save();
}
async function listOwnedProcesses() {
  const { stdout } = await promisify(execFile)('/bin/ps', ['-axo', 'pid=,command='], { timeout: 5000, maxBuffer: 8 * 1024 * 1024 });
  return stdout.split('\n').flatMap(line => {
    const match = line.match(/^\s*(\d+)\s+(.+)$/);
    if (!match || !match[2].includes(ISO) || Number(match[1]) === process.pid) return [];
    return [{ pid: Number(match[1]), command: match[2] }];
  });
}
async function stopElectron() {
  // Helpers may keep these pipes open after their parent exits, even in another process group.
  child?.stdout?.destroy(); child?.stderr?.destroy();
  const cleanup = { pid: child?.pid ?? null, signals: [], survivors: [],
    isolatedAkariHome: true, isolatedUserData: true };
  const signalPid = (pid, signal) => {
    try { process.kill(pid, signal); cleanup.signals.push({ pid, signal }); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  try {
    // Discover before terminating the main process, then rescan for helpers that changed groups.
    cleanup.before = await listOwnedProcesses();
    if (child?.pid && child.exitCode === null && child.signalCode === null) signalPid(child.pid, 'SIGTERM');
    for (const entry of cleanup.before) if (entry.pid !== child?.pid) signalPid(entry.pid, 'SIGTERM');
    await sleep(1500);
    for (let attempt = 0; attempt < 3; attempt++) {
      const remaining = await listOwnedProcesses();
      if (!remaining.length) break;
      for (const entry of remaining) signalPid(entry.pid, 'SIGKILL');
      await sleep(500);
    }
    cleanup.survivors = await listOwnedProcesses();
    cleanup.exited = (!child?.pid || child.exitCode !== null || child.signalCode !== null) && cleanup.survivors.length === 0;
  } catch (error) {
    cleanup.error = clean(error.stack ?? error); cleanup.exited = false;
  } finally {
    child?.unref();
  }
  output.cleanup = cleanup;
  if (!cleanup.exited) { output.status = 'fail'; process.exitCode = 1; }
  else await rm(ISO, { recursive: true, force: true });
}
async function lint() {
  const result = await new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [path.join(REPO, 'packages/edit-lint/bin/edit-lint.mjs'), PROJECT, '--json'],
      { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    proc.stdout.on('data', c => { stdout += c; }); proc.stderr.on('data', c => { stderr += c; });
    proc.once('error', reject); proc.once('close', code => resolve({ code, stdout, stderr }));
  });
  output.lint = result; await save();
  assert.equal(result.code, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout); assert.equal(parsed.verdict, 'pass');
  return parsed;
}
try {
  const initial = await createFixture(PROJECT);
  await mkdir(path.join(ISO, 'akari-home'), { recursive: true });
  const candidates = [SHELL, REPO].map(base => path.join(base, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'));
  const electron = process.env.AKARI_L1_ELECTRON || (await stat(candidates[0]).catch(() => null))?.isFile() && candidates[0] || candidates[1];
  child = spawn(electron, [SHELL, PROJECT, `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(ISO, 'userdata')}`, '--no-sandbox'], {
    cwd: REPO, env: { ...process.env, AKARI_HOME: path.join(ISO, 'akari-home'), THEIA_CONFIG_DIR: path.join(ISO, 'config'),
      FAL_KEY: '', FAL_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32'
  });
  let launchError;
  child.once('error', e => { launchError = e; });
  child.stdout.on('data', c => { log += c; }); child.stderr.on('data', c => { log += c; });
  const target = await waitFor(async () => {
    if (launchError || child.exitCode !== null) throw launchError ?? new Error(`Electron exited ${child.exitCode}`);
    return (await listTargets(PORT)).find(t => t.type === 'page');
  }, 180000);
  cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect();
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
  await cdp.send('Network.setBlockedURLs', { urls: ['*://*.fal.ai/*', '*://fal.ai/*', '*://*.fal.run/*'] });
  cdp.on('Network.requestWillBeSent', e => { if (/https?:\/\/[^/]*fal\.(ai|run)\//.test(e.request.url)) output.falRequests.push(e.request.url); });
  await waitEval(`Boolean(window.theia?.container&&document.getElementById('theia-app-shell'))`, 180000);
  await waitEval(`(()=>{const e=document.querySelector('.theia-preload');if(!e)return true;
    const s=getComputedStyle(e);return e.classList.contains('theia-hidden')||s.display==='none'||Number(s.opacity)===0;})()`, 180000);
  const dismissDialogs = `(()=>{for(const d of document.querySelectorAll('.dialogBlock')){
    const b=[...d.querySelectorAll('button')].find(b=>/キャンセル|Cancel|閉じる|Close/.test(b.textContent));b?.click();}return true;})()`;
  await evaluate(dismissDialogs);
  if (!await evaluate(`Boolean(document.querySelector('.akari-annotations-widget'))`)) {
    await evaluate(`(()=>{const c=window.theia.container,k=[...c._bindingDictionary._map.keys()]
      .find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');
      void c.get(k).executeCommand('akari.annotations.open');return true;})()`);
    await sleep(500); await evaluate(dismissDialogs);
  }
  await waitEval(`Boolean(document.querySelector('.akari-annotations-widget'))`, 180000);
  await evaluate(`(()=>{const c=window.theia.container,k=[...c._bindingDictionary._map.keys()].find(k=>typeof k==='function'&&k.prototype?.getCurrentWidget&&k.prototype?.addWidget&&k.prototype?.activateWidget);
    const s=c.get(k),w=s.widgets.find(w=>w.node?.classList.contains('akari-annotations-widget'));
    window.__akariFrameShell=s;window.__akariFrameWidget=w;s.toggleMaximized(w);w.activate();
    document.querySelector('[data-testid="akari-timeline-zoom-percent"]')?.click();return true;})()`);
  await waitEval(`window.__akariFrameWidget.cutItemIds.length===2`, 180000);
  output.timelineView = await evaluate(`(()=>{const w=window.__akariFrameWidget;
    return {viewStart:w.viewStart,visibleDuration:w.visibleDuration()};})()`);
  await save();
  const headers = () => evaluate(`(()=>[...document.querySelectorAll('.akari-track-header-row[data-akari-timeline-track-id]')]
    .map(e=>({id:e.dataset.akariTimelineTrackId,name:e.querySelector('.akari-track-header-name')?.textContent,
      top:e.getBoundingClientRect().top})).sort((a,b)=>a.top-b.top))()`);
  const waitHeaders = (ids, expected) => waitFor(async () => {
    const names = await headers();
    return names.filter(x => ids.includes(x.id)).map(x => x.name).join('\u0000') === expected.join('\u0000') && names;
  });
  const itemDom = (itemId, cutIndex = -1) => evaluate(`(()=>{
    const id=${JSON.stringify(itemId)},cutIndex=${JSON.stringify(cutIndex)};
    const matches=[...document.querySelectorAll('.akari-annotations-widget [data-akari-item-id]')]
      .filter(e=>e.dataset.akariItemId===id||(cutIndex>=0
        &&e.matches('.akari-annotations-strip-clip[data-akari-item-kind="cut"]')
        &&e.dataset.akariItemId===String(cutIndex)));
    return {count:matches.length,elements:matches.map(e=>({itemId:e.dataset.akariItemId,
      itemKind:e.dataset.akariItemKind,className:e.className}))};
  })()`);
  const undoDom = (expectedHeaders, removedTrackId, removedItemId, cutIndex = -1) => waitFor(async () => {
    const current = await headers();
    const removedItemDom = await itemDom(removedItemId, cutIndex);
    const settled = current.length === expectedHeaders.length
      && current.every((row, index) => row.id === expectedHeaders[index].id
        && row.name === expectedHeaders[index].name)
      && !current.some(row => row.id === removedTrackId)
      && removedItemDom.count === 0;
    return settled ? { headers: current, removedItemDom } : null;
  });
  const band = () => evaluate(`(()=>{const b=document.querySelector('.akari-annotations-frame-new-track'),
    l=b?.querySelector('.akari-annotations-frame-new-track-label'),d=document.querySelector('.akari-annotations-frame-draw');
    if(!b||!l||!d)return null;const r=e=>{const x=e.getBoundingClientRect();return{left:x.left,right:x.right,top:x.top,bottom:x.bottom,width:x.width,height:x.height}};
    return {band:r(b),label:{text:l.textContent,...r(l)},drawing:r(d),
      chips:[...document.querySelectorAll('[data-akari-generation-badge]')]
        .filter(e=>e.getClientRects().length).map(e=>({text:e.textContent,...r(e)}))};})()`);
  const undo = async () => {
    const p = await evaluate(`(()=>{const b=document.querySelector('.akari-annotations-widget button[aria-label="元に戻す"]'),r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await dismissOverlappingNotifications(p.x, p.y, 'undo click');
    await realClick(cdp, p.x, p.y);
  };
  await step('F selects frame tool', async () => {
    await key('f', 'KeyF');
    const pressed = await waitEval(`document.querySelector('.akari-annotations-widget button[aria-label="仮枠ツール"]')?.getAttribute('aria-pressed')`);
    assert.equal(pressed, 'true'); return { pressed };
  });
  await shot('01-tool.png');
  await step('A1 audio drag shows green dashed 2.5 seconds', async () => {
    await down(2, 'audio'); await move(2, 4.3, 'audio');
    const drawing = await waitFor(async () => {
      const value = await evaluate(DRAW);
      return value?.text === '2.5 秒' && value.borderStyle === 'dashed' ? value : null;
    });
    assert.equal(drawing.text, '2.5 秒');
    assert.equal(drawing.borderStyle, 'dashed'); assert.equal(drawing.borderColor, 'rgb(107, 214, 160)');
    return drawing;
  });
  await shot('02-audio-drawing.png'); await up(4.3, 'audio');
  await step('A1 gets silent wav and planned audio meta', async () => {
    const edit = await waitFor(async () => { const e = await readEdit(); return e.tracks[0].items.length === 2 && e; });
    const item = edit.tracks[0].items.find(i => i.id !== 'voice-1');
    assert.equal(item.role, 'narration'); assert.equal(item.duration, 75); assert.equal(item.name, '空の枠（音）');
    const source = edit.sources.find(s => s.id === item.source.src); assert.match(source.path, /^assets\/generated\/frame-audio-.*\.wav$/);
    const meta = JSON.parse(await readFile(path.join(PROJECT, `${source.path}.meta.json`), 'utf8'));
    assert.equal(meta.kind, 'audio'); assert.equal(meta.status, 'planned'); assert.ok(validateGenerationMeta(meta).ok);
    const chip = await waitEval(`(()=>{const e=[...document.querySelectorAll('[data-akari-generation-badge]')]
      .find(e=>e.textContent.includes('空の枠（音）'));return e?.textContent;})()`);
    assert.equal(chip, '空の枠（音）'); output.audioChip = chip; return { item, source, chip };
  });
  await shot('03-audio-created.png');
  await step('above V1 shows provisional V2 band and label', async () => {
    await down(3, 'above'); await move(3, 6, 'above');
    const measured = await waitFor(async () => {
      const value = await band(); return value?.label.text === '新しい映像トラック V2' ? value : null;
    });
    assert.equal(measured.label.text, '新しい映像トラック V2');
    assert.ok(measured.band.width > 0 && measured.band.height > 0);
    assert.equal(intersects(measured.label, measured.drawing), false);
    measured.chipLabelOverlaps = measured.chips.filter(chip => intersects(measured.label, chip));
    assert.equal(measured.chipLabelOverlaps.length, 0);
    output.visualBand = measured; return measured;
  });
  await shot('04-visual-band.png'); await up(6, 'above');
  await step('V2 inserted above V1', async () => {
    const edit = await waitFor(async () => { const e = await readEdit(); return e.tracks.length === 3 && e; });
    assert.equal(edit.tracks[2].lane, 'visual'); assert.equal(edit.tracks[2].items.length, 1);
    const names = await waitHeaders(['video', edit.tracks[2].id], ['V2', 'V1']);
    assert.deepEqual(names.filter(x=>['video', edit.tracks[2].id].includes(x.id)).map(x=>x.name), ['V2', 'V1']);
    output.trackHeaders = names; return { newTrack: edit.tracks[2], names };
  });
  await shot('05-visual-created.png');
  await step('below A1 shows provisional A2 band and label', async () => {
    await down(5, 'below'); await move(5, 7, 'below');
    const measured = await waitFor(async () => {
      const value = await band(); return value?.label.text === '新しい音声トラック A2' ? value : null;
    });
    assert.equal(measured.label.text, '新しい音声トラック A2');
    assert.ok(measured.band.width > 0 && measured.band.height > 0);
    assert.equal(intersects(measured.label, measured.drawing), false);
    measured.chipLabelOverlaps = measured.chips.filter(chip => intersects(measured.label, chip));
    assert.equal(measured.chipLabelOverlaps.length, 0);
    output.audioBand = measured; return measured;
  });
  await shot('06-audio-band.png'); await up(7, 'below');
  await step('A2 inserted below A1; A1 keeps its name', async () => {
    const edit = await waitFor(async () => { const e = await readEdit(); return e.tracks.length === 4 && e; });
    assert.equal(edit.tracks[0].lane, 'audio'); assert.equal(edit.tracks[0].items.length, 1);
    const names = await waitHeaders([edit.tracks[0].id, 'audio'], ['A1', 'A2']);
    assert.deepEqual(names.filter(x=>[edit.tracks[0].id, 'audio'].includes(x.id)).map(x=>x.name), ['A1', 'A2']);
    output.trackHeaders = names; return { newTrack: edit.tracks[0], names };
  });
  await shot('07-audio-track-created.png');
  await step('edit lint passes', lint);
  await step('two single undo actions remove A2 then V2 with their sources/items', async () => {
    const beforeUndo = await readEdit();
    assert.equal(beforeUndo.tracks.length, 4);
    const a2 = beforeUndo.tracks[0], v2 = beforeUndo.tracks[3];
    assert.equal(a2.items.length, 1); assert.equal(v2.items.length, 1);
    const a2ItemId = a2.items[0].id, v2ItemId = v2.items[0].id;
    const v2CutIndex = await evaluate(`window.__akariFrameWidget.cutItemIds.indexOf(${JSON.stringify(v2ItemId)})`);
    assert.ok(v2CutIndex >= 0, `${v2ItemId}: cut index unavailable`);
    const beforeUndoDom = { a2: await itemDom(a2ItemId), v2: await itemDom(v2ItemId, v2CutIndex) };
    assert.ok(beforeUndoDom.a2.count > 0, `${a2ItemId}: audio clip absent before undo`);
    assert.ok(beforeUndoDom.v2.count > 0, `${v2ItemId}: visual clip absent before undo`);
    await undo();
    const once = await waitFor(async () => { const e = await readEdit(); return e.tracks.length === 3 && e; });
    assert.equal(once.tracks[0].id, 'audio');
    const afterFirstDom = await undoDom([
      { id: v2.id, name: 'V2' }, { id: 'video', name: 'V1' }, { id: 'audio', name: 'A1' }
    ], a2.id, a2ItemId);
    await shot('08-after-audio-undo.png');
    await undo();
    const twice = await waitFor(async () => { const e = await readEdit(); return e.tracks.length === 2 && e; });
    assert.deepEqual(twice.tracks.map(t=>t.id), initial.tracks.map(t=>t.id));
    assert.equal(twice.sources.length, initial.sources.length + 1);
    const afterSecondDom = await undoDom([
      { id: 'video', name: 'V1' }, { id: 'audio', name: 'A1' }
    ], v2.id, v2ItemId, v2CutIndex);
    await shot('09-after-visual-undo.png');
    return { afterFirst: once.tracks.map(t=>t.id), afterSecond: twice.tracks.map(t=>t.id),
      afterFirstHeaders: afterFirstDom.headers, afterFirstRemovedItemDom: afterFirstDom.removedItemDom,
      afterSecondHeaders: afterSecondDom.headers, afterSecondRemovedItemDom: afterSecondDom.removedItemDom,
      removedItems: { a2ItemId, v2ItemId, v2CutIndex }, beforeUndoDom, sources: twice.sources.length };
  });
  assert.equal(output.falRequests.length, 0);
  assert.ok(output.screenshots.length >= 6);
  output.status = output.steps.every(step => step.pass) ? 'pass' : 'fail';
  if (output.status === 'fail') process.exitCode = 1;
} catch (error) {
  output.status = 'fail'; output.error = clean(error.stack ?? error);
  if (cdp) await shot('99-failure.png').catch(() => {});
  process.exitCode = 1;
} finally {
  cdp?.close();
  await stopElectron();
  await writeFile(path.join(ROOT, 'electron.log'), clean(log));
  output.elapsedMs = Math.round(performance.now() - started); await save();
}
