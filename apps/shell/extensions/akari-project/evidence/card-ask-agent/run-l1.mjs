// card-ask-agent L1 実機検証ドライバ。cdp-lib.mjs は left-panel-domain-browser
// (35bbc88) の同名ファイルをコピーした共有ヘルパー（様式を踏襲、中身は無改変）。
//
// TEST 1・2（パートナー端末セッション在り）だけは、実 claude/codex CLI のネット
// ワーク越しブートストラップを避けるため、AkariPartnerWidget.attachTerminal() を
// ダミー CLI シェルスクリプトで直接呼ぶ（partner-pane 検証 [apps/shell/evidence/
// partner-pane/README.md] と同じ代替手法・task.md 許容範囲）。そのために検証時のみ
// 一時デバッグフック `globalThis.__akariPartnerWidgetDebug = this` を
// AkariPartnerWidget.init() に追加している。証跡取得後に完全に削除してから最終
// コミットする（git diff で確認する）。
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  connectMain, evalMain, screenshot, waitForDropzone,
  toggleDeveloperModeViaSettings, realClick
} from './cdp-lib.mjs';

const [, , cdpPortArg, evidenceDirArg, workspaceDirArg, dropSourcesDirArg, dummyCliArg] = process.argv;
const CDP_PORT = Number(cdpPortArg);
const EVIDENCE_DIR = evidenceDirArg;
const WORKSPACE_DIR = workspaceDirArg;
const DROP_SOURCES_DIR = dropSourcesDirArg;
const DUMMY_CLI = dummyCliArg;

const log = [];
function record(step, data) { const e = { t: new Date().toISOString(), step, ...data }; log.push(e); console.log(`[${step}]`, JSON.stringify(data)); }
function fail(message, data) { record('FAIL:' + message, data || {}); throw new Error(message); }

async function findAndClickActivityIcon(cdp) {
  const state = await evalMain(cdp, `(() => {
    const el = Array.from(document.querySelectorAll('.codicon-files')).find(e => e.getBoundingClientRect().width > 0);
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (state.found) { await realClick(cdp, state.x, state.y); await sleep(500); }
  return state;
}

async function readTerminalBuffer(cdp) {
  return evalMain(cdp, `(() => {
    const widget = window.__akariPartnerWidgetDebug;
    if (!widget || !widget.terminal) return null;
    const buf = widget.terminal.term.buffer.active;
    let out = '';
    for (let i = 0; i < buf.length; i++) {
      const line = buf.getLine(i);
      if (!line) continue;
      const text = line.translateToString(true);
      out += line.isWrapped ? text : ('\\n' + text);
    }
    return out;
  })()`);
}

async function clickAskAgentButton(cdp, cardTitle) {
  const btn = await evalMain(cdp, `(() => {
    const el = document.querySelector('button[aria-label=${JSON.stringify(cardTitle + ' についてエージェントに頼む')}]');
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2, visible: r.width > 0 && r.height > 0 };
  })()`);
  if (!btn.found || !btn.visible) fail(`ask-agent button not found/visible for card ${cardTitle}`, btn);
  await realClick(cdp, btn.x, btn.y);
  await sleep(400);
}

// A stale (previously-opened, now display:none) quick-input DOM node can linger — check
// actual visibility, not mere presence, or a bogus prior-session node reads as "open".
async function isQuickInputOpen(cdp) {
  return evalMain(cdp, `(() => {
    const widget = document.querySelector('.quick-input-widget');
    const input = widget ? widget.querySelector('input') : null;
    const visible = !!widget && getComputedStyle(widget).display !== 'none';
    return { found: !!input && visible, placeholder: input ? input.placeholder : null };
  })()`);
}

async function submitQuickInput(cdp, text) {
  const qi = await isQuickInputOpen(cdp);
  if (!qi.found) fail('quick-input box did not open after clicking ask-agent button', qi);
  await cdp.send('Input.insertText', { text });
  await sleep(200);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 13, key: 'Enter' });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, key: 'Enter' });
  await sleep(900);
  return qi;
}

async function cancelQuickInput(cdp, text) {
  const qi = await isQuickInputOpen(cdp);
  if (!qi.found) fail('quick-input box did not open (cancel scenario)', qi);
  if (text) {
    await cdp.send('Input.insertText', { text });
    await sleep(150);
  }
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 27, key: 'Escape' });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 27, key: 'Escape' });
  await sleep(500);
}

async function toastMessages(cdp) {
  return evalMain(cdp, `Array.from(document.querySelectorAll('.theia-notification-message')).map(n => n.textContent.trim())`);
}

async function main() {
  const cdp = await connectMain(CDP_PORT);
  record('connected-main', {});
  await sleep(1500);
  await screenshot(cdp, path.join(EVIDENCE_DIR, '00-boot.png'));

  // --- reach the materials card widget (same adaptive logic as left-panel-domain-browser phase1) ---
  let dz = await waitForDropzone(cdp, 8000);
  if (!dz.found) {
    let explorerRows = 0;
    for (let attempt = 0; attempt < 8; attempt++) {
      explorerRows = await evalMain(cdp, `document.querySelectorAll('.theia-TreeNode').length`);
      if (explorerRows > 0) break;
      await sleep(500);
      dz = await waitForDropzone(cdp, 500);
      if (dz.found) break;
    }
    record('dropzone-not-immediately-visible', { explorerRows, dzFoundWhilePolling: dz.found });
    if (!dz.found) {
      if (explorerRows > 0) {
        await toggleDeveloperModeViaSettings(cdp);
      } else {
        await findAndClickActivityIcon(cdp);
      }
      dz = await waitForDropzone(cdp, 6000);
    }
  }
  if (!dz.found) fail('material dropzone widget never became visible', dz);
  record('dropzone-visible', dz);

  for (let attempt = 0; attempt < 15; attempt++) {
    const stillLoading = await evalMain(cdp, `(() => {
      const root = document.querySelector('[data-akari-dropzone]');
      return root ? root.textContent.includes('読み込み中') : true;
    })()`);
    if (!stillLoading) break;
    await sleep(400);
  }
  await screenshot(cdp, path.join(EVIDENCE_DIR, '01-materials-initial.png'));

  // --- regression: card display (thumbnail/duration/dot), unaffected by the added button ---
  const materialsState = await evalMain(cdp, `(() => {
    const root = document.querySelector('[data-akari-dropzone]');
    const cardEls = Array.from(root.querySelectorAll('div')).filter(d => d.title && d.title.endsWith('.mp4'));
    const details = cardEls.map(el => {
      const img = el.querySelector('img');
      const durationSpan = Array.from(el.querySelectorAll('span')).find(s => /^\\d+:\\d{2}$|^--:--$/.test(s.textContent.trim()));
      const dot = el.querySelector('span[title="分析済み"], span[title="未分析"]');
      const askBtn = el.querySelector('button[aria-label*="エージェントに頼む"]');
      return {
        title: el.title, hasImg: !!img,
        duration: durationSpan ? durationSpan.textContent.trim() : null,
        dotTitle: dot ? dot.getAttribute('title') : null,
        hasAskAgentButton: !!askBtn
      };
    });
    return { cardCount: cardEls.length, details };
  })()`);
  record('materials-state', materialsState);
  const analyzedCard = materialsState.details.find(d => d.title === 'analyzed-clip.mp4');
  const unanalyzedCard = materialsState.details.find(d => d.title === 'unanalyzed-clip.mp4');
  if (!analyzedCard || !analyzedCard.hasImg || analyzedCard.duration !== '0:06' || analyzedCard.dotTitle !== '分析済み' || !analyzedCard.hasAskAgentButton) {
    fail('analyzed-clip.mp4 card regressed (thumbnail/duration/dot/ask-agent button)', analyzedCard);
  }
  if (!unanalyzedCard || unanalyzedCard.hasImg || unanalyzedCard.duration !== '--:--' || unanalyzedCard.dotTitle !== '未分析' || !unanalyzedCard.hasAskAgentButton) {
    fail('unanalyzed-clip.mp4 card regressed (thumbnail/duration/dot/ask-agent button)', unanalyzedCard);
  }
  record('regression-card-display-confirmed', { ok: true });

  // --- regression: tab switching ---
  const clickTab = (label) => evalMain(cdp, `(() => {
    const root = document.querySelector('[data-akari-dropzone]');
    const btn = Array.from(root.querySelectorAll('[role="tab"]')).find(b => b.textContent.trim() === ${JSON.stringify(label)});
    if (!btn) return { found: false };
    btn.click();
    return { found: true };
  })()`);
  if (!(await clickTab('プラン')).found) fail('plan tab button not found', {});
  await sleep(200);
  if (!(await clickTab('カタログ')).found) fail('catalog tab button not found', {});
  await sleep(200);
  if (!(await clickTab('素材')).found) fail('materials tab button not found when switching back', {});
  await sleep(200);
  record('regression-tab-switch-confirmed', { ok: true });

  // --- regression: drop import (accepted + rejected) ---
  async function dispatchUriListDrop(absSourcePath) {
    const fileUrl = 'file://' + absSourcePath;
    return evalMain(cdp, `(() => {
      const root = document.querySelector('[data-akari-dropzone]');
      const dt = new DataTransfer();
      dt.setData('text/uri-list', ${JSON.stringify(fileUrl)});
      const event = new DragEvent('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: dt });
      root.dispatchEvent(event);
      return true;
    })()`);
  }
  await dispatchUriListDrop(path.join(DROP_SOURCES_DIR, 'drop-video.mp4'));
  await sleep(1200);
  const afterAcceptedDrop = await evalMain(cdp, `(() => {
    const root = document.querySelector('[data-akari-dropzone]');
    return Array.from(root.querySelectorAll('div')).filter(d => d.title && d.title.endsWith('.mp4')).map(e => e.title);
  })()`);
  record('regression-drop-accepted', { titles: afterAcceptedDrop });
  if (!afterAcceptedDrop.includes('drop-video.mp4')) fail('dropped supported file did not produce a material card', afterAcceptedDrop);

  await dispatchUriListDrop(path.join(DROP_SOURCES_DIR, 'drop-doc.txt'));
  await sleep(1000);
  const rejectToast = await toastMessages(cdp);
  record('regression-drop-rejected-toast', { rejectToast });
  if (!rejectToast.some(text => /対応していない|取り込めません/.test(text))) fail('no reject toast text found for unsupported drop', rejectToast);
  await screenshot(cdp, path.join(EVIDENCE_DIR, '02-drop-regression.png'));

  // --- regression: lint badge ---
  let lintText = null;
  for (let attempt = 0; attempt < 20 && !lintText; attempt++) {
    lintText = await evalMain(cdp, `(() => {
      const root = document.querySelector('[data-akari-dropzone]');
      const btn = root ? Array.from(root.querySelectorAll('button')).find(b => b.textContent.includes('Lint')) : null;
      return btn ? btn.textContent.trim() : null;
    })()`);
    if (!lintText) await sleep(500);
  }
  record('regression-lint-badge', { lintText });
  if (!lintText || !/Lint/.test(lintText) || !/\d+\s*件/.test(lintText)) fail('lint badge did not render a finding count', { lintText });
  await screenshot(cdp, path.join(EVIDENCE_DIR, '03-lint-badge.png'));

  // === L1-3: 未接続状態でカードアクション → 日本語トースト + 注入なし ===
  const toastsBefore3 = (await toastMessages(cdp)).length;
  await clickAskAgentButton(cdp, 'analyzed-clip.mp4');
  await submitQuickInput(cdp, 'これは未接続状態からの依頼テキスト');
  await screenshot(cdp, path.join(EVIDENCE_DIR, '04-not-connected-toast.png'));
  const toastsAfter3 = await toastMessages(cdp);
  record('l1-3-not-connected-toast', { toastsBefore3, toastsAfter3 });
  const expectedToast = 'パートナー未接続。ホームの「パートナーに接続する」から接続してください';
  if (toastsAfter3.length <= toastsBefore3 || !toastsAfter3.includes(expectedToast)) {
    fail('expected the exact Japanese not-connected toast after ask-agent on unconnected partner', { toastsAfter3, expectedToast });
  }
  record('L1-3-PASS', { ok: true });

  // === L1-4: キャンセル時は何も起きない ===
  const toastsBefore4 = (await toastMessages(cdp)).length;
  await clickAskAgentButton(cdp, 'unanalyzed-clip.mp4');
  await cancelQuickInput(cdp, 'キャンセルされるはずの入力テキスト');
  await screenshot(cdp, path.join(EVIDENCE_DIR, '05-cancel-no-op.png'));
  const toastsAfter4 = await toastMessages(cdp);
  const qiClosed = await evalMain(cdp, `(() => {
    const w = document.querySelector('.quick-input-widget');
    return !w || getComputedStyle(w).display === 'none';
  })()`);
  record('l1-4-cancel', { toastsBefore4, toastsAfterCount: toastsAfter4.length, qiClosed });
  if (toastsAfter4.length !== toastsBefore4) fail('cancel must not produce any toast (no injection attempted)', { toastsBefore4, toastsAfter4 });
  if (!qiClosed) fail('quick-input did not close after Escape', { qiClosed });
  record('L1-4-PASS', { ok: true });

  // === attach a dummy partner terminal via the temporary debug hook (see file header) ===
  const attach = await evalMain(cdp, `(async () => {
    const widget = window.__akariPartnerWidgetDebug;
    if (!widget) return { ok: false, reason: 'no-debug-hook' };
    const roots = await widget.workspaceService.roots;
    const cwd = roots[0]?.resource.toString();
    const terminal = await widget.terminalService.newTerminal({
      title: 'dummy-partner-cli',
      shellPath: '/bin/bash',
      shellArgs: [${JSON.stringify(DUMMY_CLI)}],
      cwd,
      kind: 'akari-partner',
      attributes: { 'akari.partner': 'dummy' },
      destroyTermOnClose: false,
      useServerTitle: false
    });
    await terminal.start();
    await widget.shell.addWidget(terminal, { area: 'right', rank: 50 });
    await widget.attachTerminal(terminal, 'Dummy CLI');
    return { ok: true };
  })()`, 20000);
  record('dummy-partner-terminal-attached', attach);
  if (!attach.ok) fail('failed to attach dummy partner terminal via debug hook', attach);
  await sleep(800);
  await screenshot(cdp, path.join(EVIDENCE_DIR, '06-partner-connected.png'));

  // Materials sidebar stays attached/visible through attachTerminal() (only the main-area
  // tab and right panel change) — only re-navigate if it actually became hidden, since
  // clicking the activity icon when it's already visible toggles the panel CLOSED instead.
  let stillVisible = await waitForDropzone(cdp, 500);
  if (!stillVisible.found) {
    record('materials-sidebar-hidden-after-attach-recovering', {});
    await findAndClickActivityIcon(cdp);
    if (!(await clickTab('素材')).found) fail('materials tab not found after partner attach', {});
    stillVisible = await waitForDropzone(cdp, 4000);
    if (!stillVisible.found) fail('materials dropzone did not recover after partner attach', stillVisible);
  }
  await sleep(300);

  // === L1-1: 分析済み素材 → 端末バッファに文脈パケット全文 ===
  await clickAskAgentButton(cdp, 'analyzed-clip.mp4');
  await submitQuickInput(cdp, 'この素材を要約して');
  await sleep(600);
  const bufferAfter1 = await readTerminalBuffer(cdp);
  await screenshot(cdp, path.join(EVIDENCE_DIR, '07-analyzed-injection.png'));
  const expectedPacket1 = '【素材】assets/analyzed-clip.mp4（尺 0:06・分析済み・analysis: .akari/sidecars/assets/analyzed-clip.mp4.analysis/analysis.json）について: この素材を要約して';
  record('l1-1-analyzed-injection', { bufferAfter1, expectedPacket1 });
  if (!bufferAfter1 || !bufferAfter1.includes(expectedPacket1)) {
    fail('analyzed-clip.mp4 injection packet did not appear verbatim in the terminal buffer', { bufferAfter1, expectedPacket1 });
  }
  record('L1-1-PASS', { ok: true });

  // === L1-2: 未分析素材 → 尺不明/未分析・analysis 要素なし ===
  await clickAskAgentButton(cdp, 'unanalyzed-clip.mp4');
  await submitQuickInput(cdp, 'これを分析して');
  await sleep(600);
  const bufferAfter2 = await readTerminalBuffer(cdp);
  await screenshot(cdp, path.join(EVIDENCE_DIR, '08-unanalyzed-injection.png'));
  const expectedPacket2 = '【素材】assets/unanalyzed-clip.mp4（尺不明・未分析）について: これを分析して';
  record('l1-2-unanalyzed-injection', { bufferAfter2, expectedPacket2 });
  if (!bufferAfter2 || !bufferAfter2.includes(expectedPacket2)) {
    fail('unanalyzed-clip.mp4 injection packet did not appear verbatim in the terminal buffer', { bufferAfter2, expectedPacket2 });
  }
  if (expectedPacket2.includes('analysis:')) {
    fail('test setup error: expectedPacket2 must not itself contain an analysis: field', { expectedPacket2 });
  }
  record('L1-2-PASS', { ok: true });

  record('ALL-PASS', { ok: true });
  await writeFile(path.join(EVIDENCE_DIR, 'run-log.json'), JSON.stringify(log, null, 2));
  console.log('SUCCESS: all L1 checks passed.');
  cdp.close();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('FAILED', err);
  await writeFile(path.join(EVIDENCE_DIR, 'run-log-FAILED.json'), JSON.stringify(log, null, 2)).catch(() => {});
  process.exit(1);
});
