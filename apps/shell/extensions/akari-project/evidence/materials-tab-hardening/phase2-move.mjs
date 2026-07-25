// materials-tab-hardening L1 phase2: 「assets へ移動」— 警告ダイアログ + 承諾/拒否 + 同名衝突回避
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

async function errorCount(cdp) { return evalMain(cdp, 'window.__errCount'); }

async function clickRoleBucketsTab(cdp, label) {
  const state = await evalMain(cdp, `(() => {
    const tablist = Array.from(document.querySelectorAll('[role="tablist"]'))
      .find(list => Array.from(list.querySelectorAll('[role="tab"]')).some(t => t.textContent.trim() === 'カタログ'));
    if (!tablist) return { found: false, reason: 'tablist-not-found' };
    const el = Array.from(tablist.querySelectorAll('[role="tab"]')).find(t => t.textContent.trim() === ${JSON.stringify('素材')});
    if (!el) return { found: false, reason: 'tab-not-found' };
    const r = el.getBoundingClientRect();
    return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!state.found) fail('role-buckets tab button not found', { label, state });
  await realClick(cdp, state.x, state.y);
  await sleep(500);
}

async function materialCards(cdp) {
  return evalMain(cdp, `Array.from(document.querySelectorAll('[data-akari-material-path]')).map(el => ({
    path: el.getAttribute('data-akari-material-path'),
    unorganized: el.getAttribute('data-akari-material-unorganized') === 'true'
  }))`);
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

async function clickMoveButton(cdp, relativePath) {
  const state = await evalMain(cdp, `(() => {
    const card = document.querySelector('[data-akari-material-path=${JSON.stringify(relativePath)}]');
    if (!card) return { found: false, reason: 'card-not-found' };
    const btn = Array.from(card.querySelectorAll('button')).find(b => b.textContent.trim() === 'assets へ移動');
    if (!btn) return { found: false, reason: 'button-not-found' };
    card.scrollIntoView({ block: 'center' });
    const r = btn.getBoundingClientRect();
    return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!state.found) fail('assets-move button not found', { relativePath, state });
  await sleep(200);
  await realClick(cdp, state.x, state.y);
  await sleep(500);
}

async function waitForDialog(cdp, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const state = await evalMain(cdp, `(() => {
      const block = document.querySelector('.dialogBlock');
      if (!block) return { visible: false };
      const r = block.getBoundingClientRect();
      return {
        visible: r.width > 0,
        title: block.querySelector('.dialogTitle')?.textContent?.trim(),
        message: block.querySelector('.dialogContent')?.textContent?.trim()
      };
    })()`);
    if (state.visible) return state;
    await sleep(200);
  }
  return { visible: false };
}

async function clickDialogButton(cdp, label) {
  const state = await evalMain(cdp, `(() => {
    const block = document.querySelector('.dialogBlock');
    if (!block) return { found: false };
    const btn = Array.from(block.querySelectorAll('.dialogControl button')).find(b => b.textContent.trim() === ${JSON.stringify(label)});
    if (!btn) return { found: false };
    const r = btn.getBoundingClientRect();
    return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!state.found) fail('dialog button not found', { label, state });
  await realClick(cdp, state.x, state.y);
  await sleep(600);
}

async function main() {
  const cdp = await connectMain(CDP_PORT);
  record('connected-main', {});
  await sleep(500);
  await clickRoleBucketsTab(cdp, '素材');

  // === 拒否 → 何も起きない (narration.wav) ===
  const errBefore = await errorCount(cdp);
  await clickMoveButton(cdp, 'narration.wav');
  const cancelDialog = await waitForDialog(cdp, 5000);
  record('cancel-dialog-shown', cancelDialog);
  if (!cancelDialog.visible || !cancelDialog.message?.includes('narration.wav') || !cancelDialog.message?.includes('edit.json')) {
    fail('warning dialog did not show expected content for narration.wav', cancelDialog);
  }
  await screenshot(cdp, path.join(EVIDENCE_DIR, '03-move-warning-dialog.png'));
  await clickDialogButton(cdp, 'キャンセル');
  await sleep(500);
  const afterCancelCards = await materialCards(cdp);
  const narrationStillUnorganized = afterCancelCards.some(c => c.path === 'narration.wav' && c.unorganized);
  record('cancel-no-op', { narrationStillUnorganized });
  if (!narrationStillUnorganized) {
    fail('narration.wav card disappeared from unorganized section after cancel (expected no-op)', afterCancelCards);
  }
  const errAfterCancel = await errorCount(cdp);
  record('L1-2-cancel-PASS', { ok: true, errBefore, errAfterCancel });
  await screenshot(cdp, path.join(EVIDENCE_DIR, '04-cancel-no-op.png'));

  // === 承諾（衝突なし）: frame-01.png → assets/frame-01.png ===
  await clickMoveButton(cdp, 'frame-01.png');
  const moveDialog = await waitForDialog(cdp, 5000);
  record('move-dialog-shown-no-collision', moveDialog);
  if (!moveDialog.visible) fail('warning dialog did not appear for frame-01.png', moveDialog);
  await clickDialogButton(cdp, '移動する');
  const afterMoveNoCollision = await waitForCards(cdp, cards => cards.some(c => c.path === 'assets/frame-01.png'), 8000);
  record('move-no-collision-result', { afterMoveNoCollision });
  const movedNoCollision = afterMoveNoCollision.find(c => c.path === 'assets/frame-01.png');
  const rootFrameGone = !afterMoveNoCollision.some(c => c.path === 'frame-01.png');
  if (!movedNoCollision || movedNoCollision.unorganized || !rootFrameGone) {
    fail('frame-01.png did not move into assets/ (no-collision case)', { afterMoveNoCollision });
  }
  record('L1-2-move-no-collision-PASS', { ok: true });
  await screenshot(cdp, path.join(EVIDENCE_DIR, '05-move-no-collision-done.png'));

  // === 承諾（同名衝突）: clip.mp4（ルート） → assets/ に既に clip.mp4 が存在 → clip-2.mp4 ===
  await clickMoveButton(cdp, 'clip.mp4');
  const collisionDialog = await waitForDialog(cdp, 5000);
  record('move-dialog-shown-collision', collisionDialog);
  if (!collisionDialog.visible) fail('warning dialog did not appear for clip.mp4 (collision case)', collisionDialog);
  await clickDialogButton(cdp, '移動する');
  const afterMoveCollision = await waitForCards(cdp, cards => cards.some(c => c.path === 'assets/clip-2.mp4'), 8000);
  record('move-collision-result', { afterMoveCollision });
  const movedWithCollision = afterMoveCollision.find(c => c.path === 'assets/clip-2.mp4');
  const originalAssetClipStillThere = afterMoveCollision.some(c => c.path === 'assets/clip.mp4');
  const rootClipGone = !afterMoveCollision.some(c => c.path === 'clip.mp4');
  if (!movedWithCollision || !originalAssetClipStillThere || !rootClipGone) {
    fail('clip.mp4 collision-avoidance move did not produce the expected assets/clip-2.mp4 + preserved assets/clip.mp4', { afterMoveCollision });
  }
  record('L1-2-move-collision-numbering-PASS', { ok: true });
  await screenshot(cdp, path.join(EVIDENCE_DIR, '06-move-collision-numbered.png'));

  const finalErr = await errorCount(cdp);
  record('phase2-final-error-count', { finalErr });

  await writeFile(path.join(EVIDENCE_DIR, 'run-log-phase2.json'), JSON.stringify(log, null, 2));
  console.log('SUCCESS: phase2 checks passed.');
  cdp.close();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('FAILED', err);
  await writeFile(path.join(EVIDENCE_DIR, 'run-log-phase2-FAILED.json'), JSON.stringify(log, null, 2)).catch(() => {});
  process.exit(1);
});
