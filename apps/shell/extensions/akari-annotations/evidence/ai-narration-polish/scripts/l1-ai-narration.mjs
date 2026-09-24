#!/usr/bin/env node
// Run after building the shell: node apps/shell/extensions/akari-annotations/evidence/ai-narration-polish/scripts/l1-ai-narration.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick } from './cdp-lib.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repo = path.resolve(root, '../../../../../../');
const shell = path.join(repo, 'apps/shell');
const electronFile = path.join(shell, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const temp = await mkdtemp(path.join(os.tmpdir(), 'akari-ai-narration-polish-l1-'));
const project = path.join(temp, 'project');
const controlFile = path.join(temp, 'control.json');
const callsFile = path.join(temp, 'calls.jsonl');
const fakeCli = path.join(root, 'scripts/fake-akari-cli.mjs');
const tempRoots = new Set([temp, os.tmpdir(), await realpath(os.tmpdir()), repo, os.homedir()]);
for (const name of [...tempRoots]) {
  if (name.startsWith('/private/var/')) tempRoots.add(name.slice(8));
  if (name.startsWith('/var/')) tempRoots.add(`/private${name}`);
}
const redactions = [...tempRoots].sort((a, b) => b.length - a.length);
const result = { status: 'running', checks: [], clicks: [], screenshots: [],
  measurements: { labelTextIntersect: null, buttons: [] }, fakeCli: {} };
const S = JSON.stringify;
const save = async () => {
  const target = path.join(root, 'results.json'); const staging = `${target}.tmp-${process.pid}`;
  let body = JSON.stringify(result, null, 2);
  for (const name of redactions) body = body.replaceAll(name, '<TEMP>');
  await writeFile(staging, `${body}\n`); await rename(staging, target);
};
const check = (name, passed, measured) => {
  result.checks.push({ name, passed: !!passed, measured });
  if (!passed) throw new Error(`${name}: ${JSON.stringify(measured)}`);
};
const port = await new Promise((resolve, reject) => {
  const server = createServer(); server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { const address = server.address(); server.close(() => resolve(address.port)); });
});
async function waitEval(cdp, expression, name, ms = 90_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const value = await evalOn(cdp, expression, undefined, Math.min(60_000, until - Date.now())).catch(() => null);
    if (value) return value;
    await sleep(160);
  }
  throw new Error(`timed out: ${name}`);
}
async function waitFile(predicate, name, ms = 90_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const edit = JSON.parse(await readFile(path.join(project, 'edit.json'), 'utf8'));
    if (predicate(edit)) return edit;
    await sleep(160);
  }
  throw new Error(`timed out: ${name}`);
}
const command = id => `(async()=>{const d=window.theia.container._bindingDictionary;
  const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');
  await window.theia.container.get(C).executeCommand(${S(id)});return true})()`;
async function dismiss(cdp) {
  await evalOn(cdp, command('notifications.commands.clearAll')).catch(() => null);
  await waitEval(cdp, `document.querySelectorAll('.theia-notification-list-item').length===0`, 'notifications clear', 5000).catch(() => null);
  const updateToast = await evalOn(cdp, `(()=>{const close=document.querySelector('.akari-update-close');
    if(!close)return false;close.click();return true})()`);
  if (updateToast) await waitEval(cdp, `(()=>{const close=document.querySelector('.akari-update-close');
    if(!close)return true;const style=getComputedStyle(close);
    return style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0
      ||close.getClientRects().length===0})()`, 'update toast closed', 5000);
}
async function settle(cdp) {
  return evalOn(cdp, `new Promise(resolve=>{const roots=['[data-akari-ui="panel:inspector"]','[data-akari-ui="panel:timeline"]']
    .map(s=>document.querySelector(s)).filter(Boolean);if(!roots.length){resolve(true);return}
    let quiet,limit;const observers=roots.map(root=>{const observer=new MutationObserver(reset);
    observer.observe(root,{subtree:true,childList:true,attributes:true,characterData:true});return observer});
    function done(){clearTimeout(quiet);clearTimeout(limit);observers.forEach(o=>o.disconnect());resolve(true)}
    function reset(){clearTimeout(quiet);quiet=setTimeout(done,500)}limit=setTimeout(done,90000);reset()})`, undefined, 100_000);
}
async function clickUntil(cdp, selector, expected, name) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await settle(cdp); await dismiss(cdp);
    try {
      const point = await waitEval(cdp, `(async()=>{const e=document.querySelector(${S(selector)});if(!e)return null;
        e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
        const hit=document.elementFromPoint(x,y);return r.width&&r.height&&hit&&(hit===e||e.contains(hit))?{x,y}:null})()`, `${name} point`, 5000);
      await realClick(cdp, point.x, point.y);
      await waitEval(cdp, expected, name, 5000);
      result.clicks.push({ name, attempt, passed: true }); return;
    } catch (error) {
      result.clicks.push({ name, attempt, passed: false, error: String(error) });
      if (attempt === 3) throw error;
    }
  }
}
async function clickTextUntil(cdp, selector, textValue, expected, name) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await settle(cdp); await dismiss(cdp);
    try {
      const point = await waitEval(cdp, `(async()=>{const e=[...document.querySelectorAll(${S(selector)})]
        .find(row=>row.textContent.includes(${S(textValue)}));if(!e)return null;
        e.scrollIntoView({block:'center',behavior:'instant'});
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
        const hit=document.elementFromPoint(x,y);return hit&&(hit===e||e.contains(hit))?{x,y}:null})()`, `${name} point`, 5000);
      await realClick(cdp, point.x, point.y);
      await waitEval(cdp, expected, name, 5000);
      result.clicks.push({ name, attempt, passed: true }); return;
    } catch (error) {
      result.clicks.push({ name, attempt, passed: false, error: String(error) });
      if (attempt === 3) throw error;
    }
  }
}
async function shot(cdp, name) {
  await settle(cdp); await dismiss(cdp);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const bytes = Buffer.from(data, 'base64');
  await writeFile(path.join(root, name), bytes);
  result.screenshots.push({ name, bytes: bytes.length }); await save();
}
const item = id => `[data-akari-item-kind="audio"][data-akari-item-id="${id}"]`;
const tab = '[data-akari-ui="tab:inspector-generation"]';
const tile = '[data-akari-inspector-ai-tile="narration"]';
const panel = '.akari-inspector-ai-narration-panel';
async function select(cdp, id) {
  await clickUntil(cdp, item(id), `Boolean(document.querySelector(${S(item(id))})?.classList.contains('akari-annotations-selected'))`, `select ${id}`);
  if (!await evalOn(cdp, `document.querySelector(${S(tab)})?.getAttribute('aria-selected')==='true'`))
    await clickUntil(cdp, tab, `document.querySelector(${S(tab)})?.getAttribute('aria-selected')==='true'`, 'AI tab');
}
async function typeScript(cdp, value) {
  await clickUntil(cdp, `${panel} textarea[aria-label="原稿"]`, `document.activeElement?.getAttribute('aria-label')==='原稿'`, 'script field');
  await cdp.send('Input.insertText', { text: value });
  await waitEval(cdp, `document.querySelector(${S(`${panel} textarea[aria-label="原稿"]`)})?.value===${S(value)}`, 'script typed', 5000);
}
function sourceFor(edit, id) {
  const row = edit.tracks.flatMap(track => track.items).find(entry => entry.id === id);
  return { row, source: edit.sources.find(entry => entry.id === row?.source?.src) };
}
async function measure(cdp) {
  const measurement = await evalOn(cdp, `(()=>{const cards=[...document.querySelectorAll('.akari-inspector-ai-narration-engine')];
    const overlaps=cards.map(card=>{const a=card.querySelector('.akari-inspector-ai-narration-engine-availability')?.getBoundingClientRect(),
      t=card.querySelector('.akari-inspector-ai-narration-engine-name')?.getBoundingClientRect();
      return !!a&&!!t&&a.left<t.right&&a.right>t.left&&a.top<t.bottom&&a.bottom>t.top});
    const buttons=[...document.querySelectorAll('.akari-inspector-ai-narration-button,.akari-inspector-ai-back,.akari-inspector-ai-tile')]
      .filter(e=>!e.disabled&&e.getAttribute('aria-disabled')!=='true').map(e=>{const s=getComputedStyle(e);
        return{name:e.textContent.trim(),background:s.backgroundColor,border:s.borderTopWidth}});
    return{overlaps,buttons}})()`);
  result.measurements.labelTextIntersect = measurement.overlaps.some(Boolean);
  result.measurements.buttons.push(...measurement.buttons);
  check('engine badges and names do not intersect', !result.measurements.labelTextIntersect, measurement.overlaps);
  check('enabled buttons have background or border', measurement.buttons.every(row =>
    row.background !== 'rgba(0, 0, 0, 0)' || row.border !== '0px'), measurement.buttons);
}
let electron, cdp;
try {
  await stat(electronFile);
  const fixture = spawn(process.execPath, [path.join(root, 'scripts/gen-fixture.mjs'), project],
    { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', error = ''; fixture.stdout.on('data', data => { out += data; });
  fixture.stderr.on('data', data => { error += data; });
  const code = await new Promise(resolve => fixture.once('close', resolve));
  if (code !== 0) throw new Error(`fixture: ${error}`);
  result.fixture = JSON.parse(out.trim());
  for (const name of ['akari-home', 'theia-config', 'user-data']) await mkdir(path.join(temp, name));
  await writeFile(controlFile, JSON.stringify({ mode: 'success', seconds: 3.5 })); await writeFile(callsFile, '');
  const env = { ...process.env, AKARI_HOME: path.join(temp, 'akari-home'),
    THEIA_CONFIG_DIR: path.join(temp, 'theia-config'), AKARI_GENERATE_CLI: fakeCli,
    AKARI_AI_NARRATION_CONTROL_FILE: controlFile, AKARI_AI_NARRATION_CALLS_FILE: callsFile };
  for (const name of ['FAL_KEY', 'FAL_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OPENAI_API_KEY',
    'GROQ_API_KEY', 'ELEVENLABS_API_KEY', 'XAI_API_KEY']) delete env[name];
  electron = spawn(electronFile, [shell, project, `--remote-debugging-port=${port}`,
    `--user-data-dir=${path.join(temp, 'user-data')}`, '--window-size=1600,1000', '--no-sandbox'],
  { cwd: repo, env, stdio: 'ignore' });
  const target = await (async () => { const until = Date.now() + 600_000; while (Date.now() < until) {
    const page = await listTargets(port).then(rows => rows.find(row => row.type === 'page')).catch(() => null);
    if (page) return page; await sleep(300);
  } throw new Error('Electron CDP page did not appear'); })();
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect(); await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await waitEval(cdp, `Boolean(window.theia?.container&&document.getElementById('theia-app-shell')&&(()=>{
    const preload=document.querySelector('.theia-preload');if(!preload)return true;
    const style=getComputedStyle(preload);return style.display==='none'||Number(style.opacity)===0})())`, 'Theia workbench', 180_000);
  if (!await evalOn(cdp, `Boolean(document.querySelector('[data-akari-ui="timeline:cut:0"]'))`))
    await evalOn(cdp, command('akari.annotations.open'));
  await waitEval(cdp, `Boolean(document.querySelector(${S(item('frame-a'))}))`, 'audio timeline');
  await evalOn(cdp, command('akari.inspector.open')).catch(() => null);
  await waitEval(cdp, `Boolean(document.querySelector('[data-akari-ui="panel:inspector"]'))`, 'inspector');
  await settle(cdp); await dismiss(cdp);
  const editPath = path.join(project, 'edit.json');
  const beforeText = await readFile(editPath, 'utf8');
  const before = JSON.parse(beforeText);
  await select(cdp, 'frame-b');
  await clickUntil(cdp, tile, `Boolean(document.querySelector(${S(panel)}))`, 'narration panel');
  await waitEval(cdp, `Boolean(document.querySelector('.akari-inspector-ai-narration-voice option'))`, 'VOICEVOX voice');
  await typeScript(cdp, 'これは長い声を作るための原稿です。後ろのクリップをずらします。');
  await waitEval(cdp, `!document.querySelector('.akari-inspector-ai-narration-placement-choice')?.hidden`, 'two choices');
  check('two choices shown before generation', await evalOn(cdp,
    `document.querySelectorAll('.akari-inspector-ai-narration-placement-radio').length===2`), true);
  await shot(cdp, '01-two-choices.png');
  await clickUntil(cdp, '.akari-inspector-ai-narration-placement-radio[value="shift"]',
    `document.querySelector('.akari-inspector-ai-narration-placement-radio[value="shift"]')?.checked===true`, 'choose shift');
  await clickUntil(cdp, `${panel} .akari-inspector-ai-narration-button`,
    `Boolean(document.querySelector('.akari-inspector-ai-narration-progress,.akari-inspector-ai-narration-placement'))`, 'generate shift');
  const shifted = await waitFile(edit => sourceFor(edit, 'frame-b').source?.path?.startsWith('out/narration/'), 'shifted narration', 90_000);
  const audioBefore = before.tracks.find(track => track.id === 'audio');
  const audioAfter = shifted.tracks.find(track => track.id === 'audio');
  const visualBefore = before.tracks.find(track => track.id === 'video');
  const visualAfter = shifted.tracks.find(track => track.id === 'video');
  check('same track voice and later clips shifted 45 frames',
    sourceFor(shifted, 'frame-b').row.duration === 105
      && audioAfter.items.find(row => row.id === 'following').at === audioBefore.items.find(row => row.id === 'following').at + 45
      && audioAfter.items.find(row => row.id === 'interview').at === audioBefore.items.find(row => row.id === 'interview').at + 45
      && JSON.stringify(visualAfter) === JSON.stringify(visualBefore),
    { frame: sourceFor(shifted, 'frame-b').row, followingAt: audioAfter.items.find(row => row.id === 'following').at,
      interviewAt: audioAfter.items.find(row => row.id === 'interview').at });
  await waitEval(cdp, `document.querySelector('.akari-inspector-ai-narration-placement')?.textContent.includes('ずらして')`, 'shift label');
  await shot(cdp, '02-shifted-track.png');
  await clickUntil(cdp, '.akari-annotations-widget button[aria-label="元に戻す"]',
    `Boolean(document.querySelector(${S(item('frame-b'))}))`, 'undo shift');
  await waitFile(edit => sourceFor(edit, 'frame-b').source?.path === 'assets/generated/frame-b.wav', 'undo restores frame');
  check('one undo restores exact edit.json bytes', await readFile(editPath, 'utf8') === beforeText, true);
  await shot(cdp, '03-one-undo.png');

  await writeFile(controlFile, JSON.stringify({ mode: 'slow', seconds: 3.5, delaySeconds: 8 }));
  await select(cdp, 'frame-a');
  await clickUntil(cdp, tile, `Boolean(document.querySelector(${S(panel)}))`, 'slow narration panel');
  await waitEval(cdp, `Boolean(document.querySelector('.akari-inspector-ai-narration-voice option'))`, 'slow voice');
  await typeScript(cdp, 'ゆっくり作る声です');
  await clickUntil(cdp, `${panel} .akari-inspector-ai-narration-button`,
    `Boolean(document.querySelector('.akari-inspector-ai-narration-progress'))`, 'start slow narration');
  const elapsed = await waitEval(cdp, `(()=>{const t=document.querySelector('.akari-inspector-ai-narration-progress')?.textContent;
    const n=Number(t?.match(/(\d+) 秒/)?.[1] ?? 0);return n>=1?n:null})()`, 'elapsed second', 90_000);
  result.measurements.elapsedSeconds = elapsed;
  check('progress elapsed at least one second', elapsed >= 1, elapsed);
  await shot(cdp, '04-elapsed-seconds.png');
  await clickUntil(cdp, `${panel} .akari-inspector-ai-narration-button:last-of-type`,
    `!document.querySelector('.akari-inspector-ai-narration-progress')`, 'cancel slow narration');
  await sleep(1200);
  check('cancel leaves edit.json unchanged', await readFile(editPath, 'utf8') === beforeText, true);
  await shot(cdp, '05-cancelled.png');

  await writeFile(controlFile, JSON.stringify({ mode: 'failure', seconds: 3.5 }));
  await clickUntil(cdp, `${panel} .akari-inspector-ai-narration-button`,
    `Boolean(document.querySelector('.akari-inspector-ai-narration-error'))`, 'failed narration');
  const failure = await waitEval(cdp, `(()=>{const error=document.querySelector('.akari-inspector-ai-narration-error')?.textContent;
    const retry=[...document.querySelectorAll('.akari-inspector-ai-narration-button')]
      .some(button=>button.textContent==='もう一度');return error&&retry?error:null})()`, 'failure and retry');
  check('failure reason and retry visible', !!failure, failure);
  check('failure leaves edit.json unchanged', await readFile(editPath, 'utf8') === beforeText, true);
  await shot(cdp, '06-failure-retry.png');

  await clickUntil(cdp, '.akari-inspector-ai-narration-engine-radio[value="fal-qwen3"]',
    `document.querySelector('.akari-inspector-ai-narration-engine-radio[value="fal-qwen3"]')?.checked===true`, 'choose own voice');
  await waitEval(cdp, `document.querySelector('.akari-inspector-ai-narration-voice option')?.textContent==='自声プロファイル'`, 'own voice profile');
  check('paid own voice label', await evalOn(cdp,
    `document.querySelector(${S(panel)})?.textContent.includes('自声')&&document.querySelector(${S(panel)})?.textContent.includes('$0.2 / 1000 字')`), true);
  await clickUntil(cdp, `${panel} .akari-inspector-ai-narration-button`,
    `Boolean(document.querySelector('.theia-dialog'))`, 'paid approval dialog');
  const approval = await waitEval(cdp, `(()=>{const text=document.querySelector('.theia-dialog')?.textContent;
    return text?.includes('費用承認')&&text?.includes('$')?text:null})()`, 'priced confirmation');
  result.measurements.approvalText = approval;
  check('priced confirmation is visible', !!approval, approval);
  await shot(cdp, '07-paid-confirmation.png');
  await clickTextUntil(cdp, '.theia-dialog button', 'キャンセル',
    `!document.querySelector('.theia-dialog')`, 'reject paid approval');
  const calls = (await readFile(callsFile, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  result.fakeCli = { engines: calls.filter(row => row.args?.[1] === 'engines').length,
    voices: calls.filter(row => row.args?.[1] === 'voices').length,
    generated: calls.filter(row => row.args?.[1] === 'generate').length,
    paidAttempts: calls.filter(row => row.paidAttempt).length };
  check('paid generation was never called', result.fakeCli.paidAttempts === 0
    && calls.filter(row => row.args?.[1] === 'generate' && row.args.includes('fal-qwen3')).length === 0,
  result.fakeCli);
  check('rejected approval leaves edit unchanged', await readFile(editPath, 'utf8') === beforeText, true);
  await shot(cdp, '08-paid-rejected.png');
  result.status = 'PASS';
} catch (error) {
  result.status = 'FAIL'; result.error = String(error);
  if (cdp) try { await shot(cdp, 'error-full.png'); } catch { /* retain primary error */ }
} finally {
  try {
    const calls = (await readFile(callsFile, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    result.fakeCli = { engines: calls.filter(row => row.args?.[1] === 'engines').length,
      voices: calls.filter(row => row.args?.[1] === 'voices').length,
      generated: calls.filter(row => row.args?.[1] === 'generate').length,
      paidAttempts: calls.filter(row => row.paidAttempt).length };
  } catch { /* A fixture failure may occur before the call log exists. */ }
  try { cdp?.close(); } catch { /* cleanup continues */ }
  if (electron?.pid) {
    result.killedPid = electron.pid;
    try { process.kill(electron.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') result.cleanupError = String(error); }
    const until = Date.now() + 10_000;
    while (electron.exitCode === null && electron.signalCode === null && Date.now() < until) await sleep(100);
    if (electron.exitCode === null && electron.signalCode === null) {
      try { process.kill(electron.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') result.cleanupError = String(error); }
    }
    result.electronExited = electron.exitCode !== null || electron.signalCode !== null;
  }
  try { await rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); }
  catch (error) { result.cleanupError = String(error); }
  try { await save(); } catch (error) { process.stderr.write(`${error}\n`); process.exitCode = 1; }
}
if (result.status !== 'PASS' || result.cleanupError) process.exitCode = 1;
