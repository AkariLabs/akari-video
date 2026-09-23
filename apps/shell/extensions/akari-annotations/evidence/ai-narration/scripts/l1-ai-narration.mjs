#!/usr/bin/env node
// Run after building the shell: node apps/shell/extensions/akari-annotations/evidence/ai-narration/scripts/l1-ai-narration.mjs
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
const temp = await mkdtemp(path.join(os.tmpdir(), 'akari-ai-narration-l1-'));
const project = path.join(temp, 'project');
const durationFile = path.join(temp, 'duration.txt');
const callsFile = path.join(temp, 'calls.jsonl');
const fakeCli = path.join(root, 'scripts/fake-akari-cli.mjs');
const tempRoots = new Set([temp, os.tmpdir(), await realpath(os.tmpdir())]);
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
async function waitFile(predicate, name, ms = 30_000) {
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
  await writeFile(durationFile, '1.5\n'); await writeFile(callsFile, '');
  const env = { ...process.env, AKARI_HOME: path.join(temp, 'akari-home'),
    THEIA_CONFIG_DIR: path.join(temp, 'theia-config'), AKARI_GENERATE_CLI: fakeCli,
    AKARI_AI_NARRATION_DURATION_FILE: durationFile, AKARI_AI_NARRATION_CALLS_FILE: callsFile };
  for (const name of ['FAL_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OPENAI_API_KEY',
    'GROQ_API_KEY', 'ELEVENLABS_API_KEY']) delete env[name];
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
  const beforeA = JSON.parse(await readFile(path.join(project, 'edit.json'), 'utf8'));
  await select(cdp, 'frame-a');
  const beforeClipText = await evalOn(cdp,
    `document.querySelector(${S(item('frame-a'))})?.textContent?.trim() ?? ''`);
  result.measurements.clipBefore = beforeClipText;
  check('empty frame label before generation', beforeClipText.includes('frame-a.wav'), beforeClipText);
  await clickUntil(cdp, tile, `Boolean(document.querySelector(${S(panel)}))`, 'narration panel');
  await waitEval(cdp, `document.querySelector('.akari-inspector-ai-narration-voice option')?.textContent==='四国めたん'`, 'VOICEVOX voices');
  check('VOICEVOX free panel', await evalOn(cdp,
    `document.querySelector(${S(panel)})?.textContent.includes('この Mac · 無料')`), true);
  await measure(cdp); await shot(cdp, '01-narration-panel.png');
  await typeScript(cdp, '最初の声です');
  const voiceAndButton = await waitEval(cdp, `(async()=>{const voice=document.querySelector(${S(`${panel} select[aria-label="声"]`)}),
    button=[...document.querySelectorAll(${S(`${panel} .akari-inspector-ai-narration-button`)})]
      .find(e=>e.textContent==='声を作る');if(!voice||!button)return null;
    button.scrollIntoView({block:'end',inline:'nearest',behavior:'instant'});
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const v=voice.getBoundingClientRect(),b=button.getBoundingClientRect();
    const visible=e=>{const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
      return r.top>=0&&r.bottom<=innerHeight&&hit&&(hit===e||e.contains(hit))};
    return visible(voice)&&visible(button)&&!button.disabled
      ? {voice:voice.value,button:button.textContent,voiceRect:{top:v.top,bottom:v.bottom},buttonRect:{top:b.top,bottom:b.bottom}}:null})()`,
  'voice and enabled generate button visible', 5000);
  check('voice and enabled generate button visible', voiceAndButton.voice === '1'
    && voiceAndButton.button === '声を作る', voiceAndButton);
  await measure(cdp);
  check('enabled generate button has measured background or border',
    result.measurements.buttons.some(row => row.name === '声を作る'
      && (row.background !== 'rgba(0, 0, 0, 0)' || row.border !== '0px')),
  result.measurements.buttons.filter(row => row.name === '声を作る'));
  await shot(cdp, '01b-narration-voice.png');
  await clickUntil(cdp, `${panel} .akari-inspector-ai-narration-button`,
    `Boolean(document.querySelector('.akari-inspector-ai-narration-progress,.akari-inspector-ai-narration-placement'))`, 'generate 1.5s');
  const afterA = await waitFile(edit => sourceFor(edit, 'frame-a').source?.path?.startsWith('out/narration/'), 'narration in frame');
  check('frame replaced with 1.5s wav', sourceFor(afterA, 'frame-a').row.duration === 45
    && sourceFor(afterA, 'frame-a').source.path.endsWith('.wav'), sourceFor(afterA, 'frame-a'));
  const afterClipText = await waitEval(cdp, `(()=>{const text=document.querySelector(${S(item('frame-a'))})?.textContent?.trim();
    return text && text!==${S(beforeClipText)} && text.includes('n-0001.wav') ? text : null})()`,
  'timeline clip changed', 5000);
  result.measurements.clipAfter = afterClipText;
  check('timeline clip label changes to generated wav', afterClipText !== beforeClipText
    && afterClipText.includes('n-0001.wav'), { before: beforeClipText, after: afterClipText });
  const returnedToTiles = await waitEval(cdp, `Boolean(document.querySelector(${S(tile)})
    && !document.querySelector(${S(panel)})
    && document.querySelector(${S(tile)})?.getAttribute('aria-disabled')==='true')`, 'AI tiles after placement', 5000);
  check('after placement AI returns to tiles with narration disabled', returnedToTiles, returnedToTiles);
  await shot(cdp, '02-frame-replaced.png');
  await clickUntil(cdp, '.akari-annotations-widget button[aria-label="元に戻す"]',
    `Boolean(document.querySelector(${S(item('frame-a'))}))`, 'undo');
  const undone = await waitFile(edit => sourceFor(edit, 'frame-a').source?.path === 'assets/generated/frame-a.wav', 'frame restored');
  check('one undo restores empty frame', JSON.stringify(undone) === JSON.stringify(beforeA),
    { source: sourceFor(undone, 'frame-a').source?.path, trackCount: undone.tracks.length });
  const undoAi = await waitEval(cdp, `Boolean(document.querySelector(${S(tile)})
    && document.querySelector(${S(tile)})?.getAttribute('aria-disabled')!=='true'
    && !document.querySelector('.akari-inspector-ai-narration-placement'))`, 'AI tile enabled after undo', 30_000);
  check('undo re-enables narration and removes placement line', undoAi, undoAi);
  await shot(cdp, '03-after-undo.png');
  await writeFile(durationFile, '3.5\n');
  await select(cdp, 'frame-b');
  await clickUntil(cdp, tile, `Boolean(document.querySelector(${S(panel)}))`, 'second narration panel');
  await waitEval(cdp, `Boolean(document.querySelector('.akari-inspector-ai-narration-voice option'))`, 'second voices');
  await typeScript(cdp, '長い声です');
  await clickUntil(cdp, `${panel} .akari-inspector-ai-narration-button`,
    `Boolean(document.querySelector('.akari-inspector-ai-narration-progress,.akari-inspector-ai-narration-placement'))`, 'generate 3.5s');
  const afterB = await waitFile(edit => edit.tracks.length === beforeA.tracks.length + 1
    && sourceFor(edit, 'frame-b').source?.path?.startsWith('out/narration/'), 'lower track');
  check('lower track and following clip unchanged', afterB.tracks[0].lane === 'audio'
    && afterB.tracks.find(track => track.id === 'audio').items.find(row => row.id === 'following').at === 195
    && sourceFor(afterB, 'frame-b').row.duration === 105, afterB.tracks.map(track => ({ id: track.id, items: track.items.map(row => [row.id, row.at]) })));
  const placementLine = await waitEval(cdp, `document.querySelector('.akari-inspector-ai-narration-placement')?.textContent`, 'placement line');
  result.measurements.placementLine = placementLine;
  check('A2 placement line states the 1.5s overflow', placementLine === 'A2 に置きました（枠より 1.5 秒長いため）', placementLine);
  await shot(cdp, '04-lower-track.png');
  await select(cdp, 'interview');
  await waitEval(cdp, `document.querySelector(${S(tile)})?.getAttribute('aria-disabled')==='true'`, 'disabled narration');
  check('filled audio disabled with reason', await evalOn(cdp,
    `document.querySelector(${S(tile)})?.textContent.includes('空いている音声の枠で使えます')`), true);
  await shot(cdp, '05-filled-audio-disabled.png');
  const calls = (await readFile(callsFile, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  result.fakeCli = { engines: calls.filter(row => row.args?.[1] === 'engines').length,
    voices: calls.filter(row => row.args?.[1] === 'voices').length,
    generated: calls.filter(row => row.args?.[1] === 'generate').length,
    paidAttempts: calls.filter(row => row.paidAttempt).length };
  check('fake generated twice; paid calls zero', result.fakeCli.generated === 2 && result.fakeCli.paidAttempts === 0, result.fakeCli);
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
