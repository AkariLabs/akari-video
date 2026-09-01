// quick-export-one-click の L1 検証ヘルパー。
// evidence/quick-export（2026-07-25）の launch.mjs / scenario-helpers.mjs を踏襲し、
// 本タスク用に (a) Electron 実体の場所（リポジトリ直下 node_modules）
// (b) THEIA_CONFIG_DIR による user settings.json の隔離
// (c) quick-pick の「出ないこと」を測るための否定プローブ
// を足したもの。検証専用（製品コードではない）。
import { spawn, execSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { evalMain, realClick, connectMain, screenshot } from './cdp-lib.mjs';

// リポジトリ直下。このファイルは apps/shell/extensions/akari-shell-strip/evidence/quick-export-one-click/ にあるので
// 6 階層上。ローカルの worktree 配置は書かず、AKARI_REPO か import.meta.url から導く。
export const REPO = process.env.AKARI_REPO || fileURLToPath(new URL('../../../../../../', import.meta.url)).replace(/\/$/u, '');
export const SHELL_APP = `${REPO}/apps/shell`;
export const ELECTRON_BIN = `${REPO}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`;

export function launchElectron({ workspaceDir, cdpPort, userDataDir, themeConfigDir, logPath }) {
    const child = spawn(ELECTRON_BIN, [
        SHELL_APP,
        workspaceDir,
        `--remote-debugging-port=${cdpPort}`,
        `--user-data-dir=${userDataDir}`,
        '--no-sandbox',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding'
    ], {
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, THEIA_CONFIG_DIR: themeConfigDir }
    });
    let log = '';
    child.stdout.on('data', d => { log += d.toString(); });
    child.stderr.on('data', d => { log += d.toString(); });
    if (logPath) {
        process.on('exit', () => { try { writeFileSync(logPath, log); } catch { /* best effort */ } });
    }
    return child;
}

function descendantPids(rootPid) {
    const all = [rootPid];
    let frontier = [rootPid];
    for (let depth = 0; depth < 8 && frontier.length > 0; depth++) {
        const next = [];
        for (const pid of frontier) {
            let out = '';
            try { out = execSync(`pgrep -P ${pid} || true`).toString(); } catch { out = ''; }
            for (const line of out.split('\n')) {
                const child = Number(line.trim());
                if (Number.isInteger(child) && child > 0 && !all.includes(child)) {
                    all.push(child);
                    next.push(child);
                }
            }
        }
        frontier = next;
    }
    return all;
}

export function killElectronTree(rootPid, userDataDir) {
    for (const pid of descendantPids(rootPid)) {
        try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
    }
    if (userDataDir) {
        try { execSync(`pkill -9 -f "${userDataDir}"`, { stdio: 'ignore' }); } catch { /* none left */ }
    }
}

function isAlive(pid) {
    try { process.kill(pid, 0); return true; } catch { return false; }
}

export async function assertNoOrphans(rootPid, userDataDir, attempts = 30) {
    for (let attempt = 0; attempt < attempts; attempt++) {
        killElectronTree(rootPid, userDataDir);
        await sleep(300);
        const remainingTree = descendantPids(rootPid).filter(isAlive);
        let stringMatch = '';
        try {
            stringMatch = execSync(`ps aux | grep -F "${userDataDir}" | grep -v grep || true`).toString();
        } catch { stringMatch = ''; }
        if (remainingTree.length === 0 && stringMatch.trim() === '') return { ok: true };
        await sleep(500);
    }
    return { ok: false, remainingTreePids: descendantPids(rootPid).filter(isAlive) };
}

export async function connectMainWithRetry(cdpPort, budgetMs = 120000, intervalMs = 500) {
    const started = Date.now();
    let lastError;
    while (Date.now() - started < budgetMs) {
        try { return await connectMain(cdpPort); } catch (error) { lastError = error; await sleep(intervalMs); }
    }
    throw lastError;
}

export async function waitForAppReady(cdp, timeoutMs = 90000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const state = await evalMain(cdp, `(() => {
      const menu = Array.from(document.querySelectorAll('.codicon-menu')).find(e => e.getBoundingClientRect().width > 0);
      const preloadGone = document.getElementsByClassName('theia-preload').length === 0;
      return { menuFound: !!menu, preloadGone };
    })()`);
        if (state.menuFound && state.preloadGone) return true;
        await sleep(500);
    }
    return false;
}

export async function connectAndWaitReady(cdpPort, { retries = 3, readyTimeoutMs = 100000 } = {}) {
    for (let attempt = 0; attempt < retries; attempt++) {
        const cdp = await connectMainWithRetry(cdpPort);
        if (await waitForAppReady(cdp, readyTimeoutMs)) return cdp;
        cdp.close();
        await sleep(500);
    }
    throw new Error(`app did not become ready after ${retries} connect attempts`);
}

export async function clickMenuIcon(cdp) {
    const state = await evalMain(cdp, `(() => {
    const el = Array.from(document.querySelectorAll('.codicon-menu')).find(e => e.getBoundingClientRect().width > 0);
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
    if (state.found) { await realClick(cdp, state.x, state.y); await sleep(800); }
    return state;
}

export async function clickButtonByText(cdp, text) {
    const btn = await evalMain(cdp, `(() => {
    const el = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === ${JSON.stringify(text)});
    if (!el) return { found: false };
    if (el.disabled) return { found: false, disabled: true };
    const r = el.getBoundingClientRect();
    return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
    if (!btn.found) throw new Error(`button not clickable: ${text} ${JSON.stringify(btn)}`);
    await realClick(cdp, btn.x, btn.y);
    return btn;
}

export async function buttonState(cdp, text) {
    return evalMain(cdp, `(() => {
    const el = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === ${JSON.stringify(text)});
    return el ? { found: true, disabled: el.disabled, title: el.title } : { found: false };
  })()`);
}

/** quick-input が可視かどうか + その placeholder を 1 回だけ読む（否定プローブの単位）。 */
export async function quickInputProbe(cdp) {
    return evalMain(cdp, `(() => {
    const widget = document.querySelector('.quick-input-widget');
    if (!widget) return { present: false, visible: false, placeholder: null };
    const style = getComputedStyle(widget);
    const rect = widget.getBoundingClientRect();
    const visible = style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    const input = widget.querySelector('input');
    return { present: true, visible, placeholder: visible && input ? input.placeholder : null };
  })()`);
}

export async function waitForQuickInputPlaceholder(cdp, placeholder, attempts = 200) {
    for (let attempt = 0; attempt < attempts; attempt++) {
        const state = await quickInputProbe(cdp);
        if (state.visible && state.placeholder === placeholder) return;
        await sleep(200);
    }
    throw new Error('quick input did not reach expected placeholder: ' + placeholder);
}

export async function clickQuickPickRow(cdp, text) {
    let clicked = false;
    for (let attempt = 0; attempt < 100 && !clicked; attempt++) {
        const row = await evalMain(cdp, `(() => {
      const widget = document.querySelector('.quick-input-widget');
      if (!widget || getComputedStyle(widget).display === 'none') return { found: false };
      const rows = Array.from(widget.querySelectorAll('.monaco-list-row'));
      const row = rows.find(r => r.textContent.trim() === ${JSON.stringify(text)});
      if (!row) return { found: false };
      const r = row.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return { found: false };
      return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
        if (row.found) { await realClick(cdp, row.x, row.y); clicked = true; break; }
        await sleep(200);
    }
    if (!clicked) throw new Error('quick pick row not found/visible: ' + text);
    for (let attempt = 0; attempt < 100; attempt++) {
        const stillThere = await evalMain(cdp, `(() => {
      const widget = document.querySelector('.quick-input-widget');
      if (!widget || getComputedStyle(widget).display === 'none') return false;
      const rows = Array.from(widget.querySelectorAll('.monaco-list-row'));
      return rows.some(r => r.textContent.trim() === ${JSON.stringify(text)} && r.getBoundingClientRect().width > 0);
    })()`);
        if (!stillThere) { await sleep(300); return; }
        await sleep(200);
    }
    throw new Error('quick pick did not advance after clicking row: ' + text);
}

/** 現在の quick-pick に並ぶ行ラベル一覧（「エンジンの質問が無い」ことの証拠に使う）。 */
export async function quickPickRows(cdp) {
    return evalMain(cdp, `(() => {
    const widget = document.querySelector('.quick-input-widget');
    if (!widget || getComputedStyle(widget).display === 'none') return [];
    return Array.from(widget.querySelectorAll('.monaco-list-row')).map(r => r.textContent.trim());
  })()`);
}

export async function toastMessages(cdp) {
    return evalMain(cdp, `Array.from(document.querySelectorAll('.theia-notification-message')).map(n => n.textContent.trim())`);
}

export async function exportSectionText(cdp) {
    return evalMain(cdp, `(() => {
    const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.trim() === '書き出し');
    const s = b ? b.closest('section') : null;
    return s ? s.textContent.trim() : null;
  })()`);
}

/**
 * 書き出しセクションの (1) phase ラベル（renderQuickExportStatus の 1 行目）と
 * (2) render.json 進捗パネルのラベル行だけを取り出す。セクション全文だと
 * ボタン名や <style> 文字列に埋もれるため、ラベルだけを個別に読む。
 */
export async function progressLabels(cdp) {
    return evalMain(cdp, `(() => {
    const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.trim() === '書き出し');
    const s = b ? b.closest('section') : null;
    if (!s) return { phaseLabel: null, progressLabel: null };
    const texts = Array.from(s.querySelectorAll('div, span'))
      .map(n => n.textContent.trim())
      .filter(t => t.startsWith('書き出し中') || t.startsWith('書き出し完了') || t.startsWith('この場で') || t.startsWith('lint'));
    return { labels: Array.from(new Set(texts)) };
  })()`);
}

export async function installErrorCounter(cdp) {
    await evalMain(cdp, `(() => {
    window.__errLog = [];
    window.__toastLog = [];
    const orig = console.error;
    console.error = (...args) => { window.__errLog.push(String(args[0]).slice(0, 300)); orig(...args); };
    window.addEventListener('error', (e) => { window.__errLog.push('window.error: ' + (e.message || '')); });
    window.addEventListener('unhandledrejection', (e) => { window.__errLog.push('unhandledrejection: ' + String(e.reason).slice(0, 300)); });
    const observer = new MutationObserver(() => {
      for (const node of document.querySelectorAll('.theia-notification-message')) {
        const text = node.textContent.trim();
        if (text && !window.__toastLog.includes(text)) window.__toastLog.push(text);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return true;
  })()`);
}

export async function errorLog(cdp) {
    return evalMain(cdp, 'window.__errLog || []');
}

export async function toastLog(cdp) {
    return evalMain(cdp, 'window.__toastLog || []');
}

export { sleep, evalMain, realClick, screenshot };
