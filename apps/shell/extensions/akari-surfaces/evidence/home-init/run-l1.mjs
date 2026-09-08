// L1 harness (wrapper-authored, verification-only; not product source).
// task 2026-09-09-home-init-two-seconds
// usage: node run-l1.mjs <label> <port> <outDir> [workspace|-]
//
// Measures, per launch:
//   readyMs        — ms from spawn to Theia's "to 'ready'" line on stdout
//   homeReadyMs    — ms from spawn to the first appearance of [data-akari-home-ready="true"]
//   focusWarns     — Theia "did not accept focus after 2000ms" warnings (per widget id)
//   guardTimeouts  — "[akari-surfaces] layout initialization timed out" warnings
//   measures       — performance measures named "akari-home:*" (start() step breakdown)
//
// Isolation: HOME / THEIA_CONFIG_DIR / --user-data-dir / AKARI_HOME /
// AKARI_CREDENTIALS_FILE all point at a fresh temp profile; the real
// ~/.theia ~/.akari ~/.config/akari-video are never read or written.
// The child is NOT detached and is killed by PID in `finally`.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = process.env.AKARI_L1_REPO ?? path.resolve(HERE, '../../../../../..');
const SHELL = path.join(REPO, 'apps/shell');
const ELECTRON = path.join(REPO, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');

const [, , label, portRaw, outRaw, workspaceRaw] = process.argv;
const workspace = !workspaceRaw || workspaceRaw === '-' ? undefined : workspaceRaw;
const port = Number(portRaw ?? 21990);
const outDir = outRaw ?? path.join(tmpdir(), 'home-init');
mkdirSync(outDir, { recursive: true });

const profile = mkdtempSync(path.join(tmpdir(), 'akari-l1-'));
const akariHome = path.join(profile, '.akari');
mkdirSync(akariHome, { recursive: true });

const log = [];
const text = () => log.join('');
const READY = "to 'ready'";
const t0 = Date.now();
let readyAtMs = null;
const collect = d => {
    log.push(String(d));
    if (readyAtMs === null && text().includes(READY)) readyAtMs = Date.now() - t0;
};

const args = [SHELL];
if (workspace) args.push(workspace);
args.push(`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-sandbox');
const child = spawn(ELECTRON, args, {
    env: {
        ...process.env,
        HOME: profile,
        THEIA_CONFIG_DIR: path.join(profile, '.theia'),
        AKARI_HOME: akariHome,
        AKARI_CREDENTIALS_FILE: path.join(profile, 'credentials.env'),
        ELECTRON_ENABLE_LOGGING: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
});
child.stdout.on('data', collect);
child.stderr.on('data', collect);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const consoleMessages = [];
const measurements = {
    label,
    workspace: workspace ?? null,
    startedAt: new Date(t0).toISOString(),
    pid: child.pid
};

const probe = page => page.evaluate(() => {
    const root = document.querySelector('[data-akari-home-ready]');
    return {
        shellAttached: !!document.querySelector('#theia-app-shell'),
        preloadVisible: !!document.querySelector('.theia-preload'),
        homeAttached: !!document.querySelector('#akari-home-widget'),
        homeReadyAttr: root ? root.getAttribute('data-akari-home-ready') : null,
        homeStage: root ? root.getAttribute('data-akari-home-stage') : null
    };
});

const readMeasures = page => page.evaluate(() => {
    if (typeof performance === 'undefined' || !performance.getEntriesByType) return [];
    return performance.getEntriesByType('measure')
        .filter(e => e.name.startsWith('akari-home'))
        .map(e => ({ name: e.name, startTime: Math.round(e.startTime), duration: Math.round(e.duration * 100) / 100 }));
});

let browser;
// Electron leaves a detached backend helper (ppid=1) behind when only the
// spawned parent is killed. Sweep by --user-data-dir until nothing is left.
const survivors = () => {
    try {
        const out = execFileSync('/bin/ps', ['-eo', 'pid,ppid,args'], { encoding: 'utf8' });
        return out.split('\n')
            .filter(l => l.includes(profile) && !l.includes('/bin/ps'))
            .map(l => Number(l.trim().split(/\s+/)[0]))
            .filter(pid => Number.isInteger(pid) && pid !== process.pid);
    } catch { return []; }
};
const sweep = async () => {
    for (let i = 0; i < 12; i++) {
        const pids = survivors();
        if (pids.length === 0) return 0;
        for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
        await sleep(500);
    }
    return survivors().length;
};

const finish = async () => {
    measurements.readyMs = readyAtMs;
    measurements.reachedReady = readyAtMs !== null;
    measurements.failedToStart = text().includes('Failed to start the frontend application.');
    const all = consoleMessages.concat(text().split('\n'));
    measurements.guardTimeouts = all.filter(m => /layout initialization timed out/.test(m));
    measurements.focusWarns = all.filter(m => /did not accept focus/.test(m));
    measurements.homeFocusWarns = measurements.focusWarns.filter(m => /akari-home-widget/.test(m));
    measurements.consoleErrors = all.filter(m => m.startsWith('error:')).slice(0, 40);
    try { await browser?.close(); } catch { /* ignore */ }
    try { child.kill('SIGKILL'); } catch { /* ignore */ }
    await sleep(1000);
    measurements.leftoverProcesses = await sweep();
    writeFileSync(path.join(outDir, `${label}-log.txt`), text());
    writeFileSync(path.join(outDir, `measurements-${label}.json`), JSON.stringify(measurements, null, 2));
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    console.log(JSON.stringify(measurements, null, 2));
};

try {
    for (let i = 0; i < 120 && !browser; i++) {
        await sleep(1000);
        try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); } catch { /* not up yet */ }
    }
    if (!browser) throw new Error('CDP connect failed');
    const context = browser.contexts()[0];
    let page = context.pages().find(p => !p.url().startsWith('devtools://'));
    for (let i = 0; i < 30 && !page; i++) { await sleep(1000); page = context.pages()[0]; }
    page.on('console', m => consoleMessages.push(`${m.type()}: ${m.text()}`));
    page.on('pageerror', e => { consoleMessages.push(`pageerror: ${e.message}`); log.push(`[pageerror] ${e.message}\n`); });
    // Page-side waits (cheap: playwright polls in-page) instead of a CDP
    // round trip every 100 ms — under load the round trip itself dominated and
    // turned the first-paint number into "time of first observation".
    //   homeSurfaceMs — home surface in the DOM   (both BEFORE and AFTER)
    //   homeReadyMs   — initial data complete     (AFTER only: attribute is new)
    const selectors = {
        homeSurfaceMs: '[data-akari-home-stage]',
        homeReadyMs: '[data-akari-home-ready="true"]'
    };
    const stamp = key => page.waitForSelector(selectors[key], { timeout: 300000 })
        .then(() => { measurements[key] = Date.now() - t0; })
        .catch(() => { measurements[key] = null; });
    const pending = [stamp('homeSurfaceMs'), stamp('homeReadyMs')];
    await page.waitForSelector('#theia-app-shell', { timeout: 240000 });
    measurements.timeline = [];
    for (let i = 0; i < 600; i++) {
        const state = await probe(page).catch(() => null);
        if (state) measurements.timeline.push({ atMs: Date.now() - t0, ...state });
        if (readyAtMs !== null && state && !state.preloadVisible
            && (measurements.homeReadyMs !== undefined || measurements.homeSurfaceMs !== undefined)) break;
        await sleep(1000);
    }
    await Promise.race([Promise.all(pending), sleep(20000)]);
    await sleep(2500);   // let the deferred (post-first-paint) steps land
    Object.assign(measurements, await probe(page));
    measurements.measures = await readMeasures(page).catch(() => []);
    await page.screenshot({ path: path.join(outDir, `${label}.png`) });
    await finish();
    process.exit(measurements.reachedReady ? 0 : 1);
} catch (error) {
    measurements.error = String((error && error.stack) || error);
    await finish();
    process.exit(1);
}
