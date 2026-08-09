// Run B: copilot / cursor / antigravity の実行ファイルが PATH にある状態でセットアップを
// 押すと detection-first（F46）で検出され、実インストールを走らせずに PTY タブが開くことを
// 確認する（task.md L1-4「ダミー実行ファイルによる検出→PTY起動」）。実物の copilot/cursor-agent/
// agy はこの実行機に無い（`ls ~/.local/bin` で確認済み）ため、`#!/bin/sh` + `echo` のダミー
// 実行ファイルで代替する（partner-catalog-regroup の opencode ダミー PTY テストと同じ手法）。
// このプロセスを起動した親シェルが PATH の先頭にダミー bin ディレクトリを追加してから
// Electron を起動している前提。
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { connectMain, screenshot } from './cdp-lib.mjs';
import {
  installErrorCounter, errorCount, errorLog,
  rightPanelFlowState, rightPanelRows,
  clickCopilotCli, clickCursorCli, clickAntigravityCli,
  terminalTabTitles, waitFor
} from './widget-lib.mjs';

const [, , cdpPortArg, evidenceDirArg] = process.argv;
const CDP_PORT = Number(cdpPortArg);
const EVIDENCE_DIR = evidenceDirArg;

const log = [];
function record(step, data) { const e = { t: new Date().toISOString(), step, ...data }; log.push(e); console.log(`[${step}]`, JSON.stringify(data)); }
function fail(message, data) { record('FAIL:' + message, data || {}); throw new Error(message); }

const cases = [
  { name: 'copilot', click: clickCopilotCli, tabSubstring: 'Copilot', shot: '08-copilot-dummy-pty.png' },
  { name: 'cursor', click: clickCursorCli, tabSubstring: 'Cursor', shot: '09-cursor-dummy-pty.png' },
  { name: 'antigravity', click: clickAntigravityCli, tabSubstring: 'Antigravity', shot: '10-antigravity-dummy-pty.png' }
];

async function main() {
  const cdp = await connectMain(CDP_PORT);
  await installErrorCounter(cdp);

  // 冷起動対策（partner-ui-r2 の申し送り: 本番ビルド後の初回起動はフロントエンド初期化に
  // 45秒以上かかることがある）。行が安定して現れるまで待ってから操作を始める。
  const rows = await waitFor(() => rightPanelRows(cdp), r => r.length === 6, 90000);
  record('right-panel-rows-ready', { rowCount: rows.length });
  if (rows.length !== 6) fail('add-partner panel did not become ready with 6 rows before Run B interactions', { rows });

  for (const { name, click, tabSubstring, shot } of cases) {
    await click(cdp);
    const flow = await waitFor(
      () => rightPanelFlowState(cdp),
      state => state.present && (state.state === 'complete' || state.state === 'failed'),
      20000
    );
    record(`${name}-dummy-flow`, flow);
    if (!flow.present || flow.state !== 'complete') {
      fail(`${name} setup with a PATH-resolvable dummy executable did not reach complete`, flow);
    }
    const tabs = await terminalTabTitles(cdp);
    record(`${name}-terminal-tabs`, { tabs });
    if (!tabs.some(t => t.includes(tabSubstring))) fail(`no terminal tab titled with ${tabSubstring} found`, { tabs });
    await sleep(1200);
    await screenshot(cdp, path.join(EVIDENCE_DIR, shot));
  }

  const finalErrCount = await errorCount(cdp);
  const finalErrLog = await errorLog(cdp);
  record('console-error-summary', { count: finalErrCount, sample: finalErrLog.slice(0, 10) });

  await writeFile(path.join(EVIDENCE_DIR, 'run-b-log.json'), JSON.stringify(log, null, 2));
  console.log('RUN_B_OK');
  cdp.close();
}

main().then(() => process.exit(0)).catch(error => {
  console.error('RUN_B_FAILED', error);
  process.exit(1);
});
