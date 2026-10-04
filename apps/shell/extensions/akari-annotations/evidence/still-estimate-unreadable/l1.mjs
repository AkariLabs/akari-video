#!/usr/bin/env node
// Development Electron + CDP reproduction. Never clicks the generation button.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, renameSync } from 'node:fs';
import { mkdir, mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { deflateSync } from 'node:zlib';

import { CDP, evalOn, listTargets, realClick } from '../gen-ux-polish-b/scripts/cdp-lib.mjs';

const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const outArg = arg('out');
if (!outArg) throw new Error('--out=<dir> is required');
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(arg('repo') ?? path.resolve(here, '../../../../../../'));
const shell = path.join(repo, 'apps/shell');
const out = path.resolve(outArg);
const ownIso = !arg('iso');
const iso = path.resolve(arg('iso') ?? await mkdtemp(path.join(os.tmpdir(), 'akari-still-estimate-')));
const port = Number(arg('port') ?? 22491);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--port must be a TCP port');
if (out.replaceAll('\\', '/').includes('/evidence/')) throw new Error('--out must be outside evidence/');
if (iso === repo || iso.startsWith(`${repo}${path.sep}`)) throw new Error('--iso must be outside the repository');
const project = path.join(iso, 'project');
const schema = path.join(repo, 'packages/schemas/ai-models.json');
const backup = path.join(path.dirname(schema), `ai-models.json.l1-backup-${process.pid}`);
const results = { status: 'running', checks: [], observations: {}, screenshots: [], restored: false };
const clean = value => {
  let text = String(value);
  for (const [source, replacement] of [[repo, '<REPO>'], [iso, '<TMP>'], [os.homedir(), '<HOME>']]) {
    text = text.replaceAll(source, replacement).replaceAll(source.replaceAll('\\', '/'), replacement);
  }
  return text;
};
const save = () => writeFile(path.join(out, 'results.json'),
  `${JSON.stringify(results, (_key, value) => typeof value === 'string' ? clean(value) : value, 2)}\n`);
const check = (name, pass, observed) => {
  results.checks.push({ name, pass: Boolean(pass), observed });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
};
const S = JSON.stringify;
let child, cdp, moved = false, interrupted = false;
function restoreSync() {
  if (moved && existsSync(backup)) { renameSync(backup, schema); moved = false; }
}
process.on('exit', () => { try { restoreSync(); } catch { /* Last resort after regular cleanup. */ } });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  interrupted = true;
  try { restoreSync(); } catch (error) { results.restoreError = clean(error); }
});
function fatal(error) {
  results.status = 'FAIL';
  results.error = clean(error?.stack ?? error);
  try { restoreSync(); } catch (restoreError) { results.restoreError = clean(restoreError); }
  if (child?.pid) {
    try {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      else process.kill(-child.pid, 'SIGTERM');
    } catch { /* Exit still restores the catalog. */ }
  }
  process.exit(1);
}
process.on('uncaughtException', fatal);
process.on('unhandledRejection', fatal);

function png() {
  const width = 640; const height = 360;
  const crc32 = data => {
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const name = Buffer.from(type, 'ascii');
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([length, name, data, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2; // RGB, eight bits per channel.
  const pixels = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const start = y * (1 + width * 3); // Each row begins with PNG filter 0.
    for (let x = 0; x < width; x++) {
      const at = start + 1 + x * 3;
      pixels[at] = 110; pixels[at + 1] = 155; pixels[at + 2] = 125;
    }
  }
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
async function fixture() {
  for (const dir of ['project/assets', 'project/.akari', 'home', 'appdata', 'localappdata', 'akari-home',
    'theia-config', 'user-data', 'temp']) await mkdir(path.join(iso, dir), { recursive: true });
  await writeFile(path.join(project, 'assets/photo.png'), png());
  await writeFile(path.join(project, '.akari/connections.json'), `${S({ providers: [],
    defaults: { generate: { still: 'codex-image', video: 'fal:h3-i2v' } },
    policy: { currency: 'USD', monthly_budget: null, approval_threshold: null }, memory: [] })}\n`);
  await writeFile(path.join(iso, 'akari-home/credentials.env'), 'FAL_KEY=local-test-key\n');
  await writeFile(path.join(project, 'captions.json'), '{"captions":[]}\n');
  await writeFile(path.join(project, 'edit.json'), `${S({ version: 2,
    output: { width: 1920, height: 1080, fps: 30 },
    sources: [{ id: 'photo', path: 'assets/photo.png' }],
    tracks: [{ id: 'visual-main', lane: 'visual', items: [
      { id: 'photo-1', at: 0, duration: 90, source: { kind: 'media', src: 'photo', in: 0, out: 3 } }
    ] }], audio: { narration: [], sfx: [] } })}\n`);
}
async function until(operation, label, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    if (interrupted) throw new Error('interrupted');
    try { const value = await operation(); if (value) return value; } catch (error) { last = error; }
    await sleep(150);
  }
  throw new Error(`${label} timed out${last ? `: ${last.message}` : ''}`);
}
const waitEval = (expression, label, timeout) => until(() => evalOn(cdp, expression), label, timeout);
async function click(selector) {
  const point = await waitEval(`(()=>{const e=document.querySelector(${S(selector)});if(!e)return null;
    e.scrollIntoView({block:'center',behavior:'instant'});const r=e.getBoundingClientRect();
    return r.width&&r.height?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`, selector);
  await realClick(cdp, point.x, point.y);
}
async function clickUntil(selector, expected, label, timeout = 20_000, alwaysClick = false) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    if (!alwaysClick && await evalOn(cdp, expected).catch(() => false)) return;
    try {
      await click(selector);
      await waitEval(expected, label, Math.min(5_000, Math.max(500, deadline - Date.now())));
      return;
    } catch (error) { last = error; }
  }
  throw new Error(`${label} did not appear after repeated clicks: ${last?.message ?? 'unknown'}`);
}
const command = (id, value) => `(()=>{const c=window.theia.container,d=c._bindingDictionary;
  const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');
  try { Promise.resolve(c.get(C).executeCommand(${S(id)}${value === undefined ? '' : `,${S(value)}`})).catch(()=>{}); } catch {}
  return true})()`;
async function shot(name) {
  await evalOn(cdp, command('notifications.commands.clearAll')).catch(() => undefined);
  await sleep(400);
  // Unrelated app toasts sit on top of the create button. Hide them for the capture only.
  await evalOn(cdp, `(()=>{for(const e of document.querySelectorAll('[data-akari-timeline-notice], .akari-guide-announcement'))e.style.visibility='hidden';return true})()`).catch(() => undefined);
  await evalOn(cdp, `(()=>{const e=document.querySelector('[data-akari-inspector-ai-estimate-error]')
    ??document.querySelector('[data-akari-inspector-ai-create="true"]');
    e?.scrollIntoView({block:'center',behavior:'instant'});return true})()`);
  await sleep(200);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(out, `${name}.png`), Buffer.from(data, 'base64'));
  results.screenshots.push(`${name}.png`);
  const box = await evalOn(cdp, `(()=>{const r=document.querySelector('[data-akari-ui="panel:inspector"]')?.getBoundingClientRect();
    return r&&r.width&&r.height?{x:r.left,y:r.top,width:r.width,height:r.height}:null})()`).catch(() => null);
  if (box) {
    const clipped = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { ...box, scale: 1 } });
    await writeFile(path.join(out, `${name}-panel.png`), Buffer.from(clipped.data, 'base64'));
    results.screenshots.push(`${name}-panel.png`);
  }
}
const inspect = `(()=>{const p=document.querySelector('.akari-inspector-ai-still-panel');
  const q=s=>p?.querySelector(s);const button=q('[data-akari-inspector-ai-create="true"]');
  return { panel:!!p, text:p?.textContent??'', price:q('.akari-inspector-ai-still-route-price')?.textContent??'',
    reason:q('[data-akari-inspector-ai-estimate-error]')?.textContent??'',
    buttonText:button?.textContent??'', buttonDisabled:button?.disabled??null,
    prompt:q('[data-akari-inspector-ai-prompt="true"]')?.value??'',
    falSelected:q('[data-akari-inspector-ai-route="fal"] input')?.checked??false,
    codexSelected:q('[data-akari-inspector-ai-route="codex"] input')?.checked??false }})()`;
async function stopOwnElectron() {
  if (!child?.pid) return;
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise(resolve => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      killer.once('error', resolve); killer.once('close', resolve);
    });
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
  }
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(10_000)]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

await mkdir(out, { recursive: true });
try {
  if (!existsSync(schema) || existsSync(backup)) throw new Error('price catalog missing or backup already exists');
  await fixture();
  await rename(schema, backup); moved = true;
  const suffix = process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron'
    : process.platform === 'win32' ? 'electron.exe' : 'electron';
  const candidates = [path.join(shell, 'node_modules/electron/dist', suffix), path.join(repo, 'node_modules/electron/dist', suffix)];
  const electron = (await Promise.all(candidates.map(async candidate =>
    await stat(candidate).then(value => value.isFile()).catch(() => false) ? candidate : null))).find(Boolean);
  if (!electron) throw new Error('Electron binary is missing');
  const env = { ...process.env, HOME: path.join(iso, 'home'), USERPROFILE: path.join(iso, 'home'),
    APPDATA: path.join(iso, 'appdata'), LOCALAPPDATA: path.join(iso, 'localappdata'),
    AKARI_HOME: path.join(iso, 'akari-home'), THEIA_CONFIG_DIR: path.join(iso, 'theia-config'),
    TEMP: path.join(iso, 'temp'), TMP: path.join(iso, 'temp') };
  for (const name of Object.keys(env)) if (/FAL|OPENAI|GEMINI|GOOGLE|GROQ|XAI|ANTHROPIC|AKARI_CREDENTIALS_FILE/u.test(name)
    || name === 'ELECTRON_RUN_AS_NODE') delete env[name];
  child = spawn(electron, [shell, project, `--remote-debugging-port=${port}`,
    `--user-data-dir=${path.join(iso, 'user-data')}`, '--window-size=1600,1000', '--no-sandbox', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion'],
  { cwd: repo, env, stdio: 'ignore', detached: process.platform !== 'win32' });
  child.once('error', error => { results.launchError = clean(error); interrupted = true; });
  results.observations.electronPid = child.pid;
  const target = await until(async () => (await listTargets(port)).find(row => row.type === 'page'), 'CDP page', 600_000);
  cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect();
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await waitEval(`Boolean(window.theia?.container&&document.getElementById('theia-app-shell'))`, 'Theia', 1_200_000);
  await waitEval(`(()=>{const e=document.querySelector('.theia-preload');return !e||e.classList.contains('theia-hidden')||getComputedStyle(e).display==='none'})()`, 'preload', 480_000);
  if (!await evalOn(cdp, `Boolean(document.querySelector('[data-akari-ui="timeline:cut:0"]'))`))
    await evalOn(cdp, command('akari.annotations.open')).catch(() => undefined);
  await waitEval(`Boolean(document.querySelector('[data-akari-ui="timeline:cut:0"]'))`, 'timeline', 60_000);
  await evalOn(cdp, command('akari.inspector.open')).catch(() => undefined);
  await waitEval(`Boolean(document.querySelector('[data-akari-ui="panel:inspector"]'))`, 'inspector');
  await evalOn(cdp, `(async()=>{const c=window.theia.container,d=c._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');try{await Promise.race([c.get(C).executeCommand('akari.preview.ensureVisible',${S({ editUri: pathToFileURL(path.join(project, 'edit.json')).toString() })}),new Promise(r=>setTimeout(r,20000))])}catch{}return true})()`).catch(() => undefined);
  await clickUntil('[data-akari-ui="timeline:cut:0"]', `(()=>{const e=document.querySelector('[data-akari-ui="tab:inspector-edit"]');if(!e)return false;const r=e.getBoundingClientRect();return r.width>0&&r.height>0})()`, 'cut selected', 60_000);
  await clickUntil('[data-akari-ui="tab:inspector-edit"]',
    `Boolean(document.querySelector('[data-akari-inspector-ai-tile="still"]'))`, 'inspector edit');
  await waitEval(`Boolean(document.querySelector('[data-akari-inspector-ai-tile="still"]'))`, 'still tile');
  await clickUntil('[data-akari-inspector-ai-tile="still"]', `Boolean(document.querySelector('.akari-inspector-ai-still-panel'))`, 'still panel');
  const falOnly = `(()=>{const q=id=>document.querySelector('[data-akari-inspector-ai-route="'+id+'"] input');
    return q('fal')?.checked===true&&['codex','antigravity','grok'].every(id=>q(id)?.checked===false)})()`;
  for (let attempt = 0; attempt < 4; attempt++) {
    await waitEval(`document.querySelector('[data-akari-inspector-ai-refresh="true"]')?.disabled===false`, 'route checks settled');
    await waitEval(`document.querySelector('[data-akari-inspector-ai-route="fal"] input')?.disabled===false`, 'fal route ready');
    for (const id of ['codex', 'antigravity', 'grok']) {
      if (await evalOn(cdp, `document.querySelector('[data-akari-inspector-ai-route="${id}"] input')?.checked`))
        await clickUntil(`[data-akari-inspector-ai-route="${id}"] input`,
          `document.querySelector('[data-akari-inspector-ai-route="${id}"] input')?.checked===false`, `${id} unselected`);
    }
    if (!await evalOn(cdp, `document.querySelector('[data-akari-inspector-ai-route="fal"] input')?.checked`))
      await clickUntil('[data-akari-inspector-ai-route="fal"] input',
        `document.querySelector('[data-akari-inspector-ai-route="fal"] input')?.checked===true`, 'fal selected');
    await sleep(300);
    if (await evalOn(cdp, falOnly)) break;
    if (attempt === 3) throw new Error('fal-only route selection did not persist');
  }
  const failed = await waitEval(`(()=>{const p=document.querySelector('.akari-inspector-ai-still-panel');
    return p?.querySelector('[data-akari-inspector-ai-estimate-error]')?.textContent??null})()`, 'estimate failure');
  const first = await evalOn(cdp, inspect);
  results.observations.beforeInput = first;
  check('失敗理由を手段の行とボタン近くに表示し確認中を残さない', !!failed && !!first.price
    && first.reason.includes(first.price) && failed.includes(first.price)
    && first.reason.includes('「状態を確かめ直す」で読み直せます')
    && !first.text.includes('確認中') && first.falSelected && !first.codexSelected, first);
  check('失敗時は作成ボタンを押せない', first.buttonDisabled === true, first);
  await shot('price-unreadable');
  await click('[data-akari-inspector-ai-prompt="true"]');
  await evalOn(cdp, `(()=>{document.querySelector('[data-akari-inspector-ai-prompt="true"]').select();return true})()`);
  await cdp.send('Input.insertText', { text: '夕焼けの庭' });
  await waitEval(`document.querySelector('[data-akari-inspector-ai-prompt="true"]')?.value==='夕焼けの庭'`, 'prompt input');
  const typed = await evalOn(cdp, inspect);
  results.observations.afterInput = typed;
  check('指示文の input 後も作成ボタンを押せない', typed.prompt === '夕焼けの庭'
    && typed.buttonDisabled === true && typed.price === first.price && typed.reason.includes(first.price)
    && !typed.text.includes('確認中'), typed);
  await shot('price-unreadable-after-input');
  await rename(backup, schema); moved = false;
  await clickUntil('[data-akari-inspector-ai-refresh="true"]',
    `(()=>{const b=document.querySelector('[data-akari-inspector-ai-create="true"]');
      return b&&!b.disabled&&/\\$0\\.\\d{3}/u.test(b.textContent??'')})()`, 'estimate after refresh', 60_000, true);
  const recovered = await waitEval(`(()=>{const b=document.querySelector('[data-akari-inspector-ai-create="true"]');
    return b&&!b.disabled&&/\\$0\\.\\d{3}/u.test(b.textContent??'')?b.textContent:null})()`, 'estimate after refresh');
  const after = await evalOn(cdp, inspect);
  results.observations.afterRefresh = after;
  check('再起動せず再確認で見積と押せる状態に戻る', !!recovered && !after.reason && after.buttonDisabled === false, after);
  await shot('price-recovered');
  results.status = !interrupted && results.checks.every(row => row.pass) ? 'PASS' : 'FAIL';
} catch (error) {
  results.status = 'FAIL';
  results.error = clean(error?.stack ?? error);
} finally {
  // Restore first. Every later cleanup step is independent so none can skip this.
  if (moved) {
    try { await rename(backup, schema); moved = false; }
    catch (error) { results.restoreError = clean(error); results.status = 'FAIL'; }
  }
  try { cdp?.close(); } catch (error) { results.cdpCleanupError = clean(error); results.status = 'FAIL'; }
  try { await stopOwnElectron(); }
  catch (error) { results.cleanupError = clean(error); results.status = 'FAIL'; }
  results.restored = existsSync(schema) && !existsSync(backup);
  if (!results.restored || interrupted) results.status = 'FAIL';
  try { await save(); }
  catch (error) { results.saveError = clean(error); results.status = 'FAIL'; }
  if (ownIso) {
    try { await rm(iso, { recursive: true, force: true }); }
    catch (error) { results.isolationCleanupError = clean(error); results.status = 'FAIL'; }
  }
  if (results.saveError || results.isolationCleanupError) {
    try { await save(); } catch { /* Exit remains failed. */ }
  }
}
if (results.status !== 'PASS') process.exitCode = 1;
