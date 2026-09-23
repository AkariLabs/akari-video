#!/usr/bin/env node
// Run: node apps/shell/extensions/akari-annotations/evidence/ai-material-tab/scripts/l1-ai-material-tab.mjs
// Requires a built Electron shell. The script makes its project and all profiles under os.tmpdir().
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick } from './cdp-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps/shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const PORT = Number(process.argv.find(arg => arg.startsWith('--port='))?.slice(7) ?? 22244);
const TEMP_DIR = os.tmpdir();
const TEMP_DIR_REAL = await realpath(TEMP_DIR);
const ISO = await mkdtemp(path.join(TEMP_DIR, 'akari-ai-material-l1-'));
const PROJECT = path.join(ISO, 'project');
const tempPaths = new Set([ISO, TEMP_DIR, TEMP_DIR_REAL]);
for (const dir of [...tempPaths]) {
  if (dir.startsWith('/private/var/folders/')) tempPaths.add(dir.slice('/private'.length));
  if (dir.startsWith('/var/folders/')) tempPaths.add(`/private${dir}`);
}
const redactedTempPaths = [...tempPaths].sort((a, b) => b.length - a.length);
const S = JSON.stringify;
const launchEnv = { ...process.env };
for (const key of Object.keys(launchEnv)) if (/GROQ|ELEVENLABS|FAL_KEY|OPENAI_API_KEY/iu.test(key)) delete launchEnv[key];
const result = { status: 'running', checks: [], clicks: [], screenshots: [],
  measurements: { badgeTitleIntersect: null, buttons: [] }, blockedTranscriptions: 0 };
const save = async () => {
  const file = path.join(ROOT, 'results.json');
  const temporary = `${file}.tmp-${process.pid}`;
  let serialized = JSON.stringify(result, null, 2);
  for (const dir of redactedTempPaths) serialized = serialized.replaceAll(dir, '<TEMP>');
  await writeFile(temporary, serialized + '\n');
  await rename(temporary, file);
};
const check = (name, passed, measured) => {
  result.checks.push({ name, passed: Boolean(passed), measured });
  if (!passed) throw new Error(`${name}: ${JSON.stringify(measured)}`);
};
async function waitEval(cdp, expression, label, ms = 90_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const value = await evalOn(cdp, expression, undefined, Math.min(60_000, until - Date.now())).catch(() => null);
    if (value) return value;
    await sleep(Math.min(160, Math.max(0, until - Date.now())));
  }
  throw new Error(`Timed out: ${label}`);
}
const command = id => `(async()=>{const d=window.theia.container._bindingDictionary;
  const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');
  await window.theia.container.get(C).executeCommand(${S(id)});return true})()`;
async function dismiss(cdp) {
  await evalOn(cdp, command('notifications.commands.clearAll')).catch(() => null);
  await waitEval(cdp, `document.querySelectorAll('.theia-notification-list-item').length===0`, 'notifications clear', 5000).catch(() => null);
}
async function settle(cdp) {
  return evalOn(cdp, `new Promise(resolve=>{const roots=[...['[data-akari-ui="panel:inspector"]','[data-akari-ui="panel:timeline"]']
    .map(s=>document.querySelector(s)),document.querySelector('[data-akari-material-path]')?.parentElement]
    .filter(Boolean);if(!roots.length){resolve(true);return}
    let quiet,limit;const observers=roots.map(root=>{const observer=new MutationObserver(reset);
    observer.observe(root,{subtree:true,childList:true,attributes:true,characterData:true});return observer});
    function done(){clearTimeout(quiet);clearTimeout(limit);observers.forEach(o=>o.disconnect());resolve(true)}
    function reset(){clearTimeout(quiet);quiet=setTimeout(done,500)}limit=setTimeout(done,90000);reset()})`, undefined, 100_000);
}
async function clickUntil(cdp, selector, expected, name) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await settle(cdp);
    await dismiss(cdp);
    try {
      const point = await waitEval(cdp, `(async()=>{const e=document.querySelector(${S(selector)});if(!e)return null;
        e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
        const hit=document.elementFromPoint(x,y);return r.width&&r.height&&hit&&(hit===e||e.contains(hit))?{x,y}:null})()`, `${name} point`, 5000);
      await realClick(cdp, point.x, point.y);
      await waitEval(cdp, expected, name, 5000);
      result.clicks.push({ name, attempt, passed: true });
      return;
    } catch (error) {
      result.clicks.push({ name, attempt, passed: false, error: String(error) });
      if (attempt === 3) throw error;
    }
  }
}
async function shot(cdp, name, selector = '[data-akari-ui="panel:inspector"]') {
  await settle(cdp);
  await dismiss(cdp);
  const rect = await waitEval(cdp, `(()=>{const e=document.querySelector(${S(selector)});if(!e)return null;
    const r=e.getBoundingClientRect();return r.width&&r.height?{x:Math.max(0,r.x),y:Math.max(0,r.y),width:r.width,height:r.height}:null})()`, `${name} rect`);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false,
    clip: { ...rect, scale: 1 } });
  const bytes = Buffer.from(data, 'base64');
  await writeFile(path.join(ROOT, name), bytes);
  result.screenshots.push({ name, bytes: bytes.length });
  check(`${name} <= 500KB`, bytes.length <= 500_000, bytes.length);
  await save();
}
async function shotOverview(cdp) {
  await settle(cdp);
  await dismiss(cdp);
  const viewport = await evalOn(cdp, '({width:window.innerWidth,height:window.innerHeight})');
  for (const scale of [1, 0.8, 0.65, 0.5]) {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false,
      clip: { x: 0, y: 0, width: viewport.width, height: viewport.height, scale } });
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length > 500_000) continue;
    const name = '00-overview.png';
    await writeFile(path.join(ROOT, name), bytes);
    result.screenshots.push({ name, bytes: bytes.length, scale, viewport });
    check('overview includes selected material card and inspector',
      await evalOn(cdp, `(()=>{const card=document.querySelector(${S('[data-akari-material-path="assets/interview.wav"]')}),
        inspector=document.querySelector('.akari-inspector-ai-material-header');
        if(!card||!inspector)return false;
        const a=card.getBoundingClientRect(),b=inspector.getBoundingClientRect();
        return a.width>0&&b.width>0&&a.left>=0&&b.right<=innerWidth&&a.top>=0&&b.bottom<=innerHeight})()`),
      { scale, bytes: bytes.length });
    await save();
    return;
  }
  throw new Error('00-overview.png exceeds 500KB even at half scale');
}
async function runFixture() {
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts/gen-fixture.mjs'), PROJECT], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  child.stdout.on('data', part => { out += part; });
  child.stderr.on('data', part => { err += part; });
  const code = await new Promise(resolve => child.once('close', resolve));
  if (code !== 0) throw new Error(`fixture failed: ${err}`);
  result.fixture = JSON.parse(out.trim());
}
const tile = '[data-akari-inspector-ai-tile="transcribe"]';
const panel = '.akari-inspector-ai-transcribe-panel';
async function waitForExit(child, timeoutMs = 10_000) {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise(resolve => {
    const onExit = () => { clearTimeout(timer); resolve(true); };
    const timer = setTimeout(() => { child.off('exit', onExit); resolve(false); }, timeoutMs);
    child.once('exit', onExit);
  });
}
const card = path => '[data-akari-material-path="' + path + '"]';
let electron, cdp;
try {
  await stat(ELECTRON);
  await runFixture();
  for (const name of ['akari-home', 'theia-config', 'user-data']) await mkdir(path.join(ISO, name));
  electron = spawn(ELECTRON, [SHELL, PROJECT, '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + path.join(ISO, 'user-data'), '--window-size=1600,1000', '--no-sandbox'], {
    cwd: REPO, env: { ...launchEnv, AKARI_HOME: path.join(ISO, 'akari-home'),
      THEIA_CONFIG_DIR: path.join(ISO, 'theia-config') }, stdio: 'ignore'
  });
  electron.on('error', error => { result.launchError = String(error); });
  const target = await (async () => { const until = Date.now() + 600_000; while (Date.now() < until) {
    const page = await listTargets(PORT).then(rows => rows.find(row => row.type === 'page')).catch(() => null);
    if (page) return page; await sleep(300);
  } throw new Error('Electron CDP page did not appear'); })();
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect(); await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await waitEval(cdp, 'Boolean(window.theia?.container&&document.getElementById("theia-app-shell"))', 'Theia workbench', 180_000);
  await waitEval(cdp, 'Boolean(document.querySelector(' + S(card('assets/interview.wav')) + '))', 'audio material card');
  await evalOn(cdp, command('akari.annotations.open')).catch(() => null);
  await waitEval(cdp, 'Boolean(document.querySelector("[data-akari-ui=\\"timeline:cut:0\\"]"))', 'timeline');

  await clickUntil(cdp, card('assets/interview.wav'),
    'document.querySelector(".akari-inspector-ai-material-name")?.textContent==="interview.wav"', 'audio material');
  const openedMainTabState = `(()=>{const main=document.querySelector('#theia-main-content-panel');
    const tab=[...(main?.querySelectorAll('.lm-TabBar-tab.lm-mod-current,.p-TabBar-tab.p-mod-current')||[])]
      .find(e=>e.getBoundingClientRect().width>0&&e.textContent.includes('素材プレビュー'));
    const widgets=[...(main?.querySelectorAll('.lm-Widget,.p-Widget')||[])].filter(e=>
      !e.closest('.lm-TabBar,.p-TabBar')&&e.getBoundingClientRect().width>0
      &&e.getBoundingClientRect().height>0&&!e.classList.contains('lm-mod-hidden')
      &&!e.classList.contains('p-mod-hidden'));
    return{label:tab?.querySelector('.lm-TabBar-tabLabel,.p-TabBar-tabLabel')?.textContent.trim()||null,
      bodyHasInterview:widgets.some(e=>e.textContent.includes('interview.wav'))}})()`;
  const openedMainTab = await waitEval(cdp,
    `(()=>{const state=${openedMainTabState};return state.label?.includes('素材プレビュー')&&state.bodyHasInterview?state:null})()`,
    'audio opened in main area', 10_000).catch(() => evalOn(cdp, openedMainTabState));
  result.measurements.openedMainTab = openedMainTab;
  check('card still opens interview.wav in the main area',
    openedMainTab.label?.includes('素材プレビュー') && openedMainTab.bodyHasInterview, openedMainTab);
  await waitEval(cdp, 'Boolean(document.querySelector(' + S(tile) + ')?.querySelector(".akari-inspector-ai-done-badge"))', 'done badge');
  const geometry = await evalOn(cdp, '(()=>{const e=document.querySelector(' + S(tile) + '),b=e.querySelector(".akari-inspector-ai-done-badge"),'
    + 't=e.querySelector(".akari-inspector-ai-title"),h=document.querySelector(".akari-inspector-ai-material-header");'
    + 'const a=b.getBoundingClientRect(),z=t.getBoundingClientRect(),q=h.getBoundingClientRect();'
    + 'const rect=r=>({x:r.x,y:r.y,width:r.width,height:r.height});return{badge:rect(a),title:rect(z),header:rect(q),'
    + 'intersect:a.left<z.right&&a.right>z.left&&a.top<z.bottom&&a.bottom>z.top,'
    + 'headerIntersect:a.left<q.right&&a.right>q.left&&a.top<q.bottom&&a.bottom>q.top}})()');
  result.measurements.badgeTitleIntersect = geometry.intersect;
  result.measurements.materialHeaderBadgeIntersect = geometry.headerIntersect;
  result.measurements.badgeTitleRects = geometry;
  const audioHeader = await evalOn(cdp, 'document.querySelector(".akari-inspector-ai-material-kind")?.textContent');
  check('audio name, kind, selected AI tab and separate badge rectangles',
    audioHeader === '音声の素材'
      && await evalOn(cdp, 'document.querySelector("[data-akari-inspector-ai-tab=\\"generation\\"]")?.getAttribute("aria-selected")==="true"')
      && !geometry.intersect && !geometry.headerIntersect, { audioHeader, geometry });
  await shotOverview(cdp);
  await shot(cdp, '01-audio-done-tile.png');

  await clickUntil(cdp, tile, 'Boolean(document.querySelector(' + S(panel) + ')?.textContent.includes("文字起こし済み"))', 'done transcript panel');
  check('first lines and daihon', await evalOn(cdp, 'document.querySelectorAll(".akari-inspector-ai-transcribe-row").length>=3'
    + '&&document.querySelector(' + S(panel) + ')?.textContent.includes("インタビューの字幕 1")'
    + '&&document.querySelector(' + S(panel) + ')?.textContent.includes("台本で開く")'), true);
  await shot(cdp, '02-audio-transcript.png');

  // The dialog may auto-start; guard the underlying service and remove cloud keys first.
  const guarded = await evalOn(cdp, '(()=>{const d=window.theia.container._bindingDictionary;'
    + 'const K=[...d._map.keys()].find(k=>String(k)==="Symbol(CommandContribution)");if(!K)return false;'
    + 'const contribution=window.theia.container.getAll(K).find(c=>typeof c.openTranscribeDialog==="function"&&c.projectService);'
    + 'if(!contribution)return false;'
    + 'const blocked=async()=>{window.__akariAiMaterialBlocked=(window.__akariAiMaterialBlocked||0)+1;throw new Error("L1 blocks transcription");};'
    + 'const original=contribution.projectService;contribution.projectService=new Proxy(original,{get(t,p){'
    + 'if(p==="transcribeMaterial")return blocked;const value=Reflect.get(t,p);return typeof value==="function"?value.bind(t):value;}});'
    + 'return contribution.projectService.transcribeMaterial===blocked})()');
  check('transcription RPC blocked before dialog', guarded, guarded);
  await clickUntil(cdp, card('assets/ordinary.mp4'),
    'document.querySelector(".akari-inspector-ai-material-name")?.textContent==="ordinary.mp4"', 'video material');
  await clickUntil(cdp, tile,
    'Boolean([...document.querySelectorAll(' + S(panel + ' button') + ')].find(e=>e.textContent==="文字起こしする"))', 'video transcript panel');
  await clickUntil(cdp, panel + ' button',
    'Boolean(document.querySelector("[data-akari-transcribe-dialog=\\"true\\"]"))', 'existing transcript dialog');
  await shot(cdp, '03-video-dialog.png', '[data-akari-transcribe-dialog="true"]');
  for (let count = 0; count < 3; count++) {
    if (!await evalOn(cdp, 'Boolean(document.querySelector("[data-akari-transcribe-dialog=\\"true\\"]"))')) break;
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(250);
  }
  await waitEval(cdp, '!document.querySelector("[data-akari-transcribe-dialog=\\"true\\"]")', 'dialog closed');
  result.blockedTranscriptions = await evalOn(cdp, 'window.__akariAiMaterialBlocked||0');
  await shot(cdp, '04-video-after-dialog.png');

  await clickUntil(cdp, card('assets/still.png'),
    'document.querySelector(".akari-inspector-ai-material-name")?.textContent==="still.png"', 'image material');
  check('image kind and empty state with zero tiles', await evalOn(cdp,
    'document.querySelector(".akari-inspector-ai-material-kind")?.textContent==="画像の素材"'
    + '&&document.querySelectorAll("[data-akari-inspector-ai-tile]").length===0'
    + '&&document.querySelector(".akari-inspector-ai-material-empty")?.textContent==="この素材で使える AI はまだありません"'), true);
  await shot(cdp, '05-image-empty.png');

  await evalOn(cdp, command('akari.annotations.open')).catch(() => null);
  await waitEval(cdp, '(()=>{const e=document.querySelector("[data-akari-ui=\\"timeline:cut:0\\"]");return !!e&&e.getBoundingClientRect().width>0})()', 'timeline visible');
  await clickUntil(cdp, '[data-akari-ui="timeline:cut:0"]',
    '!document.querySelector(".akari-inspector-ai-material-header")&&Boolean(document.querySelector("[data-akari-ui=\\"tab:inspector-generation\\"]"))',
    'timeline clip');
  await shot(cdp, '06-timeline-return.png');
  result.status = 'PASS';
} catch (error) {
  result.status = 'FAIL'; result.error = String(error);
  if (cdp) {
    try {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const bytes = Buffer.from(data, 'base64');
      await writeFile(path.join(ROOT, 'error-full.png'), bytes);
      result.screenshots.push({ name: 'error-full.png', bytes: bytes.length });
    } catch (screenshotError) { result.errorScreenshot = String(screenshotError); }
    try {
      result.failureState = await evalOn(cdp, `(()=>({
        selectedClips:[...document.querySelectorAll('[data-akari-ui^="timeline:cut:"].akari-annotations-selected,[data-akari-item-kind="audio"].akari-annotations-selected')]
          .map(e=>({ui:e.getAttribute('data-akari-ui'),kind:e.getAttribute('data-akari-item-kind'),id:e.getAttribute('data-akari-item-id')})),
        tabs:[...document.querySelectorAll('[data-akari-ui^="tab:inspector-"]')]
          .map(e=>({id:e.getAttribute('data-akari-ui'),selected:e.getAttribute('aria-selected')})),
        inspector:{present:!!document.querySelector('[data-akari-ui="panel:inspector"]'),
          tile:!!document.querySelector(${S(tile)}),badge:!!document.querySelector('.akari-inspector-ai-done-badge'),
          transcribePanel:!!document.querySelector(${S(panel)}),back:!!document.querySelector('.akari-inspector-ai-back'),
          dialog:!!document.querySelector('[data-akari-transcribe-dialog="true"]')},
        notifications:document.querySelectorAll('.theia-notification-list-item').length
      }))()`);
    } catch (stateError) { result.failureState = { error: String(stateError) }; }
  }
} finally {
  try { cdp?.close(); } catch (error) { result.cleanupError = String(error); }
  if (electron?.pid) {
    result.killedPid = electron.pid;
    try {
      const signal = name => {
        try { process.kill(electron.pid, name); }
        catch (error) { if (error?.code !== 'ESRCH') throw error; }
      };
      if (electron.exitCode === null && electron.signalCode === null) signal('SIGTERM');
      let exited = await waitForExit(electron);
      if (!exited) {
        signal('SIGKILL');
        exited = await waitForExit(electron);
      }
      result.electronExited = exited;
      if (!exited) throw new Error('Electron did not exit after SIGKILL');
    } catch (error) { result.cleanupError = String(error); }
  }
  try {
    await rm(ISO, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch (error) { result.cleanupError = String(error); }
  try { await save(); } catch (error) { process.stderr.write(`Failed to save L1 result: ${String(error)}\n`); process.exitCode = 1; }
}
if (result.status !== 'PASS' || result.cleanupError) process.exitCode = 1;
