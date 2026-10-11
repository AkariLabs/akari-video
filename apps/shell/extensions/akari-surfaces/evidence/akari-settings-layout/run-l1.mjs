import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { connectMain, evalMain, realClick, screenshot, sleep } from '../../../akari-shell-strip/evidence/quick-export/cdp-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../../../..');
const shell = path.join(root, 'apps/shell');
const output = path.resolve(process.argv[2] || process.env.AKARI_L1_OUT || path.join(tmpdir(), 'akari-settings-layout-l1'));
const profile = mkdtempSync(path.join(tmpdir(), 'akari-settings-layout-profile-'));
const workspace = path.join(profile, 'workspace');
const port = 9449;
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
const result = { checks: {}, layouts: {}, screenshots: [] };
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
const click = async selector => {
    const point = await evalMain(cdp, `(() => { const e=document.querySelector(${JSON.stringify(selector)}); if (!e) return null;
        e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
    if (!point) throw new Error(`Missing: ${selector}`);
    await realClick(cdp, point.x, point.y);
    await sleep(450);
};
const shot = async name => {
    await screenshot(cdp, path.join(output, `${name}.png`));
    result.screenshots.push(name);
};
const close = async () => {
    await evalMain(cdp, `document.querySelector('[data-akari-settings-dialog] button')?.focus()`);
    for (let i = 0; i < 25; i++) {
        if (await evalMain(cdp, `!document.querySelector('[data-akari-settings-dialog]')`)) return;
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        await sleep(250);
    }
    throw new Error('Settings dialog did not close');
};
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
const profilePids = () => {
    const found = spawnSync('pgrep', ['-f', profile], { encoding: 'utf8' });
    if (found.error) throw found.error;
    if (found.status !== 0 && found.status !== 1) throw new Error('Could not inspect profile processes');
    return found.stdout.trim().split(/\s+/).map(Number).filter(pid => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
};
const stopProfileProcesses = async () => {
    const signal = name => {
        for (const pid of profilePids()) {
            try { process.kill(pid, name); }
            catch (error) { if (error.code !== 'ESRCH') throw error; }
        }
    };
    signal('SIGTERM');
    for (let i = 0; i < 40; i++) {
        if (profilePids().length === 0) return true;
        await sleep(250);
    }
    signal('SIGKILL');
    for (let i = 0; i < 20; i++) {
        if (profilePids().length === 0) return true;
        await sleep(250);
    }
    return profilePids().length === 0;
};
const pillars = {
    general: ['account', 'start', 'developer', 'help', 'about'], partner: ['partner'],
    connect: ['connections', 'ai-models', 'narration', 'transcribe', 'export'],
    workflow: ['quality', 'notifications', 'tools', 'statistics'], display: ['appearance', 'shortcuts'], data: ['storage', 'privacy']
};
const pageState = () => evalMain(cdp, `(() => { const d=document.querySelector('[data-akari-settings-dialog]');
    const layout=d?.querySelector('.akari-set-layout'); const page=d?.querySelector('.akari-set-scroll');
    return { columns:getComputedStyle(layout).gridTemplateColumns.split(' ').length,
        selected:d?.querySelector('[data-settings-nav][aria-current="true"]')?.dataset.settingsNav,
        visible:[...d.querySelectorAll('[data-akari-settings-section]:not([hidden])')].map(e=>e.dataset.akariSettingsSection),
        contents:[...d.querySelectorAll('[data-settings-contents]')].map(e=>e.dataset.settingsContents),
        oldNav:d.querySelectorAll('.akari-set-detail-nav,[data-settings-detail]').length,
        scroll:getComputedStyle(page).overflowY, current:d.querySelector('[data-settings-contents][aria-current="page"]')?.dataset.settingsContents }; })()`);
const headingNearTop = id => evalMain(cdp, `(() => { const page=document.querySelector('.akari-set-scroll');
    const heading=document.querySelector(${JSON.stringify(`#akari-settings-${id}-heading`)});
    if (!page || !heading) return false; const delta=heading.getBoundingClientRect().top-page.getBoundingClientRect().top;
    return delta >= 0 && delta < 85; })()`);

try {
    let cdpReady = false;
    for (let i = 0; i < 120; i++) {
        try { cdpReady = (await fetch(`http://127.0.0.1:${port}/json/list`)).ok; } catch { /* 起動を待つ。 */ }
        if (cdpReady || childExited) break;
        await sleep(1000);
    }
    if (!cdpReady) throw new Error(childExited ? 'Electron exited before CDP was ready' : 'CDP did not become ready');
    for (let attempt = 0; attempt < 6 && !cdp; attempt++) {
        try { cdp = await connectMain(port); }
        catch (error) {
            if (attempt === 5 || childExited) throw error;
            await sleep(3000);
        }
    }
    await waitFor(`(() => { const preload=document.querySelector('.theia-preload'); return (
        !preload || getComputedStyle(preload).display === 'none' || getComputedStyle(preload).visibility === 'hidden' ||
        getComputedStyle(preload).opacity === '0') && !!document.querySelector('#shell-tab-akari-settings-opener'); })()`, 'shell ready', 120000);
    await command('akari.settings.open', { section: 'account' });
    await waitFor(`!!document.querySelector('[data-akari-settings-dialog]')`, 'settings open');
    check('six-pillars', await evalMain(cdp, `document.querySelectorAll('[data-settings-nav]').length === 6`));
    for (const [pillar, ids] of Object.entries(pillars)) {
        await click(`[data-settings-nav="${pillar}"]`);
        await waitFor(`document.querySelector('[data-settings-nav="${pillar}"]')?.getAttribute('aria-current') === 'true'`, `${pillar} selected`);
        const state = await pageState();
        result.layouts[pillar] = state;
        check(`${pillar}-three-columns`, state.columns === 3 && state.scroll === 'auto');
        check(`${pillar}-all-sections`, JSON.stringify(state.visible) === JSON.stringify(ids));
        check(`${pillar}-contents`, JSON.stringify(state.contents) === JSON.stringify(ids));
        check(`${pillar}-no-horizontal-tabs`, state.oldNav === 0);
        if (pillar === 'connect') {
            const visibleCard = `(() => { const page=document.querySelector('.akari-set-scroll');
                const bounds=page.getBoundingClientRect();
                return [...document.querySelectorAll('#akari-settings-connections [data-connect-id]')].some(card => {
                    const rect=card.getBoundingClientRect();
                    return rect.width>0 && rect.height>0 && rect.bottom>bounds.top && rect.top<bounds.bottom;
                }); })()`;
            await waitFor(visibleCard, 'connect cards visible');
            check('connect-cards-visible', await evalMain(cdp, visibleCard));
        }
        await shot(pillar);
        if (ids.length >= 3) {
            await evalMain(cdp, `(() => { const p=document.querySelector('.akari-set-scroll'); p.scrollTo({top:0,behavior:'instant'}); return true; })()`);
            await waitFor(`document.querySelector('[data-settings-contents][aria-current="page"]')?.dataset.settingsContents === '${ids[0]}'`, `${pillar} first tracking`);
            check(`${pillar}-tracking-first`, (await pageState()).current === ids[0]);
            await evalMain(cdp, `(() => { const p=document.querySelector('.akari-set-scroll'), h=document.querySelector('#akari-settings-${ids[1]}-heading');
                p.scrollTo({top:p.scrollTop+h.getBoundingClientRect().top-p.getBoundingClientRect().top-24,behavior:'instant'}); return true; })()`);
            await waitFor(`document.querySelector('[data-settings-contents][aria-current="page"]')?.dataset.settingsContents === '${ids[1]}'`, `${pillar} second tracking`);
            check(`${pillar}-tracking-second`, (await pageState()).current === ids[1]);
        }
        if (ids.length > 1) {
            const target = ids[1];
            await click(`[data-settings-contents="${target}"]`);
            await waitFor(`(() => { const p=document.querySelector('.akari-set-scroll'); const h=document.querySelector('#akari-settings-${target}-heading');
                return h && Math.abs(h.getBoundingClientRect().top-p.getBoundingClientRect().top-24)<65; })()`, `${target} heading`);
            check(`${pillar}-jump`, await headingNearTop(target));
            await sleep(1600);
            await evalMain(cdp, `(() => { const p=document.querySelector('.akari-set-scroll'); p.scrollTo({top:p.scrollHeight,behavior:'instant'}); return true; })()`);
            await waitFor(`document.querySelector('[data-settings-contents][aria-current="page"]')?.dataset.settingsContents === '${ids.at(-1)}'`, `${pillar} scroll tracking`);
            check(`${pillar}-tracking`, (await pageState()).current === ids.at(-1));
        }
    }
    check('ai-models', await evalMain(cdp, `!!document.querySelector('#akari-settings-ai-models h2 + .akari-set-lead') &&
        !!document.querySelector('#akari-settings-ai-models [data-ai-models-view]')`));
    check('narration', await evalMain(cdp, `!!document.querySelector('#akari-settings-narration h2 + .akari-set-lead') &&
        [...document.querySelectorAll('#akari-settings-narration .akari-set-row-label')].some(e=>e.textContent.includes('既定のエンジン'))`));
    check('transcribe', await evalMain(cdp, `!!document.querySelector('#akari-settings-transcribe h2 + .akari-set-lead') &&
        document.querySelectorAll('#akari-settings-transcribe .akari-set-row').length > 0`));
    check('export', await evalMain(cdp, `!!document.querySelector('#akari-settings-export h2 + .akari-set-lead') &&
        document.querySelectorAll('#akari-settings-export .akari-set-row').length > 0`));
    check('permission', await evalMain(cdp, `!!document.querySelector('#akari-settings-partner [data-akari-dropdown="パートナーの権限"]')`));
    check('appearance', await evalMain(cdp, `!!document.querySelector('#akari-settings-appearance h2 + .akari-set-lead') &&
        [...document.querySelectorAll('#akari-settings-appearance .akari-set-row-label')].some(e=>e.textContent.includes('UI の大きさ'))`));
    await click('[data-settings-nav="workflow"]');
    const before = await evalMain(cdp, `document.querySelector('#akari-settings-notifications [role="switch"]')?.getAttribute('aria-checked')`);
    await click('#akari-settings-notifications [role="switch"]');
    const after = await evalMain(cdp, `document.querySelector('#akari-settings-notifications [role="switch"]')?.getAttribute('aria-checked')`);
    check('notification-toggle', before !== undefined && before !== after);
    await close();
    await command('akari.connect.open');
    await waitFor(`document.querySelector('[data-settings-nav="connect"]')?.getAttribute('aria-current') === 'true'`, 'connect command');
    check('connect-command-without-id', (await pageState()).selected === 'connect');
    await close();
    await command('akari.connect.open', { id: 'fal' });
    await waitFor(`!!document.querySelector('[data-connect-detail="fal"]')`, 'fal detail');
    await waitFor(`(() => { const e=document.querySelector('[data-connect-detail="fal"]'), p=document.querySelector('.akari-set-scroll');
        const a=e.getBoundingClientRect(), b=p.getBoundingClientRect(); return a.bottom>b.top && a.top<b.bottom; })()`, 'fal detail visible');
    check('connect-command', (await pageState()).selected === 'connect');
    check('fal-detail-visible', await evalMain(cdp, `(() => { const e=document.querySelector('[data-connect-detail="fal"]'); const p=document.querySelector('.akari-set-scroll');
        const a=e.getBoundingClientRect(), b=p.getBoundingClientRect(); return a.bottom>b.top && a.top<b.bottom; })()`));
    await close();
    await command('akari.settings.open', 'notifications');
    await waitFor(`document.querySelector('[data-settings-nav="workflow"]')?.getAttribute('aria-current') === 'true'`, 'old id');
    await waitFor(`(() => { const p=document.querySelector('.akari-set-scroll'), h=document.querySelector('#akari-settings-notifications-heading');
        return h && h.getBoundingClientRect().top-p.getBoundingClientRect().top<85; })()`, 'old id heading');
    check('old-id-jump', await headingNearTop('notifications'));
    await close();
    await command('akari.settings.open', { section: 'narration' });
    await waitFor(`document.querySelector('[data-settings-nav="connect"]')?.getAttribute('aria-current') === 'true'`, 'narration id');
    await waitFor(`(() => { const p=document.querySelector('.akari-set-scroll'), h=document.querySelector('#akari-settings-narration-heading');
        return h && h.getBoundingClientRect().top-p.getBoundingClientRect().top<85; })()`, 'narration heading');
    check('object-id-jump', await headingNearTop('narration'));
    await close();
    await command('akari.settings.open', 'display');
    await waitFor(`document.querySelector('[data-settings-nav="display"]')?.getAttribute('aria-current') === 'true'`, 'pillar id');
    check('pillar-id-jump', await headingNearTop('appearance'));
    await close();
    await command('akari.settings.open', { section: 'narration' });
    await waitFor(`document.querySelector('[data-settings-nav="connect"]')?.getAttribute('aria-current') === 'true'`, 'narrow preview');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 760, height: 800, deviceScaleFactor: 1, mobile: false });
    await waitFor(`document.querySelector('.akari-set-layout')?.hasAttribute('data-contents-narrow')`, 'narrow layout');
    check('narrow-contents-collapsed', await evalMain(cdp, `(() => { const d=document.querySelector('.akari-set-contents-details');
        return !d.open && getComputedStyle(d.querySelector('summary')).display !== 'none'; })()`));
    await shot('narrow');
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await close();
    const key = 'fake-l1-key-WXYZ';
    await command('akari.connect.open', { id: 'fal' });
    await waitFor(`!!document.querySelector('[data-connect-key-input="fal"]')`, 'fal input');
    await evalMain(cdp, `(() => { const e=document.querySelector('[data-connect-key-input="fal"]');
        const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(e,${JSON.stringify(key)});
        e.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
    await click('[data-connect-key-save="fal"]');
    await waitFor(`document.querySelector('[data-connect-masked-tail="fal"]')?.textContent?.includes('WXYZ')`, 'masked key');
    const credential = path.join(profile, '.akari', 'credentials.env');
    check('fake-key-isolated', existsSync(credential) && readFileSync(credential, 'utf8').includes(key));
    await close();
} catch (error) {
    result.error = String(error);
    if (cdp) {
        try {
            result.debug = await evalMain(cdp, `(() => { const input=document.querySelector('[data-connect-key-input="fal"]');
                const save=document.querySelector('[data-connect-key-save="fal"]');
                return { selected:document.querySelector('[data-settings-nav][aria-current="true"]')?.dataset.settingsNav,
                    detail:!!document.querySelector('[data-connect-detail="fal"]'), inputLength:input?.value.length,
                    saveDisabled:save?.disabled, masked:!!document.querySelector('[data-connect-masked-tail="fal"]'),
                    notice:document.querySelector('.akari-set-notice')?.textContent }; })()`);
        } catch { /* 失敗時の追加観察だけ省く。 */ }
    }
} finally {
    try { cdp?.close(); } catch { /* 終了を続ける。 */ }
    try {
        const childStopped = await stopChild();
        const noLeftovers = await stopProfileProcesses();
        check('no-leftover-processes', noLeftovers);
        if (noLeftovers) rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
        else result.cleanupError = 'Profile processes remained after SIGKILL';
        if (!childStopped) result.cleanupError = 'Electron did not exit after SIGKILL';
    } catch (error) { check('no-leftover-processes', false); result.cleanupError = String(error); }
    writeFileSync(path.join(output, 'measurements.json'), JSON.stringify(result, null, 2));
}
if (result.error || result.cleanupError || Object.values(result.checks).some(value => !value)) process.exitCode = 1;
