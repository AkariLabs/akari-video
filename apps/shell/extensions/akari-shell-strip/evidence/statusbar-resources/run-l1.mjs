import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, cpSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CDP, connectMain, evalMain, realClick, screenshot, sleep } from '../quick-export/cdp-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const shell = path.join(root, 'apps/shell');
const electron = path.join(shell, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const profile = mkdtempSync(path.join(tmpdir(), 'statusbar-resources-l1-'));
const workspace = path.join(profile, 'workspace');
const output = path.dirname(fileURLToPath(import.meta.url));
const port = 9462;
cpSync(path.join(root, 'test-project'), workspace, { recursive: true });
mkdirSync(path.join(profile, '.akari'));
const logs = [];
const child = spawn(electron, [shell, workspace, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-sandbox'], {
    env: { ...process.env, HOME: profile, THEIA_CONFIG_DIR: path.join(profile, '.theia'),
        AKARI_HOME: path.join(profile, '.akari'), AKARI_CREDENTIALS_FILE: path.join(profile, 'credentials.env'),
        ELECTRON_ENABLE_LOGGING: '1' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true
});
child.stdout.on('data', data => logs.push(String(data)));
child.stderr.on('data', data => logs.push(String(data)));

let cdp;
let browserCdp;
const measurements = {};
try {
    for (let attempt = 0; attempt < 90; attempt++) {
        try { if ((await fetch(`http://127.0.0.1:${port}/json/list`)).ok) break; }
        catch { /* Electron has not opened CDP yet. */ }
        await sleep(1000);
    }
    cdp = await connectMain(port);
    for (let attempt = 0; attempt < 90; attempt++) {
        const state = await evalMain(cdp, `({ ready: !!document.querySelector('#theia-app-shell'), hook: !!window.__akariStatusbarResources })`);
        if (state.ready && state.hook) break;
        await sleep(1000);
    }
    await sleep(4200);
    const read = () => evalMain(cdp, `(() => ({
        hook: window.__akariStatusbarResources,
        bar: document.querySelector('#theia-statusBar')?.innerText,
        resourceEntry: Array.from(document.querySelectorAll('#theia-statusBar *')).filter(e => e.textContent?.includes('CPU ') && e.getBoundingClientRect().width > 0).map(e => ({ tag: e.tagName, className: e.className, text: e.textContent, color: getComputedStyle(e).color })).slice(-5),
        popup: document.querySelector('[data-akari-statusbar-popup]')?.outerHTML?.slice(0, 5000)
    }))()`);
    measurements.first = await read();
    await sleep(3500);
    measurements.second = await read();
    const coordinate = await evalMain(cdp, `(() => {
        const e = document.querySelector('.akari-statusbar-mono'); if (!e) return null;
        const r = e.getBoundingClientRect(); return { x: r.x+r.width/2, y: r.y+r.height/2 };
    })()`);
    if (coordinate) await realClick(cdp, coordinate.x, coordinate.y);
    await sleep(500);
    measurements.resourcesPopup = await evalMain(cdp, `(() => ({ text: document.querySelector('[data-akari-statusbar-popup="resources"]')?.innerText,
        rows: Array.from(document.querySelectorAll('[data-akari-resource]')).map(e => ({ key: e.dataset.akariResource, width: e.querySelector('.track i')?.style.width, color: getComputedStyle(e.querySelector('.track i')).backgroundColor })) }))()`);
    await screenshot(cdp, path.join(output, 'resources.png'));
    measurements.partnerStart = await evalMain(cdp, `(async () => {
        const c = window.theia.container;
        const token = Array.from(c._bindingDictionary._map.keys()).find(k => String(k) === 'Symbol(TerminalService)');
        if (!token) return { error: 'TerminalService binding missing' };
        try {
            const terminals = c.get(token);
            const terminal = await terminals.newTerminal({ title: 'L1 パートナー', kind: 'akari-partner', shellPath: '/bin/sh', shellArgs: ['-c', 'sleep 60'], destroyTermOnClose: true, useServerTitle: false });
            await terminal.start();
            await terminals.open(terminal);
            return { id: terminal.id, pid: await terminal.processId };
        } catch (error) { return { error: String(error) }; }
    })()`);
    await sleep(3500);
    measurements.partnerRunning = await evalMain(cdp, `(() => ({ bar: document.querySelector('.akari-statusbar-mono')?.innerText,
        rows: Array.from(document.querySelectorAll('[data-akari-running]')).map(e => ({ id: e.dataset.akariRunning, text: e.innerText })) }))()`);
    await screenshot(cdp, path.join(output, 'partner-running.png'));
    if (measurements.partnerRunning.rows?.length) {
        await evalMain(cdp, `document.querySelector('[data-akari-running] .stop')?.click(); true`);
        await sleep(1500);
        measurements.partnerStopped = await evalMain(cdp, `(() => ({ bar: document.querySelector('.akari-statusbar-mono')?.innerText,
            rows: Array.from(document.querySelectorAll('[data-akari-running]')).map(e => e.dataset.akariRunning) }))()`);
    }
    measurements.theiaGlobal = await evalMain(cdp, `({ hasContainer: !!window.theia?.container, keys: Object.keys(window.theia ?? {}).slice(0, 20) })`);
    measurements.preferenceBindings = await evalMain(cdp, `(() => {
        const c = window.theia?.container;
        const map = c?._bindingDictionary?._map;
        return { containerFields: Object.keys(c ?? {}).slice(0, 20), matches: Array.from(map?.keys?.() ?? []).filter(k => typeof k === 'symbol' && String(k).includes('Preference')).map(String).slice(0, 20) };
    })()`);
    measurements.preferenceToggle = await evalMain(cdp, `(async () => {
        const c = window.theia.container;
        const token = Array.from(c._bindingDictionary._map.keys()).find(k => String(k) === 'Symbol(PreferenceService)');
        const pref = c.get(token);
        const before = document.querySelector('.akari-statusbar-mono')?.innerText;
        try {
            await pref.set('akari.statusBar.cpu', false, 1);
            await pref.set('akari.statusBar.gpu', false, 1);
            await pref.set('akari.statusBar.disk', true, 1);
            await pref.set('akari.statusBar.running', false, 1);
            await new Promise(r => setTimeout(r, 500));
            const after = document.querySelector('.akari-statusbar-mono')?.innerText;
            const rows = Array.from(document.querySelectorAll('[data-akari-resource]')).map(e => e.dataset.akariResource);
            for (const key of ['cpu','gpu','disk','running']) await pref.set('akari.statusBar.' + key, undefined, 1);
            return { before, after, rows };
        } catch (error) { return { before, error: String(error) }; }
    })()`);
    await realClick(cdp, coordinate.x, coordinate.y);
    const accountCoordinate = await evalMain(cdp, `(() => {
        const e = Array.from(document.querySelectorAll('#theia-statusBar .area.left .element')).find(e => e.innerText?.includes('ryoma'));
        if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x+r.width/2, y: r.y+r.height/2 };
    })()`);
    if (accountCoordinate) await realClick(cdp, accountCoordinate.x, accountCoordinate.y);
    await sleep(400);
    measurements.accountPopup = await evalMain(cdp, `(() => ({ text: document.querySelector('[data-akari-statusbar-popup="account"]')?.innerText,
        rows: Array.from(document.querySelectorAll('[data-akari-statusbar-popup="account"] [data-akari-provider]')).map(e => e.dataset.akariProvider) }))()`);
    await screenshot(cdp, path.join(output, 'account.png'));
    measurements.balanceMockInstalled = await evalMain(cdp, `(() => {
        const c = window.theia.container;
        const token = Array.from(c._bindingDictionary._map.keys()).find(k => typeof k === 'function' && k.prototype?.refreshBalances && k.prototype?.renderAccount);
        if (!token) return false;
        const ui = c.get(token);
        window.__akariBalanceMockCalls = 0;
        Object.defineProperty(ui, 'connections', { configurable: true, value: {
            listConnections: async () => ({ providers: [{ id: 'openrouter', label: 'OpenRouter', configured: true }], store: { connected: false } }),
            readBalance: async () => { window.__akariBalanceMockCalls++; return { ok: true, display: '残り $4.72', checked_at: new Date().toISOString() }; }
        } });
        return true;
    })()`);
    if (measurements.balanceMockInstalled && accountCoordinate) {
        await realClick(cdp, accountCoordinate.x, accountCoordinate.y);
        await realClick(cdp, accountCoordinate.x, accountCoordinate.y);
        await sleep(300);
        measurements.balanceCallsBefore = await evalMain(cdp, 'window.__akariBalanceMockCalls');
        await evalMain(cdp, `document.querySelector('[data-akari-balance-refresh]')?.click(); true`);
        await sleep(300);
        measurements.mockBalance = await evalMain(cdp, `(() => ({ calls: window.__akariBalanceMockCalls,
            text: document.querySelector('[data-akari-statusbar-popup="account"]')?.innerText,
            rows: Array.from(document.querySelectorAll('[data-akari-statusbar-popup="account"] [data-akari-provider]')).map(e => e.dataset.akariProvider) }))()`);
        await screenshot(cdp, path.join(output, 'balance.png'));
    }
    const firstProvider = measurements.mockBalance?.rows?.[0] ?? measurements.accountPopup.rows?.[0];
    if (firstProvider) {
        const providerCoordinate = await evalMain(cdp, `(() => { const e = document.querySelector('[data-akari-statusbar-popup="account"] [data-akari-provider]');
            const r = e.getBoundingClientRect(); return { x: r.x+r.width/2, y: r.y+r.height/2 }; })()`);
        await realClick(cdp, providerCoordinate.x, providerCoordinate.y);
        await sleep(700);
        measurements.providerRoute = await evalMain(cdp, `(() => {
            const dialog = document.querySelector('[data-akari-settings-dialog="true"]');
            const section = dialog?.querySelector('[data-akari-settings-section="connections"]');
            const currentNav = dialog?.querySelector('[data-settings-nav][aria-current="true"]');
            const provider = section?.querySelector('[data-akari-provider="${firstProvider}"]');
            return {
                dialogVisible: !!dialog && dialog.getClientRects().length > 0,
                activeSection: dialog?.querySelector('[data-akari-settings-section]:not([hidden])')?.getAttribute('data-akari-settings-section') ?? null,
                sectionVisible: !!section && !section.hidden && section.getClientRects().length > 0,
                heading: section?.querySelector('h2')?.textContent ?? null,
                selectedNav: currentNav?.getAttribute('data-settings-nav') ?? null,
                provider: !!provider, providerVisible: !!provider && provider.getClientRects().length > 0
            };
        })()`);
        await screenshot(cdp, path.join(output, 'settings-route.png'));
    }
    measurements.beforeBlur = await evalMain(cdp, 'window.__akariStatusbarResources?.pollCount');
    await evalMain(cdp, `window.dispatchEvent(new Event('blur')); true`);
    await sleep(4200);
    measurements.afterBlur = await evalMain(cdp, 'window.__akariStatusbarResources?.pollCount');
    await evalMain(cdp, `window.dispatchEvent(new Event('focus')); true`);
    await sleep(1000);
    measurements.afterFocus = await evalMain(cdp, 'window.__akariStatusbarResources?.pollCount');
    const focusState = `({ pollCount: window.__akariStatusbarResources?.pollCount,
        hidden: document.hidden, hasFocus: document.hasFocus() })`;
    measurements.beforeMinimize = await evalMain(cdp, focusState);
    let windowId;
    try {
        const [version, targets] = await Promise.all([
            fetch(`http://127.0.0.1:${port}/json/version`).then(response => response.json()),
            fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json())
        ]);
        const targetId = targets.find(target => target.type === 'page')?.id;
        browserCdp = new CDP(version.webSocketDebuggerUrl);
        await browserCdp.connect();
        const targetWindow = await browserCdp.send('Browser.getWindowForTarget', { targetId });
        windowId = targetWindow.windowId;
        await browserCdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
        await sleep(4200);
        measurements.afterMinimize = await evalMain(cdp, focusState);
        measurements.minimizeSupported = measurements.afterMinimize.hidden || !measurements.afterMinimize.hasFocus;
        if (!measurements.minimizeSupported) measurements.minimizeError = 'Browser.setWindowBounds returned, but the document stayed visible and focused';
    } catch (error) {
        measurements.cdpMinimizeError = String(error);
        try {
            // Electron の CDP は Browser.getWindowForTarget を実装しない版がある。
            // Finder を前面に出し、実ウィンドウが背面になった状態を測る。
            execFileSync('osascript', ['-e', 'tell application "Finder" to activate'], { timeout: 10000 });
            await sleep(4200);
            measurements.afterMinimize = await evalMain(cdp, focusState);
            measurements.minimizeMode = 'finder-background';
            measurements.minimizeSupported = measurements.afterMinimize.hidden || !measurements.afterMinimize.hasFocus;
            if (!measurements.minimizeSupported) measurements.minimizeError = 'Finder was activated, but Electron stayed focused';
        } catch (fallbackError) {
            measurements.minimizeSupported = false;
            measurements.minimizeError = String(fallbackError);
        }
    } finally {
        if (windowId !== undefined) {
            try { await browserCdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } }); }
            catch (error) { measurements.restoreError = String(error); }
        } else if (measurements.minimizeMode === 'finder-background') {
            try {
                execFileSync('osascript', ['-e', 'tell application "Electron" to activate'], { timeout: 10000 });
                await cdp.send('Page.bringToFront');
            } catch (error) { measurements.restoreError = String(error); }
        }
        await sleep(1200);
        try { measurements.afterRestore = await evalMain(cdp, focusState); }
        catch (error) { measurements.restoreError = String(error); }
    }
    measurements.startupError = logs.join('').includes('Failed to start the frontend application.');
} catch (error) {
    measurements.error = String(error);
} finally {
    writeFileSync(path.join(output, 'measurements.json'), JSON.stringify(measurements, null, 2));
    writeFileSync(path.join(output, 'electron-log.txt'), logs.join(''));
    cdp?.close();
    browserCdp?.close();
    try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    const backendPids = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n')
        .filter(line => line.includes('Electron Helper') && line.includes('lib/backend/main.js') && line.includes(profile))
        .map(line => Number(line.trim().split(/\s+/)[0])).filter(Number.isInteger);
    for (const pid of backendPids) { try { process.kill(pid, 'SIGTERM'); } catch { /* already exited */ } }
    await sleep(1500);
    rmSync(profile, { recursive: true, force: true });
    console.log(JSON.stringify(measurements, null, 2));
    process.exit(measurements.error ? 1 : 0);
}
