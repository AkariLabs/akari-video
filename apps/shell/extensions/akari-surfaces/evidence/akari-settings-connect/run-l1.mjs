import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { connectMain, evalMain, realClick, screenshot, sleep } from '../../../akari-shell-strip/evidence/quick-export/cdp-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../../../..');
const shell = path.join(root, 'apps/shell');
const output = path.resolve(process.argv[2] || process.env.AKARI_L1_OUT || path.join(tmpdir(), 'akari-settings-connect-l1'));
const profile = mkdtempSync(path.join(tmpdir(), 'akari-settings-connect-profile-'));
const workspace = path.join(profile, 'workspace');
const port = 9441;
const electron = process.env.AKARI_L1_ELECTRON || [
    path.join(shell, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
    path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
].find(existsSync);
if (!electron) throw new Error('Electron executable not found');
mkdirSync(output, { recursive: true });
mkdirSync(path.join(profile, 'tmp'));
mkdirSync(path.join(profile, '.akari'));
cpSync(path.join(root, 'test-project'), workspace, { recursive: true });
const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;
for (const name of Object.keys(childEnv)) {
    if (/(?:_KEY|_TOKEN|_SECRET|API_KEY|PASSWORD|CREDENTIAL)/i.test(name)) delete childEnv[name];
}
const child = spawn(electron, [shell, workspace, `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(profile, 'electron')}`,
    '--no-sandbox', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'], {
    env: { ...childEnv, HOME: profile, AKARI_HOME: path.join(profile, '.akari'), TMPDIR: path.join(profile, 'tmp'),
        THEIA_CONFIG_DIR: path.join(profile, '.theia'), AKARI_CREDENTIALS_FILE: path.join(profile, '.akari', 'credentials.env') },
    stdio: 'ignore', detached: true
});
const result = { checks: {}, screenshots: [] };
const check = (name, value) => { result.checks[name] = !!value; };
let cdp;
let childExited = false;
const childExit = new Promise(resolve => {
    child.once('exit', () => { childExited = true; resolve(); });
    child.once('error', () => { childExited = true; resolve(); });
});
const registry = `(() => { const c = window.theia.container; const key = Array.from(c._bindingDictionary._map.keys()).find(k => typeof k === 'function' && k.prototype && typeof k.prototype.registerCommand === 'function' && typeof k.prototype.executeCommand === 'function' && typeof k.prototype.getCommand === 'function'); return c.get(key); })()`;
const command = (id, arg) => evalMain(cdp, `(() => { void ${registry}.executeCommand(${JSON.stringify(id)}, ${JSON.stringify(arg)}); return true; })()`);
const waitFor = async (expression, label, timeoutMs = 20000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await evalMain(cdp, expression)) return;
        await sleep(250);
    }
    throw new Error(`Timed out: ${label}`);
};
const state = () => evalMain(cdp, `(() => ({ pillars: [...document.querySelectorAll('[data-settings-nav]')].map(e => e.dataset.settingsNav),
    selected: document.querySelector('[data-settings-nav][aria-current="true"]')?.dataset.settingsNav,
    page: document.querySelector('[data-akari-settings-section]:not([hidden])')?.dataset.akariSettingsSection,
    detail: document.querySelector('[data-connect-detail]')?.dataset.connectDetail }))()`);
const click = async selector => {
    const r = await evalMain(cdp, `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
    if (!r) throw new Error(`Missing: ${selector}`);
    await realClick(cdp, r.x, r.y);
    await sleep(350);
};
const shot = async name => { const file = path.join(output, `${name}.png`); await screenshot(cdp, file); result.screenshots.push(name); };
const stopChild = async () => {
    if (!childExited && child.pid) {
        try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
        await Promise.race([childExit, sleep(10000)]);
        if (!childExited) {
            try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
            await Promise.race([childExit, sleep(5000)]);
        }
    }
    return childExited;
};
const close = async () => {
    await evalMain(cdp, `document.querySelector('[data-akari-settings-dialog] button')?.focus()`);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    for (let i = 0; i < 20; i++) {
        if (await evalMain(cdp, `!document.querySelector('[data-akari-settings-dialog]')`)) return;
        await sleep(200);
    }
    throw new Error('Settings dialog did not close');
};
try {
    for (let i = 0; i < 120; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/json/list`)).ok) break; } catch { /* 起動待ちを続ける。 */ } await sleep(1000); }
    cdp = await connectMain(port);
    await waitFor(`(() => { const preload = document.querySelector('.theia-preload'); return (
        !preload || getComputedStyle(preload).display === 'none' || getComputedStyle(preload).visibility === 'hidden' ||
        getComputedStyle(preload).opacity === '0') &&
        !!document.querySelector('#shell-tab-akari-settings-opener'); })()`, 'shell ready', 120000);
    await command('akari.settings.open', { section: 'account' });
    await waitFor(`!!document.querySelector('[data-akari-settings-dialog]')`, 'settings open');
    check('six-pillars', JSON.stringify((await state()).pillars) === JSON.stringify(['general', 'partner', 'connect', 'workflow', 'display', 'data']));
    for (const id of ['general', 'partner', 'connect', 'workflow', 'display', 'data']) {
        await click(`[data-settings-nav="${id}"]`);
        await waitFor(`(() => { const nav=document.querySelector('[data-settings-nav="${id}"]'); const page=document.querySelector('[data-akari-settings-section]:not([hidden])');
            return nav?.getAttribute('aria-current') === 'true' && !!page?.querySelector('h2 + .akari-set-lead'); })()`, `${id} page`);
        const now = await state();
        check(`pillar-${id}`, now.selected === id);
        if (id === 'partner') {
            await waitFor(`Array.from(document.querySelectorAll('[data-akari-settings-section="partner"] .akari-set-partner-chip'))
                .some(item => item.textContent.trim() !== '準備中')`, 'partner status', 20000);
            check('partner-status', true);
        }
        if (id === 'connect') {
            await waitFor(`document.querySelectorAll('[data-connect-id]').length >= 18`, 'connector cards');
            check('connector-rows', await evalMain(cdp, `document.querySelectorAll('[data-connect-id]').length >= 18`));
        }
        await shot(id);
    }
    await click('[data-settings-nav="connect"]');
    check('fallback-default-off', await evalMain(cdp, `document.querySelector('.akari-connect-view footer input[type="checkbox"]')?.checked === false`));
    await click('[data-connect-id="runway"]');
    check('runway-enabled-before', await evalMain(cdp, `document.querySelector('[data-connect-detail="runway"] .akari-connect-toggle input')?.checked === true`));
    await click('[data-connect-detail="runway"] .akari-connect-toggle input');
    await waitFor(`document.querySelector('[data-connect-detail="runway"] .akari-connect-toggle input')?.checked === false`, 'runway disabled');
    const connectors = path.join(profile, '.akari', 'connectors.json');
    check('runway-saved-disabled', existsSync(connectors) && JSON.parse(readFileSync(connectors, 'utf8')).enabled?.runway === false);
    await click('[data-connect-id="fal"]');
    check('fal-password-input', await evalMain(cdp, `document.querySelector('[data-connect-key-input="fal"]')?.type === 'password'`));
    check('key-chat-warning', await evalMain(cdp, `document.querySelector('[data-connect-detail="fal"] .akari-connect-key small')?.textContent.includes('チャットには貼らないでください')`));
    await evalMain(cdp, `(() => { const e=document.querySelector('[data-connect-key-input="fal"]'); const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(e,'fake-settings-WXYZ'); e.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
    await click('[data-connect-key-save="fal"]');
    await waitFor(`document.querySelector('[data-connect-masked-tail="fal"]')?.textContent === '••••WXYZ'`, 'fal masked tail');
    check('masked-tail', await evalMain(cdp, `document.querySelector('[data-connect-masked-tail="fal"]')?.textContent === '••••WXYZ'`));
    await shot('fal-after-save');
    await close();
    await command('akari.connect.open');
    await waitFor(`document.querySelector('[data-settings-nav="connect"]')?.getAttribute('aria-current') === 'true'`, 'connect command');
    check('command-connect', (await state()).selected === 'connect');
    await click('[data-connect-id="runway"]');
    check('runway-reopen-disabled', await evalMain(cdp, `document.querySelector('[data-connect-detail="runway"] .akari-connect-toggle input')?.checked === false`));
    await close();
    await command('akari.connect.open', { id: 'fal' });
    await waitFor(`!!document.querySelector('[data-connect-detail="fal"]')`, 'fal command detail');
    check('command-fal-detail', (await state()).detail === 'fal');
    check('reopen-preserves-tail', await evalMain(cdp, `document.querySelector('[data-connect-masked-tail="fal"]')?.textContent === '••••WXYZ'`));
    await shot('fal-after-reopen');
    await close();
    check('closed-before-rail', await evalMain(cdp, `!document.querySelector('[data-akari-settings-dialog]')`));
    await click('#theia-left-content-panel [data-akari-rail-id="akari-connect-opener"]');
    await waitFor(`document.querySelector('[data-settings-nav="connect"]')?.getAttribute('aria-current') === 'true'`, 'rail connect');
    check('rail-connect', (await state()).selected === 'connect');
    await shot('rail-connect');
    await click('[data-settings-detail="ai-models"]');
    check('ai-models', (await state()).page === 'ai-models');
    await click('[data-settings-nav="partner"]');
    check('permission-mode', await evalMain(cdp, `!!document.querySelector('[data-akari-settings-section="partner"] [data-akari-dropdown="パートナーの権限"]')`));
    await click('[data-settings-nav="workflow"]');
    await click('[data-settings-detail="notifications"]');
    check('notifications', await evalMain(cdp, `!!document.querySelector('[data-akari-settings-section="notifications"] [role="switch"]')`));
    const before = await evalMain(cdp, `document.querySelector('[data-akari-settings-section="notifications"] [role="switch"]')?.getAttribute('aria-checked')`);
    await click('[data-akari-settings-section="notifications"] [role="switch"]');
    const after = await evalMain(cdp, `document.querySelector('[data-akari-settings-section="notifications"] [role="switch"]')?.getAttribute('aria-checked')`);
    check('notification-toggle', before !== after);
    const credential = path.join(profile, '.akari', 'credentials.env');
    check('credential-file', existsSync(credential) && readFileSync(credential, 'utf8').includes('fake-settings-WXYZ'));
    check('settings-file-has-no-key', !existsSync(connectors) || !readFileSync(connectors, 'utf8').includes('fake-settings-WXYZ'));
} catch (error) {
    result.error = String(error);
} finally {
    try { cdp?.close(); } catch { /* 終了処理を続ける。 */ }
    try {
        if (await stopChild()) rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
        else result.cleanupError = 'Electron did not exit after SIGKILL';
    } catch (error) { result.cleanupError = String(error); }
    writeFileSync(path.join(output, 'measurements.json'), JSON.stringify(result, null, 2));
}
console.log(JSON.stringify(result));
if (result.error || Object.values(result.checks).some(value => !value)) process.exitCode = 1;
