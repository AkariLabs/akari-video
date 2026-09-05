#!/usr/bin/env node
// preview-tab-toolbar-curation L1 プローブ（検証スクリプト・ラッパー作成）。
//
// 本番ビルドの Electron（tier 2 = worktree の node_modules/electron）を
// `--plugins=local-dir:<このディレクトリの親>` で起動し、証跡用スタブ拡張
// （stub-plugin: contributes.menus["editor/title"] にアイコン付きコマンド 1 個）を
// 配備した状態で、次の 3 タブのタブバーツールバーを生 CDP で観測する。
//
//   1. 出力プレビュー（edit.json → WebviewWidget）
//   2. 素材プレビュー（source.mp4 → WebviewWidget）
//   3. 開発者モード ON の Monaco エディタ（MEDIA.md → EditorWidget）
//
// 観測は 2 系統を必ず両方記録する:
//   - DOM: `.lm-TabBar-toolbar`（Theia 1.73 は lumino 化済み。契約文の `.p-TabBar-toolbar` は
//     phosphor 時代の綴りなので両方を query する）配下の item id 列
//   - モデル: TabBarToolbarRegistry.visibleItems(currentWidget) の id 列
//
// Usage: node run-l1.mjs <label: before|after> <port> <projectDir> <outDir>
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(EVIDENCE_DIR, '../../../../../..');
const SHELL_DIR = path.join(REPO_ROOT, 'apps/shell');
const ELECTRON = path.join(REPO_ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');

const [, , label = 'after', portArg = '9711', projectArg, outArg] = process.argv;
const port = Number(portArg);
const projectDir = projectArg || '/tmp/akari-l1-preview-tab/project';
const outDir = outArg || path.join(EVIDENCE_DIR, label);
const userDataDir = `/tmp/akari-l1-preview-tab/user-data-${label}`;
const logFile = `/tmp/akari-l1-preview-tab/electron-${label}.log`;

if (!existsSync(ELECTRON)) throw new Error(`Electron not found: ${ELECTRON}`);
if (!existsSync(path.join(projectDir, 'edit.json'))) throw new Error(`fixture edit.json not found in ${projectDir}`);
await mkdir(outDir, { recursive: true });
// 走行ごとに素の状態から始める（developer mode プリファレンスが前走から残らないように）。
await (await import('node:fs/promises')).rm(userDataDir, { recursive: true, force: true });
await mkdir(userDataDir, { recursive: true });

// ---------- 最小 CDP クライアント（外部依存なし・Node 26 の global WebSocket） ----------
class CDP {
    constructor(wsUrl) { this.wsUrl = wsUrl; this.nextId = 1; this.pending = new Map(); this.listeners = new Map(); }
    on(method, handler) {
        if (!this.listeners.has(method)) this.listeners.set(method, []);
        this.listeners.get(method).push(handler);
    }
    async connect() {
        this.ws = new WebSocket(this.wsUrl);
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('CDP connect timeout')), 15_000);
            this.ws.addEventListener('open', () => { clearTimeout(timer); resolve(); });
            this.ws.addEventListener('error', e => { clearTimeout(timer); reject(new Error(`CDP ws error: ${e?.message ?? e}`)); });
        });
        this.ws.addEventListener('message', event => {
            const msg = JSON.parse(event.data);
            if (msg.id && this.pending.has(msg.id)) {
                const { resolve, reject, timer } = this.pending.get(msg.id);
                clearTimeout(timer); this.pending.delete(msg.id);
                msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
            } else if (msg.method) {
                for (const handler of this.listeners.get(msg.method) ?? []) handler(msg.params);
            }
        });
    }
    send(method, params = {}) {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP ${method} timeout`)); }, 60_000);
            this.pending.set(id, { resolve, reject, timer });
            this.ws.send(JSON.stringify({ id, method, params }));
        });
    }
    close() { try { this.ws?.close(); } catch { /* ignore */ } }
}

const results = {
    label,
    status: 'running',
    startedAt: new Date().toISOString(),
    build: { electron: path.relative(REPO_ROOT, ELECTRON), shell: path.relative(REPO_ROOT, SHELL_DIR) },
    pluginsDir: path.relative(REPO_ROOT, EVIDENCE_DIR),
    projectDir,
    stubCommandId: 'akari-stub.previewToolbarProbe',
    toolbarSelector: '.lm-TabBar-toolbar, .p-TabBar-toolbar',
    steps: [],
    tabs: {},
    checks: [],
    failures: []
};
const record = (step, data = {}) => { results.steps.push({ step, ...data }); console.log(`[${step}]`, JSON.stringify(data).slice(0, 600)); };
const check = (ok, message, detail = {}) => {
    results.checks.push({ ok, message, ...detail });
    if (!ok) results.failures.push({ message, ...detail });
    console.log(`[${ok ? 'PASS' : 'FAIL'}] ${message}`, JSON.stringify(detail).slice(0, 400));
    return ok;
};
const save = async () => writeFile(path.join(outDir, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);

async function waitFor(labelText, fn, timeoutMs = 90_000, intervalMs = 400) {
    const deadline = Date.now() + timeoutMs; let last;
    while (Date.now() < deadline) {
        try { const v = await fn(); if (v) return v; } catch (e) { last = e; }
        await sleep(intervalMs);
    }
    throw new Error(`${labelText} not reached${last ? `: ${last.message ?? last}` : ''}`);
}

// ---------- Electron 起動 ----------
const logFd = (await import('node:fs')).openSync(logFile, 'w');
const child = spawn(ELECTRON, [
    SHELL_DIR,
    projectDir,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    `--plugins=local-dir:${EVIDENCE_DIR}`,
    '--no-sandbox',
    '--disable-features=MacWebContentsOcclusion',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding'
], { stdio: ['ignore', logFd, logFd], env: { ...process.env, THEIA_CONFIG_DIR: userDataDir }, detached: false });
record('electron-spawn', { pid: child.pid, log: logFile });

let main;
const cleanup = async () => { main?.close(); try { child.kill('SIGTERM'); } catch { /* ignore */ } await sleep(800); try { child.kill('SIGKILL'); } catch { /* ignore */ } };
process.on('exit', () => { try { child.kill('SIGKILL'); } catch { /* ignore */ } });

try {
    const target = await waitFor('CDP page target', async () => {
        const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(4000) });
        const list = await res.json();
        return list.find(t => t.type === 'page' && /localhost|index\.html/u.test(t.url)) ?? list.find(t => t.type === 'page') ?? null;
    }, 120_000);
    main = new CDP(target.webSocketDebuggerUrl);
    await main.connect();
    const consoleLines = [];
    main.on('Runtime.consoleAPICalled', p => {
        const text = (p.args ?? []).map(a => a.value ?? a.description ?? '').join(' ');
        if (/akari-shell-strip/u.test(text)) consoleLines.push(`[${p.type}] ${text}`.slice(0, 400));
    });
    results.consoleLines = consoleLines;
    await main.send('Page.enable');
    await main.send('Runtime.enable');
    await main.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
    await main.send('Page.bringToFront');

    const evalJs = async expr => {
        const r = await main.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails) throw new Error(`eval failed: ${JSON.stringify(r.exceptionDetails).slice(0, 400)}`);
        return r.result.value;
    };

    await waitFor('frontend ready', () => evalJs(`document.readyState === 'complete' && Boolean(window.theia && window.theia.container)`), 180_000);
    // プロジェクト同意ダイアログ（「使う」/「開くだけ」）は「開くだけ」で抜ける。
    await evalJs(`(() => { const b=[...document.querySelectorAll('button')].find(e=>e.textContent?.trim()==='開くだけ'); if (b) { b.click(); return true; } return false; })()`);
    await sleep(1500);

    // ---------- DI ハンドルを duck typing で拾う（production ビルドはクラス名が当てにならない） ----------
    const bootstrap = await evalJs(`(() => {
      const keys = [...window.theia.container._bindingDictionary._map.keys()];
      const get = k => window.theia.container.get(k);
      const find = p => keys.find(p);
      // prototype 上の同名メンバが getter のクラスがあり、素で触ると throw する
      // （rebind でキー順が変わると踏む）。必ず try/catch でくるむ。
      const has = (k, ...names) => {
        if (typeof k !== 'function') return false;
        try { return names.every(n => typeof k.prototype?.[n] === 'function'); } catch (e) { return false; }
      };
      const shellKey = find(k => has(k, 'collapsePanel', 'revealWidget'));
      const cmdKey = find(k => has(k, 'executeCommand', 'registerCommand'));
      const wsKey = find(k => has(k, 'tryGetRoots'));
      const openerSym = find(k => typeof k === 'symbol' && String(k) === 'Symbol(OpenerService)');
      const toolbarKey = find(k => has(k, 'visibleItems', 'registerMenuDelegate', 'unregisterMenuDelegate'));
      const menuKey = find(k => has(k, 'getMenu', 'registerMenuAction'));
      if (!shellKey || !cmdKey || !wsKey || !openerSym || !toolbarKey) {
        return { ok: false, found: { shellKey: !!shellKey, cmdKey: !!cmdKey, wsKey: !!wsKey, openerSym: !!openerSym, toolbarKey: !!toolbarKey } };
      }
      const p = window.__probe = {
        shell: get(shellKey), commands: get(cmdKey), workspace: get(wsKey),
        opener: get(openerSym), toolbar: get(toolbarKey), menus: menuKey ? get(menuKey) : null
      };
      p.registryCtor = p.toolbar.constructor?.name ?? null;
      p.uriOf = raw => {
        const root = p.workspace.tryGetRoots()[0].resource;
        return new (root.constructor)(raw);
      };
      p.openPath = async abs => {
        const uri = p.uriOf('file://' + abs);
        const handler = await p.opener.getOpener(uri);
        const w = await handler.open(uri);
        const id = w && w.id;
        if (id) { try { await p.shell.activateWidget(id); } catch (e) { /* ignore */ } }
        return { id: id ?? null, handler: handler.id ?? null, ctor: w?.constructor?.name ?? null };
      };
      p.describeToolbars = wantedId => {
        // ウィンドウにフォーカスが無い CDP 実行では shell.currentWidget が null になるため、
        // 直前に開いた widget id を優先して解決する（DOM 側は activateWidget 済みの現タブを描いている）。
        const current = (wantedId && p.shell.getWidgetById ? p.shell.getWidgetById(wantedId) : null)
          ?? p.shell.currentWidget
          ?? p.shell.mainPanel?.currentTitle?.owner
          ?? null;
        const bars = [...document.querySelectorAll('#theia-main-content-panel .lm-TabBar-toolbar, #theia-main-content-panel .p-TabBar-toolbar')];
        const visible = bars.filter(b => b.checkVisibility ? b.checkVisibility() : b.offsetParent !== null);
        const domIds = [];
        const domItems = [];
        for (const bar of visible) {
          for (const child of bar.children) {
            const ids = [...(child.id ? [child.id] : []), ...[...child.querySelectorAll('[id]')].map(e => e.id)];
            for (const id of ids) domIds.push(id);
            domItems.push({
              ids,
              className: child.className,
              title: child.getAttribute('title') ?? child.querySelector('[title]')?.getAttribute('title') ?? null,
              ariaLabel: child.getAttribute('aria-label') ?? child.querySelector('[aria-label]')?.getAttribute('aria-label') ?? null,
              tag: child.tagName.toLowerCase()
            });
          }
        }
        let registryIds = null;
        try { registryIds = current ? p.toolbar.visibleItems(current).map(i => i.id) : null; } catch (e) { registryIds = ['<error> ' + String(e).slice(0, 120)]; }
        const rect = visible[0]?.closest('.lm-TabBar, .p-TabBar')?.getBoundingClientRect?.();
        return {
          widgetId: current?.id ?? null,
          currentTitleId: p.shell.mainPanel?.currentTitle?.owner?.id ?? null,
          widgetCtor: current?.constructor?.name ?? null,
          widgetViewType: current?.viewType ?? null,
          widgetIdentifier: current?.identifier ? { id: current.identifier.id } : null,
          visibleToolbars: visible.length,
          domIds, domItems, registryIds,
          tabBarRect: rect ? { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) } : null
        };
      };
      // AkariTabBarToolbarRegistry だけが持つインスタンスフィールド（クラス名は minify で
      // 当てにならないので、rebind が効いているかはこれで見る）。
      p.registrySubclass = Boolean(p.toolbar && p.toolbar.loggedIds && typeof p.toolbar.loggedIds.has === 'function');
      return { ok: true, registryCtor: p.registryCtor, registrySubclass: p.registrySubclass };
    })()`);
    record('bootstrap', bootstrap);
    if (!bootstrap.ok) throw new Error(`DI bootstrap failed: ${JSON.stringify(bootstrap.found)}`);
    results.registryCtor = bootstrap.registryCtor;
    results.registrySubclass = bootstrap.registrySubclass;
    check(bootstrap.registrySubclass === (label === 'after'),
        `TabBarToolbarRegistry の rebind が ${label === 'after' ? '効いている' : '無い（分岐点ビルド）'}`,
        { registryCtor: bootstrap.registryCtor, registrySubclass: bootstrap.registrySubclass });

    // ---------- スタブ拡張が実際に配備されたことを先に確かめる ----------
    const stub = await waitFor('stub plugin menu registered', async () => {
        const r = await evalJs(`(() => {
          const p = window.__probe;
          const cmd = p.commands.getCommand ? p.commands.getCommand('akari-stub.previewToolbarProbe') : null;
          const menu = p.menus && p.menus.getMenu ? p.menus.getMenu(['plugin_editor/title']) : null;
          const walk = node => {
            if (!node) return [];
            const out = [node.id];
            for (const c of node.children ?? []) out.push(...walk(c));
            return out;
          };
          return { command: cmd ? cmd.id : null, menuNodeIds: walk(menu) };
        })()`);
        return r.command || r.menuNodeIds.some(id => String(id).includes('akari-stub')) ? r : null;
    }, 120_000);
    record('stub-plugin', stub);
    check(Boolean(stub.command) || stub.menuNodeIds.some(id => String(id).includes('akari-stub')),
        'スタブ拡張の editor/title 貢献が配備されている', stub);

    const shot = async (name, clip) => {
        const params = { format: 'png' };
        if (clip) params.clip = { ...clip, scale: 1 };
        const { data } = await main.send('Page.captureScreenshot', params);
        const file = path.join(outDir, name);
        await writeFile(file, Buffer.from(data, 'base64'));
        return path.relative(REPO_ROOT, file);
    };

    const probeTab = async (key, absPath, shotIndex) => {
        let opened;
        try {
            opened = await evalJs(`window.__probe.openPath(${JSON.stringify(absPath)})`);
        } catch (error) {
            opened = { error: String(error).slice(0, 500) };
        }
        record(`open:${key}`, opened);
        await sleep(2500);
        let lastDescribe = null;
        const info = await waitFor(`${key} toolbar`, async () => {
            try {
                lastDescribe = await evalJs(`window.__probe.describeToolbars(${JSON.stringify(opened?.id ?? null)})`);
            } catch (error) {
                lastDescribe = { evalError: String(error).slice(0, 500) };
            }
            return lastDescribe?.widgetId ? lastDescribe : null;
        }, 60_000).catch(error => {
            results.failures.push({ message: `${key}: ${error.message}`, lastDescribe });
            throw error;
        });
        // タブバーのツールバーは「そのタブバーの currentTitle.owner」に対して描かれる。
        // 起動直後は Home タブに戻されることがあるので、対象タブが current になるまで
        // activate を打ち直し、そのうえで domIds が 2 連続一致するまで読み直す。
        let stable = null;
        for (let i = 0; i < 30; i++) {
            const next = await evalJs(`(async () => {
              const p = window.__probe;
              const id = ${JSON.stringify(opened?.id ?? null)};
              const cur = p.shell.mainPanel?.currentTitle?.owner?.id ?? null;
              if (id && cur !== id) { try { await p.shell.activateWidget(id); } catch (e) { /* ignore */ } }
              return p.describeToolbars(id);
            })()`);
            Object.assign(info, next);
            const snapshot = JSON.stringify(next.domIds);
            if (next.currentTitleId === (opened?.id ?? null) && snapshot === stable && next.domItems.length > 0) break;
            stable = snapshot;
            await sleep(1000);
        }
        const full = await shot(`${label}-0${shotIndex}-${key}.png`);
        let crop = null;
        if (info.tabBarRect && info.tabBarRect.w > 0) {
            const r = info.tabBarRect;
            crop = await shot(`${label}-0${shotIndex}-${key}-tabbar.png`,
                { x: r.x, y: Math.max(0, r.y - 2), width: r.w, height: Math.max(r.h + 4, 40) });
        }
        const stubItems = info.domIds.filter(id => id.includes('akari-stub'));
        const stubRegistryItems = (info.registryIds ?? []).filter(id => String(id).includes('akari-stub'));
        const entry = { ...info, opened, screenshots: { full, tabbar: crop }, stubItems, stubRegistryItems };
        results.tabs[key] = entry;
        record(`tab:${key}`, {
            widgetId: entry.widgetId, ctor: entry.widgetCtor, domIds: entry.domIds,
            registryIds: entry.registryIds, stubItems, stubRegistryItems
        });
        return entry;
    };

    // 1) 出力プレビュー（edit.json）
    const outputTab = await probeTab('output-preview', path.join(projectDir, 'edit.json'), 1);
    // 2) 素材プレビュー（source.mp4）
    const rawTab = await probeTab('raw-preview', path.join(projectDir, 'source.mp4'), 2);
    // 3) 開発者モード ON → Monaco エディタ（MEDIA.md）
    const devToggle = await evalJs(`(async () => {
      const p = window.__probe;
      const before = p.commands.isToggled ? p.commands.isToggled('akari.project.toggleDeveloperMode') : null;
      if (before !== true) await p.commands.executeCommand('akari.project.toggleDeveloperMode');
      return { before, after: p.commands.isToggled ? p.commands.isToggled('akari.project.toggleDeveloperMode') : null };
    })()`);
    record('developer-mode', devToggle);
    await sleep(2000);
    const monacoTab = await probeTab('monaco-editor', path.join(projectDir, 'MEDIA.md'), 3);

    // 開発者モード ON のまま出力プレビューへ戻り、除外ログ（右パネル curation と同じ流儀）を捕まえる。
    await evalJs(`(async () => { try { await window.__probe.shell.activateWidget(${JSON.stringify(outputTab.widgetId)}); } catch (e) { /* ignore */ } return true; })()`);
    await sleep(2500);
    const hidLogs = consoleLines.filter(l => l.includes('hid plugin toolbar items'));
    record('developer-mode-log', { hidLogs, allAkariLines: consoleLines.length });
    results.hidLogs = hidLogs;

    // ---------- 判定 ----------
    const isPreviewWebview = t => /WebviewWidget/u.test(String(t.widgetCtor)) || String(t.widgetId).startsWith('plugin-webview:');
    check(isPreviewWebview(outputTab), '出力プレビューが WebviewWidget として開いている',
        { widgetId: outputTab.widgetId, ctor: outputTab.widgetCtor });
    check(isPreviewWebview(rawTab), '素材プレビューが WebviewWidget として開いている',
        { widgetId: rawTab.widgetId, ctor: rawTab.widgetCtor });
    check(/EditorWidget|Editor/u.test(String(monacoTab.widgetCtor)) || String(monacoTab.widgetId).startsWith('code-editor-opener'),
        '開発者モードで Monaco エディタタブが開いている', { widgetId: monacoTab.widgetId, ctor: monacoTab.widgetCtor });

    const expectPreviewStub = label === 'before';
    for (const [key, tab] of [['output-preview', outputTab], ['raw-preview', rawTab]]) {
        const has = tab.stubItems.length > 0;
        check(has === expectPreviewStub,
            `${key}: スタブ拡張のツールバー項目が ${expectPreviewStub ? '出る（再現成立）' : '出ない（0 件）'}`,
            { stubItems: tab.stubItems, stubRegistryItems: tab.stubRegistryItems, domIds: tab.domIds });
    }
    check(monacoTab.stubItems.length > 0, 'Monaco エディタでは BEFORE / AFTER とも スタブ拡張の項目が出る（残す側の保証）',
        { stubItems: monacoTab.stubItems, domIds: monacoTab.domIds });
    check((hidLogs.length > 0) === (label === 'after'),
        `開発者モードの除外ログが ${label === 'after' ? '出る' : '出ない（分岐点ビルド）'}`, { hidLogs });

    results.status = results.failures.length === 0 ? 'PASS' : 'FAIL';
} catch (error) {
    results.status = 'ERROR';
    results.failures.push({ message: String(error?.stack ?? error) });
    console.error(error);
} finally {
    results.finishedAt = new Date().toISOString();
    await save();
    await cleanup();
}
console.log(`\n=== ${label}: ${results.status} (failures: ${results.failures.length}) ===`);
process.exit(results.status === 'PASS' ? 0 : 1);
