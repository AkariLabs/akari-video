// L1 harness (wrapper-authored, verification-only; not committed as product source).
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from '/Users/ryoma/_edit/30_products/akari-video-wt/right-dock-tabs-always/node_modules/playwright-core/index.mjs';

const REPO = '/Users/ryoma/_edit/30_products/akari-video-wt/right-dock-tabs-always';
const SHELL = path.join(REPO, 'apps/shell');
const ELECTRON = path.join(REPO, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const [, , workspace, label, portRaw] = process.argv;
const port = Number(portRaw ?? 21990);
const outDir = '/tmp/right-dock-tabs-always/out';
const profile = mkdtempSync(path.join(tmpdir(), 'akari-l1-'));
const log = [];

const child = spawn(ELECTRON, [SHELL, workspace, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-sandbox'], {
    env: { ...process.env, HOME: profile, THEIA_CONFIG_DIR: path.join(profile, '.theia'), ELECTRON_ENABLE_LOGGING: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
});
child.stdout.on('data', d => log.push(String(d)));
child.stderr.on('data', d => log.push(String(d)));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const text = () => log.join('');
const finish = async (measurements) => {
    measurements.reachedReady = text().includes("to 'ready'");
    measurements.failedToStart = text().includes('Failed to start the frontend application.');
    writeFileSync(path.join(outDir, `${label}-log.txt`), text());
    writeFileSync(path.join(outDir, `measurements-${label}.json`), JSON.stringify(measurements, null, 2));
    try { child.kill('SIGKILL'); } catch {}
    await sleep(500);
    rmSync(profile, { recursive: true, force: true });
    console.log(JSON.stringify(measurements, null, 2));
};

const readState = page => page.evaluate(() => {
    const tabs = [...document.querySelectorAll('#theia-right-content-panel .lm-TabBar-tab')]
        .filter(tab => tab.offsetParent !== null || tab.getClientRects().length > 0)
        .map(tab => {
            const r = tab.getBoundingClientRect();
            return {
                label: tab.getAttribute('title') || tab.textContent.trim(),
                text: tab.textContent.trim(),
                icon: (tab.querySelector('.lm-TabBar-tabIcon') || {}).className || null,
                rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
                closable: tab.classList.contains('lm-mod-closable'),
                closeIconVisible: [...tab.querySelectorAll('.lm-TabBar-tabCloseIcon')]
                    .some(n => n.getClientRects().length > 0 && getComputedStyle(n).display !== 'none')
            };
        });
    const t = sel => { const n = document.querySelector(sel); return n ? n.textContent.trim() : null; };
    return {
        tabs,
        preloadVisible: !!document.querySelector('.theia-preload'),
        homeAttached: !!document.querySelector('#akari-home-widget'),
        daihonAttached: !!document.querySelector('#akari-daihon-widget'),
        cutsAttached: !!document.querySelector('#akari-cuts-widget'),
        reviewAttached: !!document.querySelector('#akari-review-panel-widget'),
        partnerAttached: !!document.querySelector('#akari-partner-onboarding'),
        daihonFooter: t('.akari-daihon-widget .akari-daihon-footer'),
        cutsNotice: t('[data-akari-cuts="true"] p[role="status"]')
    };
});

let browser;
const measurements = { label, workspace, timeline: [] };
try {
    for (let i = 0; i < 90 && !browser; i++) {
        await sleep(1000);
        try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); } catch { /* not up yet */ }
    }
    if (!browser) throw new Error('CDP connect failed');
    const context = browser.contexts()[0];
    let page = context.pages().find(p => !p.url().startsWith('devtools://'));
    for (let i = 0; i < 30 && !page; i++) { await sleep(1000); page = context.pages()[0]; }
    page.on('pageerror', e => log.push(`[pageerror] ${e.message}\n`));
    await page.waitForSelector('#theia-app-shell', { timeout: 180000 });
    for (let i = 0; i < 24; i++) {           // up to 4 minutes, sample every 10 s
        await sleep(10000);
        const state = await readState(page);
        measurements.timeline.push({ atSeconds: (i + 1) * 10, ready: text().includes("to 'ready'"), tabs: state.tabs.map(x => x.label), preloadVisible: state.preloadVisible });
        if (text().includes("to 'ready'") && state.tabs.length >= 4) break;
    }
    await sleep(3000);
    Object.assign(measurements, await readState(page));
    await page.screenshot({ path: path.join(outDir, `${label}.png`) });
    for (const [name, needle] of [['daihon', '台本'], ['cuts', 'カット'], ['review', '注釈']]) {
        try {
            const tab = await page.$(`#theia-right-content-panel .lm-TabBar-tab[title*="${needle}"]`);
            if (!tab) continue;
            await tab.click({ timeout: 8000 });
            await sleep(2500);
            await page.screenshot({ path: path.join(outDir, `${label}-${name}.png`) });
            measurements[`${name}Expanded`] = await readState(page);
        } catch (error) { measurements[`${name}ClickError`] = String(error).split('\n')[0]; }
    }
    await finish(measurements);
    process.exit(0);
} catch (error) {
    measurements.error = String(error && error.stack || error);
    await finish(measurements);
    process.exit(1);
}
