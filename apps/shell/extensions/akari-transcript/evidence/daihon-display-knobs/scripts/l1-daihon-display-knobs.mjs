#!/usr/bin/env node
// L1（CDP・4 手順）: 文字数 18→12、行数 2、fold、手動／固定とカスタム 7 拒否。
// Electron は detached にせず、隔離 HOME / user-data-dir を runs/ 配下へ向ける。
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick, screenshot } from './cdp-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL_DIR = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(REPO, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const PROJECT = path.join(ROOT, 'fixture', 'project');
const CAPTIONS = path.join(PROJECT, 'captions.json');
const EDIT = path.join(PROJECT, 'edit.json');
const RESULTS = path.join(ROOT, 'results.json');
const PORT = Number(process.argv.find(value => value.startsWith('--port='))?.slice(7) ?? 22163);
const ISO = path.join(ROOT, 'runs', 'l1');
const LOG = path.join(ROOT, 'runs', 'l1.log');
const require = createRequire(import.meta.url);
const { splitTopLevelElements } = require(path.join(REPO, 'packages/edit-store/lib/edit-store.js'));
const S = value => JSON.stringify(value);
const out = { status: 'running', steps: [], screenshots: [], cleanup: null };

const sanitizeText = value => {
  let text = String(value);
  text = text.replaceAll(REPO, '<WORKTREE>');
  if (process.env.HOME) text = text.replaceAll(process.env.HOME, '<HOME>');
  return text
    .replace(/\/(?:private\/)?(?:tmp|var\/folders)\/[^\s)'"\]]+/gu, '<TMP>')
    .replace(/\/Users\/[^\s)'"\]]+/gu, '<HOME>');
};
const sanitize = value => sanitizeText(value?.stack || value?.message || value);
const save = async () => {
  const temporary = `${RESULTS}.tmp-${process.pid}`;
  await writeFile(temporary, `${sanitizeText(JSON.stringify(out, null, 2))}\n`);
  await rename(temporary, RESULTS);
};
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const run = (command, args, { cwd = ROOT, timeoutMs = 120_000 } = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', closed = false;
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const timer = setTimeout(() => { if (!closed) child.kill('SIGKILL'); }, timeoutMs);
  child.once('error', reject);
  child.once('close', code => {
    closed = true; clearTimeout(timer);
    code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} failed (${code}): ${stderr.slice(-1600)}`));
  });
});

async function step(name, operation) {
  const record = { name, pass: false };
  out.steps.push(record);
  try {
    record.detail = await operation();
    record.pass = true;
    await save();
    return record.detail;
  } catch (error) {
    record.error = sanitize(error);
    await save();
    throw error;
  }
}

async function waitEval(cdp, expression, { timeoutMs = 60_000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try { const value = await evalOn(cdp, expression); if (value) return value; }
    catch (error) { last = error; }
    await sleep(180);
  }
  throw new Error(`${label} not reached${last ? `: ${sanitize(last)}` : ''}`);
}

async function waitFile(predicate, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const source = await readFile(CAPTIONS, 'utf8');
    if (predicate(source)) return source;
    await sleep(150);
  }
  throw new Error(`${label} not reached`);
}

async function settlePreloadOverlay(cdp) {
  const deadline = Date.now() + 120_000;
  let hiddenSince = null;
  while (Date.now() < deadline) {
    const state = await evalOn(cdp, `(()=>{const el=document.querySelector('.theia-preload');return{exists:Boolean(el),hidden:Boolean(el?.classList.contains('theia-hidden'))}})()`);
    if (!state.exists) return 'removed';
    if (state.hidden) {
      hiddenSince ??= Date.now();
      if (Date.now() - hiddenSince >= 15_000) {
        const neutralized = await evalOn(cdp, `(()=>{const el=document.querySelector('.theia-preload');if(!el||!el.classList.contains('theia-hidden'))return false;el.style.pointerEvents='none';return true})()`);
        if (neutralized) return 'neutralized';
      }
    } else hiddenSince = null;
    await sleep(200);
  }
  throw new Error('theia preload overlay did not settle');
}

const command = id => `(async()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');if(!C)throw new Error('CommandService binding unavailable');const r=await window.theia.container.get(C).executeCommand(${S(id)});return r!==null&&typeof r==='object'?'[object]':r??null})()`;
const commandWith = (id, request) => `(async()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');if(!C)throw new Error('CommandService binding unavailable');const r=await window.theia.container.get(C).executeCommand(${S(id)},${S(request)});return r!==null&&typeof r==='object'?'[object]':r??null})()`;

function rawRecords(source) {
  const match = /"captions"\s*:\s*\[/u.exec(source);
  if (!match) throw new Error('captions[] が見つからない');
  const open = match.index + match[0].lastIndexOf('[');
  let depth = 0, inString = false, escaped = false, close = -1;
  for (let index = open; index < source.length; index++) {
    const char = source[index];
    if (inString) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') inString = false; continue; }
    if (char === '"') inString = true;
    else if (char === '[') depth++;
    else if (char === ']' && --depth === 0) { close = index; break; }
  }
  if (close < 0) throw new Error('captions[] が閉じていない');
  return new Map(splitTopLevelElements(source.slice(open + 1, close)).map(element => [
    JSON.parse(element.text).id, element.text
  ]));
}

function rawProperty(record, property) {
  const open = record.indexOf('{');
  const close = record.lastIndexOf('}');
  return splitTopLevelElements(record.slice(open + 1, close))
    .find(element => element.text.trimStart().startsWith(`"${property}"`))?.text;
}

async function rect(cdp, selector) {
  await ensureDaihonVisible(cdp);
  return waitEval(cdp, `(()=>{const e=document.querySelector(${S(selector)});if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return r.width>0&&r.height>0?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`, { label: `${selector} visible`, timeoutMs: 60_000 });
}

async function clickSelector(cdp, selector) {
  const point = await rect(cdp, selector);
  await realClick(cdp, point.x, point.y);
  await sleep(120);
}

async function clickByText(cdp, containerSelector, label) {
  const expression = `(()=>{const c=document.querySelector(${S(containerSelector)});if(!c)return null;const buttons=[...c.querySelectorAll('button')];const b=buttons.find(node=>node.textContent.trim()===${S(label)}&&!node.disabled)||buttons.find(node=>node.textContent.includes(${S(label)})&&!node.disabled);if(!b)return null;b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return r.width>0&&r.height>0?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`;
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await ensureDaihonVisible(cdp);
      const point = await waitEval(cdp, expression, { label: `${containerSelector} button "${label}"`, timeoutMs: 6_000 });
      await realClick(cdp, point.x, point.y);
      const observed = label === '…'
        ? `(()=>{const input=document.querySelector('.akari-daihon-customlines');return Boolean(input&&!input.hidden)})()`
        : `(()=>{const buttons=[...document.querySelectorAll(${S(`${containerSelector} button`)})];const button=buttons.find(node=>node.textContent.trim()===${S(label)});return Boolean(button?.classList.contains('selected'))})()`;
      await waitEval(cdp, observed, { label: `${label} click reflected`, timeoutMs: 6_000 });
      return;
    } catch (error) {
      last = error;
      if (attempt < 3 && containerSelector.includes('akari-daihon-pop')) {
        await evalOn(cdp, `document.body.querySelectorAll('.akari-daihon-pop').forEach(node=>node.remove())`).catch(() => {});
        await openDisplay(cdp);
      }
    }
  }
  throw new Error(`${containerSelector} button "${label}" click failed after 3 attempts: ${sanitize(last)}`);
}

async function openDisplay(cdp) {
  let last;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await ensureDaihonVisible(cdp);
      await clickSelector(cdp, '.akari-daihon-display');
      await waitEval(cdp, `Boolean(document.querySelector('.akari-daihon-pop input[type="range"]'))`, {
        label: `表示ポップ attempt ${attempt}`, timeoutMs: 6_000
      });
      return;
    } catch (error) {
      last = error;
      await evalOn(cdp, `document.body.querySelectorAll('.akari-daihon-pop').forEach(node=>node.remove())`).catch(() => {});
      if (attempt < 5) await sleep(300);
    }
  }
  throw new Error(`表示ポップ not reached after 5 attempts: ${sanitize(last)}`);
}

async function ensureDaihonVisible(cdp) {
  const probe = `(()=>{const e=document.querySelector('.akari-daihon-row[data-caption-id="c-0001"]');if(!e)return null;const r=e.getBoundingClientRect();return r.width>0&&r.height>0?{width:r.width,height:r.height}:null})()`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const visible = await evalOn(cdp, probe).catch(() => null);
    if (visible) return visible;
    await evalOn(cdp, command('akari.daihon.open')).catch(() => {});
    await sleep(600);
  }
  throw new Error('台本パネルが見えない');
}

const PREVIEW_PROBE = `(()=>{
  const plate=document.getElementById('caption-plate');
  if(!plate||plate.matches(':empty'))return null;
  const lines=[...plate.querySelectorAll('.akari-caption__line')];
  const captions=(window.__akariPreview?.captions??[])
    .filter(cue=>(cue.sourceCueId??cue.source_cue_id??cue.id)==='c-0001'||String(cue.id??'').startsWith('c-0001'))
    .map(cue=>({
      id:cue.id??null,
      text:cue.text??null,
      display_lines:cue.display_lines??cue.displayLines??null,
      start:cue.start??null,
      end:cue.end??null
    }));
  return{
    captions,
    plate:{
      className:plate.className,
      innerHTML:plate.innerHTML.slice(0,400),
      lineCount:lines.length,
      lineTextContent:lines.map(line=>line.textContent),
      textContent:plate.textContent
    }
  };
})()`;

async function connectWebview(target) {
  const cdp = new CDP(target.webSocketDebuggerUrl);
  const contexts = [];
  cdp.on('Runtime.executionContextCreated', params => contexts.push(params.context));
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await sleep(700);
  const frameTree = await cdp.send('Page.getFrameTree');
  const topFrame = frameTree.frameTree.frame.id;
  const context = contexts.find(candidate => candidate.auxData?.frameId !== topFrame);
  if (!context) { cdp.close(); return null; }
  const captionCount = await evalOn(cdp, `window.__akariPreview?.captions?.length ?? -1`, context.id).catch(() => -1);
  return { cdp, context, captionCount };
}

async function observePreview(cdp, time = 1.0) {
  try {
    const editUri = pathToFileURL(EDIT).toString();
    await evalOn(cdp, commandWith('akari.preview.ensureVisible', { editUri }));
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      await evalOn(cdp, commandWith('akari.preview.seekOutput', { editUri, time })).catch(() => {});
      const targets = (await listTargets(PORT)).filter(item =>
        item.type === 'iframe' && /webview\/index\.html/u.test(String(item.url)) && item.webSocketDebuggerUrl);
      for (const target of targets) {
        const connection = await connectWebview(target).catch(() => null);
        if (!connection) continue;
        if (connection.captionCount <= 0) { connection.cdp.close(); continue; }
        try {
          const value = await evalOn(connection.cdp, PREVIEW_PROBE, connection.context.id);
          if (value) return { observed: true, time, captionCount: connection.captionCount, ...value };
        } catch {} finally { connection.cdp.close(); }
      }
      await sleep(400);
    }
    return { observed: false, reason: 'preview caption DOM was not observed' };
  } catch (error) {
    return { observed: false, reason: sanitize(error) };
  }
}

async function shot(cdp, number, label) {
  const name = `${String(number).padStart(2, '0')}-${label}.png`;
  await screenshot(cdp, path.join(ROOT, name));
  out.screenshots.push(name);
  await save();
}

let spawnedChild;
async function launch() {
  await rm(ISO, { recursive: true, force: true });
  await mkdir(ISO, { recursive: true });
  await mkdir(path.join(ROOT, 'runs'), { recursive: true });
  const akariHome = path.join(ISO, 'akari-home');
  await mkdir(akariHome, { recursive: true });
  await writeFile(LOG, '');
  const child = spawn(ELECTRON, [
    SHELL_DIR, PROJECT, `--remote-debugging-port=${PORT}`, `--user-data-dir=${ISO}`, '--no-sandbox'
  ], {
    cwd: REPO,
    env: { ...process.env, AKARI_HOME: akariHome, THEIA_CONFIG_DIR: ISO },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  spawnedChild = child;
  const append = chunk => void writeFile(LOG, sanitizeText(chunk), { flag: 'a' }).catch(() => {});
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  let target;
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline && !target) {
    try { target = (await listTargets(PORT)).find(item => item.type === 'page'); } catch {}
    if (!target) await sleep(300);
  }
  assert(target, 'CDP page target did not appear');
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await waitEval(cdp, `Boolean(window.theia&&window.theia.container&&document.getElementById('theia-app-shell'))`, { label: 'Theia workbench', timeoutMs: 150_000 });
  return { child, cdp };
}

async function stop(session) {
  session?.cdp?.close();
  const pid = (session?.child ?? spawnedChild)?.pid;
  if (pid) {
    try { process.kill(pid, 'SIGTERM'); } catch {}
    await sleep(2500);
    try { process.kill(pid, 0); process.kill(pid, 'SIGKILL'); } catch {}
    await sleep(800);
  }
  const survivors = await new Promise(resolve => {
    const child = spawn('/bin/sh', ['-c', `ps -eo pid,ppid,args | grep -F ${JSON.stringify(ISO)} | grep -v grep | wc -l`]);
    let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.once('close', () => resolve(Number(stdout.trim())));
  });
  try {
    const log = await readFile(LOG, 'utf8');
    await writeFile(LOG, sanitizeText(log));
  } catch {}
  out.cleanup = { killedPid: pid ?? null, survivingProcesses: survivors };
  await save();
  return survivors;
}

let session;
try {
  out.fixture = JSON.parse((await run(process.execPath, [path.join(ROOT, 'scripts', 'gen-fixture.mjs')], { timeoutMs: 180_000 })).stdout.trim());
  const initialSource = await readFile(CAPTIONS, 'utf8');
  const initialManualBytes = rawProperty(rawRecords(initialSource).get('c-0005'), 'display_fragments');
  assert(initialManualBytes, 'c-0005 の display_fragments bytes が見つからない');
  await save();

  session = await launch();
  const { cdp } = session;
  await evalOn(cdp, command('akari.daihon.open'));
  await waitEval(cdp, `document.querySelectorAll('.akari-daihon-row').length===5`, { label: '5 rows' });
  out.preloadOverlay = await settlePreloadOverlay(cdp);
  out.daihonVisible = await ensureDaihonVisible(cdp);

  const slider = await step('1. 18字 → 12字で自動の／が増え、max_line_units=12 を書く', async () => {
    const label = await evalOn(cdp, `document.querySelector('.akari-daihon-display')?.textContent`);
    assert(label === '⚙ 表示 18字 · 1行', `初期ラベルが ${label}`);
    const before = await evalOn(cdp, `({total:document.querySelectorAll('.akari-daihon-slash').length,auto:document.querySelectorAll('.akari-daihon-slash.auto').length,manual:document.querySelectorAll('.akari-daihon-slash.manual').length})`);
    await openDisplay(cdp);
    await evalOn(cdp, `(()=>{const input=document.querySelector('.akari-daihon-pop input[type="range"]');input.value='12';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));return input.value})()`);
    const written = await waitFile(source => JSON.parse(source).display_policy.max_line_units === 12, 'max_line_units=12');
    const after = await waitEval(cdp, `(()=>{const value={total:document.querySelectorAll('.akari-daihon-slash').length,auto:document.querySelectorAll('.akari-daihon-slash.auto').length,manual:document.querySelectorAll('.akari-daihon-slash.manual').length};return value.total>${before.total}?value:null})()`, { label: '／ count increased' });
    assert(after.auto > before.auto, `自動の／が増えていない: ${JSON.stringify({ before, after })}`);
    return { buttonLabel: label, before, after, maxLineUnits: JSON.parse(written).display_policy.max_line_units };
  });
  await shot(cdp, 1, 'max-line-units-12');

  await step('2. 行数 2 を書き、multi のプレビュー DOM を観測する', async () => {
    await ensureDaihonVisible(cdp);
    await openDisplay(cdp);
    await clickByText(cdp, '.akari-daihon-pop', '2');
    const written = await waitFile(source => JSON.parse(source).display_policy.lines === 2, 'lines=2');
    await sleep(600);
    const preview = await observePreview(cdp);
    await ensureDaihonVisible(cdp);
    return { lines: JSON.parse(written).display_policy.lines, wrap: JSON.parse(written).display_policy.wrap, preview };
  });
  await shot(cdp, 2, 'lines-2-multi');

  await step('3. fold を書き、1 断片を N 行に折るプレビュー DOM を観測する', async () => {
    await ensureDaihonVisible(cdp);
    await openDisplay(cdp);
    await clickByText(cdp, '.akari-daihon-pop', '1 断片を N 行に折る');
    const written = await waitFile(source => JSON.parse(source).display_policy.wrap === 'fold', 'wrap=fold');
    await sleep(600);
    const preview = await observePreview(cdp);
    await ensureDaihonVisible(cdp);
    return { lines: JSON.parse(written).display_policy.lines, wrap: JSON.parse(written).display_policy.wrap, preview };
  });
  await shot(cdp, 3, 'wrap-fold');

  await step('4. 手動／固定・種別・display_fragments bytes・カスタム 7 拒否', async () => {
    const decoration = await evalOn(cdp, `(()=>{const row=document.querySelector('.akari-daihon-row[data-caption-id="c-0005"]');return{lock:row?.querySelector('.akari-daihon-badge-breaklock')?.textContent??null,manual:row?.querySelectorAll('.akari-daihon-slash.manual').length??0,currentAuto:document.querySelectorAll('.akari-daihon-slash.auto').length}})()`);
    assert(decoration.lock === '🔒 改行を手で固定', `固定チップが ${decoration.lock}`);
    assert(decoration.manual > 0, 'c-0005 に manual の／が無い');
    assert(slider.after.auto > 0, '手順 1 で auto の／を観測できていない');
    await openDisplay(cdp);
    await clickByText(cdp, '.akari-daihon-pop', '…');
    await evalOn(cdp, `(()=>{const input=document.querySelector('.akari-daihon-customlines');input.value='7';input.dispatchEvent(new Event('change',{bubbles:true}));return input.value})()`);
    const notice = await waitEval(cdp, `(()=>{const text=document.querySelector('.akari-daihon-footer')?.textContent??'';return text.includes('4〜6')?text:null})()`, { label: 'custom lines rejection' });
    const finalSource = await readFile(CAPTIONS, 'utf8');
    const finalRoot = JSON.parse(finalSource);
    const finalManualBytes = rawProperty(rawRecords(finalSource).get('c-0005'), 'display_fragments');
    assert(finalRoot.display_policy.lines <= 6, `lines が ${finalRoot.display_policy.lines}`);
    assert(finalManualBytes === initialManualBytes, 'c-0005 の display_fragments bytes が変わった');
    return {
      decoration,
      automaticObservedAfterSlider: slider.after.auto,
      customAttempt: 7,
      linesAfterRejection: finalRoot.display_policy.lines,
      notice,
      manualFragmentsByteIdentical: finalManualBytes === initialManualBytes
    };
  });
  await shot(cdp, 4, 'manual-lock-and-custom-rejection');

  out.status = 'pass';
  await save();
} catch (error) {
  out.status = 'fail';
  out.error = sanitize(error);
  try {
    if (session?.cdp) {
      const name = '99-failure.png';
      await screenshot(session.cdp, path.join(ROOT, name));
      if (!out.screenshots.includes(name)) out.screenshots.push(name);
    }
  } catch {}
  await save();
  process.exitCode = 1;
} finally {
  const survivors = await stop(session);
  if (survivors !== 0) {
    out.status = out.status === 'pass' ? 'fail' : out.status;
    out.cleanupError = `surviving processes: ${survivors}`;
    await save();
    process.exitCode = 1;
  }
}
