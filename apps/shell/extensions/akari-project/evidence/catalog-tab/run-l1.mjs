// catalog-tab L1 実機検証ドライバ（フック在り・1 回のみ）。cdp-lib.mjs は
// card-ask-agent (f740707) / export-button (c309560) と同じ共有ヘルパー
// （様式踏襲・中身無改変）。
//
// akari.catalog.root は Theia preference（実運用では Settings UI/JSON から
// 変更する値）なので、本来はアプリ内の実 UI 操作だけで到達できる。だが
// パートナー端末バッファへの到達確認（取り込む/頼むの実測）だけは、実
// claude/codex CLI のネットワーク越しブートストラップを避けるため、
// AkariRoleBucketsWidget（本タスクが所有する akari-project 側のファイル）の
// postConstruct に一時デバッグフック `globalThis.__akariRoleBucketsWidgetDebug = this`
// を追加し、そこから widget 自身に注入済みの WidgetManager 経由で
// `widgetManager.getOrCreateWidget('akari-partner-onboarding')`
// （card-ask-agent/export-button と同じ「文字列 id だけ知っている」パターン）で
// 実行中の AkariPartnerWidget シングルトンを取得し、terminalService.newTerminal() +
// attachTerminal()（begin() の成功パスが呼ぶのと同じ本番コードそのもの）で
// ダミーの echo CLI を接続した。akari.catalog.root の設定自体も同じ
// デバッグフック経由で行うが、実測の結果 preferences.set(..., User scope) は
// --user-data-dir で隔離されない `~/.theia/settings.json`（全セッション共有の
// 実ファイル）へ書き込むことが判明したため、設定 UI に汎用プロパティエディタが
// ないことも踏まえ widget.preferences.get だけを対象キーに限定してモンキー
// パッチする方式に変更した（ファイル I/O 皆無・詳細は下の該当コメント）。
// akari-partner 側のファイルは一切編集していない（境界順守）。フックは証跡取得後に完全に削除してから
// 最終コミットし、フック不在の最終ビルドに対して final-smoke.mjs で
// フック不要な項目（カード表示/検索/カテゴリ絞り込み/回帰/未接続トースト）を
// もう一度実測した（card-ask-agent/export-button と同じ手順）。
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { connectMain, evalMain, realClick, screenshot } from './cdp-lib.mjs';

const [, , cdpPortArg, evidenceDirArg, fixtureCatalogArg] = process.argv;
const CDP_PORT = Number(cdpPortArg);
const EVIDENCE_DIR = evidenceDirArg;
const FIXTURE_CATALOG_PATH = fixtureCatalogArg;

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
async function errorLog(cdp) { return evalMain(cdp, 'window.__errLog || []'); }
async function errorCount(cdp) { return evalMain(cdp, 'window.__errCount'); }

/**
 * 左サイドパネル（役割別カード棚）は起動直後は折り畳まれていることがあり、
 * activity bar の files アイコンはクリックのたびに開閉をトグルする
 * （export-button 等の precedent はテスト対象タブが既定で開いた状態から
 * 始まっていたため気づかなかった差異）。折り畳み状態を毎回判定し、
 * 開くまでだけクリックする（既に開いていれば誤って閉じない）。
 */
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

// [role="tab"] は左サイドの activity bar タブ（'素材' というタイトルを持つ
// 非表示要素含む）でも使われており、同名テキストが複数箇所に存在しうる。
// 誤って幅0の別要素を掴まないよう、ウィジェット自身のタブバー（role="tablist"
// でカテゴリのタブと同居している = 'カタログ' を含む方）に限定する。
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
async function clickPlanTab(cdp) { await clickRoleBucketsTab(cdp, 'プラン'); }

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

async function waitForCatalogCounts(cdp, predicate, timeoutMs) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    last = await catalogCounts(cdp);
    if (last.found && predicate(last)) return last;
    await sleep(300);
  }
  return last;
}

async function visibleCatalogCardKeys(cdp) {
  return evalMain(cdp, `Array.from(document.querySelectorAll('[data-akari-catalog-item]')).map(el => el.getAttribute('data-akari-catalog-item'))`);
}

async function toastMessages(cdp) {
  return evalMain(cdp, `Array.from(document.querySelectorAll('.theia-notification-message')).map(n => n.textContent.trim())`);
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
  // 既存入力（あれば）を選択して置換する。
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

async function findCatalogCardButton(cdp, itemKey, buttonLabel) {
  return evalMain(cdp, `(() => {
    const card = document.querySelector('[data-akari-catalog-item=${JSON.stringify(itemKey)}]');
    if (!card) return { found: false, reason: 'card-not-found' };
    const btn = Array.from(card.querySelectorAll('button')).find(b => b.textContent.trim() === ${JSON.stringify(buttonLabel)});
    if (!btn) return { found: false, reason: 'button-not-found' };
    const r = btn.getBoundingClientRect();
    return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
}

async function clickCatalogCardButton(cdp, itemKey, buttonLabel) {
  // カードグリッドはスクロール領域なので、開発配置の実カタログ（24件）のように
  // 対象カードが折り返し範囲外にあると座標がビューポート外になり、クリックが
  // 空振りする。座標取得の前に確実にスクロールして可視化する。
  await evalMain(cdp, `(() => {
    const card = document.querySelector('[data-akari-catalog-item=${JSON.stringify(itemKey)}]');
    if (card) card.scrollIntoView({ block: 'center' });
  })()`);
  await sleep(300);
  const btn = await findCatalogCardButton(cdp, itemKey, buttonLabel);
  if (!btn.found) fail('catalog card button not clickable', { itemKey, buttonLabel, btn });
  await realClick(cdp, btn.x, btn.y);
  await sleep(500);
}

async function waitForQuickInputPlaceholder(cdp, placeholder) {
  for (let attempt = 0; attempt < 25; attempt++) {
    const state = await evalMain(cdp, `(() => {
      const widget = document.querySelector('.quick-input-widget');
      const input = widget ? widget.querySelector('input') : null;
      const visible = !!widget && getComputedStyle(widget).display !== 'none';
      return { visible, placeholder: input ? input.placeholder : null };
    })()`);
    if (state.visible && state.placeholder === placeholder) return;
    await sleep(200);
  }
  fail('quick input did not reach expected placeholder', { placeholder });
}

async function focusQuickInput(cdp) {
  const rect = await evalMain(cdp, `(() => {
    const input = document.querySelector('.quick-input-widget input');
    if (!input) return null;
    const r = input.getBoundingClientRect();
    if (r.width === 0) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (rect) { await realClick(cdp, rect.x, rect.y); await sleep(150); }
}

async function typeQuickInput(cdp, text) {
  await focusQuickInput(cdp);
  await cdp.send('Input.insertText', { text });
  await sleep(200);
}

async function pressEnter(cdp) {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 13, key: 'Enter' });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, key: 'Enter' });
  await sleep(500);
}

async function pressEscape(cdp) {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 27, key: 'Escape' });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 27, key: 'Escape' });
  await sleep(400);
}

async function readPartnerTerminalBuffer(cdp) {
  return evalMain(cdp, `(async () => {
    const roleDebug = window.__akariRoleBucketsWidgetDebug;
    const widget = await roleDebug.widgets.getOrCreateWidget('akari-partner-onboarding');
    const buf = widget.terminal.term.buffer.active;
    let out = '';
    for (let i = 0; i < buf.length; i++) {
      const line = buf.getLine(i);
      if (!line) continue;
      const text = line.translateToString(true);
      out += line.isWrapped ? text : ('\\n' + text);
    }
    return out;
  })()`);
}

async function main() {
  const cdp = await connectMain(CDP_PORT);
  record('connected-main', {});
  await sleep(1500);
  await installErrorCounter(cdp);
  await screenshot(cdp, path.join(EVIDENCE_DIR, '00-boot.png'));

  await ensureRoleBucketsWidgetVisible(cdp);
  await clickCatalogTab(cdp);

  // === ボーナス実測: preference 未設定時の開発配置フォールバック（実 catalog/） ===
  const devLayoutCounts = await waitForCatalogCounts(cdp, c => c.itemCount > 0, 8000);
  record('dev-layout-autodetect', devLayoutCounts);
  if (!devLayoutCounts?.found || devLayoutCounts.itemCount <= 0) {
    fail('dev-layout catalog root auto-detect did not resolve any items (akari.catalog.root unset)', devLayoutCounts);
  }
  await screenshot(cdp, path.join(EVIDENCE_DIR, '01-dev-layout-autodetect.png'));
  record('dev-layout-autodetect-PASS', { ok: true, ...devLayoutCounts });

  // === L1-3 (前段): パートナー未接続で「取り込む」→ 未接続トースト、注入なし ===
  // 開発配置カタログ（実 catalog/）にも 3d/vintage-camera は実在するのでそのまま使う。
  const toastsBeforeNotConnected = (await toastMessages(cdp)).length;
  await clickCatalogCardButton(cdp, '3d/vintage-camera', '取り込む');
  await sleep(600);
  const toastsAfterNotConnected = await toastMessages(cdp);
  record('l1-3-not-connected-toast', { toastsBeforeNotConnected, toastsAfterNotConnected });
  const expectedToast = 'パートナー未接続。ホームの「パートナーに接続する」から接続してください';
  if (toastsAfterNotConnected.length <= toastsBeforeNotConnected || !toastsAfterNotConnected.includes(expectedToast)) {
    fail('expected not-connected toast missing for catalog import button', { toastsAfterNotConnected, expectedToast });
  }
  await screenshot(cdp, path.join(EVIDENCE_DIR, '02-not-connected-toast.png'));
  record('L1-3-PASS', { ok: true });

  // === cancel: 「頼む」の quick-input を Escape → 何も起きない ===
  const toastsBeforeCancel = (await toastMessages(cdp)).length;
  await clickCatalogCardButton(cdp, '3d/vintage-camera', '頼む');
  await waitForQuickInputPlaceholder(cdp, 'この素材で何をしますか');
  await pressEscape(cdp);
  const qiClosed = await evalMain(cdp, `(() => { const w = document.querySelector('.quick-input-widget'); return !w || getComputedStyle(w).display === 'none'; })()`);
  const toastsAfterCancel = await toastMessages(cdp);
  record('cancel-no-op', { toastsBeforeCancel, toastsAfterCancelCount: toastsAfterCancel.length, qiClosed });
  if (toastsAfterCancel.length !== toastsBeforeCancel) fail('cancel produced an unexpected toast', { toastsBeforeCancel, toastsAfterCancel });
  if (!qiClosed) fail('quick-input did not close after Escape', { qiClosed });
  record('cancel-PASS', { ok: true });

  // === akari.catalog.root をフィクスチャへ切替 ===
  // preferences.set(..., PreferenceScope.User) は Theia の User スコープ設定ファイル
  // （--user-data-dir では隔離されず、この開発機では ~/.theia/settings.json という
  // 全セッション共有の実ファイルに書かれることを実測で確認した）を書き換えてしまい、
  // 隔離の想定を破って開発者の実環境を汚染するおそれがあった（検証中に実際に
  // 汚染 → 直後に該当キーを削除して復旧済み）。そのため設定の書き込みは行わず、
  // widget.preferences.get だけを対象キーに限定してモンキーパッチする（ファイル
  // I/O 皆無）。loadCatalog() 自体は preferences.get の戻り値を読むだけの本番
  // コードそのものを直接呼ぶため、実装の検証としては同等——ただし
  // onPreferenceChanged の自動再読込配線は本パッチ経路では発火しないため、
  // ここでは loadCatalog() を明示的に呼ぶ（配線自体はソースレビューで確認済み）。
  const errCountBeforeFixtureSwitch = await errorCount(cdp);
  const setPref = await evalMain(cdp, `(async () => {
    const roleDebug = window.__akariRoleBucketsWidgetDebug;
    if (!roleDebug) return { ok: false, reason: 'no-debug-hook' };
    const original = roleDebug.preferences.get.bind(roleDebug.preferences);
    roleDebug.preferences.get = (key, def) => key === 'akari.catalog.root' ? ${JSON.stringify(FIXTURE_CATALOG_PATH)} : original(key, def);
    await roleDebug.loadCatalog();
    return { ok: true };
  })()`, 20000);
  record('set-catalog-root-preference', setPref);
  if (!setPref.ok) fail('failed to patch akari.catalog.root via debug hook', setPref);

  const fixtureCounts = await waitForCatalogCounts(cdp, c => c.itemCount === 4 && c.missingCount === 2, 8000);
  record('fixture-catalog-loaded', fixtureCounts);
  if (!fixtureCounts?.found || fixtureCounts.itemCount !== 4 || fixtureCounts.missingCount !== 2) {
    fail('fixture catalog did not resolve to the expected 4 items / 2 missing', fixtureCounts);
  }
  await sleep(1500); // 壊れた preview_url の img onerror が発火するのを待つ
  const errCountAfterFixtureThumbnails = await errorCount(cdp);
  const thumbnailErrorDelta = errCountAfterFixtureThumbnails - errCountBeforeFixtureSwitch;
  record('fixture-thumbnail-error-delta', { errCountBeforeFixtureSwitch, errCountAfterFixtureThumbnails, thumbnailErrorDelta });
  await screenshot(cdp, path.join(EVIDENCE_DIR, '03-fixture-catalog-cards.png'));
  if (thumbnailErrorDelta !== 0) {
    fail('broken preview_url thumbnails caused console errors (expected silent placeholder fallback)', {
      thumbnailErrorDelta, errLog: await errorLog(cdp)
    });
  }
  record('L1-1-and-L1-5-PASS', { ok: true, itemCount: fixtureCounts.itemCount, missingCount: fixtureCounts.missingCount, thumbnailErrorDelta });

  // カード内容（title/category/tags/license バッジ）の実測
  const vintageCardText = await evalMain(cdp, `(() => {
    const card = document.querySelector('[data-akari-catalog-item="3d/vintage-camera"]');
    return card ? card.textContent : null;
  })()`);
  record('vintage-card-content', { vintageCardText });
  if (!vintageCardText || !vintageCardText.includes('ヴィンテージカメラ 3D モデル') || !vintageCardText.includes('3d') || !vintageCardText.includes('CC0-1.0')) {
    fail('vintage-camera card did not render expected title/category/license badge', { vintageCardText });
  }

  // === L1-2: 検索 1 語で絞れる ===
  await setCatalogSearch(cdp, 'スマートフォン');
  await sleep(400);
  const searchKeys = await visibleCatalogCardKeys(cdp);
  record('l1-2-search', { query: 'スマートフォン', searchKeys });
  if (searchKeys.length !== 1 || searchKeys[0] !== '3d/modern-smartphone') {
    fail('search by title did not narrow to the expected single card', { searchKeys });
  }
  await screenshot(cdp, path.join(EVIDENCE_DIR, '04-search-filtered.png'));
  record('L1-2-search-PASS', { ok: true, count: searchKeys.length });

  await setCatalogSearch(cdp, '');
  await sleep(300);

  // === L1-2: カテゴリチップで絞れる ===
  await clickCategoryChip(cdp, '3d');
  await sleep(400);
  const categoryKeys = await visibleCatalogCardKeys(cdp);
  record('l1-2-category', { category: '3d', categoryKeys });
  if (categoryKeys.length !== 2 || !categoryKeys.every(key => key.startsWith('3d/'))) {
    fail('category chip did not narrow to the expected 2 cards', { categoryKeys });
  }
  await screenshot(cdp, path.join(EVIDENCE_DIR, '05-category-filtered.png'));
  record('L1-2-category-PASS', { ok: true, count: categoryKeys.length });

  await clickCategoryChip(cdp, 'All');
  await sleep(400);
  const allKeys = await visibleCatalogCardKeys(cdp);
  record('back-to-all', { allKeys });
  if (allKeys.length !== 4) fail('All chip did not restore all 4 fixture cards', { allKeys });

  // === ダミー partner 端末を接続（一時デバッグフック経由。card-ask-agent/export-button と同じ代替） ===
  const attach = await evalMain(cdp, `(async () => {
    const roleDebug = window.__akariRoleBucketsWidgetDebug;
    if (!roleDebug) return { ok: false, reason: 'no-debug-hook' };
    const widget = await roleDebug.widgets.getOrCreateWidget('akari-partner-onboarding');
    if (!widget) return { ok: false, reason: 'partner-widget-not-found' };
    const roots = await widget.workspaceService.roots;
    const cwd = roots[0]?.resource.toString();
    const terminal = await widget.terminalService.newTerminal({
      title: 'dummy-partner-cli', shellPath: '/bin/bash',
      shellArgs: ['-c', 'while IFS= read -r line; do printf "ECHO: %s\\n" "$line"; done'],
      cwd, kind: 'akari-partner', attributes: { 'akari.partner': 'dummy' }, destroyTermOnClose: false, useServerTitle: false
    });
    await terminal.start();
    await widget.shell.addWidget(terminal, { area: 'right', rank: 50 });
    await widget.attachTerminal(terminal, 'Dummy CLI');
    return { ok: true };
  })()`, 20000);
  record('dummy-partner-terminal-attached', attach);
  if (!attach.ok) fail('failed to attach dummy partner terminal via debug hook', attach);
  await sleep(800);
  await screenshot(cdp, path.join(EVIDENCE_DIR, '06-partner-connected.png'));

  // === L1-3: 「取り込む」→ 端末バッファに固定パケット全文 ===
  await clickCatalogCardButton(cdp, '3d/vintage-camera', '取り込む');
  await sleep(900);
  const importBuffer = await readPartnerTerminalBuffer(cdp);
  await screenshot(cdp, path.join(EVIDENCE_DIR, '07-import-injection.png'));
  const expectedImportPacket = '【カタログ素材】vintage-camera（category 3d・title ヴィンテージカメラ 3D モデル・source: https://polyhaven.com/a/Camera_01・license: CC0-1.0）について: この素材をカタログの参照情報から取得し、ライセンス表記を確認の上プロジェクトへ配置してください（setup-library 系スキルの手順に従う）';
  record('l1-3-import-injection', { containsExpected: importBuffer.includes(expectedImportPacket) });
  if (!importBuffer.includes(expectedImportPacket)) fail('import packet did not appear verbatim in the terminal buffer', { importBuffer, expectedImportPacket });
  record('L1-3-import-PASS', { ok: true });

  // === L1-4: 「頼む」→ quick-input 実入力 → 端末バッファに用途1文+入力文 ===
  await clickCatalogCardButton(cdp, '3d/modern-smartphone', '頼む');
  await waitForQuickInputPlaceholder(cdp, 'この素材で何をしますか');
  await typeQuickInput(cdp, '配置してから使いたい');
  await pressEnter(cdp);
  await sleep(900);
  const askBuffer = await readPartnerTerminalBuffer(cdp);
  await screenshot(cdp, path.join(EVIDENCE_DIR, '08-ask-agent-injection.png'));
  const expectedAskPacket = '【カタログ素材】modern-smartphone（category 3d・title 現代的なスマートフォン 3D モデル（縁なしスクリーン）・source: https://opengameart.org/content/smartphone-2・license: CC0-1.0・用途: アプリ紹介・UI 解説・プロダクトデモで、実機に画面を映し込んだモックアップ映像を作るとき）について: 配置してから使いたい';
  record('l1-4-ask-agent-injection', { containsExpected: askBuffer.includes(expectedAskPacket) });
  if (!askBuffer.includes(expectedAskPacket)) fail('ask-agent packet did not appear verbatim in the terminal buffer', { askBuffer, expectedAskPacket });
  record('L1-4-PASS', { ok: true });

  // === L1-6 回帰: 素材タブ（ドロップゾーン/カード/lint バッジ）・プランタブ ===
  await clickMaterialsTab(cdp);
  await sleep(500);
  const materialsRegression = await evalMain(cdp, `(() => {
    const dz = document.querySelector('[data-akari-dropzone]');
    const dzOk = !!dz && dz.getBoundingClientRect().width > 0;
    const cardText = document.body.textContent;
    return { dzOk, hasRegressionClip: cardText.includes('regression-clip.mp4'), hasUnanalyzedBadge: cardText.includes('--:--') };
  })()`);
  record('l1-6-materials-regression', materialsRegression);
  if (!materialsRegression.dzOk || !materialsRegression.hasRegressionClip) {
    fail('materials tab regressed (dropzone or fixture card missing)', materialsRegression);
  }
  await screenshot(cdp, path.join(EVIDENCE_DIR, '09-materials-regression.png'));

  await clickPlanTab(cdp);
  await sleep(400);
  const planRegression = await evalMain(cdp, `document.body.textContent.includes('プランはここに入ります')`);
  record('l1-6-plan-regression', { planRegression });
  if (!planRegression) fail('plan tab empty-state text regressed', { planRegression });
  await screenshot(cdp, path.join(EVIDENCE_DIR, '10-plan-tab-regression.png'));

  // === L1-6 回帰: akari-shell-strip の書き出しボタン（他 extension・読み取りのみ） ===
  const menuIcon = await evalMain(cdp, `(() => {
    const el = Array.from(document.querySelectorAll('.codicon-menu')).find(e => e.getBoundingClientRect().width > 0);
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (menuIcon.found) { await realClick(cdp, menuIcon.x, menuIcon.y); await sleep(500); }
  const exportButtonRegression = await evalMain(cdp, `Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === '書き出し')`);
  record('l1-6-export-button-regression', { found: menuIcon.found, exportButtonRegression });
  if (!menuIcon.found || !exportButtonRegression) fail('export button (akari-shell-strip) regressed', { menuIcon, exportButtonRegression });
  await screenshot(cdp, path.join(EVIDENCE_DIR, '11-export-button-regression.png'));
  record('L1-6-PASS', { ok: true });

  const finalErrCount = await errorCount(cdp);
  const finalErrLog = await errorLog(cdp);
  record('ALL-PASS', { ok: true, finalConsoleErrorCount: finalErrCount, finalErrLog, thumbnailErrorDelta });

  await writeFile(path.join(EVIDENCE_DIR, 'run-log.json'), JSON.stringify(log, null, 2));
  console.log('SUCCESS: all L1 checks passed.');
  cdp.close();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('FAILED', err);
  await writeFile(path.join(EVIDENCE_DIR, 'run-log-FAILED.json'), JSON.stringify(log, null, 2)).catch(() => {});
  process.exit(1);
});
