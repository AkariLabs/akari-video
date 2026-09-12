#!/usr/bin/env node
// L1（CDP・3 手順）: display_policy を持たない captions.json のプロジェクトで
//   1. 台本の語間 ⊕ →「／ ここで改行」→ 濃い（manual）／が 1 つ増え、display_fragments が書かれる
//   2. 前半の語の時刻で、プレビューが「前半」だけを描く（後半の文字を含まない）
//   3. 後半の語の時刻で、プレビューが「後半」だけを描く（前半の文字を含まない）
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
const PORT = Number(process.argv.find(value => value.startsWith('--port='))?.slice(7) ?? 22171);
const ISO = path.join(ROOT, 'runs', 'l1');
const LOG = path.join(ROOT, 'runs', 'l1.log');
const require = createRequire(import.meta.url);
const { captionFragmentWindows } = require(path.join(REPO, 'packages/edit-store/lib/caption-window.js'));
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
const run = (command, args, { cwd = ROOT, timeoutMs = 180_000 } = {}) => new Promise((resolve, reject) => {
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

async function waitEval(cdp, expression, { timeoutMs = 60_000, label = 'condition', contextId } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try { const value = await evalOn(cdp, expression, contextId); if (value) return value; }
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

async function clickSelector(cdp, selector) {
  await ensureDaihonVisible(cdp);
  const point = await waitEval(cdp, `(()=>{const e=document.querySelector(${S(selector)});if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return r.width>0&&r.height>0?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`, { label: `${selector} visible` });
  await realClick(cdp, point.x, point.y);
  await sleep(140);
}

// 語間 ⊕ の pop を開き、改行トグルのボタン（置く / やめる）を押す。
async function toggleBreak(cdp, rowId, gapIndex) {
  const gap = `.akari-daihon-row[data-caption-id="${rowId}"] .akari-daihon-wgap[data-gap-index="${gapIndex}"]`;
  let last;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await evalOn(cdp, `document.body.querySelectorAll('.akari-daihon-pop').forEach(node=>node.remove())`).catch(() => {});
      await clickSelector(cdp, gap);
      const label = await waitEval(cdp, `(()=>{const c=document.querySelector('.akari-daihon-pop');if(!c)return null;const b=[...c.querySelectorAll('button')].find(node=>node.textContent.includes('改行'));if(!b)return null;const r=b.getBoundingClientRect();return r.width>0&&r.height>0?{x:r.left+r.width/2,y:r.top+r.height/2,text:b.textContent.trim()}:null})()`,
        { label: `⊕ pop の改行ボタン attempt ${attempt}`, timeoutMs: 8_000 });
      await realClick(cdp, label.x, label.y);
      await sleep(200);
      return label.text;
    } catch (error) {
      last = error;
      if (attempt < 5) await sleep(400);
    }
  }
  throw new Error(`改行ボタンを押せない（${gap}）: ${sanitize(last)}`);
}

const slashCounts = `(()=>{const row=document.querySelector('.akari-daihon-row[data-caption-id="c-0001"]');return{rowManual:row?row.querySelectorAll('.akari-daihon-slash.manual').length:-1,rowAuto:row?row.querySelectorAll('.akari-daihon-slash.auto').length:-1,rowTotal:row?row.querySelectorAll('.akari-daihon-slash').length:-1,lock:row?.querySelector('.akari-daihon-badge-breaklock')?.textContent??null,docTotal:document.querySelectorAll('.akari-daihon-slash').length}})()`;

const PREVIEW_PROBE = `(()=>{
  const plate=document.getElementById('caption-plate');
  if(!plate||plate.matches(':empty'))return null;
  const captions=(window.__akariPreview?.captions??[])
    .filter(cue=>String(cue.id??'')==='c-0001')
    .map(cue=>({id:cue.id??null,fragmentKey:cue.fragmentKey??null,text:cue.text??null,start:cue.start??null,end:cue.end??null}));
  return{captions,plate:{className:plate.className,lineTextContent:[...plate.querySelectorAll('.akari-caption__line')].map(line=>line.textContent),textContent:plate.textContent}};
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

async function observePreview(cdp, time, mustInclude, mustExclude) {
  const editUri = pathToFileURL(EDIT).toString();
  await evalOn(cdp, commandWith('akari.preview.ensureVisible', { editUri })).catch(() => {});
  const deadline = Date.now() + 120_000;
  let lastSeen = null;
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
        if (value) {
          lastSeen = value;
          const text = String(value.plate.textContent ?? '');
          if (text.includes(mustInclude) && !text.includes(mustExclude)) {
            return { observed: true, time, captionCount: connection.captionCount, ...value };
          }
        }
      } catch {} finally { connection.cdp.close(); }
    }
    await sleep(400);
  }
  throw new Error(`t=${time}s で「${mustInclude}」だけを描く字幕 DOM を観測できない（最後の観測: ${JSON.stringify(lastSeen)}）`);
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
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline && !target) {
    try { target = (await listTargets(PORT)).find(item => item.type === 'page'); } catch {}
    if (!target) await sleep(300);
  }
  assert(target, 'CDP page target did not appear');
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await waitEval(cdp, `Boolean(window.theia&&window.theia.container&&document.getElementById('theia-app-shell'))`, { label: 'Theia workbench', timeoutMs: 180_000 });
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
  const backendSurvivors = await new Promise(resolve => {
    const child = spawn('/bin/sh', ['-c', `ps -eo pid,ppid,args | grep -F ${JSON.stringify(path.join(SHELL_DIR, 'lib/backend/main.js'))} | grep -v grep | wc -l`]);
    let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.once('close', () => resolve(Number(stdout.trim())));
  });
  try {
    const log = await readFile(LOG, 'utf8');
    await writeFile(LOG, sanitizeText(log));
  } catch {}
  out.cleanup = { killedPid: pid ?? null, survivingProcesses: survivors, survivingBackendMain: backendSurvivors };
  await save();
  return survivors;
}

let session;
try {
  out.fixture = JSON.parse((await run(process.execPath, [path.join(ROOT, 'scripts', 'gen-fixture.mjs')], { timeoutMs: 240_000 })).stdout.trim());
  const initialRoot = JSON.parse(await readFile(CAPTIONS, 'utf8'));
  assert(!Object.prototype.hasOwnProperty.call(initialRoot, 'display_policy'), 'fixture に display_policy が入っている');
  assert(initialRoot.captions.every(caption => caption.display_fragments === undefined), 'fixture に display_fragments が入っている');
  out.legacyProject = { hasDisplayPolicy: false, captions: initialRoot.captions.length };
  await save();

  session = await launch();
  const { cdp } = session;
  await evalOn(cdp, command('akari.daihon.open'));
  await waitEval(cdp, `document.querySelectorAll('.akari-daihon-row').length===3`, { label: '3 rows' });
  out.preloadOverlay = await settlePreloadOverlay(cdp);
  out.daihonVisible = await ensureDaihonVisible(cdp);

  const fragments = await step('1. ⊕ →「／ ここで改行」で濃い／が 1 つ増え、display_fragments が書かれる', async () => {
    const before = await evalOn(cdp, slashCounts);
    assert(before.rowTotal === 0, `初期の c-0001 に／がある: ${JSON.stringify(before)}`);
    const buttonText = await toggleBreak(cdp, 'c-0001', 2);
    const written = await waitFile(source => {
      const caption = JSON.parse(source).captions.find(item => item.id === 'c-0001');
      return Array.isArray(caption?.display_fragments) && caption.display_fragments.length === 2;
    }, 'display_fragments 2 件の書き込み');
    // reload（watcher）を待たずに当該行が差し替わることを見る
    const after = await waitEval(cdp, `(()=>{const value=${slashCounts};return value.rowManual===1?value:null})()`,
      { label: '濃い／が 1 つ増える', timeoutMs: 15_000 });
    const caption = JSON.parse(written).captions.find(item => item.id === 'c-0001');
    assert(after.rowManual - before.rowManual === 1, `濃い／の増分が 1 でない: ${JSON.stringify({ before, after })}`);
    assert(after.lock === '🔒 改行を手で固定', `🔒 チップが ${after.lock}`);

    // 2 個目の／を置いても 1 個目が崩れない（N 断片）→ 戻す
    const second = await toggleBreak(cdp, 'c-0001', 1);
    const three = await waitFile(source => {
      const item = JSON.parse(source).captions.find(entry => entry.id === 'c-0001');
      return item?.display_fragments?.length === 3;
    }, 'display_fragments 3 件');
    const threeSlashes = await waitEval(cdp, `(()=>{const value=${slashCounts};return value.rowManual===2?value:null})()`,
      { label: '濃い／が 2 つ', timeoutMs: 15_000 });
    const threeFragments = JSON.parse(three).captions.find(entry => entry.id === 'c-0001').display_fragments;
    await toggleBreak(cdp, 'c-0001', 1);
    const backToTwo = await waitFile(source => {
      const item = JSON.parse(source).captions.find(entry => entry.id === 'c-0001');
      return item?.display_fragments?.length === 2;
    }, 'display_fragments 2 件へ戻る');
    const backSlashes = await waitEval(cdp, `(()=>{const value=${slashCounts};return value.rowManual===1?value:null})()`,
      { label: '濃い／が 1 つへ戻る', timeoutMs: 15_000 });
    const finalFragments = JSON.parse(backToTwo).captions.find(entry => entry.id === 'c-0001').display_fragments;
    return {
      buttonText, before, after,
      fragments: caption.display_fragments,
      edited: caption.edited,
      kernelWindows: captionFragmentWindows(caption),
      threeFragments: { buttonText: second, fragments: threeFragments, slashes: threeSlashes },
      afterRemoveSecond: { fragments: finalFragments, slashes: backSlashes }
    };
  });
  await shot(cdp, 1, 'daihon-manual-slash');
  assert(fragments.fragments[0] === 'きょうは天気が' && fragments.fragments[1] === 'とてもよいので',
    `断片が期待と違う: ${JSON.stringify(fragments.fragments)}`);

  await step('2. 前半の語の時刻では「前半」だけを描く（display_policy 無し）', async () => {
    const preview = await observePreview(cdp, 1.2, 'きょうは天気が', 'とてもよいので');
    return preview;
  });
  await shot(cdp, 2, 'preview-first-fragment');

  await step('3. 後半の語の時刻では「後半」だけを描く', async () => {
    const preview = await observePreview(cdp, 2.4, 'とてもよいので', 'きょうは天気が');
    return preview;
  });
  await shot(cdp, 3, 'preview-second-fragment');

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
