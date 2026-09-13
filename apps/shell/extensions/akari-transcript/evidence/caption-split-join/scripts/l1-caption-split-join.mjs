#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick, screenshot } from './cdp-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(REPO, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const PROJECT = path.join(ROOT, 'fixture', 'project');
const CAPTIONS = path.join(PROJECT, 'captions.json');
const RUN = path.join(ROOT, 'runs', 'l1');
const RESULTS = path.join(ROOT, 'results.json');
const LOG = path.join(ROOT, 'runs', 'l1.log');
const PORT = Number(process.argv.find(value => value.startsWith('--port='))?.slice(7) ?? 22193);
const S = value => JSON.stringify(value);
const output = { status: 'running', steps: [], screenshots: [], cleanup: null };
const sanitize = value => String(value?.stack || value?.message || value)
  .replaceAll(REPO, '<WORKTREE>')
  .replaceAll(process.env.HOME ?? '~', '<HOME>')
  .replace(/\/(?:private\/)?(?:tmp|var\/folders)\/[^\s)'"]+/gu, '<TMP>')
  .replace(/\/Users\/[^\s)'"]+/gu, '<HOME>');
const save = async () => {
  const temporary = `${RESULTS}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(output, null, 2)}\n`);
  await rename(temporary, RESULTS);
};
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const run = (command, args, cwd = ROOT) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.once('error', reject);
  child.once('close', code => code === 0 ? resolve({ stdout, stderr })
    : reject(new Error(`${command} failed (${code}): ${stderr.slice(-1200)}`)));
});
async function step(name, operation) {
  const record = { name, pass: false };
  output.steps.push(record);
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
async function waitEval(cdp, expression, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try { const value = await evalOn(cdp, expression); if (value) return value; } catch (error) { last = error; }
    await sleep(180);
  }
  throw new Error(`${label} not reached${last ? `: ${sanitize(last)}` : ''}`);
}
async function waitCaptions(predicate, label) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const source = await readFile(CAPTIONS, 'utf8');
    const parsed = JSON.parse(source);
    if (predicate(parsed)) return parsed;
    await sleep(150);
  }
  throw new Error(`${label} not reached`);
}
async function point(cdp, selector) {
  return waitEval(cdp, `(()=>{const e=document.querySelector(${S(selector)});if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return r.width&&r.height?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`, `${selector} visible`);
}
async function settlePreloadOverlay(cdp) {
  const deadline = Date.now() + 120_000;
  let hiddenSince = null;
  while (Date.now() < deadline) {
    const state = await evalOn(cdp, `(()=>{const el=document.querySelector('.theia-preload');return{exists:Boolean(el),hidden:Boolean(el?.classList.contains('theia-hidden'))}})()`);
    if (!state.exists) return 'removed';
    const neutralizedAlready = await evalOn(cdp, `(()=>document.querySelector('.theia-preload')?.style.pointerEvents==='none')()`);
    if (neutralizedAlready) return 'neutralized';
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
async function ensureDaihonVisible(cdp) {
  const probe = `(()=>{const e=document.querySelector('.akari-daihon-row[data-caption-id="c-0002"]');if(!e)return null;const r=e.getBoundingClientRect();return r.width>0&&r.height>0})()`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await evalOn(cdp, probe).catch(() => false)) return true;
    await evalOn(cdp, command('akari.daihon.open')).catch(() => undefined);
    await sleep(600);
  }
  throw new Error('台本パネルが見えない');
}
async function prepareForRealClick(cdp) {
  await settlePreloadOverlay(cdp);
  await ensureDaihonVisible(cdp);
}
async function click(cdp, selector) {
  await prepareForRealClick(cdp);
  const at = await point(cdp, selector);
  await realClick(cdp, at.x, at.y);
}
async function clickText(cdp, container, label) {
  await prepareForRealClick(cdp);
  const at = await waitEval(cdp, `(()=>{const root=document.querySelector(${S(container)});const e=root&&[...root.querySelectorAll('button')].find(b=>b.textContent.includes(${S(label)}));if(!e)return null;const r=e.getBoundingClientRect();return r.width&&r.height?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`, label);
  await realClick(cdp, at.x, at.y);
}
async function shot(cdp, number, name) {
  const file = `${String(number).padStart(2, '0')}-${name}.png`;
  await screenshot(cdp, path.join(ROOT, file));
  output.screenshots.push(file);
  await save();
}
const command = id => `(async()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');if(!C)throw new Error('CommandService binding unavailable');const r=await window.theia.container.get(C).executeCommand(${S(id)});return r!==null&&typeof r==='object'?'[object]':r??null})()`;

let child;
let cdp;
try {
  await rm(path.join(ROOT, 'fixture'), { recursive: true, force: true });
  output.fixture = JSON.parse((await run(process.execPath, [path.join(ROOT, 'scripts', 'gen-fixture.mjs')])).stdout.trim());
  await rm(RUN, { recursive: true, force: true });
  await mkdir(path.join(RUN, 'akari-home'), { recursive: true });
  await mkdir(path.dirname(LOG), { recursive: true });
  await writeFile(LOG, '');
  child = spawn(ELECTRON, [SHELL, PROJECT, `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${RUN}`, '--no-sandbox'], {
    cwd: REPO,
    env: { ...process.env, AKARI_HOME: path.join(RUN, 'akari-home'), THEIA_CONFIG_DIR: RUN },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const append = chunk => void writeFile(LOG, chunk, { flag: 'a' });
  child.stdout.on('data', append); child.stderr.on('data', append);
  let target;
  for (let attempt = 0; attempt < 500 && !target; attempt++) {
    target = await listTargets(PORT).then(items => items.find(item => item.type === 'page')).catch(() => undefined);
    if (!target) await sleep(300);
  }
  assert(target, 'CDP page target did not appear');
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect(); await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await waitEval(cdp, `Boolean(window.theia&&window.theia.container&&document.getElementById('theia-app-shell'))`, 'Theia workbench', 150_000);
  await evalOn(cdp, command('akari.daihon.open'));
  await waitEval(cdp, `document.querySelectorAll('.akari-daihon-row').length===3`, '3 caption rows');
  output.preloadOverlay = await settlePreloadOverlay(cdp);
  await ensureDaihonVisible(cdp);

  const first = await step('1. max_line_units 10 で YouTube が割れない', async () => {
    const value = JSON.parse(await evalOn(cdp, `(()=>{const row=document.querySelector('.akari-daihon-row[data-caption-id="c-0002"]');return JSON.stringify({words:[...row.querySelectorAll('.akari-daihon-word')].map(e=>e.textContent),offsets:[...row.querySelectorAll('.akari-daihon-slash.auto')].map(e=>Number(e.dataset.characterOffset))})})()`));
    const sourceText = '今日はねひたすらYouTubeの撮影を';
    const start = sourceText.indexOf('YouTube');
    assert(value.words.join('') === sourceText, `本文が ${value.words.join('')}`);
    assert(value.offsets.length > 0, '自動の／が無い');
    assert(value.offsets.every(offset => offset <= start || offset >= start + 'YouTube'.length), `YouTube 内の境界: ${value.offsets}`);
    return value;
  });
  await shot(cdp, 1, 'youtube-unsplit');

  await step('2. 自動の／をクリックして境界を 1 個減らし edited=true', async () => {
    await click(cdp, '.akari-daihon-row[data-caption-id="c-0002"] .akari-daihon-slash.auto');
    await clickText(cdp, '.akari-daihon-pop', 'ここの区切りをやめる');
    const parsed = await waitCaptions(root => {
      const row = root.captions.find(item => item.id === 'c-0002');
      return row?.edited === true && Array.isArray(row.display_fragments)
        && row.display_fragments.length === first.offsets.length;
    }, '自動断片の凍結と境界除去');
    const row = parsed.captions.find(item => item.id === 'c-0002');
    assert(row.display_fragments.join('') === row.text, 'display_fragments が本文を復元しない');
    return { fragments: row.display_fragments, edited: row.edited };
  });
  await shot(cdp, 2, 'automatic-break-removed');

  await step('3. 右クリック「次の行と結合」で c-0005 + c-0006 を 1 行にする', async () => {
    await prepareForRealClick(cdp);
    const at = await point(cdp, '.akari-daihon-row[data-caption-id="c-0005"] .akari-daihon-word');
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'right', buttons: 2, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'right', buttons: 0, clickCount: 1 });
    let route = 'context-menu';
    const contextMenuOpened = await waitEval(cdp,
      `Boolean(document.querySelector('.akari-daihon-wordcm'))`, '次の行と結合 context menu', 3_000)
      .then(() => true).catch(() => false);
    if (contextMenuOpened) {
      await clickText(cdp, '.akari-daihon-wordcm', '次の行と結合');
    } else {
      route = 'selection-bar';
      await evalOn(cdp, `(()=>{document.querySelectorAll('.akari-daihon-pop').forEach(node=>node.remove());const row=document.querySelector('.akari-daihon-row[data-caption-id="c-0005"]');if(!row)return false;row.dispatchEvent(new MouseEvent('click',{bubbles:true,metaKey:true}));return true})()`);
      await waitEval(cdp, `(()=>{const b=document.querySelector('button.akari-daihon-selmerge-next');return Boolean(b&&!b.disabled&&b.getBoundingClientRect().width>0)})()`, '選択バー 次の行と結合');
      await click(cdp, 'button.akari-daihon-selmerge-next');
    }
    const parsed = await waitCaptions(root => root.captions.length === 2, '2 行から 1 行への結合');
    const row = parsed.captions.find(item => item.id === 'c-0005');
    const expected = 'これゴールデンウィーク明けにYouTubeで配信する予定なんで';
    assert(row?.text === expected, `結合本文が ${row?.text}`);
    assert(!parsed.captions.some(item => item.id === 'c-0006'), 'c-0006 が残った');
    return { route, rows: parsed.captions.length, id: row.id, text: row.text };
  });
  await shot(cdp, 3, 'merge-next');
  output.status = 'pass';
  await save();
} catch (error) {
  output.status = 'fail'; output.error = sanitize(error); process.exitCode = 1; await save();
} finally {
  cdp?.close();
  const pid = child?.pid;
  if (pid) {
    try { process.kill(pid, 'SIGTERM'); } catch {}
    await sleep(2500);
    try { process.kill(pid, 0); process.kill(pid, 'SIGKILL'); } catch {}
  }
  const sanitizedLog = await readFile(LOG, 'utf8').then(value => sanitize(value)).catch(() => '');
  await writeFile(LOG, sanitizedLog);
  const ps = await run('/bin/ps', ['-eo', 'pid,args']).catch(() => ({ stdout: '' }));
  const survivors = ps.stdout.split('\n').filter(line => line.includes(RUN)).length;
  output.cleanup = { killedPid: pid ?? null, survivingProcesses: survivors };
  if (survivors !== 0) { output.status = 'fail'; process.exitCode = 1; }
  await save();
}
process.stdout.write(`${JSON.stringify({ status: output.status, steps: output.steps.length, screenshots: output.screenshots.length, cleanup: output.cleanup })}\n`);
