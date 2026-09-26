#!/usr/bin/env node
// 手順 3（AFTER）: npm run build 後、node l1-after.mjs [--port=9641] [--stub-port=19641]
// 隔離した Electron を鍵なし・ダミー鍵ありの順で起動し、fal はローカル HTTP スタブだけへ向ける。
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick } from './cdp-lib.mjs';

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(SCRIPTS);
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps/shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const BIN = path.join(SCRIPTS, 'stub-bin');
const PORT = Number(process.argv.find(arg => arg.startsWith('--port='))?.slice(7) ?? 9641);
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const STUB_PORT = Number(process.argv.find(arg => arg.startsWith('--stub-port='))?.slice(12) ?? 19641);
const ISO = await realpath(await mkdtemp(path.join(os.tmpdir(), 'akari-route-groups-fal-still-after-')));
const PROJECT = path.join(ISO, 'project');
const S = JSON.stringify;
const results = { phase: 'after', status: 'running', step: '', observations: {}, checks: [], screenshots: [] };
const clean = value => String(value).replaceAll(REPO, '<WORKTREE>').replaceAll(ISO, '<TMP>').replaceAll(os.homedir(), '<HOME>')
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '<email>');
async function save() {
  const target = path.join(ROOT, 'results-after.json');
  await writeFile(`${target}.tmp`, `${clean(JSON.stringify(results, null, 2))}\n`);
  await rename(`${target}.tmp`, target);
}
async function stage(name) { results.step = name; console.log(`[after] ${name}`); await save(); }
function check(name, pass, measured) {
  results.checks.push({ name, pass: Boolean(pass), measured });
  if (!pass) throw new Error(`Check failed: ${name}`);
}
async function waitEval(cdp, expression, name, timeout = 30_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const value = await evalOn(cdp, expression).catch(() => undefined);
    if (value) return value;
    await sleep(150);
  }
  throw new Error(`Timed out: ${name}`);
}
const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', chunk => { out += chunk; });
  child.stderr.on('data', chunk => { out += chunk; });
  child.once('error', reject);
  child.once('close', code => resolve({ code, out }));
});
const mustRun = async (command, args) => { const r = await run(command, args); if (r.code !== 0) throw new Error(`${command} failed: ${r.out.slice(-800)}`); };
async function makeFixture() {
  await mkdir(path.join(PROJECT, 'assets'), { recursive: true });
  await mkdir(path.join(PROJECT, '.akari'), { recursive: true });
  await mustRun(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'cellauto=s=1920x1080:r=30:rule=110,format=rgb24,colorchannelmixer=rr=1:gg=0.6:bb=0.2',
    '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(PROJECT, 'assets', 'clip.mp4')]);
  await mustRun(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=#2a9d8f:s=1920x1080',
    '-frames:v', '1', path.join(PROJECT, 'assets', 'photo.png')]);
  await writeFile(path.join(PROJECT, '.akari', 'connections.json'), `${JSON.stringify({
    providers: [], defaults: { generate: { still: 'codex-image', video: 'fal:h3-i2v' } },
    policy: { currency: 'USD', monthly_budget: null, approval_threshold: null }, memory: []
  }, null, 2)}\n`);
  await writeFile(path.join(PROJECT, 'captions.json'), '{ "captions": [] }\n');
  await writeFile(path.join(PROJECT, 'edit.json'), `${JSON.stringify({
    version: 2, output: { width: 1920, height: 1080, fps: 30 },
    sources: [{ id: 'src-clip', path: 'assets/clip.mp4' }, { id: 'src-photo', path: 'assets/photo.png' }],
    tracks: [{ id: 'visual-main', lane: 'visual', items: [
      { id: 'clip-video', at: 0, duration: 90, source: { kind: 'media', src: 'src-clip', in: 0, out: 3 } },
      { id: 'clip-photo', at: 150, duration: 60, source: { kind: 'media', src: 'src-photo', in: 0, out: 2 } }
    ] }],
    audio: { narration: [], sfx: [] }
  }, null, 2)}\n`);
}
const readEdit = async () => JSON.parse(await readFile(path.join(PROJECT, 'edit.json'), 'utf8'));
const frameItems = async () => (await readEdit()).tracks.flatMap(t => t.items ?? []).filter(row => String(row.id).startsWith('frame-'));
async function clearNotifications(cdp) {
  await evalOn(cdp, `(async()=>{try{const c=window.theia?.container;const d=c?._bindingDictionary;
    const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');
    await c.get(C).executeCommand('notifications.commands.clearAll');}catch{}return true})()`).catch(() => undefined);
}
async function settle(cdp) {
  await evalOn(cdp, `(()=>new Promise(resolve=>{const roots=['[data-akari-ui="panel:inspector"]','[data-akari-ui="panel:timeline"]','[data-akari-settings-dialog]']
    .map(x=>document.querySelector(x)).filter(Boolean);if(!roots.length){resolve(true);return}
    let quiet,limit;const observers=roots.map(root=>{const o=new MutationObserver(reset);o.observe(root,{subtree:true,childList:true,attributes:true,characterData:true});return o});
    function finish(){clearTimeout(quiet);clearTimeout(limit);observers.forEach(o=>o.disconnect());resolve(true)}
    function reset(){clearTimeout(quiet);quiet=setTimeout(finish,500)}limit=setTimeout(finish,30000);reset()}) )()`);
}
async function pointOf(cdp, selector) {
  return waitEval(cdp, `(async()=>{const e=document.querySelector(${S(selector)});if(!e)return null;
    e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const b=e.getBoundingClientRect();if(!b.width||!b.height)return null;
    for(const f of [0.5,0.25,0.75,0.15,0.85]){const x=b.left+b.width*f,y=b.top+b.height/2;const hit=document.elementFromPoint(x,y);
      if(hit&&(hit===e||e.contains(hit)))return{x,y}}return null})()`, `click target ${selector}`);
}
async function clickUntil(cdp, selector, expectation, name) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await settle(cdp);
    await clearNotifications(cdp);
    try {
      const point = await pointOf(cdp, selector);
      await realClick(cdp, point.x, point.y);
      await waitEval(cdp, expectation, name, 8000);
      return;
    } catch (error) { if (attempt === 3) throw error; }
  }
}
async function shot(cdp, name) {
  await clearNotifications(cdp);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const bytes = Buffer.from(data, 'base64');
  const target = path.join(ROOT, name);
  await writeFile(target, bytes);
  if (bytes.length > 500000) {
    for (const width of [1280, 1000]) {
      const resized = `${target}.resized.png`;
      await mustRun('sips', ['-Z', String(width), '--out', resized, target]);
      await rename(resized, target);
      if ((await stat(target)).size <= 500000) break;
    }
  }
  results.screenshots.push({ name, bytes: (await stat(target)).size });
  await save();
}

// L1: all paid calls are redirected by AKARI_FAL_STUB_URL. The server records every request.
let electron, cdp, server;
const requests = [];
const command = (id, arg) => `(async()=>{const c=window.theia.container,d=c._bindingDictionary;
  const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');
  const result=await c.get(C).executeCommand(${S(id)}${arg === undefined ? '' : `,${S(arg)}`});
  try{return JSON.stringify(result??null)}catch{return String(result)}})()`;
const exec = (id, arg) => evalOn(cdp, command(id, arg));
async function stopElectron() {
  try { cdp?.close(); } catch {}
  cdp = undefined;
  if (electron && electron.exitCode === null) {
    electron.kill('SIGTERM');
    await new Promise(resolve => { const timer = setTimeout(resolve, 10000); electron.once('exit', () => { clearTimeout(timer); resolve(); }); });
    if (electron.exitCode === null && electron.signalCode === null) electron.kill('SIGKILL');
  }
  electron = undefined;
}
async function startElectron(withKey) {
  const env = { ...process.env, HOME: path.join(ISO, 'home'), AKARI_HOME: path.join(ISO, 'akari-home'),
    THEIA_CONFIG_DIR: path.join(ISO, 'theia-config'), PATH: `${BIN}${path.delimiter}${process.env.PATH}`,
    AKARI_CODEX_BIN: path.join(BIN, 'codex'), AKARI_AGY_BIN: path.join(BIN, 'agy'),
    AKARI_GROK_BIN: path.join(BIN, 'grok'), AKARI_FAL_STUB_URL: `http://127.0.0.1:${STUB_PORT}` };
  for (const name of ['ELECTRON_RUN_AS_NODE', 'FAL_KEY', 'GROQ_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'XAI_API_KEY',
    'ANTHROPIC_API_KEY', 'FAL_API_KEY', 'AKARI_IMAGE_AI_FAL_KEY', 'AKARI_IMAGE_AI_USE_NARRATION_KEY', 'AKARI_CREDENTIALS_FILE']) delete env[name];
  electron = spawn(ELECTRON, [SHELL, PROJECT, `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${path.join(ISO, withKey ? 'user-data-keyed' : 'user-data-keyless')}`, '--window-size=1800,1000', '--no-sandbox'],
    { cwd: REPO, env, stdio: 'ignore' });
  results.observations[withKey ? 'keyedElectronPid' : 'keylessElectronPid'] = electron.pid;
  const target = await (async () => { const until = Date.now() + 600000; while (Date.now() < until) {
    const page = await listTargets(PORT).then(rows => rows.find(row => row.type === 'page')).catch(() => undefined);
    if (page) return page;
    await sleep(300);
  } throw new Error('CDP page missing'); })();
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect(); await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await waitEval(cdp, `Boolean(window.theia?.container&&document.getElementById('theia-app-shell'))`, 'Theia', 1200000);
  if (!await evalOn(cdp, `Boolean(document.querySelector('[data-akari-ui="timeline:cut:0"]'))`)) await exec('akari.annotations.open');
  await waitEval(cdp, `Boolean(document.querySelector('[data-akari-ui="timeline:cut:1"]'))`, 'timeline', 900000);
  await exec('akari.inspector.open').catch(() => undefined);
  await waitEval(cdp, `Boolean(document.querySelector('[data-akari-ui="panel:inspector"]'))`, 'inspector');
  await waitEval(cdp, `(()=>{const e=document.querySelector('.theia-preload');if(!e)return true;const s=getComputedStyle(e),r=e.getBoundingClientRect();
    return !(s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0&&r.width&&r.height)})()`, 'preload', 480000);
}
async function openExistingFrame(frame) {
  await clickUntil(cdp, `[data-akari-ui="panel:timeline"] [data-akari-item-id="${frame}"]`,
    `(document.querySelector('[data-akari-ui="inspector-selection-header"]')?.textContent??'').length>0`, 'select frame');
  const tabActive = `(()=>{const t=document.querySelector('[data-akari-ui="tab:inspector-edit"]');return !!t&&(t.classList.contains('is-active')||t.getAttribute('aria-selected')==='true')})()`;
  if (!await evalOn(cdp, tabActive)) await clickUntil(cdp, '[data-akari-ui="tab:inspector-edit"]', tabActive, 'edit tab');
  if (!await evalOn(cdp, `Boolean(document.querySelector('[data-akari-inspector-ai-create="true"]'))`))
    await clickUntil(cdp, '[data-akari-inspector-ai-tile="still"]', `Boolean(document.querySelector('[data-akari-inspector-ai-create="true"]'))`, 'still panel');
  await waitEval(cdp, `[...document.querySelectorAll('[data-akari-inspector-ai-route-state]')].every(e=>e.getAttribute('data-akari-inspector-ai-route-state')!=='checking')`, 'route probe', 60000);
}
async function clickText(text) {
  const selector = await waitEval(cdp, `(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent?.trim()===${S(text)});if(!b)return null;
    b.setAttribute('data-l1-after-click','true');return '[data-l1-after-click="true"]'})()`, `button ${text}`);
  const { x, y } = await pointOf(cdp, selector);
  await realClick(cdp, x, y);
  await evalOn(cdp, `document.querySelector('[data-l1-after-click="true"]')?.removeAttribute('data-l1-after-click')`);
}
async function screenshot(name) { await settle(cdp); await shot(cdp, name); }
try {
  await stage('fixture and local fal stub');
  await stat(ELECTRON);
  await makeFixture();
  for (const name of ['akari-home', 'theia-config', 'user-data-keyless', 'user-data-keyed', 'home']) await mkdir(path.join(ISO, name));
  const image = await readFile(path.join(PROJECT, 'assets/photo.png'));
  server = createServer(async (req, res) => {
    const chunks = []; for await (const part of req) chunks.push(part);
    const raw = Buffer.concat(chunks).toString();
    const url = new URL(req.url, `http://127.0.0.1:${STUB_PORT}`);
    const row = { method: req.method, path: url.pathname, authorizedWithDummyKey: req.headers.authorization === 'Key stub-route-groups-fal-still' };
    if (req.method === 'POST') {
      try { const body = JSON.parse(raw); row.input = { image_size: body.image_size, quality: body.quality,
        num_images: body.num_images, referenceCount: body.image_urls?.length ?? 0 }; } catch { row.input = 'invalid-json'; }
    }
    requests.push(row);
    results.observations.stubRequests = requests;
    if (req.method === 'POST' && url.pathname.includes('/openai/gpt-image-2.5/flare/')) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ request_id: `stub-${requests.length}`, status_url: `http://127.0.0.1:${STUB_PORT}/status/1`,
        response_url: `http://127.0.0.1:${STUB_PORT}/response/1` }));
    } else if (url.pathname === '/status/1') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ status: 'COMPLETED' })); }
    else if (url.pathname === '/response/1') { res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ images: [{ url: `http://127.0.0.1:${STUB_PORT}/image.png` }] })); }
    else if (url.pathname === '/image.png') { res.setHeader('content-type', 'image/png'); res.end(image); }
    else { res.statusCode = 404; res.end('missing'); }
  });
  await new Promise(resolve => server.listen(STUB_PORT, '127.0.0.1', resolve));
  results.observations.falNetwork = { stubHost: '127.0.0.1', stubPort: STUB_PORT,
    redirectEnvironment: 'AKARI_FAL_STUB_URL', productGuard: 'falStillFetch rejects non-stub host', outsideFalHosts: [] };

  await stage('keyless Electron');
  await startElectron(false);
  await stage('draw an empty frame above V1');
  let created;
  for (let attempt = 1; attempt <= 3 && !created; attempt++) {
    await exec('akari.timeline.setTool', { tool: 'frame' });
    await waitEval(cdp, `document.querySelector('button[aria-label="仮枠ツール"]')?.getAttribute('aria-pressed')==='true'`, 'frame tool');
    await settle(cdp);
    await clearNotifications(cdp);
    const g = await evalOn(cdp, `(()=>{const b=document.querySelector('[data-akari-ui="timeline:cut:0"]').getBoundingClientRect();return{left:b.left,right:b.right,top:b.top}})()`);
    const from = { x: g.left + 8, y: g.top - 14 }, to = { x: g.right - 8, y: g.top - 14 };
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none' });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
    for (let step = 1; step <= 10; step++) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + (to.x - from.x) * step / 10, y: from.y, button: 'left', buttons: 1 });
      await sleep(60);
    }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 });
    const until = Date.now() + 30_000;
    while (Date.now() < until && !(created = (await frameItems())[0])) await sleep(200);
  }
  if (!created) throw new Error('empty frame was not written to edit.json');
  await exec('akari.timeline.setTool', { tool: 'select' });
  const FRAME = created.id;
  results.observations.frame = FRAME;
  await waitEval(cdp, `(document.querySelector('[data-akari-ui="inspector-selection-header"]')?.textContent??'').includes('frame-')`, 'frame selected', 30_000)
    .catch(() => clickUntil(cdp, `[data-akari-ui="panel:timeline"] [data-akari-item-id="${FRAME}"]`,
      `(document.querySelector('[data-akari-ui="inspector-selection-header"]')?.textContent??'').length>0`, 'select frame'));

  await stage('open the still panel');
  const tabActive = `(()=>{const t=document.querySelector('[data-akari-ui="tab:inspector-edit"]');return !!t&&(t.classList.contains('is-active')||t.getAttribute('aria-selected')==='true')})()`;
  if (!await evalOn(cdp, `Boolean(document.querySelector('[data-akari-inspector-ai-create="true"]'))`)) {
    if (!await evalOn(cdp, tabActive)) await clickUntil(cdp, '[data-akari-ui="tab:inspector-edit"]', tabActive, 'edit tab');
    if (!await evalOn(cdp, `Boolean(document.querySelector('[data-akari-inspector-ai-create="true"]'))`)) {
      await waitEval(cdp, `Boolean(document.querySelector('[data-akari-inspector-ai-tile="still"]'))`, 'still tile', 60_000);
      await clickUntil(cdp, '[data-akari-inspector-ai-tile="still"]', `Boolean(document.querySelector('[data-akari-inspector-ai-create="true"]'))`, 'still panel');
    }
  }
  await settle(cdp);
  await waitEval(cdp, `[...document.querySelectorAll('[data-akari-inspector-ai-route-state]')].every(e=>e.getAttribute('data-akari-inspector-ai-route-state')!=='checking')`, 'route probe', 60_000).catch(() => undefined);
  results.observations.stillPanel = await evalOn(cdp, `(()=>{const root=document.querySelector('[data-akari-ui="panel:inspector"]');
    return{routes:[...root.querySelectorAll('[data-akari-inspector-ai-route]')].map(e=>({id:e.getAttribute('data-akari-inspector-ai-route'),
      text:e.textContent.replace(/\\s+/g,' ').trim(),checked:!!e.querySelector('input')?.checked,
      state:e.querySelector('[data-akari-inspector-ai-route-state]')?.getAttribute('data-akari-inspector-ai-route-state')??null})),
      radios:root.querySelectorAll('input[type="radio"]').length,
      imgs:[...root.querySelectorAll('[data-akari-inspector-ai-route] img')].length}})()`);
  await evalOn(cdp, `(()=>{document.querySelector('[data-akari-inspector-ai-route]')?.scrollIntoView({block:'center',behavior:'instant'});return true})()`);


  const keylessFal = await evalOn(cdp, `(()=>{const r=document.querySelector('[data-akari-inspector-ai-route="fal"]');
    return { state:r?.querySelector('[data-akari-inspector-ai-route-state]')?.getAttribute('data-akari-inspector-ai-route-state'),
      groups:[...document.querySelectorAll('[data-akari-inspector-ai-route-group]')].map(e=>e.textContent.trim().slice(0,70)),
      makerImages:document.querySelectorAll('[data-akari-inspector-ai-route] img').length,
      keyLink:!!document.querySelector('[data-akari-inspector-ai-fal-settings]') }})()`);
  results.observations.keylessFal = keylessFal;
  check('keyless route groups and logos', keylessFal.state === 'missing' && keylessFal.keyLink
    && keylessFal.groups.length === 2 && keylessFal.makerImages >= 4
    && results.observations.stillPanel.routes.find(row => row.id === 'fal')?.text.includes('キーが未設定'), keylessFal);
  await screenshot('01-route-groups-and-logos.png');
  await evalOn(cdp, `(()=>{document.querySelector('[data-akari-inspector-ai-route="fal"]')?.scrollIntoView({block:'center',behavior:'instant'});return true})()`);
  await screenshot('02-fal-without-key.png');
  check('keyless phase sends no fal requests', requests.length === 0, { requestCount: requests.length });
  await stopElectron();

  await stage('keyed Electron');
  await writeFile(path.join(ISO, 'akari-home', 'credentials.env'), 'FAL_KEY=stub-route-groups-fal-still\n', { mode: 0o600 });
  await startElectron(true);
  await openExistingFrame(FRAME);
  await clickUntil(cdp, '[data-akari-inspector-ai-route="fal"]',
    `document.querySelector('[data-akari-inspector-ai-route="fal"] input')?.checked===true`, 'select fal');
  await waitEval(cdp, `document.querySelector('[data-akari-inspector-ai-route="fal"] [data-akari-inspector-ai-route-state]')?.getAttribute('data-akari-inspector-ai-route-state')==='ready'`, 'fal ready');
  results.observations.keyedFal = { state: 'ready', credentialSource: 'isolated AKARI_HOME/credentials.env', dummyKey: true };
  await evalOn(cdp, `(()=>{const p=document.querySelector('[data-akari-inspector-ai-prompt]');p.value='A teal still frame';p.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  await clickUntil(cdp, '[data-akari-inspector-ai-create="true"]',
    `Boolean([...document.querySelectorAll('button')].find(e=>e.textContent?.includes('費用承認する')))`, 'approval dialog');
  check('approval precedes submit', requests.length === 0, { requestsBeforeApproval: requests.length });
  await screenshot('03-estimate-and-approval.png');
  await clickText('費用承認する');
  await waitEval(cdp, `Boolean(document.querySelector('[data-akari-inspector-ai-tile="still"]'))`, 'stub image generated', 120000);
  const editAfter = await readEdit();
  const generated = editAfter.sources.find(s => s.path?.includes('assets/generated/still-'));
  const frame = editAfter.tracks.flatMap(t => t.items ?? []).find(item => item.id === FRAME);
  check('generated image enters selected frame', !!generated && frame?.source?.src === generated.id,
    { sourceCreated: !!generated, frameUsesSource: frame?.source?.src === generated?.id });
  const imageBytes = await readFile(path.join(PROJECT, generated.path));
  const expectedSha256 = createHash('sha256').update(image).digest('hex');
  const actualSha256 = createHash('sha256').update(imageBytes).digest('hex');
  check('generated image matches stub PNG', actualSha256 === expectedSha256,
    { expectedSha256, actualSha256, bytes: imageBytes.length });
  const metaPath = path.join(PROJECT, `${generated.path}.meta.json`);
  const meta = JSON.parse(await readFile(metaPath, 'utf8'));
  const canonical = await run(process.execPath, [path.join(REPO, 'packages/schemas/bin/validate-generation-meta.mjs'), metaPath]);
  check('canonical generation meta validation', canonical.code === 0,
    { exitCode: canonical.code, output: clean(canonical.out.trim()).slice(0, 240) });
  const metaMeasured = { modelId: meta.model?.id, modelAsOf: meta.model?.as_of,
    provider: meta.job?.provider, cost: meta.cost,
    keySource: meta.provenance?.key_source, resultSha256: meta.result?.sha256 };
  check('fal generation meta fields', metaMeasured.modelId === 'fal:gpt-image-2.5-flare'
    && metaMeasured.modelAsOf === '2026-09-26' && metaMeasured.provider === 'fal'
    && metaMeasured.cost?.estimate_usd === 0.0528 && metaMeasured.cost?.unit === 'usd_per_image'
    && metaMeasured.cost?.source === 'estimate' && metaMeasured.keySource === 'file:credentials.env'
    && !String(metaMeasured.keySource).includes('stub-route-groups-fal-still')
    && metaMeasured.resultSha256 === actualSha256, metaMeasured);
  results.observations.generated = { ...metaMeasured, imageInFrame: true, expectedSha256, actualSha256 };
  await screenshot('04-stub-image-in-frame.png');
  const submitted = requests.filter(r => r.method === 'POST').length;
  check('one approved fal submit with dummy authorization', submitted === 1
    && requests.find(r => r.method === 'POST')?.authorizedWithDummyKey === true,
  { submitCount: submitted, submitAuthorizationWasDummy: requests.find(r => r.method === 'POST')?.authorizedWithDummyKey === true });

  await stage('deny a second paid request');
  await openExistingFrame(FRAME);
  await evalOn(cdp, `(()=>{const p=document.querySelector('[data-akari-inspector-ai-prompt]');p.value='A second teal still';p.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  await clickUntil(cdp, '[data-akari-inspector-ai-create="true"]',
    `Boolean([...document.querySelectorAll('button')].find(e=>e.textContent?.includes('費用承認する')))`, 'second approval');
  await screenshot('05-deny-approval.png');
  await clickText('キャンセル');
  await sleep(3000);
  const postsAfterDeny = requests.filter(r => r.method === 'POST').length;
  check('denied approval sends no submit after 3 seconds', postsAfterDeny === submitted,
    { waitMs: 3000, postsBeforeDeny: submitted, postsAfterDeny });
  results.observations.deniedSubmitCount = postsAfterDeny - submitted;
  await clickUntil(cdp, '[data-akari-inspector-ai-details] summary',
    `document.querySelector('[data-akari-inspector-ai-details]')?.open===true`, 'fal details');
  await screenshot('06-fal-details.png');

  await stage('settings connections');
  await evalOn(cdp, `(()=>{const c=window.theia.container,d=c._bindingDictionary;
    const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');
    void c.get(C).executeCommand('akari.settings.open','connections');return true})()`);
  await waitEval(cdp, `Boolean(document.querySelector('[data-akari-settings-section="connections"]:not([hidden])'))`, 'settings connections', 60000);
  await waitEval(cdp, `document.querySelectorAll('[data-akari-subscription]').length===3`, 'subscriptions');
  await waitEval(cdp, `[...document.querySelectorAll('[data-akari-subscription]')].every(e=>!e.textContent.includes('確かめています'))`, 'subscription states', 60000);
  const connections = await evalOn(cdp, `(()=>{const s=document.querySelector('[data-akari-settings-section="connections"]');return {
    subscriptions:s.querySelectorAll('[data-akari-subscription]').length,
    fal:!!s.querySelector('[data-akari-provider="fal"]'),
    logoImages:s.querySelectorAll('img').length,
    groups:s.textContent.includes('追加料金なし')&&s.textContent.includes('使った分だけ') }})()`);
  results.observations.connections = connections;
  check('settings connections have both groups and fal', connections.groups && connections.fal
    && connections.subscriptions === 3 && connections.logoImages >= 4, connections);
  await screenshot('07-settings-connections.png');
  await evalOn(cdp, `(()=>{document.querySelector('[data-akari-provider="fal"]')?.scrollIntoView({block:'center',behavior:'instant'});return true})()`);
  await screenshot('08-settings-api-key.png');

  await stage('settings AI models');
  await clickUntil(cdp, '[data-settings-nav="ai-models"]',
    `Boolean(document.querySelector('[data-ai-models-view]'))`, 'AI models');
  await waitEval(cdp, `Boolean(document.querySelector('[data-ai-model-card="codex:image"]'))`, 'ChatGPT card', 60000);
  await evalOn(cdp, `(()=>{document.querySelector('[data-ai-model-card="codex:image"]')?.scrollIntoView({block:'center',behavior:'instant'});return true})()`);
  await settle(cdp);
  const openaiCard = await evalOn(cdp, `(()=>{const c=document.querySelector('[data-ai-model-card="codex:image"]');return {
    id:c?.getAttribute('data-ai-model-card'),name:c?.querySelector('h4')?.textContent?.trim(),
    logoIsDataUri:c?.querySelector('.akari-ai-maker-icon img')?.src?.startsWith('data:image/')===true,
    maker:c?.querySelector('.akari-ai-maker')?.textContent?.trim()}})()`);
  const openaiShot = path.join(ISO, 'ai-models-openai.png');
  await writeFile(openaiShot, Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await clickUntil(cdp, '[data-ai-model-kind="voice"]',
    `Boolean(document.querySelector('[data-ai-model-card="tts:fal-qwen3"]'))`, 'Qwen voice card');
  await evalOn(cdp, `(()=>{document.querySelector('[data-ai-model-card="tts:fal-qwen3"]')?.scrollIntoView({block:'center',behavior:'instant'});return true})()`);
  await settle(cdp);
  const qwenCard = await evalOn(cdp, `(()=>{const c=document.querySelector('[data-ai-model-card="tts:fal-qwen3"]');const icon=c?.querySelector('.akari-ai-maker-icon');return {
    id:c?.getAttribute('data-ai-model-card'),name:c?.querySelector('h4')?.textContent?.trim(),
    initials:icon?.textContent?.trim(),hasLogo:!!icon?.querySelector('img'),maker:c?.querySelector('.akari-ai-maker')?.textContent?.trim()}})()`);
  const qwenShot = path.join(ISO, 'ai-models-qwen.png');
  await writeFile(qwenShot, Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  const modelCards = { openai: openaiCard, qwen: qwenCard, captureKinds: ['image', 'voice'] };
  results.observations.aiModels = modelCards;
  check('AI Models shows ChatGPT logo and Qwen initials', openaiCard.name === 'ChatGPT'
    && openaiCard.logoIsDataUri && qwenCard.initials === 'Q' && !qwenCard.hasLogo, modelCards);
  const composite = path.join(ROOT, '09-ai-models-logo-and-fallback.png');
  await mustRun('magick', ['(', openaiShot, '-crop', '1600x1100+400+80', '+repage', ')',
    '(', qwenShot, '-crop', '1600x1100+400+80', '+repage', ')', '-append', '-resize', '1100x',
    '-strip', '-colors', '96', `PNG8:${composite}`]);
  if ((await stat(composite)).size > 500000) {
    const resized = path.join(ISO, 'ai-models-small.png');
    await mustRun('sips', ['-Z', '1000', '--out', resized, composite]);
    await rename(resized, composite);
  }
  const compositeBytes = (await stat(composite)).size;
  results.screenshots.push({ name: path.basename(composite), bytes: compositeBytes,
    note: 'AI モデルの静止画・声の実機画面を縦に連結' });
  check('AI Models composite screenshot recorded', compositeBytes > 0 && compositeBytes <= 500000,
    { name: path.basename(composite), bytes: compositeBytes });

  results.observations.stubRequests = requests;
  results.observations.falNetwork.outsideFalHosts = requests.filter(r => !['/status/1','/response/1','/image.png'].includes(r.path)
    && !r.path.includes('/openai/gpt-image-2.5/flare/')).map(r => r.path);
  check('fal traffic stays on local stub', results.observations.falNetwork.outsideFalHosts.length === 0,
    { stubRequests: requests.length, outsideFalHosts: results.observations.falNetwork.outsideFalHosts });
  check('all recorded checks passed', results.checks.every(row => row.pass), { count: results.checks.length });
  results.status = 'pass';
} catch (error) {
  results.status = 'fail'; results.error = clean(error?.stack ?? error);
  console.error(error); process.exitCode = 1;
  if (cdp) await shot(cdp, 'zz-after-failure.png').catch(() => undefined);
} finally {
  await save(); await stopElectron();
  if (server) await new Promise(resolve => server.close(resolve));
  if (!process.argv.includes('--keep-tmp')) await rm(ISO, { recursive: true, force: true }).catch(() => undefined);
}
