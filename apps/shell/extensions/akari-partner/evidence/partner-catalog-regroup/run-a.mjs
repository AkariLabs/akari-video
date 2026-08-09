// Run A: カタログ画面のカード構造（L1 受け入れ 1）+ opencode 未導入時の案内（L1 受け入れ 2）+
// claude 回帰スモーク（L1 受け入れ 4）。opencode 実行ファイルは実行機にインストールされていない
// （`which opencode` 実測で確認済み）ため、この起動はそのまま「PATH に無い隔離環境」になる。
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { connectMain, screenshot } from './cdp-lib.mjs';
import {
  installErrorCounter, errorCount, errorLog,
  revealPartnerCatalog, catalogGroups,
  clickOpencodeSetup, clickClaudeCliSetup,
  rightPanelFlowState, waitFor
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

  const revealed = await revealPartnerCatalog(cdp);
  record('catalog-revealed', revealed);

  // L1 受け入れ 1: エージェント単位 3 カード、Claude/Codex は左CLI/右拡張の2分割、
  // opencode は CLI 全幅表示。
  const groups = await catalogGroups(cdp);
  record('catalog-groups', { groups });
  if (groups.length !== 3) fail('expected exactly 3 agent cards', { groups });
  const [claudeGroup, codexGroup, opencodeGroup] = groups;
  if (claudeGroup.agent !== 'claude') fail('first card is not claude (array order not preserved)', { groups });
  if (codexGroup.agent !== 'codex') fail('second card is not codex (array order not preserved)', { groups });
  if (opencodeGroup.agent !== 'opencode') fail('third card is not opencode (array order not preserved)', { groups });

  if (claudeGroup.slots.length !== 2 || !claudeGroup.slots.some(s => s.id === 'anthropic/claude-code-cli') || !claudeGroup.slots.some(s => s.id === 'anthropic/claude-code-extension')) {
    fail('claude card does not have both cli and extension slots', { claudeGroup });
  }
  if (codexGroup.slots.length !== 2 || !codexGroup.slots.some(s => s.id === 'openai/codex-cli') || !codexGroup.slots.some(s => s.id === 'openai/codex-extension')) {
    fail('codex card does not have both cli and extension slots', { codexGroup });
  }
  if (opencodeGroup.slots.length !== 1 || opencodeGroup.slots[0].id !== 'sst/opencode-cli') {
    fail('opencode card does not have exactly one (cli) slot', { opencodeGroup });
  }
  // 全幅判定: opencode の単一スロット幅が、claude/codex の各スロット幅（2分割の一方）より
  // 明確に広い（≈2倍）ことを実測で確認する。
  const claudeSlotWidth = claudeGroup.slots[0].width;
  const opencodeSlotWidth = opencodeGroup.slots[0].width;
  record('width-comparison', { claudeSlotWidth, opencodeSlotWidth, ratio: opencodeSlotWidth / claudeSlotWidth });
  if (!(opencodeSlotWidth > claudeSlotWidth * 1.6)) {
    fail('opencode single slot is not rendered full-width relative to a split slot', { claudeSlotWidth, opencodeSlotWidth });
  }
  if (!claudeGroup.hasBadge) fail('claude card should show the recommended badge (claude-code-cli has recommended: true)', { claudeGroup });
  if (codexGroup.hasBadge) fail('codex card should NOT show the recommended badge', { codexGroup });
  if (opencodeGroup.hasBadge) fail('opencode card should NOT show the recommended badge', { opencodeGroup });

  await screenshot(cdp, path.join(EVIDENCE_DIR, '01-catalog-grouped-cards.png'));

  // L1 受け入れ 2: opencode が PATH に無い状態でセットアップを押す → 導入コマンド入りの案内、
  // アプリは壊れない。
  const errBeforeOpencode = await errorCount(cdp);
  await clickOpencodeSetup(cdp);
  const opencodeFlow = await waitFor(
    () => rightPanelFlowState(cdp),
    state => state.present && state.state === 'failed',
    15000
  );
  record('opencode-missing-flow', opencodeFlow);
  if (!opencodeFlow.present || opencodeFlow.state !== 'failed') fail('opencode setup did not reach a failed state with guidance', opencodeFlow);
  if (!opencodeFlow.text.includes('npm install -g opencode-ai')) {
    fail('failure guidance does not include the confirmed npm install command (opencode-ai)', opencodeFlow);
  }
  const errAfterOpencode = await errorCount(cdp);
  record('opencode-missing-error-delta', { before: errBeforeOpencode, after: errAfterOpencode });
  await screenshot(cdp, path.join(EVIDENCE_DIR, '02-opencode-missing-guidance.png'));

  // アプリがまだ生きている（壊れていない）ことの直接確認。
  const stillResponsive = await evalMain_probe(cdp);
  record('app-still-responsive-after-opencode-failure', stillResponsive);
  if (!stillResponsive.ok) fail('app did not respond to a trivial eval after the opencode failure', stillResponsive);

  // L1 受け入れ 4: claude の [接続] がカタログから従来どおり開始できる（接続フローが
  // 正常に進み、右パネルが working またはターミナル起動へ進む。実ログインの完了は不要）。
  await clickClaudeCliSetup(cdp);
  const claudeFlow = await waitFor(
    () => rightPanelFlowState(cdp),
    state => state.present && (state.state === 'working' || state.state === 'complete'),
    30000
  );
  record('claude-regression-flow', claudeFlow);
  if (!claudeFlow.present || claudeFlow.state === 'failed' || claudeFlow.state === 'idle') {
    fail('claude connect regression did not progress (working/complete expected)', claudeFlow);
  }
  await screenshot(cdp, path.join(EVIDENCE_DIR, '03-claude-connect-regression.png'));

  const finalErrCount = await errorCount(cdp);
  const finalErrLog = await errorLog(cdp);
  record('console-error-summary', { count: finalErrCount, sample: finalErrLog.slice(0, 10) });

  await writeFile(path.join(EVIDENCE_DIR, 'run-a-log.json'), JSON.stringify(log, null, 2));
  console.log('RUN_A_OK');
  cdp.close();
}

async function evalMain_probe(cdp) {
  try {
    const { evalMain } = await import('./cdp-lib.mjs');
    const value = await evalMain(cdp, '1 + 1');
    return { ok: value === 2 };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

main().then(() => process.exit(0)).catch(error => {
  console.error('RUN_A_FAILED', error);
  process.exit(1);
});
