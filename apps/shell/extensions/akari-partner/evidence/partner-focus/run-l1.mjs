// L1 harness (wrapper-authored, verification-only; not product source).
// task 2026-09-09-partner-tab-focus-warning
// usage: node run-l1.mjs <label> <port> <outDir>
//
// Measures, per launch:
//   readyMs             — ms from spawn to Theia's "to 'ready'" line
//   focusWarnIds        — unique widget ids in "did not accept focus after 2000ms: <id>"
//   focusWarnLines      — the matching lines (stdout + renderer console, deduped)
//   partnerAttached     — whether #akari-partner-onboarding is in the DOM
//   leftoverProcesses   — processes still holding the temp profile after the kill sweep
//
// Isolation: HOME / THEIA_CONFIG_DIR / --user-data-dir / AKARI_HOME /
// AKARI_CREDENTIALS_FILE all point at a fresh temp profile; the real
// ~/.theia ~/.akari ~/.config/akari-video are never read or written.
// The child is NOT detached and is killed by PID in `finish()`.
// Paths are redacted (<WORKTREE> / <HOME> / <TMP>) before anything is written.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = process.env.AKARI_L1_REPO ?? path.resolve(HERE, '../../../../../..');
const SHELL = path.join(REPO, 'apps/shell');
const ELECTRON = process.env.AKARI_L1_ELECTRON
    ?? path.join(REPO, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');

const [, , label, portRaw, outRaw] = process.argv;
const port = Number(portRaw ?? 21991);
const outDir = outRaw ?? path.join(tmpdir(), 'partner-focus');
mkdirSync(outDir, { recursive: true });

const profile = mkdtempSync(path.join(tmpdir(), 'akari-l1-'));
const akariHome = path.join(profile, '.akari');
mkdirSync(akariHome, { recursive: true });

// 証跡に作業機のパスを残さない（harness/wrapper-codex.md）
const TMPROOT = path.resolve(tmpdir());
const redact = value => String(value)
    .split(REPO).join('<WORKTREE>')
    .split(TMPROOT).join('<TMP>')
    .split('/private<TMP>').join('<TMP>')
    .split(homedir()).join('<HOME>');

const log = [];
const text = () => log.join('');
const READY = "to 'ready'";
const t0 = Date.now();
let readyAtMs = null;
const collect = d => {
    log.push(String(d));
    if (readyAtMs === null && text().includes(READY)) readyAtMs = Date.now() - t0;
};

const args = [SHELL, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-sandbox'];
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
const measurements = { label, startedAt: new Date(t0).toISOString(), pid: child.pid };

const probe = page => page.evaluate(() => ({
    shellAttached: !!document.querySelector('#theia-app-shell'),
    preloadVisible: !!document.querySelector('.theia-preload'),
    partnerAttached: !!document.querySelector('#akari-partner-onboarding'),
    homeAttached: !!document.querySelector('#akari-home-widget')
}));

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

const FOCUS_WARN = /did not accept focus after \d+ms: ?([A-Za-z0-9_.:-]+)/;

const finish = async () => {
    measurements.readyMs = readyAtMs;
    measurements.reachedReady = readyAtMs !== null;
    measurements.failedToStart = text().includes('Failed to start the frontend application.');
    const all = consoleMessages.concat(text().split('\n')).map(line => line.trim());
    const warns = all.filter(m => /did not accept focus/.test(m));
    // stdout（ELECTRON_ENABLE_LOGGING）と CDP console に同じ警告が二重に出るため
    // 「widget id の集合」で数える。契約の「N 件」はこの unique id の数。
    const ids = new Set();
    for (const line of warns) {
        const m = line.match(FOCUS_WARN);
        ids.add(m && m[1] ? m[1] : '(unknown)');
    }
    measurements.focusWarnIds = [...ids].sort();
    measurements.focusWarnCount = ids.size;
    measurements.focusWarnLines = [...new Set(warns.map(redact))];
    measurements.partnerFocusWarn = [...ids].some(id => id.includes('akari-partner-onboarding'));
    measurements.guardTimeouts = all.filter(m => /layout initialization timed out/.test(m)).map(redact);
    measurements.consoleErrors = [...new Set(all.filter(m => m.startsWith('error:')).map(redact))].slice(0, 40);
    try { await browser?.close(); } catch { /* ignore */ }
    try { child.kill('SIGKILL'); } catch { /* ignore */ }
    await sleep(1000);
    measurements.leftoverProcesses = await sweep();
    writeFileSync(path.join(outDir, `${label}-log.txt`), redact(text()));
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
    await page.waitForSelector('#theia-app-shell', { timeout: 240000 });
    measurements.timeline = [];
    for (let i = 0; i < 600; i++) {
        const state = await probe(page).catch(() => null);
        if (state) measurements.timeline.push({ atMs: Date.now() - t0, ...state });
        if (readyAtMs !== null && state && !state.preloadVisible && state.partnerAttached) break;
        await sleep(1000);
    }
    // 警告は activation から 2000ms 後に出る。ready 後に十分な猶予を取る。
    await sleep(8000);
    Object.assign(measurements, await probe(page));
    await page.screenshot({ path: path.join(outDir, `${label}.png`) });
    await finish();
    process.exit(measurements.reachedReady ? 0 : 1);
} catch (error) {
    measurements.error = redact((error && error.stack) || error);
    await finish();
    process.exit(1);
}
