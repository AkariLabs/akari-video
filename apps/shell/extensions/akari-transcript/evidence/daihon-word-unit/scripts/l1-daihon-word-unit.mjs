#!/usr/bin/env node
// L1（CDP 3 手順・契約 指示 5）:
//  1. 「ゴールデンウィーク」をクリック → 1 単位が選ばれる（8 トークンが 1 語）
//  2. 🎨 → emphasis_words 1 件・t_start =「ゴ」の start（14.54）・t_end =「ク」の end（17.51）
//  3. ⚙ でトークンに切替 → 「ゴ」だけ選べる（設定は User スコープの settings.json に残る）
// Electron は detached にせず、AKARI_HOME / --user-data-dir / THEIA_CONFIG_DIR を runs/ 配下へ向ける。
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
const PORT = Number(process.argv.find(value => value.startsWith('--port='))?.slice(7) ?? 22183);
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
    last = await readFile(file, 'utf8').catch(() => '');
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
const wordSelector = (row, index) => `.akari-daihon-row[data-caption-id="${row}"] .akari-daihon-word[data-word-index="${index}"]`;

async function ensureDaihonVisible(cdp) {
  const probe = "(()=>{const e=document.querySelector('.akari-daihon-row[data-caption-id=\"c-0005\"] .akari-daihon-word[data-word-index=\"0\"]');if(!e)return null;const r=e.getBoundingClientRect();return JSON.stringify({w:r.width,h:r.height,top:r.top})})()";
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
  return evalOn(cdp, `(()=>{const rows=[...document.querySelectorAll('.akari-daihon-row')].slice(0,3).map(r=>({id:r.dataset.captionId,words:r.querySelectorAll('.akari-daihon-word').length,html:r.innerHTML.slice(0,220)}));return JSON.stringify({rows})})()`).catch(error => String(error));
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

async function clickByText(cdp, containerSelector, needle) {
  const expression = `(()=>{const c=document.querySelector(${S(containerSelector)});if(!c)return null;const b=[...c.querySelectorAll('button')].find(node=>node.textContent.includes(${S(needle)}));if(!b)return null;b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return r.width>0&&r.height>0?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`;
  const point = await waitEval(cdp, expression, { label: `${containerSelector} button "${needle}"` });
  await realClick(cdp, point.x, point.y);
}

async function shot(cdp, number, label) {
  const name = `${String(number).padStart(2, '0')}-${label}.png`;
  await screenshot(cdp, path.join(ROOT, name));
  out.screenshots.push(name);
  await save();
}

const rowWords = row => `(()=>{const w=[...document.querySelectorAll('.akari-daihon-row[data-caption-id="${row}"] .akari-daihon-word')];return JSON.stringify(w.map(node=>node.textContent))})()`;
const selectedTexts = `(()=>{const w=[...document.querySelectorAll('.akari-daihon-word.wordsel')];return JSON.stringify(w.map(node=>node.textContent))})()`;

// 浮きバーや ⚙ ポップが語を覆っていると実クリックが語へ届かない。
// ポップを閉じ、element-from-point で語が露出したことを確かめてから押す。
async function clickWordWhenExposed(cdp, row, index, { attempts = 12 } = {}) {
  const tried = [];
  for (let attempt = 0; attempt < attempts; attempt++) {
    await evalOn(cdp, `(()=>{document.querySelectorAll('.akari-daihon-pop').forEach(node=>node.remove());return true})()`);
    await sleep(250);
    const point = await rect(cdp, wordSelector(row, index));
    const probe = '(()=>{const e=document.elementFromPoint(' + point.x + ',' + point.y + ');'
      + "if(!e)return null;return [e.className,(e.dataset&&e.dataset.rowId)||'',(e.dataset&&e.dataset.wordIndex)||''].join('|')})()";
    const hit = await evalOn(cdp, probe);
    if (typeof hit === 'string' && hit.includes('akari-daihon-word') && hit.includes(`|${row}|${index}`)) {
      await realClick(cdp, point.x, point.y);
      await sleep(200);
      const selected = JSON.parse(await evalOn(cdp, selectedTexts));
      if (selected.length > 0) return { selected, attempts: attempt + 1, hit };
      tried.push({ attempt, hit, selected });
      continue;
    }
    tried.push({ attempt, hit });
  }
  throw new Error(`語 ${row}[${index}] を押せない: ${JSON.stringify(tried)}`);
}

// 設定の保存後に ⚙ ポップが開き直る（非同期）ため、押したい要素が覆われることがある。
// ポップを閉じ、押し、条件が満たされるまで繰り返す。
async function clickUntil(cdp, selector, condition, label, attempts = 8) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    await evalOn(cdp, `(()=>{document.querySelectorAll('.akari-daihon-pop').forEach(node=>node.remove());return true})()`);
    await sleep(350);
    await clickSelector(cdp, selector).catch(() => {});
    await sleep(350);
    if (await evalOn(cdp, condition).catch(() => false)) return attempt + 1;
  }
  throw new Error(`${label} not reached after ${attempts} clicks on ${selector}`);
}

let spawnedChild;

async function launch({ wipe = true } = {}) {
  if (wipe) await rm(ISO, { recursive: true, force: true });
  await mkdir(ISO, { recursive: true });
  await mkdir(path.join(ROOT, 'runs'), { recursive: true });
  const home = path.join(ISO, 'akari-home');
  await mkdir(home, { recursive: true });
  if (wipe) await writeFile(LOG, '');
  const child = spawn(ELECTRON, [
    SHELL_DIR, PROJECT, `--remote-debugging-port=${PORT}`, `--user-data-dir=${ISO}`, '--no-sandbox'
  ], {
    cwd: REPO,
    env: { ...process.env, AKARI_HOME: home, THEIA_CONFIG_DIR: ISO },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  spawnedChild = child;
  const append = chunk => void writeFile(LOG, chunk, { flag: 'a' }).catch(() => {});
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
let session;
try {
  await rm(path.join(ROOT, 'fixture'), { recursive: true, force: true });
  out.fixture = JSON.parse((await run(process.execPath, [path.join(ROOT, 'scripts', 'gen-fixture.mjs')], { timeoutMs: 180_000 })).stdout.trim());
  await save();
  const originalCaptions = await readFile(captionsPath, 'utf8');
  session = await launch();
  const { cdp } = session;
  await evalOn(cdp, command('akari.daihon.open'));
  await waitEval(cdp, `document.querySelectorAll('.akari-daihon-row').length===8`, { label: '8 rows' });
  out.preloadOverlay = await settlePreloadOverlay(cdp);
  out.daihonVisible = await ensureDaihonVisible(cdp);
  await save();

  await step('1. 「ゴールデンウィーク」を 1 回クリック → 1 単位が選ばれる', async () => {
    const words = JSON.parse(await evalOn(cdp, rowWords('c-0005')));
    assert(words.length === 5, `c-0005 の単位数が ${words.length}（期待 5）: ${JSON.stringify(words)}`);
    assert(words[1] === 'ゴールデンウィーク', `単位 1 が ${words[1]}`);
    await clickSelector(cdp, wordSelector('c-0005', 1));
    const label = await waitEval(cdp, `(()=>{const e=document.querySelector('.akari-daihon-wordbar .summary');return e?e.textContent:null})()`, { label: 'word bar label' });
    const selected = JSON.parse(await evalOn(cdp, selectedTexts));
    assert(selected.length === 1 && selected[0] === 'ゴールデンウィーク', `選択されたのは ${JSON.stringify(selected)}`);
    assert(/1 語/.test(label), `bar label was ${label}`);
    return { units: words, selected, label };
  });
  await shot(cdp, 1, 'word-unit-click');

  const emphasis = await step('2. 🎨 → emphasis_words 1 件・t_start 14.54 / t_end 17.51', async () => {
    await clickByText(cdp, '.akari-daihon-wordbar', 'テンプレ');
    await waitEval(cdp, `(()=>{const c=[...document.querySelectorAll('.akari-daihon-pop .akari-daihon-tplcard')];return c.length>=5})()`, { label: 'preset cards' });
    await clickSelector(cdp, '.akari-daihon-pop .akari-daihon-tplcard[data-preset-id="neon"]');
    const after = await waitFile(captionsPath, source => {
      try { return JSON.parse(source)?.emphasis_words?.length === 1; } catch { return false; }
    }, 'emphasis_words 1 件');
    const parsed = JSON.parse(after);
    const entry = parsed.emphasis_words[0];
    assert(entry.word === 'ゴールデンウィーク', `word was ${entry.word}`);
    assert(entry.t_start === 14.54, `t_start was ${entry.t_start}`);
    assert(entry.t_end === 17.51, `t_end was ${entry.t_end}`);
    assert(entry.style_preset === 'neon', `style_preset was ${entry.style_preset}`);
    const row = parsed.captions.find(item => item.id === 'c-0005');
    assert(row.words.length === 13, `captions.json の words[] が ${row.words.length} 件（ASR トークン 13 件のままであること）`);
    assert(row.text === 'これゴールデンウィーク明けにYou', '本文が変わった');
    return {
      entry, captionTokens: row.words.length,
      tokenStartOfGo: row.words[1].start, tokenEndOfKu: row.words[8].end
    };
  });
  await shot(cdp, 2, 'emphasis-word-unit');

  await step('3. ⚙ で「認識トークン」へ → 「ゴ」だけ選べる・設定は User スコープに残る', async () => {
    await clickSelector(cdp, 'button.akari-daihon-display');
    await waitEval(cdp, `(()=>{const p=document.querySelector('.akari-daihon-pop');return Boolean(p&&[...p.querySelectorAll('button')].some(b=>b.textContent.includes('認識トークン')))})()`, { label: '選択の単位 セグメント' });
    await clickByText(cdp, '.akari-daihon-pop', '認識トークン');
    await waitEval(cdp, `document.querySelectorAll('.akari-daihon-row[data-caption-id="c-0005"] .akari-daihon-word').length===13`, { label: 'トークン 13 個' });
    const words = JSON.parse(await evalOn(cdp, rowWords('c-0005')));
    assert(words[1] === 'ゴ', `トークン 1 が ${words[1]}`);
    const cleared = JSON.parse(await evalOn(cdp, selectedTexts));
    assert(cleared.length === 0, `切り替えで選択が残った: ${JSON.stringify(cleared)}`);
    const click = await clickWordWhenExposed(cdp, 'c-0005', 1);
    const selected = click.selected;
    assert(selected.length === 1 && selected[0] === 'ゴ', `選択されたのは ${JSON.stringify(selected)}`);
    const settings = await waitFile(path.join(ISO, 'settings.json'),
      source => { try { return JSON.parse(source)['akari.daihon.wordUnit'] === 'token'; } catch { return false; } },
      'settings.json の akari.daihon.wordUnit');
    return { tokens: words, selected, clickAttempts: click.attempts, settings: JSON.parse(settings)['akari.daihon.wordUnit'], clearedOnSwitch: true };
  });
  await shot(cdp, 3, 'token-unit-click');

  // 追加検証（契約の「プロジェクトを跨いで覚える」）: 同じ user-data-dir で開き直しても
  // 認識トークンのままであること。Electron は 1 本ずつ（前の 1 本を落としてから起動する）。
  const firstCleanup = await stop(session);
  session = undefined;
  assert(firstCleanup === 0, `1 回目の残プロセスが ${firstCleanup} 件`);
  session = await launch({ wipe: false });
  await step('4. 開き直しても認識トークンのまま（User スコープの設定が効く）', async () => {
    const { cdp: restarted } = session;
    await evalOn(restarted, command('akari.daihon.open'));
    await waitEval(restarted, `document.querySelectorAll('.akari-daihon-row').length===8`, { label: '8 rows (restart)' });
    await settlePreloadOverlay(restarted);
    await ensureDaihonVisible(restarted);
    const words = await waitEval(restarted, rowWords('c-0005'), { label: 'c-0005 words (restart)' });
    const parsed = JSON.parse(words);
    assert(parsed.length === 13, `開き直したら ${parsed.length} 個（期待 13 = 認識トークン）: ${words}`);
    await shot(restarted, 4, 'token-unit-after-restart');
    return { tokens: parsed.length, firstRunCleanup: firstCleanup };
  });

  // 追加検証（契約 指示 3「分割の境界は単位境界」）: ⚙ を単語へ戻し、⧉ の分割印を
  // 「ゴールデンウィーク」と「明け」の間で押す。captions.json が語の途中（ゴ|ール）ではなく
  // 語の境界（…ウィーク | 明け…）で切れること = 単位 index → トークン index の変換が効いている。
  await step('5. 単語へ戻して ⧉ 分割 → 語の途中では切れない', async () => {
    const { cdp: restarted } = session;
    await clickSelector(restarted, 'button.akari-daihon-display');
    await waitEval(restarted, `(()=>{const p=document.querySelector('.akari-daihon-pop');return Boolean(p&&[...p.querySelectorAll('button')].some(b=>b.textContent.includes('単語')))})()`, { label: '選択の単位 セグメント（戻し）' });
    await clickByText(restarted, '.akari-daihon-pop', '単語');
    await waitEval(restarted, `document.querySelectorAll('.akari-daihon-row[data-caption-id="c-0005"] .akari-daihon-word').length===5`, { label: '単語 5 個に戻る' });
    const splitClicks = await clickUntil(restarted,
      '.akari-daihon-row[data-caption-id="c-0005"] button.akari-daihon-split',
      `document.querySelectorAll('.akari-daihon-splitmark[data-row-id="c-0005"]').length===4`,
      '分割印 4 個（単位境界）');
    await shot(restarted, 5, 'split-marks-at-word-boundaries');
    await clickSelector(restarted, '.akari-daihon-splitmark[data-row-id="c-0005"][data-split-index="2"]');
    const after = await waitFile(captionsPath, source => {
      try { return JSON.parse(source).captions.some(item => item.text === '明けにYou'); } catch { return false; }
    }, '語境界での分割');
    const rows = JSON.parse(after).captions;
    const head = rows.find(item => item.id === 'c-0005');
    const tail = rows.find(item => item.text === '明けにYou');
    assert(head.text === 'これゴールデンウィーク', `前半が ${head.text}`);
    assert(head.words.length === 9, `前半のトークンが ${head.words.length} 件（期待 9）`);
    assert(tail.words.length === 4, `後半のトークンが ${tail.words.length} 件（期待 4）`);
    assert(head.end === 17.51, `前半の end が ${head.end}`);
    return { splitClicks, head: head.text, tail: tail.text, headTokens: head.words.length, tailTokens: tail.words.length, headEnd: head.end };
  });

  out.summary = {
    unitsC0005: 5, tokensC0005: 13,
    emphasis: { t_start: emphasis.entry.t_start, t_end: emphasis.entry.t_end, word: emphasis.entry.word },
    captionsWordsUnchanged: emphasis.captionTokens === 13,
    originalCaptionsBytes: originalCaptions.length,
    firstRunSurvivingProcesses: firstCleanup
  };
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
