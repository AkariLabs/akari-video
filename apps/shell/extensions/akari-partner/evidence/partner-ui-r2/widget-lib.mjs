// partner-ui-r2 検証専用の DOM フック集。cdp-lib.mjs（partner-catalog-regroup と同一・
// 中身無改変）の上に積む。akari-partner-widget.tsx（右「パートナーを追加」パネル）/
// akari-partner-catalog-widget.tsx（左カタログ）の現行実装を実際に確認して書いた
// （data-partner-entry / data-partner-form / data-partner-action / data-akari-flow-state /
// data-akari-catalog-count / data-partner-agent / data-extension-id は本タスクまたは
// 既存実装が持つ実 DOM 属性）。
import { setTimeout as sleep } from 'node:timers/promises';
import { evalMain, realClick } from './cdp-lib.mjs';

/**
 * Lumino の SplitPanel は BoxLayout が毎レイアウトパスで各パネルへ絶対座標の
 * inline style（width/left 等）を再適用するため、対象 DOM への直接の style 上書きは
 * 次のレイアウトパスで即座に巻き戻される（実測で確認済み — inline style 上書き直後の
 * getBoundingClientRect は上書き値を返すが、スクリーンショットは無変化のまま）。
 * 確実に効かせるには、ユーザー操作と同じ「実ドラッグ」で `.lm-SplitPanel-handle` を
 * 動かし、Lumino 自身の内部状態（relativeSizes）を更新させる必要がある。
 */
export async function dragSplitHandle(cdp, handleX, y, targetX) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handleX, y, button: 'none' });
  await sleep(50);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: handleX, y, button: 'left', clickCount: 1 });
  await sleep(50);
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    const x = handleX + (targetX - handleX) * (i / steps);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left' });
    await sleep(30);
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: targetX, y, button: 'left' });
  await sleep(300);
}

/** 左パネル（アクティビティバー+サイドパネル）と中央パネルを分ける最初の可視ハンドル。 */
export async function findLeftSplitHandle(cdp) {
  return evalMain(cdp, `(() => {
    const handles = Array.from(document.querySelectorAll('.lm-SplitPanel-handle'))
      .map(el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, h: r.height }; })
      .filter(h => h.h > 0);
    if (!handles.length) return null;
    const first = handles[0];
    return { x: first.x, y: first.y + first.h / 2 };
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
export async function errorCount(cdp) { return evalMain(cdp, 'window.__errCount'); }
export async function errorLog(cdp) { return evalMain(cdp, 'window.__errLog || []'); }

/**
 * 右「パートナーを追加」パネル（AkariPartnerWidget）は akari-partner-contribution.ts の
 * onStart() が起動直後に right area へ追加し activateWidget() まで行うため、追加の
 * reveal 操作なしで最初から可視。data-partner-entry を持つボタンの親要素（エージェント
 * 単位の行 div）でグルーピングして読み取る。
 */
export async function rightPanelRows(cdp) {
  return evalMain(cdp, `(() => {
    const AGENT_OF = {
      'anthropic/claude-code-cli': 'claude',
      'anthropic/claude-code-extension': 'claude',
      'openai/codex-cli': 'codex',
      'openai/codex-extension': 'codex',
      'sst/opencode-cli': 'opencode'
    };
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

async function clickPartnerEntry(cdp, entryId) {
  await evalMain(cdp, `(() => {
    const btn = document.querySelector('[data-partner-entry=${JSON.stringify(entryId)}]');
    if (!btn) return false;
    btn.scrollIntoView({ block: 'center' });
    return true;
  })()`);
  await sleep(300);
  const state = await evalMain(cdp, `(() => {
    const btn = document.querySelector('[data-partner-entry=${JSON.stringify(entryId)}]');
    if (!btn) return { found: false, reason: 'button not found' };
    const r = btn.getBoundingClientRect();
    const visible = r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth && r.width > 0 && r.height > 0;
    return { found: true, visible, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!state.found) throw new Error(`partner entry button not found: ${entryId}: ${state.reason}`);
  if (!state.visible) throw new Error(`partner entry button for ${entryId} is still outside the viewport after scrollIntoView: ${JSON.stringify(state)}`);
  await realClick(cdp, state.x, state.y);
  await sleep(400);
}
export async function clickOpencodeCli(cdp) { await clickPartnerEntry(cdp, 'sst/opencode-cli'); }
export async function clickClaudeCli(cdp) { await clickPartnerEntry(cdp, 'anthropic/claude-code-cli'); }

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
 * （partner-catalog-regroup の revealPartnerCatalog() と同じ手法）。
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

/**
 * 左カタログの実コンテナ要素（data-akari-catalog-count を持つ div）の現在の
 * 描画幅を読む。狭幅フォールバック（指示B: flexWrap + flex-basis）の検証は
 * dragSplitHandle() で実際にパネルをリサイズしたあと、この関数で結果を確認する。
 * （**実測で判明した地雷**: この div へ直接 inline style で幅を上書きしても、
 * Lumino の BoxLayout が次のレイアウトパスで即座に元の絶対座標へ巻き戻すため
 * 見た目には一切反映されない — getBoundingClientRect は上書き値を返すのに
 * スクリーンショットは無変化のままという食い違いで発覚した。ユーザーが実際に
 * ハンドルをドラッグするのと同じ経路でないと Lumino の内部状態は変わらない）。
 */
export async function readCatalogWidth(cdp) {
  return evalMain(cdp, `(() => {
    const el = document.querySelector('[data-akari-catalog-count]');
    if (!el) return { ok: false, reason: 'catalog container not found' };
    const r = el.getBoundingClientRect();
    return { ok: true, width: Math.round(r.width) };
  })()`);
}

/** カード（data-partner-agent）ごとのスロット（data-extension-id）の位置・寸法。 */
export async function catalogSlotLayout(cdp) {
  return evalMain(cdp, `Array.from(document.querySelectorAll('[data-partner-agent]')).map(section => {
    const r = section.getBoundingClientRect();
    return {
      agent: section.getAttribute('data-partner-agent'),
      cardWidth: Math.round(r.width),
      slots: Array.from(section.querySelectorAll('[data-extension-id]')).map(slot => {
        const sr = slot.getBoundingClientRect();
        const p = slot.querySelector('p');
        const pr = p ? p.getBoundingClientRect() : null;
        return {
          id: slot.getAttribute('data-extension-id'),
          width: Math.round(sr.width),
          height: Math.round(sr.height),
          top: Math.round(sr.top),
          left: Math.round(sr.left),
          descriptionWidth: pr ? Math.round(pr.width) : null
        };
      })
    };
  })`);
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
