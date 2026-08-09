// Run A: 通常 PATH（copilot/cursor/antigravity は実行機に未導入 — 事前に
// `ls ~/.local/bin` で確認済み）+ AKARI_PARTNER_{COPILOT,CURSOR,ANTIGRAVITY}_INSTALL_URL を
// 到達不能な URL (http://127.0.0.1:1) へオーバーライドして起動する。3エージェントとも実際は
// 到達可能な公式インストールスクリプト URL を持つため、オーバーライドなしでは「未導入 →
// 実インストール成功」に倒れてしまい、task.md L1-4 が要求する「インストール失敗時の手動
// コマンド入り案内表示」を再現できない。環境変数オーバーライドは契約が定義した正規の差し替え
// 経路（bootstrap-runner.ts の *_INSTALL_URL 読み取り）を使っており、実装のハックではない。
// opencode は本タスクの「本丸」なので URL は素の既定値のまま実インストールを実際に走らせる
// （ネットワーク必須。この実行機に opencode が無いことは事前に `which opencode` /
// `ls ~/.opencode/bin` / `ls ~/.local/bin/opencode` で確認済み）。
//
// 検証する L1 受け入れ条件:
// 1. 右パネル: 6行（claude/codex 2分割、opencode/copilot/cursor/antigravity 全幅）、推奨バッジは claude CLI のみ
// 2. 左カタログ: 6カード表示、崩れなし
// 3. opencode の実インストール一周（本丸）
// 4(前半). copilot/cursor/antigravity: インストール失敗時の手動コマンド入り案内表示
// 5. 回帰: claude CLI ボタン → working 遷移
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { connectMain, evalMain, screenshot } from './cdp-lib.mjs';
import {
  installErrorCounter, errorCount, errorLog,
  rightPanelRows, rightPanelFlowState,
  clickClaudeCli, clickOpencodeCli, clickCopilotCli, clickCursorCli, clickAntigravityCli,
  revealPartnerCatalog, catalogGroups,
  terminalTabTitles,
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

  // L1-1: 右パネル 6行。
  const rows = await waitFor(() => rightPanelRows(cdp), r => r.length === 6, 90000);
  record('right-panel-rows', { rows });
  if (rows.length !== 6) fail('expected exactly 6 agent rows in the add-partner panel', { rows });
  const expectedOrder = ['claude', 'codex', 'opencode', 'copilot', 'cursor', 'antigravity'];
  rows.forEach((row, i) => {
    if (row.agent !== expectedOrder[i]) fail(`row ${i} agent mismatch (catalog array order not preserved)`, { rows, expectedOrder });
  });
  const [claudeRow, codexRow, opencodeRow, copilotRow, cursorRow, antigravityRow] = rows;
  for (const [name, row] of [['claude', claudeRow], ['codex', codexRow]]) {
    if (row.buttons.length !== 2) fail(`${name} row does not have exactly 2 buttons (cli+extension)`, { row });
  }
  for (const [name, row] of [['opencode', opencodeRow], ['copilot', copilotRow], ['cursor', cursorRow], ['antigravity', antigravityRow]]) {
    if (row.buttons.length !== 1) fail(`${name} row does not have exactly 1 (cli-only) button`, { row });
  }
  const claudeCliWidth = claudeRow.buttons.find(b => b.entry === 'anthropic/claude-code-cli').width;
  for (const [name, row] of [['opencode', opencodeRow], ['copilot', copilotRow], ['cursor', cursorRow], ['antigravity', antigravityRow]]) {
    const w = row.buttons[0].width;
    record('full-width-check', { name, w, claudeCliWidth, ratio: w / claudeCliWidth });
    if (!(w > claudeCliWidth * 1.6)) fail(`${name} CLI button is not rendered full-width relative to a split button`, { name, w, claudeCliWidth });
  }
  const badgedButtons = rows.flatMap(r => r.buttons).filter(b => b.hasBadge);
  record('badge-check', { badgedButtons });
  if (badgedButtons.length !== 1 || badgedButtons[0].entry !== 'anthropic/claude-code-cli') {
    fail('recommended badge should appear exactly once, on anthropic/claude-code-cli', { badgedButtons });
  }
  const anyDisabledAtIdle = rows.some(r => r.buttons.some(b => b.disabled));
  if (anyDisabledAtIdle) fail('a button is unexpectedly disabled at idle state', { rows });

  await screenshot(cdp, path.join(EVIDENCE_DIR, '01-add-partner-panel-6-rows.png'));

  // L1-2: 左カタログ 6カード、崩れなし。
  await revealPartnerCatalog(cdp);
  const groups = await catalogGroups(cdp);
  record('catalog-groups', { groups });
  if (groups.length !== 6) fail('expected exactly 6 catalog cards', { groups });
  for (const g of groups) {
    for (const slot of g.slots) {
      if (slot.width < 30 || slot.height < 30) fail('a catalog slot collapsed (possible layout breakage)', { g, slot });
    }
  }
  await screenshot(cdp, path.join(EVIDENCE_DIR, '02-catalog-6-cards.png'));

  // L1-3 (本丸): opencode の実インストール一周。既定 URL のまま（オーバーライドなし）。
  // ネットワーク経由の実ダウンロードのため長めのタイムアウトを取る。
  await clickOpencodeCli(cdp);
  const opencodeFlow = await waitFor(
    () => rightPanelFlowState(cdp),
    state => state.present && (state.state === 'complete' || state.state === 'failed'),
    240000
  );
  record('opencode-real-install-flow', opencodeFlow);
  if (!opencodeFlow.present || opencodeFlow.state !== 'complete') {
    fail('opencode real install lap did not reach complete', opencodeFlow);
  }
  const opencodeTabs = await terminalTabTitles(cdp);
  record('opencode-terminal-tabs', { opencodeTabs });
  if (!opencodeTabs.some(t => t.includes('opencode'))) fail('no terminal tab titled with opencode found after real install', { opencodeTabs });
  await sleep(1500);
  await screenshot(cdp, path.join(EVIDENCE_DIR, '03-opencode-real-install-pty.png'));

  // L1-4 前半: copilot / cursor / antigravity の未導入 + インストール失敗 → 手動コマンド案内。
  const missingCases = [
    { name: 'copilot', click: clickCopilotCli, expectSubstring: 'npm install -g @github/copilot', shot: '04-copilot-install-failed-guidance.png' },
    { name: 'cursor', click: clickCursorCli, expectSubstring: 'curl https://cursor.com/install -fsS | bash', shot: '05-cursor-install-failed-guidance.png' },
    { name: 'antigravity', click: clickAntigravityCli, expectSubstring: 'curl -fsSL https://antigravity.google/cli/install.sh | bash', shot: '06-antigravity-install-failed-guidance.png' }
  ];
  for (const { name, click, expectSubstring, shot } of missingCases) {
    const errBefore = await errorCount(cdp);
    await click(cdp);
    const flow = await waitFor(
      () => rightPanelFlowState(cdp),
      state => state.present && state.state === 'failed',
      20000
    );
    record(`${name}-missing-flow`, flow);
    if (!flow.present || flow.state !== 'failed') fail(`${name} setup did not reach a failed state with guidance`, flow);
    if (!flow.text.includes(expectSubstring)) {
      fail(`${name} failure guidance does not include the manual install command`, { flow, expectSubstring });
    }
    const errAfter = await errorCount(cdp);
    record(`${name}-missing-error-delta`, { before: errBefore, after: errAfter });
    await screenshot(cdp, path.join(EVIDENCE_DIR, shot));
  }

  const stillResponsive = await evalMain(cdp, '1 + 1').then(v => v === 2).catch(() => false);
  record('app-still-responsive-after-failures', { ok: stillResponsive });
  if (!stillResponsive) fail('app did not respond to a trivial eval after the missing-agent failures', {});

  // L1-5: 回帰。claude CLI ボタン → working 遷移。
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
  await screenshot(cdp, path.join(EVIDENCE_DIR, '07-claude-connect-regression.png'));

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
