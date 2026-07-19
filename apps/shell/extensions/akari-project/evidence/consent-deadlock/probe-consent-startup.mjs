#!/usr/bin/env node
// Dependency-free (Node 22+ built-ins only: fetch, WebSocket, child_process, fs) raw-CDP
// startup probe for the project-consent-startup-deadlock fix.
//
// Drives a REAL Electron boot of apps/shell end-to-end through CDP: launches the packaged
// dev build against a scratch workspace with a brand-new --user-data-dir, waits for
// #theia-app-shell to render, then (depending on scenario) waits for the real Theia
// notification toast to appear and clicks its real DOM buttons, exactly the way a human
// would. No service is invoked directly - this exercises the onStart() -> ready ->
// watchOpenRoots() -> handleRoot() -> messages.info() path exactly as production wires it.
//
// Usage: node probe-consent-startup.mjs <appsShellDir> <scratchDir>
//
// Writes screenshots + run-log.json into this evidence directory (__dirname).

import { setTimeout as sleep } from 'node:timers/promises';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, rm, cp, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EVIDENCE_DIR = path.dirname(fileURLToPath(import.meta.url));
const [, , appsShellDirArg, scratchDirArg] = process.argv;
const APPS_SHELL_DIR = appsShellDirArg || process.cwd();
const SCRATCH_DIR = scratchDirArg || '/tmp/consent-deadlock-l1-scratch';
const ELECTRON_BIN = path.join(APPS_SHELL_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const SAMPLE_VIDEO_SRC = path.join(SCRATCH_DIR, 'fixture-sample.mp4');

const PROJECT_CONSENT_MESSAGE_FRAGMENT = 'AKARI Video プロジェクトとして使いますか';
const ACTION_USE = '使う';
const ACTION_OPEN_ONLY = '開くだけ';

const log = [];
function record(step, data) {
  const entry = { t: new Date().toISOString(), step, ...data };
  log.push(entry);
  console.log(`[${step}]`, JSON.stringify(data));
}

class CDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }
  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve());
      this.ws.addEventListener('error', (e) => reject(e));
    });
    this.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const h of this.listeners.get(msg.method) || []) h(msg.params);
      }
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, handler) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(handler);
  }
  close() { this.ws.close(); }
}

async function listTargets(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  return res.json();
}

async function evalMain(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('evalMain failed: ' + JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

async function realClick(cdp, x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await sleep(30);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

async function screenshot(cdp, filePath) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(filePath, Buffer.from(data, 'base64'));
  return filePath;
}

function launchElectron({ workspaceDir, userDataDir, configDir, port }) {
  const proc = spawn(ELECTRON_BIN, [
    APPS_SHELL_DIR,
    workspaceDir,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-sandbox'
  ], {
    env: { ...process.env, THEIA_CONFIG_DIR: configDir },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderrTail = '';
  proc.stderr.on('data', d => { stderrTail = (stderrTail + d.toString()).slice(-4000); });
  return { proc, getStderrTail: () => stderrTail };
}

async function killElectron(handle) {
  if (!handle?.proc || handle.proc.killed || handle.proc.exitCode !== null) return;
  const pid = handle.proc.pid;
  handle.proc.kill('SIGTERM');
  const exited = await Promise.race([
    new Promise(resolve => handle.proc.once('exit', () => resolve(true))),
    sleep(4000).then(() => false)
  ]);
  if (!exited) {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  }
}

// Poll /json/list for the main page target, connect, and wait until the shell is
// TRULY rendered: #theia-app-shell attached to the DOM *and* the .theia-preload
// startup spinner has been removed by FrontendApplication#revealShell() (which only
// runs after startContributions() - i.e. every contribution's onStart(), including
// AkariProjectContribution's - has resolved and the app has reached state 'ready').
// Checking #theia-app-shell alone is NOT sufficient: attachShell() inserts the shell
// into the DOM *behind* the still-visible preload indicator, before revealShell() has
// run - so a naive presence check reports "ready" while the spinner is still on top
// (verified by screenshot during script development: 01-*.png showed the spinner even
// though #theia-app-shell already existed).
async function waitForShellReady(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const started = Date.now();
  let cdp;
  let lastTargets = [];
  while (Date.now() < deadline) {
    try {
      lastTargets = await listTargets(port);
      const mainTarget = lastTargets.find(t => t.type === 'page');
      if (mainTarget) {
        if (!cdp) {
          cdp = new CDP(mainTarget.webSocketDebuggerUrl);
          await cdp.connect();
          await cdp.send('Page.enable');
          await cdp.send('Runtime.enable');
        }
        const ready = await evalMain(cdp, `!!document.getElementById('theia-app-shell') && document.getElementsByClassName('theia-preload').length === 0`).catch(() => false);
        if (ready) {
          return { cdp, elapsedMs: Date.now() - started };
        }
      }
    } catch {
      // CDP port not up yet / target navigating - keep polling.
    }
    await sleep(300);
  }
  throw new Error(`shell (#theia-app-shell + preload spinner removed) did not render within ${timeoutMs}ms (last /json/list: ${JSON.stringify(lastTargets)})`);
}

async function waitForConsentNotification(cdp, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await evalMain(cdp, `(() => {
      const items = Array.from(document.querySelectorAll('.theia-notification-list-item-container'));
      const match = items.find(el => el.textContent.includes(${JSON.stringify(PROJECT_CONSENT_MESSAGE_FRAGMENT)}));
      if (!match) return null;
      const useBtn = match.querySelector('button[data-action="${ACTION_USE}"]');
      const openOnlyBtn = match.querySelector('button[data-action="${ACTION_OPEN_ONLY}"]');
      const r1 = useBtn ? useBtn.getBoundingClientRect() : null;
      const r2 = openOnlyBtn ? openOnlyBtn.getBoundingClientRect() : null;
      return {
        text: match.textContent,
        use: r1 ? { x: r1.left + r1.width / 2, y: r1.top + r1.height / 2 } : null,
        openOnly: r2 ? { x: r2.left + r2.width / 2, y: r2.top + r2.height / 2 } : null
      };
    })()`);
    if (found && found.use && found.openOnly) return found;
    await sleep(300);
  }
  throw new Error(`consent notification did not appear within ${timeoutMs}ms`);
}

async function assertNoConsentNotification(cdp, watchMs) {
  const deadline = Date.now() + watchMs;
  while (Date.now() < deadline) {
    const found = await evalMain(cdp, `(() => {
      const items = Array.from(document.querySelectorAll('.theia-notification-list-item-container'));
      return items.some(el => el.textContent.includes(${JSON.stringify(PROJECT_CONSENT_MESSAGE_FRAGMENT)}));
    })()`);
    if (found) throw new Error('consent notification unexpectedly appeared');
    await sleep(300);
  }
}

async function pathExists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function waitUntil(predicate, timeoutMs, intervalMs = 300) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(intervalMs);
  }
  return false;
}

async function runGit(cwd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', ['-C', cwd, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => stdout += d.toString());
    proc.stderr.on('data', d => stderr += d.toString());
    proc.on('close', code => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr || `git ${args.join(' ')} exited ${code}`)));
  });
}

async function freshWorkspace(name, { withAkari } = {}) {
  const dir = path.join(SCRATCH_DIR, name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await cp(SAMPLE_VIDEO_SRC, path.join(dir, 'sample.mp4'));
  if (withAkari) {
    await mkdir(path.join(dir, '.akari'), { recursive: true });
  }
  return dir;
}

async function main() {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const results = {};

  // ---- Scenario 1+2: no .akari, fresh install -> shell renders -> consent shown -> "使う" ----
  {
    const workspace = await freshWorkspace('ws-use');
    const userData = path.join(SCRATCH_DIR, 'userdata-use');
    const config = path.join(SCRATCH_DIR, 'config-use');
    await rm(userData, { recursive: true, force: true });
    await rm(config, { recursive: true, force: true });
    await mkdir(userData, { recursive: true });
    await mkdir(config, { recursive: true });
    const handle = launchElectron({ workspaceDir: workspace, userDataDir: userData, configDir: config, port: 9421 });
    try {
      const { cdp, elapsedMs } = await waitForShellReady(9421, 60000);
      record('scenario1-shell-ready', { elapsedMs, akariDirExists: await pathExists(path.join(workspace, '.akari')) });
      await screenshot(cdp, path.join(EVIDENCE_DIR, '01-boot-no-akari-shell-ready.png'));
      results.scenario1 = { elapsedMs, pass: elapsedMs <= 60000 };

      const consent = await waitForConsentNotification(cdp, 15000);
      record('scenario2-consent-shown', { text: consent.text });
      await screenshot(cdp, path.join(EVIDENCE_DIR, '02-consent-prompt-shown.png'));

      await realClick(cdp, consent.use.x, consent.use.y);
      const created = await waitUntil(() => pathExists(path.join(workspace, '.akari')), 10000);
      await sleep(500);
      await screenshot(cdp, path.join(EVIDENCE_DIR, '03-consent-use-akari-created.png'));
      record('scenario2-akari-created', { created });
      results.scenario2 = { pass: created };
    } finally {
      await killElectron(handle);
    }
  }

  // ---- Scenario 3a: no .akari, "開くだけ" -> no .akari created ----
  const workspaceOpenOnly = await freshWorkspace('ws-open-only');
  const userDataOpenOnly = path.join(SCRATCH_DIR, 'userdata-open-only');
  const configOpenOnly = path.join(SCRATCH_DIR, 'config-open-only');
  await rm(userDataOpenOnly, { recursive: true, force: true });
  await rm(configOpenOnly, { recursive: true, force: true });
  await mkdir(userDataOpenOnly, { recursive: true });
  await mkdir(configOpenOnly, { recursive: true });
  {
    const handle = launchElectron({ workspaceDir: workspaceOpenOnly, userDataDir: userDataOpenOnly, configDir: configOpenOnly, port: 9422 });
    try {
      const { cdp, elapsedMs } = await waitForShellReady(9422, 60000);
      record('scenario3a-shell-ready', { elapsedMs });
      const consent = await waitForConsentNotification(cdp, 15000);
      await screenshot(cdp, path.join(EVIDENCE_DIR, '04-consent-prompt-before-open-only.png'));
      await realClick(cdp, consent.openOnly.x, consent.openOnly.y);
      await sleep(1500);
      const akariExists = await pathExists(path.join(workspaceOpenOnly, '.akari'));
      await screenshot(cdp, path.join(EVIDENCE_DIR, '05-consent-open-only-no-akari.png'));
      record('scenario3a-open-only-result', { akariExists });
      results.scenario3a = { pass: akariExists === false, elapsedMs };
    } finally {
      await killElectron(handle);
    }
  }

  // ---- Scenario 3b: reopen the SAME workspace + SAME user-data-dir -> remembers 'open-only', no prompt, still starts ----
  {
    const handle = launchElectron({ workspaceDir: workspaceOpenOnly, userDataDir: userDataOpenOnly, configDir: configOpenOnly, port: 9423 });
    try {
      const { cdp, elapsedMs } = await waitForShellReady(9423, 60000);
      record('scenario3b-shell-ready-on-restart', { elapsedMs });
      await assertNoConsentNotification(cdp, 5000);
      await screenshot(cdp, path.join(EVIDENCE_DIR, '06-restart-open-only-remembered-no-prompt.png'));
      const akariExists = await pathExists(path.join(workspaceOpenOnly, '.akari'));
      record('scenario3b-result', { akariExists, elapsedMs });
      results.scenario3b = { pass: akariExists === false, elapsedMs };
    } finally {
      await killElectron(handle);
    }
  }

  // ---- Scenario 4: workspace WITH pre-existing .akari -> starts normally, no prompt, project watch functions (regression) ----
  {
    const workspace = await freshWorkspace('ws-existing-akari', { withAkari: true });
    const userData = path.join(SCRATCH_DIR, 'userdata-existing');
    const config = path.join(SCRATCH_DIR, 'config-existing');
    await rm(userData, { recursive: true, force: true });
    await rm(config, { recursive: true, force: true });
    await mkdir(userData, { recursive: true });
    await mkdir(config, { recursive: true });
    const handle = launchElectron({ workspaceDir: workspace, userDataDir: userData, configDir: config, port: 9424 });
    try {
      const { cdp, elapsedMs } = await waitForShellReady(9424, 60000);
      record('scenario4-shell-ready', { elapsedMs });
      await assertNoConsentNotification(cdp, 5000);
      await screenshot(cdp, path.join(EVIDENCE_DIR, '07-existing-akari-no-prompt.png'));

      const eventsDirReady = await waitUntil(() => pathExists(path.join(workspace, '.akari', 'events')), 10000);
      const gitInitialized = await waitUntil(() => pathExists(path.join(workspace, '.git')), 10000);
      record('scenario4-watch-bootstrap', { eventsDirReady, gitInitialized });

      const eventPath = path.join(workspace, '.akari', 'events', 'evt-l1-probe.json');
      await writeFile(eventPath, JSON.stringify({
        version: 1,
        id: 'evt-l1-probe',
        type: 'edit-completed',
        occurredAt: new Date().toISOString()
      }));
      const committed = await waitUntil(async () => {
        try {
          const { stdout } = await runGit(workspace, ['log', '--oneline']);
          return stdout.includes('編集を完了');
        } catch { return false; }
      }, 10000);
      const { stdout: gitLog } = await runGit(workspace, ['log', '--oneline']).catch(() => ({ stdout: '(git log failed)' }));
      record('scenario4-watch-commit', { committed, gitLog: gitLog.trim() });
      await screenshot(cdp, path.join(EVIDENCE_DIR, '08-existing-akari-watch-commit.png'));
      results.scenario4 = { pass: eventsDirReady && gitInitialized && committed, elapsedMs };
    } finally {
      await killElectron(handle);
    }
  }

  await writeFile(path.join(EVIDENCE_DIR, 'run-log.json'), JSON.stringify(log, null, 2));
  await writeFile(path.join(EVIDENCE_DIR, 'results.json'), JSON.stringify(results, null, 2));

  const allPass = Object.values(results).every(r => r.pass);
  console.log('RESULTS', JSON.stringify(results, null, 2));
  if (!allPass) {
    console.error('FAILED: one or more scenarios did not pass.');
    process.exit(1);
  }
  console.log('SUCCESS: all consent-startup-deadlock scenarios passed.');
}

main().catch(err => {
  console.error('FAILED', err);
  process.exit(1);
});
