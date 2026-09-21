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
import { CDP, evalOn, listTargets, screenshot, realClick } from '../generation-states/scripts/cdp-lib.mjs';
import { createFixture } from './gen-fixture.mjs';
import { validateGenerationMeta } from '../../../../../../packages/generate/src/cli/meta-validate.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(ROOT, '../../../../../..');
const SHELL = path.join(REPO, 'apps/shell');
const ISO = await mkdtemp(path.join(tmpdir(), 'akari-frame-tool-l1-'));
const PROJECT = path.join(ISO, 'project');
const PORT = Number(process.argv.find(x => x.startsWith('--port='))?.slice(7) ?? 22217);
const output = { status: 'running', driver: 'Electron + CDP Input.dispatchMouseEvent', steps: [], screenshots: [], falRequests: [] };
const started = performance.now();
let child, cdp;
let log = '';
const clean = text => String(text).replaceAll(ISO, '<TEMP>').replaceAll(REPO, '<WORKTREE>');
const save = () => writeFile(path.join(ROOT, 'measurements.json'), clean(JSON.stringify(output, null, 2)) + '\n');
async function waitFor(operation, timeout = 60000) {
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
async function point(time) {
  return evaluate(`(()=>{const w=window.__akariFrameWidget,r=w.strip.getBoundingClientRect(),
    l=w.laneLayout.tracks.find(l=>l.id==='video');
    return {x:r.left+(${time}-w.viewStart)*r.width/w.visibleDuration(),y:r.top+l.top+l.height/2,
      pxPerSecond:r.width/w.visibleDuration(),trackHeight:l.height};})()`);
}
async function down(time) {
  const p = await point(time);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
  return p;
}
async function move(from, to) {
  for (let i = 1; i <= 12; i++) {
    const p = await point(from + (to - from) * i / 12);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'left', buttons: 1 });
    await sleep(20);
  }
}
async function up(time) {
  const p = await point(time);
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
  const initialCount = initial.tracks[0].items.length;
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
  }, 600000);
  cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect();
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
  await cdp.send('Network.setBlockedURLs', { urls: ['*://*.fal.ai/*', '*://fal.ai/*', '*://*.fal.run/*'] });
  cdp.on('Network.requestWillBeSent', e => { if (/https?:\/\/[^/]*fal\.(ai|run)\//.test(e.request.url)) output.falRequests.push(e.request.url); });
  await waitEval(`Boolean(window.theia?.container&&document.getElementById('theia-app-shell'))`, 900000);
  await waitEval(`(()=>{const e=document.querySelector('.theia-preload');return !e||e.classList.contains('theia-hidden');})()`, 900000);
  const dismissDialogs = `(()=>{for(const d of document.querySelectorAll('.dialogBlock')){
    const b=[...d.querySelectorAll('button')].find(b=>/キャンセル|Cancel|閉じる|Close/.test(b.textContent));b?.click();}return true;})()`;
  await evaluate(dismissDialogs);
  if (!await evaluate(`Boolean(document.querySelector('.akari-annotations-widget'))`)) {
    await evaluate(`(()=>{const c=window.theia.container,k=[...c._bindingDictionary._map.keys()]
      .find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');
      void c.get(k).executeCommand('akari.annotations.open');return true;})()`);
    await sleep(500); await evaluate(dismissDialogs);
  }
  await waitEval(`Boolean(document.querySelector('.akari-annotations-widget'))`);
  await evaluate(`(()=>{const c=window.theia.container,k=[...c._bindingDictionary._map.keys()].find(k=>typeof k==='function'&&k.prototype?.getCurrentWidget&&k.prototype?.addWidget&&k.prototype?.activateWidget);
    const s=c.get(k),w=s.widgets.find(w=>w.node?.classList.contains('akari-annotations-widget'));
    window.__akariFrameShell=s;window.__akariFrameWidget=w;s.toggleMaximized(w);w.activate();
    document.querySelector('[data-testid="akari-timeline-zoom-percent"]')?.click();return true;})()`);
  await waitEval(`window.__akariFrameWidget.cutItemIds.length===2`);
  // Keep the real scale/coordinates; do not call the draw/mutation methods from CDP.
  await step('F selects the frame tool; buttons have a painted background or border', async () => {
    await key('f', 'KeyF');
    const buttons = await waitEval(`(()=>{const b=${BUTTONS};return b.find(b=>b.label==='仮枠ツール')?.pressed==='true'?b:null;})()`);
    output.buttons = buttons; await save();
    assert.equal(buttons.length, 4); assert.ok(buttons.every(b => b.painted && b.width > 0 && b.height > 0));
    return buttons;
  });
  await shot('01-frame-tool.png');
  await step('2.3-second real drag paints a dashed 2.5-second rectangle', async () => {
    const origin = await down(2); await move(2, 4.3);
    const drawing = await waitEval(DRAW); output.drawing = drawing;
    assert.equal(drawing.text, '2.5 秒'); assert.equal(drawing.display, 'flex'); assert.equal(drawing.borderStyle, 'dashed');
    assert.ok(Math.abs(drawing.rect.width / origin.pxPerSecond - 2.5) < .02);
    return { origin, rawDragSeconds: 2.3, drawing };
  });
  await step('new drawing text and toolbar buttons do not intersect badges or each other', checkDrawLayout);
  await shot('02-drawing-2.5-seconds.png');
  await up(4.3);
  let inserted;
  await step('release adds one item and one real PNG source with valid empty metadata', async () => {
    inserted = await waitFor(async () => { const e = await readEdit(); return e.tracks[0].items.length === initialCount + 1 && e; });
    const item = inserted.tracks[0].items.find(i => !initial.tracks[0].items.some(b => b.id === i.id));
    assert.equal(inserted.sources.length, initial.sources.length + 1);
    assert.equal(item.at, 60); assert.equal(item.duration, 75); assert.equal(item.source.out, 2.5);
    const src = inserted.sources.find(s => s.id === item.source.src); assert.match(src.path, /^assets\/generated\/frame-.*\.png$/);
    const png = await readFile(path.join(PROJECT, src.path));
    const meta = JSON.parse(await readFile(path.join(PROJECT, `${src.path}.meta.json`), 'utf8'));
    assert.ok(validateGenerationMeta(meta).ok); assert.equal(meta.inputs.prompt, ''); assert.equal(meta.status, 'planned');
    assert.equal(png.readUInt32BE(16), 640); assert.equal(png.readUInt32BE(20), 360);
    const badge = await waitEval(`document.querySelector('[data-akari-generation-state="planned"] [data-akari-generation-badge]')?.textContent`);
    assert.equal(badge, 'planned');
    assert.equal(await evaluate(`window.__akariFrameWidget.toolMode`), 'frame');
    return { item, source: src, pngBytes: png.length, meta, badge };
  });
  await recordPreExistingChipOverlap();
  await shot('03-created-frame.png');
  await step('existing initialTabFor opens generation tab', async () => {
    // Restore the normal split only for observing the right pane; all timeline screenshots use maximization.
    await evaluate(`window.__akariFrameShell.toggleMaximized(window.__akariFrameWidget);true`);
    const tab = await waitEval(`(()=>{${GEOMETRY}
      const panel=document.querySelector('[data-akari-ui="panel:inspector"]');
      if(!visible(panel)||panel.offsetParent===null)return null;
      const e=[...panel.querySelectorAll('[role="tab"]')].find(e=>e.textContent.trim()==='生成');
      if(!visible(e)||e.getAttribute('aria-selected')!=='true')return null;
      return {panel:{visible:true,...rect(panel)},text:e.textContent,selected:e.getAttribute('aria-selected'),...rect(e)};})()`);
    await shot('04-generation-tab.png'); return { ...tab, usedInitialTabFor: true };
  });
  await step('edit lint passes with the inserted frame', lint);
  await evaluate(`window.__akariFrameShell.toggleMaximized(window.__akariFrameWidget);window.__akariFrameWidget.activate();true`);
  await step('one undo removes both item and source', async () => {
    const p = await evaluate(`(()=>{const b=document.querySelector('.akari-annotations-widget button[aria-label="元に戻す"]'),r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await realClick(cdp, p.x, p.y);
    const undone = await waitFor(async () => { const e = await readEdit(); return e.tracks[0].items.length === initialCount && e; });
    assert.deepEqual(undone.tracks, initial.tracks); assert.deepEqual(undone.sources, initial.sources);
    return { itemCount: undone.tracks[0].items.length, sourceCount: undone.sources.length, undoClicks: 1 };
  });
  await shot('05-after-undo.png');
  await step('real drag toward adjacent clip stops exactly at its edge', async () => {
    const origin = await down(6); await move(6, 9);
    const drawing = await waitEval(DRAW), edge = await point(8);
    assert.equal(drawing.text, '2.0 秒'); assert.ok(Math.abs(drawing.rect.right - edge.x) < 1);
    await checkDrawLayout();
    await shot('06-stopped-at-neighbor.png'); await up(9);
    const edit = await waitFor(async () => { const e = await readEdit(); return e.tracks[0].items.length === initialCount + 1 && e; });
    const item = edit.tracks[0].items.find(i => i.id !== 'left' && i.id !== 'right');
    assert.equal(item.at, 180); assert.equal(item.duration, 60); assert.equal(item.at + item.duration, 240);
    return { origin, drawing, neighborEdgeX: edge.x, item };
  });
  await step('edit lint passes after neighbor clamp', lint);
  assert.equal(output.falRequests.length, 0);
  assert.ok(output.screenshots.length >= 4);
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
