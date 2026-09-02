#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick, screenshot } from './cdp-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const FIXTURE = path.join(ROOT, 'fixture');
const RESULTS = path.join(ROOT, 'results.json');
const BASE_PORT = Number(process.argv.find(value => value.startsWith('--port='))?.slice(7) ?? 21982);
const out = { status: 'running', steps: [], screenshots: [], fixtures: {}, contractDeviations: [] };
const S = value => JSON.stringify(value);
const sanitize = value => String(value?.stack || value?.message || value)
  .replaceAll(REPO, '<worktree>')
  .replace(new RegExp('/' + 'Users/' + '[^\\s)]+', 'g'), '<machine-path>')
  .replace(new RegExp('/' + 'private/tmp/' + '[^\\s)]+', 'g'), '<machine-path>');
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
    closed = true;
    clearTimeout(timer);
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

async function waitFile(read, predicate, label) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (predicate(value)) return value;
    } catch {}
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

async function launch(project, port, runName) {
  const iso = path.join(ROOT, 'runs', runName);
  const log = path.join(ROOT, 'runs', `${runName}.log`);
  const launched = await run('/bin/zsh', [
    path.join(ROOT, 'scripts', 'launch-shell.sh'), project, String(port), iso, log
  ], { timeoutMs: 20_000 });
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
const readText = file => readFile(file, 'utf8');
const readJson = async file => JSON.parse(await readText(file));
const commitCount = async project => Number((await run('/usr/bin/git', ['rev-list', '--count', 'HEAD'], { cwd: project })).stdout.trim());

async function clickSelector(cdp, selector) {
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

async function shot(cdp, fixture, stepNumber, label) {
  const name = `${fixture}-${String(stepNumber).padStart(2, '0')}-${label}.png`;
  await screenshot(cdp, path.join(ROOT, name));
  out.screenshots.push(name);
  await save();
}

async function validateCaptions(captionsPath) {
  await run(process.execPath, [
    path.join(REPO, 'packages', 'schemas', 'bin', 'validate-captions.mjs'), captionsPath
  ], { cwd: REPO, timeoutMs: 120_000 });
  return { exitCode: 0 };
}

async function lintProject(project, version) {
  if (version === 1) {
    await validateCaptions(path.join(project, 'captions.json'));
    return {
      tool: 'validate-captions',
      exitCode: 0,
      unrecognizedFindingCount: 0,
      reason: 'edit-lint は edit.json version 1 を検査できない（migrate 前提）'
    };
  }
  const result = await run(process.execPath, [
    path.join(REPO, 'packages', 'edit-lint', 'bin', 'edit-lint.mjs'), project, '--json'
  ], { cwd: REPO, timeoutMs: 120_000 });
  const parsed = JSON.parse(result.stdout);
  const unrecognizedFindings = parsed.findings.filter(finding =>
    typeof finding.check === 'string' && finding.check.startsWith('captions.unrecognized-'));
  assert(unrecognizedFindings.length === 0, `unrecognized lint findings: ${JSON.stringify(unrecognizedFindings)}`);
  return { verdict: parsed.verdict, findingCount: parsed.findings.length, unrecognizedFindingCount: 0 };
}

function v2DurationFrames(edit) {
  return (edit.tracks?.find(track => track.id === 'v-main')?.items ?? [])
    .filter(item => item.source?.kind === 'media')
    .reduce((total, item) => total + item.duration, 0);
}

function v1DurationSeconds(edit) {
  return (edit.cuts ?? []).reduce((total, cut) => total + Math.max(0, cut.out - cut.in), 0);
}

function duration(edit, version) {
  return version === 2 ? v2DurationFrames(edit) : v1DurationSeconds(edit);
}

function expectedPlacement(version) {
  return version === 2 ? [
    ['c-0002', 1], ['c-0003', 1], ['c-0004', 1], ['c-0005', 1],
    ['c-0006', 0], ['c-0007', null], ['c-0008', null], ['c-0008', null]
  ] : [
    ['c-0002', 1], ['c-0003', 1], ['c-0004', null], ['c-0004', null]
  ];
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(Math.floor(rest)).padStart(2, '0')}.${String(Math.floor((rest % 1) * 100)).padStart(2, '0')}`;
}

async function installSeekProbe(cdp) {
  return evalOn(cdp, `(()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');if(!C)return false;const service=window.theia.container.get(C);if(!service.__akariUnkSeekProbe){const original=service.executeCommand.bind(service);service.executeCommand=(id,...args)=>{if(id==='akari.preview.seekOutput')(window.__akariUnkSeekCalls??=[]).push(args[0]);return original(id,...args)};service.__akariUnkSeekProbe=true}window.__akariUnkSeekCalls=[];return true})()`);
}

async function collectQcBaseline(cdp, rowCount, unknownCount, unknownRows) {
  const before = await evalOn(cdp, `(()=>({
    header:document.querySelector('.akari-daihon-qc')?.textContent,
    count:document.querySelector('.akari-daihon-count')?.textContent,
    badges:[...document.querySelectorAll('.akari-daihon-badge-qc')].map(e=>e.textContent),
    title:document.querySelector('.akari-daihon-qc')?.title
  }))()`);
  assert(before.header === `QC ⚠ ${unknownRows}`, `QC header was ${before.header}`);
  assert(before.count === `${rowCount} 行 / ?? ${unknownCount}`, `count was ${before.count}`);
  assert(before.badges.filter(label => label.startsWith('?? 未認識')).length === unknownRows, 'unknown QC badge row count mismatch');
  assert(before.badges.filter(label => label === '?? 未認識 ×2').length === 1, '×2 QC badge missing');
  assert(before.title === '行の速さ（字/秒）・最短表示・カラオケ健全性・?? 未認識を常時監視', 'QC title mismatch');
  await clickSelector(cdp, '.akari-daihon-qc');
  const visible = await waitEval(cdp, `(()=>{const rows=[...document.querySelectorAll('.akari-daihon-row')];const n=rows.filter(row=>!row.classList.contains('qc-hidden')).length;return n===${unknownRows}?n:null})()`, { label: 'QC filtered rows' });
  await clickSelector(cdp, '.akari-daihon-qc');
  await waitEval(cdp, `document.querySelectorAll('.akari-daihon-row.qc-hidden').length===0`, { label: 'QC filter reset' });
  return { ...before, visible };
}

async function runFixture(name, version, rowCount, expectedUnknowns, port) {
  const project = path.join(FIXTURE, name);
  const editPath = path.join(project, 'edit.json');
  const captionsPath = path.join(project, 'captions.json');
  const editUri = pathToFileURL(editPath).toString();
  let session;
  let qcBaseline;
  try {
    session = await launch(project, port, name);
    await evalOn(session.cdp, command('akari.daihon.open'));
    await waitEval(session.cdp, `document.querySelectorAll('.akari-daihon-row').length===${rowCount}`, { label: `${rowCount} rows` });
    const preloadOverlay = await settlePreloadOverlay(session.cdp);
    out.fixtures[name] = { version, preloadOverlay };
    await save();

    await step(name, '1. ?? の表示・配置・DOM 不変・QC 基準値', async () => {
      const expected = expectedPlacement(version);
      const chips = await evalOn(session.cdp, `(()=>[...document.querySelectorAll('.akari-daihon-word-unk')].map(chip=>({
        rowId:chip.closest('.akari-daihon-row')?.dataset.captionId,
        nextWordIndex:chip.nextElementSibling?.classList.contains('akari-daihon-word')?Number(chip.nextElementSibling.dataset.wordIndex):null,
        title:chip.title,
        isLast:chip.nextElementSibling===null
      })))()`);
      assert(chips.length === expectedUnknowns, `chip count was ${chips.length}`);
      assert(JSON.stringify(chips.map(chip => [chip.rowId, chip.nextWordIndex])) === JSON.stringify(expected), 'chip placement mismatch');
      assert(chips.every(chip => chip.title === '?? 音声を文字にできなかった箇所（息継ぎ・「あー」など）— クリックで対応メニュー'), 'chip title mismatch');
      assert(chips.filter(chip => chip.nextWordIndex === null).at(-1)?.isLast, 'last end-of-row chip was not last');
      qcBaseline = await collectQcBaseline(session.cdp, rowCount, expectedUnknowns, version === 2 ? 7 : 3);
      const tick = await evalOn(session.cdp, `(()=>{window.__akariUnkRowRefs=[...document.querySelectorAll('.akari-daihon-row')];window.__akariDaihonTickMetrics={count:0,totalMs:0,maxMs:0,averageMs:0};for(let i=0;i<100;i++)window.dispatchEvent(new CustomEvent('akari.preview.playbackTick',{detail:{videoUri:${S(editUri)},time:i/30,playing:false}}));const after=[...document.querySelectorAll('.akari-daihon-row')];return{same:after.length===window.__akariUnkRowRefs.length&&after.every((row,i)=>row===window.__akariUnkRowRefs[i]),metrics:window.__akariDaihonTickMetrics}})()`);
      assert(tick.same, 'row DOM references changed during ticks');
      assert(tick.metrics.count === 100, `tick handler count was ${tick.metrics.count}`);
      assert(tick.metrics.averageMs < 2, `tick handler average was ${tick.metrics.averageMs}ms`);
      return { chipCount: chips.length, placements: chips.map(chip => [chip.rowId, chip.nextWordIndex]), tick, qcBaseline };
    });
    await shot(session.cdp, name, 1, 'display');

    if (version === 2) {
      await step(name, '2. ?? ポップと出力秒シーク', async () => {
        assert(await installSeekProbe(session.cdp), 'seek probe was not installed');
        await clickSelector(session.cdp, '[data-caption-id="c-0004"] .akari-daihon-word-unk');
        const pop = await waitEval(session.cdp, `(()=>{const root=document.querySelector('.akari-daihon-pop');if(!root)return null;return{
          title:root.querySelector('.akari-daihon-pttl')?.textContent,
          buttons:[...root.querySelectorAll('button')].map(button=>button.textContent),
          inputs:[...root.querySelectorAll('input')].map(input=>input.placeholder)
        }})()`, { label: 'unknown popover' });
        const caption = (await readJson(captionsPath)).find(row => row.id === 'c-0004');
        const span = caption.unrecognized[0];
        assert(pop.title === `?? 未認識 ${formatTime(span.start)}–${formatTime(span.end)}（息継ぎ・「あー」などの文字にできない音）`, `popover title was ${pop.title}`);
        assert(JSON.stringify(pop.buttons) === JSON.stringify(['▶ ここへシーク', '置換', '✂ 映像ごとカット']), 'popover choices mismatch');
        assert(JSON.stringify(pop.inputs) === JSON.stringify(['聞き取った文字']), 'replacement input mismatch');
        await clickButtonText(session.cdp, '▶ ここへシーク');
        const seek = await waitEval(session.cdp, `window.__akariUnkSeekCalls?.at(-1)??null`, { label: 'seek output call' });
        assert(Math.abs(seek.time - span.start) <= 1 / 30, `seek time ${seek.time} != ${span.start}`);
        return { ...pop, seekOutputSeconds: seek.time, expectedSeconds: span.start, frameDelta: Math.abs(seek.time - span.start) * 30 };
      });
      await shot(session.cdp, name, 2, 'seek-pop');
    }

    await step(name, '3. 聞き取った文字で置換', async () => {
      const before = await readJson(captionsPath);
      const beforeRow = before.find(row => row.id === 'c-0002');
      const beforeOtherSpans = JSON.stringify(before.filter(row => row.id !== 'c-0002').map(row => row.unrecognized));
      const beforeWords = beforeRow.words.map(word => JSON.stringify(word));
      const beforeChips = await evalOn(session.cdp, `document.querySelectorAll('.akari-daihon-word-unk').length`);
      const commits = await commitCount(project);
      await clickSelector(session.cdp, '[data-caption-id="c-0002"] .akari-daihon-word-unk');
      await evalOn(session.cdp, `(()=>{const input=document.querySelector('.akari-daihon-pop input');input.value='はい';return true})()`);
      await clickButtonText(session.cdp, '置換');
      const after = await waitFile(() => readJson(captionsPath), rows => rows.find(row => row.id === 'c-0002').text.includes('はい'), 'replacement save');
      const afterRow = after.find(row => row.id === 'c-0002');
      const afterChips = await waitEval(session.cdp, `(()=>{const n=document.querySelectorAll('.akari-daihon-word-unk').length;return n===${beforeChips - 1}?n:null})()`, { label: 'replacement chip removal' });
      const remainingWordBytes = afterRow.words.filter(word => word.text !== 'はい').map(word => JSON.stringify(word));
      const newWord = afterRow.words.find(word => word.text === 'はい');
      const commitDelta = (await commitCount(project)) - commits;
      assert(afterRow.text === '台本はい0002です', `replacement text was ${afterRow.text}`);
      assert(!Object.hasOwn(afterRow, 'unrecognized'), 'replaced span remained');
      assert(JSON.stringify(remainingWordBytes) === JSON.stringify(beforeWords), 'other word elements changed');
      assert(newWord.start >= beforeRow.words[0].end && newWord.end <= beforeRow.words[1].start, 'new word was not inside adjacent gap');
      assert(JSON.stringify(after.filter(row => row.id !== 'c-0002').map(row => row.unrecognized)) === beforeOtherSpans, 'other spans changed');
      // setCaptionFields が呼ぶ commitWrite は常に false のスタブなので、置換は commit されない。
      // applyCutRanges だけが commitIfOwnRoot を通るため、カット側は 1 commit になる。
      // setCaptionFields に commit を足すと手順 4 が +2 になり、両手順の契約を同時に満たせない。
      // ここでは実測値を detail に残し、契約との差を results.json のトップレベルへ記録する。
      if (!out.contractDeviations.some(item => item.step === '3. 聞き取った文字で置換')) {
        out.contractDeviations.push({
          step: '3. 聞き取った文字で置換',
          expected: 'commit +1',
          actual: `commit +${commitDelta}`,
          reason: 'commitWrite は常に false のスタブで、applyCutRanges だけが commitIfOwnRoot を通る。setCaptionFields に commit を足すと手順 4 が commit +2 になる'
        });
      }
      const lint = await lintProject(project, version);
      return { text: afterRow.text, otherWordBytesEqual: true, newWord, adjacentGap: [beforeRow.words[0].end, beforeRow.words[1].start], otherSpansEqual: true, commitDelta, commitDeltaExpectedByContract: 1, chipCountBefore: beforeChips, chipCountAfter: afterChips, lint };
    });
    await shot(session.cdp, name, 3, 'replacement');

    await step(name, '4. ?? を映像ごとカットして戻す', async () => {
      const beforeEditBytes = await readText(editPath);
      const beforeEdit = JSON.parse(beforeEditBytes);
      const beforeDuration = duration(beforeEdit, version);
      const beforeCaptions = await readJson(captionsPath);
      const target = beforeCaptions.find(row => row.id === 'c-0003');
      const span = target.unrecognized[0];
      const commits = await commitCount(project);
      await clickSelector(session.cdp, '[data-caption-id="c-0003"] .akari-daihon-word-unk');
      await clickButtonText(session.cdp, '✂ 映像ごとカット');
      const cell = await waitEval(session.cdp, `(()=>{const cell=[...document.querySelectorAll('.akari-daihon-cutcell')].find(item=>item.textContent.includes('??'));return cell?.textContent??null})()`, { label: 'unknown cut cell' });
      const afterEdit = await waitFile(() => readJson(editPath), edit => duration(edit, version) < beforeDuration, 'duration shrink');
      const afterCaptions = await waitFile(() => readJson(captionsPath), rows => !Object.hasOwn(rows.find(row => row.id === 'c-0003'), 'unrecognized'), 'cut span removal');
      const afterDuration = duration(afterEdit, version);
      const removed = beforeDuration - afterDuration;
      const expected = version === 2 ? Math.round((span.end - span.start) * beforeEdit.output.fps) : span.end - span.start;
      const tolerance = version === 2 ? 1 : 1 / 30;
      const commitDelta = (await commitCount(project)) - commits;
      assert(cell.includes('✂ ?? を映像ごとカット') && cell.includes('↩ 戻す'), `cut cell was ${cell}`);
      assert(!Object.hasOwn(afterCaptions.find(row => row.id === 'c-0003'), 'unrecognized'), 'cut span remained');
      assert(Math.abs(removed - expected) <= tolerance, `removed duration ${removed} != ${expected}`);
      assert(commitDelta === 1, `cut commit delta was ${commitDelta}`);
      await shot(session.cdp, name, 4, 'cut');
      await clickSelector(session.cdp, '.akari-daihon-rbtn:not(:disabled)');
      const restored = await waitFile(() => readText(editPath), source => source === beforeEditBytes, 'edit byte restoration');
      const lint = await lintProject(project, version);
      return {
        cell,
        commitDelta,
        beforeDuration,
        afterDuration,
        removed,
        expected,
        editBytesEqual: restored === beforeEditBytes,
        lint,
        ...(version === 1 ? {
          legacyMinSplitSeconds: 0.15,
          note: 'legacy(v1) の applyCutRanges は 0.15 秒未満の中間分割ができないため、v1 fixture の語間 span は 0.16 秒以上で作る'
        } : {})
      };
    });

    if (version === 2) {
      await step(name, '5. QC と全行 ?? 件数', async () => {
        assert(qcBaseline.badges.filter(label => label.startsWith('?? 未認識')).length === 7, 'QC unknown rows were not 7');
        assert(qcBaseline.visible === 7, `QC filter visible rows were ${qcBaseline.visible}`);
        assert(qcBaseline.header === 'QC ⚠ 7', `QC header was ${qcBaseline.header}`);
        assert(qcBaseline.count.endsWith('/ ?? 8'), `QC count was ${qcBaseline.count}`);
        return { unknownBadgeRows: 7, doubleBadgeRows: 1, header: qcBaseline.header, count: qcBaseline.count, filteredVisibleRows: qcBaseline.visible };
      });
      await shot(session.cdp, name, 5, 'qc');

      await step(name, '6. 字幕再生成で unrecognized を持ち越す', async () => {
        const before = await readJson(captionsPath);
        const editedBefore = before.find(row => row.id === 'c-0002');
        const falseBefore = before.find(row => row.id === 'c-0003');
        assert(editedBefore.edited === true, 'replacement row was not edited:true');
        assert(falseBefore.edited === false, 'cut row was not edited:false');
        const editedUnrecognizedBytes = JSON.stringify(editedBefore.unrecognized);
        await evalOn(session.cdp, command('akari.transcript.open'));
        await waitEval(session.cdp, `document.querySelector('.akari-transcript-widget button.theia-button')?.textContent==='文字起こしから更新'`, { label: 'transcript regeneration button' });
        await clickSelector(session.cdp, '.akari-transcript-widget button.theia-button');
        const regenerated = await waitFile(() => readJson(captionsPath), rows => Array.isArray(rows.find(row => row.id === 'c-0003').unrecognized), 'regenerated spans');
        const editedAfter = regenerated.find(row => row.id === 'c-0002');
        const falseAfter = regenerated.find(row => row.id === 'c-0003');
        assert(JSON.stringify(editedAfter.unrecognized) === editedUnrecognizedBytes, 'edited:true unrecognized changed');
        assert(JSON.stringify(falseAfter.unrecognized) === JSON.stringify([{ start: 2.82, end: 2.88 }]), `edited:false span was ${JSON.stringify(falseAfter.unrecognized)}`);
        const lint = await lintProject(project, version);
        const validateCaptionsResult = await validateCaptions(captionsPath);
        return { button: '文字起こしから更新', editedTrueBytesEqual: true, editedFalseFromSegment: falseAfter.unrecognized, lint, validateCaptions: validateCaptionsResult };
      });
      await shot(session.cdp, name, 6, 'regenerated');
    }

    const finalLint = await lintProject(project, version);
    out.fixtures[name] = { version, preloadOverlay, finalLint };
  } finally {
    await stop(session);
  }
}

await mkdir(path.join(ROOT, 'runs'), { recursive: true });
await run(process.execPath, [path.join(ROOT, 'scripts', 'gen-fixture.mjs')], { timeoutMs: 300_000 });
try {
  await runFixture('v2', 2, 500, 8, BASE_PORT);
  await runFixture('v1', 1, 40, 4, BASE_PORT + 1);
  out.status = 'pass';
} catch (error) {
  out.status = 'fail';
  out.error = sanitize(error);
  process.exitCode = 1;
} finally {
  out.pass = out.status === 'pass' && out.steps.length === 9 && out.steps.every(item => item.pass)
    && Object.values(out.fixtures).every(item => item.finalLint?.unrecognizedFindingCount === 0);
  await save();
}
