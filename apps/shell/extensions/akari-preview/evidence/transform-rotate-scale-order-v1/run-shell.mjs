#!/usr/bin/env node
// Run by the wrapper outside the sandbox. No build/install or product-repository Git writes.
import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, open, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, screenshot } from '../../../akari-annotations/evidence/timeline-tracks/scripts/cdp-lib.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(here, '../../../../../..');
const shell = join(repo, 'apps/shell');
const resultsDirectory = join(here, 'results');
const resultPath = join(resultsDirectory, 'shell-results.json');
const fixtures = ['scale-x', 'scale-y', 'rotated', 'group-leaf', 'uniform-rotated', 'keyframes', 'legacy-keyframes'];
const execFileAsync = promisify(execFile);
const S = JSON.stringify;
const sha = value => createHash('sha256').update(value).digest('hex');

function expectedBounds(fixture, frame) {
  const [sx, sy] = {
    'scale-x': [2, 1], 'scale-y': [1, 0.5], rotated: [1.5, 0.75],
    'group-leaf': [2.5, 1.25], 'uniform-rotated': [1.25, 1.25], keyframes: [1 + frame / 60, 1],
    'legacy-keyframes': [1 + frame / 60, 1 + frame / 60],
  }[fixture];
  const angle = ['rotated', 'group-leaf', 'uniform-rotated'].includes(fixture) ? Math.PI / 6 : 0;
  return { width: 100 * sx * Math.cos(angle) + 60 * sy * Math.sin(angle),
    height: 100 * sx * Math.sin(angle) + 60 * sy * Math.cos(angle) };
}

async function bounded(promise, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timeout: ${label}`)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

async function assertFreePort(port) {
  await new Promise((resolvePromise, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => server.close(error => error ? reject(error) : resolvePromise()));
  });
}

async function main() {
  const port = Number(process.env.AKARI_CDP_PORT ?? 9837);
  const readyMs = Number(process.env.AKARI_SHELL_L1_TIMEOUT_MS ?? 600000);
  const executable = process.env.ELECTRON_BIN ?? join(repo, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
  await mkdir(resultsDirectory, { recursive: true });
  const report = { startedAt: new Date().toISOString(), executable, port, tolerancePx: 1, pass: false, cases: [] };
  const save = async () => {
    const temporary = `${resultPath}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(report, null, 2) + '\n');
    await rename(temporary, resultPath);
  };
  let interrupted = 0;
  let activeChild;
  const onInterrupt = () => { interrupted = 130; activeChild?.kill('SIGTERM'); };
  const onTerminate = () => { interrupted = 143; activeChild?.kill('SIGTERM'); };
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onTerminate);
  await save(); // A failed startup must not leave a previous PASS behind.
  try {
    if (process.argv.length > 2) throw new Error('usage: bash run-shell.sh (optional NODE_BIN, ELECTRON_BIN, AKARI_CDP_PORT, AKARI_SHELL_L1_TIMEOUT_MS environment variables)');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid AKARI_CDP_PORT');
    if (!Number.isFinite(readyMs) || readyMs <= 0) throw new Error('Invalid AKARI_SHELL_L1_TIMEOUT_MS');
    for (const fixture of fixtures) {
      if (interrupted) break;
      const keyframes = fixture === 'keyframes' || fixture === 'legacy-keyframes';
      const record = { fixture, expectedFrames: keyframes ? [0, 30, 45, 58] : [0],
        pass: false, measurements: [], startedAt: new Date().toISOString() };
      report.cases.push(record);
      await save();
      let workspace, child, closed, logHandle, launchError;
      const connections = new Set();
      try {
        await assertFreePort(port); // Never attach to another lane's Electron.
        workspace = await realpath(await mkdtemp(join(tmpdir(), 'akari-axis-shell-')));
        const project = join(workspace, 'project');
        const userData = join(workspace, 'userdata');
        await cp(join(repo, 'templates/project-default'), project, { recursive: true });
        await cp(join(here, 'fixtures', fixture), project, { recursive: true, force: true });
        await rm(join(project, '.git'), { recursive: true, force: true });
        await mkdir(userData);
        const editPath = join(project, 'edit.json');
        const editUri = pathToFileURL(editPath).href;
        const editBefore = await readFile(editPath);
        const edit = JSON.parse(editBefore);
        if (edit.output.width !== 640 || edit.output.height !== 360 || edit.output.fps !== 30) {
          throw new Error('These geometry fixtures require a 640 × 360, 30 fps output');
        }
        record.project = project;
        record.editSha256 = sha(editBefore);
        if (interrupted) throw new Error('Shell measurement interrupted');
        // Git is confined to the newly copied disposable project, never the product repository.
        const git = (...args) => execFileAsync('git', [
          `--git-dir=${join(project, '.git')}`, `--work-tree=${project}`,
          '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false',
          '-c', 'user.name=AKARI L1 Fixture', '-c', 'user.email=l1-fixture@example.invalid', ...args,
        ], { cwd: project, timeout: 30000 });
        await git('init', '--quiet');
        await git('add', '--all');
        await git('commit', '--quiet', '-m', 'Isolated anisotropic scale fixture');
        if (interrupted) throw new Error('Shell measurement interrupted');
        const logPath = join(resultsDirectory, `shell-${fixture}-electron.log`);
        record.electronLog = logPath;
        logHandle = await open(logPath, 'w');
        child = spawn(executable, [shell, project, `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`,
          '--no-sandbox', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding'], {
          cwd: shell, env: { ...process.env, THEIA_CONFIG_DIR: userData },
          stdio: ['ignore', logHandle.fd, logHandle.fd],
        });
        activeChild = child;
        child.once('error', error => { launchError = error; });
        closed = new Promise(resolvePromise => child.once('close', (code, signal) => {
          record.electronExit = { code, signal };
          resolvePromise();
        }));
        const alive = () => {
          if (interrupted) throw new Error('Shell measurement interrupted');
          if (launchError) throw launchError;
          if (child.exitCode !== null || child.signalCode !== null) {
            throw new Error(`Electron exited before measurement: ${JSON.stringify(record.electronExit ?? { code: child.exitCode, signal: child.signalCode })}`);
          }
        };
        const waitFor = async (label, predicate, milliseconds = 60000) => {
          const deadline = Date.now() + milliseconds;
          let lastError;
          while (Date.now() < deadline) {
            alive();
            try { const value = await predicate(); if (value) return value; }
            catch (error) { lastError = String(error.message ?? error); }
            await sleep(150);
          }
          throw new Error(`timeout: ${label}${lastError ? ` (${lastError})` : ''}`);
        };
        const targets = async () => {
          const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) });
          if (!response.ok) throw new Error(`CDP target list: HTTP ${response.status}`);
          return response.json();
        };
        await waitFor('Electron CDP and initialized_layout ready', async () => {
          const log = await readFile(logPath, 'utf8');
          return log.includes("Changed application state from 'initialized_layout' to 'ready'") && (await targets()).length > 0;
        }, readyMs);
        const connect = async target => {
          const cdp = new CDP(target.webSocketDebuggerUrl);
          connections.add(cdp);
          await bounded(cdp.connect(), 15000, 'CDP connect');
          const send = cdp.send.bind(cdp);
          cdp.send = (method, params) => bounded(send(method, params), 15000, method);
          const contexts = new Map();
          cdp.on('Runtime.executionContextCreated', ({ context }) => contexts.set(context.id, context));
          cdp.on('Runtime.executionContextDestroyed', ({ executionContextId }) => contexts.delete(executionContextId));
          cdp.on('Runtime.executionContextsCleared', () => contexts.clear());
          await cdp.send('Page.enable');
          await cdp.send('Runtime.enable');
          return { cdp, contexts };
        };
        const mainTarget = await waitFor('Theia page', async () => {
          const list = await targets();
          return list.find(target => target.type === 'page' && /localhost/u.test(target.url))
            ?? list.find(target => target.type === 'page');
        });
        const main = await connect(mainTarget);
        await main.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
        await waitFor('Theia frontend', () => evalOn(main.cdp, "Boolean(window.theia?.container && document.readyState === 'complete')"), readyMs);
        await evalOn(main.cdp, `(() => {
          const button=[...document.querySelectorAll('button')].find(node=>node.textContent?.trim()==='開くだけ');
          button?.click(); return true;
        })()`);
        const command = (id, argument) => evalOn(main.cdp, `(async () => {
          const container=window.theia.container;
          const key=[...container._bindingDictionary._map.keys()].find(value=>typeof value==='function'
            && typeof value.prototype?.executeCommand==='function' && typeof value.prototype?.registerCommand==='function');
          if(!key)throw new Error('CommandRegistry unavailable');
          await container.get(key).executeCommand(${S(id)}${argument === undefined ? '' : `, ${S(argument)}`});
          return true;
        })()`);
        await waitFor('timeline command', () => command('akari.annotations.open'), readyMs);
        await waitFor('output preview command', () => command('akari.preview.ensureVisible', { editUri }), readyMs);
        const candidates = new Map([[mainTarget.id, main]]);
        const preview = await waitFor('active preview webview context', async () => {
          for (const target of (await targets()).filter(target => target.type === 'iframe')) {
            if (!candidates.has(target.id)) candidates.set(target.id, await connect(target));
          }
          for (const { cdp, contexts } of candidates.values()) for (const context of contexts.values()) {
            if (context.auxData?.isDefault === false) continue;
            try {
              const found = await evalOn(cdp, `Boolean(window.akari?.state?.editPath===${S(editUri)}
                && window.akari?.interaction?.fragmentBounds && window.akari?.runtime?.tick
                && document.querySelector('#overlay-stage [data-overlay-id="leaf"]')
                && Number(document.getElementById('seek')?.max)>0)`, context.id);
              if (found) return { cdp, contextId: context.id };
            } catch { /* A sibling or disposed execution context. */ }
          }
          return false;
        }, readyMs);
        const pe = expression => evalOn(preview.cdp, expression, preview.contextId);
        // Observe completed production ticks; never invoke tick to manufacture a measurement.
        await pe(`(() => {
          const original=window.akari.runtime.tick;
          const journal=window.__akariAxisL1={sequence:0,seconds:null};
          window.akari.runtime.tick=function(...args) {
            const result=Reflect.apply(original,this,args);
            journal.seconds=args[0]; journal.sequence++; return result;
          };
          return true;
        })()`);
        const seekAndMeasure = async (frame, timeoutMs = 60000) => {
          const seconds = frame / edit.output.fps;
          const sequence = await pe(`(() => {
            const seek=document.getElementById('seek');
            const before=window.__akariAxisL1.sequence;
            seek.step='any'; // Do not quantize frame 59/30 to the range control's millisecond grid.
            seek.value=${S(String(seconds))};
            seek.dispatchEvent(new Event('input',{bubbles:true}));
            seek.dispatchEvent(new Event('change',{bubbles:true}));
            return before;
          })()`);
          return waitFor(`rendered frame ${frame}`, () => pe(`(() => {
            const clock=window.__akariAxisL1;
            if(clock.sequence<=${sequence} || !Number.isFinite(clock.seconds)
              || Math.round(clock.seconds*30)!==${frame})return null;
            const stage=document.getElementById('overlay-stage');
            const container=stage.querySelector('[data-overlay-id="leaf"]');
            if(!container || getComputedStyle(container).visibility!=='visible')return null;
            const stageRect=stage.getBoundingClientRect();
            if(!(stageRect.width>0 && stageRect.height>0))return null;
            const rect=window.akari.interaction.fragmentBounds(container);
            if(!rect || !(rect.width>0 && rect.height>0))return null;
            return { width:rect.width/(stageRect.width/640),height:rect.height/(stageRect.height/360),
              time:clock.seconds,frame:Math.round(clock.seconds*30),tickSequence:clock.sequence,
              seekValue:Number(document.getElementById('seek').value),
              stage:{width:stageRect.width,height:stageRect.height},
              clientBounds:{left:rect.left,top:rect.top,width:rect.width,height:rect.height},
              matrix:getComputedStyle(container).transform,
              scaleX:container.style.getPropertyValue('--scale-x'),scaleY:container.style.getPropertyValue('--scale-y'),
              corners:['nw','ne','se','sw'].map(name=>{
                const marker=container.querySelector('[data-corner="'+name+'"]');
                if(!marker)return null;
                const r=marker.getBoundingClientRect();return {x:r.x,y:r.y};
              }) };
          })()`), timeoutMs);
        };
        await seekAndMeasure(1); // Force an ordinary seek before testing frame 0, even if already paused at 0.
        for (const frame of record.expectedFrames) {
          const measured = await seekAndMeasure(frame);
          const expected = expectedBounds(fixture, frame);
          const delta = { width: measured.width - expected.width, height: measured.height - expected.height };
          const png = join(resultsDirectory, `shell-${fixture}-frame-${frame}.png`);
          let angleErrorDeg = null;
          if (measured.corners.every(Boolean)) {
            const [nw, ne, se] = measured.corners;
            const top = { x: ne.x - nw.x, y: ne.y - nw.y };
            const right = { x: se.x - ne.x, y: se.y - ne.y };
            angleErrorDeg = Math.abs(Math.atan2(top.x * right.x + top.y * right.y,
              top.x * right.y - top.y * right.x) * 180 / Math.PI);
          }
          const geometryPass = !['rotated', 'group-leaf', 'uniform-rotated'].includes(fixture)
            || (angleErrorDeg !== null && angleErrorDeg <= .5);
          const sample = { frame, measured, expected, delta, angleErrorDeg,
            pass: Math.abs(delta.width) <= 1 && Math.abs(delta.height) <= 1 && geometryPass };
          record.measurements.push(sample);
          await save();
          await screenshot(main.cdp, png);
          sample.screenshot = png;
        }
        record.editUnchanged = sha(await readFile(editPath)) === record.editSha256;
        record.pass = record.editUnchanged && record.measurements.length === record.expectedFrames.length
          && record.measurements.every(sample => sample.pass);
        if (keyframes) {
          // Frame 59 also times out for the unchanged uniform-scale control in the shell.
          // Keep its terminal seek observation without making it a parity gate.
          const diagnostic = { frame: 59 };
          record.terminalSeekDiagnostic = diagnostic;
          try {
            diagnostic.measured = await seekAndMeasure(59, 10000);
            diagnostic.status = 'rendered';
          } catch (error) {
            diagnostic.status = 'unavailable';
            diagnostic.error = String(error.message ?? error);
          }
          try {
            diagnostic.lastState = await pe(`(() => {
              const clock=window.__akariAxisL1;
              const seek=document.getElementById('seek');
              return {clock:{seconds:clock?.seconds??null,sequence:clock?.sequence??null},
                seek:{min:seek?.min??null,max:seek?.max??null,value:seek?.value??null}};
            })()`);
          } catch (error) {
            diagnostic.stateError = String(error.message ?? error);
          }
          await save();
        }
      } catch (error) {
        record.error = String(error.stack ?? error);
      } finally {
        for (const cdp of connections) { try { cdp.close(); } catch {} }
        let stopped = true;
        if (child && closed) {
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
          try { await bounded(closed, 5000, 'Electron shutdown'); }
          catch {
            child.kill('SIGKILL');
            try { await bounded(closed, 5000, 'Electron forced shutdown'); }
            catch (error) { stopped = false; record.cleanupError = String(error.message); record.pass = false; }
          }
        }
        activeChild = undefined;
        try {
          await logHandle?.close();
          if (workspace && stopped) await rm(workspace, { recursive: true, force: true });
          record.workspaceRemoved = Boolean(workspace && stopped);
        } catch (error) {
          record.cleanupError = String(error.stack ?? error);
          record.workspaceRemoved = false;
          record.pass = false;
        }
        record.finishedAt = new Date().toISOString();
        await save();
      }
      console.log(`${fixture}: ${record.pass ? 'PASS' : 'FAIL'}`);
    }
  } catch (error) {
    report.error = String(error.stack ?? error);
  } finally {
    process.off('SIGINT', onInterrupt);
    process.off('SIGTERM', onTerminate);
    report.finishedAt = new Date().toISOString();
    report.pass = !interrupted && !report.error && report.cases.length === fixtures.length && report.cases.every(record => record.pass);
    await save();
  }
  if (!report.pass) process.exitCode = interrupted || 1;
  console.log(resultPath);
}

// Both sides are canonicalized so invocation through a symlink still starts the runner.
if (process.argv[1] && await realpath(process.argv[1]) === await realpath(fileURLToPath(import.meta.url))) {
  await main();
}
