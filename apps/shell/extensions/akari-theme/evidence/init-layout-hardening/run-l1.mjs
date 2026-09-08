// L1 harness (wrapper-authored, verification-only; not product source).
// usage: node run-l1.mjs <workspace|-> <label> <port> <outDir>
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = process.env.AKARI_L1_REPO ?? path.resolve(HERE, '../../../../../..');
const SHELL = path.join(REPO, 'apps/shell');
const ELECTRON = path.join(REPO, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');

const [, , workspaceRaw, label, portRaw, outRaw] = process.argv;
const workspace = workspaceRaw === '-' ? undefined : workspaceRaw;
const port = Number(portRaw ?? 21990);
const outDir = outRaw ?? '/tmp/init-layout-hardening';
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

const readState = page => page.evaluate(() => {
    const tabs = sel => [...document.querySelectorAll(`${sel} .lm-TabBar-tab`)]
        .filter(t => t.getClientRects().length > 0)
        .map(t => (t.getAttribute('title') || t.textContent || '').trim());
    return {
        preloadVisible: !!document.querySelector('.theia-preload'),
        shellAttached: !!document.querySelector('#theia-app-shell'),
        rightTabs: tabs('#theia-right-content-panel'),
        leftIcons: [...document.querySelectorAll('#theia-left-content-panel .lm-TabBar-tab')].length,
        mainTabs: tabs('#theia-main-content-panel'),
        homeAttached: !!document.querySelector('#akari-home-widget'),
        daihonAttached: !!document.querySelector('#akari-daihon-widget'),
        cutsAttached: !!document.querySelector('#akari-cuts-widget'),
        reviewAttached: !!document.querySelector('#akari-review-panel-widget'),
        partnerAttached: !!document.querySelector('#akari-partner-onboarding'),
        // card layout gap (akari-shell-card-layout) — proves that contribution ran
        gapApplied: [...document.querySelectorAll('.lm-SplitPanel-handle')].length > 0
    };
});

const measurements = { label, workspace: workspace ?? null, startedAt: new Date(t0).toISOString() };
let browser;
const finish = async () => {
    measurements.readyMs = readyAtMs;
    measurements.reachedReady = readyAtMs !== null;
    measurements.failedToStart = text().includes('Failed to start the frontend application.');
    measurements.guardWarnings = consoleMessages.filter(m => /layout initialization/.test(m));
    measurements.consoleErrors = consoleMessages.filter(m => m.startsWith('error:')).slice(0, 40);
    writeFileSync(path.join(outDir, `${label}-log.txt`), text());
    writeFileSync(path.join(outDir, `measurements-${label}.json`), JSON.stringify(measurements, null, 2));
    try { await browser?.close(); } catch { /* ignore */ }
    try { child.kill('SIGKILL'); } catch { /* ignore */ }
    await sleep(800);
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    console.log(JSON.stringify(measurements, null, 2));
};

try {
    for (let i = 0; i < 90 && !browser; i++) {
        await sleep(1000);
        try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); } catch { /* not up yet */ }
    }
    if (!browser) throw new Error('CDP connect failed');
    const context = browser.contexts()[0];
    let page = context.pages().find(p => !p.url().startsWith('devtools://'));
    for (let i = 0; i < 30 && !page; i++) { await sleep(1000); page = context.pages()[0]; }
    page.on('console', m => consoleMessages.push(`${m.type()}: ${m.text()}`));
    page.on('pageerror', e => { consoleMessages.push(`pageerror: ${e.message}`); log.push(`[pageerror] ${e.message}\n`); });
    await page.waitForSelector('#theia-app-shell', { timeout: 180000 });
    measurements.timeline = [];
    for (let i = 0; i < 24; i++) {           // up to 2 minutes, sample every 5 s
        await sleep(5000);
        const state = await readState(page);
        measurements.timeline.push({ atSeconds: (i + 1) * 5, ready: readyAtMs !== null, preloadVisible: state.preloadVisible });
        if (readyAtMs !== null && !state.preloadVisible) break;
    }
    await sleep(3000);
    Object.assign(measurements, await readState(page));
    await page.screenshot({ path: path.join(outDir, `${label}.png`) });
    await finish();
    process.exit(measurements.reachedReady ? 0 : 1);
} catch (error) {
    measurements.error = String((error && error.stack) || error);
    await finish();
    process.exit(1);
}
