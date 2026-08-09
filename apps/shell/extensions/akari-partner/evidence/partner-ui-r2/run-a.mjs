// partner-ui-r2 L1 検証本体。task.md の L1 受け入れ条件 4 点すべてをこの単一起動
// （opencode は実行機にインストールされていない = デフォルトの「PATH に無い」状態）で確認する。
// 1. 右「パートナーを追加」パネル: エージェント単位3行、claude/codex は左CLI/右拡張の2ボタン、
//    opencodeは全幅、推奨バッジはclaude CLIのみ
// 2. 左カタログ（幅~250px 強制）: スロットが縦積み、説明文の縦落ちなし
// 4. 回帰: opencode ボタン → 未導入案内（'opencode-ai' を含む）
// 3. 回帰: claude CLI ボタン → 接続フローが working へ遷移
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { connectMain, evalMain, screenshot } from './cdp-lib.mjs';
import {
  installErrorCounter, errorCount, errorLog,
  rightPanelRows, clickOpencodeCli, clickClaudeCli, rightPanelFlowState,
  revealPartnerCatalog, readCatalogWidth, catalogSlotLayout,
  findLeftSplitHandle, dragSplitHandle,
  waitFor
} from './widget-lib.mjs';

const [, , cdpPortArg, evidenceDirArg] = process.argv;
const CDP_PORT = Number(cdpPortArg);
const EVIDENCE_DIR = evidenceDirArg;

const log = [];
function record(step, data) { const e = { t: new Date().toISOString(), step, ...data }; log.push(e); console.log(`[${step}]`, JSON.stringify(data)); }
function fail(message, data) { record('FAIL:' + message, data || {}); throw new Error(message); }

async function main() {
  const cdp = await connectMain(CDP_PORT);
  await installErrorCounter(cdp);

  // onStart() が右パネルを activateWidget() まで済ませているはずだが、レイアウト
  // 復元・初期化の非同期性を考慮して行が現れるまで待つ。
  const rows = await waitFor(() => rightPanelRows(cdp), r => r.length === 3, 20000);
  record('right-panel-rows', { rows });

  // L1 受け入れ 1: エージェント単位3行、claude/codex は左CLI/右拡張の2ボタン、
  // opencode は CLI ボタンが全幅、推奨バッジは claude CLI のみ。
  if (rows.length !== 3) fail('expected exactly 3 agent rows in the add-partner panel', { rows });
  const [claudeRow, codexRow, opencodeRow] = rows;
  if (claudeRow.agent !== 'claude') fail('first row is not claude (array order not preserved)', { rows });
  if (codexRow.agent !== 'codex') fail('second row is not codex (array order not preserved)', { rows });
  if (opencodeRow.agent !== 'opencode') fail('third row is not opencode (array order not preserved)', { rows });

  if (claudeRow.buttons.length !== 2 || !claudeRow.buttons.some(b => b.entry === 'anthropic/claude-code-cli' && b.form === 'cli') || !claudeRow.buttons.some(b => b.entry === 'anthropic/claude-code-extension' && b.form === 'extension')) {
    fail('claude row does not have exactly cli+extension buttons', { claudeRow });
  }
  if (codexRow.buttons.length !== 2 || !codexRow.buttons.some(b => b.entry === 'openai/codex-cli' && b.form === 'cli') || !codexRow.buttons.some(b => b.entry === 'openai/codex-extension' && b.form === 'extension')) {
    fail('codex row does not have exactly cli+extension buttons', { codexRow });
  }
  if (opencodeRow.buttons.length !== 1 || opencodeRow.buttons[0].entry !== 'sst/opencode-cli') {
    fail('opencode row does not have exactly one (cli) button', { opencodeRow });
  }
  // 全幅判定: opencode の単一ボタン幅が claude 行の分割ボタン幅より明確に広い（>1.6倍）。
  const claudeButtonWidth = claudeRow.buttons.find(b => b.entry === 'anthropic/claude-code-cli').width;
  const opencodeButtonWidth = opencodeRow.buttons[0].width;
  record('button-width-comparison', { claudeButtonWidth, opencodeButtonWidth, ratio: opencodeButtonWidth / claudeButtonWidth });
  if (!(opencodeButtonWidth > claudeButtonWidth * 1.6)) {
    fail('opencode CLI button is not rendered full-width relative to a split button', { claudeButtonWidth, opencodeButtonWidth });
  }
  const claudeCliBadge = claudeRow.buttons.find(b => b.entry === 'anthropic/claude-code-cli').hasBadge;
  const claudeExtBadge = claudeRow.buttons.find(b => b.entry === 'anthropic/claude-code-extension').hasBadge;
  const anyCodexBadge = codexRow.buttons.some(b => b.hasBadge);
  const anyOpencodeBadge = opencodeRow.buttons.some(b => b.hasBadge);
  record('badge-check', { claudeCliBadge, claudeExtBadge, anyCodexBadge, anyOpencodeBadge });
  if (!claudeCliBadge) fail('claude CLI button should show the recommended badge', { claudeRow });
  if (claudeExtBadge || anyCodexBadge || anyOpencodeBadge) fail('recommended badge leaked to a non-recommended button', { rows });

  // 属性・挙動不変の確認（disabled は idle 状態では全て false のはず）。
  const anyDisabledAtIdle = rows.some(r => r.buttons.some(b => b.disabled));
  record('idle-disabled-check', { anyDisabledAtIdle });
  if (anyDisabledAtIdle) fail('a button is unexpectedly disabled at idle state', { rows });

  await screenshot(cdp, path.join(EVIDENCE_DIR, '01-add-partner-panel-grouped-rows.png'));

  // L1 受け入れ 2: 左パネルを実ドラッグで幅 ~250px へリサイズし、スロットが縦積み・
  // 説明文の縦落ちなしを確認する（DOM への直接 inline style 上書きは Lumino の
  // BoxLayout に即座に巻き戻されるため無効 — widget-lib.mjs の readCatalogWidth の
  // コメント参照。実ユーザー操作と同じスプリッタハンドルのドラッグでのみ効く）。
  const revealed = await revealPartnerCatalog(cdp);
  record('catalog-revealed', revealed);
  const beforeWidth = await readCatalogWidth(cdp);
  const handle = await findLeftSplitHandle(cdp);
  record('split-handle-found', { handle, beforeWidth });
  if (!handle) fail('left split panel handle not found', {});
  const TARGET_WIDTH = 250;
  const targetHandleX = handle.x + (TARGET_WIDTH - beforeWidth.width);
  await dragSplitHandle(cdp, handle.x, handle.y, targetHandleX);
  const afterWidth = await readCatalogWidth(cdp);
  record('catalog-width-after-drag', { targetHandleX, afterWidth });
  if (!afterWidth.ok || Math.abs(afterWidth.width - TARGET_WIDTH) > 30) {
    fail('drag did not resize the catalog panel to ~250px', { beforeWidth, afterWidth, targetHandleX });
  }
  const slotLayout = await catalogSlotLayout(cdp);
  record('catalog-slot-layout-narrow', { slotLayout });
  const claudeCard = slotLayout.find(c => c.agent === 'claude');
  if (!claudeCard || claudeCard.slots.length !== 2) fail('claude card does not have 2 slots at narrow width', { claudeCard });
  const [cliSlot, extSlot] = claudeCard.slots;
  // 縦積み判定: 2枚目スロットの top が1枚目の bottom 以上（横並びなら top はほぼ同じ）。
  const stacked = extSlot.top >= (cliSlot.top + cliSlot.height - 4); // 4px は境界誤差の許容
  record('narrow-stack-check', { cliSlot, extSlot, stacked });
  if (!stacked) fail('claude card slots did not stack vertically at ~250px width', { cliSlot, extSlot });
  // 縦落ち（1行1〜2文字での折返し）判定: スロット・説明文の幅が flex-basis 150px 相当を
  // 大きく下回っていない（極端に狭いと1文字ずつ改行される）。
  for (const slot of claudeCard.slots) {
    if (slot.width < 100) fail('a slot collapsed below a sane width at ~250px container (possible per-character wrap)', { slot });
    if (slot.descriptionWidth !== null && slot.descriptionWidth < 80) fail('slot description text width collapsed (possible per-character wrap)', { slot });
  }
  await screenshot(cdp, path.join(EVIDENCE_DIR, '02-catalog-narrow-stacked.png'));
  // 幅を元に戻す（後続の regression クリックは通常幅で行う）。
  await dragSplitHandle(cdp, targetHandleX, handle.y, handle.x);

  // L1 受け入れ 4: opencode ボタン → 未導入案内（'opencode-ai' を含む）、アプリは壊れない。
  const errBeforeOpencode = await errorCount(cdp);
  await clickOpencodeCli(cdp);
  const opencodeFlow = await waitFor(
    () => rightPanelFlowState(cdp),
    state => state.present && state.state === 'failed',
    15000
  );
  record('opencode-missing-flow', opencodeFlow);
  if (!opencodeFlow.present || opencodeFlow.state !== 'failed') fail('opencode setup did not reach a failed state with guidance', opencodeFlow);
  if (!opencodeFlow.text.includes('opencode-ai')) {
    fail('failure guidance does not include the confirmed npm package name (opencode-ai)', opencodeFlow);
  }
  const errAfterOpencode = await errorCount(cdp);
  record('opencode-missing-error-delta', { before: errBeforeOpencode, after: errAfterOpencode });
  await screenshot(cdp, path.join(EVIDENCE_DIR, '03-opencode-missing-guidance.png'));

  const stillResponsive = await evalMain(cdp, '1 + 1').then(v => v === 2).catch(() => false);
  record('app-still-responsive-after-opencode-failure', { ok: stillResponsive });
  if (!stillResponsive) fail('app did not respond to a trivial eval after the opencode failure', {});

  // L1 受け入れ 3: claude CLI ボタン → 接続フローが working へ遷移（従来どおり開始）。
  await clickClaudeCli(cdp);
  const claudeFlow = await waitFor(
    () => rightPanelFlowState(cdp),
    state => state.present && (state.state === 'working' || state.state === 'complete'),
    30000
  );
  record('claude-regression-flow', claudeFlow);
  if (!claudeFlow.present || claudeFlow.state === 'failed' || claudeFlow.state === 'idle') {
    fail('claude connect regression did not progress (working/complete expected)', claudeFlow);
  }
  await screenshot(cdp, path.join(EVIDENCE_DIR, '04-claude-connect-regression.png'));

  const finalErrCount = await errorCount(cdp);
  const finalErrLog = await errorLog(cdp);
  record('console-error-summary', { count: finalErrCount, sample: finalErrLog.slice(0, 10) });

  await writeFile(path.join(EVIDENCE_DIR, 'run-a-log.json'), JSON.stringify(log, null, 2));
  console.log('RUN_A_OK');
  cdp.close();
}

main().then(() => process.exit(0)).catch(error => {
  console.error('RUN_A_FAILED', error);
  process.exit(1);
});
