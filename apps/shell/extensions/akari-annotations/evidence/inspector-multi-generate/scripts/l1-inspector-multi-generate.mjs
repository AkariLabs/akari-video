#!/usr/bin/env node
// Real Electron + CDP, isolated preferences and offline fake CLI. No package installation.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick, screenshot } from './cdp-lib.mjs';
import { createFixture } from './gen-fixture.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '../../../../../..');
const SHELL = path.join(REPO, 'apps/shell');
const PANEL = '.akari-generation-batch';
const ROW = '.akari-generation-batch-row';
const SUBMIT = '.akari-generation-batch-submit';
const S = JSON.stringify;
const command = id => `(async()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');if(!C)throw Error('CommandService unavailable');await window.theia.container.get(C).executeCommand(${S(id)});return true})()`;
const intersects = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const visible = rect => rect.width > 0 && rect.height > 0;
const painted = style => !['transparent', 'rgba(0, 0, 0, 0)'].includes(style.backgroundColor)
  || (parseFloat(style.borderTopWidth) > 0 && !['none', 'hidden'].includes(style.borderTopStyle)
      && !['transparent', 'rgba(0, 0, 0, 0)'].includes(style.borderTopColor));

async function waitFor(operation, label, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { const value = await operation(); if (value) return value; } catch (error) { last = error; }
    await sleep(150);
  }
  throw Error(`${label} timed out${last ? `: ${last.message}` : ''}`);
}
const waitEval = (cdp, expression, label, timeout) => waitFor(() => evalOn(cdp, expression), label, timeout);

async function click(cdp, selector, modifiers = 0) {
  const point = await waitEval(cdp, `(()=>{const e=document.querySelector(${S(selector)});if(!e)return null;
    e.scrollIntoView({block:'nearest',inline:'nearest'});const r=e.getBoundingClientRect();
    return r.width>0&&r.height>0?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`, selector);
  await realClick(cdp, point.x, point.y, { modifiers });
}

async function measure(cdp) {
  const measured = await evalOn(cdp, `(()=>{
    const rect=e=>{const r=e.getBoundingClientRect();return{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
    const textRect=e=>{const range=document.createRange();range.selectNodeContents(e);return rect(range)};
    return {rows:[...document.querySelectorAll(${S(ROW)})].map(e=>({id:e.getAttribute('data-akari-generation-item'),rect:rect(e),
      name:rect(e.querySelector('.akari-generation-batch-name')),nameText:textRect(e.querySelector('.akari-generation-batch-name')),
      duration:rect(e.querySelector('.akari-generation-batch-duration')),
      badge:rect(e.querySelector('.akari-generation-batch-badge')),badgeText:textRect(e.querySelector('.akari-generation-batch-badge'))})),
      buttons:[...document.querySelectorAll(${S(`${PANEL} button`)})].map(e=>{const s=getComputedStyle(e);return{
        label:e.textContent,disabled:e.disabled,rect:rect(e),backgroundColor:s.backgroundColor,border:s.border,
        borderTopWidth:s.borderTopWidth,borderTopStyle:s.borderTopStyle,borderTopColor:s.borderTopColor}})};
  })()`);
  assert.equal(measured.rows.length, 3);
  for (const [index, row] of measured.rows.entries()) {
    assert.ok(visible(row.rect) && visible(row.name) && visible(row.badge), `invisible row ${row.id}`);
    assert.ok(!intersects(row.name, row.badge) && !intersects(row.duration, row.badge), `label/badge overlap ${row.id}`);
    assert.ok(!intersects(row.nameText, row.badgeText), `text overlap ${row.id}`);
    for (const other of measured.rows.slice(index + 1)) assert.ok(!intersects(row.rect, other.rect), `rows overlap ${row.id}/${other.id}`);
  }
  for (const button of measured.buttons) assert.ok(visible(button.rect) && painted(button), `unpainted button: ${button.label}`);
  return measured;
}

export async function main() {
  const isolation = await mkdtemp(path.join(os.tmpdir(), 'akari-multi-generate-l1-'));
  const project = path.join(isolation, 'project');
  const port = Number(process.argv.find(value => value.startsWith('--port='))?.slice(7) ?? 22223);
  const out = { status: 'running', screenshots: [], measurements: {}, invocations: [] };
  const sanitize = text => String(text).replaceAll(isolation, '<TMP>').replaceAll(REPO, '<WORKTREE>')
    .replaceAll(os.homedir(), '<HOME>');
  const save = () => writeFile(path.join(ROOT, 'results.json'), `${sanitize(JSON.stringify(out, null, 2))}\n`);
  let child, cdp, closed = false, logs = '';
  const shot = async name => { await screenshot(cdp, path.join(ROOT, name)); out.screenshots.push(name); await save(); };
  const started = Date.now();
  try {
    out.fixture = await createFixture(project);
    for (const name of ['akari-home', 'theia-config', 'user-data']) await mkdir(path.join(isolation, name));
    const suffix = process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron'
      : process.platform === 'win32' ? 'electron.exe' : 'electron';
    const candidates = [path.join(SHELL, 'node_modules/electron/dist', suffix), path.join(REPO, 'node_modules/electron/dist', suffix)];
    let electron;
    for (const candidate of candidates) if (await stat(candidate).then(s => s.isFile()).catch(() => false)) { electron = candidate; break; }
    assert.ok(electron, 'Electron is not installed; build with existing dependencies first');
    child = spawn(electron, [SHELL, project, `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(isolation, 'user-data')}`, '--no-sandbox'], {
      cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env,
        AKARI_HOME: path.join(isolation, 'akari-home'), THEIA_CONFIG_DIR: path.join(isolation, 'theia-config'),
        AKARI_GENERATE_CLI: path.join(ROOT, 'scripts/fake-generate.mjs') }
    });
    child.stdout.on('data', chunk => { logs += chunk; }); child.stderr.on('data', chunk => { logs += chunk; });
    child.once('error', error => { out.launchError = error.message; if (!child.pid) closed = true; });
    child.once('close', () => { closed = true; });
    const target = await waitFor(async () => {
      if (closed) throw Error(out.launchError ?? 'Electron exited');
      return (await listTargets(port)).find(target => target.type === 'page');
    }, 'CDP page', 600_000);
    cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect();
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    await waitEval(cdp, `Boolean(window.theia?.container&&document.getElementById('theia-app-shell'))`, 'workbench', 600_000);
    await waitEval(cdp, `(()=>{const e=document.querySelector('.theia-preload');return !e||e.classList.contains('theia-hidden')})()`, 'preload hidden', 600_000);
    await evalOn(cdp, command('akari.annotations.open'));
    await evalOn(cdp, command('akari.inspector.open'));
    await waitEval(cdp, `Boolean(document.querySelector('[data-akari-ui="panel:inspector"]')?.offsetParent)`, 'inspector visible');

    // Actual pointer input; deliberately select in reverse order to test timeline sorting.
    await click(cdp, '[data-akari-ui="timeline:cut:2"]');
    await click(cdp, '[data-akari-ui="timeline:cut:1"]', 8);
    await click(cdp, '[data-akari-ui="timeline:cut:0"]', 8);
    out.selection = await waitEval(cdp, `(()=>{const p=document.querySelector(${S(PANEL)});const b=p?.querySelector(${S(SUBMIT)});
      return p&&p.querySelectorAll(${S(ROW)}).length===3&&b&&!b.disabled&&p.textContent.includes('動画にするもの: 2 本 · 合計 $')
        ?{text:p.textContent,ids:[...p.querySelectorAll(${S(ROW)})].map(e=>e.getAttribute('data-akari-generation-item'))}:null})()`, 'three selection rows and two estimates');
    assert.deepEqual(out.selection.ids, ['clip-a', 'clip-b', 'clip-c']);
    assert.ok(out.selection.text.includes('画像のまま（対象外）'));
    assert.ok(out.selection.text.includes('3 個を選択中'));
    assert.ok(out.selection.text.includes('1 本ずつの見積の合計 · 承認は 1 回'));
    out.measurements.selection = await measure(cdp);
    await shot('01-multi-selection.png');
    await click(cdp, SUBMIT);
    out.dialog = await waitEval(cdp, `(()=>{const d=[...document.querySelectorAll('.dialogBlock')].filter(e=>e.textContent.includes('費用承認'));
      return d.length===1?{count:d.length,text:d[0].textContent}:null})()`, 'one approval dialog');
    assert.match(out.dialog.text, /2 本を合計 \$\d+\.\d{2}（as_of .+）で送ります。費用承認しますか/);
    const before = await readFile(path.join(project, 'fake-invocations.jsonl'), 'utf8').catch(error => {
      if (error.code === 'ENOENT') return ''; throw error;
    });
    assert.equal(before, '', 'CLI started before approval');
    await shot('02-cost-approval.png');
    await evalOn(cdp, `(()=>{const d=[...document.querySelectorAll('.dialogBlock')].find(e=>e.textContent.includes('費用承認'));
      const b=[...d.querySelectorAll('button')].find(b=>b.textContent==='費用承認する');if(!b)throw Error('approval button missing');b.click()})()`);
    await waitEval(cdp, `Boolean(document.querySelector('.akari-generation-batch-stop'))`, 'remaining stop button');
    out.measurements.running = await measure(cdp);
    await shot('03-generating.png');
    out.invocations = await waitFor(async () => {
      const events = (await readFile(path.join(project, 'fake-invocations.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
      return events.filter(event => event.event === 'end').length >= 2 ? events : null;
    }, 'two CLI completions');
    const starts = out.invocations.filter(event => event.event === 'start');
    const ends = out.invocations.filter(event => event.event === 'end');
    assert.equal(starts.length, 2); assert.equal(ends.length, 2);
    assert.deepEqual(starts.map(event => event.itemId), ['clip-a', 'clip-b']);
    assert.deepEqual(out.invocations.map(event => `${event.event}:${event.itemId}`), ['start:clip-a', 'end:clip-a', 'start:clip-b', 'end:clip-b']);
    assert.ok(ends.every(event => event.ok && event.ended_at >= event.started_at));
    assert.ok(ends[0].ended_at <= starts[1].started_at, 'CLI invocations overlap');
    out.nonOverlapping = true;
    await waitEval(cdp, `(()=>{const rows=[...document.querySelectorAll(${S(ROW)})];return rows.length===3
      &&rows.slice(0,2).every(e=>e.querySelector('.akari-generation-batch-badge')?.textContent==='完了')
      &&document.querySelector(${S(SUBMIT)})?.disabled&&!document.querySelector('.akari-generation-batch-stop')})()`, 'completed badges');
    out.measurements.completed = await measure(cdp);
    await shot('04-completed.png');

    // renderStrip assigns this class and both data attributes to each caption chip.
    const captionSelector = id => `.akari-annotations-strip-caption[data-akari-item-kind="caption"][data-akari-item-id="${id}"]`;
    out.captionChips = await waitEval(cdp, `(()=>{
      const chips=${S(out.fixture.captions.map(captionSelector))}.map(selector=>{
        const e=document.querySelector(selector);if(!e)return null;const r=e.getBoundingClientRect();
        return {id:e.getAttribute('data-akari-item-id'),width:r.width,height:r.height};
      });return chips.every(e=>e&&e.width>0&&e.height>0)?chips:null;
    })()`, 'two visible source-attributed caption chips');
    assert.deepEqual(out.captionChips.map(chip => chip.id), ['caption-a', 'caption-b']);
    await click(cdp, captionSelector('caption-a'));
    await click(cdp, captionSelector('caption-b'), 8);
    out.captions = await waitEval(cdp, `(()=>{const p=document.querySelector('[data-akari-ui="panel:inspector"]');
      const count=p?.querySelector('[data-akari-field="caption-multi-count"]');
      const multiCaptionPanel=Boolean(p?.offsetParent&&count&&count.textContent.includes('2 件')&&p.textContent.includes('内容（複数）'));
      const generationPanel=Boolean(document.querySelector(${S(PANEL)}));
      return multiCaptionPanel&&!generationPanel?{text:p.textContent,count:count.textContent,multiCaptionPanel,generationPanel}:null})()`, 'original multi-caption panel');
    assert.equal(out.captions.multiCaptionPanel, true);
    assert.equal(out.captions.generationPanel, false);
    assert.ok(out.captions.text.includes('内容（複数）'));
    await shot('05-multi-captions.png');
    out.status = 'pass';
  } catch (error) {
    out.status = 'fail'; out.error = sanitize(error.stack ?? error);
    if (cdp) await shot('99-failure.png').catch(() => {});
    process.exitCode = 1;
  } finally {
    // The main process can exit before inherited stdout/stderr pipes close.
    const electronExited = () => !child?.pid || closed || child.exitCode !== null || child.signalCode !== null;
    out.cleanup = { pid: child?.pid ?? null, electronClosed: electronExited(),
      isolatedDirectoriesRemoved: false, signals: [], errors: [] };
    const cleanupStep = async (step, operation) => {
      try { await operation(); return true; }
      catch (error) {
        const message = sanitize(error.stack ?? error);
        out.cleanup.errors.push({ step, message });
        console.error(`Cleanup ${step}: ${message}`);
        return false;
      }
    };
    await cleanupStep('CDP close', () => cdp?.close());
    for (const signal of ['SIGTERM', 'SIGKILL']) {
      if (electronExited()) break;
      // ChildProcess.kill targets only the PID returned by our own spawn.
      await cleanupStep(`${signal} send`, () => {
        out.cleanup.signals.push({ signal, sent: child.kill(signal), waitMs: 30_000 });
      });
      await cleanupStep(`${signal} wait`, () => waitFor(electronExited, `Electron ${signal}`, 30_000));
    }
    out.cleanup.electronClosed = electronExited();
    if (!out.cleanup.electronClosed) process.exitCode = 1;
    // Release our handles even if a child/pipe remains, so the recorded exit code can take effect.
    await cleanupStep('stdout release', () => child?.stdout?.destroy());
    await cleanupStep('stderr release', () => child?.stderr?.destroy());
    await cleanupStep('child unref', () => child?.unref());
    out.cleanup.isolatedDirectoriesRemoved = await cleanupStep('temporary directory removal',
      () => rm(isolation, { recursive: true, force: true }));
    out.elapsedMs = Date.now() - started;
    await cleanupStep('electron.log write', () => writeFile(path.join(ROOT, 'electron.log'), sanitize(logs)));
    await cleanupStep('results.json save', save);
  }
}
if (process.argv[1] && await realpath(process.argv[1]) === await realpath(fileURLToPath(import.meta.url))) await main();
