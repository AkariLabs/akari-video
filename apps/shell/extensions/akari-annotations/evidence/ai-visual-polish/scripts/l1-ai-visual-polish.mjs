#!/usr/bin/env node
// Requires a built shell. Runs only in a temporary project/profile and leaves evidence here.
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
const FFMPEG = path.join(REPO, 'packages/media-bin/vendor/darwin-arm64/ffmpeg');
const FFPROBE = path.join(REPO, 'packages/media-bin/vendor/darwin-arm64/ffprobe');
const PORT = Number(process.argv.find(arg => arg.startsWith('--port='))?.slice(7) ?? 22249);
const ISO = await mkdtemp(path.join(os.tmpdir(), 'akari-ai-visual-polish-'));
const PROJECT = path.join(ISO, 'project');
const realTemp = await realpath(os.tmpdir());
const tempPaths = new Set([ISO, os.tmpdir(), realTemp]);
for (const dir of [...tempPaths]) {
  if (dir.startsWith('/private/var/folders/')) tempPaths.add(dir.slice('/private'.length));
  if (dir.startsWith('/var/folders/')) tempPaths.add(`/private${dir}`);
}
const redactPaths = [...tempPaths].sort((a, b) => b.length - a.length);
const env = { ...process.env };
for (const key of Object.keys(env)) if (/(?:OPENAI|FAL|GROQ|GEMINI|ELEVENLABS|XAI).*?(?:KEY|TOKEN)/iu.test(key)) delete env[key];
const S = JSON.stringify;
const result = { status: 'running', checks: [], stages: [], clicks: [], screenshots: [],
  quietWaits: [], toastDismissals: [], tabsStyle: { clip: null, material: null, equal: false }, timingsMs: {} };
const save = async () => {
  const file = path.join(ROOT, 'results.json');
  const temporary = `${file}.tmp-${process.pid}`;
  let value = JSON.stringify(result, null, 2);
  for (const dir of redactPaths) value = value.replaceAll(dir, '<TEMP>');
  await writeFile(temporary, value + '\n');
  await rename(temporary, file);
};
const check = (name, passed, measured) => {
  result.checks.push({ name, passed: Boolean(passed), measured });
  if (!passed) throw new Error(`${name}: ${JSON.stringify(measured)}`);
};
async function stage(name, action) {
  const started = Date.now();
  let timer;
  try {
    const value = await Promise.race([
      action(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Stage ${name} exceeded 90s`)), 90_000); })
    ]);
    result.stages.push({ name, passed: true, durationMs: Date.now() - started });
    result.timingsMs[name] = Date.now() - started;
    await save();
    return value;
  } catch (error) {
    result.stages.push({ name, passed: false, durationMs: Date.now() - started, error: String(error) });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
async function waitEval(cdp, expression, name, timeoutMs = 15_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const value = await evalOn(cdp, expression).catch(() => null);
    if (value) return value;
    await sleep(Math.min(160, Math.max(1, end - Date.now())));
  }
  throw new Error(`Timed out: ${name}`);
}
const command = id => `(async()=>{const d=window.theia.container._bindingDictionary;
  const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');
  await window.theia.container.get(C).executeCommand(${S(id)});return true})()`;
async function dismissToast(cdp) {
  const closeButtons = `(()=>{let closed=0;for(const item of document.querySelectorAll(
    '.theia-notifications-container.open .theia-notification-list-item-container')){
    const button=item.querySelector('.theia-notification-actions .codicon-close');
    if(button){button.click();closed++}}
    return{closed,remaining:document.querySelectorAll('.theia-notifications-container.open .theia-notification-list-item-container').length}})()`;
  const first = await evalOn(cdp, closeButtons);
  if (first.remaining) await evalOn(cdp, command('notifications.commands.clearAll')).catch(() => null);
  await waitEval(cdp, `document.querySelectorAll('.theia-notifications-container.open .theia-notification-list-item-container').length===0`,
    'toasts gone', 2_000).catch(() => null);
  const last = await evalOn(cdp, closeButtons);
  result.toastDismissals.push({ closed: first.closed + last.closed, remaining: last.remaining });
  return last.remaining;
}
async function settle(cdp, name, maxMs = 12_000) {
  const started = Date.now();
  const quiet = await evalOn(cdp, `new Promise(resolve=>{const roots=['[data-akari-ui="panel:inspector"]',
      '[data-akari-ui="panel:timeline"]'].map(s=>document.querySelector(s)).filter(Boolean);
      if(!roots.length){resolve(true);return}let stable,limit;
      const observers=roots.map(root=>{const observer=new MutationObserver(reset);
        observer.observe(root,{subtree:true,childList:true,attributes:true,characterData:true});return observer});
      function finish(value){clearTimeout(stable);clearTimeout(limit);observers.forEach(o=>o.disconnect());resolve(value)}
      function reset(){clearTimeout(stable);stable=setTimeout(()=>finish(true),500)}
      limit=setTimeout(()=>finish(false),${maxMs});reset()})`);
  result.quietWaits.push({ name, quiet, durationMs: Date.now() - started });
  return quiet;
}
async function clickUntil(cdp, selector, expected, name) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await settle(cdp, `${name} attempt ${attempt}`, 3_000);
    await dismissToast(cdp);
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
async function shot(cdp, name, rectExpression) {
  await settle(cdp, `${name} capture`, 3_000);
  if (await dismissToast(cdp)) throw new Error(`Toast still covers ${name}`);
  const rect = await waitEval(cdp, rectExpression, `${name} rectangle`, 6_000);
  for (const scale of [1, 0.8, 0.65, 0.5]) {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false,
      clip: { ...rect, scale } });
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length > 500_000) continue;
    await writeFile(path.join(ROOT, name), bytes);
    result.screenshots.push({ name, bytes: bytes.length, scale });
    return;
  }
  throw new Error(`${name} is over 500KB`);
}
const visible = selector => `(()=>{const e=document.querySelector(${S(selector)});if(!e)return false;
  const r=e.getBoundingClientRect(),s=getComputedStyle(e);
  return r.width>0&&r.height>0&&r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight
    &&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)!==0})()`;
const inspectorSelector = '[data-akari-ui="panel:inspector"]';
const stripSelector = `${inspectorSelector} .akari-inspector-tab-strip`;
async function showInspector(cdp, withStrip = false) {
  await evalOn(cdp, command('akari.inspector.open'));
  await waitEval(cdp, visible(inspectorSelector), 'inspector visible', 6_000);
  await evalOn(cdp, `(()=>{document.querySelector(${S(inspectorSelector)}).scrollTop=0;return true})()`);
  if (withStrip) await waitEval(cdp, visible(stripSelector), 'inspector tabs visible', 6_000);
}
const inspectorRect = `(()=>{const panel=document.querySelector('[data-akari-ui="panel:inspector"]'),
  strip=panel?.querySelector('.akari-inspector-tab-strip');if(!panel||!strip)return null;
  const p=panel.getBoundingClientRect(),t=strip.getBoundingClientRect();
  const x=Math.max(0,p.left),y=Math.max(0,p.top),right=Math.min(innerWidth,p.right),
    bottom=Math.min(innerHeight,Math.max(t.bottom+140,p.top+220));
  return p.width>0&&p.height>0&&t.width>0&&t.height>0&&right>x&&bottom>y?
    {x,y,width:right-x,height:bottom-y}:null})()`;
const timelineRect = `(()=>{const ids=['frame-1','ordinary-narration'];const es=ids.map(id=>
  document.querySelector('.akari-annotations-strip-audio[data-akari-item-id="'+id+'"]'));
  const panel=document.querySelector('[data-akari-ui="panel:timeline"]');
  if(es.some(e=>!e)||!panel)return null;const rs=es.map(e=>e.getBoundingClientRect()),p=panel.getBoundingClientRect();
  const left=Math.max(0,p.left),top=Math.max(0,Math.min(...rs.map(r=>r.top))-55);
  const right=Math.min(innerWidth,Math.max(...rs.map(r=>r.right))+25),bottom=Math.min(innerHeight,Math.max(...rs.map(r=>r.bottom))+35);
  return right>left&&bottom>top?{x:left,y:top,width:right-left,height:bottom-top}:null})()`;
const styleExpression = `(()=>{const strip=document.querySelector('[data-akari-ui="panel:inspector"] .akari-inspector-tab-strip');
  if(!strip)return null;const r=strip.getBoundingClientRect(),v=getComputedStyle(strip);
  if(r.width<=0||r.height<=0||r.right<=0||r.bottom<=0||r.left>=innerWidth||r.top>=innerHeight
    ||v.display==='none'||v.visibility==='hidden'||Number(v.opacity)===0)return null;
  const tabs=[...strip.querySelectorAll('.akari-inspector-tab')];
  if(tabs.length<2)return null;const selected=tabs.find(e=>e.classList.contains('is-active')&&e.getAttribute('aria-selected')==='true');
  const inactive=tabs.find(e=>e!==selected&&!e.disabled&&e.getAttribute('aria-selected')==='false');if(!selected||!inactive)return null;
  const css=e=>{const s=getComputedStyle(e);return{backgroundColor:s.backgroundColor,borderRadius:s.borderRadius,
    borderBottom:s.borderBottom,color:s.color,fontWeight:s.fontWeight,padding:s.padding}};
  const ss=getComputedStyle(strip);return{selected:css(selected),inactive:css(inactive),
    strip:{borderBottom:ss.borderBottom,backgroundColor:ss.backgroundColor},
    geometry:{headerBottom:strip.previousElementSibling?.getBoundingClientRect().bottom??null,
      stripTop:strip.getBoundingClientRect().top},roles:{strip:strip.getAttribute('role'),
      selected:selected.getAttribute('role'),inactive:inactive.getAttribute('role')}}})()`;
const frameSelector = '.akari-annotations-strip-audio[data-akari-item-id="frame-1"]';
const normalSelector = '.akari-annotations-strip-audio[data-akari-item-id="ordinary-narration"]';
const audioState = `(()=>{const frame=document.querySelector(${S(frameSelector)}),ordinary=document.querySelector(${S(normalSelector)});
  if(!frame||!ordinary)return null;return{frame:{textContent:frame.textContent,title:frame.title,
    badge:frame.querySelector('[data-akari-generation-badge]')?.textContent??null},
    ordinary:{textContent:ordinary.textContent,title:ordinary.title}}})()`;
const spawnDone = (program, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(program, args, { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'], ...options });
  let stdout = '', stderr = '';
  child.stdout.on('data', part => { stdout += part; });
  child.stderr.on('data', part => { stderr += part; });
  child.once('error', reject);
  child.once('close', code => code === 0 ? resolve(stdout) : reject(new Error(`${program} exited ${code}: ${stderr}`)));
});
async function sideBySide() {
  const dimensions = async name => {
    const output = await spawnDone(FFPROBE, ['-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height', '-of', 'json', path.join(ROOT, name)]);
    const { width, height } = JSON.parse(output).streams?.[0] ?? {};
    if (!(width > 0 && height > 0)) throw new Error(`Invalid screenshot dimensions: ${name}`);
    return { width, height };
  };
  const [clip, material] = await Promise.all([
    dimensions('02-clip-tabs.png'), dimensions('03-material-tabs.png')
  ]);
  for (const width of [320, 260, 210]) {
    // scale=W:-2 rounds each height independently; pad both to the same even height.
    const height = Math.max(...[clip, material].map(item => Math.ceil(item.height * width / item.width / 2) * 2)) + 2;
    await spawnDone(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y',
      '-i', path.join(ROOT, '02-clip-tabs.png'), '-i', path.join(ROOT, '03-material-tabs.png'),
      '-filter_complex', `[0:v]scale=${width}:-2:flags=lanczos,pad=${width}:${height}:0:0:color=black,format=rgb8[a];[1:v]scale=${width}:-2:flags=lanczos,pad=${width}:${height}:0:0:color=black,format=rgb8[b];[a][b]hstack=inputs=2`,
      path.join(ROOT, '04-tabs-side-by-side.png')]);
    const size = (await stat(path.join(ROOT, '04-tabs-side-by-side.png'))).size;
    if (size <= 500_000) { result.screenshots.push({ name: '04-tabs-side-by-side.png', bytes: size, width }); return; }
  }
  throw new Error('04-tabs-side-by-side.png is over 500KB');
}
async function waitExit(child, timeoutMs = 10_000) {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); resolve(true); };
    const timer = setTimeout(() => { child.off('exit', done); resolve(false); }, timeoutMs);
    child.once('exit', done);
  });
}
let electron, cdp;
try {
  await stat(ELECTRON);
  await stage('fixture', async () => { result.fixture = JSON.parse((await spawnDone(process.execPath,
    [path.join(ROOT, 'scripts/gen-fixture.mjs'), PROJECT])).trim()); });
  for (const name of ['akari-home', 'theia-config', 'user-data']) await mkdir(path.join(ISO, name));
  electron = spawn(ELECTRON, [SHELL, PROJECT, `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${path.join(ISO, 'user-data')}`, '--window-size=1600,1000', '--no-sandbox'], {
    cwd: REPO, env: { ...env, AKARI_HOME: path.join(ISO, 'akari-home'),
      THEIA_CONFIG_DIR: path.join(ISO, 'theia-config') }, stdio: 'ignore'
  });
  electron.on('error', error => { result.launchError = String(error); });
  const target = await stage('CDP target', async () => { const end = Date.now() + 90_000; while (Date.now() < end) {
    const page = await listTargets(PORT).then(rows => rows.find(row => row.type === 'page')).catch(() => null);
    if (page) return page; await sleep(300);
  } throw new Error('Electron CDP page did not appear'); });
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect(); await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await waitEval(cdp, `Boolean(window.theia?.container&&document.getElementById('theia-app-shell')&&(()=>{
    const preload=document.querySelector('.theia-preload');if(!preload)return true;
    const s=getComputedStyle(preload);return s.display==='none'||Number(s.opacity)===0})())`,
    'Theia preload gone', 180_000);
  await stage('timeline audio', async () => {
    if (!await evalOn(cdp, `Boolean(document.querySelector(${S(frameSelector)}))`))
      await evalOn(cdp, command('akari.annotations.open'));
    await waitEval(cdp, `Boolean(document.querySelector(${S(frameSelector)}))`, 'audio frame', 30_000);
    await settle(cdp, 'timeline audio', 10_000);
    const state = await evalOn(cdp, audioState);
    result.audio = state;
    check('frame name absent from textContent and title',
      !/frame-1|frame-audio-fixture\.wav/u.test(state.frame.textContent + state.frame.title), state.frame);
    check('planned audio badge visible', state.frame.badge === '空の枠（音）', state.frame.badge);
    check('ordinary audio name visible', /ordinary\.wav/u.test(state.ordinary.textContent), state.ordinary);
    await shot(cdp, '01-audio-frame-timeline.png', timelineRect);
  });
  await stage('clip tabs', async () => {
    await showInspector(cdp);
    await clickUntil(cdp, '[data-akari-ui="timeline:cut:0"]',
      `Boolean(document.querySelector('[data-akari-ui="timeline:cut:0"].akari-annotations-selected')
        &&document.querySelector('[data-akari-ui="panel:inspector"] .akari-inspector-tab-strip .akari-inspector-tab.is-active'))`, 'video clip');
    await showInspector(cdp, true);
    result.tabsStyle.clip = await waitEval(cdp, styleExpression, 'visible clip tabs', 6_000);
    check('clip tab style observed', Boolean(result.tabsStyle.clip), result.tabsStyle.clip);
    await shot(cdp, '02-clip-tabs.png', inspectorRect);
  });
  await stage('material tabs', async () => {
    await showInspector(cdp, true);
    await clickUntil(cdp, '[data-akari-material-path="assets/ordinary.wav"]',
      `Boolean(document.querySelector('.akari-inspector-ai-material-header')&&document.querySelector('[data-akari-inspector-ai-tab="generation"].is-active'))`, 'material card');
    await showInspector(cdp, true);
    result.tabsStyle.material = await waitEval(cdp, styleExpression, 'visible material tabs', 6_000);
    check('material tab below header', result.tabsStyle.material?.geometry.headerBottom > 0
      && result.tabsStyle.material.geometry.headerBottom <= result.tabsStyle.material.geometry.stripTop + 1,
      result.tabsStyle.material?.geometry);
    await shot(cdp, '03-material-tabs.png', inspectorRect);
    const comparable = value => ({ selected: value.selected, inactive: value.inactive,
      strip: value.strip, roles: value.roles });
    result.tabsStyle.equal = JSON.stringify(comparable(result.tabsStyle.clip)) === JSON.stringify(comparable(result.tabsStyle.material));
    check('clip and material computed tab styles equal', result.tabsStyle.equal, result.tabsStyle);
    await save();
    await sideBySide();
  });
  result.status = 'PASS';
} catch (error) {
  result.status = 'FAIL'; result.error = String(error);
  if (cdp) {
    try {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const bytes = Buffer.from(data, 'base64');
      await writeFile(path.join(ROOT, 'error-full.png'), bytes);
      result.screenshots.push({ name: 'error-full.png', bytes: bytes.length });
    } catch (shotError) { result.errorScreenshot = String(shotError); }
    try {
      result.failureState = await evalOn(cdp, `(()=>({readyState:document.readyState,
        preload:!!document.querySelector('.theia-preload'),audio:(${audioState}),
        tabs:(${styleExpression}),material:document.querySelector('.akari-inspector-ai-material-name')?.textContent??null,
        notifications:document.querySelectorAll('.theia-notification-list-item').length}))()`);
    } catch (stateError) { result.failureState = { error: String(stateError) }; }
  } else result.failureState = { electronPid: electron?.pid ?? null, launchError: result.launchError ?? null };
} finally {
  try { cdp?.close(); } catch (error) { result.cleanupError = String(error); }
  if (electron?.pid) {
    result.killedPid = electron.pid;
    try {
      const signal = name => { try { process.kill(electron.pid, name); }
        catch (error) { if (error?.code !== 'ESRCH') throw error; } };
      if (electron.exitCode === null && electron.signalCode === null) signal('SIGTERM');
      if (!await waitExit(electron)) { signal('SIGKILL'); await waitExit(electron); }
    } catch (error) { result.cleanupError = String(error); }
  }
  try { await rm(ISO, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); }
  catch (error) { result.cleanupError = String(error); }
  try { await save(); } catch (error) { process.stderr.write(`Could not save results: ${String(error)}\n`); process.exitCode = 1; }
}
if (result.status !== 'PASS' || result.cleanupError) process.exitCode = 1;
