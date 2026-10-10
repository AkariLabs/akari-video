// L1: dev shell + CDP in an isolated home. Records the つなぐ rail, screen, detail,
// fake-key save, installed-app states and the 「チャットで試す」 hand-off.
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectMain, evalMain, realClick, screenshot, sleep } from '../../../akari-shell-strip/evidence/quick-export/cdp-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../../../..');
const shell = path.join(root, 'apps/shell');
const electron = path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const profile = mkdtempSync(path.join(tmpdir(), 'akari-connect-l1-'));
const workspace = path.join(profile, 'workspace');
const akariHome = path.join(profile, '.akari');
const port = 9473;
const FAKE_KEY = 'fake-l1-not-a-real-key-WXYZ';
cpSync(path.join(root, 'test-project'), workspace, { recursive: true });
mkdirSync(akariHome);

// Expected app states from this machine's real /Applications (and the empty isolated ~/Applications).
function appExpectations() {
    const names = existsSync('/Applications') ? readdirSync('/Applications') : [];
    const has = (re, nestedRe) => names.some(name => re.test(name) && (!nestedRe || name.endsWith('.app') ||
        (statSync(path.join('/Applications', name)).isDirectory() && readdirSync(path.join('/Applications', name)).some(child => nestedRe.test(child)))));
    const found = {
        blender: has(/^Blender(?: [\d.]+)?\.app$/i),
        photoshop: has(/^Adobe Photoshop(?: \d{4})?(?:\.app)?$/i, /^Adobe Photoshop.*\.app$/i),
        'after-effects': has(/^Adobe After Effects(?: \d{4})?(?:\.app)?$/i, /^Adobe After Effects.*\.app$/i),
        'ableton-live': has(/^Ableton Live .+\.app$/i),
        'davinci-resolve': has(/^DaVinci Resolve(?:\.app)?$/i, /^DaVinci Resolve\.app$/i),
        'final-cut-pro': has(/^Final Cut Pro\.app$/i)
    };
    const expected = {};
    for (const [id, ok] of Object.entries(found)) expected[id] = id === 'after-effects' ? '準備が要る' : ok ? '見つかった' : '準備が要る';
    expected['3d-recipes'] = found.blender ? '見つかった' : '準備が要る';
    return { found, expected };
}

const logs = [];
const child = spawn(electron, [shell, workspace, `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(profile, 'electron')}`, '--no-sandbox',
    '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'], {
    env: { ...process.env, HOME: profile, TMPDIR: path.join(profile, 'tmp'), THEIA_CONFIG_DIR: path.join(profile, '.theia'), AKARI_HOME: akariHome,
        FAL_KEY: '', HF_KEY: '', RUNWAYML_API_SECRET: '', ELEVENLABS_API_KEY: '', FISH_AUDIO_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'], detached: true
});
mkdirSync(path.join(profile, 'tmp'));
child.stdout.on('data', data => logs.push(String(data)));
child.stderr.on('data', data => logs.push(String(data)));

const m = { checks: {} };
const check = (name, ok, detail) => { m.checks[name] = { ok: !!ok, detail }; };
const REG = `(() => { const c = window.theia.container; const key = Array.from(c._bindingDictionary._map.keys()).find(k => typeof k === 'function' && k.prototype && typeof k.prototype.registerCommand === 'function' && typeof k.prototype.executeCommand === 'function' && typeof k.prototype.getCommand === 'function'); return c.get(key); })()`;
const clearToasts = async () => { await evalMain(cdp, `(async () => { try { await ${REG}.executeCommand('notifications.commands.clearAll'); } catch {} return true; })()`); await sleep(600); };
let cdp;
const rows = () => evalMain(cdp, `Array.from(document.querySelectorAll('[data-connect-id]')).map(e => ({ id: e.dataset.connectId, status: e.querySelector('small[data-status]')?.dataset.status }))`);
const clickSel = async selector => {
    const box = await evalMain(cdp, `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    if (!box) throw new Error(`not found: ${selector}`);
    await realClick(cdp, box.x, box.y);
    await sleep(700);
};
try {
    for (let i = 0; i < 120; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/json/list`)).ok) break; } catch { /* not yet */ } await sleep(1000); }
    cdp = await connectMain(port);
    for (let i = 0; i < 60; i++) {
        if (await evalMain(cdp, `!!document.querySelector('#theia-left-content-panel [data-akari-rail-id="akari-connect-opener"] .akari-connect-stack-icon')`)) break;
        await sleep(1000);
    }
    await sleep(3000);
    // Rail: つなぐ with overlapped icons.
    m.railBefore = await evalMain(cdp, `(() => { const t = document.querySelector('[data-akari-rail-id="akari-connect-opener"]'); return t && { title: t.getAttribute('title') || t.querySelector('.lm-TabBar-tabLabel')?.textContent, icons: Array.from(t.querySelectorAll('.akari-connect-stack-icon')).map(e => e.title), more: t.querySelector('.akari-connect-stack-more')?.textContent ?? null, marginLeft: Array.from(t.querySelectorAll('.akari-connect-stack-icon')).map(e => getComputedStyle(e).marginLeft) }; })()`);
    m.railTabHtml = await evalMain(cdp, `document.querySelector('[data-akari-rail-id="akari-connect-opener"]')?.outerHTML?.slice(0, 1500)`);
    check('rail-present-with-stack', m.railBefore && m.railBefore.icons.length > 0, m.railBefore);
    await clearToasts();
    await screenshot(cdp, path.join(here, '01-left-rail.png'));

    // Open via the rail.
    await clickSel('#theia-left-content-panel [data-akari-rail-id="akari-connect-opener"]');
    await sleep(1500);
    m.screen = await evalMain(cdp, `(() => ({ heading: document.querySelector('.akari-connect-main h2')?.textContent, filters: Array.from(document.querySelectorAll('[data-connect-filter]')).map(e => e.innerText.replace(/\\s+/g, ' ')), groups: Array.from(document.querySelectorAll('.akari-connect-list h3')).map(e => e.textContent), cards: document.querySelectorAll('[data-connect-id]').length }))()`);
    check('screen-opened-from-rail', m.screen.heading === 'つなぐ' && m.screen.cards >= 18 && m.screen.groups.length === 4, m.screen);
    m.rowsInitial = await rows();
    await clearToasts();
    await screenshot(cdp, path.join(here, '02-connect-screen.png'));

    // Installed apps vs this machine.
    const apps = appExpectations();
    m.appsFound = apps.found;
    const appMismatch = Object.entries(apps.expected).filter(([id, status]) => m.rowsInitial.find(r => r.id === id)?.status !== status);
    check('app-states-match-machine', appMismatch.length === 0, { expected: apps.expected, mismatch: appMismatch });
    check('fal-needs-setup-before-key', m.rowsInitial.find(r => r.id === 'fal')?.status === '準備が要る', m.rowsInitial.find(r => r.id === 'fal'));
    check('handoff-planned', ['final-cut-xml', 'resolve-xml', 'premiere-xml'].every(id => m.rowsInitial.find(r => r.id === id)?.status === '準備中'));

    // Filters + search.
    await clickSel('[data-connect-filter="つながっている"]');
    m.filterConnected = await rows();
    await clickSel('[data-connect-filter="行き来する"]');
    m.filterGroup = await rows();
    await clickSel('[data-connect-filter="すべて"]');
    await evalMain(cdp, `(() => { const i = document.querySelector('.akari-connect-main header input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'eleven'); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await sleep(500);
    m.search = await rows();
    await evalMain(cdp, `(() => { const i = document.querySelector('.akari-connect-main header input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await sleep(500);
    check('filter-connected', m.filterConnected.length > 0 && m.filterConnected.every(r => r.status === 'つながった'), m.filterConnected);
    check('filter-group', m.filterGroup.length === 6, m.filterGroup.map(r => r.id));
    check('search', m.search.length === 1 && m.search[0].id === 'elevenlabs', m.search);

    // Detail for fal.
    await clickSel('[data-connect-id="fal"]');
    m.detailBefore = await evalMain(cdp, `(() => { const d = document.querySelector('[data-connect-detail="fal"]'); return d && { text: d.innerText.slice(0, 600), input: d.querySelector('[data-connect-key-input="fal"]')?.type, tail: d.querySelector('[data-connect-masked-tail="fal"]')?.textContent ?? null, tryBtn: !!d.querySelector('[data-connect-try="fal"]') }; })()`);
    check('detail-opens', m.detailBefore && m.detailBefore.input === 'password' && m.detailBefore.tryBtn, m.detailBefore);
    await clearToasts();
    await screenshot(cdp, path.join(here, '03-detail-fal.png'));

    // 「チャットで試す」 without akari-chat: notice, no throw. Toasts sit over the detail's bottom edge, so clear them first.
    await clearToasts();
    await clickSel('[data-connect-try="fal"]');
    await sleep(800);
    m.tryWithoutChat = await evalMain(cdp, `Array.from(document.querySelectorAll('.theia-notification-message, .theia-notification-list-item')).map(e => e.innerText).slice(-3)`);
    check('try-without-chat-notifies', m.tryWithoutChat.some(t => t.includes('チャット')), m.tryWithoutChat);

    // Intercept akari.chat.prefill and click again.
    m.intercept = await evalMain(cdp, `(() => {
        const registry = ${REG};
        window.__prefillCalls = [];
        registry.registerCommand({ id: 'akari.chat.prefill' }, { execute: arg => { window.__prefillCalls.push(arg); } });
        return 'ok';
    })()`);
    await clearToasts();
    await clickSel('[data-connect-try="fal"]');
    m.prefillCalls = await evalMain(cdp, 'window.__prefillCalls');
    check('try-calls-prefill', m.prefillCalls?.length === 1 && typeof m.prefillCalls[0]?.text === 'string' && m.prefillCalls[0].text.length > 0, m.prefillCalls);

    // Add a fake key.
    await clickSel('[data-connect-id="fal"]');
    await evalMain(cdp, `(() => { const i = document.querySelector('[data-connect-key-input="fal"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(FAKE_KEY)}); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await sleep(400);
    await clearToasts();
    await clickSel('[data-connect-key-save="fal"]');
    await sleep(1500);
    m.detailAfter = await evalMain(cdp, `(() => { const d = document.querySelector('[data-connect-detail="fal"]'); return d && { status: d.querySelector('small[data-status]')?.dataset.status, tail: d.querySelector('[data-connect-masked-tail="fal"]')?.textContent ?? null, input: d.querySelector('[data-connect-key-input="fal"]')?.value, keyInDom: document.body.innerHTML.includes(${JSON.stringify(FAKE_KEY)}) }; })()`);
    const tail = FAKE_KEY.slice(-4);
    check('fal-connected-after-key', m.detailAfter?.status === 'つながった', m.detailAfter);
    check('only-last-4-shown', m.detailAfter?.tail?.endsWith(tail) && !m.detailAfter.keyInDom && m.detailAfter.tail.replace(/[•*]/g, '') === tail, m.detailAfter);
    const credFile = path.join(akariHome, 'credentials.env');
    const credText = existsSync(credFile) ? readFileSync(credFile, 'utf8') : '';
    check('saved-in-existing-credentials-env', credText.split(/\r?\n/).includes(`FAL_KEY=${FAKE_KEY}`), { exists: existsSync(credFile), mode: existsSync(credFile) ? (statSync(credFile).mode & 0o777).toString(8) : null });
    const connectorsFile = path.join(akariHome, 'connectors.json');
    check('connectors-json-has-no-key', !existsSync(connectorsFile) || !readFileSync(connectorsFile, 'utf8').includes(FAKE_KEY));
    await clearToasts();
    await screenshot(cdp, path.join(here, '04-detail-after-key.png'));
    m.railAfter = await evalMain(cdp, `Array.from(document.querySelectorAll('[data-akari-rail-id="akari-connect-opener"] .akari-connect-stack-icon')).map(e => e.title)`);
    check('rail-stack-includes-fal', m.railAfter.includes('fal'), m.railAfter);

    // Reload the window and reopen by id: key still there.
    await evalMain(cdp, 'location.reload(); true');
    await sleep(3000);
    for (let i = 0; i < 90; i++) {
        try { if (await evalMain(cdp, `!!document.querySelector('[data-akari-rail-id="akari-connect-opener"] .akari-connect-stack-icon')`)) break; } catch { /* reloading */ }
        await sleep(1000);
    }
    await sleep(2000);
    await evalMain(cdp, `(async () => { await ${REG}.executeCommand('akari.connect.open', { id: 'fal' }); return true; })()`);
    await sleep(1500);
    m.afterReload = await evalMain(cdp, `(() => { const d = document.querySelector('[data-connect-detail="fal"]'); return d && { status: d.querySelector('small[data-status]')?.dataset.status, tail: d.querySelector('[data-connect-masked-tail="fal"]')?.textContent ?? null }; })()`);
    check('persists-after-reopen', m.afterReload?.status === 'つながった' && m.afterReload.tail?.endsWith(tail), m.afterReload);
    m.railAfterReload = await evalMain(cdp, `Array.from(document.querySelectorAll('[data-akari-rail-id="akari-connect-opener"] .akari-connect-stack-icon')).map(e => e.title)`);
    await clearToasts();
    await screenshot(cdp, path.join(here, '05-after-reload.png'));
} catch (error) {
    m.error = String(error?.stack || error);
} finally {
    try { cdp?.close(); } catch { /* ignore */ }
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* ignore */ }
    await sleep(1500);
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* ignore */ }
    m.pass = !m.error && Object.values(m.checks).every(c => c.ok);
    const text = JSON.stringify(m, null, 2).split(profile).join('<isolated-home>').split(root).join('<repo>').split(FAKE_KEY).join('<fake-key>');
    writeFileSync(path.join(here, 'l1-ui.json'), text + '\n');
    writeFileSync(path.join(profile, 'electron.log'), logs.join(''));
    console.log(JSON.stringify({ pass: m.pass, error: m.error ?? null, checks: Object.fromEntries(Object.entries(m.checks).map(([k, v]) => [k, v.ok])) }, null, 1));
    if (!process.env.KEEP_PROFILE) rmSync(profile, { recursive: true, force: true });
    process.exit(m.pass ? 0 : 1);
}
