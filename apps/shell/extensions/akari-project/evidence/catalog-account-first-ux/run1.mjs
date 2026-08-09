// Run1: 「リモート到達可 + ローカル catalog/ 未設定」条件下の実測（L1 受け入れ条件 1）+
// 内部語非露出 + アカウント第一見出し + 開発者リンク行（一覧表示中の到達性） + 回帰一式
// （検索/カテゴリ・音源試聴・素材タブ・未整理・ストア接続/切断）。
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { connectMain, screenshot } from './cdp-lib.mjs';
import {
  installErrorCounter, errorCount, errorLog,
  ensureRoleBucketsWidgetVisible, clickCatalogTab, clickMaterialsTab,
  bodyInnerText, catalogItemCount, emptyStateInfo, accountHeaderInfo,
  clickDeveloperLinkToggle, developerSectionState,
  visibleCatalogItemKeys, catalogItemStates,
  setCatalogSearch, clickCategoryChip,
  clickButtonByText, storeConnectionPhaseAttr,
  setPreferenceViaProductionApi,
  waitFor
} from './widget-lib.mjs';

const [, , cdpPortArg, evidenceDirArg, bogusPreferenceArg] = process.argv;
const CDP_PORT = Number(cdpPortArg);
const EVIDENCE_DIR = evidenceDirArg;
const BOGUS_PREFERENCE_PATH = bogusPreferenceArg;

const log = [];
function record(step, data) { const e = { t: new Date().toISOString(), step, ...data }; log.push(e); console.log(`[${step}]`, JSON.stringify(data)); }
function fail(message, data) { record('FAIL:' + message, data || {}); throw new Error(message); }

async function main() {
  const cdp = await connectMain(CDP_PORT);
  await installErrorCounter(cdp);
  await ensureRoleBucketsWidgetVisible(cdp);

  // ローカル catalog/ を「未設定」にする: このリポの dev 配置では __dirname 起点の上方探索が
  // このリポ自身の catalog/ を必ず拾ってしまう（cwd 操作では防げない）ため、
  // akari.catalog.root に存在しないパスを明示設定して resolveCatalogRoot() を
  // 確実に undefined にする（catalog-root-fix/scenario2-picker.mjs と同じ手法）。
  const prefSet = await setPreferenceViaProductionApi(cdp, 'akari.catalog.root', BOGUS_PREFERENCE_PATH);
  record('setup:bogus-preference-set', prefSet);

  await clickCatalogTab(cdp);

  // L1-1: リモート到達可 + ローカル catalog/ 未設定 → リモート由来のカードが並ぶ
  const counts = await waitFor(
    () => catalogItemCount(cdp),
    count => typeof count === 'number' && count > 0,
    30000
  );
  if (!(typeof counts === 'number' && counts > 0)) fail('resolver items did not appear within timeout', { counts });
  record('L1-1:item-count', { itemCount: counts });
  await screenshot(cdp, path.join(EVIDENCE_DIR, '01-remote-cards.png'));

  const states = await catalogItemStates(cdp);
  const resolverOriginCount = states.filter(s => s.state === 'cached' || s.state === 'available' || s.state === 'locked').length;
  record('L1-1:resolver-origin-count', { resolverOriginCount, totalVisible: states.length });
  if (resolverOriginCount === 0) fail('no resolver-origin (state-badged) cards found', { states: states.slice(0, 5) });

  // 内部語が画面のどこにも出ない（開発者折りたたみを開いていない状態）
  const text1 = await bodyInnerText(cdp);
  const leaksBefore = {
    unresolvedMessage: text1.includes('カタログの場所が未設定'),
    preferenceKey: text1.includes('akari.catalog.root')
  };
  record('L1-1:leak-check-closed', leaksBefore);
  if (leaksBefore.unresolvedMessage || leaksBefore.preferenceKey) fail('internal wording leaked while developer section is closed', leaksBefore);

  const empty1 = await emptyStateInfo(cdp);
  record('empty-state-absent-when-items', empty1);
  if (empty1.present) fail('empty state should not render when items are present', empty1);

  // アカウント第一見出し + リモート取得状態の小表示
  const header1 = await accountHeaderInfo(cdp);
  record('account-header', header1);
  if (!header1.present || !header1.text.includes('このアカウントで使える素材')) fail('account-first heading missing', header1);
  if (!header1.resolverCountText || !header1.resolverCountText.includes(String(counts))) fail('resolver item count not reflected near heading', header1);
  if (header1.retryInlinePresent) fail('inline retry should not show when resolver status is ok', header1);

  // 一覧表示中でも開発者向け導線（小リンク）から到達できる（L1-4）
  await clickDeveloperLinkToggle(cdp);
  const devOpen = await developerSectionState(cdp);
  record('developer-link-row-opened', devOpen);
  if (!devOpen.pickButtonPresent) fail('developer panel (folder picker) not reachable from the link row while list is shown', devOpen);
  const text2 = await bodyInnerText(cdp);
  if (!text2.includes('akari.catalog.root')) fail('preference key should be visible inside the opened developer panel', {});
  await screenshot(cdp, path.join(EVIDENCE_DIR, '02-developer-link-row-open.png'));

  await clickDeveloperLinkToggle(cdp);
  await sleep(200);
  const devClosed = await developerSectionState(cdp);
  record('developer-link-row-closed', devClosed);
  if (devClosed.pickButtonPresent) fail('developer panel did not collapse after toggling again', devClosed);
  const text3 = await bodyInnerText(cdp);
  if (text3.includes('akari.catalog.root')) fail('preference key leaked after collapsing the developer panel', {});

  // 回帰: 検索
  const beforeSearchKeys = await visibleCatalogItemKeys(cdp);
  await setCatalogSearch(cdp, 'コーヒー');
  await sleep(300);
  const afterSearchKeys = await visibleCatalogItemKeys(cdp);
  record('regression:search', { before: beforeSearchKeys.length, after: afterSearchKeys.length, keys: afterSearchKeys });
  if (afterSearchKeys.length === 0 || afterSearchKeys.length >= beforeSearchKeys.length) {
    fail('search did not narrow the catalog list as expected', { before: beforeSearchKeys.length, after: afterSearchKeys.length });
  }
  await setCatalogSearch(cdp, '');
  await sleep(300);

  // 回帰: カテゴリチップ
  await clickCategoryChip(cdp, 'audio');
  await sleep(300);
  const audioStates = await catalogItemStates(cdp);
  record('regression:category-audio', { count: audioStates.length });
  if (audioStates.length === 0) fail('audio category chip returned zero items', {});
  await screenshot(cdp, path.join(EVIDENCE_DIR, '03-category-audio.png'));

  // 回帰: 音源試聴（resolver origin の audio カードのみ mediaUrl を持つ）。
  // ボタンが 24x24px の小さな絶対配置丸ボタンで、CDP 合成マウス座標クリックだと
  // 別の要素に取られて空振りすることを実測で確認したため（.click() では確実に発火する —
  // React の onClick 自体は素の click イベントを見ており isTrusted を問わないため製品側の
  // 実際の挙動と差はない）、この 1 箇所だけ el.click() で発火させる。
  const audioToggle = await (async () => {
    const { evalMain } = await import('./cdp-lib.mjs');
    const found = await evalMain(cdp, `!!document.querySelector('[data-akari-catalog-audio-toggle]')`);
    if (!found) return { found: false };
    await evalMain(cdp, `document.querySelector('[data-akari-catalog-audio-toggle]').click()`);
    await sleep(900);
    const playing = await evalMain(cdp, `document.querySelector('[data-akari-catalog-audio-playing="true"]') ? true : false`);
    await evalMain(cdp, `document.querySelector('[data-akari-catalog-audio-playing="true"]')?.click()`);
    await sleep(300);
    return { found: true, playingObserved: playing };
  })();
  record('regression:audio-preview', audioToggle);
  if (!audioToggle.found) fail('no audio preview toggle found in audio category', {});
  if (!audioToggle.playingObserved) fail('audio preview toggle did not report playing state', audioToggle);

  await clickCategoryChip(cdp, 'All');
  await sleep(300);

  // 回帰: 素材タブ（ドロップゾーン・実素材カード・未整理セクション）
  await clickMaterialsTab(cdp);
  await sleep(500);
  const { evalMain } = await import('./cdp-lib.mjs');
  const materialsState = await evalMain(cdp, `(() => {
    const dropzone = document.querySelector('[data-akari-dropzone]');
    const clipCard = document.body.innerText.includes('regression-clip.mp4');
    const unorganizedShot = document.body.innerText.includes('unorganized-shot.png');
    return {
      dropzonePresent: !!dropzone,
      clipCardPresent: clipCard,
      unorganizedShotPresent: unorganizedShot
    };
  })()`);
  record('regression:materials-tab', materialsState);
  if (!materialsState.dropzonePresent) fail('materials tab dropzone missing', materialsState);
  if (!materialsState.clipCardPresent) fail('regression-clip.mp4 material card missing', materialsState);
  if (!materialsState.unorganizedShotPresent) fail('unorganized-shot.png missing from unorganized section', materialsState);
  await screenshot(cdp, path.join(EVIDENCE_DIR, '04-materials-tab-regression.png'));

  // 回帰: ストア接続/切断（開始 → キャンセルまでの UI 遷移。実 OAuth 完了は範囲外）
  await clickCatalogTab(cdp);
  await sleep(400);
  const beforeConnect = await storeConnectionPhaseAttr(cdp);
  record('regression:store-before', { phase: beforeConnect });
  if (beforeConnect !== 'disconnected') fail('expected disconnected store phase before starting connection', { phase: beforeConnect });
  await clickButtonByText(cdp, 'AKARI アカウントを接続');
  const afterConnect = await waitFor(
    () => storeConnectionPhaseAttr(cdp),
    phase => phase === 'pending' || phase === 'starting' || phase === 'error',
    8000
  );
  record('regression:store-after-connect-click', { phase: afterConnect });
  if (afterConnect === 'disconnected' || afterConnect == null) fail('store connection did not leave the disconnected phase after clicking connect', { phase: afterConnect });
  if (afterConnect === 'pending') {
    await clickButtonByText(cdp, 'キャンセル');
    await sleep(300);
    const afterCancel = await storeConnectionPhaseAttr(cdp);
    record('regression:store-after-cancel', { phase: afterCancel });
    if (afterCancel !== 'disconnected') fail('store connection did not return to disconnected after cancel', { phase: afterCancel });
  }
  await screenshot(cdp, path.join(EVIDENCE_DIR, '05-store-connection-regression.png'));

  const finalErrCount = await errorCount(cdp);
  const finalErrLog = await errorLog(cdp);
  record('console-error-summary', { count: finalErrCount, sample: finalErrLog.slice(0, 10) });

  await writeFile(path.join(EVIDENCE_DIR, 'run1-log.json'), JSON.stringify(log, null, 2));
  console.log('RUN1_OK');
  cdp.close();
}

main().then(() => process.exit(0)).catch(error => {
  console.error('RUN1_FAILED', error);
  process.exit(1);
});
