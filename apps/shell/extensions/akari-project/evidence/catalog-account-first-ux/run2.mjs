// Run2: 「リモート遮断 + ローカル未設定」条件下の実測（L1 受け入れ条件 2・3・4）+
// ローカル origin の「取り込む」「頼む」回帰。
//
// 遮断は AKARI_ASSETS_CATALOG を「まだ何も listen していないローカルポート」へ向けることで
// 再現する（起動時に ECONNREFUSED で確実に失敗する。task.md の「resolver の向き先を
// 無効URLにする等」の指示どおり）。遮断解除は local-catalog-server.mjs を同じポートで
// 起動するだけ（このスクリプトの後半で子プロセスとして起動する）。
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { connectMain, screenshot, evalMain } from './cdp-lib.mjs';
import {
  installErrorCounter, errorCount, errorLog,
  ensureRoleBucketsWidgetVisible, clickCatalogTab,
  bodyInnerText, catalogItemCount, emptyStateInfo, accountHeaderInfo,
  developerSectionState, clickSummaryToOpenDetails, clickPickFolderButton,
  stubFolderDialog, setPreferenceViaProductionApi, readPreferenceViaProductionApi,
  clickInlineRetry, catalogItemStates,
  waitFor
} from './widget-lib.mjs';

const [
  , , cdpPortArg, evidenceDirArg,
  bogusPreferenceArg, invalidFolderArg, validFolderArg,
  serverPortArg, synthCatalogPathArg
] = process.argv;
const CDP_PORT = Number(cdpPortArg);
const EVIDENCE_DIR = evidenceDirArg;
const BOGUS_PREFERENCE_PATH = bogusPreferenceArg;
const INVALID_FOLDER = invalidFolderArg;
const VALID_FOLDER = validFolderArg;
const SERVER_PORT = Number(serverPortArg);
const SYNTH_CATALOG_PATH = synthCatalogPathArg;

const log = [];
function record(step, data) { const e = { t: new Date().toISOString(), step, ...data }; log.push(e); console.log(`[${step}]`, JSON.stringify(data)); }
function fail(message, data) { record('FAIL:' + message, data || {}); throw new Error(message); }

async function main() {
  const cdp = await connectMain(CDP_PORT);
  await installErrorCounter(cdp);
  await ensureRoleBucketsWidgetVisible(cdp);

  const prefSet = await setPreferenceViaProductionApi(cdp, 'akari.catalog.root', BOGUS_PREFERENCE_PATH);
  record('setup:bogus-preference-set', prefSet);

  await clickCatalogTab(cdp);

  // L1-2 前半: resolver 遮断（ECONNREFUSED）+ ローカル未設定 → 一般向けの取得失敗文言 + 再試行
  const empty1 = await waitFor(
    () => emptyStateInfo(cdp),
    state => state.present,
    20000
  );
  record('L1-2:empty-state-resolver-failed', empty1);
  if (!empty1.present || empty1.kind !== 'resolver-failed') fail('expected resolver-failed empty state', empty1);
  if (!empty1.messageText || !empty1.messageText.includes('取得できませんでした')) fail('unexpected empty-state message', empty1);
  if (!empty1.retryPresent) fail('retry button missing on resolver-failed empty state', empty1);

  const text1 = await bodyInnerText(cdp);
  const leaks1 = { unresolvedMessage: text1.includes('カタログの場所が未設定'), preferenceKey: text1.includes('akari.catalog.root') };
  record('L1-2:leak-check-closed', leaks1);
  if (leaks1.unresolvedMessage || leaks1.preferenceKey) fail('internal wording leaked on the generic failure empty state', leaks1);
  await screenshot(cdp, path.join(EVIDENCE_DIR, '11-resolver-failed-empty-state.png'));

  // L1-3: 空状態の「開発者向け」折りたたみ → 開く → akari.catalog.root の表記可
  await clickSummaryToOpenDetails(cdp);
  const devOpen1 = await developerSectionState(cdp);
  record('L1-3:developer-details-opened', devOpen1);
  if (!devOpen1.detailsOpen || !devOpen1.pickButtonPresent) fail('developer details did not open from the empty state', devOpen1);
  const text2 = await bodyInnerText(cdp);
  if (!text2.includes('akari.catalog.root')) fail('preference key should be visible once the developer details is opened', {});

  // L1-3: 不正フォルダ → 日本語の理由表示・preference 不変
  await stubFolderDialog(cdp, INVALID_FOLDER);
  await clickPickFolderButton(cdp);
  await sleep(600);
  const invalidState = await developerSectionState(cdp);
  record('L1-3:invalid-folder-result', invalidState);
  if (!invalidState.pickErrorText || !invalidState.pickErrorText.includes('見つかりません')) {
    fail('invalid folder selection did not show the expected Japanese reason', invalidState);
  }
  const prefAfterInvalid = await readPreferenceViaProductionApi(cdp, 'akari.catalog.root');
  record('L1-3:preference-after-invalid', prefAfterInvalid);
  if (prefAfterInvalid.value !== BOGUS_PREFERENCE_PATH) fail('preference changed despite an invalid folder selection', prefAfterInvalid);
  await screenshot(cdp, path.join(EVIDENCE_DIR, '12-invalid-folder-error.png'));

  // L1-3: 実カタログ選択 → ローカル分のカード出現・preference 書き込み
  await stubFolderDialog(cdp, VALID_FOLDER);
  await clickPickFolderButton(cdp);
  const localCounts = await waitFor(
    () => catalogItemCount(cdp),
    count => typeof count === 'number' && count > 0,
    15000
  );
  if (!(typeof localCounts === 'number' && localCounts > 0)) fail('local catalog items did not appear after picking a valid folder', { localCounts });
  record('L1-3:local-items-appeared', { itemCount: localCounts });
  await screenshot(cdp, path.join(EVIDENCE_DIR, '13-local-cards-after-picker.png'));

  const prefAfterValid = await readPreferenceViaProductionApi(cdp, 'akari.catalog.root');
  record('L1-3:preference-after-valid', prefAfterValid);
  if (prefAfterValid.value !== VALID_FOLDER) fail('preference was not written to the picked folder path', prefAfterValid);

  const statesAfterLocal = await catalogItemStates(cdp);
  const nonLocalCount = statesAfterLocal.filter(s => s.state !== 'local').length;
  record('L1-3:item-states-after-local-only', { total: statesAfterLocal.length, nonLocalCount });
  if (nonLocalCount !== 0) fail('resolver-origin items should not be present while the resolver is still blocked', { nonLocalCount });

  // resolver はまだ遮断中 → アカウント見出し付近に小さい失敗表示が出ること（唯一の手がかり）
  const header1 = await accountHeaderInfo(cdp);
  record('L1-4:account-header-with-local-items-resolver-failed', header1);
  if (!header1.retryInlinePresent) fail('inline retry indicator missing near the heading while items are local-only and resolver is still failed', header1);

  // L1-4: 一覧表示中でも開発者向け導線（小リンク）から到達できる。developerCatalogOpen は
  // 空状態の <details> と一覧の小リンクで共有される状態のため、直前に空状態側で開いたままなら
  // 一覧遷移後も既に開いている（「同じ導線」の裏返し — ここでは既存の開閉に関わらず、
  // 一度トグルして期待どおり反転することだけを確認する）。
  const devInListBefore = await developerSectionState(cdp);
  await evalMain(cdp, `document.querySelector('[data-akari-developer-catalog-toggle]')?.click()`);
  await sleep(400);
  const devInListAfter = await developerSectionState(cdp);
  record('L1-4:developer-link-row-toggle', { before: devInListBefore.pickButtonPresent, after: devInListAfter.pickButtonPresent });
  if (devInListBefore.pickButtonPresent === devInListAfter.pickButtonPresent) {
    fail('developer link row toggle did not change panel visibility while list is shown', { before: devInListBefore, after: devInListAfter });
  }
  const openState = devInListAfter.pickButtonPresent ? devInListAfter : devInListBefore;
  if (!openState.pickButtonPresent || !openState.valueText?.includes(VALID_FOLDER)) {
    fail('developer panel content (folder picker / current value) not correct while reachable from list state', openState);
  }
  record('L1-4:developer-link-row-reachable', openState);
  // 閉じた状態で次のステップに進む（開いていれば再クリックして閉じる）。
  if (devInListAfter.pickButtonPresent) {
    await evalMain(cdp, `document.querySelector('[data-akari-developer-catalog-toggle]')?.click()`);
    await sleep(300);
  }
  const text3 = await bodyInnerText(cdp);
  const leaks2 = { unresolvedMessage: text3.includes('カタログの場所が未設定'), preferenceKey: text3.includes('akari.catalog.root') };
  record('L1-4:leak-check-list-closed', leaks2);
  if (leaks2.unresolvedMessage || leaks2.preferenceKey) fail('internal wording leaked in the populated list state with the developer link row closed', leaks2);

  // 回帰: origin='local' の「取り込む」「頼む」（task.md やらないこと外 — 変更していないことの確認）
  const importInfo = await evalMain(cdp, `(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '取り込む');
    const ask = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '頼む');
    return { importPresent: !!btn, askPresent: !!ask };
  })()`);
  record('regression:local-verb-buttons-present', importInfo);
  if (!importInfo.askPresent) fail('頼む button missing on local-origin catalog cards', importInfo);
  const errCountBeforeVerbs = await errorCount(cdp);
  if (importInfo.importPresent) {
    await evalMain(cdp, `Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '取り込む').click()`);
    await sleep(500);
  }
  await evalMain(cdp, `Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '頼む').click()`);
  await sleep(500);
  const quickInputVisible = await evalMain(cdp, `!!document.querySelector('.quick-input-widget input, .monaco-quick-input-widget input')`);
  record('regression:ask-agent-quick-input-opened', { quickInputVisible });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 27, key: 'Escape' });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 27, key: 'Escape' });
  await sleep(300);
  const errCountAfterVerbs = await errorCount(cdp);
  record('regression:local-verb-error-delta', { before: errCountBeforeVerbs, after: errCountAfterVerbs });
  if (errCountAfterVerbs > errCountBeforeVerbs) fail('local-origin verb buttons raised console errors', { before: errCountBeforeVerbs, after: errCountAfterVerbs });
  await screenshot(cdp, path.join(EVIDENCE_DIR, '14-local-verbs-regression.png'));

  // L1-2 後半: 遮断解除（ローカル HTTP サーバーを起動）→ 再試行 → resolver 由来のカードも並ぶ
  const server = spawn(process.execPath, ['local-catalog-server.mjs', String(SERVER_PORT), SYNTH_CATALOG_PATH], {
    cwd: path.dirname(new URL(import.meta.url).pathname),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error('local catalog server did not start in time')), 8000);
    server.stdout.on('data', chunk => {
      if (chunk.toString().includes('LISTENING')) { clearTimeout(timer); resolvePromise(); }
    });
    server.on('error', reject);
  });
  record('setup:local-catalog-server-started', { port: SERVER_PORT });

  await clickInlineRetry(cdp);
  const mergedCounts = await waitFor(
    () => catalogItemCount(cdp),
    count => typeof count === 'number' && count > localCounts,
    15000
  );
  record('L1-2:merged-after-unblock', { before: localCounts, after: mergedCounts });
  if (!(typeof mergedCounts === 'number' && mergedCounts > localCounts)) {
    fail('resolver-origin items did not merge in after unblocking and retrying', { before: localCounts, after: mergedCounts });
  }
  const statesAfterMerge = await catalogItemStates(cdp);
  const resolverOriginAfterMerge = statesAfterMerge.filter(s => s.state !== 'local').length;
  record('L1-2:resolver-origin-after-merge', { resolverOriginAfterMerge });
  if (resolverOriginAfterMerge === 0) fail('no resolver-origin cards found after unblocking', {});
  const header2 = await accountHeaderInfo(cdp);
  record('L1-2:account-header-after-merge', header2);
  if (header2.retryInlinePresent) fail('inline retry indicator should disappear once resolver is ok', header2);
  await screenshot(cdp, path.join(EVIDENCE_DIR, '15-merged-after-unblock.png'));

  server.kill('SIGKILL');

  const finalErrCount = await errorCount(cdp);
  const finalErrLog = await errorLog(cdp);
  record('console-error-summary', { count: finalErrCount, sample: finalErrLog.slice(0, 10) });

  await writeFile(path.join(EVIDENCE_DIR, 'run2-log.json'), JSON.stringify(log, null, 2));
  console.log('RUN2_OK');
  cdp.close();
}

main().then(() => process.exit(0)).catch(error => {
  console.error('RUN2_FAILED', error);
  process.exit(1);
});
