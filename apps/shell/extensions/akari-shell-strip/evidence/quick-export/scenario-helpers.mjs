// export-button（evidence/export-button/run-l1.mjs）と同じ流儀の DOM/quick-input
// 操作ヘルパー群。quick-export タスクの4シナリオで共通利用する。
import { setTimeout as sleep } from 'node:timers/promises';
import { evalMain, realClick, connectMain } from './cdp-lib.mjs';

/**
 * cdp-lib.mjs の connectMain は CDP ポートがまだ開いていない最初の fetch で
 * 例外を投げると（ECONNREFUSED）そのままリトライループごと外へ抜けてしまう
 * （ループ内に try/catch が無いため）。Electron 起動直後は数秒このポートが
 * 未オープンなので、connectMain 自体を外側からリトライして吸収する
 * （cdp-lib.mjs は既存の共有ヘルパーのため中身は無改変の方針）。
 */
export async function connectMainWithRetry(cdpPort, budgetMs = 120000, intervalMs = 500) {
    const started = Date.now();
    let lastError;
    while (Date.now() - started < budgetMs) {
        try {
            return await connectMain(cdpPort);
        } catch (error) {
            lastError = error;
            await sleep(intervalMs);
        }
    }
    throw lastError;
}

/**
 * production ビルドは起動直後しばらく Theia 標準の `.theia-preload` スプラッシュ
 * オーバーレイに覆われる（@theia/core frontend-application.ts の revealShell が
 * `theia-hidden` 付与 → CSS transition 後に DOM から除去する、が完了するまで
 * activity bar 自体は DOM 上に存在していても操作不能）。固定 sleep ではなく、
 * メニューアイコンの存在 **かつ** `.theia-preload` の消失（またはそもそも
 * 一度も現れず既に無い場合）の両方をポーリングする。
 */
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

/**
 * connectMain() は `/json/list` の最初の type:'page' ターゲットへ固定で
 * websocket接続する。Electron 起動直後は複数の一時的なページターゲット
 * （プラグインホストのウェブビュー等）が現れることがあり、まれに本命の
 * Theia レンダラーではないターゲットへ繋がってしまうと、そのまま
 * waitForAppReady が延々とタイムアウトする（実測: 起動ログは健全なのに
 * codicon-menu がいつまでも見えないケースが発生）。これを吸収するため、
 * waitForAppReady がタイムアウトしたら接続を張り直して再試行する。
 */
export async function connectAndWaitReady(cdpPort, { retries = 3, readyTimeoutMs = 100000 } = {}) {
    for (let attempt = 0; attempt < retries; attempt++) {
        const cdp = await connectMainWithRetry(cdpPort);
        const ready = await waitForAppReady(cdp, readyTimeoutMs);
        if (ready) {
            return cdp;
        }
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
    if (state.found) { await realClick(cdp, state.x, state.y); await sleep(500); }
    return state;
}

export async function exportButtonState(cdp) {
    return evalMain(cdp, `(() => {
    const target = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '書き出し');
    return target ? { found: true, disabled: target.disabled, title: target.title } : { found: false };
  })()`);
}

export async function clickExportButton(cdp) {
    const btn = await evalMain(cdp, `(() => {
    const el = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '書き出し');
    if (!el || el.disabled) return { found: false, disabled: el ? el.disabled : null };
    const r = el.getBoundingClientRect();
    return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
    if (!btn.found) throw new Error('export button not clickable: ' + JSON.stringify(btn));
    await realClick(cdp, btn.x, btn.y);
    await sleep(500);
}

export async function clickQuickPickRow(cdp, text) {
    let clicked = false;
    for (let attempt = 0; attempt < 75 && !clicked; attempt++) {
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
        if (row.found) {
            await realClick(cdp, row.x, row.y);
            clicked = true;
            break;
        }
        await sleep(200);
    }
    if (!clicked) throw new Error('quick pick row not found/visible: ' + text);
    for (let attempt = 0; attempt < 75; attempt++) {
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

/**
 * `retryAction` を渡すと、重い負荷下で直前の確定操作（Enter 押下・行クリック）
 * 自体が反映されず据え置きになるケースを吸収するため、一定間隔で
 * 確定操作を再実行しながら目的の placeholder を待つ（同じ操作の再実行は
 * べき等 — Enter 再押下・同じ行の再クリックはどちらも安全）。
 */
export async function waitForQuickInputPlaceholder(cdp, placeholder, attempts = 150, retryAction) {
    const retryEveryAttempts = 15; // 200ms * 15 = 3秒おき
    for (let attempt = 0; attempt < attempts; attempt++) {
        const state = await evalMain(cdp, `(() => {
      const widget = document.querySelector('.quick-input-widget');
      const input = widget ? widget.querySelector('input') : null;
      const visible = !!widget && getComputedStyle(widget).display !== 'none';
      return { visible, placeholder: input ? input.placeholder : null };
    })()`);
        if (state.visible && state.placeholder === placeholder) return;
        if (retryAction && attempt > 0 && attempt % retryEveryAttempts === 0) {
            await retryAction();
        }
        await sleep(200);
    }
    throw new Error('quick input did not reach expected placeholder: ' + placeholder);
}

export async function focusQuickInput(cdp) {
    const rect = await evalMain(cdp, `(() => {
    const input = document.querySelector('.quick-input-widget input');
    if (!input) return null;
    const r = input.getBoundingClientRect();
    if (r.width === 0) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
    if (rect) {
        await realClick(cdp, rect.x, rect.y);
        await sleep(150);
    }
}

export async function pressEnter(cdp) {
    await focusQuickInput(cdp);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 13, key: 'Enter' });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, key: 'Enter' });
    await sleep(500);
}

export async function pressEscape(cdp) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 27, key: 'Escape' });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 27, key: 'Escape' });
    await sleep(400);
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

export async function installErrorCounter(cdp) {
    await evalMain(cdp, `(() => {
    window.__errCount = 0;
    window.__errLog = [];
    const orig = console.error;
    console.error = (...args) => { window.__errCount++; window.__errLog.push(String(args[0]).slice(0, 300)); orig(...args); };
    window.addEventListener('error', (e) => { window.__errCount++; window.__errLog.push('window.error: ' + (e.message || '')); });
    window.addEventListener('unhandledrejection', (e) => { window.__errCount++; window.__errLog.push('unhandledrejection: ' + String(e.reason).slice(0, 300)); });
    return true;
  })()`);
}

export async function errorLog(cdp) {
    return evalMain(cdp, 'window.__errLog || []');
}

/**
 * 高負荷下では Enter キー押下が入力欄へフォーカスが乗り切る前後の一瞬の
 * レースで反映されないことがある（マウスクリックで行の消失を直接確認できる
 * quick-pick と違い、プレーン input の Enter 確定は「まだ同じ placeholder に
 * 留まっているか」でしか判定できない）。留まっている間だけ Enter を
 * 再送する retryAction を添えて待つ。
 */
export async function stillOnPlaceholder(cdp, placeholder) {
    return evalMain(cdp, `(() => {
    const widget = document.querySelector('.quick-input-widget');
    const input = widget ? widget.querySelector('input') : null;
    return !!widget && getComputedStyle(widget).display !== 'none' && input && input.placeholder === ${JSON.stringify(placeholder)};
  })()`);
}

/** 出力ファイル名ステップの Enter 確定 → 次 placeholder 待ちを、取りこぼし再送込みで行う。 */
export async function confirmFilenameAndWait(cdp, nextPlaceholder, attempts = 150) {
    await pressEnter(cdp);
    await waitForQuickInputPlaceholder(cdp, nextPlaceholder, attempts, async () => {
        if (await stillOnPlaceholder(cdp, '出力ファイル名')) {
            await pressEnter(cdp);
        }
    });
}

/** 「書き出し」ボタン押下 → quick-pick 4連鎖まで実行する共通シーケンス。 */
export async function runQuickPickChain(cdp, { resolutionLabel, outputName, rerunLintLabel, executionModeLabel }) {
    await clickExportButton(cdp);
    await waitForQuickInputPlaceholder(cdp, '解像度プリセットを選択');
    await clickQuickPickRow(cdp, resolutionLabel);
    await waitForQuickInputPlaceholder(cdp, '出力ファイル名');
    if (outputName !== undefined) {
        await evalMain(cdp, `(() => { document.querySelector('.quick-input-widget input').select(); })()`);
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 8, key: 'Backspace' });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 8, key: 'Backspace' });
        await sleep(150);
        await cdp.send('Input.insertText', { text: outputName });
        await sleep(200);
    }
    await confirmFilenameAndWait(cdp, 'lint を先に再実行しますか');
    await clickQuickPickRow(cdp, rerunLintLabel);
    await waitForQuickInputPlaceholder(cdp, '実行方法を選択', 200);
    await clickQuickPickRow(cdp, executionModeLabel);
    await sleep(500);
}

export { sleep };
