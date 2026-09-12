#!/usr/bin/env node
// L1（CDP 6 手順）: 横ドラッグ → 浮きバー / ⌘ で別行の語を足す / 🎨 neon → emphasis_words 2 件 /
// 右クリック 5 群 + Coming soon は書き込み 0 / ⊕ → 改行 → display_fragments / ⌘Z で両ファイルとも戻る。
// Electron は detached にせず、AKARI_HOME と --user-data-dir を runs/ 配下の一時ディレクトリへ向ける。
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick, screenshot } from './cdp-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL_DIR = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(REPO, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const PROJECT = path.join(ROOT, 'fixture', 'project');
const RESULTS = path.join(ROOT, 'results.json');
const PORT = Number(process.argv.find(value => value.startsWith('--port='))?.slice(7) ?? 22141);
const ISO = path.join(ROOT, 'runs', 'l1');
const LOG = path.join(ROOT, 'runs', 'l1.log');
const S = value => JSON.stringify(value);
const out = { status: 'running', steps: [], screenshots: [], cleanup: null };

const sanitize = value => String(value?.stack || value?.message || value)
  .replaceAll(REPO, '<WORKTREE>')
  .replaceAll(process.env.HOME ?? '~', '<HOME>')
  .replace(/\/(?:private\/)?(?:tmp|var\/folders)\/[^\s)'"]+/g, '<TMP>')
  .replace(/\/Users\/[^\s)'"]+/g, '<HOME>');
const save = async () => {
  const temporary = `${RESULTS}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(out, null, 2)}\n`);
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

async function waitFile(file, predicate, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    last = await readFile(file, 'utf8');
    if (predicate(last)) return last;
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
const commitCount = async () => Number((await run('/usr/bin/git', ['rev-list', '--count', 'HEAD'], { cwd: PROJECT })).stdout.trim());
const textLines = source => source.match(/^\s*"text": .*$/gm) ?? [];

const wordSelector = (row, index) => `.akari-daihon-row[data-caption-id="${row}"] .akari-daihon-word[data-word-index="${index}"]`;

// 右ドックの別タブが前面に来ていると台本の DOM は 0 サイズになる。見えるまで開き直す。
async function ensureDaihonVisible(cdp) {
  const probe = "(()=>{const e=document.querySelector('.akari-daihon-row[data-caption-id=\"c-0001\"] .akari-daihon-word[data-word-index=\"0\"]');if(!e)return null;const r=e.getBoundingClientRect();return JSON.stringify({w:r.width,h:r.height,top:r.top})})()";
  const deadline = Date.now() + 60_000;
  let last = null;
  while (Date.now() < deadline) {
    last = await evalOn(cdp, probe).catch(() => null);
    if (last && JSON.parse(last).w > 0 && JSON.parse(last).h > 0) return JSON.parse(last);
    await evalOn(cdp, command('akari.daihon.open')).catch(() => {});
    await sleep(600);
  }
  throw new Error(`台本パネルが見えない: ${last} | ${await domDump(cdp)}`);
}

async function domDump(cdp) {
  return evalOn(cdp, `(()=>{const rows=[...document.querySelectorAll('.akari-daihon-row')].slice(0,3).map(r=>({id:r.dataset.captionId,words:r.querySelectorAll('.akari-daihon-word').length,html:r.innerHTML.slice(0,220)}));return JSON.stringify({rows,widgetHidden:document.querySelector('.akari-daihon-widget')?.closest('.p-Widget')?.classList.value||null})})()`).catch(error => String(error));
}

async function rect(cdp, selector) {
  await waitEval(cdp, `(()=>{const e=document.querySelector(${S(selector)});if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return r.width>0&&r.height>0})()`, { label: `${selector} visible`, timeoutMs: 20_000 })
    .catch(async error => { throw new Error(`${sanitize(error)} | dom=${await domDump(cdp)}`); });
  await sleep(140);
  return evalOn(cdp, `(()=>{const e=document.querySelector(${S(selector)});const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
}

async function clickSelector(cdp, selector, modifiers = 0) {
  const point = await rect(cdp, selector);
  await realClick(cdp, point.x, point.y, { modifiers });
}

async function rectNoScroll(cdp, selector) {
  return evalOn(cdp, `(()=>{const e=document.querySelector(${S(selector)});if(!e)return null;const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
}

async function clickByText(cdp, containerSelector, needle) {
  const expression = `(()=>{const c=document.querySelector(${S(containerSelector)});if(!c)return null;const b=[...c.querySelectorAll('button')].find(node=>node.textContent.includes(${S(needle)}));if(!b)return null;b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return r.width>0&&r.height>0?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`;
  const point = await waitEval(cdp, expression, { label: `${containerSelector} button "${needle}"` });
  await realClick(cdp, point.x, point.y);
}

async function dragWords(cdp, row, from, to) {
  const start = await rect(cdp, wordSelector(row, from));
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x, y: start.y, button: 'none' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', buttons: 1, clickCount: 1 });
  for (let index = from + 1; index <= to; index++) {
    const point = await rectNoScroll(cdp, wordSelector(row, index));
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'left', buttons: 1 });
    await sleep(60);
  }
  const end = await rectNoScroll(cdp, wordSelector(row, to));
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: end.x, y: end.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(120);
}

// 浮きバーは position:fixed で先頭語の真下に出るため、すぐ下の行の語を覆うことがある。
// 実ユーザーと同じ「見えている語を押す」を守るため、ヒットテストできた最初の別行の語を使う。
async function cmdClickAnotherRow(cdp, candidates) {
  const tried = [];
  for (const [row, index] of candidates) {
    const point = await rect(cdp, wordSelector(row, index));
    const probe = '(()=>{const e=document.elementFromPoint(' + point.x + ',' + point.y + ');'
      + "if(!e)return null;return [e.className,(e.dataset&&e.dataset.rowId)||'',(e.dataset&&e.dataset.wordIndex)||''].join('|')})()";
    const hit = await evalOn(cdp, probe);
    if (typeof hit === 'string' && hit.includes('akari-daihon-word') && hit.includes('|' + row + '|')) {
      await realClick(cdp, point.x, point.y, { modifiers: 4 });
      return { row, index, blocked: tried };
    }
    tried.push({ row, index, coveredBy: hit });
  }
  throw new Error('別の行の語がどれもヒットテストできない: ' + JSON.stringify(tried));
}

async function rightClick(cdp, selector) {
  const point = await rect(cdp, selector);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'right', buttons: 2, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'right', buttons: 0, clickCount: 1 });
  await sleep(200);
  const shown = await evalOn(cdp, `Boolean(document.querySelector('.akari-daihon-wordcm'))`);
  if (shown) return 'native';
  await evalOn(cdp, `(()=>{const e=document.querySelector(${S(selector)});const r=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2}));return true})()`);
  await sleep(200);
  return 'synthetic';
}

async function pressUndo(cdp) {
  for (const type of ['rawKeyDown', 'keyUp']) {
    await cdp.send('Input.dispatchKeyEvent', {
      type, modifiers: 4, key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90,
      ...(type === 'rawKeyDown' ? { text: 'z', unmodifiedText: 'z' } : {})
    });
  }
  await sleep(150);
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
  const home = path.join(ISO, 'akari-home');
  await mkdir(home, { recursive: true });
  const logFile = await (async () => { await writeFile(LOG, ''); return LOG; })();
  const child = spawn(ELECTRON, [
    SHELL_DIR, PROJECT, `--remote-debugging-port=${PORT}`, `--user-data-dir=${ISO}`, '--no-sandbox'
  ], {
    cwd: REPO,
    env: { ...process.env, AKARI_HOME: home, THEIA_CONFIG_DIR: ISO },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  spawnedChild = child;
  const append = chunk => void writeFile(logFile, chunk, { flag: 'a' }).catch(() => {});
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
  out.cleanup = { killedPid: pid ?? null, survivingProcesses: survivors };
  await save();
  return survivors;
}

const captionsPath = path.join(PROJECT, 'captions.json');
const editPath = path.join(PROJECT, 'edit.json');
let session;
try {
  // 走るたびに fixture を作り直す（前の run が commit した captions.json を引き継がないため）。
  await rm(path.join(ROOT, 'fixture'), { recursive: true, force: true });
  out.fixture = JSON.parse((await run(process.execPath, [path.join(ROOT, 'scripts', 'gen-fixture.mjs')], { timeoutMs: 180_000 })).stdout.trim());
  await save();
  const originalCaptions = await readFile(captionsPath, 'utf8');
  const originalEdit = await readFile(editPath, 'utf8');
  session = await launch();
  const { cdp } = session;
  await evalOn(cdp, command('akari.daihon.open'));
  await waitEval(cdp, `document.querySelectorAll('.akari-daihon-row').length===5`, { label: '5 rows' });
  out.preloadOverlay = await settlePreloadOverlay(cdp);
  out.daihonVisible = await ensureDaihonVisible(cdp);
  await save();

  await step('1. 横ドラッグで 3 語 → 浮きバーに「3 語」', async () => {
    await dragWords(cdp, 'c-0001', 0, 2);
    const label = await waitEval(cdp, `(()=>{const e=document.querySelector('.akari-daihon-wordbar .summary');return e?e.textContent:null})()`, { label: 'word bar label' });
    const selected = await evalOn(cdp, `document.querySelectorAll('.akari-daihon-word.wordsel').length`);
    const selectedRows = await evalOn(cdp, `document.querySelectorAll('.akari-daihon-row.selected').length`);
    assert(/3 語/.test(label), `bar label was ${label}`);
    assert(selected === 3, `selected words were ${selected}`);
    assert(selectedRows === 0, `word drag also selected ${selectedRows} rows`);
    return { label, selected, selectedRows };
  });
  await shot(cdp, 1, 'drag-3-words');

  await step('2. ⌘ で 2 行目の語を足す → 「2 範囲 · 4 語」', async () => {
    const target = await cmdClickAnotherRow(cdp, [['c-0002', 1], ['c-0003', 1], ['c-0005', 1]]);
    const label = await waitEval(cdp, `(()=>{const e=document.querySelector('.akari-daihon-wordbar .summary');return e&&/範囲/.test(e.textContent)?e.textContent:null})()`, { label: 'multi range label' });
    const selected = await evalOn(cdp, `document.querySelectorAll('.akari-daihon-word.wordsel').length`);
    assert(/2 範囲/.test(label) && /4 語/.test(label), `bar label was ${label}`);
    assert(selected === 4, `selected words were ${selected}`);
    return { label, selected, target };
  });
  await shot(cdp, 2, 'cmd-add-second-row');

  const emphasis = await step('3. 🎨 → neon → emphasis_words 2 件・本文バイト不変', async () => {
    const beforeCommits = await commitCount();
    await clickByText(cdp, '.akari-daihon-wordbar', 'テンプレ');
    const cards = await waitEval(cdp, `(()=>{const c=[...document.querySelectorAll('.akari-daihon-pop .akari-daihon-tplcard')];return c.length>=5?c.map(card=>card.dataset.presetId):null})()`, { label: '5 preset cards' });
    await shot(cdp, 3, 'tpl-cards');
    const sample = await evalOn(cdp, `(()=>{const e=document.querySelector('.akari-daihon-pop .akari-daihon-tplcard[data-preset-id="neon"] .tprev');return e?e.textContent:null})()`);
    await clickSelector(cdp, '.akari-daihon-pop .akari-daihon-tplcard[data-preset-id="neon"]');
    const after = await waitFile(captionsPath, source => {
      try {
        const root = JSON.parse(source);
        return Array.isArray(root?.emphasis_words) && root.emphasis_words.length === 2;
      } catch { return false; }
    }, 'emphasis_words 2 件');
    const parsed = JSON.parse(after);
    const ids = parsed.emphasis_words.map(item => item.id);
    assert(parsed.emphasis_words.every(item => item.style_preset === 'neon'), 'style_preset was not neon');
    assert(parsed.emphasis_words.every(item => /^e-\d{4}$/.test(item.id)), `id format was ${ids.join(',')}`);
    assert(parsed.emphasis_words.every(item => item.emotion === 'neutral'), 'emotion was not neutral');
    assert(JSON.stringify(textLines(after)) === JSON.stringify(textLines(originalCaptions)), 'captions text lines changed');
    const validate = await run(process.execPath, [
      path.join(REPO, 'packages/schemas/bin/validate-captions.mjs'), captionsPath
    ], { timeoutMs: 60_000 }).then(() => 0).catch(error => { throw error; });
    return {
      ids, words: parsed.emphasis_words.map(item => item.word), cards, cardSample: sample,
      commitDelta: (await commitCount()) - beforeCommits, validateCaptionsExit: validate,
      textLinesEqual: true
    };
  });
  await shot(cdp, 4, 'emphasis-applied');

  await step('4. 右クリックで 5 群・Coming soon は書き込み 0', async () => {
    const dispatch = await rightClick(cdp, wordSelector('c-0003', 1));
    const groups = await waitEval(cdp, `(()=>{const m=document.querySelector('.akari-daihon-wordcm');if(!m)return null;const h=[...m.querySelectorAll('.akari-daihon-pttl')].map(e=>e.textContent);return h.length>=5?h:null})()`, { label: '5 groups' });
    await shot(cdp, 5, 'context-menu-5-groups');
    const comingSoon = await evalOn(cdp, `document.querySelectorAll('.akari-daihon-wordcm button.disabled').length`);
    const beforeCaptions = await readFile(captionsPath, 'utf8');
    const beforeEdit = await readFile(editPath, 'utf8');
    await clickSelector(cdp, '.akari-daihon-wordcm button.disabled');
    await sleep(1200);
    assert(await readFile(captionsPath, 'utf8') === beforeCaptions, 'captions.json changed on Coming soon');
    assert(await readFile(editPath, 'utf8') === beforeEdit, 'edit.json changed on Coming soon');
    return { dispatch, groups, comingSoonItems: comingSoon, writes: 0 };
  });

  await step('5. ⊕ → 改行 → display_fragments + edited', async () => {
    await clickSelector(cdp, '.akari-daihon-row[data-caption-id="c-0004"] .akari-daihon-wgap[data-gap-index="2"]');
    await waitEval(cdp, `(()=>{const p=document.querySelector('.akari-daihon-pop');return Boolean(p&&[...p.querySelectorAll('button')].some(node=>node.textContent.includes('改行')))})()`, { label: 'gap menu' });
    await shot(cdp, 6, 'gap-menu-break');
    await clickByText(cdp, '.akari-daihon-pop', '改行');
    const after = await waitFile(captionsPath, source => {
      try {
        const root = JSON.parse(source);
        const rows = Array.isArray(root) ? root : root.captions;
        const row = rows.find(item => item.id === 'c-0004');
        return Array.isArray(row?.display_fragments) && row.display_fragments.length === 2 && row.edited === true;
      } catch { return false; }
    }, 'display_fragments 更新');
    const root = JSON.parse(after);
    const rows = Array.isArray(root) ? root : root.captions;
    const row = rows.find(item => item.id === 'c-0004');
    assert(row.display_fragments.join('') === row.text, 'fragments did not reassemble the text');
    return { fragments: row.display_fragments, edited: row.edited };
  });

  await step('6. ⌘Z で両ファイルとも戻る', async () => {
    await pressUndo(cdp);
    const afterFirst = await waitFile(captionsPath, source => {
      try {
        const root = JSON.parse(source);
        const rows = Array.isArray(root) ? root : root.captions;
        return !rows.find(item => item.id === 'c-0004')?.display_fragments;
      } catch { return false; }
    }, '改行の undo');
    await pressUndo(cdp);
    const afterSecond = await waitFile(captionsPath, source => source === originalCaptions, '強調の undo');
    return {
      breakUndone: !((JSON.parse(afterFirst).captions ?? JSON.parse(afterFirst)).find(item => item.id === 'c-0004')?.display_fragments),
      captionsBytesEqualOriginal: afterSecond === originalCaptions,
      editBytesEqualOriginal: (await readFile(editPath, 'utf8')) === originalEdit,
      emphasisIdsBefore: emphasis.ids
    };
  });

  out.status = 'pass';
  await save();
} catch (error) {
  out.status = 'fail';
  out.error = sanitize(error);
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
process.stdout.write(`${JSON.stringify({ status: out.status, steps: out.steps.length, screenshots: out.screenshots.length, cleanup: out.cleanup })}\n`);
