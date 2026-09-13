#!/usr/bin/env node
// L1（Electron + CDP、SS 4 枚）— task 2026-09-13-timeline-caption-fragment-blocks
// オーナー実プロジェクトは TMP にコピーし、原本を変更しない。
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, drag, evalOn, listTargets, screenshot } from './cdp-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const OWNER = process.env.AKARI_OWNER_PROJECT
  ?? path.join(os.homedir(), 'Akari/channels/my-channel/videos/2026-09-12-new-video');
const PORT = Number(process.argv.find(value => value.startsWith('--port='))?.slice(7) ?? 22213);
const RESULTS = path.join(ROOT, 'results.json');
const S = JSON.stringify;
const out = { status: 'running', steps: [], screenshots: [], cleanup: null };
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const sanitizeText = value => String(value)
  .replaceAll(REPO, '<WORKTREE>').replaceAll(os.homedir(), '<HOME>')
  .replace(/\/(?:private\/)?(?:tmp|var\/folders)\/[^\s)'"\]]+/gu, '<TMP>')
  .replace(/\/Users\/[^\s)'"\]]+/gu, '<HOME>');
const sanitize = error => sanitizeText(error?.stack || error?.message || error);
const save = async () => { const temp = `${RESULTS}.tmp-${process.pid}`; await writeFile(temp, `${sanitizeText(JSON.stringify(out, null, 2))}\n`); await rename(temp, RESULTS); };

async function waitEval(cdp, expression, label, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs; let last;
  while (Date.now() < deadline) {
    try { const value = await evalOn(cdp, expression); if (value) return value; } catch (error) { last = error; }
    await sleep(180);
  }
  throw new Error(`${label} not reached${last ? `: ${sanitize(last)}` : ''}`);
}
async function step(name, operation) {
  const record = { name, pass: false }; out.steps.push(record);
  try { record.detail = await operation(); record.pass = true; await save(); return record.detail; }
  catch (error) { record.error = sanitize(error); await save(); throw error; }
}
async function shot(cdp, number, label) {
  const name = `${String(number).padStart(2, '0')}-${label}.png`;
  await screenshot(cdp, path.join(ROOT, name)); out.screenshots.push(name); await save();
}
const command = id => `(async()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');if(!C)throw new Error('CommandService unavailable');const r=await window.theia.container.get(C).executeCommand(${S(id)});return r&&typeof r==='object'?'[object]':r??null})()`;
const TIMELINE = `(()=>{const rows=[...document.querySelectorAll('[data-akari-item-kind="caption"]')];return rows.map(row=>{const fragments=[...row.querySelectorAll('[data-akari-caption-fragment]')];return{id:row.dataset.akariItemId,visualBlocks:Math.max(1,fragments.length),fragmentCount:fragments.length,left:row.style.left,width:row.style.width,label:row.textContent?.trim()??'',pointerEvents:fragments.map(node=>getComputedStyle(node).pointerEvents),ticks:row.querySelectorAll('[data-akari-caption-fragment-tick]').length,background:getComputedStyle(row).backgroundColor}})})()`;

async function panTimelineTo(cdp, seconds, durationSeconds) {
  const dispatched = await evalOn(cdp, `(()=>{const track=document.querySelector('[data-testid="akari-timeline-hscrollbar-track"]');if(!track||getComputedStyle(track).display==='none')return false;const rect=track.getBoundingClientRect();track.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:rect.left+rect.width*Math.min(1,Math.max(0,${seconds}/${durationSeconds})),clientY:rect.top+rect.height/2}));return true})()`);
  assert(dispatched, 'timeline scrollbar was not available after zoom');
  await sleep(160);
}

async function captionGeometry(cdp, id) {
  return evalOn(cdp, `(()=>{const row=document.querySelector('[data-akari-item-id=${S(id)}]');if(!row)return null;const fragment=row.querySelector('[data-akari-caption-fragment]');const r=row.getBoundingClientRect();const f=fragment?.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,fragment:f?{left:f.left,right:f.right,top:f.top,bottom:f.bottom,width:f.width,height:f.height}:null}})()`);
}

async function dispatchZoomInput(cdp, requestedValue) {
  const result = await evalOn(cdp, `(()=>{const slider=document.querySelector('[data-testid="akari-timeline-zoom-slider"]');if(!slider)return null;const before=Number(slider.value);const min=Number(slider.min),max=Number(slider.max);const next=Math.min(max,Math.max(min,${requestedValue}));slider.value=String(next);slider.dispatchEvent(new Event('input',{bubbles:true}));return{before,next,max}})()`);
  assert(result, 'timeline zoom slider was not found');
  await sleep(180);
  return result;
}

async function triggerRenderWithZoomUi(cdp) {
  const current = await evalOn(cdp, `(()=>{const slider=document.querySelector('[data-testid="akari-timeline-zoom-slider"]');return slider?{value:Number(slider.value),max:Number(slider.max)}:null})()`);
  assert(current, 'timeline zoom slider was not found');
  return dispatchZoomInput(cdp, current.value < current.max ? current.value + 1 : current.value - 1);
}

// 掴む点の条件: (a) サブブロックの内側 (b) 帯の端から 12px 以上内側（端 = トリム帯）
// (c) タイムラインのスクロール表示域の内側 (d) elementFromPoint が実際にその帯を返す
// （サブブロックは pointer-events:none なので命中するのは親の帯）。
const grabPointExpression = (id, edgeInsetPx, minimumWidth) => `(()=>{
  const row=document.querySelector('[data-akari-item-id=${S(id)}]');
  if(!row)return null;
  const r=row.getBoundingClientRect();
  if(r.width<${minimumWidth})return{reason:'narrow',width:r.width};
  const fragments=[...row.querySelectorAll('[data-akari-caption-fragment]')];
  if(fragments.length<2)return{reason:'fragments',count:fragments.length};
  const scroll=document.querySelector('.akari-timeline-scroll');
  const v=scroll?scroll.getBoundingClientRect():null;
  const candidates=[];
  fragments.forEach((fragment,index)=>{
    const f=fragment.getBoundingClientRect();
    for(let ratio=0.5;ratio<=0.94;ratio+=0.04){
      candidates.push({index,x:f.left+f.width*ratio,y:f.top+f.height/2});
      candidates.push({index,x:f.left+f.width*(1-ratio),y:f.top+f.height/2});
    }
  });
  for(const candidate of candidates){
    if(candidate.x-r.left<${edgeInsetPx}||r.right-candidate.x<${edgeInsetPx})continue;
    if(v&&(candidate.x<v.left+8||candidate.x>v.right-8||candidate.y<v.top+4||candidate.y>v.bottom-4))continue;
    const hit=document.elementFromPoint(candidate.x,candidate.y);
    if(!hit||(hit!==row&&!row.contains(hit)))continue;
    return{x:candidate.x,y:candidate.y,fragmentIndex:candidate.index,
      chip:{left:r.left,right:r.right,width:r.width},
      viewport:v?{left:v.left,right:v.right}:null,
      insets:{left:candidate.x-r.left,right:r.right-candidate.x},
      hit:{tag:hit.tagName,itemId:hit.dataset?.akariItemId??null}};
  }
  return{reason:'no-candidate',width:r.width,fragments:fragments.length};
})()`;

async function zoomUntilFragmentIsGrabbable(
  cdp, id, focusSeconds, durationSeconds, minimumWidth = 120, edgeInsetPx = 12
) {
  let last;
  for (const sliderValue of [150, 200, 260, 320, 400, 500, 650, 800]) {
    await dispatchZoomInput(cdp, sliderValue);
    await panTimelineTo(cdp, focusSeconds, durationSeconds);
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const point = await evalOn(cdp, grabPointExpression(id, edgeInsetPx, minimumWidth));
      if (point && point.x !== undefined) return { sliderValue, point };
      last = point;
      await sleep(100);
    }
  }
  throw new Error(`${id} never exposed a grabbable fragment point (last: ${S(last)})`);
}

const work = await mkdtemp(path.join(os.tmpdir(), 'akari-caption-fragment-blocks-l1-'));
const project = path.join(work, 'project');
const profile = path.join(work, 'profile');
const captionsPath = path.join(project, 'captions.json');
const projectUri = pathToFileURL(project).toString();
const captionsUri = pathToFileURL(captionsPath).toString();
const editUri = pathToFileURL(path.join(project, 'edit.json')).toString();
let child; let cdp;
try {
  await cp(OWNER, project, { recursive: true });
  await mkdir(profile, { recursive: true });
  const originalSource = await readFile(captionsPath, 'utf8');
  const original = JSON.parse(originalSource);
  assert(original.display_policy?.max_line_units === 10, 'owner fixture must start at max_line_units=10');
  const projectDuration = Math.max(...original.captions.map(row => row.end));

  child = spawn(ELECTRON, [SHELL, project, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-sandbox'], {
    cwd: REPO,
    env: { ...process.env, HOME: profile, AKARI_HOME: path.join(profile, 'akari-home'), THEIA_CONFIG_DIR: path.join(profile, 'theia') },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const logs = []; child.stdout.on('data', chunk => logs.push(String(chunk))); child.stderr.on('data', chunk => logs.push(String(chunk)));
  let target;
  for (let attempt = 0; attempt < 600 && !target; attempt += 1) { target = await listTargets(PORT).then(items => items.find(item => item.type === 'page')).catch(() => undefined); if (!target) await sleep(300); }
  assert(target, `CDP target unavailable: ${sanitize(logs.join('').slice(-3000))}`);
  cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect(); await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await waitEval(cdp, `Boolean(window.theia?.container&&document.getElementById('theia-app-shell'))`, 'Theia workbench', 180_000);
  await evalOn(cdp, `(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent?.trim()==='開くだけ');b?.click();return true})()`).catch(() => {});
  await evalOn(cdp, command('akari.annotations.open')).catch(() => {});
  await waitEval(cdp, `document.querySelectorAll('[data-akari-item-kind="caption"]').length===8`, 'caption timeline rows', 180_000);

  const resolveRpc = `(async()=>{const d=window.theia.container._bindingDictionary;const K=[...d._map.keys()].find(k=>typeof k==='symbol'&&k.description==='AkariPreviewService');if(!K)throw new Error('AkariPreviewService unavailable');return window.theia.container.get(K).resolveCaptionDisplay({captionsUri:${S(captionsUri)},editUri:${S(editUri)},workspaceRoots:[${S(projectUri)}]})})()`;
  const baseline = await step('1. 8 行の見かけ上のサブブロック数が同じ RPC の cue 数と一致する', async () => {
    const resolved = await evalOn(cdp, resolveRpc);
    const expected = Object.fromEntries(original.captions.map(row => [row.id, 0]));
    for (const cue of resolved.captions) expected[cue.source_cue_id] = (expected[cue.source_cue_id] ?? 0) + 1;
    const timeline = await waitEval(cdp, `(()=>{const rows=${TIMELINE};return rows.some(row=>row.id==='c-0002'&&row.visualBlocks>=2)?rows:null})()`, 'resolved fragment blocks');
    assert(timeline.length === 8, `timeline rows=${timeline.length}`);
    for (const row of timeline) {
      assert(row.visualBlocks === expected[row.id], `${row.id}: DOM=${row.visualBlocks}, RPC=${expected[row.id]}`);
      assert(row.pointerEvents.every(value => value === 'none'), `${row.id}: fragment captured pointer events`);
    }
    assert(expected['c-0002'] >= 2, `c-0002 cue count=${expected['c-0002']}`);
    await shot(cdp, 1, 'rpc-cue-counts-match');
    return { expected, timeline };
  });

  await step('2. サブブロック上のドラッグで行全体が動き、ブロック数は不変', async () => {
    const current = JSON.parse(await readFile(captionsPath, 'utf8'));
    const ordered = [...current.captions].sort((left, right) => left.start - right.start || left.end - right.end);
    const timelineBeforeZoom = await evalOn(cdp, TIMELINE);
    const visualBlocksById = new Map(timelineBeforeZoom.map(row => [row.id, row.visualBlocks]));
    const slackTable = ordered.map((row, index) => ({
      id: row.id,
      leftSlack: index === 0 ? row.start : row.start - ordered[index - 1].end,
      rightSlack: index === ordered.length - 1 ? 0 : ordered[index + 1].start - row.end,
      visualBlocks: visualBlocksById.get(row.id) ?? 0
    }));
    const selected = slackTable.find(row => row.visualBlocks >= 2
      && Math.max(row.leftSlack, row.rightSlack) >= 0.15);
    assert(selected, `movable fragmented caption not found: ${S(slackTable)}`);
    const before = ordered.find(row => row.id === selected.id);
    const direction = selected.leftSlack >= selected.rightSlack ? -1 : 1;
    const availableSlack = direction < 0 ? selected.leftSlack : selected.rightSlack;
    const zoom = await zoomUntilFragmentIsGrabbable(
      cdp, selected.id, (before.start + before.end) / 2, projectDuration
    );
    const grab = zoom.point;
    const geometry = await captionGeometry(cdp, selected.id);
    assert(geometry?.fragment && geometry.width >= 120,
      `${selected.id} is not wide enough: ${S(geometry)}`);
    const beforeTimeline = (await evalOn(cdp, TIMELINE)).find(row => row.id === selected.id);
    assert(beforeTimeline?.visualBlocks >= 2,
      `${selected.id} lost its fragment blocks before drag: ${S(beforeTimeline)}`);
    const beforeBlockCount = beforeTimeline.visualBlocks;
    const point = { x: grab.x, y: grab.y };
    assert(grab.insets.left >= 12 && grab.insets.right >= 12,
      `drag point entered the trim edge zone: ${S(grab)}`);
    assert(grab.hit.itemId === selected.id,
      `drag point does not hit the caption band: ${S(grab)}`);
    const pxPerSecond = grab.chip.width / (before.end - before.start);
    const requestedSeconds = Math.min(availableSlack * 0.6, 0.5);
    const rawMovePx = direction * Math.max(16, requestedSeconds * pxPerSecond);
    // 行き先もスクロール表示域の内側に収める（外へ出すと pointermove が別要素へ届く）。
    const destinationX = grab.viewport
      ? Math.min(grab.viewport.right - 8, Math.max(grab.viewport.left + 8, point.x + rawMovePx))
      : point.x + rawMovePx;
    const movePx = destinationX - point.x;
    assert(Math.abs(movePx) >= 8, `drag distance collapsed to ${movePx}px: ${S(grab)}`);
    await drag(cdp, point, { x: destinationX, y: point.y });
    let after;
    for (let attempt = 0; attempt < 200; attempt += 1) { after = JSON.parse(await readFile(captionsPath, 'utf8')).captions.find(row => row.id === selected.id); if (after.start !== before.start || after.end !== before.end) break; await sleep(100); }
    assert(after.start !== before.start && after.end !== before.end, `whole row did not move: ${S({ before, after })}`);
    const startDelta = after.start - before.start;
    const endDelta = after.end - before.end;
    const beforeDuration = before.end - before.start;
    const afterDuration = after.end - after.start;
    assert(Math.abs(startDelta - endDelta) < 1e-6,
      `caption edges moved by different deltas: ${S({ startDelta, endDelta })}`);
    assert(Math.abs(afterDuration - beforeDuration) < 1e-6,
      `caption duration changed: ${S({ beforeDuration, afterDuration })}`);
    assert(Math.sign(startDelta) === direction,
      `caption moved opposite to drag: ${S({ direction, startDelta, endDelta })}`);
    const shortToast = await evalOn(cdp, `([...document.querySelectorAll('.theia-notification-message,[data-akari-timeline-notice]')].some(node=>node.textContent.includes('字幕が短すぎます')))`);
    assert(!shortToast, 'trim rejection toast appeared during move drag');
    const timeline = await waitEval(cdp, `(()=>{const row=${TIMELINE}.find(row=>row.id===${S(selected.id)});return row&&row.visualBlocks===${beforeBlockCount}?row:null})()`, 'fragment count after drag');
    await shot(cdp, 2, 'fragment-drag-moves-row');
    return { selectedId: selected.id, slackTable, direction, availableSlack, zoom,
      pxPerSecond, requestedSeconds, rawMovePx, movePx, beforeBlockCount, grab,
      dragPoint: point, edgeInsets: { left: point.x - geometry.left, right: geometry.right - point.x },
      before: { start: before.start, end: before.end, duration: beforeDuration },
      after: { start: after.start, end: after.end, duration: afterDuration },
      deltas: { start: startDelta, end: endDelta }, shortToast, timeline };
  });

  await step('3. 設定 OFF で全行が 1 本帯になり、旧 1px 目盛りも出ない', async () => {
    await evalOn(cdp, `localStorage.setItem('akari.captions.fragmentBreaks.visible','false')`);
    const renderTrigger = await dispatchZoomInput(cdp, 0);
    const timeline = await waitEval(cdp, `(()=>{const rows=${TIMELINE};return rows.length===8&&rows.every(row=>row.visualBlocks===1&&row.fragmentCount===0&&row.ticks===0)?rows:null})()`, 'fragment breaks off');
    await shot(cdp, 3, 'fragment-breaks-off');
    return { renderTrigger, timeline };
  });

  await step('4. watcher で max_line_units 10→18 を再解決し c-0002 が 1 本になる', async () => {
    await evalOn(cdp, `localStorage.setItem('akari.captions.fragmentBreaks.visible','true')`);
    const restoreTrigger = await triggerRenderWithZoomUi(cdp);
    await waitEval(cdp, `(()=>{const row=${TIMELINE}.find(row=>row.id==='c-0002');return row&&row.visualBlocks>=2?row:null})()`, 'fragment breaks restored');
    const changed = JSON.parse(await readFile(captionsPath, 'utf8')); changed.display_policy.max_line_units = 18;
    await writeFile(captionsPath, `${JSON.stringify(changed, null, 2)}\n`);
    const watcherRenderTrigger = await triggerRenderWithZoomUi(cdp);
    const resolved = await waitEval(cdp, `(async()=>{const row=${TIMELINE}.find(row=>row.id==='c-0002');if(!row||row.visualBlocks!==1)return null;const rpc=await ${resolveRpc};const count=rpc.captions.filter(c=>c.source_cue_id==='c-0002').length;return count===1?{row,count}:null})()`, 'watcher max_line_units=18', 120_000);
    await shot(cdp, 4, 'watcher-reduces-fragments');
    return { restoreTrigger, watcherRenderTrigger, resolved };
  });

  out.status = 'pass'; await save();
} catch (error) {
  out.status = 'fail'; out.error = sanitize(error);
  try { if (cdp) { await screenshot(cdp, path.join(ROOT, '99-failure.png')); out.screenshots.push('99-failure.png'); } } catch {}
  await save(); process.exitCode = 1;
} finally {
  cdp?.close();
  const pid = child?.pid;
  if (pid) { try { process.kill(pid, 'SIGTERM'); } catch {} await sleep(2500); try { process.kill(pid, 0); process.kill(pid, 'SIGKILL'); } catch {} }
  const countSurvivors = async () => {
    const processList = await new Promise(resolve => {
      const probe = spawn('ps', ['-eo', 'pid,ppid,args']); let stdout = '';
      probe.stdout.on('data', chunk => { stdout += chunk; });
      probe.once('close', () => resolve(stdout));
    });
    return String(processList).split('\n').filter(line => line.includes(work) && !line.includes('ps -eo')).length;
  };
  let survivors = await countSurvivors();
  for (let attempt = 0; attempt < 20 && survivors !== 0; attempt += 1) {
    await sleep(500);
    survivors = await countSurvivors();
  }
  await rm(work, { recursive: true, force: true });
  out.cleanup = { killedPid: pid ?? null, survivingIsolatedProcesses: survivors, temporaryProjectRemoved: true };
  if (survivors !== 0) { out.status = 'fail'; out.cleanupError = `${survivors} isolated Electron process(es) survived`; process.exitCode = 1; }
  await save();
}
