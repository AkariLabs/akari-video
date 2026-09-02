#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick, realDrag, screenshot } from './cdp-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const FIXTURE = path.join(ROOT, 'fixture');
const RESULTS = path.join(ROOT, 'results.json');
const BASE_PORT = Number(process.argv.find(value => value.startsWith('--port='))?.slice(7) ?? 21972);
const out = { status: 'running', steps: [], screenshots: [], fixtures: {} };
const S = value => JSON.stringify(value);
const sanitize = value => String(value?.stack || value?.message || value)
  .replaceAll(REPO, '<worktree>')
  .replace(/\/Users\/[^\s)]+/g, '<machine-path>')
  .replace(/\/private\/tmp\/[^\s)]+/g, '<machine-path>');
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

async function step(fixture, name, operation) {
  const record = { fixture, name, pass: false };
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

async function waitEval(cdp, expression, { timeoutMs = 90_000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      const value = await evalOn(cdp, expression);
      if (value) return value;
    } catch (error) { last = error; }
    await sleep(180);
  }
  throw new Error(`${label} not reached${last ? `: ${sanitize(last)}` : ''}`);
}

async function settlePreloadOverlay(cdp) {
  const deadline = Date.now() + 120_000;
  let hiddenSince = null;
  while (Date.now() < deadline) {
    const state = await evalOn(cdp, `(()=>{const el=document.querySelector('.theia-preload');return{exists:Boolean(el),hidden:Boolean(el?.classList.contains('theia-hidden'))}})()`);
    if (!state.exists) return 'removed';
    if (state.hidden) {
      hiddenSince ??= Date.now();
      if (Date.now() - hiddenSince >= 20_000) {
        const neutralized = await evalOn(cdp, `(()=>{const el=document.querySelector('.theia-preload');if(!el||!el.classList.contains('theia-hidden'))return false;el.style.pointerEvents='none';return true})()`);
        if (neutralized) return 'neutralized';
      }
    } else {
      hiddenSince = null;
    }
    await sleep(200);
  }
  throw new Error('theia preload overlay did not settle');
}

async function waitFile(read, predicate, label) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await sleep(150);
  }
  throw new Error(`${label} not reached`);
}

async function launch(project, port, runName) {
  const iso = path.join(ROOT, 'runs', runName);
  const log = path.join(ROOT, 'runs', `${runName}.log`);
  const launched = await run('/bin/zsh', [path.join(ROOT, 'scripts', 'launch-shell.sh'), project, String(port), iso, log], { timeoutMs: 20_000 });
  const pid = Number(launched.stdout.trim().split(/\s+/).at(-1));
  assert(Number.isInteger(pid) && pid > 0, 'Electron PID was not reported');
  let target;
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline && !target) {
    try { target = (await listTargets(port)).find(item => item.type === 'page'); } catch {}
    if (!target) await sleep(300);
  }
  assert(target, 'CDP page target did not appear');
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await waitEval(cdp, `Boolean(window.theia&&window.theia.container&&document.getElementById('theia-app-shell'))`, { label: 'Theia workbench' });
  return { pid, cdp };
}

async function stop(session) {
  session?.cdp?.close();
  if (session?.pid) {
    try { process.kill(session.pid, 'SIGTERM'); } catch {}
    await sleep(1800);
  }
}

const command = id => `(async()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');if(!C)throw new Error('CommandService binding unavailable');const r=await window.theia.container.get(C).executeCommand(${S(id)});return r!==null&&typeof r==='object'?'[object]':r??null})()`;
const file = (project, name) => path.join(project, name);
const readText = pathName => readFile(pathName, 'utf8');
const readJson = async pathName => JSON.parse(await readText(pathName));
const commitCount = async project => Number((await run('/usr/bin/git', ['rev-list', '--count', 'HEAD'], { cwd: project })).stdout.trim());

async function clickSelector(cdp, selector) {
  // 写し元 daihon-panel-select-qc の rowPoint と同じ作法: .akari-daihon-rows は
  // scroll-behavior:smooth なので、まず auto へ落として scrollIntoView を確定させ、
  // 落ち着いてから矩形を測り、elementFromPoint のヒットテストが通ってからクリックする。
  await waitEval(cdp, `(()=>{const rows=document.querySelector('.akari-daihon-rows');if(rows)rows.style.scrollBehavior='auto';const e=document.querySelector(${S(selector)});if(!e)return null;e.scrollIntoView({block:'center'});return true})()`, { label: `${selector} scroll` });
  await sleep(220);
  const point = await waitEval(cdp, `(()=>{const e=document.querySelector(${S(selector)});if(!e)return null;const r=e.getBoundingClientRect();if(!(r.width>0&&r.height>0))return null;return{x:r.left+r.width/2,y:r.top+r.height/2}})()`, { label: selector });
  await waitEval(cdp, `(()=>{const e=document.elementFromPoint(${point.x},${point.y});return e&&e.closest&&e.closest(${S(selector)})?true:null})()`, { timeoutMs: 20_000, label: `${selector} hit test` });
  await realClick(cdp, point.x, point.y);
}

async function clickButtonText(cdp, text) {
  const point = await waitEval(cdp, `(()=>{const e=[...document.querySelectorAll('.akari-daihon-pop button')].find(b=>b.textContent===${S(text)});if(!e)return null;const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`, { label: text });
  await realClick(cdp, point.x, point.y);
}

async function clickFiller(cdp, rowId) {
  await clickSelector(cdp, `[data-caption-id="${rowId}"] .akari-daihon-word-filler`);
  await waitEval(cdp, `document.querySelectorAll('.akari-daihon-pop button').length===3`, { label: 'filler popover' });
}

async function shot(cdp, fixture, stepNumber, label) {
  const name = `${fixture}-${String(stepNumber).padStart(2, '0')}-${label}.png`;
  await screenshot(cdp, path.join(ROOT, name));
  out.screenshots.push(name);
  await save();
}

function narrationAt(edit) {
  return edit.tracks?.find(track => track.id === 'a-narration')?.items?.find(item => item.id === 'narration-guard')?.at;
}

function v2MainMetrics(edit) {
  const items = edit.tracks?.find(track => track.id === 'v-main')?.items?.filter(item => item.source?.kind === 'media') ?? [];
  return {
    itemCount: items.length,
    totalDurationFrames: items.reduce((total, item) => total + item.duration, 0),
    firstAtFrames: items[0]?.at ?? null,
    secondAtFrames: items[1]?.at ?? null,
    originalEndFrames: items.length === 1 ? items[0].at + items[0].duration : null
  };
}

function v1CutMetrics(edit) {
  const cuts = Array.isArray(edit.cuts) ? edit.cuts : [];
  return {
    itemCount: cuts.length,
    totalDurationSeconds: cuts.reduce((total, cut) => total + Math.max(0, cut.out - cut.in), 0),
    intervals: cuts.map(cut => [cut.in, cut.out])
  };
}

function visualDurationFrames(edit) {
  return v2MainMetrics(edit).totalDurationFrames;
}

async function undoAll(cdp) {
  const disabledBefore = await evalOn(cdp, `document.querySelectorAll('.akari-daihon-rbtn:disabled').length`);
  const activationOperationId = await evalOn(cdp, `(()=>{const ids=[...document.querySelectorAll('.akari-daihon-rbtn:disabled')].map(button=>Number(button.closest('.akari-daihon-cutcell')?.dataset.cutOperation)).filter(Number.isFinite);return ids.length?Math.max(...ids):null})()`);
  let restored = 0;
  let disabledBecameEnabled = false;
  if (await evalOn(cdp, `document.querySelectorAll('.akari-daihon-cutcell').length`)) {
    const before = await evalOn(cdp, `document.querySelectorAll('.akari-daihon-cutcell').length`);
    await clickSelector(cdp, '.akari-daihon-rbtn:not(:disabled)');
    await waitEval(cdp, `document.querySelectorAll('.akari-daihon-cutcell').length<${before}`, { label: 'first LIFO restore' });
    restored++;
    if (activationOperationId !== null) {
      disabledBecameEnabled = await waitEval(cdp, `(()=>{const cell=document.querySelector('.akari-daihon-cutcell[data-cut-operation="${activationOperationId}"]');const button=cell?.querySelector('.akari-daihon-rbtn');return button&&!button.disabled})()`, { label: 'older restore activation' });
    }
  }
  while (await evalOn(cdp, `document.querySelectorAll('.akari-daihon-cutcell').length`)) {
    const before = await evalOn(cdp, `document.querySelectorAll('.akari-daihon-cutcell').length`);
    await clickSelector(cdp, '.akari-daihon-rbtn:not(:disabled)');
    await waitEval(cdp, `document.querySelectorAll('.akari-daihon-cutcell').length<${before}`, { label: 'LIFO restore' });
    restored++;
  }
  return { disabledBefore, activationOperationId, disabledBecameEnabled, restored };
}

async function runFixture(name, version, rowCount, port) {
  const project = path.join(FIXTURE, name);
  const editPath = file(project, 'edit.json');
  const captionsPath = file(project, 'captions.json');
  const initialEdit = await readText(editPath);
  let session;
  try {
    session = await launch(project, port, name);
    await evalOn(session.cdp, command('akari.daihon.open'));
    await waitEval(session.cdp, `document.querySelectorAll('.akari-daihon-row').length===${rowCount}`, { label: `${rowCount} rows` });
    const preloadOverlay = await settlePreloadOverlay(session.cdp);
    out.fixtures[name] = { version, preloadOverlay };
    await save();

    if (version === 2) {
      await step(name, '1. フィラーを字幕だけから消す', async () => {
        const beforeEdit = await readText(editPath);
        const before = await readJson(captionsPath);
        const beforeRow = before.find(row => row.id === 'c-0002');
        const wordTimings = words => JSON.stringify(words.map(word => [word.text, word.start, word.end]));
        const beforeWords = wordTimings(beforeRow.words.slice(1));
        await clickFiller(session.cdp, 'c-0002');
        await clickSelector(session.cdp, '.akari-daihon-title');
        await waitEval(session.cdp, `!document.querySelector('.akari-daihon-pop')`, { label: 'outside-click popover close' });
        const popCountAfterOutside = await evalOn(session.cdp, `document.querySelectorAll('.akari-daihon-pop').length`);
        await clickFiller(session.cdp, 'c-0002');
        await clickButtonText(session.cdp, '字幕から消す（音声はそのまま）');
        const after = await waitFile(() => readJson(captionsPath), rows => !rows.find(row => row.id === 'c-0002').text.includes('あの'), 'caption-only filler');
        const afterRow = after.find(row => row.id === 'c-0002');
        const unchangedWords = wordTimings(afterRow.words) === beforeWords;
        assert(unchangedWords, 'remaining word timings changed');
        assert(await readText(editPath) === beforeEdit, 'edit.json changed for caption-only removal');
        return {
          choices: 2,
          popCountAfterOutside,
          beforeWordCount: beforeRow.words.length,
          afterWordCount: afterRow.words.length,
          beforeTextLength: beforeRow.text.length,
          afterTextLength: afterRow.text.length,
          remainingWordBytesEqual: unchangedWords,
          editBytesEqual: true
        };
      });
      await shot(session.cdp, name, 1, 'filler-caption-only');
    }

    await step(name, '2. フィラーを映像ごとカット', async () => {
      const beforeEdit = await readJson(editPath);
      const beforeNarration = version === 2 ? narrationAt(beforeEdit) : null;
      const beforeMetrics = version === 2 ? v2MainMetrics(beforeEdit) : v1CutMetrics(beforeEdit);
      const commits = await commitCount(project);
      await clickFiller(session.cdp, 'c-0003');
      await clickButtonText(session.cdp, '✂ 映像ごとカット');
      const cell = await waitEval(session.cdp, `(()=>{const e=document.querySelector('.akari-daihon-cutcell');return e?e.textContent:null})()`, { label: 'cut cell' });
      const afterEdit = await readJson(editPath);
      const afterCaptions = await readJson(captionsPath);
      const commitDelta = (await commitCount(project)) - commits;
      const afterMetrics = version === 2 ? v2MainMetrics(afterEdit) : v1CutMetrics(afterEdit);
      assert(!afterCaptions.find(row => row.id === 'c-0003').text.includes('えー'), 'filler remained in caption');
      assert(commitDelta === 1, `commit delta was ${commitDelta}`);
      if (version === 2) {
        assert(afterMetrics.totalDurationFrames < beforeMetrics.totalDurationFrames, 'v-main total duration did not shrink');
        assert(afterMetrics.itemCount >= 2 && afterMetrics.secondAtFrames < beforeMetrics.originalEndFrames,
          'the post-cut item at was not reduced below the original item end');
        assert(narrationAt(afterEdit) === beforeNarration, 'narration at changed');
      } else {
        assert(afterMetrics.totalDurationSeconds < beforeMetrics.totalDurationSeconds, 'v1 cuts total duration did not shrink');
      }
      return {
        cell,
        commitDelta,
        beforeMetrics,
        afterMetrics,
        durationDelta: version === 2
          ? beforeMetrics.totalDurationFrames - afterMetrics.totalDurationFrames
          : beforeMetrics.totalDurationSeconds - afterMetrics.totalDurationSeconds,
        narrationAtBefore: beforeNarration,
        narrationAtAfter: version === 2 ? narrationAt(afterEdit) : null
      };
    });
    await shot(session.cdp, name, 2, 'filler-cut');

    if (version === 2) {
      await step(name, '3. 行をカット', async () => {
        const captionsBefore = await readText(captionsPath);
        const captions = await readJson(captionsPath);
        const previous = captions.find(row => row.id === 'c-0005');
        const target = captions.find(row => row.id === 'c-0006');
        const beforeEdit = await readJson(editPath);
        const beforeDurationFrames = visualDurationFrames(beforeEdit);
        await clickSelector(session.cdp, '[data-caption-id="c-0006"] button.akari-daihon-cut');
        const state = await waitEval(session.cdp, `(()=>{const target=document.querySelector('[data-caption-id="c-0006"]');const previous=document.querySelector('[data-caption-id="c-0005"]');const next=document.querySelector('[data-caption-id="c-0007"]');return target.classList.contains('iscut')?{targetIsCut:true,previousIsCut:previous.classList.contains('iscut'),nextIsCut:next.classList.contains('iscut'),cells:document.querySelectorAll('.akari-daihon-cutcell').length}:null})()`, { label: 'row cut state' });
        const afterEdit = await readJson(editPath);
        const afterDurationFrames = visualDurationFrames(afterEdit);
        const removedFrames = beforeDurationFrames - afterDurationFrames;
        const removedSeconds = removedFrames / beforeEdit.output.fps;
        const maximumSeconds = (target.end + 0.04) - previous.end;
        assert(await readText(captionsPath) === captionsBefore, 'captions changed for row cut');
        assert(!state.previousIsCut && !state.nextIsCut, 'row cut spilled into an adjacent row');
        assert(removedFrames > 0 && removedSeconds <= maximumSeconds + 1 / beforeEdit.output.fps,
          `row cut exceeded clamped boundary: ${removedSeconds} > ${maximumSeconds}`);
        return {
          ...state,
          captionsBytesEqual: true,
          beforeDurationFrames,
          afterDurationFrames,
          removedFrames,
          removedSeconds,
          maximumSeconds
        };
      });
      await shot(session.cdp, name, 3, 'row-cut');

      await step(name, '4. 無音レンジをドラッグして詰める', async () => {
        const beforeEdit = await readJson(editPath);
        const beforeDurationFrames = visualDurationFrames(beforeEdit);
        await clickSelector(session.cdp, '[data-caption-id="c-0010"] .akari-daihon-gapchip');
        const points = await waitEval(session.cdp, `(()=>{const tl=document.querySelector('.akari-daihon-minitl');const h=[...tl.querySelectorAll('.hnd')];if(h.length!==2)return null;const tr=tl.getBoundingClientRect(),r=h[0].getBoundingClientRect();return{from:{x:r.left+r.width/2,y:r.top+r.height/2},to:{x:tr.left+tr.width*.32,y:r.top+r.height/2}}})()`, { label: 'gap handles' });
        await realDrag(session.cdp, [points.from, points.to], { steps: 8, stepDelayMs: 20 });
        const meta = await evalOn(session.cdp, `document.querySelector('.akari-daihon-tl-meta').textContent`);
        const selectedSeconds = Number(/詰める ([0-9.]+) 秒/u.exec(meta)?.[1]);
        assert(Number.isFinite(selectedSeconds) && selectedSeconds > 0, `range seconds were not readable: ${meta}`);
        await clickButtonText(session.cdp, '✂ この範囲を詰める');
        await waitEval(session.cdp, `document.querySelectorAll('.akari-daihon-cutcell').length>=3`, { label: 'gap cut cell' });
        const afterEdit = await waitFile(() => readJson(editPath), edit => visualDurationFrames(edit) < beforeDurationFrames, 'gap duration shrink');
        const afterDurationFrames = visualDurationFrames(afterEdit);
        const removedFrames = beforeDurationFrames - afterDurationFrames;
        const expectedFrames = Math.round(selectedSeconds * beforeEdit.output.fps);
        const frameDelta = Math.abs(removedFrames - expectedFrames);
        assert(frameDelta <= 2, `gap shrink differed by ${frameDelta} frames (${removedFrames} vs ${expectedFrames})`);
        return { meta, selectedSeconds, beforeDurationFrames, afterDurationFrames, removedFrames, expectedFrames, frameDelta };
      });
      await shot(session.cdp, name, 4, 'gap-range');
    }

    await step(name, '5. 無音を一括短縮', async () => {
      const commits = await commitCount(project);
      const beforeCells = await evalOn(session.cdp, `document.querySelectorAll('.akari-daihon-cutcell').length`);
      const beforeOperationIds = await evalOn(session.cdp, `[...new Set([...document.querySelectorAll('.akari-daihon-cutcell')].map(cell=>cell.dataset.cutOperation))]`);
      await clickSelector(session.cdp, 'button.akari-daihon-silence');
      await waitEval(session.cdp, `document.querySelectorAll('.akari-daihon-fieldrow input').length===2`, { label: 'silence batch dialog' });
      await clickButtonText(session.cdp, '一括で詰める');
      const afterCells = await waitEval(session.cdp, `(()=>{const n=document.querySelectorAll('.akari-daihon-cutcell').length;return n>${beforeCells}?n:null})()`, { label: 'batch cut cells' });
      const operationState = await evalOn(session.cdp, `(()=>{const before=new Set(${S(beforeOperationIds)});const cells=[...document.querySelectorAll('.akari-daihon-cutcell')];const newCells=cells.filter(cell=>!before.has(cell.dataset.cutOperation));const newOperationIds=[...new Set(newCells.map(cell=>cell.dataset.cutOperation))];return{newCellCount:newCells.length,newOperationIds}})()`);
      const commitDelta = (await commitCount(project)) - commits;
      assert(commitDelta === 1, `batch commit delta was ${commitDelta}`);
      assert(operationState.newCellCount > 1 && operationState.newOperationIds.length === 1,
        `batch cells did not share one operation: ${JSON.stringify(operationState)}`);
      return {
        beforeCells,
        afterCells,
        addedCells: afterCells - beforeCells,
        commitDelta,
        newCellCount: operationState.newCellCount,
        newOperationCount: operationState.newOperationIds.length,
        newOperationId: Number(operationState.newOperationIds[0])
      };
    });
    await shot(session.cdp, name, 5, 'silence-batch');

    await step(name, '6. LIFO で全カットを戻す', async () => {
      const restored = await undoAll(session.cdp);
      const finalEdit = await waitFile(() => readText(editPath), value => value === initialEdit, 'edit byte restoration');
      assert(restored.disabledBefore > 0, 'older restore button was not disabled');
      assert(restored.disabledBecameEnabled, 'the previous restore button did not become enabled');
      return { ...restored, editBytesEqual: finalEdit === initialEdit };
    });
    await shot(session.cdp, name, 6, 'restored');
    out.fixtures[name] = { version, preloadOverlay, editBytesEqual: await readText(editPath) === initialEdit };
  } finally {
    await stop(session);
  }
}

await mkdir(path.join(ROOT, 'runs'), { recursive: true });
await run(process.execPath, [path.join(ROOT, 'scripts', 'gen-fixture.mjs')], { timeoutMs: 240_000 });
try {
  await runFixture('v2', 2, 500, BASE_PORT);
  await runFixture('v1', 1, 40, BASE_PORT + 1);
  out.status = 'pass';
} catch (error) {
  out.status = 'fail';
  out.error = sanitize(error);
  process.exitCode = 1;
} finally {
  out.pass = out.status === 'pass' && out.steps.length === 9 && out.steps.every(item => item.pass)
    && Object.values(out.fixtures).every(item => item.editBytesEqual);
  await save();
}
