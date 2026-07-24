// catalog-tab final-smoke（デバッグフック不在の最終ビルドに対する再実測）。
// card-ask-agent/export-button と同じ手順: run-l1.mjs でフック在りの検証を終えた後、
// AkariRoleBucketsWidget からデバッグフック（globalThis.__akariRoleBucketsWidgetDebug）と
// WidgetManager 注入を完全に削除し、再ビルドしたうえでフック不要な項目を
// もう一度実測する。パートナー端末バッファへの到達確認（取り込む/頼むの実測）は
// フックがないと再現できないため run-l1.mjs 側でのみ実測している（precedent と同じ
// 割り切り）。ここでは preference 未設定時の開発配置カタログ（実 catalog/）に対して
// カード表示・検索・カテゴリ絞り込み・meta.json 欠落混在への耐性・回帰・
// 未接続トーストを検証する——preferences.set を一切呼ばないため、
// ~/.theia/settings.json 等のグローバル状態を汚染しない。
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { connectMain, evalMain, realClick, screenshot } from './cdp-lib.mjs';

const [, , cdpPortArg, evidenceDirArg] = process.argv;
const CDP_PORT = Number(cdpPortArg);
const EVIDENCE_DIR = evidenceDirArg;

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
  fail('role-buckets widget did not become visible', {});
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

async function catalogCounts(cdp) {
  return evalMain(cdp, `(() => {
    const el = document.querySelector('[data-akari-catalog-item-count]');
    if (!el) return { found: false };
    return { found: true, itemCount: Number(el.getAttribute('data-akari-catalog-item-count')), missingCount: Number(el.getAttribute('data-akari-catalog-missing-count')) };
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
  await cdp.send('Input.insertText', { text });
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

async function clickCatalogCardButton(cdp, itemKey, buttonLabel) {
  await evalMain(cdp, `(() => {
    const card = document.querySelector('[data-akari-catalog-item=${JSON.stringify(itemKey)}]');
    if (card) card.scrollIntoView({ block: 'center' });
  })()`);
  await sleep(300);
  const btn = await evalMain(cdp, `(() => {
    const card = document.querySelector('[data-akari-catalog-item=${JSON.stringify(itemKey)}]');
    if (!card) return { found: false, reason: 'card-not-found' };
    const b = Array.from(card.querySelectorAll('button')).find(x => x.textContent.trim() === ${JSON.stringify(buttonLabel)});
    if (!b) return { found: false, reason: 'button-not-found' };
    const r = b.getBoundingClientRect();
    return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!btn.found) fail('catalog card button not clickable', { itemKey, buttonLabel, btn });
  await realClick(cdp, btn.x, btn.y);
  await sleep(500);
}

async function toastMessages(cdp) {
  return evalMain(cdp, `Array.from(document.querySelectorAll('.theia-notification-message')).map(n => n.textContent.trim())`);
}

async function main() {
  const cdp = await connectMain(CDP_PORT);
  record('connected-main', {});
  await sleep(1500);
  await installErrorCounter(cdp);

  const hookAbsent = await evalMain(cdp, `!window.__akariRoleBucketsWidgetDebug`);
  record('debug-hook-absent', { hookAbsent });
  if (!hookAbsent) fail('debug hook is still present in the final build', { hookAbsent });

  await ensureRoleBucketsWidgetVisible(cdp);
  await clickRoleBucketsTab(cdp, 'カタログ');
  await screenshot(cdp, path.join(EVIDENCE_DIR, 'final-smoke-00-catalog-tab.png'));

  // === 開発配置カタログ（実 catalog/）の自動検出 — preferences.set は一切呼ばない ===
  const counts = await waitForCatalogCounts(cdp, c => c.itemCount > 0, 8000);
  record('dev-layout-autodetect', counts);
  if (!counts?.found || counts.itemCount <= 0) fail('dev-layout catalog auto-detect regressed', counts);
  // telop の 36 件は meta.json 非対応のため missingCount に計上される想定（実カタログでの耐性実測）。
  if (counts.missingCount <= 0) fail('missing-meta resilience regressed (expected telop items to count as missing)', counts);
  record('dev-layout-autodetect-PASS', { ok: true, ...counts });

  // === カード内容（title/category/tags/license バッジ）===
  const vintageCardText = await evalMain(cdp, `(() => {
    const card = document.querySelector('[data-akari-catalog-item="3d/vintage-camera"]');
    return card ? card.textContent : null;
  })()`);
  record('vintage-card-content', { vintageCardText });
  if (!vintageCardText || !vintageCardText.includes('ヴィンテージカメラ')) fail('vintage-camera card missing from real catalog rendering', { vintageCardText });
  await screenshot(cdp, path.join(EVIDENCE_DIR, 'final-smoke-01-cards.png'));

  // === 検索 ===
  await setCatalogSearch(cdp, 'ヴィンテージ');
  await sleep(400);
  const searchKeys = await visibleCatalogCardKeys(cdp);
  record('search', { searchKeys });
  if (!searchKeys.includes('3d/vintage-camera') || searchKeys.length === 0) fail('search regressed', { searchKeys });
  await screenshot(cdp, path.join(EVIDENCE_DIR, 'final-smoke-02-search.png'));
  await setCatalogSearch(cdp, '');
  await sleep(300);

  // === カテゴリチップ ===
  await clickCategoryChip(cdp, '3d');
  await sleep(400);
  const categoryKeys = await visibleCatalogCardKeys(cdp);
  record('category-filter', { categoryKeys });
  if (!categoryKeys.length || !categoryKeys.every(k => k.startsWith('3d/'))) fail('category filter regressed', { categoryKeys });
  await screenshot(cdp, path.join(EVIDENCE_DIR, 'final-smoke-03-category.png'));
  await clickCategoryChip(cdp, 'All');
  await sleep(400);

  // === 未接続トースト（パートナー未接続のまま「取り込む」） ===
  const toastsBefore = (await toastMessages(cdp)).length;
  await clickCatalogCardButton(cdp, '3d/vintage-camera', '取り込む');
  await sleep(700);
  const toastsAfter = await toastMessages(cdp);
  record('not-connected-toast', { toastsBefore, toastsAfter });
  const expectedToast = 'パートナー未接続。ホームの「パートナーに接続する」から接続してください';
  if (toastsAfter.length <= toastsBefore || !toastsAfter.includes(expectedToast)) {
    fail('not-connected toast regressed', { toastsAfter, expectedToast });
  }
  await screenshot(cdp, path.join(EVIDENCE_DIR, 'final-smoke-04-not-connected-toast.png'));
  record('not-connected-toast-PASS', { ok: true });

  // === 回帰: 素材タブ / プランタブ ===
  await clickRoleBucketsTab(cdp, '素材');
  await sleep(500);
  const materialsRegression = await evalMain(cdp, `(() => {
    const dz = document.querySelector('[data-akari-dropzone]');
    return { dzOk: !!dz && dz.getBoundingClientRect().width > 0, hasRegressionClip: document.body.textContent.includes('regression-clip.mp4') };
  })()`);
  record('materials-regression', materialsRegression);
  if (!materialsRegression.dzOk || !materialsRegression.hasRegressionClip) fail('materials tab regressed', materialsRegression);
  await screenshot(cdp, path.join(EVIDENCE_DIR, 'final-smoke-05-materials-regression.png'));

  await clickRoleBucketsTab(cdp, 'プラン');
  await sleep(400);
  const planRegression = await evalMain(cdp, `document.body.textContent.includes('プランはここに入ります')`);
  record('plan-regression', { planRegression });
  if (!planRegression) fail('plan tab regressed', { planRegression });

  // === 回帰: akari-shell-strip の書き出しボタン ===
  const menuIcon = await evalMain(cdp, `(() => {
    const el = Array.from(document.querySelectorAll('.codicon-menu')).find(e => e.getBoundingClientRect().width > 0);
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (menuIcon.found) { await realClick(cdp, menuIcon.x, menuIcon.y); await sleep(500); }
  const exportButtonRegression = await evalMain(cdp, `Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === '書き出し')`);
  record('export-button-regression', { found: menuIcon.found, exportButtonRegression });
  if (!menuIcon.found || !exportButtonRegression) fail('export button regressed', { menuIcon, exportButtonRegression });
  await screenshot(cdp, path.join(EVIDENCE_DIR, 'final-smoke-06-export-button-regression.png'));

  const finalErrCount = await errorCount(cdp);
  const finalErrLog = await errorLog(cdp);
  record('ALL-PASS', { ok: true, finalConsoleErrorCount: finalErrCount, finalErrLog });

  await writeFile(path.join(EVIDENCE_DIR, 'final-smoke-log.json'), JSON.stringify(log, null, 2));
  console.log('SUCCESS: final-smoke passed with the debug hook absent.');
  cdp.close();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('FAILED', err);
  await writeFile(path.join(EVIDENCE_DIR, 'final-smoke-log-FAILED.json'), JSON.stringify(log, null, 2)).catch(() => {});
  process.exit(1);
});
