// partner-cli-phase2 検証専用の DOM フック集。cdp-lib.mjs（partner-ui-r2 / partner-catalog-regroup
// と同一・中身無改変）の上に積む。akari-partner-widget.tsx（右「パートナーを追加」パネル）/
// akari-partner-catalog-widget.tsx（左カタログ）の現行実装（6エージェント化後）を実際に
// 確認して書いた。data-partner-entry / data-partner-form / data-partner-action /
// data-akari-flow-state / data-akari-catalog-count / data-partner-agent / data-extension-id は
// 既存実装が持つ実 DOM 属性（partner-ui-r2 / partner-catalog-regroup からの流用）。
import { setTimeout as sleep } from 'node:timers/promises';
import { evalMain, realClick } from './cdp-lib.mjs';

const AGENT_OF = {
  'anthropic/claude-code-cli': 'claude',
  'anthropic/claude-code-extension': 'claude',
  'openai/codex-cli': 'codex',
  'openai/codex-extension': 'codex',
  'sst/opencode-cli': 'opencode',
  'github/copilot-cli': 'copilot',
  'cursor/cursor-cli': 'cursor',
  'google/antigravity-cli': 'antigravity'
};

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
 * 右「パートナーを追加」パネル（AkariPartnerWidget）は onStart() が起動直後に right area へ
 * 追加し activateWidget() まで行うため、追加の reveal 操作なしで最初から可視。
 * data-partner-entry を持つボタンの親要素（エージェント単位の行 div）でグルーピングして読み取る。
 */
export async function rightPanelRows(cdp) {
  return evalMain(cdp, `(() => {
    const AGENT_OF = ${JSON.stringify(AGENT_OF)};
    const buttons = Array.from(document.querySelectorAll('[data-partner-entry]'));
    const rows = [];
    for (const btn of buttons) {
      let row = rows.find(r => r.el === btn.parentElement);
      if (!row) { row = { el: btn.parentElement, buttons: [] }; rows.push(row); }
      row.buttons.push(btn);
    }
    return rows.map(row => {
      const rect = row.el.getBoundingClientRect();
      const buttons = row.buttons.map(btn => {
        const r = btn.getBoundingClientRect();
        return {
          entry: btn.getAttribute('data-partner-entry'),
          form: btn.getAttribute('data-partner-form'),
          action: btn.getAttribute('data-partner-action'),
          disabled: btn.disabled,
          width: Math.round(r.width),
          height: Math.round(r.height),
          hasBadge: btn.textContent.includes('推奨')
        };
      });
      const agents = new Set(buttons.map(b => AGENT_OF[b.entry]));
      return { agent: agents.size === 1 ? [...agents][0] : [...agents].join('+'), rowWidth: Math.round(rect.width), buttons };
    });
  })()`);
}

/**
 * 右パネルは Lumino のタブ付き DockPanel（「パートナーを追加」/ 開いた PTY タブ等が同居）。
 * PTY タブを開くと「パートナーを追加」タブが非アクティブになり、中身が
 * `display:none`（`lm-mod-hidden`）へ切り替わる実測を確認した（opencode の実インストール
 * 成功後、PTY タブが自動でアクティブになり以後のボタンクリックが 0x0 で空振りした）。
 * 各クリック前に「パートナーを追加」タブを毎回アクティブ化することで、
 * どのタブが直前にアクティブでも安定して動作する。
 */
async function activatePartnerAddTab(cdp) {
  const tab = await evalMain(cdp, `(() => {
    const tabs = Array.from(document.querySelectorAll('.lm-TabBar-tab'));
    const match = tabs.find(t => {
      const label = t.querySelector('.lm-TabBar-tabLabel');
      if (!label || label.textContent !== 'パートナーを追加') return false;
      const r = t.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (!match) return null;
    const r = match.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!tab) return false; // already active (no tab bar entry needs clicking), or single-tab panel
  await realClick(cdp, tab.x, tab.y);
  await sleep(300);
  return true;
}

async function buttonVisibility(cdp, entryId) {
  return evalMain(cdp, `(() => {
    const btn = document.querySelector('[data-partner-entry=${JSON.stringify(entryId)}]');
    if (!btn) return { found: false, reason: 'button not found' };
    const r = btn.getBoundingClientRect();
    const visible = r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth && r.width > 0 && r.height > 0;
    return { found: true, visible, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
}

async function clickPartnerEntry(cdp, entryId) {
  // ボタンが既に見えているなら「パートナーを追加」タブの再アクティブ化は不要
  // （不要なクリックが別のタブ実体を誤って掴むリスクを避ける — 実測で発覚: 常時
  // activatePartnerAddTab() を呼ぶと、既に見えている状態でも意図せぬタブ実体を
  // クリックしてしまい逆にパネルを隠すことがあった）。見えていないときだけ再アクティブ化する。
  const before = await buttonVisibility(cdp, entryId);
  if (!before.found || !before.visible) {
    await activatePartnerAddTab(cdp);
    await sleep(200);
  }
  await evalMain(cdp, `(() => {
    const btn = document.querySelector('[data-partner-entry=${JSON.stringify(entryId)}]');
    if (!btn) return false;
    btn.scrollIntoView({ block: 'center' });
    return true;
  })()`);
  await sleep(300);
  const state = await buttonVisibility(cdp, entryId);
  if (!state.found) throw new Error(`partner entry button not found: ${entryId}: ${state.reason}`);
  if (!state.visible) throw new Error(`partner entry button for ${entryId} is still outside the viewport after scrollIntoView: ${JSON.stringify(state)}`);
  await realClick(cdp, state.x, state.y);
  await sleep(400);
}
export async function clickClaudeCli(cdp) { await clickPartnerEntry(cdp, 'anthropic/claude-code-cli'); }
export async function clickOpencodeCli(cdp) { await clickPartnerEntry(cdp, 'sst/opencode-cli'); }
export async function clickCopilotCli(cdp) { await clickPartnerEntry(cdp, 'github/copilot-cli'); }
export async function clickCursorCli(cdp) { await clickPartnerEntry(cdp, 'cursor/cursor-cli'); }
export async function clickAntigravityCli(cdp) { await clickPartnerEntry(cdp, 'google/antigravity-cli'); }

/** AkariPartnerWidget（右パネル）の進捗ステータスカード。 */
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

/**
 * 左カタログ（AkariPartnerCatalogWidget）は onStart() で left area rank 300 へ既に
 * 追加されているが、他ウィジェット（プロジェクトエクスプローラ等）の裏に隠れている
 * ことがあるため、可視になるまでアクティビティバーの拡張機能アイコンをトグルする
 * （partner-catalog-regroup / partner-ui-r2 と同じ手法）。
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

/** カード（data-partner-agent）ごとのスロット（data-extension-id）の位置・寸法・推奨バッジ。 */
export async function catalogGroups(cdp) {
  return evalMain(cdp, `Array.from(document.querySelectorAll('[data-partner-agent]')).map(section => {
    const r = section.getBoundingClientRect();
    return {
      agent: section.getAttribute('data-partner-agent'),
      cardWidth: Math.round(r.width),
      cardHeight: Math.round(r.height),
      hasBadge: section.textContent.includes('推奨'),
      slots: Array.from(section.querySelectorAll('[data-extension-id]')).map(slot => {
        const sr = slot.getBoundingClientRect();
        return { id: slot.getAttribute('data-extension-id'), width: Math.round(sr.width), height: Math.round(sr.height) };
      })
    };
  })`);
}

/**
 * 実測: このバージョンの Lumino は `lm-TabBar-tabLabel`（旧 `p-TabBar-tabLabel` ではない）を使う。
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
