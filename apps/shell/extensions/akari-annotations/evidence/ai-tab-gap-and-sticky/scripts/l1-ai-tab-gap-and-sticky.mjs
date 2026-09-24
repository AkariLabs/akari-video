#!/usr/bin/env node
// Run after: cd apps/shell && npm run build (or use an already built shell bundle).
// Then: node extensions/akari-annotations/evidence/ai-tab-gap-and-sticky/scripts/l1-ai-tab-gap-and-sticky.mjs
// Electron/CDP only; all generated media and AKARI_HOME/user data live in a temporary directory.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick, screenshot } from '../../ai-still-routes/scripts/cdp-lib.mjs';
import { createFixture } from '../../timeline-gap-generate/gen-fixture.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '../../../../../..');
const SHELL = path.join(REPO, 'apps/shell');
const ISO = await mkdtemp(path.join(tmpdir(), 'akari-ai-gap-sticky-'));
const PROJECT = path.join(ISO, 'project');
const PORT = Number(process.argv.find(arg => arg.startsWith('--port='))?.slice(7) ?? 22227);
const results = { status: 'running', steps: [], screenshots: [], clicks: [], requests: [], fakeCliCalls: 0 };
const clean = value => String(value).replaceAll(ISO, '<TMP>').replaceAll(REPO, '<WORKTREE>')
  .replaceAll(process.env.HOME ?? '', '<HOME>');
const save = () => writeFile(path.join(ROOT, 'results.json'), clean(JSON.stringify(results, null, 2)) + '\n');
let electron, cdp;
const evaluate = expression => evalOn(cdp, expression);
async function waitFor(fn, label, ms = 90_000) {
  const until = Date.now() + ms;
  let last;
  while (Date.now() < until) {
    try { const value = await fn(); if (value) return value; last = value; } catch (error) { last = error.message; }
    await sleep(180);
  }
  throw new Error(`${label} timed out: ${JSON.stringify(last)}`);
}
const waitUi = (expression, label, ms) => waitFor(() => evaluate(expression), label, ms);
async function clearNotifications() {
  await evaluate(`(async()=>{try{const c=window.theia?.container,d=c?._bindingDictionary;
    const k=[...d._map.keys()].find(x=>typeof x==='function'&&typeof x.prototype?.executeCommand==='function');
    await c.get(k).executeCommand('notifications.commands.clearAll')}catch{}
    for(const b of document.querySelectorAll('.theia-notification button[aria-label="Close"],.theia-notification button[title="閉じる"]'))b.click();
    return true})()`).catch(() => undefined);
}
async function settle() {
  await evaluate(`(()=>new Promise(resolve=>{const roots=['[data-akari-ui="panel:inspector"]','.akari-annotations-widget']
    .map(s=>document.querySelector(s)).filter(Boolean);let quiet,limit;
    const observers=roots.map(e=>{const o=new MutationObserver(reset);o.observe(e,{subtree:true,attributes:true,childList:true,characterData:true});return o});
    function done(){clearTimeout(quiet);clearTimeout(limit);observers.forEach(o=>o.disconnect());resolve(true)}
    function reset(){clearTimeout(quiet);quiet=setTimeout(done,500)}
    limit=setTimeout(done,30000);reset()}) )()`);
}
async function clickUntil(selector, expectation, name) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await settle(); await clearNotifications();
    try {
      const point = await waitUi(`(async()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;
        e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        const b=e.getBoundingClientRect(),x=b.left+b.width/2,y=b.top+b.height/2,h=document.elementFromPoint(x,y);
        return b.width>0&&b.height>0&&(h===e||e.contains(h))?{x,y}:null})()`, `target ${name}`, 90_000);
      await realClick(cdp, point.x, point.y);
      await waitUi(expectation, name, 5_000);
      results.clicks.push({ name, attempt, pass: true }); await save(); return;
    } catch (error) {
      results.clicks.push({ name, attempt, pass: false, error: clean(error.message) }); await save();
      if (attempt === 3) throw error;
    }
  }
}
async function clickStillTile() {
  const selector = '.akari-inspector-generation-gap [data-akari-inspector-ai-tile="still"]';
  for (let attempt = 1; attempt <= 3; attempt++) {
    await settle(); await clearNotifications();
    const point = await waitUi(`(async()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;
      e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      const b=e.getBoundingClientRect(),x=b.left+b.width/2,y=b.top+b.height/2,h=document.elementFromPoint(x,y);
      return b.width>0&&b.height>0&&(h===e||e.contains(h))?{x,y}:null})()`, 'still tile target', 90_000);
    await realClick(cdp, point.x, point.y);
    const accepted = await waitFor(async () => {
      const ui = await evaluate(`(()=>{const w=window.__akariInspectorWidget;
        return{pending:w?.gapAiOpening?.view==='still',selected:w?.model?.snapshot?.kind==='cut'
          &&w.model.snapshot.itemId?.startsWith('gap-')}})()`);
      if (ui?.pending) return { via: 'inspector pending', point };
      if (ui?.selected) return { via: 'new cut selected', point };
      const edit = await readEdit();
      if (edit.tracks.some(track => track.lane === 'visual' && track.items.some(item => item.id.startsWith('gap-')))) {
        return { via: 'edit.json frame', point };
      }
      return null;
    }, 'still tile click acknowledged', 2500).catch(() => null);
    results.clicks.push({ name: 'still tile', attempt, pass: !!accepted, acknowledgement: accepted?.via ?? null });
    await save();
    if (accepted) return accepted;
  }
  throw new Error('still tile did not establish a pending frame after three verified clicks');
}
async function shot(name) {
  await settle(); await clearNotifications();
  await screenshot(cdp, path.join(ROOT, name));
  results.screenshots.push(name); await save();
}
async function step(name, fn) {
  const record = { name, pass: false }, started = performance.now(); results.steps.push(record);
  let timer;
  try { record.measured = await Promise.race([fn(), new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('stage exceeded 90 seconds')), 90_000);
  })]); record.pass = true; }
  catch (error) { record.error = clean(error.stack ?? error); throw error; }
  finally { clearTimeout(timer); record.elapsedMs = Math.round(performance.now() - started); await save(); }
}
const readEdit = async () => JSON.parse(await readFile(path.join(PROJECT, 'edit.json'), 'utf8'));
const aiActive = `document.querySelector('[data-akari-ui="tab:inspector-generation"]')?.getAttribute('aria-selected')==='true'`;
async function captureFailure() {
  if (cdp) {
    try {
      await screenshot(cdp, path.join(ROOT, 'error-full.png'));
      results.failureScreenshot = 'error-full.png';
    } catch (error) { results.failureScreenshotError = clean(error.message ?? error); }
    try {
      results.failureState = await evaluate(`(()=>{const w=window.__akariInspectorWidget,t=window.__akariGapWidget;
        const body=w?.body??document.querySelector('.akari-inspector-widget');
        const snapshot=w?.model?.snapshot;
        return{inspectorText:(body?.textContent??'').slice(0,2000),
          tabs:[...document.querySelectorAll('.akari-inspector-tab-strip [role="tab"]')]
            .map(e=>({text:e.textContent,selected:e.getAttribute('aria-selected')})),
          snapshot:{kind:snapshot?.kind??null,itemId:snapshot?.kind==='cut'?snapshot.itemId??null:snapshot?.id??null},
          timelineSelection:t?.selection??null,
          timelineNotice:t?.notice?.node?.textContent??document.querySelector('[data-akari-timeline-notice]')?.textContent??'',
          theiaNotifications:[...document.querySelectorAll('.theia-notification,.theia-notification-center .notification-list-item')]
            .map(e=>e.textContent?.trim()).filter(Boolean)})()`);
    } catch (error) { results.failureState = { observationError: clean(error.message ?? error) }; }
  } else results.failureState = { observationError: 'CDP was not connected' };
  try {
    const edit = await readEdit();
    results.failureState.visualTracks = edit.tracks.filter(track => track.lane === 'visual')
      .map(track => ({ trackId: track.id, itemIds: track.items.map(item => item.id) }));
  } catch (error) { results.failureState.editReadError = clean(error.message ?? error); }
  await save();
}
async function gapClick() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await settle(); await clearNotifications();
    const point = await evaluate(`(()=>{const w=window.__akariGapWidget,r=w.strip.getBoundingClientRect(),l=w.laneLayout.tracks.find(x=>x.id==='video');
      const x=r.left+(5-w.viewStart)*r.width/w.visibleDuration(),y=r.top+l.top+l.height/2,h=document.elementFromPoint(x,y);
      return h&&w.strip.contains(h)&&!h.closest('[data-akari-item-kind]')?{x,y}:null})()`);
    if (!point) { await sleep(300); continue; }
    await realClick(cdp, point.x, point.y);
    try { await waitUi(`Boolean(document.querySelector('.akari-inspector-generation-gap [data-akari-inspector-ai-tile="still"]')&&document.querySelector('.akari-inspector-generation-gap [data-akari-inspector-ai-tile="video"]'))`, 'gap tiles', 5_000); return point; }
    catch { if (attempt === 3) throw new Error('gap click did not select the gap'); }
  }
  throw new Error('gap point is covered');
}
async function ownedProcesses() {
  const { stdout } = await promisify(execFile)('/bin/ps', ['-axo', 'pid=,command='], { timeout: 5000 });
  return stdout.split('\n').flatMap(line => { const m = line.match(/^\s*(\d+)\s+(.+)$/); return m && m[2].includes(ISO) && Number(m[1]) !== process.pid ? [Number(m[1])] : []; });
}
try {
  const { ffmpeg } = await createFixture(PROJECT);
  await mkdir(path.join(ISO, 'akari-home'), { recursive: true });
  const still = path.join(PROJECT, 'assets/still.png'), audio = path.join(PROJECT, 'assets/audio.wav');
  await promisify(execFile)(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x2e8b57:s=640x360', '-frames:v', '1', still]);
  await promisify(execFile)(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', audio]);
  const original = await readEdit();
  original.sources.push({ id: 'still', path: 'assets/still.png' }, { id: 'audio', path: 'assets/audio.wav' });
  original.tracks[0].items.push({ id: 'still', name: '静止画', at: 300, duration: 90, source: { kind: 'media', src: 'still', in: 0, out: 3 } });
  original.tracks.push({ id: 'audio', lane: 'audio', name: '音声', items: [{ id: 'sound', name: '音声', at: 0, duration: 90, source: { kind: 'media', src: 'audio', in: 0, out: 3 } }] });
  await writeFile(path.join(PROJECT, 'edit.json'), JSON.stringify(original, null, 2) + '\n');
  const fakeCli = path.join(ISO, 'fake-generate.mjs'), calls = path.join(ISO, 'cli-calls.txt');
  await writeFile(calls, '');
  await writeFile(fakeCli, `import{appendFile}from'node:fs/promises';await appendFile(${JSON.stringify(calls)},'called\\n');`);
  const binary = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
  assert.ok((await stat(binary)).isFile(), 'built Electron binary is required');
  electron = spawn(binary, [SHELL, PROJECT, `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${path.join(ISO, 'userdata')}`, '--no-sandbox'], {
    cwd: REPO, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env,
      AKARI_HOME: path.join(ISO, 'akari-home'), THEIA_CONFIG_DIR: path.join(ISO, 'config'),
      AKARI_FFMPEG_BIN: ffmpeg, AKARI_GENERATE_CLI: fakeCli, FAL_KEY: '', FAL_API_KEY: '', OPENAI_API_KEY: '' }
  });
  let log = ''; electron.stdout.on('data', data => { log += data; }); electron.stderr.on('data', data => { log += data; });
  const target = await waitFor(async () => {
    if (electron.exitCode !== null) throw new Error(`Electron exited ${electron.exitCode}: ${log.slice(-2000)}`);
    return (await listTargets(PORT)).find(t => t.type === 'page');
  }, 'Electron target', 90_000);
  cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect();
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
  await cdp.send('Network.setBlockedURLs', { urls: ['*://*.fal.ai/*', '*://*.fal.run/*', '*://api.openai.com/*',
    '*://generativelanguage.googleapis.com/*', '*://api.x.ai/*', '*://api.groq.com/*', '*://api.elevenlabs.io/*'] });
  cdp.on('Network.requestWillBeSent', event => { if (/fal\.(ai|run)|api\.openai\.com|generativelanguage\.googleapis\.com|api\.x\.ai|api\.groq\.com|api\.elevenlabs\.io/u.test(event.request.url)) results.requests.push('<BLOCKED_PROVIDER>'); });
  await waitUi(`Boolean(window.theia?.container&&document.getElementById('theia-app-shell'))`, 'Theia ready', 90_000);
  await waitUi(`!document.querySelector('.theia-preload')||document.querySelector('.theia-preload').classList.contains('theia-hidden')`, 'preload removed', 180_000);
  await clearNotifications();
  await evaluate(`(()=>{for(const d of document.querySelectorAll('.dialogBlock')){
    [...d.querySelectorAll('button')].find(b=>/キャンセル|Cancel|閉じる|Close/u.test(b.textContent))?.click()}return true})()`);
  if (!await evaluate(`Boolean(document.querySelector('.akari-annotations-widget'))`)) {
    await evaluate(`(()=>{const c=window.theia.container,k=[...c._bindingDictionary._map.keys()]
      .find(x=>typeof x==='function'&&typeof x.prototype?.executeCommand==='function');
      void c.get(k).executeCommand('akari.annotations.open');return true})()`);
    await waitUi(`Boolean(document.querySelector('.akari-annotations-widget'))`, 'timeline open', 90_000);
  }
  await evaluate(`(()=>{const c=window.theia.container,k=[...c._bindingDictionary._map.keys()].find(x=>typeof x==='function'&&x.prototype?.getCurrentWidget&&x.prototype?.addWidget&&x.prototype?.activateWidget);
    const s=c.get(k),w=s.widgets.find(x=>x.node?.classList.contains('akari-annotations-widget'));
    if(!w)return false;window.__akariGapWidget=w;w.activate();return true})()`);
  await waitUi(`window.__akariGapWidget?.cutItemIds.length===3`, 'timeline ready', 90_000);
  await step('gap heading and two tiles', async () => {
    const point = await gapClick();
    await waitUi(`(()=>{const c=window.theia?.container,k=[...c._bindingDictionary._map.keys()]
      .find(x=>typeof x==='function'&&x.prototype?.getCurrentWidget&&x.prototype?.addWidget&&x.prototype?.activateWidget);
      const i=c.get(k).widgets.find(x=>x.node?.classList.contains('akari-inspector-widget'));
      if(i)window.__akariInspectorWidget=i;return Boolean(i)})()`, 'inspector widget ready', 90_000);
    const state = await evaluate(`(()=>{const p=document.querySelector('.akari-inspector-generation-gap');return{heading:p.querySelector('h3')?.textContent,range:p.querySelector('p')?.textContent,ends:[...p.querySelectorAll('.akari-inspector-generation-gap-end')].map(x=>x.textContent),tiles:[...p.querySelectorAll('[data-akari-inspector-ai-tile]')].map(x=>({id:x.dataset.akariInspectorAiTile,disabled:x.getAttribute('aria-disabled')}))}})()`);
    assert.equal(state.heading, 'すき間 · 4.0 秒'); assert.equal(state.ends.length, 2);
    assert.deepEqual(state.tiles, [{ id: 'still', disabled: 'false' }, { id: 'video', disabled: 'false' }]);
    await shot('01-gap-ai-tiles.png'); return { point, ...state };
  });
  await step('still tile inserts one frame and opens still panel', async () => {
    const deadline = Date.now() + 85_000;
    const click = await clickStillTile();
    const edit = await waitFor(async () => {
      const value = await readEdit();
      return value.tracks[0].items.some(item => item.id.startsWith('gap-')) ? value : null;
    }, 'gap frame in edit.json', Math.min(60_000, deadline - Date.now()));
    assert.equal(edit.tracks[0].items.length, original.tracks[0].items.length + 1);
    const frame = edit.tracks[0].items.find(item => item.id.startsWith('gap-'));
    assert.equal(frame.at, 90); assert.equal(frame.duration, 120);
    const selected = await waitUi(`(()=>{const t=window.__akariGapWidget,i=window.__akariInspectorWidget,
      s=t?.selection,n=i?.model?.snapshot,id=s?.kind==='cut'?t.cutItemIds[s.index]:s?.id,
      tab=document.querySelector('[data-akari-ui="tab:inspector-generation"]'),
      header=document.querySelector('.akari-inspector-ai-panel-header');
      return id===${JSON.stringify(frame.id)}&&n?.kind==='cut'&&n.itemId===${JSON.stringify(frame.id)}
        &&tab?.getAttribute('aria-selected')==='true'&&header?.textContent.includes('静止画')
        ?{timelineKind:s.kind,timelineItemId:id,snapshotKind:n.kind,snapshotItemId:n.itemId,
          aiSelected:true,panelHeader:header.textContent}:null})()`, 'inserted frame selected with still panel',
      Math.max(1000, Math.min(25_000, deadline - Date.now())));
    await shot('02-inserted-still-panel.png');
    return { click, itemId: frame.id, at: frame.at, durationFrames: frame.duration, selected };
  });
  await step('one undo removes gap frame', async () => {
    await clickUntil('.akari-annotations-widget button[aria-label="元に戻す"]',
      `window.__akariGapWidget.cutItemIds.length===3`, 'undo frame');
    const edit = await readEdit(); assert.deepEqual(edit.tracks, original.tracks);
    await shot('03-after-undo.png'); return { undoClicks: 1, visualItems: edit.tracks[0].items.length };
  });
  await step('still clip AI', async () => {
    await clickUntil('[data-akari-ui="timeline:cut:2"]', `Boolean(document.querySelector('[data-akari-ui="tab:inspector-generation"]'))`, 'still clip');
    await clickUntil('[data-akari-ui="tab:inspector-generation"]', aiActive, 'open still AI');
    await shot('04-still-clip-ai.png'); return { aiSelected: true };
  });
  await step('ordinary video keeps AI', async () => {
    await clickUntil('[data-akari-ui="timeline:cut:0"]', aiActive, 'video stays AI');
    await shot('05-video-clip-ai.png'); return { aiSelected: true };
  });
  await step('audio keeps AI', async () => {
    await clickUntil('[data-akari-item-kind="audio"]', aiActive, 'audio stays AI');
    await shot('06-audio-clip-ai.png'); return { aiSelected: true };
  });
  results.fakeCliCalls = (await readFile(calls, 'utf8')).trim().split('\n').filter(Boolean).length;
  assert.equal(results.fakeCliCalls, 0); assert.equal(results.requests.length, 0);
  assert.ok(results.screenshots.length >= 5);
  results.status = 'PASS';
} catch (error) {
  results.status = 'FAIL'; results.error = clean(error.stack ?? error); process.exitCode = 1;
  await captureFailure();
} finally {
  cdp?.close(); electron?.stdout.destroy(); electron?.stderr.destroy();
  const pids = await ownedProcesses().catch(() => []);
  for (const pid of pids) { try { process.kill(pid, 'SIGTERM'); } catch {} }
  await sleep(1500);
  for (const pid of await ownedProcesses().catch(() => [])) { try { process.kill(pid, 'SIGKILL'); } catch {} }
  if ((await ownedProcesses().catch(() => [])).length === 0) await rm(ISO, { recursive: true, force: true });
  else { results.status = 'FAIL'; results.cleanup = 'owned Electron processes remain'; process.exitCode = 1; }
  await save();
}
