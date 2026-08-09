// catalog-account-first-ux 検証専用の共有ヘルパー。cdp-lib.mjs（catalog-root-fix と
// 同一・中身無改変）の上に、本タスクの DOM フックだけを積む。
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
 * widget 内遷移は role="tab" ではなく `data-akari-open-catalog` /
 * `data-akari-back-to-materials` の実ボタン（U6 裁定以降の現行実装 — akari-role-buckets-widget
 * を直接確認して裏取り済み。旧 catalog-root-fix 期の role="tab" 前提のヘルパーはこの widget には
 * もう当てはまらない）。
 */
export async function ensureRoleBucketsWidgetVisible(cdp) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const visible = await evalMain(cdp, `(() => {
      const el = document.querySelector('[data-akari-open-catalog], [data-akari-back-to-materials]');
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    })()`);
    if (visible) return;
    const icon = await evalMain(cdp, `(() => {
      const el = Array.from(document.querySelectorAll('.codicon-files')).find(e => e.getBoundingClientRect().width > 0);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    // Startup race: right after the frontend attaches, the activity bar icon may not have
    // painted yet (width 0 / not queryable). Keep polling instead of failing immediately.
    if (!icon) { await sleep(600); continue; }
    await realClick(cdp, icon.x, icon.y);
    await sleep(600);
  }
  throw new Error('role-buckets widget did not become visible after toggling the files activity icon');
}

async function clickBySelector(cdp, selector, label) {
  const state = await evalMain(cdp, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!state.found) throw new Error(`${label} not found (selector ${selector})`);
  await realClick(cdp, state.x, state.y);
  await sleep(500);
}
export async function clickCatalogTab(cdp) { await clickBySelector(cdp, '[data-akari-open-catalog]', 'catalog nav button'); }
export async function clickMaterialsTab(cdp) { await clickBySelector(cdp, '[data-akari-back-to-materials]', 'back-to-materials button'); }

export async function bodyInnerText(cdp) {
  return evalMain(cdp, 'document.body.innerText');
}

export async function catalogItemCount(cdp) {
  return evalMain(cdp, `(() => {
    const el = document.querySelector('[data-akari-catalog-item-count]');
    return el ? Number(el.getAttribute('data-akari-catalog-item-count')) : null;
  })()`);
}

export async function emptyStateInfo(cdp) {
  return evalMain(cdp, `(() => {
    const el = document.querySelector('[data-akari-catalog-empty-kind]');
    const retry = document.querySelector('[data-akari-catalog-retry]');
    const errorEl = document.querySelector('[data-akari-catalog-pick-error]');
    return {
      present: !!el,
      kind: el ? el.getAttribute('data-akari-catalog-empty-kind') : null,
      messageText: el ? el.querySelector('p')?.textContent ?? null : null,
      retryPresent: !!retry,
      pickErrorText: errorEl ? errorEl.textContent : null
    };
  })()`);
}

export async function accountHeaderInfo(cdp) {
  return evalMain(cdp, `(() => {
    const el = document.querySelector('[data-akari-catalog-account-header]');
    if (!el) return { present: false };
    const count = document.querySelector('[data-akari-catalog-resolver-count]');
    const retryInline = document.querySelector('[data-akari-catalog-retry-inline]');
    return {
      present: true,
      text: el.textContent,
      resolverCountText: count ? count.textContent : null,
      retryInlinePresent: !!retryInline
    };
  })()`);
}

async function clickButtonWithSelector(cdp, selector) {
  const state = await evalMain(cdp, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!state.found) throw new Error(`element not found for click: ${selector}`);
  await realClick(cdp, state.x, state.y);
  await sleep(400);
}

export async function clickEmptyStateRetry(cdp) { await clickButtonWithSelector(cdp, '[data-akari-catalog-retry]'); }
export async function clickInlineRetry(cdp) { await clickButtonWithSelector(cdp, '[data-akari-catalog-retry-inline]'); }
export async function clickDeveloperLinkToggle(cdp) { await clickButtonWithSelector(cdp, '[data-akari-developer-catalog-toggle]'); }

export async function developerSectionState(cdp) {
  return evalMain(cdp, `(() => {
    const details = document.querySelector('[data-akari-developer-catalog-section]');
    const valueEl = document.querySelector('[data-akari-catalog-root-value]');
    const pickButton = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'フォルダを選ぶ');
    const errorEl = document.querySelector('[data-akari-catalog-pick-error]');
    return {
      detailsPresent: !!details,
      detailsOpen: details ? details.open : null,
      valueText: valueEl ? valueEl.textContent : null,
      pickButtonPresent: !!pickButton,
      pickButton: pickButton ? (() => { const r = pickButton.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })() : null,
      pickErrorText: errorEl ? errorEl.textContent : null
    };
  })()`);
}

/**
 * `<summary>` の native toggle は CDP の合成マウス座標クリック（Input.dispatchMouseEvent）
 * だと発火しないことを実測で確認した（React の onClick は realClick で問題なく発火するが、
 * details/summary のブラウザ組み込みトグルだけは反応しない — 24x24px の音源試聴ボタンで
 * 遭遇した現象と同種）。native click() を使う（isTrusted は立たないが、details のトグル自体は
 * ブラウザ組み込み挙動であり isTrusted を要求しない。実クリックでの製品挙動と差はない）。
 */
export async function clickSummaryToOpenDetails(cdp) {
  const found = await evalMain(cdp, `!!document.querySelector('[data-akari-developer-catalog-section] summary')`);
  if (!found) throw new Error('developer details summary not found');
  await evalMain(cdp, `document.querySelector('[data-akari-developer-catalog-section] summary').click()`);
  await sleep(400);
}

/**
 * 「フォルダを選ぶ」ボタンも realClick（CDP 合成マウス座標）で空振りする実測を確認したため
 * （summary トグル・音源試聴ボタンと同種の現象）、native click() で発火させる。
 */
export async function clickPickFolderButton(cdp) {
  const state = await developerSectionState(cdp);
  if (!state.pickButtonPresent) throw new Error(`pick folder button not found: ${JSON.stringify(state)}`);
  await evalMain(cdp, `Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'フォルダを選ぶ')?.click()`);
  await sleep(700);
}

export async function visibleCatalogItemKeys(cdp) {
  return evalMain(cdp, `Array.from(document.querySelectorAll('[data-akari-catalog-item]')).map(el => el.getAttribute('data-akari-catalog-item'))`);
}

export async function catalogItemStates(cdp) {
  return evalMain(cdp, `Array.from(document.querySelectorAll('[data-akari-catalog-item]')).map(el => ({
    key: el.getAttribute('data-akari-catalog-item'),
    state: el.getAttribute('data-akari-catalog-item-state')
  }))`);
}

export async function setCatalogSearch(cdp, text) {
  const input = await evalMain(cdp, `(() => {
    const el = document.querySelector('input[aria-label="カタログを検索"]');
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!input.found) throw new Error('catalog search input not found');
  await realClick(cdp, input.x, input.y);
  await sleep(150);
  await evalMain(cdp, `document.querySelector('input[aria-label="カタログを検索"]').select()`);
  if (text) {
    await cdp.send('Input.insertText', { text });
  } else {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 8, key: 'Backspace' });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 8, key: 'Backspace' });
  }
  await sleep(400);
}

export async function clickCategoryChip(cdp, label) {
  const state = await evalMain(cdp, `(() => {
    const el = Array.from(document.querySelectorAll('[role="tablist"][aria-label="カタログのカテゴリ"] [role="tab"]')).find(e => e.textContent.trim() === ${JSON.stringify(label)});
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!state.found) throw new Error(`category chip not found: ${label}`);
  await realClick(cdp, state.x, state.y);
  await sleep(400);
}

export async function storeConnectionPhaseAttr(cdp) {
  return evalMain(cdp, `(() => {
    const el = document.querySelector('[data-akari-store-connection]');
    return el ? el.getAttribute('data-akari-store-connection') : null;
  })()`);
}

export async function clickButtonByText(cdp, text) {
  const state = await evalMain(cdp, `(() => {
    const el = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === ${JSON.stringify(text)});
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!state.found) throw new Error(`button not found: ${text}`);
  await realClick(cdp, state.x, state.y);
  await sleep(400);
}

/**
 * ネイティブ OS フォルダ選択ダイアログのスタブ化（catalog-root-fix scenario2-picker.mjs と
 * 同一手法 — window.theia.container の inversify バインディング辞書から FileDialogService
 * のシングルトンを実行時に取得し、showOpenDialog だけを一時差し替える）。
 * akari-project 側のソースコードは一切変更しない。
 */
export async function stubFolderDialog(cdp, targetPathOrNull) {
  const result = await evalMain(cdp, `(async () => {
    const bd = window.theia.container._bindingDictionary;
    const keys = [...bd._map.keys()];
    const fdsKey = keys.find(k => typeof k === 'symbol' && String(k) === 'Symbol(FileDialogService)');
    if (!fdsKey) return { ok: false, reason: 'FileDialogService key not found' };
    const fds = window.theia.container.get(fdsKey);
    const targetPath = ${JSON.stringify(targetPathOrNull)};
    if (targetPath === null) {
      fds.showOpenDialog = async () => undefined;
      return { ok: true, mode: 'cancel' };
    }
    const rootNode = await fds.getRootNode();
    const targetUri = rootNode.uri.withPath(targetPath);
    fds.showOpenDialog = async () => targetUri;
    return { ok: true, mode: 'fixed', targetUri: targetUri.toString() };
  })()`, 20000);
  if (!result.ok) throw new Error(`failed to stub FileDialogService.showOpenDialog: ${JSON.stringify(result)}`);
  return result;
}

export async function readPreferenceViaProductionApi(cdp, key) {
  return evalMain(cdp, `(() => {
    const bd = window.theia.container._bindingDictionary;
    const keys = [...bd._map.keys()];
    const prefKey = keys.find(k => typeof k === 'symbol' && String(k) === 'Symbol(PreferenceService)');
    if (!prefKey) return { ok: false, reason: 'PreferenceService key not found' };
    const pref = window.theia.container.get(prefKey);
    return { ok: true, value: pref.get(${JSON.stringify(key)}) };
  })()`);
}

/**
 * `akari.catalog.root` を本番 PreferenceService.set(..., User scope) 経由で書く
 * （catalog-root-fix/scenario2-picker.mjs と同じ手法）。存在しないパスを書けば
 * resolveCatalogRoot() は「preferenceRoot 設定時はそれだけを検証し、フォールバックしない」
 * 契約により確実に undefined を返す — 開発配置の __dirname 上方探索がこのリポ自身の
 * catalog/ を拾ってしまう問題を cwd 操作に頼らず確実に回避できる。
 */
export async function setPreferenceViaProductionApi(cdp, key, value) {
  const result = await evalMain(cdp, `(async () => {
    const bd = window.theia.container._bindingDictionary;
    const keys = [...bd._map.keys()];
    const prefKey = keys.find(k => typeof k === 'symbol' && String(k) === 'Symbol(PreferenceService)');
    if (!prefKey) return { ok: false, reason: 'PreferenceService key not found' };
    const pref = window.theia.container.get(prefKey);
    await pref.set(${JSON.stringify(key)}, ${JSON.stringify(value)}, 1);
    return { ok: true, readback: pref.get(${JSON.stringify(key)}) };
  })()`, 20000);
  if (!result.ok) throw new Error(`failed to set preference via production PreferenceService.set: ${JSON.stringify(result)}`);
  return result;
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
