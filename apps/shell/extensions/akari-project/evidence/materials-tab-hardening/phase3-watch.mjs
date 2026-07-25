// materials-tab-hardening L1 phase3: ライブ反映（assets/ とプロジェクトルート直下の watch）
// 外部プロセス（別 Bash）で追加・削除し、タブを開き直さずカード一覧が自動更新されるかを実測する。
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { connectMain, evalMain, realClick, screenshot } from './cdp-lib.mjs';

const execFileAsync = promisify(execFile);

const [, , cdpPortArg, evidenceDirArg, workspaceDirArg] = process.argv;
const CDP_PORT = Number(cdpPortArg);
const EVIDENCE_DIR = evidenceDirArg;
const WORKSPACE_DIR = workspaceDirArg;

const log = [];
function record(step, data) { const e = { t: new Date().toISOString(), step, ...data }; log.push(e); console.log(`[${step}]`, JSON.stringify(data)); }
function fail(message, data) { record('FAIL:' + message, data || {}); throw new Error(message); }

async function clickRoleBucketsTab(cdp) {
  const state = await evalMain(cdp, `(() => {
    const tablist = Array.from(document.querySelectorAll('[role="tablist"]'))
      .find(list => Array.from(list.querySelectorAll('[role="tab"]')).some(t => t.textContent.trim() === 'カタログ'));
    if (!tablist) return { found: false };
    const el = Array.from(tablist.querySelectorAll('[role="tab"]')).find(t => t.textContent.trim() === '素材');
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!state.found) fail('materials tab not found', state);
  await realClick(cdp, state.x, state.y);
  await sleep(500);
}

async function materialCards(cdp) {
  return evalMain(cdp, `Array.from(document.querySelectorAll('[data-akari-material-path]')).map(el => el.getAttribute('data-akari-material-path'))`);
}

async function waitForCards(cdp, predicate, timeoutMs) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    last = await materialCards(cdp);
    if (predicate(last)) return { cards: last, elapsedMs: Date.now() - started };
    await sleep(200);
  }
  return { cards: last, elapsedMs: Date.now() - started, timedOut: true };
}

async function main() {
  const cdp = await connectMain(CDP_PORT);
  record('connected-main', {});
  await sleep(500);
  await clickRoleBucketsTab(cdp);

  const before = await materialCards(cdp);
  record('before-watch-additions', { before });
  await screenshot(cdp, path.join(EVIDENCE_DIR, '07-watch-before.png'));

  // === assets/ への外部追加（このスクリプト自身とは別プロセス想定で node fs を直接使用） ===
  const addedAssetName = 'watch-added-clip.mp4';
  await execFileAsync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=1', '-pix_fmt', 'yuv420p', path.join(WORKSPACE_DIR, 'assets', addedAssetName)]);
  record('external-process-added-asset-file', { addedAssetName });
  const afterAssetAdd = await waitForCards(cdp, cards => cards.includes(`assets/${addedAssetName}`), 8000);
  record('watch-asset-added-detected', afterAssetAdd);
  if (afterAssetAdd.timedOut) {
    fail('assets/ addition was not reflected without reopening the tab', afterAssetAdd);
  }
  await screenshot(cdp, path.join(EVIDENCE_DIR, '08-watch-asset-added.png'));
  record('L1-3-watch-asset-add-PASS', { ok: true, elapsedMs: afterAssetAdd.elapsedMs });

  // === assets/ からの外部削除 ===
  await rm(path.join(WORKSPACE_DIR, 'assets', addedAssetName));
  record('external-process-deleted-asset-file', { addedAssetName });
  const afterAssetDelete = await waitForCards(cdp, cards => !cards.includes(`assets/${addedAssetName}`), 8000);
  record('watch-asset-deleted-detected', afterAssetDelete);
  if (afterAssetDelete.timedOut) {
    fail('assets/ deletion was not reflected without reopening the tab', afterAssetDelete);
  }
  await screenshot(cdp, path.join(EVIDENCE_DIR, '09-watch-asset-deleted.png'));
  record('L1-3-watch-asset-delete-PASS', { ok: true, elapsedMs: afterAssetDelete.elapsedMs });

  // === プロジェクトルート直下への外部追加（未整理として即出現するか） ===
  const addedRootName = 'watch-added-root.png';
  await execFileAsync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=yellow:size=320x180:duration=1', '-frames:v', '1', path.join(WORKSPACE_DIR, addedRootName)]);
  record('external-process-added-root-file', { addedRootName });
  const afterRootAdd = await waitForCards(cdp, cards => cards.includes(addedRootName), 8000);
  record('watch-root-added-detected', afterRootAdd);
  if (afterRootAdd.timedOut) {
    fail('project-root addition was not reflected without reopening the tab', afterRootAdd);
  }
  await screenshot(cdp, path.join(EVIDENCE_DIR, '10-watch-root-added.png'));
  record('L1-3-watch-root-add-PASS', { ok: true, elapsedMs: afterRootAdd.elapsedMs });

  // === プロジェクトルート直下からの外部削除 ===
  await rm(path.join(WORKSPACE_DIR, addedRootName));
  record('external-process-deleted-root-file', { addedRootName });
  const afterRootDelete = await waitForCards(cdp, cards => !cards.includes(addedRootName), 8000);
  record('watch-root-deleted-detected', afterRootDelete);
  if (afterRootDelete.timedOut) {
    fail('project-root deletion was not reflected without reopening the tab', afterRootDelete);
  }
  await screenshot(cdp, path.join(EVIDENCE_DIR, '11-watch-root-deleted.png'));
  record('L1-3-watch-root-delete-PASS', { ok: true, elapsedMs: afterRootDelete.elapsedMs });

  await writeFile(path.join(EVIDENCE_DIR, 'run-log-phase3.json'), JSON.stringify(log, null, 2));
  console.log('SUCCESS: phase3 checks passed.');
  cdp.close();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('FAILED', err);
  await writeFile(path.join(EVIDENCE_DIR, 'run-log-phase3-FAILED.json'), JSON.stringify(log, null, 2)).catch(() => {});
  process.exit(1);
});
