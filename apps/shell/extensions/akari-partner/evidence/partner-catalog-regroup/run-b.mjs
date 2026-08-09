// Run B: opencode 実行ファイルが PATH にある状態でセットアップを押すと PTY タブが開き
// opencode が起動する（L1 受け入れ 3）。実物の opencode はこの実行機に無いため
// （`which opencode` 実測で確認済み）、task.md の指示どおり `#!/bin/sh` + `echo` の
// ダミー実行ファイルで代替する（未確認事項として report.md に明記）。
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { connectMain, screenshot } from './cdp-lib.mjs';
import {
  installErrorCounter, errorCount, errorLog,
  revealPartnerCatalog, clickOpencodeSetup,
  rightPanelFlowState, terminalTabTitles, waitFor
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

  await revealPartnerCatalog(cdp);
  await clickOpencodeSetup(cdp);

  const flow = await waitFor(
    () => rightPanelFlowState(cdp),
    state => state.present && (state.state === 'complete' || state.state === 'failed'),
    20000
  );
  record('opencode-present-flow', flow);
  if (!flow.present || flow.state !== 'complete') {
    fail('opencode setup with a PATH-resolvable dummy executable did not reach complete', flow);
  }

  const tabs = await terminalTabTitles(cdp);
  record('terminal-tab-titles', { tabs });
  if (!tabs.some(t => t.includes('opencode'))) fail('no terminal tab titled with opencode found', { tabs });

  // このバージョンの xterm.js はキャンバス描画（DOM 行テキストが無い — `.xterm-rows` は
  // 実測で 0 件、`xterm-screen` は <canvas> 実装）のため、PTY 出力の実測はテキスト抽出
  // ではなくスクリーンショットの目視で行う（本リポの L1 慣行どおり）。
  await sleep(1500);
  await screenshot(cdp, path.join(EVIDENCE_DIR, '04-opencode-dummy-pty.png'));
  record('terminal-screenshot-note', { note: 'xterm.js renders via canvas in this version; PTY output verified visually in 04-opencode-dummy-pty.png, not via DOM text scraping' });

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
