#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick, screenshot } from './cdp-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const FIXTURE = path.join(ROOT, 'fixture');
const RESULTS = path.join(ROOT, 'results.json');
const BASE_PORT = Number(process.argv.find(value => value.startsWith('--port='))?.slice(7) ?? 21982);
const require = createRequire(import.meta.url);
const { splitTopLevelElements } = require(path.join(REPO, 'packages/edit-store/lib/edit-store.js'));
const { lintProject } = await import(pathToFileURL(path.join(REPO, 'packages/edit-lint/src/edit-lint.mjs')));
const S = value => JSON.stringify(value);
const out = { status: 'running', steps: [], screenshots: [], fixtures: {} };

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

async function waitFile(file, predicate, label) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const source = await readFile(file, 'utf8');
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
      if (Date.now() - hiddenSince >= 20_000) {
        const neutralized = await evalOn(cdp, `(()=>{const el=document.querySelector('.theia-preload');if(!el||!el.classList.contains('theia-hidden'))return false;el.style.pointerEvents='none';return true})()`);
        if (neutralized) return 'neutralized';
      }
    } else hiddenSince = null;
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
  const contexts = new Set();
  cdp.on('Runtime.executionContextCreated', ({ context }) => contexts.add(context.id));
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await waitEval(cdp, `Boolean(window.theia&&window.theia.container&&document.getElementById('theia-app-shell'))`, { label: 'Theia workbench' });
  return { pid, cdp, contexts };
}

async function stop(session) {
  session?.cdp?.close();
  if (session?.pid) {
    try { process.kill(session.pid, 'SIGTERM'); } catch {}
    await sleep(1800);
  }
}

const command = id => `(async()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');if(!C)throw new Error('CommandService binding unavailable');const r=await window.theia.container.get(C).executeCommand(${S(id)});return r!==null&&typeof r==='object'?'[object]':r??null})()`;
const commandWith = (id, request) => `(async()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');if(!C)throw new Error('CommandService binding unavailable');const r=await window.theia.container.get(C).executeCommand(${S(id)},${S(request)});return r!==null&&typeof r==='object'?'[object]':r??null})()`;
const commitCount = async project => Number((await run('/usr/bin/git', ['rev-list', '--count', 'HEAD'], { cwd: project })).stdout.trim());

function rawRecords(source) {
  const open = source.indexOf('[');
  const close = source.lastIndexOf(']');
  return new Map(splitTopLevelElements(source.slice(open + 1, close)).map(element => [
    JSON.parse(element.text).id, element.text
  ]));
}

function rawProperty(record, property) {
  const open = record.indexOf('{');
  const close = record.lastIndexOf('}');
  return splitTopLevelElements(record.slice(open + 1, close))
    .find(element => element.text.startsWith(`"${property}"`))?.text;
}

async function clickSelector(cdp, selector, modifiers = 0) {
  await waitEval(cdp, `(()=>{const e=document.querySelector(${S(selector)});if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return r.width>0&&r.height>0})()`, { label: `${selector} visible` });
  await sleep(160);
  const point = await evalOn(cdp, `(()=>{const e=document.querySelector(${S(selector)});const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  await realClick(cdp, point.x, point.y, { modifiers });
}

async function clickRows(cdp, ids) {
  for (let index = 0; index < ids.length; index++) {
    await clickSelector(cdp, `[data-caption-id="${ids[index]}"]`, index === 0 ? 0 : 4);
  }
  await waitEval(cdp, `document.querySelectorAll('.akari-daihon-row.selected').length===${ids.length}`, { label: `${ids.length} selected rows` });
}

async function openPicker(cdp, selected) {
  await clickSelector(cdp, selected ? '.akari-daihon-seltpl' : '.akari-daihon-tpl');
  await waitEval(cdp, `document.querySelectorAll('.akari-daihon-tplcard').length===13`, { label: '13 preset cards' });
}

async function clickCard(cdp, presetId) {
  await clickSelector(cdp, `.akari-daihon-tplcard[data-preset-id="${presetId}"]`);
}

async function clearSelection(cdp) {
  if (await evalOn(cdp, `document.querySelectorAll('.akari-daihon-row.selected').length>0`)) {
    await clickSelector(cdp, '.akari-daihon-selclear');
    await waitEval(cdp, `document.querySelectorAll('.akari-daihon-row.selected').length===0`, { label: 'selection cleared' });
  }
}

async function shot(cdp, fixture, number, label) {
  const name = `${fixture}-${String(number).padStart(2, '0')}-${label}.png`;
  await screenshot(cdp, path.join(ROOT, name));
  out.screenshots.push(name);
  await save();
}

const PREVIEW_LINE_PROBE = `(()=>{const docs=[document];for(const frame of document.querySelectorAll('iframe')){try{if(frame.contentDocument)docs.push(frame.contentDocument)}catch{}}for(const doc of docs){const line=doc.querySelector('.akari-caption__line');if(line){const value=doc.defaultView.getComputedStyle(line).backgroundColor;if(value&&value!=='rgba(0, 0, 0, 0)')return{background:value,text:line.textContent}}}return null})()`;

// 出力プレビューは Theia webview（別 CDP ターゲット）の中の入れ子 iframe に描かれる。
// ページターゲットの実行コンテキストからは届かないので webview ターゲットへ繋ぎ直す。
async function previewBackground(session, editPath, port) {
  const editUri = pathToFileURL(editPath).toString();
  await evalOn(session.cdp, commandWith('akari.preview.ensureVisible', { editUri }));
  await evalOn(session.cdp, commandWith('akari.preview.seekOutput', { editUri, time: 0.2 }));
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const target = (await listTargets(port)).find(item =>
      item.type === 'iframe' && String(item.url).includes('webview/index.html?id=akari-output-preview'));
    if (target?.webSocketDebuggerUrl) {
      const webview = new CDP(target.webSocketDebuggerUrl);
      try {
        await webview.connect();
        await webview.send('Runtime.enable');
        const observed = await evalOn(webview, PREVIEW_LINE_PROBE);
        if (observed) return observed.background;
      } catch {} finally { webview.close(); }
    }
    await sleep(400);
  }
  throw new Error('preview caption background was not observed');
}

async function runFixture(name, version, rowCount, port) {
  const project = path.join(FIXTURE, name);
  const captionsPath = path.join(project, 'captions.json');
  const editPath = path.join(project, 'edit.json');
  let session;
  try {
    session = await launch(project, port, name);
    await evalOn(session.cdp, command('akari.daihon.open'));
    await waitEval(session.cdp, `document.querySelectorAll('.akari-daihon-row').length===${rowCount}`, { label: `${rowCount} rows` });
    out.fixtures[name] = { version, rows: rowCount, preloadOverlay: await settlePreloadOverlay(session.cdp) };

    if (version === 2) {
      await step(name, '1. ヘッダピッカー 13 カードとプレビュー', async () => {
        await openPicker(session.cdp, false);
        const observed = await evalOn(session.cdp, `(()=>{const cards=[...document.querySelectorAll('.akari-daihon-tplcard')];const pick=id=>{const e=document.querySelector('.akari-daihon-tplcard[data-preset-id="'+id+'"] .tprev');const probe=document.createElement('span');probe.style.color=id==='subtitle-news'?'#ffffff':id==='subtitle-standard'?'#ffffff':'#fff200';document.body.appendChild(probe);const expected=getComputedStyle(probe).color;probe.remove();return{color:getComputedStyle(e).color,expected}};return{count:cards.length,names:cards.slice(0,4).map(card=>card.querySelector('.tname').textContent),samples:['subtitle-standard','subtitle-variety','subtitle-news'].map(pick)}})()`);
        assert(observed.count === 13, `card count was ${observed.count}`);
        assert(JSON.stringify(observed.names) === JSON.stringify(['テンプレなし', '標準', 'ポップ', 'ニュース帯']), 'first four card names differed');
        assert(observed.samples.every(sample => sample.color === sample.expected), 'preview colors differed');
        return observed;
      });
      await shot(session.cdp, name, 1, 'picker');
      await clickSelector(session.cdp, '.akari-daihon-title');

      await step(name, '5. 未知 id のバッジ・ lint warning・validator', async () => {
        const badge = await evalOn(session.cdp, `(()=>{const e=document.querySelector('[data-caption-id="c-0010"] .akari-daihon-badge-tpl');return e?{text:e.textContent,title:e.title}:null})()`);
        assert(badge?.text === '🎨 nope-x?', 'unknown preset badge differed');
        const lint = await lintProject(project);
        const warnings = lint.findings.filter(finding => finding.check === 'captions.style-preset-unknown');
        assert(warnings.length === 1, `unknown preset warnings were ${warnings.length}`);
        const isolated = JSON.parse(await readFile(captionsPath, 'utf8'));
        delete isolated.find(row => row.id === 'c-0011').x_note;
        const isolatedPath = path.join(ROOT, 'runs', 'unknown-id-validation.json');
        await writeFile(isolatedPath, `${JSON.stringify(isolated, null, 2)}\n`);
        await run(process.execPath, [path.join(REPO, 'packages/schemas/bin/validate-captions.mjs'), isolatedPath]);
        return { badge, warningCount: warnings.length, validateCaptionsExit: 0 };
      });
    }

    await step(name, '2. 選択 3 行へニュース風を 1 commit で適用', async () => {
      const ids = ['c-0001', 'c-0002', 'c-0003'];
      const beforeSource = await readFile(captionsPath, 'utf8');
      const beforeRecords = rawRecords(beforeSource);
      const beforeCommits = await commitCount(project);
      await clickRows(session.cdp, ids);
      await openPicker(session.cdp, true);
      await clickCard(session.cdp, 'subtitle-news');
      const afterSource = await waitFile(captionsPath, source => ids.every(id =>
        JSON.parse(source).find(row => row.id === id)?.style_preset === 'subtitle-news'
      ), 'selected preset write');
      await waitEval(session.cdp, `document.querySelector('.akari-daihon-footer').textContent.includes('ニュース風')`, { label: 'selected preset notification' });
      const afterRecords = rawRecords(afterSource);
      const unchangedOthers = [...beforeRecords].filter(([id]) => !ids.includes(id))
        .every(([id, record]) => afterRecords.get(id) === record);
      const targetFieldsEqual = ids.every(id =>
        rawProperty(beforeRecords.get(id), 'words') === rawProperty(afterRecords.get(id), 'words')
        && rawProperty(beforeRecords.get(id), 'text_style') === rawProperty(afterRecords.get(id), 'text_style'));
      const commitDelta = (await commitCount(project)) - beforeCommits;
      const badges = await waitEval(session.cdp, `document.querySelectorAll('.akari-daihon-badge-tpl').length===${version === 2 ? 4 : 4}&&document.querySelectorAll('.akari-daihon-badge-tpl').length`, { label: 'preset badges after selected apply' });
      assert(unchangedOthers && targetFieldsEqual, 'unrelated record or target words/text_style changed');
      assert(commitDelta === 1, `commit delta was ${commitDelta}`);
      let previewPlateBackground = null;
      if (version === 2) {
        previewPlateBackground = await previewBackground(session, editPath, port);
        assert(previewPlateBackground === 'rgb(198, 40, 40)', `preview background was ${previewPlateBackground}`);
      }
      return { changedRows: 3, unchangedRows: rowCount - 3, unchangedOthers, targetFieldsEqual, commitDelta, badges, previewPlateBackground };
    });
    await shot(session.cdp, name, 2, 'selected-news');

    await clearSelection(session.cdp);
    if (version === 2) {
      await step(name, '3. 全 500 行へ適用・ 1 commit・未知キー保全', async () => {
        const beforeSource = await readFile(captionsPath, 'utf8');
        const beforeXNote = rawProperty(rawRecords(beforeSource).get('c-0011'), 'x_note');
        const beforeCommits = await commitCount(project);
        await openPicker(session.cdp, false);
        await clickCard(session.cdp, 'subtitle-standard');
        const started = performance.now();
        await clickSelector(session.cdp, '.akari-daihon-tplfoot button.primary');
        const afterSource = await waitFile(captionsPath, source => JSON.parse(source).every(row => row.style_preset === 'subtitle-standard'), 'all preset write');
        await waitEval(session.cdp, `document.querySelector('.akari-daihon-footer').textContent.includes('標準字幕')`, { label: 'all preset notification' });
        const elapsedMs = performance.now() - started;
        const commitDelta = (await commitCount(project)) - beforeCommits;
        const afterXNote = rawProperty(rawRecords(afterSource).get('c-0011'), 'x_note');
        const badges = await waitEval(session.cdp, `document.querySelectorAll('.akari-daihon-badge-tpl').length===500&&500`, { label: '500 preset badges' });
        assert(commitDelta === 1 && elapsedMs < 3000, `commit=${commitDelta} elapsed=${elapsedMs}`);
        assert(beforeXNote === afterXNote, 'x_note changed');
        return { changedRows: 500, commitDelta, elapsedMs, badges, xNoteBytesEqual: true };
      });
      await shot(session.cdp, name, 3, 'all-standard');

      await step(name, '3b. 同値の全行再適用は no-op', async () => {
        const beforeSource = await readFile(captionsPath, 'utf8');
        const beforeCommits = await commitCount(project);
        await openPicker(session.cdp, false);
        await clickCard(session.cdp, 'subtitle-standard');
        await clickSelector(session.cdp, '.akari-daihon-tplfoot button.primary');
        await waitEval(session.cdp, `document.querySelector('.akari-daihon-footer').textContent.includes('changed: 0')`, { label: 'changed 0 notification' });
        const afterSource = await readFile(captionsPath, 'utf8');
        const commitDelta = (await commitCount(project)) - beforeCommits;
        assert(afterSource === beforeSource && commitDelta === 0, 'no-op changed bytes or commit');
        return { captionsBytesEqual: true, commitDelta, notification: 'changed: 0' };
      });
    }

    await step(name, '4. テンプレなしは style_preset だけを削除', async () => {
      const beforeSource = await readFile(captionsPath, 'utf8');
      const beforeRecords = rawRecords(beforeSource);
      const beforeStyles = new Map([...beforeRecords].slice(0, 5).map(([id, record]) => [id, rawProperty(record, 'text_style')]));
      const beforeCommits = await commitCount(project);
      await clearSelection(session.cdp);
      await openPicker(session.cdp, false);
      await clickCard(session.cdp, '');
      await clickSelector(session.cdp, '.akari-daihon-tplfoot button.primary');
      const afterSource = await waitFile(captionsPath, source => JSON.parse(source).every(row => !Object.hasOwn(row, 'style_preset')), 'preset removal');
      await waitEval(session.cdp, `document.querySelector('.akari-daihon-footer').textContent.includes('テンプレを解除')`, { label: 'preset removal notification' });
      const afterRecords = rawRecords(afterSource);
      const textStylesEqual = [...beforeStyles].every(([id, style]) => rawProperty(afterRecords.get(id), 'text_style') === style);
      const commitDelta = (await commitCount(project)) - beforeCommits;
      assert(textStylesEqual && commitDelta === 1, 'text_style changed or commit delta differed');
      return { remainingPresetKeys: 0, textStyleRows: 5, textStyleBytesEqual: textStylesEqual, commitDelta };
    });
    await shot(session.cdp, name, 4, 'preset-none');

    if (version === 2) {
      await step(name, '6. tick 100 回で行 DOM 参照不変・ handler 2ms 未満', async () => {
        const editUri = pathToFileURL(editPath).toString();
        const measured = await evalOn(session.cdp, `(()=>{window.__akariDaihonTickMetrics={count:0,totalMs:0,maxMs:0,averageMs:0};const rows=[...document.querySelectorAll('.akari-daihon-row')];const refs=new Map(rows.map(row=>[row.dataset.captionId,row]));for(let i=0;i<100;i++)window.dispatchEvent(new CustomEvent('akari.preview.playbackTick',{detail:{videoUri:${S(editUri)},time:i/30,playing:true}}));const current=[...document.querySelectorAll('.akari-daihon-row')];return{metrics:window.__akariDaihonTickMetrics,referencesStable:current.length===500&&current.every(row=>refs.get(row.dataset.captionId)===row)}})()`);
        assert(measured.referencesStable, 'row DOM references changed');
        assert(measured.metrics.count === 100 && measured.metrics.averageMs < 2, `tick metrics differed: ${JSON.stringify(measured.metrics)}`);
        return measured;
      });
    }
  } finally {
    await stop(session);
  }
}

await mkdir(path.join(ROOT, 'runs'), { recursive: true });
await run(process.execPath, [path.join(ROOT, 'scripts', 'gen-fixture.mjs')], { timeoutMs: 180_000 });
try {
  await runFixture('v2', 2, 500, BASE_PORT);
  await runFixture('v1', 1, 40, BASE_PORT + 1);
  out.status = 'pass';
} catch (error) {
  out.status = 'fail';
  out.error = sanitize(error);
  throw error;
} finally {
  await save();
}
