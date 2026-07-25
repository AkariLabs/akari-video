// materials-tab-hardening L1 phase5 (回帰): ドロップ取り込み・lint バッジ・カタログタブ・
// 「エージェントに頼む」が無退行であることを実測する。
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { connectMain, evalMain, realClick, screenshot, ensureDeveloperModeOff } from './cdp-lib.mjs';

const [, , cdpPortArg, evidenceDirArg, workspaceDirArg] = process.argv;
const CDP_PORT = Number(cdpPortArg);
const EVIDENCE_DIR = evidenceDirArg;
const WORKSPACE_DIR = workspaceDirArg;

const log = [];
function record(step, data) { const e = { t: new Date().toISOString(), step, ...data }; log.push(e); console.log(`[${step}]`, JSON.stringify(data)); }
function fail(message, data) { record('FAIL:' + message, data || {}); throw new Error(message); }

async function clickRoleBucketsTab(cdp, label) {
  const state = await evalMain(cdp, `(() => {
    const tablist = Array.from(document.querySelectorAll('[role="tablist"]'))
      .find(list => Array.from(list.querySelectorAll('[role="tab"]')).some(t => t.textContent.trim() === 'カタログ'));
    if (!tablist) return { found: false };
    const el = Array.from(tablist.querySelectorAll('[role="tab"]')).find(t => t.textContent.trim() === ${JSON.stringify(label)});
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!state.found) fail('role-buckets tab not found', { label, state });
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
    if (predicate(last)) return last;
    await sleep(300);
  }
  return last;
}

async function toastMessages(cdp) {
  return evalMain(cdp, `Array.from(document.querySelectorAll('.theia-notification-message')).map(n => n.textContent.trim())`);
}

async function main() {
  const cdp = await connectMain(CDP_PORT);
  record('connected-main', {});
  await sleep(500);
  const devMode = await ensureDeveloperModeOff(cdp);
  record('developer-mode-forced-off', devMode);
  await clickRoleBucketsTab(cdp, '素材');
  await sleep(500);

  // === 回帰1: ドロップ取り込み（classifyDropped の text/uri-list フォールバック経路を実 DOM drop で駆動） ===
  // transfer.files は script から real FileList を構築できないため、既存実装が持つ
  // フォールバック分岐（transfer.getData('text/uri-list')）を実際の DragEvent 経由で駆動する。
  const beforeDrop = await materialCards(cdp);
  record('before-drop', { count: beforeDrop.length });
  const dropSourcePath = path.join(WORKSPACE_DIR, '..', 'drop-source-regression-clip.mp4');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  await execFileAsync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=1', '-pix_fmt', 'yuv420p', dropSourcePath]);
  const dropResult = await evalMain(cdp, `(() => {
    const zone = document.querySelector('[data-akari-dropzone]');
    if (!zone) return { found: false };
    const dt = new DataTransfer();
    dt.setData('text/uri-list', ${JSON.stringify('file://' + dropSourcePath)});
    const event = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
    zone.dispatchEvent(event);
    return { found: true };
  })()`);
  record('synthetic-drop-dispatched', dropResult);
  if (!dropResult.found) fail('materials dropzone not found for regression drop test', dropResult);
  const afterDrop = await waitForCards(cdp, cards => cards.length > beforeDrop.length, 8000);
  record('after-drop', { afterDrop });
  if (afterDrop.length <= beforeDrop.length || !afterDrop.some(p => p.startsWith('assets/') && p.includes('drop-source-regression-clip'))) {
    fail('drop import regressed (no new assets/ card appeared after synthetic drop)', { beforeDrop, afterDrop });
  }
  await screenshot(cdp, path.join(EVIDENCE_DIR, '13-drop-import-regression.png'));
  record('regression-drop-import-PASS', { ok: true });

  // === 回帰2: lint バッジ（edit.json 実在 → available=true でバッジ表示） ===
  const lintBadge = await evalMain(cdp, `(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Lint'));
    return btn ? btn.textContent.trim() : null;
  })()`);
  record('lint-badge-text', { lintBadge });
  if (!lintBadge) {
    fail('lint badge did not render even though edit.json exists at project root', { lintBadge });
  }
  await screenshot(cdp, path.join(EVIDENCE_DIR, '14-lint-badge-regression.png'));
  record('regression-lint-badge-PASS', { ok: true, lintBadge });

  // === 回帰3: カタログタブ（開発配置フォールバックで実 catalog/ を検出） ===
  await clickRoleBucketsTab(cdp, 'カタログ');
  await sleep(1500);
  const catalogCounts = await evalMain(cdp, `(() => {
    const el = document.querySelector('[data-akari-catalog-item-count]');
    return el ? { itemCount: Number(el.getAttribute('data-akari-catalog-item-count')), missingCount: Number(el.getAttribute('data-akari-catalog-missing-count')) } : null;
  })()`);
  record('catalog-tab-counts', catalogCounts);
  if (!catalogCounts || !(catalogCounts.itemCount > 0)) {
    fail('catalog tab regressed (no items resolved via dev-layout fallback)', catalogCounts);
  }
  await screenshot(cdp, path.join(EVIDENCE_DIR, '15-catalog-tab-regression.png'));
  record('regression-catalog-tab-PASS', { ok: true, catalogCounts });

  // === 回帰4: 「エージェントに頼む」（未接続時の実トースト文言が維持されているか） ===
  await clickRoleBucketsTab(cdp, '素材');
  await sleep(500);
  const toastsBefore = (await toastMessages(cdp)).length;
  const askButton = await evalMain(cdp, `(() => {
    const card = document.querySelector('[data-akari-material-path]');
    if (!card) return { found: false };
    const btn = card.querySelector('button[aria-label*="エージェントに頼む"]');
    if (!btn) return { found: false };
    const r = btn.getBoundingClientRect();
    return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!askButton.found) fail('ask-agent button not found on a material card', askButton);
  await realClick(cdp, askButton.x, askButton.y);
  await sleep(400);
  // quick-input が開くので、依頼文を入力して確定する（askAgent は入力後に INJECT_PROMPT を呼ぶ）。
  const qiVisible = await evalMain(cdp, `(() => {
    const w = document.querySelector('.quick-input-widget');
    return !!w && getComputedStyle(w).display !== 'none';
  })()`);
  record('ask-agent-quick-input-opened', { qiVisible });
  if (!qiVisible) fail('ask-agent quick input did not open', { qiVisible });
  await cdp.send('Input.insertText', { text: '内容を確認したい' });
  await sleep(200);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 13, key: 'Enter' });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, key: 'Enter' });
  await sleep(600);
  const toastsAfter = await toastMessages(cdp);
  record('ask-agent-toast-after', { toastsBefore, toastsAfter });
  const expectedToast = 'パートナー未接続。ホームの「パートナーに接続する」から接続してください';
  if (toastsAfter.length <= toastsBefore || !toastsAfter.includes(expectedToast)) {
    fail('ask-agent not-connected toast regressed', { toastsBefore, toastsAfter, expectedToast });
  }
  await screenshot(cdp, path.join(EVIDENCE_DIR, '16-ask-agent-regression.png'));
  record('regression-ask-agent-PASS', { ok: true });

  await writeFile(path.join(EVIDENCE_DIR, 'run-log-phase5.json'), JSON.stringify(log, null, 2));
  console.log('SUCCESS: phase5 (regression) checks passed.');
  cdp.close();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('FAILED', err);
  await writeFile(path.join(EVIDENCE_DIR, 'run-log-phase5-FAILED.json'), JSON.stringify(log, null, 2)).catch(() => {});
  process.exit(1);
});
