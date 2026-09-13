#!/usr/bin/env node
// L1（CDP）— 生成インスペクターのモデル別欄・費用承認・生成中チップを実機観測する。
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick, screenshot } from './cdp-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL_DIR = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(SHELL_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const PROJECT = path.join(ROOT, 'fixture', 'project');
const RESULTS = path.join(ROOT, 'results.json');
const PORT = Number(process.argv.find(value => value.startsWith('--port='))?.slice(7) ?? 22213);
const ISO = path.join(ROOT, 'runs', 'l1');
const LOG = path.join(ROOT, 'runs', 'l1.log');
const FAKE_CLI = path.join(REPO, 'apps', 'shell', 'extensions', 'akari-annotations', 'test', 'fixtures', 'inspector-generation', 'fake-generate.mjs');
const S = value => JSON.stringify(value);
const out = { status: 'running', steps: [], screenshots: [], screenshotDetails: [], cleanup: null };

export const sanitizeText = value => {
  let text = String(value);
  text = text.replaceAll(REPO, '<WORKTREE>');
  if (process.env.HOME) text = text.replaceAll(process.env.HOME, '<HOME>');
  text = text.replaceAll(ISO, '<TMP>');
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

const run = (command, args, { cwd = ROOT, timeoutMs = 240_000 } = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: false });
  let stdout = '', stderr = '', closed = false;
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const timer = setTimeout(() => { if (!closed) child.kill('SIGKILL'); }, timeoutMs);
  child.once('error', reject);
  child.once('close', code => {
    closed = true;
    clearTimeout(timer);
    code === 0 ? resolve({ stdout, stderr })
      : reject(new Error(`${command} failed (${code}): ${stderr.slice(-1600)}`));
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
    try {
      const value = await evalOn(cdp, expression);
      if (value) return value;
    } catch (error) { last = error; }
    await sleep(150);
  }
  throw new Error(`${label} not reached${last ? `: ${sanitize(last)}` : ''}`);
}

async function settlePreloadOverlay(cdp) {
  const deadline = Date.now() + 1_500_000;
  let reloadAt = Date.now() + 300_000;
  let reloads = 0;
  let hiddenSince = null;
  while (Date.now() < deadline) {
    if (Date.now() > reloadAt && reloads < 2) {
      reloads += 1;
      reloadAt = Date.now() + 300_000;
      hiddenSince = null;
      out.preloadReloads = reloads;
      await cdp.send('Page.reload', { ignoreCache: false }).catch(() => {});
      await sleep(3000);
    }
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
const SECTION = '[data-akari-ui="section:inspector-generation"]';
const field = name => `[data-akari-ui="field:inspector-${name}"]`;
const action = name => `[data-akari-ui="action:inspector-generation-actions-${name}"]`;
const sectionSnapshot = `(()=>{const s=document.querySelector(${S(SECTION)});if(!s)return null;
const rows=[...s.querySelectorAll('.akari-inspector-row')].map(r=>({
label:r.querySelector('.akari-inspector-row-label')?.textContent?.trim()||'',
value:r.querySelector('.akari-inspector-row-value')?.textContent?.trim()||'',
input:r.querySelector('.akari-inspector-row-input')?.value||'',className:r.className}));
return{hidden:Boolean(s.querySelector('.akari-inspector-section-body')?.hidden),text:s.textContent,rows}})()`;

const DISMISS_TRANSIENT_UI = `(()=>{let dialogs=0,notifications=0;
for(const dialog of document.querySelectorAll('.dialogBlock')){
const button=[...dialog.querySelectorAll('button')].find(b=>/キャンセル|Cancel|閉じる|Close/u.test(b.textContent||b.getAttribute('aria-label')||''))||dialog.querySelector('.closeButton,.codicon-close');
if(button){button.click();dialogs++}}
for(const overlay of document.querySelectorAll('.dialogOverlay')){overlay.remove();dialogs++}
const notices=[...document.querySelectorAll('.theia-notification-list,.theia-Notification-list,.theia-Notification,.theia-notification-toast')];
for(const notice of notices){
const closes=[...notice.querySelectorAll('button,[role="button"]')].filter(b=>/close|閉じる/u.test(b.getAttribute('aria-label')||b.getAttribute('title')||'')||b.classList.contains('codicon-close'));
for(const close of closes){close.click();notifications++}
notice.style.setProperty('display','none','important')}
return{dialogs,notifications,noticeContainers:notices.length}})()`;

async function dismissTransientUi(cdp, attempts = 5) {
  let total = { dialogs: 0, notifications: 0, noticeContainers: 0 };
  for (let attempt = 0; attempt < attempts; attempt++) {
    const result = await evalOn(cdp, DISMISS_TRANSIENT_UI).catch(() => null);
    if (result) total = {
      dialogs: total.dialogs + result.dialogs,
      notifications: total.notifications + result.notifications,
      noticeContainers: Math.max(total.noticeContainers, result.noticeContainers)
    };
    await sleep(400);
  }
  return total;
}

async function ensureInspectorVisible(cdp) {
  await evalOn(cdp, command('akari.inspector.open')).catch(() => null);
  const visible = await waitEval(cdp,
    `(()=>{const e=document.querySelector('[data-akari-ui="panel:inspector"]');return Boolean(e&&e.offsetParent!==null)})()`,
    { label: 'visible inspector panel', timeoutMs: 60_000 }).then(() => true).catch(() => false);
  if (!visible) {
    const clicked = await evalOn(cdp, `(()=>{const candidates=[
...document.querySelectorAll('.p-TabBar-tab[title*="インスペクター"],.lm-TabBar-tab[title*="インスペクター"],[aria-label*="インスペクター"]'),
...document.querySelectorAll('.codicon-inspect')].map(e=>e.closest('.p-TabBar-tab,.lm-TabBar-tab,button,[role="tab"]')||e);
const target=candidates.find(e=>e instanceof HTMLElement&&e.offsetParent!==null);if(!target)return false;target.click();return true})()`);
    assert(clicked, '右レールのインスペクターアイコンが見つからない');
  }
  await waitEval(cdp,
    `(()=>{const e=document.querySelector('[data-akari-ui="panel:inspector"]');return Boolean(e&&e.offsetParent!==null)})()`,
    { label: 'inspector panel foreground', timeoutMs: 600_000 });
}

async function ensureSection(cdp) {
  const section = await waitEval(cdp, sectionSnapshot, { label: '生成セクション', timeoutMs: 600_000 });
  if (section.hidden) {
    const toggled = await evalOn(cdp, `(()=>{const s=document.querySelector(${S(SECTION)});const body=s?.querySelector('.akari-inspector-section-body');if(!s||!body)return false;if(!body.hidden)return true;const toggle=s.querySelector('.akari-inspector-section-toggle');if(!toggle)return false;toggle.click();return true})()`);
    assert(toggled, '生成セクションのトグルが見つからない');
    await waitEval(cdp, `(()=>{const body=document.querySelector(${S(SECTION)})?.querySelector('.akari-inspector-section-body');return Boolean(body&&!body.hidden)})()`, { label: '生成セクション展開', timeoutMs: 600_000 });
  }
  await evalOn(cdp, `(()=>{const s=document.querySelector(${S(SECTION)});if(!s)return false;s.scrollIntoView({block:'start'});return true})()`);
}

async function chooseModel(cdp, modelId) {
  const changed = await evalOn(cdp, `(()=>{const e=document.querySelector(${S(field('generation-model'))});if(!e)return null;
const o=[...e.options].find(x=>x.title===${S(modelId)});if(!o)return{error:'option not found',titles:[...e.options].map(x=>x.title)};
e.value=o.value;e.dispatchEvent(new Event('change',{bubbles:true}));return{value:o.value,title:o.title}})()`);
  assert(changed && !changed.error, `モデル ${modelId} を選べない: ${JSON.stringify(changed)}`);
  await waitEval(cdp, `(()=>{const e=document.querySelector(${S(field('generation-model'))});return e?.selectedOptions?.[0]?.title===${S(modelId)}})()`, { label: `${modelId} 選択`, timeoutMs: 600_000 });
  await sleep(500);
  await ensureSection(cdp);
  return changed.value;
}

async function shot(cdp, name) {
  const destination = path.join(ROOT, name);
  for (let attempt = 1; attempt <= 3; attempt++) {
    await ensureInspectorVisible(cdp);
    await ensureSection(cdp);
    await screenshot(cdp, destination);
    const state = await evalOn(cdp, `(()=>{const panel=document.querySelector('[data-akari-ui="panel:inspector"]');const section=${sectionSnapshot};const body=document.querySelector(${S(SECTION)})?.querySelector('.akari-inspector-section-body');return{
inspectorFront:Boolean(panel&&panel.offsetParent!==null),
sectionVisible:Boolean(section&&body&&!body.hidden&&body.offsetParent!==null),
modelRow:section?.rows.find(row=>row.label==='モデル')?.input||''}})()`);
    if (state.inspectorFront && state.sectionVisible) {
      const sha256 = createHash('sha256').update(await readFile(destination)).digest('hex');
      out.screenshots.push(name);
      out.screenshotDetails.push({
        name,
        sha256,
        inspectorFront: true,
        sectionVisible: true,
        modelRow: state.modelRow
      });
      await save();
      return;
    }
  }
  throw new Error(`${name}: インスペクター前面・生成セクション可視の状態で 3 回撮影できなかった`);
}

let spawnedChild;
async function launch() {
  await rm(ISO, { recursive: true, force: true });
  await mkdir(path.join(ISO, 'akari-home'), { recursive: true });
  await mkdir(path.join(ISO, 'theia-config'), { recursive: true });
  await mkdir(path.join(ISO, 'user-data'), { recursive: true });
  await mkdir(path.join(ROOT, 'runs'), { recursive: true });
  await writeFile(LOG, '');
  const child = spawn(ELECTRON, [
    SHELL_DIR, PROJECT, `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${path.join(ISO, 'user-data')}`, '--no-sandbox'
  ], {
    cwd: REPO,
    env: {
      ...process.env,
      AKARI_HOME: path.join(ISO, 'akari-home'),
      THEIA_CONFIG_DIR: path.join(ISO, 'theia-config'),
      AKARI_GENERATE_CLI: FAKE_CLI
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false
  });
  spawnedChild = child;
  const append = chunk => void writeFile(LOG, sanitizeText(chunk), { flag: 'a' }).catch(() => {});
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  let target;
  const deadline = Date.now() + 600_000;
  while (Date.now() < deadline && !target) {
    try { target = (await listTargets(PORT)).find(item => item.type === 'page'); } catch {}
    if (!target) await sleep(300);
  }
  assert(target, 'CDP page target did not appear');
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await waitEval(cdp, `Boolean(window.theia&&window.theia.container&&document.getElementById('theia-app-shell'))`, {
    label: 'Theia workbench', timeoutMs: 1_500_000
  });
  return { child, cdp };
}

async function processCount(fragment) {
  return new Promise(resolve => {
    const child = spawn('/bin/sh', ['-c', `ps -eo pid,ppid,args | grep -F ${JSON.stringify(fragment)} | grep -v grep | wc -l`], {
      stdio: ['ignore', 'pipe', 'ignore'], detached: false
    });
    let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.once('close', () => resolve(Number(stdout.trim())));
  });
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
  const survivors = await processCount(ISO);
  const backendSurvivors = await processCount(path.join(SHELL_DIR, 'lib', 'backend', 'main.js'));
  try { await writeFile(LOG, sanitizeText(await readFile(LOG, 'utf8'))); } catch {}
  out.cleanup = {
    killedPid: pid ?? null,
    survivingProcesses: survivors,
    survivingBackendMain: backendSurvivors,
    alive: pid ? (() => { try { process.kill(pid, 0); return 1; } catch { return 0; } })() : 0
  };
  await save();
  return survivors + out.cleanup.alive;
}

let session;
try {
  out.fixture = JSON.parse((await run(process.execPath, [path.join(ROOT, 'scripts', 'gen-fixture.mjs')])).stdout.trim());
  const editPath = path.join(PROJECT, 'edit.json');
  const captionsPath = path.join(PROJECT, 'captions.json');
  const mtimesBefore = { edit: (await stat(editPath)).mtimeMs, captions: (await stat(captionsPath)).mtimeMs };
  await save();

  session = await launch();
  const { cdp } = session;
  out.preloadOverlay = await settlePreloadOverlay(cdp);
  out.dismissedAtStartup = await dismissTransientUi(cdp);

  // 保存レイアウトからタイムラインが自力で復元されるのを先に待つ。open は最後の fallback だけ。
  const restoredTimeline = await waitEval(cdp,
    `Boolean(document.querySelector('[data-akari-ui="timeline:cut:0"]'))`,
    { label: 'restored timeline', timeoutMs: 60_000 }).then(() => true).catch(() => false);
  if (!restoredTimeline) {
    await evalOn(cdp, command('akari.annotations.open'));
    await dismissTransientUi(cdp);
  }
  const clipRect = await waitEval(cdp, `(()=>{const e=document.querySelector('[data-akari-ui="timeline:cut:0"]');if(!e)return null;const r=e.getBoundingClientRect();return r.width>0&&r.height>0?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`, {
    label: 'clip-a timeline chip', timeoutMs: 600_000
  });
  await realClick(cdp, clipRect.x, clipRect.y);
  await ensureInspectorVisible(cdp);
  await ensureSection(cdp);

  await step('1. H3 は受ける欄だけ・常時音声・見積を表示する', async () => {
    await chooseModel(cdp, 'fal:h3-i2v');
    const view = await waitEval(cdp, `(()=>{const v=${sectionSnapshot};return v&&v.rows.some(r=>r.label==='音声'&&r.value==='常に付く・既定 mute')?v:null})()`, { label: 'H3 fields', timeoutMs: 600_000 });
    assert(!view.rows.some(row => row.label === 'negative prompt'), 'H3 に negative prompt 欄がある');
    assert(!view.rows.some(row => row.label.startsWith('参照画像')), 'H3 に参照画像欄がある');
    assert(view.rows.some(row => row.label === '音声' && row.value === '常に付く・既定 mute'), 'H3 の常時音声表示がない');
    assert(view.rows.some(row => row.className.includes('akari-inspector-generation-estimate') && /\$/.test(row.value) && /as_of/.test(row.value)), 'H3 の見積に $ / as_of がない');
    return view;
  });
  await dismissTransientUi(cdp, 2);
  await shot(cdp, '01-model-h3.png');

  await step('2. Kling standard は negative prompt・上限なし参照画像・見積不可を表示する', async () => {
    await chooseModel(cdp, 'fal:kling-v3-standard-i2v');
    const view = await waitEval(cdp, `(()=>{const v=${sectionSnapshot};return v&&Boolean(document.querySelector(${S(field('negative-prompt'))}))&&Boolean(document.querySelector(${S(field('reference_images'))}))?v:null})()`, { label: 'Kling fields', timeoutMs: 600_000 });
    assert(view.rows.some(row => row.label === 'negative prompt'), 'Kling に negative prompt 欄がない');
    const references = view.rows.find(row => row.label.startsWith('参照画像'));
    assert(references && references.label === '参照画像', `Kling 参照画像に N / max が付いた: ${references?.label}`);
    assert(view.rows.some(row => row.className.includes('akari-inspector-generation-estimate') && row.value.includes('見積不可')), 'Kling が見積不可でない');
    return view;
  });
  await dismissTransientUi(cdp, 2);
  await shot(cdp, '02-model-kling.png');

  await step('3. Veo FLF は最後のフレームと 6 秒 → 8 秒の正規化を表示する', async () => {
    await chooseModel(cdp, 'fal:veo-3.1-flf');
    const view = await waitEval(cdp, `(()=>{const v=${sectionSnapshot};return v&&Boolean(document.querySelector(${S(field('last_frame'))}))&&v.rows.some(r=>r.value==='6 秒 → 8 秒')?v:null})()`, { label: 'Veo fields and duration', timeoutMs: 600_000 });
    assert(view.rows.some(row => row.label === '最後のフレーム'), 'Veo に最後のフレーム欄がない');
    assert(view.rows.some(row => row.className.includes('akari-inspector-generation-warning') && row.value === '6 秒 → 8 秒'), 'Veo の尺丸め表示がない');
    return view;
  });
  await dismissTransientUi(cdp, 2);
  await shot(cdp, '03-model-veo.png');

  await step('4. 動画にするは金額・as_of・model id 付き費用承認を開く', async () => {
    await chooseModel(cdp, 'fal:h3-i2v');
    const clicked = await evalOn(cdp, `(()=>{const b=document.querySelector(${S(action('generate'))});if(!b||b.disabled)return false;b.click();return true})()`);
    assert(clicked, '動画にするボタンを押せない');
    const dialog = await waitEval(cdp, `(()=>{const dialogs=[...document.querySelectorAll('.dialogBlock,.p-Widget.dialogOverlay')];const d=dialogs.find(e=>(e.textContent||'').includes('費用承認'));return d?{text:String(d.textContent||''),title:String(d.querySelector('.dialogTitle,.p-Dialog-title')?.textContent||'')}:null})()`, { label: '費用承認 dialog', timeoutMs: 600_000 });
    assert(dialog.title.includes('費用承認') || dialog.text.includes('費用承認'), 'ダイアログタイトルが費用承認でない');
    assert(/\$\d/.test(dialog.text), '費用承認本文に金額がない');
    assert(dialog.text.includes('as_of 2026-09-12'), '費用承認本文に as_of がない');
    assert(dialog.text.includes('fal:h3-i2v'), '費用承認本文に model id がない');
    return dialog;
  });
  await shot(cdp, '04-cost-approval-dialog.png');

  await step('5. 費用承認後に偽 CLI が走りタイムラインチップが generating になる', async () => {
    const approved = await evalOn(cdp, `(()=>{const dialogs=[...document.querySelectorAll('.dialogBlock,.p-Widget.dialogOverlay')];const d=dialogs.find(e=>(e.textContent||'').includes('費用承認'));const b=d&&[...d.querySelectorAll('button')].find(x=>(x.textContent||'').includes('費用承認する'));if(!b)return false;b.click();return true})()`);
    assert(approved, '費用承認ボタンが見つからない');
    const state = await waitEval(cdp, `(()=>{const e=document.querySelector('[data-akari-ui="timeline:cut:0"]');return e?.dataset.akariGenerationState==='generating'?{state:String(e.dataset.akariGenerationState),badge:String(e.querySelector('[data-akari-generation-badge]')?.textContent||'')}:null})()`, { label: 'clip-a generating', timeoutMs: 600_000 });
    assert(state.state === 'generating', `生成状態が generating でない: ${state.state}`);
    return state;
  });
  await dismissTransientUi(cdp, 2);
  await shot(cdp, '05-timeline-chip-generating.png');

  await step('6. edit.json / captions.json の mtime は全手順で不変', async () => {
    const mtimesAfter = { edit: (await stat(editPath)).mtimeMs, captions: (await stat(captionsPath)).mtimeMs };
    assert(mtimesAfter.edit === mtimesBefore.edit, `edit.json mtime changed: ${mtimesBefore.edit} -> ${mtimesAfter.edit}`);
    assert(mtimesAfter.captions === mtimesBefore.captions, `captions.json mtime changed: ${mtimesBefore.captions} -> ${mtimesAfter.captions}`);
    return { mtimesBefore, mtimesAfter };
  });

  await step('7. SS 5 枚の SHA256 が相異なる', async () => {
    const sha256s = out.screenshotDetails.map(detail => detail.sha256);
    const distinct = sha256s.length === 5 && new Set(sha256s).size === 5;
    assert(distinct, `SS 5 枚の SHA256 が相異ならない: count=${sha256s.length}, distinct=${new Set(sha256s).size}`);
    return { count: sha256s.length, sha256s, distinct: true };
  });

  // 偽 CLI は generating の 3 秒後に done を書いて正常終了する。Electron の子を残さないよう待つ。
  await sleep(3500);
  out.status = 'pass';
  await save();
} catch (error) {
  out.status = 'fail';
  out.error = sanitize(error);
  try {
    if (session?.cdp) {
      out.diagnostic = {
        sectionSnapshot: await evalOn(session.cdp, sectionSnapshot).catch(diagnosticError => ({
          error: sanitize(diagnosticError)
        })),
        inspectorFields: await evalOn(session.cdp, `(()=>[...document.querySelectorAll('[data-akari-ui^="field:inspector-"]')].map(e=>String(e.getAttribute('data-akari-ui')||'')))()`).catch(diagnosticError => [
          `diagnostic error: ${sanitize(diagnosticError)}`
        ])
      };
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
    out.status = 'fail';
    out.cleanupError = `surviving processes: ${survivors}`;
    await save();
    process.exitCode = 1;
  }
}
