#!/usr/bin/env node
// L1（CDP 5 手順 + 1）: 無音チップ → 波形つき範囲エディタ → つまみをドラッグ（可動域でクランプ）→ ✂ 詰める →
// 行の下が「✂ …詰めた ✎ 直す ↩」→ ✎ 直す → 範囲を変えて詰め直す（件数不変）→ ↩ で戻る。
// 追加 1 手順: 単語を選んで ✂ → 同じエディタが「語の前後 0.4 秒」の可動域で開く → 詰める → ⌘Z で戻る（履歴）。
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
const PORT = Number(process.argv.find(value => value.startsWith('--port='))?.slice(7) ?? 22151);
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
const wordSelector = (row, index) => `.akari-daihon-row[data-caption-id="${row}"] .akari-daihon-word[data-word-index="${index}"]`;

/** v2 edit.json の visual media item（= 旧 cuts 要素）を数える。1 回のカットで 1 本増える。 */
function mediaItems(source) {
  const edit = JSON.parse(source);
  return (edit.tracks ?? []).flatMap(track => (track.items ?? []))
    .filter(item => item?.source?.kind === 'media')
    .map(item => ({ id: item.id, in: item.source.in, out: item.source.out, at: item.at, duration: item.duration }));
}

/** 読み値「切る 0.45 秒 · 残す 0.15 秒 · 3.20–3.65」/ 語は「切る 0.95 秒 · 4.15–5.10」を数値へ。 */
function readout(text) {
  const silence = /切る ([\d.]+) 秒 · 残す ([\d.]+) 秒 · ([\d.]+)–([\d.]+)/u.exec(text ?? '');
  if (silence) return { text, cut: Number(silence[1]), keep: Number(silence[2]), from: Number(silence[3]), to: Number(silence[4]) };
  const word = /切る ([\d.]+) 秒 · ([\d.]+)–([\d.]+)/u.exec(text ?? '');
  if (word) return { text, cut: Number(word[1]), from: Number(word[2]), to: Number(word[3]) };
  throw new Error(`読み値を解釈できない: ${text}`);
}

const readoutNow = async cdp => readout(await evalOn(cdp,
  `(()=>{const e=document.querySelector('.akari-daihon-cutrange .read');return e?e.textContent:null})()`));

async function domDump(cdp) {
  return evalOn(cdp, `(()=>{const rows=[...document.querySelectorAll('.akari-daihon-row')].slice(0,3).map(r=>({id:r.dataset.captionId,chips:r.querySelectorAll('.akari-daihon-gapchip').length,html:r.innerHTML.slice(0,220)}));return JSON.stringify({rows,editor:Boolean(document.querySelector('.akari-daihon-cutrange'))})})()`).catch(error => String(error));
}

async function rect(cdp, selector) {
  await waitEval(cdp, `(()=>{const e=document.querySelector(${S(selector)});if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return r.width>0&&r.height>0})()`, { label: `${selector} visible`, timeoutMs: 20_000 })
    .catch(async error => { throw new Error(`${sanitize(error)} | dom=${await domDump(cdp)}`); });
  await sleep(140);
  return evalOn(cdp, `(()=>{const e=document.querySelector(${S(selector)});const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}})()`);
}

async function clickSelector(cdp, selector, modifiers = 0) {
  const point = await rect(cdp, selector);
  await realClick(cdp, point.x, point.y, { modifiers });
}

async function clickByText(cdp, containerSelector, needle) {
  const expression = `(()=>{const c=document.querySelector(${S(containerSelector)});if(!c)return null;const b=[...c.querySelectorAll('button')].find(node=>node.textContent.includes(${S(needle)})&&!node.disabled);if(!b)return null;b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return r.width>0&&r.height>0?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`;
  const point = await waitEval(cdp, expression, { label: `${containerSelector} button "${needle}"` });
  await realClick(cdp, point.x, point.y);
  await sleep(120);
}

/** つまみを canvas 上の目標 x へドラッグする（実ユーザーと同じ mouse 列）。 */
async function dragHandle(cdp, edge, targetX) {
  const handle = await rect(cdp, `.akari-daihon-cutrange .hnd.${edge}`);
  const y = handle.top + handle.height / 2;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handle.x, y, button: 'none' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: handle.x, y, button: 'left', buttons: 1, clickCount: 1 });
  const steps = 6;
  for (let index = 1; index <= steps; index++) {
    const x = handle.x + (targetX - handle.x) * index / steps;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
    await sleep(40);
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: targetX, y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(150);
}

async function dragWords(cdp, row, from, to) {
  const start = await rect(cdp, wordSelector(row, from));
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x, y: start.y, button: 'none' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', buttons: 1, clickCount: 1 });
  for (let index = from + 1; index <= to; index++) {
    const point = await evalOn(cdp, `(()=>{const e=document.querySelector(${S(wordSelector(row, index))});if(!e)return null;const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'left', buttons: 1 });
    await sleep(60);
  }
  const end = await evalOn(cdp, `(()=>{const e=document.querySelector(${S(wordSelector(row, to))});const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: end.x, y: end.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(150);
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

// 右ドックの別タブが前面に来ていると台本の DOM は 0 サイズになる。見えるまで開き直す。
async function ensureDaihonVisible(cdp) {
  const probe = "(()=>{const e=document.querySelector('.akari-daihon-row[data-caption-id=\"c-0001\"]');if(!e)return null;const r=e.getBoundingClientRect();return JSON.stringify({w:r.width,h:r.height,top:r.top})})()";
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

let spawnedChild;

async function launch() {
  await rm(ISO, { recursive: true, force: true });
  await mkdir(ISO, { recursive: true });
  await mkdir(path.join(ROOT, 'runs'), { recursive: true });
  const home = path.join(ISO, 'akari-home');
  await mkdir(home, { recursive: true });
  await writeFile(LOG, '');
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
const editPath = path.join(PROJECT, 'edit.json');
let session;
try {
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

  // 1. 無音チップ → 波形つき範囲エディタ（≤ 300ms・高さ ≤ 120px）
  const opened = await step('1. 無音チップ → 波形つき範囲エディタ（波形 RPC 込み ≤ 300ms）', async () => {
    await evalOn(cdp, `window.__akariDaihonCutRangeMetrics=undefined`);
    await clickSelector(cdp, '.akari-daihon-row[data-caption-id="c-0001"] .akari-daihon-gapchip');
    await waitEval(cdp, `Boolean(document.querySelector('.akari-daihon-cutrange canvas'))`, { label: '範囲エディタ' });
    const metrics = await waitEval(cdp, `(()=>{const m=window.__akariDaihonCutRangeMetrics;return m&&m.waveform?m:null})()`, { label: '波形の計測' });
    const geometry = await evalOn(cdp, `(()=>{const e=document.querySelector('.akari-daihon-cutrange');const r=e.getBoundingClientRect();const row=document.querySelector('.akari-daihon-row[data-caption-id="c-0001"]');return{height:Math.round(r.height),afterRow:row.nextElementSibling===e,labels:[...e.querySelectorAll('.lbl')].map(n=>n.textContent),handles:e.querySelectorAll('.hnd').length,playhead:Boolean(e.querySelector('.ph')),range:Boolean(e.querySelector('.rng')),head:e.querySelector('.h')?.textContent??null}})()`);
    const reading = await readoutNow(cdp);
    assert(metrics.waveform === 'ready', `波形が出ていない: ${JSON.stringify(metrics)}`);
    assert(metrics.openMs <= 300, `エディタ表示が ${metrics.openMs}ms（≤300ms のはず）`);
    assert(geometry.height <= 120, `エディタの高さ ${geometry.height}px（≤120px のはず）`);
    assert(geometry.afterRow, 'エディタが行要素の直後に入っていない');
    assert(geometry.handles === 2 && geometry.playhead && geometry.range, `つまみ/帯/再生ヘッドが足りない: ${JSON.stringify(geometry)}`);
    assert(geometry.labels.length >= 2, `両端の語ラベルが無い: ${JSON.stringify(geometry.labels)}`);
    // 既定 = 無音の頭を 0.15 秒残す
    assert(Math.abs(reading.keep - 0.15) < 0.011, `既定の残しが ${reading.keep} 秒`);
    return { metrics, geometry, readout: reading };
  });
  await shot(cdp, 1, 'silence-editor-open');

  // 2. つまみをドラッグ（可動域の外へ出ない）
  const dragged = await step('2. つまみをドラッグ — 可動域（無音区間）の外へ出ない', async () => {
    const canvas = await rect(cdp, '.akari-daihon-cutrange canvas');
    await dragHandle(cdp, 'f', canvas.left - 60); // 窓の外まで引っ張る
    const clamped = await readoutNow(cdp);
    assert(Math.abs(clamped.keep) < 0.011, `左端クランプ後の残しが ${clamped.keep} 秒（0 のはず）`);
    assert(clamped.from >= opened.readout.from - 0.16, '左端が無音区間より前へ出た');
    await dragHandle(cdp, 'f', canvas.left + canvas.width * 0.55);
    const moved = await readoutNow(cdp);
    assert(moved.from > clamped.from, `つまみが動いていない: ${clamped.text} → ${moved.text}`);
    assert(moved.to - moved.from >= 0.05, `範囲が最小幅を割った: ${moved.text}`);
    return { clampedLeft: clamped, afterDrag: moved };
  });
  await shot(cdp, 2, 'handle-dragged');

  // 3. ✂ 詰める → media item +1・captions.json 不変・commit +1
  const applied = await step('3. ✂ 詰める → edit.json の cut が 1 本増える・captions.json 不変', async () => {
    const beforeCommits = await commitCount();
    const beforeItems = mediaItems(await readFile(editPath, 'utf8'));
    await clickByText(cdp, '.akari-daihon-cutrange .foot', '詰める');
    const after = await waitFile(editPath, source => {
      try { return mediaItems(source).length === beforeItems.length + 1; } catch { return false; }
    }, 'media item +1');
    const items = mediaItems(after);
    assert(await readFile(captionsPath, 'utf8') === originalCaptions, 'captions.json が変わった');
    const commitDelta = (await commitCount()) - beforeCommits;
    assert(commitDelta === 1, `commit が ${commitDelta} 件（1 のはず）`);
    assert(!await evalOn(cdp, `Boolean(document.querySelector('.akari-daihon-cutrange'))`), 'エディタが閉じていない');
    return { before: beforeItems, after: items, commitDelta, cutAt: dragged.afterDrag };
  });

  // 4. 行の下が「✂ …詰めた ✎ 直す ↩」
  await step('4. 詰めたあとに ✂ 詰めた ✎ 直す ↩ が出る', async () => {
    const cell = await waitEval(cdp, `(()=>{const e=document.querySelector('.akari-daihon-cutcell');if(!e)return null;return{text:e.textContent,buttons:[...e.querySelectorAll('button')].map(b=>({label:b.textContent,disabled:b.disabled}))}})()`, { label: 'cutcell' });
    assert(/詰めた/u.test(cell.text), `チップの文言が ${cell.text}`);
    assert(cell.buttons.some(button => button.label.includes('直す') && !button.disabled), `✎ 直すが無い: ${JSON.stringify(cell.buttons)}`);
    assert(cell.buttons.some(button => button.label.includes('戻す') && !button.disabled), `↩ 戻すが無い: ${JSON.stringify(cell.buttons)}`);
    return cell;
  });
  await shot(cdp, 3, 'cut-applied-chip');

  // 5. ✎ 直す → 既存の範囲で開き直す → 範囲を変えて詰め直す（件数不変）
  const revised = await step('5. ✎ 直す → 既存の範囲で開き直し、詰め直しても cut の本数は増えない', async () => {
    await clickByText(cdp, '.akari-daihon-cutcell', '直す');
    await waitEval(cdp, `Boolean(document.querySelector('.akari-daihon-cutrange canvas'))`, { label: '再オープン' });
    const reopened = await readoutNow(cdp);
    assert(Math.abs(reopened.from - applied.cutAt.from) < 0.02 && Math.abs(reopened.to - applied.cutAt.to) < 0.02,
      `既存の範囲で開いていない: ${reopened.text} / 適用は ${applied.cutAt.text}`);
    await shot(cdp, 4, 'reopen-for-edit');
    const canvas = await rect(cdp, '.akari-daihon-cutrange canvas');
    await dragHandle(cdp, 'f', canvas.left + canvas.width * 0.35);
    const next = await readoutNow(cdp);
    assert(Math.abs(next.from - reopened.from) > 0.02, `範囲を変えられていない: ${next.text}`);
    const beforeCommits = await commitCount();
    await clickByText(cdp, '.akari-daihon-cutrange .foot', '詰める');
    const after = await waitFile(editPath, source => {
      try {
        const items = mediaItems(source);
        return items.length === applied.after.length && Math.abs(items[0].out - applied.after[0].out) > 0.02;
      } catch { return false; }
    }, '同じ本数のまま範囲だけ置き換わる');
    const items = mediaItems(after);
    assert(items.length === applied.after.length, `cut が ${applied.after.length} → ${items.length} 本に増減した`);
    const commitDelta = (await commitCount()) - beforeCommits;
    assert(commitDelta === 1, `詰め直しの commit が ${commitDelta} 件（1 のはず）`);
    return { reopened, revisedTo: next, items, commitDelta };
  });

  // 6. ↩ 戻す → edit.json が元に戻る
  await step('6. ↩ 戻す → edit.json が最初のバイトへ戻る', async () => {
    await clickByText(cdp, '.akari-daihon-cutcell', '戻す');
    const after = await waitFile(editPath, source => source === originalEdit, '↩ で復帰');
    assert(mediaItems(after).length === 1, 'cut が 1 本に戻っていない');
    return { editBytesEqualOriginal: after === originalEdit, items: mediaItems(after).length };
  });
  await shot(cdp, 5, 'restored');

  // 7. 単語の ✂ でも同じエディタ（語の前後 0.4 秒）＋ 詰めて ⌘Z で戻る
  await step('7. 単語の ✂ → 同じエディタが語の前後 0.4 秒の可動域で開く・詰めて ⌘Z で戻る', async () => {
    await dragWords(cdp, 'c-0002', 1, 2);
    await waitEval(cdp, `Boolean(document.querySelector('.akari-daihon-wordbar'))`, { label: '浮きバー' });
    await clickByText(cdp, '.akari-daihon-wordbar', '✂');
    await waitEval(cdp, `Boolean(document.querySelector('.akari-daihon-cutrange canvas'))`, { label: '語の範囲エディタ' });
    const head = await evalOn(cdp, `(()=>{const e=document.querySelector('.akari-daihon-cutrange .h');return e?e.textContent:null})()`);
    const initial = await readoutNow(cdp);
    await shot(cdp, 6, 'word-cut-editor');
    // 語は 4.15–5.10。可動域は 前後 0.4 秒（行の 3.65–5.70 に収まる）= 3.75–5.50
    assert(Math.abs(initial.from - 4.15) < 0.02 && Math.abs(initial.to - 5.10) < 0.02,
      `語の発話区間が初期値になっていない: ${initial.text}`);
    const canvas = await rect(cdp, '.akari-daihon-cutrange canvas');
    await dragHandle(cdp, 'f', canvas.left - 80);
    await dragHandle(cdp, 't', canvas.right + 80);
    const widened = await readoutNow(cdp);
    assert(Math.abs(widened.from - 3.75) < 0.03, `左の可動域が ${widened.from}（3.75 のはず）`);
    assert(Math.abs(widened.to - 5.50) < 0.03, `右の可動域が ${widened.to}（5.50 のはず）`);
    const beforeItems = mediaItems(await readFile(editPath, 'utf8')).length;
    await clickByText(cdp, '.akari-daihon-cutrange .foot', '詰める');
    const cut = await waitFile(editPath, source => {
      try { return mediaItems(source).length === beforeItems + 1; } catch { return false; }
    }, '語カットで media item +1');
    await pressUndo(cdp);
    const undone = await waitFile(editPath, source => source === originalEdit, '⌘Z で復帰（履歴 +1）');
    return {
      head, initial, widened, itemsAfterCut: mediaItems(cut).length,
      undoRestoredBytes: undone === originalEdit,
      captionsUnchanged: (await readFile(captionsPath, 'utf8')) === originalCaptions
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
