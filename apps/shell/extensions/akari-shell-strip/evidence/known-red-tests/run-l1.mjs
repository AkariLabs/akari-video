// L1: 部品を shell-strip へ移した後も、設定 › 接続と API キー とステータスバーの
// アカウント（接続の行・ロゴ・残高の欄）・リソースの表示が今どおり出ることを撮る。
// DI のシンボル AkariConnectionsService がコンテナに 1 つだけで、ステータスバーが
// 設定画面と同じ RPC プロキシを受け取っていることも実測する。
// 使い方: node run-l1.mjs <before|after>（before = 基点のビルド・after = この変更のビルド）
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, cpSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectMain, evalMain, realClick, screenshot, sleep } from '../quick-export/cdp-lib.mjs';

const label = process.argv[2] === 'before' ? 'before' : 'after';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const shell = path.join(root, 'apps/shell');
const electron = path.join(shell, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const profile = mkdtempSync(path.join(tmpdir(), 'known-red-tests-l1-'));
const workspace = path.join(profile, 'workspace');
const output = path.dirname(fileURLToPath(import.meta.url));
const port = 9661;
cpSync(path.join(root, 'test-project'), workspace, { recursive: true });
mkdirSync(path.join(profile, '.akari'));
// 残高の口が無い 2 社だけ「接続済み」にする（ダミーのキー。外部への問い合わせは起きない）。
writeFileSync(path.join(profile, 'credentials.env'), 'GROQ_API_KEY=dummy-known-red-tests\nREPLICATE_API_TOKEN=dummy-known-red-tests\n', { mode: 0o600 });
const env = { ...process.env, HOME: profile, THEIA_CONFIG_DIR: path.join(profile, '.theia'),
    AKARI_HOME: path.join(profile, '.akari'), AKARI_CREDENTIALS_FILE: path.join(profile, 'credentials.env'),
    ELECTRON_ENABLE_LOGGING: '1' };
for (const name of ['ELECTRON_RUN_AS_NODE', 'FAL_KEY', 'OPENROUTER_API_KEY', 'ELEVENLABS_API_KEY', 'GROQ_API_KEY', 'REPLICATE_API_TOKEN']) delete env[name];
const logs = [];
const child = spawn(electron, [shell, workspace, `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(profile, 'user-data')}`, '--no-sandbox'],
    { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
child.stdout.on('data', data => logs.push(String(data)));
child.stderr.on('data', data => logs.push(String(data)));

const shot = name => screenshot(cdp, path.join(output, `${label}-${name}.png`));
const center = selector => evalMain(cdp, `(() => {
    const e = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(n => n.getBoundingClientRect().width > 0);
    if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
})()`);
let cdp;
const m = { label, pid: child.pid };
try {
    for (let attempt = 0; attempt < 120; attempt++) {
        try { if ((await fetch(`http://127.0.0.1:${port}/json/list`)).ok) break; }
        catch { /* CDP はまだ開いていない */ }
        await sleep(1000);
    }
    cdp = await connectMain(port);
    for (let attempt = 0; attempt < 120; attempt++) {
        const state = await evalMain(cdp, `({ ready: !!document.querySelector('#theia-app-shell'), hook: !!window.__akariStatusbarResources })`);
        if (state.ready && state.hook) break;
        await sleep(1000);
    }
    await sleep(5000);
    // 初回の案内が出ていたら閉じる（本検証の対象外）
    await evalMain(cdp, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`);
    await sleep(500);

    // DI: シンボルはコンテナに 1 つ。ステータスバーの connections は、そのシンボルで引ける同じプロキシ。
    m.di = await evalMain(cdp, `(() => {
        const c = window.theia.container;
        const keys = Array.from(c._bindingDictionary._map.keys());
        const symbols = keys.filter(k => typeof k === 'symbol' && String(k) === 'Symbol(AkariConnectionsService)');
        const uiToken = keys.find(k => typeof k === 'function' && k.prototype?.refreshBalances && k.prototype?.renderAccount);
        const ui = uiToken ? c.get(uiToken) : undefined;
        const proxy = symbols.length === 1 ? c.get(symbols[0]) : undefined;
        return { symbolBindings: symbols.length, statusbarUiFound: !!ui, sameProxy: !!ui && !!proxy && ui.connections === proxy };
    })()`);

    // ステータスバー › リソース
    const resources = await center('.akari-statusbar-mono');
    m.resourcesBar = await evalMain(cdp, `document.querySelector('.akari-statusbar-mono')?.innerText ?? null`);
    if (resources) await realClick(cdp, resources.x, resources.y);
    await sleep(600);
    m.resourcesPopup = await evalMain(cdp, `(() => ({ text: document.querySelector('[data-akari-statusbar-popup="resources"]')?.innerText ?? null,
        rows: Array.from(document.querySelectorAll('[data-akari-resource]')).map(e => e.dataset.akariResource) }))()`);
    await shot('statusbar-resources');
    if (resources) await realClick(cdp, resources.x, resources.y);
    await sleep(400);

    // ステータスバー › アカウント（接続の行・ロゴ・残高の欄）
    const account = await evalMain(cdp, `(() => {
        const e = Array.from(document.querySelectorAll('#theia-statusBar .area.left .element')).find(n => n.querySelector('.codicon-account') || /アカウント/.test(n.title || ''))
            ?? document.querySelector('#theia-statusBar .area.left .element');
        if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: e.innerText };
    })()`);
    m.accountEntry = account?.text ?? null;
    if (account) await realClick(cdp, account.x, account.y);
    for (let attempt = 0; attempt < 20; attempt++) {
        const n = await evalMain(cdp, `document.querySelectorAll('[data-akari-statusbar-popup="account"] [data-akari-provider]').length`);
        if (n > 0) break;
        await sleep(300);
    }
    m.accountPopup = await evalMain(cdp, `(() => {
        const popup = document.querySelector('[data-akari-statusbar-popup="account"]');
        return { visible: !!popup && popup.getClientRects().length > 0,
            rows: Array.from(popup?.querySelectorAll('[data-akari-provider]') ?? []).map(e => {
                const logo = e.querySelector('.provider-logo');
                return { id: e.dataset.akariProvider, name: e.querySelector('.name')?.textContent,
                    balance: e.querySelector('.mono')?.textContent,
                    logo: logo?.tagName === 'IMG' ? { img: true, loaded: logo.complete && logo.naturalWidth > 0 } : { img: false, initial: logo?.textContent } };
            }) };
    })()`);
    await shot('statusbar-account');

    // アカウントの行（接続済みの groq）から 設定 › 接続と API キー へ
    const provider = await center('[data-akari-statusbar-popup="account"] [data-akari-provider="groq"]');
    if (provider) await realClick(cdp, provider.x, provider.y);
    for (let attempt = 0; attempt < 20; attempt++) {
        const ok = await evalMain(cdp, `!!document.querySelector('[data-akari-settings-dialog="true"] [data-akari-settings-section="connections"]:not([hidden]) [data-akari-provider]')`);
        if (ok) break;
        await sleep(300);
    }
    await sleep(800);
    const readConnections = () => evalMain(cdp, `(() => {
        const dialog = document.querySelector('[data-akari-settings-dialog="true"]');
        const section = dialog?.querySelector('[data-akari-settings-section="connections"]');
        return { dialogVisible: !!dialog && dialog.getClientRects().length > 0,
            sectionVisible: !!section && !section.hidden && section.getClientRects().length > 0,
            heading: section?.querySelector('h2')?.textContent ?? null,
            groups: Array.from(section?.querySelectorAll('h3, [data-akari-provider-group]') ?? []).map(e => e.textContent?.trim().slice(0, 12)).filter(Boolean),
            providers: Array.from(section?.querySelectorAll('[data-akari-provider]') ?? []).map(e => {
                const img = e.querySelector('img');
                return { id: e.dataset.akariProvider, logo: img ? { img: true, loaded: img.complete && img.naturalWidth > 0 } : { img: false },
                    text: e.innerText.split('\\n').slice(0, 3).join(' / ') };
            }) };
    })()`);
    m.settingsConnectionsFromStatusbar = await readConnections();
    await shot('settings-connections-row');
    await sleep(2500); // 行へ寄せる処理（最大 2 秒）が終わってから先頭へ戻す
    await evalMain(cdp, `(() => { const s = document.querySelector('[data-akari-settings-section="connections"]'); s?.scrollIntoView({ block: 'start' });
        let p = s; while (p) { if (p.scrollHeight > p.clientHeight) p.scrollTop = 0; p = p.parentElement; } return true; })()`);
    await sleep(500);
    await shot('settings-connections');

    m.startupError = logs.join('').includes('Failed to start the frontend application.');
    m.moduleErrors = logs.join('').split('\n').filter(l => /Cannot find module|is not a function|No matching bindings|Ambiguous match/.test(l)).slice(0, 10);
} catch (error) {
    m.error = String(error?.stack ?? error);
} finally {
    writeFileSync(path.join(output, `${label}-measurements.json`), JSON.stringify(m, null, 2) + '\n');
    cdp?.close();
    try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* 既に終了 */ } }
    const leftovers = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n')
        .filter(line => line.includes(profile)).map(line => Number(line.trim().split(/\s+/)[0])).filter(Number.isInteger);
    for (const pid of leftovers) { try { process.kill(pid, 'SIGKILL'); } catch { /* 既に終了 */ } }
    await sleep(1500);
    rmSync(profile, { recursive: true, force: true });
    console.log(JSON.stringify(m, null, 2));
    process.exit(m.error ? 1 : 0);
}
