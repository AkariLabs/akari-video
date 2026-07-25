// L1-2/L1-3(前半)/L1-4: 空状態フォルダピッカーの実測（不正フォルダ拒否 → 実カタログ選択 →
// preference 永続書き込み）+ 回帰（素材タブ/未整理/カタログ検索・動詞）。
//
// FileDialogService（ネイティブ OS ダイアログ）は CDP から直接操作できないため、
// window.theia.container（Theia 自身が起動時に `(window.theia=window.theia||{}).container=e`
// として公開する本番コード — akari-project が追加したデバッグフックではない）経由で
// inversify のバインディング辞書から FileDialogService / PreferenceService の Symbol キーを
// 実行時に特定し、そのシングルトンインスタンスの showOpenDialog だけを一時的に差し替える。
// akari-project 側のソースコードは一切変更しない（境界順守）。preferences.set 自体は
// widget 内の pickCatalogFolder() が呼ぶ本番コードをそのまま実行させる（widget.dialogs は
// このシングルトンをそのまま inject されているため、差し替えは widget の実際の呼び出しに反映される）。
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { connectMain, evalMain, realClick, screenshot } from './cdp-lib.mjs';

const [, , cdpPortArg, evidenceDirArg, invalidFolderArg, validFolderArg, bogusPreferenceArg] = process.argv;
const CDP_PORT = Number(cdpPortArg);
const EVIDENCE_DIR = evidenceDirArg;
const INVALID_FOLDER = invalidFolderArg;
const VALID_FOLDER = validFolderArg;
const BOGUS_PREFERENCE_PATH = bogusPreferenceArg;

const log = [];
function record(step, data) { const e = { t: new Date().toISOString(), step, ...data }; log.push(e); console.log(`[${step}]`, JSON.stringify(data)); }
function fail(message, data) { record('FAIL:' + message, data || {}); throw new Error(message); }

async function installErrorCounter(cdp) {
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
async function errorCount(cdp) { return evalMain(cdp, 'window.__errCount'); }
async function errorLog(cdp) { return evalMain(cdp, 'window.__errLog || []'); }

async function ensureRoleBucketsWidgetVisible(cdp) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const visible = await evalMain(cdp, `(() => {
      const el = Array.from(document.querySelectorAll('[role="tab"]')).find(e => e.textContent.trim() === 'カタログ');
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
    if (!icon) fail('files activity icon not found', {});
    await realClick(cdp, icon.x, icon.y);
    await sleep(600);
  }
  fail('role-buckets widget did not become visible after toggling the files activity icon', {});
}

async function clickRoleBucketsTab(cdp, label) {
  const state = await evalMain(cdp, `(() => {
    const tablist = Array.from(document.querySelectorAll('[role="tablist"]'))
      .find(list => Array.from(list.querySelectorAll('[role="tab"]')).some(t => t.textContent.trim() === 'カタログ'));
    if (!tablist) return { found: false, reason: 'tablist-not-found' };
    const el = Array.from(tablist.querySelectorAll('[role="tab"]')).find(t => t.textContent.trim() === ${JSON.stringify(label)});
    if (!el) return { found: false, reason: 'tab-not-found' };
    const r = el.getBoundingClientRect();
    return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!state.found) fail('role-buckets tab button not found', { label, state });
  await realClick(cdp, state.x, state.y);
  await sleep(500);
}
async function clickCatalogTab(cdp) { await clickRoleBucketsTab(cdp, 'カタログ'); }
async function clickMaterialsTab(cdp) { await clickRoleBucketsTab(cdp, '素材'); }

async function catalogCounts(cdp) {
  return evalMain(cdp, `(() => {
    const el = document.querySelector('[data-akari-catalog-item-count]');
    if (!el) return { found: false };
    return {
      found: true,
      itemCount: Number(el.getAttribute('data-akari-catalog-item-count')),
      missingCount: Number(el.getAttribute('data-akari-catalog-missing-count'))
    };
  })()`);
}

async function catalogEmptyState(cdp) {
  return evalMain(cdp, `(() => {
    const unresolved = document.body.textContent.includes('カタログの場所が未設定です');
    const pickerButton = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'フォルダを選ぶ');
    const errorEl = document.querySelector('[data-akari-catalog-pick-error]');
    return {
      unresolved,
      pickerButtonPresent: !!pickerButton,
      pickerButton: pickerButton ? (() => { const r = pickerButton.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })() : null,
      errorText: errorEl ? errorEl.textContent : null
    };
  })()`);
}

async function visibleCatalogCardKeys(cdp) {
  return evalMain(cdp, `Array.from(document.querySelectorAll('[data-akari-catalog-item]')).map(el => el.getAttribute('data-akari-catalog-item'))`);
}

async function setCatalogSearch(cdp, text) {
  const input = await evalMain(cdp, `(() => {
    const el = document.querySelector('input[aria-label="カタログを検索"]');
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!input.found) fail('catalog search input not found', input);
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

async function clickCategoryChip(cdp, label) {
  const state = await evalMain(cdp, `(() => {
    const el = Array.from(document.querySelectorAll('[role="tablist"][aria-label="カタログのカテゴリ"] [role="tab"]')).find(e => e.textContent.trim() === ${JSON.stringify(label)});
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!state.found) fail('category chip not found', { label });
  await realClick(cdp, state.x, state.y);
  await sleep(400);
}

async function waitFor(predicate, timeoutMs, pollFn) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    last = await pollFn();
    if (predicate(last)) return last;
    await sleep(300);
  }
  return last;
}

/**
 * window.theia.container（Theia 自身の起動コードが公開する本番のコンテナ参照）から
 * FileDialogService の inversify Symbol キーを特定し、そのシングルトンインスタンスの
 * showOpenDialog を一時的にスタブへ差し替える。ネイティブ OS フォルダ選択ダイアログは
 * CDP から直接操作できないため（create-project-asar 検証と同じ制約 — 本 README 参照）。
 * getRootNode()（protected だが実行時アクセス可。TS の protected はコンパイル時のみ）で
 * 既存の URI インスタンスを取得し、withPath() で対象パスの URI を組み立てる。
 */
async function stubFolderDialog(cdp, targetPathOrNull) {
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
  if (!result.ok) fail('failed to stub FileDialogService.showOpenDialog', result);
  return result;
}

/** widget.pickCatalogFolder() が呼ぶのと同じ本番 API（PreferenceService.set, scope=User）。 */
async function setPreferenceViaProductionApi(cdp, key, value) {
  const result = await evalMain(cdp, `(async () => {
    const bd = window.theia.container._bindingDictionary;
    const keys = [...bd._map.keys()];
    const prefKey = keys.find(k => typeof k === 'symbol' && String(k) === 'Symbol(PreferenceService)');
    if (!prefKey) return { ok: false, reason: 'PreferenceService key not found' };
    const pref = window.theia.container.get(prefKey);
    await pref.set(${JSON.stringify(key)}, ${JSON.stringify(value)}, 1);
    return { ok: true, readback: pref.get(${JSON.stringify(key)}) };
  })()`, 20000);
  if (!result.ok) fail('failed to set preference via production PreferenceService.set', result);
  return result;
}

async function clickPickerButton(cdp) {
  const state = await catalogEmptyState(cdp);
  if (!state.pickerButtonPresent || !state.pickerButton) fail('picker button not found', state);
  await realClick(cdp, state.pickerButton.x, state.pickerButton.y);
  await sleep(900);
}

async function main() {
  const cdp = await connectMain(CDP_PORT);
  record('connected-main', {});
  await sleep(1000);
  await installErrorCounter(cdp);
  await screenshot(cdp, path.join(EVIDENCE_DIR, '00-boot.png'));

  await ensureRoleBucketsWidgetVisible(cdp);
  await clickCatalogTab(cdp);

  // === 前提: auto-detect が実カタログを解決している（cwd=repo root で起動） ===
  const initialCounts = await waitFor(c => c.found && c.itemCount > 0, 8000, () => catalogCounts(cdp));
  record('precondition-auto-detect', initialCounts);
  if (!initialCounts?.found || !(initialCounts.itemCount > 0)) fail('precondition auto-detect did not resolve the catalog', initialCounts);

  // === akari.catalog.root を実 preferences.set(User) 経由で不正パスへ切替 → 空状態化 ===
  // widget.onPreferenceChanged 配線が自動で loadCatalog() を再実行することも同時に確認する。
  const setBogus = await setPreferenceViaProductionApi(cdp, 'akari.catalog.root', BOGUS_PREFERENCE_PATH);
  record('set-bogus-preference', setBogus);
  const emptyState = await waitFor(s => s.unresolved && s.pickerButtonPresent, 8000, () => catalogEmptyState(cdp));
  record('empty-state-after-bogus-preference', emptyState);
  if (!emptyState.unresolved || !emptyState.pickerButtonPresent) {
    fail('empty state (with picker button) did not render after setting an invalid akari.catalog.root', emptyState);
  }
  await screenshot(cdp, path.join(EVIDENCE_DIR, '01-empty-state.png'));
  record('empty-state-reactive-PASS', { ok: true });

  // === L1-2: 不正フォルダ選択 → 日本語の理由表示・一覧は変わらない ===
  const stubInvalid = await stubFolderDialog(cdp, INVALID_FOLDER);
  record('stub-invalid-folder', stubInvalid);
  await clickPickerButton(cdp);
  const afterInvalid = await waitFor(s => !!s.errorText, 6000, () => catalogEmptyState(cdp));
  record('after-invalid-folder-pick', afterInvalid);
  if (!afterInvalid.errorText || !/[぀-ヿ一-鿿]/.test(afterInvalid.errorText)) {
    fail('invalid folder selection did not produce a Japanese-language error message', afterInvalid);
  }
  if (!afterInvalid.unresolved) {
    fail('invalid folder selection unexpectedly resolved the catalog (list changed)', afterInvalid);
  }
  await screenshot(cdp, path.join(EVIDENCE_DIR, '02-invalid-folder-error.png'));
  record('L1-2-invalid-folder-PASS', { ok: true, errorText: afterInvalid.errorText });

  // 不正フォルダ選択で preference が書き換わっていないことも確認（bogus のまま）。
  const prefAfterInvalid = await evalMain(cdp, `(() => {
    const bd = window.theia.container._bindingDictionary;
    const keys = [...bd._map.keys()];
    const prefKey = keys.find(k => typeof k === 'symbol' && String(k) === 'Symbol(PreferenceService)');
    const pref = window.theia.container.get(prefKey);
    return pref.get('akari.catalog.root');
  })()`);
  record('preference-unchanged-after-invalid', { prefAfterInvalid, expected: BOGUS_PREFERENCE_PATH });
  if (prefAfterInvalid !== BOGUS_PREFERENCE_PATH) {
    fail('akari.catalog.root preference changed despite an invalid folder selection', { prefAfterInvalid, expected: BOGUS_PREFERENCE_PATH });
  }

  // === L1-1(picker 経路)/L1-4: 実カタログ選択 → preference 書き込み → 一覧が即再読込 ===
  const stubValid = await stubFolderDialog(cdp, VALID_FOLDER);
  record('stub-valid-folder', stubValid);
  await clickPickerButton(cdp);
  const afterValid = await waitFor(c => c.found && c.itemCount > 0, 8000, () => catalogCounts(cdp));
  record('after-valid-folder-pick', afterValid);
  if (!afterValid?.found || !(afterValid.itemCount > 0)) {
    fail('valid folder selection did not populate catalog cards', afterValid);
  }
  const emptyStateGone = await evalMain(cdp, `!document.body.textContent.includes('カタログの場所が未設定です')`);
  await screenshot(cdp, path.join(EVIDENCE_DIR, '03-valid-folder-cards.png'));
  record('L1-4-valid-folder-PASS', { ok: true, itemCount: afterValid.itemCount, missingCount: afterValid.missingCount, emptyStateGone });
  if (!emptyStateGone) fail('empty state text still present after a valid folder was picked', {});

  const prefAfterValid = await evalMain(cdp, `(() => {
    const bd = window.theia.container._bindingDictionary;
    const keys = [...bd._map.keys()];
    const prefKey = keys.find(k => typeof k === 'symbol' && String(k) === 'Symbol(PreferenceService)');
    const pref = window.theia.container.get(prefKey);
    return pref.get('akari.catalog.root');
  })()`);
  record('preference-after-valid-pick', { prefAfterValid, expected: VALID_FOLDER });
  if (prefAfterValid !== VALID_FOLDER) {
    fail('akari.catalog.root preference did not update to the picked folder', { prefAfterValid, expected: VALID_FOLDER });
  }

  // === L1-2: 検索 / カテゴリ絞り込みの回帰（実カタログに対して） ===
  await setCatalogSearch(cdp, 'ヴィンテージ');
  await sleep(400);
  const searchKeys = await visibleCatalogCardKeys(cdp);
  record('regression-search', { query: 'ヴィンテージ', searchKeys });
  if (!searchKeys.includes('3d/vintage-camera')) fail('catalog search verb regressed', { searchKeys });
  await screenshot(cdp, path.join(EVIDENCE_DIR, '04-search-regression.png'));
  await setCatalogSearch(cdp, '');
  await sleep(300);

  await clickCategoryChip(cdp, '3d');
  await sleep(400);
  const categoryKeys = await visibleCatalogCardKeys(cdp);
  record('regression-category', { category: '3d', count: categoryKeys.length });
  if (!categoryKeys.length || !categoryKeys.every(key => key.startsWith('3d/'))) fail('catalog category chip verb regressed', { categoryKeys });
  await clickCategoryChip(cdp, 'All');
  await sleep(400);
  record('L1-6-catalog-verbs-regression-PASS', { ok: true });

  // === L1-6 回帰: 素材タブ（ドロップゾーン/カード/未整理セクション） ===
  await clickMaterialsTab(cdp);
  await sleep(600);
  const materialsRegression = await evalMain(cdp, `(() => {
    const dz = document.querySelector('[data-akari-dropzone]');
    const dzOk = !!dz && dz.getBoundingClientRect().width > 0;
    const bodyText = document.body.textContent;
    const unorganizedCountEl = document.querySelector('[data-akari-unorganized-count]');
    return {
      dzOk,
      hasRegressionClip: bodyText.includes('regression-clip.mp4'),
      hasUnorganizedSection: bodyText.includes('未整理'),
      hasUnorganizedShot: bodyText.includes('unorganized-shot.png'),
      unorganizedCount: unorganizedCountEl ? Number(unorganizedCountEl.getAttribute('data-akari-unorganized-count')) : null
    };
  })()`);
  record('regression-materials-tab', materialsRegression);
  if (!materialsRegression.dzOk || !materialsRegression.hasRegressionClip) {
    fail('materials tab regressed (dropzone or fixture card missing)', materialsRegression);
  }
  if (!materialsRegression.hasUnorganizedSection || !materialsRegression.hasUnorganizedShot || materialsRegression.unorganizedCount !== 1) {
    fail('unorganized section regressed', materialsRegression);
  }
  await screenshot(cdp, path.join(EVIDENCE_DIR, '05-materials-and-unorganized-regression.png'));
  record('L1-6-materials-regression-PASS', { ok: true });

  const finalErrCount = await errorCount(cdp);
  const finalErrLog = await errorLog(cdp);
  record('ALL-PASS', { ok: true, finalConsoleErrorCount: finalErrCount, finalErrLog });

  await writeFile(path.join(EVIDENCE_DIR, 'scenario2-log.json'), JSON.stringify(log, null, 2));
  console.log('SUCCESS: scenario2 (picker + persistence write + regression) passed.');
  cdp.close();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('FAILED', err);
  await writeFile(path.join(EVIDENCE_DIR, 'scenario2-log-FAILED.json'), JSON.stringify(log, null, 2)).catch(() => {});
  process.exit(1);
});
