#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick, screenshot } from '../../daihon-display-knobs/scripts/cdp-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const PROJECT = path.join(ROOT, 'fixture', 'project');
const CAPTIONS = path.join(PROJECT, 'captions.json');
const EDIT = path.join(PROJECT, 'edit.json');
const RESULTS = path.join(ROOT, 'results.json');
// Electron のプロファイルと AKARI_HOME はレーン規律どおり一時ディレクトリへ置く
// （worktree 内に置くとワークスペース側の watcher と噛み合って renderer が落ちる実測があった）。
const ISO = path.join(tmpdir(), 'akari-l1-caption-policy-fail-open');
const PORT = Number(process.argv.find(value => value.startsWith('--port='))?.slice(7) ?? 22173);
const out = { status: 'running', steps: [], screenshots: [], cleanup: null };
const S = value => JSON.stringify(value);

const sanitize = value => String(value?.stack || value?.message || value)
  .replaceAll(REPO, '<WORKTREE>')
  .replace(/\/(?:private\/)?(?:tmp|var\/folders)\/[^\s)'"\]]+/gu, '<TMP>')
  .replace(/\/Users\/[^\s)'"\]]+/gu, '<HOME>');
async function save() {
  const temporary = `${RESULTS}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(out, null, 2)}\n`);
  await rename(temporary, RESULTS);
}
const trace = (...parts) => process.stderr.write(`[l1] ${parts.join(' ')}
`);
function assert(condition, message) { if (!condition) throw new Error(message); }
function run(command, args, cwd = REPO) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`${command} failed (${code}): ${stderr.slice(-1200)}`)));
  });
}
async function waitEval(cdp, expression, label, contextId, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      const value = await evalOn(cdp, expression, contextId);
      if (value) return value;
    } catch (error) { last = error; }
    await sleep(200);
  }
  throw new Error(`${label} not reached${last ? `: ${sanitize(last)}` : ''}`);
}
async function waitCaptions(predicate, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = JSON.parse(await readFile(CAPTIONS, 'utf8'));
    if (predicate(value)) return value;
    await sleep(150);
  }
  throw new Error(`${label} not reached`);
}
const command = (id, request) => `(async()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');if(!C)throw new Error('CommandService unavailable');await window.theia.container.get(C).executeCommand(${S(id)}${request === undefined ? '' : `,${S(request)}`});return true})()`;

async function makeFixture() {
  const fixture = path.join(REPO, 'packages', 'edit-store', 'test', 'fixtures', 'caption-policy-fail-open');
  const captions = JSON.parse(await readFile(path.join(fixture, 'captions-max10.json'), 'utf8'));
  const edit = JSON.parse(await readFile(path.join(fixture, 'edit.json'), 'utf8'));
  captions.display_policy.max_line_units = 18;
  captions.captions.push({
    id: 'c-overflow', src: 'src-1', start: 25.86, end: 26.3,
    text: 'あ'.repeat(70), speaker: null, sourceRef: { segment: 8 }, edited: false,
    words: [{ start: 25.86, end: 26.3, text: 'あ'.repeat(70) }]
  });
  await rm(path.join(ROOT, 'fixture'), { recursive: true, force: true });
  const media = path.join(PROJECT, edit.sources[0].path);
  await mkdir(path.dirname(media), { recursive: true });
  await writeFile(CAPTIONS, `${JSON.stringify(captions, null, 2)}\n`);
  await writeFile(EDIT, `${JSON.stringify(edit, null, 2)}\n`);
  const ffmpeg = path.join(REPO, 'packages/media-bin/vendor/darwin-arm64/ffmpeg');
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=#27313f:s=640x360:r=30',
    '-t', '26.4', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '42', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', media]);
  await run('/usr/bin/git', ['init'], PROJECT);
  await run('/usr/bin/git', ['config', 'user.email', 'caption-policy-fixture@localhost'], PROJECT);
  await run('/usr/bin/git', ['config', 'user.name', 'Caption Policy Fixture'], PROJECT);
  await run('/usr/bin/git', ['add', 'captions.json', 'edit.json'], PROJECT);
  await run('/usr/bin/git', ['commit', '-m', 'caption policy fixture'], PROJECT);
}

async function connectInner() {
  const targets = (await listTargets(PORT)).filter(target => target.type === 'iframe'
    && /webview\/index\.html/u.test(String(target.url)) && target.webSocketDebuggerUrl);
  for (const target of targets) {
    const cdp = new CDP(target.webSocketDebuggerUrl);
    const contexts = [];
    cdp.on('Runtime.executionContextCreated', params => contexts.push(params.context));
    try {
      await cdp.connect();
      await cdp.send('Page.enable');
      await cdp.send('Runtime.enable');
      await sleep(400);
      const tree = await cdp.send('Page.getFrameTree');
      const context = contexts.find(value => value.auxData?.frameId !== tree.frameTree.frame.id);
      if (context && await evalOn(cdp, 'window.__akariPreview?.captions?.length ?? 0', context.id)) {
        return { cdp, contextId: context.id };
      }
    } catch {}
    cdp.close();
  }
  return null;
}

async function observeCaption(top, time, expected) {
  const editUri = pathToFileURL(EDIT).toString();
  await evalOn(top, command('akari.preview.ensureVisible', { editUri }));
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    await evalOn(top, command('akari.preview.seekOutput', { editUri, time })).catch(() => {});
    const inner = await connectInner().catch(() => null);
    if (inner) {
      try {
        const value = await evalOn(inner.cdp, `(()=>{const plateText=plate=>{if(!plate)return null;const lines=[...plate.querySelectorAll('.akari-caption__line')].map(node=>node.textContent).join('');if(lines)return lines;return [...plate.childNodes].filter(node=>node.nodeName!=='STYLE').map(node=>node.textContent).join('')};const cues=window.__akariPreview?.captions??[];const parts=cues.filter(c=>(c.sourceCueId??c.source_cue_id)==='c-0002');const plate=document.getElementById('caption-plate');return plateText(plate)===${S(expected)}?{captionCount:cues.length,parts:parts.map(c=>c.text),text:plateText(plate)}:null})()`, inner.contextId);
        if (value) return value;
      } finally { inner.cdp.close(); }
    }
    await sleep(350);
  }
  throw new Error(`preview caption ${expected} was not observed`);
}

async function observeLegacyFallback(top, expected) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const inner = await connectInner().catch(() => null);
    if (inner) {
      try {
        const value = await evalOn(inner.cdp, `(()=>{const plateText=plate=>{if(!plate)return null;const lines=[...plate.querySelectorAll('.akari-caption__line')].map(node=>node.textContent).join('');if(lines)return lines;return [...plate.childNodes].filter(node=>node.nodeName!=='STYLE').map(node=>node.textContent).join('')};const cues=window.__akariPreview?.captions??[];const plate=document.getElementById('caption-plate');const text=plateText(plate)??'';return text.includes(${S(expected)})?{captionCount:cues.length,text}:null})()`, inner.contextId);
        if (value) return value;
      } finally { inner.cdp.close(); }
    }
    await sleep(350);
  }
  throw new Error('legacy fallback caption DOM was not observed');
}

async function addUnsupportedTransition(top) {
  const edit = JSON.parse(await readFile(EDIT, 'utf8'));
  const source = edit?.tracks?.[0]?.items?.[0]?.source;
  assert(source && typeof source === 'object', 'v2 media source was not found');
  source.transition_out = { type: 'dissolve', duration: 0.2 };
  const text = `${JSON.stringify(edit, null, 2)}\n`;
  const temporary = `${EDIT}.tmp-${process.pid}`;
  await writeFile(temporary, text);
  await rename(temporary, EDIT);
  const editUri = pathToFileURL(EDIT).toString();
  await evalOn(top, `(()=>{window.dispatchEvent(new CustomEvent('akari.editStore.didWrite',{detail:{uri:${S(editUri)},content:${S(text)}}}));return true})()`);
  return source.transition_out;
}

// 表示ポップは 1 回のクリックでは開かないことがある（daihon-display-knobs の L1 と同じ実測）。
// ボタンを見える位置へ送り、開かなければ残骸を掃除して 6 回まで叩き直す（奇数回 = 実クリック / 偶数回 = DOM click）。
// Theia は起動直後にワークスペース確定で 1 度リロードすることがあり、
// そのとき先に掴んだ page target の実行コンテキストが死ぬ（実測: Cannot find context with specified id）。
// 表示ポップを開くところで必ず踏むので、コンテキスト喪失を検出したら page target を取り直す。
async function reconnectTop() {
  try { top?.close(); } catch { /* 既に閉じている */ }
  let target;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline && !target) {
    try { target = (await listTargets(PORT)).find(item => item.type === 'page'); } catch { /* 起動途中 */ }
    if (!target) await sleep(300);
  }
  if (!target) throw new Error('page target disappeared');
  top = new CDP(target.webSocketDebuggerUrl);
  await top.connect();
  await top.send('Page.enable');
  await top.send('Runtime.enable');
  await waitEval(top, `Boolean(window.theia&&window.theia.container&&document.getElementById('theia-app-shell'))`, 'Theia workbench (reconnect)', undefined, 120_000);
  await evalOn(top, command('akari.daihon.open')).catch(() => { /* 既に開いている */ });
  await waitEval(top, `document.querySelectorAll('.akari-daihon-row').length===9`, 'nine caption rows (reconnect)', undefined, 90_000);
}

const CONTEXT_LOST = /Cannot find context|Inspected target navigated|Session with given id not found|Target closed/u;

async function openDisplayPop() {
  let last;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const point = await waitEval(top, `(()=>{const b=document.querySelector('.akari-daihon-display');if(!b)return null;const r=b.getBoundingClientRect();return r.width>0&&r.height>0?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`, 'display button', undefined, 15_000);
      if (attempt % 2 === 1) await realClick(top, point.x, point.y);
      else await evalOn(top, `(()=>{document.querySelector('.akari-daihon-display').click();return true})()`);
      await waitEval(top, `Boolean(document.querySelector('.akari-daihon-pop input[type=\"range\"]'))`, `display popover attempt ${attempt}`, undefined, 8_000);
      return;
    } catch (error) {
      last = error;
      trace('openDisplayPop attempt', attempt, 'failed:', String(error?.message ?? error).slice(0, 160));
      if (CONTEXT_LOST.test(String(error?.message ?? error))) await reconnectTop();
      else await evalOn(top, `(()=>{document.body.querySelectorAll('.akari-daihon-pop').forEach(node=>node.remove());return true})()`).catch(() => { /* 掃除は best effort */ });
      await sleep(300);
    }
  }
  throw new Error(`display popover not reached after 6 attempts: ${sanitize(last)}`);
}

async function shot(cdp, name) {
  await screenshot(cdp, path.join(ROOT, name));
  out.screenshots.push(name);
  await save();
}

let child;
let top;
let electronExit = null;
let electronLog = '';
try {
  await makeFixture();
  await rm(ISO, { recursive: true, force: true });
  await mkdir(path.join(ISO, 'akari-home'), { recursive: true });
  child = spawn(ELECTRON, [SHELL, PROJECT, `--remote-debugging-port=${PORT}`, `--user-data-dir=${ISO}`, '--no-sandbox'], {
    cwd: REPO,
    env: { ...process.env, AKARI_HOME: path.join(ISO, 'akari-home'), THEIA_CONFIG_DIR: ISO },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', chunk => { electronLog += chunk; });
  child.stderr.on('data', chunk => { electronLog += chunk; });
  child.once('exit', (code, signal) => { electronExit = { code, signal }; });
  const target = await (async () => {
    const deadline = Date.now() + 150_000;
    while (Date.now() < deadline) {
      const value = await listTargets(PORT).then(items => items.find(item => item.type === 'page')).catch(() => null);
      if (value) return value;
      if (electronExit) return null;
      await sleep(300);
    }
    return null;
  })();
  assert(target, `CDP page target did not appear; electron=${JSON.stringify(electronExit)} ${sanitize(electronLog.slice(-800))}`);
  top = new CDP(target.webSocketDebuggerUrl);
  await top.connect();
  await top.send('Page.enable');
  await top.send('Runtime.enable');
  await waitEval(top, `Boolean(window.theia&&window.theia.container&&document.getElementById('theia-app-shell'))`, 'Theia workbench');
  await evalOn(top, command('akari.daihon.open'));
  await waitEval(top, `document.querySelectorAll('.akari-daihon-row').length===9`, 'nine caption rows');
  trace('nine rows ready');

  const first = { name: '10 字へ変更して overflow 件数と QC チップを確認' };
  out.steps.push(first);
  trace('opening display popover');
  await openDisplayPop();
  trace('display popover open');
  await evalOn(top, `(()=>{const input=document.querySelector('.akari-daihon-pop input[type="range"]');input.value='10';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await waitCaptions(value => value.display_policy?.max_line_units === 10, 'max_line_units=10');
  await waitEval(top, `(()=>{const pop=document.querySelector('.akari-daihon-pop')?.textContent??'';const chip=[...document.querySelectorAll('.akari-daihon-badge-qc')].find(n=>n.textContent==='10 字に収まらない');return pop.includes('収まらない行: 1')&&chip?true:null})()`, 'overflow count and QC chip');
  await evalOn(top, `document.querySelector('.akari-daihon-row[data-caption-id="c-overflow"]')?.scrollIntoView({block:'center'})`);
  first.pass = true;
  first.detail = { maxLineUnits: 10, overflowRows: 1, chip: '10 字に収まらない' };
  await shot(top, '01-max10-overflow-qc.png');

  const second = { name: '分割された前半がプレビューに出る' };
  out.steps.push(second);
  second.detail = await observeCaption(top, 3.0, '今日はひたすら');
  second.pass = true;
  await shot(top, '02-preview-first-fragment.png');

  const third = { name: '分割された後半へ順に切り替わる' };
  out.steps.push(third);
  third.detail = await observeCaption(top, 4.2, 'YouTubeの撮影を');
  third.pass = true;
  await shot(top, '03-preview-second-fragment.png');

  const fourth = { name: 'RPC throw でも legacy 字幕を描き warn を 1 回だけ出す' };
  out.steps.push(fourth);
  const warningText = '字幕の表示設定を解決できないため、設定を無視して表示しています';
  const notificationsBefore = await evalOn(top, `([...document.querySelectorAll('.theia-notification-message')].filter(node=>node.textContent.includes(${S(warningText)})).length)`);
  assert(notificationsBefore === 0, `fallback warning already existed: ${notificationsBefore}`);
  const transitionOut = await addUnsupportedTransition(top);
  const notification = await waitEval(top, `(()=>{const items=[...document.querySelectorAll('.theia-notification-list-item')].filter(node=>node.textContent.includes(${S(warningText)}));return items.length===1?{count:items.length,text:items[0].textContent}:null})()`, 'one fallback warning');
  const preview = await observeLegacyFallback(top, '今日はひたすらYouTubeの撮影を');
  fourth.detail = { transitionOut, notification, preview };
  fourth.pass = true;
  await shot(top, '04-rpc-throw-fallback.png');

  out.status = 'pass';
  await save();
} catch (error) {
  out.status = 'fail';
  out.error = sanitize(error);
  await save().catch(() => {});
  process.exitCode = 1;
} finally {
  top?.close();
  const pid = child?.pid ?? null;
  if (child) {
    child.kill('SIGTERM');
    await Promise.race([new Promise(resolve => child.once('close', resolve)), sleep(5000)]);
    try { process.kill(child.pid, 0); child.kill('SIGKILL'); } catch {}
  }
  out.cleanup = { killedPid: pid };
  await save().catch(() => {});
}
