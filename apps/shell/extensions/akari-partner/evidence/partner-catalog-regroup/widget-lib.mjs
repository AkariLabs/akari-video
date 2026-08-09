// partner-catalog-regroup 検証専用の DOM フック集。cdp-lib.mjs（catalog-account-first-ux と
// 同一・中身無改変）の上に積む。akari-partner-catalog-widget.tsx / akari-partner-widget.tsx の
// 現行実装を実際に確認して書いた（data-partner-agent / data-extension-id / data-akari-flow-state
// は本タスクまたは既存実装が持つ実 DOM 属性）。
import { setTimeout as sleep } from 'node:timers/promises';
import { evalMain, realClick } from './cdp-lib.mjs';

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
export async function errorCount(cdp) { return evalMain(cdp, 'window.__errCount'); }
export async function errorLog(cdp) { return evalMain(cdp, 'window.__errLog || []'); }

/**
 * AkariPartnerCatalogWidget は Theia 標準の VSXExtensionsViewContainer.ID
 * ('vsx-extensions-view-container') を再利用しているため、既存の「拡張機能」
 * アクティビティバーアイコン（codicon-extensions）からそのまま到達できる
 * （akari-partner-contribution.ts の onStart() で置き換え済み）。
 */
export async function revealPartnerCatalog(cdp) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const state = await evalMain(cdp, `(() => {
      const el = document.querySelector('[data-akari-catalog-count]');
      if (!el) return { visible: false };
      const r = el.getBoundingClientRect();
      return { visible: r.width > 0 && r.height > 0, count: el.getAttribute('data-akari-catalog-count') };
    })()`);
    if (state.visible) return state;
    const icon = await evalMain(cdp, `(() => {
      const el = Array.from(document.querySelectorAll('.codicon-extensions')).find(e => e.getBoundingClientRect().width > 0);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!icon) { await sleep(600); continue; }
    await realClick(cdp, icon.x, icon.y);
    await sleep(600);
  }
  throw new Error('partner catalog widget did not become visible after toggling the extensions activity icon');
}

/** グループ化された 1 エージェント = 1 カードの構造を読み取る（実 DOM から）。 */
export async function catalogGroups(cdp) {
  return evalMain(cdp, `Array.from(document.querySelectorAll('[data-partner-agent]')).map(section => {
    const r = section.getBoundingClientRect();
    return {
      agent: section.getAttribute('data-partner-agent'),
      cardWidth: Math.round(r.width),
      hasBadge: section.textContent.includes('推奨'),
      slots: Array.from(section.querySelectorAll('[data-extension-id]')).map(slot => {
        const sr = slot.getBoundingClientRect();
        return { id: slot.getAttribute('data-extension-id'), width: Math.round(sr.width), height: Math.round(sr.height) };
      })
    };
  })`);
}

async function clickSetupButtonFor(cdp, extensionId) {
  // カード一覧は左パネル内でスクロールする（137px 幅の細いサイドバーに3枚縦積み）。
  // ボタンがビューポート外にあると座標クリックが空振りする（実測で判明: opencode
  // カードの「セットアップ」ボタンが y=1294 でビューポート高さ 668 の外だった）ため、
  // クリック前に必ず scrollIntoView() してから改めて座標を取り直す。
  await evalMain(cdp, `(() => {
    const slot = document.querySelector('[data-extension-id=${JSON.stringify(extensionId)}]');
    if (!slot) return false;
    const btn = Array.from(slot.querySelectorAll('button')).find(b => b.textContent.trim() === 'セットアップ');
    if (!btn) return false;
    btn.scrollIntoView({ block: 'center' });
    return true;
  })()`);
  await sleep(300);
  const state = await evalMain(cdp, `(() => {
    const slot = document.querySelector('[data-extension-id=${JSON.stringify(extensionId)}]');
    if (!slot) return { found: false, reason: 'slot not found' };
    const btn = Array.from(slot.querySelectorAll('button')).find(b => b.textContent.trim() === 'セットアップ');
    if (!btn) return { found: false, reason: 'button not found' };
    const r = btn.getBoundingClientRect();
    const visible = r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth && r.width > 0 && r.height > 0;
    return { found: true, visible, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!state.found) throw new Error(`setup button not found for ${extensionId}: ${state.reason}`);
  if (!state.visible) throw new Error(`setup button for ${extensionId} is still outside the viewport after scrollIntoView: ${JSON.stringify(state)}`);
  await realClick(cdp, state.x, state.y);
  await sleep(400);
}
export async function clickOpencodeSetup(cdp) { await clickSetupButtonFor(cdp, 'sst/opencode-cli'); }
export async function clickClaudeCliSetup(cdp) { await clickSetupButtonFor(cdp, 'anthropic/claude-code-cli'); }

/** AkariPartnerWidget（右パネル「パートナーを追加」）の進捗ステータスカード。 */
export async function rightPanelFlowState(cdp) {
  return evalMain(cdp, `(() => {
    const el = document.querySelector('[data-akari-flow-state]');
    if (!el) return { present: false };
    return {
      present: true,
      state: el.getAttribute('data-akari-flow-state'),
      entry: el.getAttribute('data-partner-entry'),
      text: el.textContent
    };
  })()`);
}

/** xterm.js の描画済み行テキスト（全ターミナルを連結）。存在しなければ空文字。 */
export async function terminalBufferText(cdp) {
  return evalMain(cdp, `Array.from(document.querySelectorAll('.xterm-rows')).map(el => el.textContent).join('\\n')`);
}

/**
 * 実測: このバージョンの Lumino は `lm-TabBar-tabLabel`（旧 `p-TabBar-tabLabel` ではない）
 * を使う。
 */
export async function terminalTabTitles(cdp) {
  return evalMain(cdp, `Array.from(document.querySelectorAll('.lm-TabBar-tabLabel')).map(el => el.textContent)`);
}

export async function waitFor(pollFn, predicate, timeoutMs) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    last = await pollFn();
    if (predicate(last)) return last;
    await sleep(300);
  }
  return last;
}

export { sleep };
