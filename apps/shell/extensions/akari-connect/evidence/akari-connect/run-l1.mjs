// L1: isolated dev shell, two connector groups, icons, statuses, and fake-key save.
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectMain, evalMain, realClick, screenshot, sleep } from '../../../akari-shell-strip/evidence/quick-export/cdp-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../../../..');
const shell = path.join(root, 'apps/shell');
const electron = process.env.AKARI_CONNECT_L1_ELECTRON || path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
if (!existsSync(electron)) { console.error('Electron executable is missing. Install shell development dependencies before L1.'); process.exit(1); }
const profile = mkdtempSync(path.join(tmpdir(), 'akari-connect-l1-'));
const workspace = path.join(profile, 'workspace');
const akariHome = path.join(profile, '.akari');
const port = 9455;
const out = path.resolve(process.env.AKARI_CONNECT_L1_OUT || here);
mkdirSync(out, { recursive: true });
const FAKE_KEY = 'fake-l1-not-a-real-key-WXYZ';
cpSync(path.join(root, 'test-project'), workspace, { recursive: true });
mkdirSync(akariHome);
mkdirSync(path.join(profile, 'tmp'));

const logs = [];
const child = spawn(electron, [shell, workspace, `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(profile, 'electron')}`, '--no-sandbox',
    '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'], {
    env: { ...process.env, HOME: profile, TMPDIR: path.join(profile, 'tmp'), THEIA_CONFIG_DIR: path.join(profile, '.theia'), AKARI_HOME: akariHome,
        AKARI_CREDENTIALS_FILE: path.join(akariHome, 'credentials.env'),
        FAL_KEY: '', FISH_AUDIO_API_KEY: '', GEMINI_API_KEY: '', ELEVENLABS_API_KEY: '', GROQ_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'], detached: true
});
child.stdout.on('data', data => logs.push(String(data)));
child.stderr.on('data', data => logs.push(String(data)));

const m = { checks: {} };
const check = (name, ok, detail) => { m.checks[name] = { ok: !!ok, detail }; };
const skip = (name, reason) => { m.checks[name] = { skipped: true, detail: reason }; };
const REG = `(() => { const c = window.theia.container; const key = Array.from(c._bindingDictionary._map.keys()).find(k => typeof k === 'function' && k.prototype && typeof k.prototype.registerCommand === 'function' && typeof k.prototype.executeCommand === 'function' && typeof k.prototype.getCommand === 'function'); return c.get(key); })()`;
const clearToasts = async () => { await evalMain(cdp, `(async () => { try { await ${REG}.executeCommand('notifications.commands.clearAll'); } catch {} return true; })()`); await sleep(600); };
let cdp;
const rows = () => evalMain(cdp, `Array.from(document.querySelectorAll('[data-connect-id]')).map(e => ({ id: e.dataset.connectId, name: e.querySelector('.akari-connect-row-copy strong')?.textContent?.trim(), status: e.querySelector('small[data-status]')?.dataset.status, icon: !!e.querySelector('.akari-connect-icon img') ? 'img' : (e.querySelector('.akari-connect-icon')?.textContent?.trim() ? 'initial' : null) }))`);
const reconnect = async () => { try { cdp?.close(); } catch { /* reload may already close the socket */ } cdp = await connectMain(port); };
const retryAfterReload = async (expression, ready = value => !!value, attempts = 30) => {
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt++) {
        try {
            const result = await evalMain(cdp, expression, 8000);
            if (ready(result)) return result;
        } catch (error) {
            lastError = error;
            try { await reconnect(); } catch (reconnectError) { lastError = reconnectError; }
        }
        await sleep(1500);
    }
    throw lastError || new Error('The shell did not become ready after reload.');
};
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
    await screenshot(cdp, path.join(out, '01-left-rail.png'));

    // Open via the rail.
    await clickSel('#theia-left-content-panel [data-akari-rail-id="akari-connect-opener"]');
    await sleep(1500);
    m.screen = await evalMain(cdp, `(() => ({ heading: document.querySelector('.akari-connect-main h2')?.textContent, filters: Array.from(document.querySelectorAll('[data-connect-filter]')).map(e => e.innerText.replace(/\\s+/g, ' ')), groups: Array.from(document.querySelectorAll('.akari-connect-list h3')).map(e => e.textContent), cards: document.querySelectorAll('[data-connect-id]').length }))()`);
    check('two-groups', JSON.stringify(m.screen.groups) === JSON.stringify(['AKARI の道具', '素材を作る']) && m.screen.cards === 7, m.screen);
    m.rowsInitial = await rows();
    const usableNames = [...new Set(m.rowsInitial.filter(row => row.status === '使える').map(row => row.name))].sort();
    const railNames = [...new Set(m.railBefore.icons)].sort();
    check('rail-only-usable', JSON.stringify(railNames) === JSON.stringify(usableNames), { rail: railNames, usable: usableNames });
    await clearToasts();
    await screenshot(cdp, path.join(out, '02-connect-screen.png'));
    const materialSection = await evalMain(cdp, `(() => { const section = Array.from(document.querySelectorAll('.akari-connect-list section')).find(e => e.querySelector('h3')?.textContent === '素材を作る'); section?.scrollIntoView({ block: 'start' }); return !!section; })()`);
    check('material-section-visible', materialSection);
    await sleep(400);
    await screenshot(cdp, path.join(out, '02b-material-services.png'));

    const removed = ['akari-sounds', 'higgsfield', 'runway', 'suno', 'blender', 'photoshop', 'after-effects', 'ableton-live', 'davinci-resolve', 'final-cut-pro', 'final-cut-xml', 'resolve-xml', 'premiere-xml'];
    check('removed-cards-absent', removed.every(id => !m.rowsInitial.some(row => row.id === id)));
    check('removed-filters-absent', !m.screen.filters.some(label => /行き来する|渡す/.test(label)));
    const serviceRows = m.rowsInitial.filter(row => ['fal', 'fish-audio', 'google-ai', 'elevenlabs', 'groq'].includes(row.id));
    check('service-logos', serviceRows.length === 5 && serviceRows.every(row => row.icon === 'img'));
    check('allowed-statuses', m.rowsInitial.every(row => ['使える', '鍵が必要', 'Blender が必要'].includes(row.status)), m.rowsInitial);
    check('fal-needs-key', m.rowsInitial.find(row => row.id === 'fal')?.status === '鍵が必要');

    // Filters + search.
    await clickSel('[data-connect-filter="使える"]');
    m.filterConnected = await rows();
    await clickSel('[data-connect-filter="素材を作る"]');
    m.filterGroup = await rows();
    await clickSel('[data-connect-filter="すべて"]');
    await evalMain(cdp, `(() => { const i = document.querySelector('.akari-connect-main header input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'eleven'); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await sleep(500);
    m.search = await rows();
    await evalMain(cdp, `(() => { const i = document.querySelector('.akari-connect-main header input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await sleep(500);
    check('filter-connected', m.filterConnected.length > 0 && m.filterConnected.every(r => r.status === '使える'), m.filterConnected);
    check('filter-group', m.filterGroup.length === 5, m.filterGroup.map(r => r.id));
    check('search', m.search.length === 1 && m.search[0].id === 'elevenlabs', m.search);

    // Detail for fal.
    await clickSel('[data-connect-id="fal"]');
    m.detailBefore = await evalMain(cdp, `(() => { const d = document.querySelector('[data-connect-detail="fal"]'); return d && { text: d.innerText.slice(0, 600), input: d.querySelector('[data-connect-key-input="fal"]')?.type, tail: d.querySelector('[data-connect-masked-tail="fal"]')?.textContent ?? null, tryBtn: !!d.querySelector('[data-connect-try="fal"]'), icon: !!d.querySelector('.akari-connect-icon img') }; })()`);
    check('detail-opens', m.detailBefore && m.detailBefore.input === 'password' && m.detailBefore.tryBtn && m.detailBefore.icon, m.detailBefore);
    await clearToasts();
    await screenshot(cdp, path.join(out, '03-detail-fal.png'));

    m.chatPrefillAvailable = await evalMain(cdp, `!!${REG}.getCommand('akari.chat.prefill')`);
    if (m.chatPrefillAvailable) {
        skip('try-without-chat-notifies', 'akari.chat.prefill は統合済みなので、未登録時の通知は対象外。');
    } else {
        await clearToasts();
        await clickSel('[data-connect-try="fal"]');
        await sleep(800);
        m.tryWithoutChat = await evalMain(cdp, `Array.from(document.querySelectorAll('.theia-notification-message, .theia-notification-list-item')).map(e => e.innerText).slice(-3)`);
        check('try-without-chat-notifies', m.tryWithoutChat.some(t => t.includes('チャット')), m.tryWithoutChat);
    }

    // Record prefill without opening the real chat, whether its command is already registered or not.
    m.intercept = await evalMain(cdp, `(() => {
        const registry = ${REG};
        window.__prefillCalls = [];
        if (registry.getCommand('akari.chat.prefill')) {
            const original = registry.executeCommand;
            registry.executeCommand = function(id, ...args) {
                if (id === 'akari.chat.prefill') { window.__prefillCalls.push(args[0]); return Promise.resolve(); }
                return original.apply(this, [id, ...args]);
            };
            window.__restorePrefill = () => { registry.executeCommand = original; };
            return 'wrapped';
        }
        const registration = registry.registerCommand({ id: 'akari.chat.prefill' }, { execute: arg => { window.__prefillCalls.push(arg); } });
        window.__restorePrefill = () => registration?.dispose();
        return 'registered';
    })()`);
    await clearToasts();
    await clickSel('[data-connect-try="fal"]');
    m.prefillCalls = await evalMain(cdp, `(() => { const calls = window.__prefillCalls; window.__restorePrefill?.(); return calls; })()`);
    check('try-calls-prefill', m.prefillCalls?.length === 1 && typeof m.prefillCalls[0]?.text === 'string' && m.prefillCalls[0].text.length > 0, m.prefillCalls);

    // Add a fake key.
    await evalMain(cdp, `(async () => { await ${REG}.executeCommand('akari.connect.open', { id: 'fal' }); return true; })()`);
    await sleep(700);
    await clickSel('[data-connect-id="fal"]');
    await evalMain(cdp, `(() => { const i = document.querySelector('[data-connect-key-input="fal"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(FAKE_KEY)}); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await sleep(400);
    await clearToasts();
    await clickSel('[data-connect-key-save="fal"]');
    await sleep(1500);
    m.detailAfter = await evalMain(cdp, `(() => { const d = document.querySelector('[data-connect-detail="fal"]'); return d && { status: d.querySelector('small[data-status]')?.dataset.status, tail: d.querySelector('[data-connect-masked-tail="fal"]')?.textContent ?? null, input: d.querySelector('[data-connect-key-input="fal"]')?.value, keyInDom: document.body.innerHTML.includes(${JSON.stringify(FAKE_KEY)}) }; })()`);
    const tail = FAKE_KEY.slice(-4);
    check('fal-connected-after-key', m.detailAfter?.status === '使える', m.detailAfter);
    check('only-last-4-shown', m.detailAfter?.tail?.endsWith(tail) && !m.detailAfter.keyInDom && m.detailAfter.tail.replace(/[•*]/g, '') === tail, m.detailAfter);
    const credFile = path.join(akariHome, 'credentials.env');
    const credText = existsSync(credFile) ? readFileSync(credFile, 'utf8') : '';
    check('saved-in-existing-credentials-env', credText.split(/\r?\n/).includes(`FAL_KEY=${FAKE_KEY}`), { exists: existsSync(credFile), mode: existsSync(credFile) ? (statSync(credFile).mode & 0o777).toString(8) : null });
    const connectorsFile = path.join(akariHome, 'connectors.json');
    check('connectors-json-has-no-key', !existsSync(connectorsFile) || !readFileSync(connectorsFile, 'utf8').includes(FAKE_KEY));
    await clearToasts();
    await screenshot(cdp, path.join(out, '04-detail-after-key.png'));
    m.railAfter = await evalMain(cdp, `Array.from(document.querySelectorAll('[data-akari-rail-id="akari-connect-opener"] .akari-connect-stack-icon')).map(e => ({ name: e.title, image: !!e.querySelector('img') }))`);
    check('rail-stack-includes-fal', m.railAfter.some(item => item.name === 'fal' && item.image), m.railAfter);

    // Reload the window and reopen by id: key still there.
    const beforeReload = await evalMain(cdp, 'performance.timeOrigin');
    try { await evalMain(cdp, 'location.reload(); true', 8000); }
    catch { try { await cdp.send('Page.reload', {}, 8000); } catch { /* navigation may interrupt both replies */ } }
    await sleep(3000);
    await retryAfterReload(`performance.timeOrigin !== ${JSON.stringify(beforeReload)} && !!document.querySelector('[data-akari-rail-id="akari-connect-opener"] .akari-connect-stack-icon')`);
    await retryAfterReload(`(async () => { await ${REG}.executeCommand('akari.connect.open', { id: 'fal' }); return true; })()`);
    m.afterReload = await retryAfterReload(`(() => { const d = document.querySelector('[data-connect-detail="fal"]'); return d && { status: d.querySelector('small[data-status]')?.dataset.status, tail: d.querySelector('[data-connect-masked-tail="fal"]')?.textContent ?? null }; })()`);
    check('persists-after-reopen', m.afterReload?.status === '使える' && m.afterReload.tail?.endsWith(tail), m.afterReload);
    m.railAfterReload = await retryAfterReload(`Array.from(document.querySelectorAll('[data-akari-rail-id="akari-connect-opener"] .akari-connect-stack-icon')).map(e => e.title)`, value => Array.isArray(value) && value.length > 0);
    await clearToasts();
    await screenshot(cdp, path.join(out, '05-after-reload.png'));
} catch (error) {
    m.error = String(error?.message || error);
} finally {
    try { cdp?.close(); } catch { /* ignore */ }
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* ignore */ }
    await sleep(1500);
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* ignore */ }
    m.pass = !m.error && Object.values(m.checks).every(c => c.skipped || c.ok);
    const redact = value => String(value).split(profile).join('<isolated-home>').split(root).join('<repo>').split(FAKE_KEY).join('<fake-key>')
        .replace(/\/(?:Users|private|var)\/[^\s"'<>]+/g, '<local-path>');
    const text = redact(JSON.stringify(m, null, 2));
    writeFileSync(path.join(out, 'l1-ui.json'), text + '\n');
    writeFileSync(path.join(profile, 'electron.log'), logs.join(''));
    console.log(redact(JSON.stringify({ pass: m.pass, error: m.error ?? null, checks: Object.fromEntries(Object.entries(m.checks).map(([k, v]) => [k, v.skipped ? 'skipped' : v.ok])) }, null, 1)));
    if (!process.env.KEEP_PROFILE) rmSync(profile, { recursive: true, force: true });
    process.exit(m.pass ? 0 : 1);
}
