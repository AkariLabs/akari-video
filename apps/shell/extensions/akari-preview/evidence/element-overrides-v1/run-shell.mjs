#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, open, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn } from '../../../akari-annotations/evidence/timeline-tracks/scripts/cdp-lib.mjs';
import { CASES, createFixtures } from './fixtures.mjs';
import { geometryChecks } from './geometry.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(here, '../../../../../..');
const out = join(here, 'results');
const selected = process.argv.includes('--case') ? CASES.filter(name => name === process.argv[process.argv.indexOf('--case') + 1]) : CASES;
if (!selected.length) throw new Error('Unknown fixture');
const port = Number(process.env.AKARI_CDP_PORT ?? 9861);
const caseTimeoutMs = Number(process.env.AKARI_SHELL_CASE_TIMEOUT_MS ?? 180000);
const executable = resolve(process.env.ELECTRON_BIN ?? join(repo, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { measuredAt: new Date().toISOString(), launcher_tier: 2, executable, cases: [], checks: [], pass: false };
await mkdir(out, { recursive: true });
const fixtures = await createFixtures(join(out, 'fixtures'));
const save = () => writeFile(join(out, 'shell-results.json'), JSON.stringify(report, null, 2) + '\n');
await save();
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid CDP port');
if (!Number.isFinite(caseTimeoutMs) || caseTimeoutMs <= 0) throw new Error('Invalid case timeout');
const controller = new AbortController();
let activeChild;
let interrupted = 0;
const onSignal = code => () => {
  interrupted = code;
  controller.abort(new Error(`Interrupted by signal (${code})`));
  activeChild?.kill('SIGTERM');
};
const onInterrupt = onSignal(130), onTerminate = onSignal(143);
process.on('SIGINT', onInterrupt);
process.on('SIGTERM', onTerminate);
let caseDeadline = 0;

function remaining() { return caseDeadline - Date.now(); }

async function bounded(promise, label, limit = 10000) {
  const ms = Math.min(limit, remaining());
  if (controller.signal.aborted) throw controller.signal.reason;
  if (ms <= 0) throw new Error(`Case deadline exceeded: ${label}`);
  let timer;
  let onAbort;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timeout ${label}`)), ms);
      onAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', onAbort, { once: true });
    })]);
  } finally {
    clearTimeout(timer);
    if (onAbort) controller.signal.removeEventListener('abort', onAbort);
  }
}

async function waitFor(label, predicate) {
  let last;
  while (remaining() > 0) {
    if (controller.signal.aborted) throw controller.signal.reason;
    try { const value = await predicate(); if (value) return value; } catch (error) { last = String(error); }
    await sleep(200);
  }
  throw new Error(`Timeout ${label}: ${last ?? ''}`);
}

for (const fixture of selected) {
  if (controller.signal.aborted) break;
  caseDeadline = Date.now() + caseTimeoutMs;
  const entry = { fixture, pass: false, startedAt: new Date().toISOString(), launcher_tier: 2 };
  report.cases.push(entry);
  await save();
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'akari-elements-shell-')));
  const project = join(workspace, 'project'), userData = join(workspace, 'userdata');
  let child, logHandle;
  const connections = [];
  try {
    let occupied = false;
    try {
      await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) });
      occupied = true;
    } catch { /* Unreachable is the expected unused-port state. */ }
    if (occupied) throw new Error(`CDP port ${port} is already in use`);
    await cp(join(repo, 'templates/project-default'), project, { recursive: true });
    await cp(fixtures[fixture], project, { recursive: true, force: true });
    await rm(join(project, '.git'), { recursive: true, force: true });
    await mkdir(userData);
    const before = sha(await readFile(join(project, 'fragment.html')));
    const editUri = pathToFileURL(join(project, 'edit.json')).href;
    const logPath = join(out, `shell-${fixture}.log`);
    logHandle = await open(logPath, 'w');
    child = spawn('/usr/bin/env', ['-u', 'ELECTRON_RUN_AS_NODE', `THEIA_CONFIG_DIR=${userData}`,
      executable, join(repo, 'apps/shell'), project, `--remote-debugging-port=${port}`,
      `--user-data-dir=${userData}`, '--no-sandbox', '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'], { cwd: join(repo, 'apps/shell'),
      stdio: ['ignore', logHandle.fd, logHandle.fd] });
    activeChild = child;
    child.once('error', error => { entry.launchError = String(error); });
    const targets = async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`,
      { signal: AbortSignal.timeout(Math.min(2000, Math.max(1, remaining()))) })).json());
    await waitFor('shell ready', async () => {
      if (entry.launchError) throw new Error(entry.launchError);
      if (child.exitCode !== null) throw new Error(`Electron exited ${child.exitCode}`);
      return (await readFile(logPath, 'utf8')).includes("Changed application state from 'initialized_layout' to 'ready'")
        && (await targets()).length > 0;
    });
    const connect = async target => {
      const cdp = new CDP(target.webSocketDebuggerUrl), contexts = new Map();
      connections.push(cdp); await bounded(cdp.connect(), 'CDP connect', 15000);
      const send = cdp.send.bind(cdp);
      cdp.send = (method, params) => bounded(send(method, params), `CDP ${method}`, 10000);
      cdp.on('Runtime.executionContextCreated', ({ context }) => contexts.set(context.id, context));
      cdp.on('Runtime.executionContextDestroyed', ({ executionContextId }) => contexts.delete(executionContextId));
      await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
      return { cdp, contexts };
    };
    const mainTarget = await waitFor('Theia page', async () => {
      const list = await targets();
      return list.find(target => target.type === 'page' && /localhost/u.test(target.url))
        ?? list.find(target => target.type === 'page');
    });
    const main = await connect(mainTarget);
    const mainEval = expression => bounded(evalOn(main.cdp, expression), 'main Runtime.evaluate', 10000);
    await waitFor('frontend', () => mainEval("Boolean(window.theia?.container && document.readyState === 'complete')"));
    await mainEval(`(() => { const button=[...document.querySelectorAll('button')].find(node=>node.textContent?.trim()==='開くだけ'); button?.click(); return true })()`);
    const command = (id, argument) => mainEval(`(async () => {
      const container=window.theia.container;
      const key=[...container._bindingDictionary._map.keys()].find(value=>typeof value==='function'
        && typeof value.prototype?.executeCommand==='function' && typeof value.prototype?.registerCommand==='function');
      if(!key)throw new Error('CommandRegistry unavailable');
      await container.get(key).executeCommand(${JSON.stringify(id)}${argument === undefined ? '' : `, ${JSON.stringify(argument)}`});
      return true;
    })()`);
    await waitFor('timeline command', () => command('akari.annotations.open', { editUri }));
    await waitFor('preview command', () => command('akari.preview.ensureVisible', { editUri }));
    const candidates = new Map([[mainTarget.id, main]]);
    const preview = await waitFor('preview context', async () => {
      for (const target of (await targets()).filter(target => target.type === 'iframe')) {
        if (!candidates.has(target.id)) candidates.set(target.id, await connect(target));
      }
      for (const { cdp, contexts } of candidates.values()) for (const context of contexts.values()) {
        if (context.auxData?.isDefault === false) continue;
        try {
          if (await bounded(evalOn(cdp, `Boolean(window.akari?.state?.editPath===${JSON.stringify(editUri)}
            && document.querySelector('#overlay-stage [data-overlay-id]'))`, context.id),
          'preview Runtime.evaluate', 10000)) return { cdp, contextId: context.id };
        } catch {}
      }
      return false;
    });
    const previewEval = expression => bounded(evalOn(preview.cdp, expression, preview.contextId),
      'preview Runtime.evaluate', 10000);
    const measurement = await waitFor('preview measurement', async () => {
      const observed = await previewEval(`(() => {
      const stage=document.getElementById('overlay-stage'),rect=stage.getBoundingClientRect(),scale=rect.width/640;
      const box=element=>{const r=element.getBoundingClientRect();return {left:(r.left-rect.left)/scale,
        top:(r.top-rect.top)/scale,width:r.width/scale,height:r.height/scale}};
      const classes=['bg','chart','col','bar','val','card','heading','body','part','a','b','free','tile','photo'];
      if(!(rect.width>0&&rect.height>0))return null;
      return {stage:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},
        boxes:Object.fromEntries(classes.map(name=>[name,[...stage.querySelectorAll('.'+name)].map(box)])),
        styles:{free:[...stage.querySelectorAll('.free')].map(element=>element.getAttribute('style')??'')},
        imagesLoaded:[...stage.querySelectorAll('img')].every(image=>image.complete&&image.naturalWidth>0)};
    })()`);
      const target = fixture.startsWith('bars') || fixture === 'missing' || fixture === 'legacy' ? 'bar'
        : fixture.startsWith('card') ? 'heading' : fixture.startsWith('bag') ? 'free' : 'tile';
      const count = target === 'bar' ? 5 : fixture.startsWith('bag') && fixture !== 'bag-lazy' ? 2 : 1;
      return observed?.boxes?.[target]?.length >= count
        && observed.boxes[target].every(box => box.width > 0 && box.height > 0)
        && (!fixture.startsWith('paths') || observed.imagesLoaded) ? observed : false;
    });
    entry.measurement = measurement;
    // Screenshot is diagnostic only. Page.captureScreenshot is unsupported on iframe targets.
    try {
      const png = await main.cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      entry.screenshot = join(out, `shell-${fixture}-ui.png`);
      await writeFile(entry.screenshot, Buffer.from(png.data, 'base64'));
    } catch (error) { entry.screenshotError = String(error); }
    entry.fragmentSha256Before = before;
    entry.fragmentSha256After = sha(await readFile(join(project, 'fragment.html')));
    entry.pass = before === entry.fragmentSha256After && measurement.stage.width > 0
      && (fixture !== 'paths' || measurement.imagesLoaded);
  } catch (error) { entry.error = String(error.stack ?? error); }
  finally {
    for (const cdp of connections) { try { cdp.close(); } catch {} }
    if (child && child.exitCode === null) {
      const stopped = new Promise(done => child.once('close', done));
      child.kill('SIGTERM');
      if (await Promise.race([stopped.then(() => true), sleep(5000).then(() => false)]) === false) {
        child.kill('SIGKILL');
        await Promise.race([stopped, sleep(5000)]);
      }
    }
    await logHandle?.close();
    await rm(workspace, { recursive: true, force: true });
    activeChild = undefined;
    entry.finishedAt = new Date().toISOString();
    await save();
  }
  console.log(`${fixture}: ${entry.pass ? 'PASS' : 'FAIL'}`);
}
report.checks = geometryChecks(name => report.cases.find(entry => entry.fixture === name)?.measurement);
report.pass = !interrupted && report.cases.length === selected.length && report.cases.every(entry => entry.pass)
  && report.checks.every(check => check.pass);
await save();
process.off('SIGINT', onInterrupt);
process.off('SIGTERM', onTerminate);
if (!report.pass) process.exitCode = interrupted || 1;
if (process.argv[1] && await realpath(process.argv[1]) !== await realpath(fileURLToPath(import.meta.url))) process.exitCode = 1;
