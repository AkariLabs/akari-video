// export-button 「フック除去後の最終ビルド」再実測ドライバ。
// run-l1.mjs の一時デバッグフック（AkariMenuWidget の postConstruct に追加した
// `globalThis.__akariShellStripMenuWidgetDebug = this`）を完全に削除してから
// 再ビルドしたバイナリに対して、L1-2/L1-3/L1-4/L1-5（フック不要な項目）を
// もう一度実測する（card-ask-agent f740707 の final-smoke-*.png と同じ手順）。
// L1-1（パートナー端末バッファへの到達）はフックがないと検証できないため、
// フック在りの run-l1.mjs 側でのみ実測する。
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFile, unlink } from 'node:fs/promises';
import { connectMain, evalMain, realClick, screenshot } from './cdp-lib.mjs';

const PORT = Number(process.argv[2]);
const WS = process.argv[3];
const EVIDENCE_DIR = process.argv[4];

function fail(msg, data) { throw new Error(msg + ' ' + JSON.stringify(data)); }

async function clickMenuIcon(cdp) {
  const state = await evalMain(cdp, `(() => {
    const el = Array.from(document.querySelectorAll('.codicon-menu')).find(e => e.getBoundingClientRect().width > 0);
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (state.found) { await realClick(cdp, state.x, state.y); await sleep(500); }
  return state;
}

async function exportButtonState(cdp) {
  return evalMain(cdp, `(() => {
    const target = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '書き出し');
    return target ? { found: true, disabled: target.disabled, title: target.title } : { found: false };
  })()`);
}

async function waitForQuickInputPlaceholder(cdp, placeholder) {
  for (let attempt = 0; attempt < 25; attempt++) {
    const state = await evalMain(cdp, `(() => {
      const widget = document.querySelector('.quick-input-widget');
      const input = widget ? widget.querySelector('input') : null;
      const visible = !!widget && getComputedStyle(widget).display !== 'none';
      return { visible, placeholder: input ? input.placeholder : null };
    })()`);
    if (state.visible && state.placeholder === placeholder) return;
    await sleep(200);
  }
  fail('quick input did not reach expected placeholder', { placeholder });
}

async function focusQuickInput(cdp) {
  const rect = await evalMain(cdp, `(() => {
    const input = document.querySelector('.quick-input-widget input');
    if (!input) return null;
    const r = input.getBoundingClientRect();
    if (r.width === 0) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (rect) { await realClick(cdp, rect.x, rect.y); await sleep(150); }
}

async function pressEnter(cdp) {
  await focusQuickInput(cdp);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 13, key: 'Enter' });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, key: 'Enter' });
  await sleep(500);
}

// クリック後に「行が消える（選択が通って次ステップへ進む/閉じる）」ところまで
// 確認する。進まない場合は呼び出し元（L1-3 の外側リトライ）が Escape から
// やり直す前提のため、ここは 1 回試して結果を返すだけに留める。
async function clickQuickPickRow(cdp, text) {
  let clicked = false;
  for (let attempt = 0; attempt < 25 && !clicked; attempt++) {
    const row = await evalMain(cdp, `(() => {
      const widget = document.querySelector('.quick-input-widget');
      if (!widget || getComputedStyle(widget).display === 'none') return { found: false };
      const rows = Array.from(widget.querySelectorAll('.monaco-list-row'));
      const row = rows.find(r => r.textContent.trim() === ${JSON.stringify(text)});
      if (!row) return { found: false };
      const r = row.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return { found: false };
      return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (row.found) { await realClick(cdp, row.x, row.y); clicked = true; break; }
    await sleep(200);
  }
  if (!clicked) fail('quick pick row not found/visible', { text });
  for (let attempt = 0; attempt < 15; attempt++) {
    const stillThere = await evalMain(cdp, `(() => {
      const widget = document.querySelector('.quick-input-widget');
      if (!widget || getComputedStyle(widget).display === 'none') return false;
      const rows = Array.from(widget.querySelectorAll('.monaco-list-row'));
      return rows.some(r => r.textContent.trim() === ${JSON.stringify(text)} && r.getBoundingClientRect().width > 0);
    })()`);
    if (!stillThere) { await sleep(300); return; }
    await sleep(200);
  }
  fail('quick pick did not advance after clicking row', { text });
}

async function exportSectionText(cdp) {
  return evalMain(cdp, `(() => {
    const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.trim() === '書き出し');
    const s = b ? b.closest('section') : null;
    return s ? s.textContent.trim() : null;
  })()`);
}

async function main() {
  const cdp = await connectMain(PORT);
  await sleep(1500);

  const hookState = await evalMain(cdp, `typeof window.__akariShellStripMenuWidgetDebug`);
  console.log('debugHookPresent(expect undefined)', hookState);
  if (hookState !== 'undefined') fail('debug hook still present in final build', { hookState });

  await clickMenuIcon(cdp);
  await screenshot(cdp, `${EVIDENCE_DIR}/final-smoke-01-menu-edit-json-present.png`);

  // --- L1-2: remove edit.json -> disabled + tooltip ---
  await unlink(`${WS}/edit.json`);
  let state;
  for (let i = 0; i < 15; i++) {
    state = await exportButtonState(cdp);
    if (state.found && state.disabled) break;
    await sleep(400);
  }
  console.log('afterRemoveEditJson', JSON.stringify(state));
  if (!state.found || !state.disabled || !state.title) fail('button did not become disabled after edit.json removal', state);
  await screenshot(cdp, `${EVIDENCE_DIR}/final-smoke-02-editjson-removed-disabled.png`);

  // restore edit.json
  await writeFile(`${WS}/edit.json`, JSON.stringify({ version: 1, source: { path: 'assets/placeholder.mp4' } }, null, 2));
  for (let i = 0; i < 15; i++) {
    state = await exportButtonState(cdp);
    if (state.found && !state.disabled) break;
    await sleep(400);
  }
  console.log('afterRestoreEditJson', JSON.stringify(state));
  if (!state.found || state.disabled) fail('button did not re-enable after edit.json restored', state);

  // --- L1-3: click through -> not connected toast (final build, no partner attached) ---
  // 稀にステップ遷移がキャンセル扱いになるレースがあるため、失敗したら
  // Escape で状態をリセットしてダイアログ最初から開き直す自己修復リトライ。
  async function clickExportButtonNow() {
    const btn = await evalMain(cdp, `(() => {
      const el = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '書き出し');
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    await realClick(cdp, btn.x, btn.y);
  }

  let toasts;
  let lastError;
  for (let attempt = 0; attempt < 3 && !toasts; attempt++) {
    try {
      await clickExportButtonNow();
      await waitForQuickInputPlaceholder(cdp, '解像度プリセットを選択');
      await clickQuickPickRow(cdp, '1080p 横');
      await waitForQuickInputPlaceholder(cdp, '出力ファイル名');
      await pressEnter(cdp);
      await waitForQuickInputPlaceholder(cdp, 'lint を先に再実行しますか');
      await clickQuickPickRow(cdp, 'lint を先に再実行する（既定）');
      await sleep(800);
      toasts = await evalMain(cdp, `Array.from(document.querySelectorAll('.theia-notification-message')).map(n => n.textContent.trim())`);
    } catch (error) {
      lastError = error;
      console.log(`L1-3 flow attempt ${attempt + 1} failed, resetting and retrying:`, error.message);
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 27, key: 'Escape' });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 27, key: 'Escape' });
      await sleep(600);
    }
  }
  if (!toasts) fail('L1-3 export flow did not complete after retries', { lastError: lastError?.message });
  console.log('toasts', JSON.stringify(toasts));
  await screenshot(cdp, `${EVIDENCE_DIR}/final-smoke-03-not-connected-toast.png`);
  const expectedToast = 'パートナー未接続。ホームの「パートナーに接続する」から接続してください';
  if (!toasts.includes(expectedToast)) fail('expected not-connected toast missing', { toasts });

  // --- L1-4: render.json progression on final build ---
  await writeFile(`${WS}/.akari/render.json`, JSON.stringify({ version: 1, phase: 'planning' }));
  await sleep(900);
  let sectionText = await exportSectionText(cdp);
  console.log('render-start', sectionText);
  if (!sectionText || !sectionText.includes('planning') || !sectionText.includes('15%')) fail('start stage did not render as expected', { sectionText });

  await writeFile(`${WS}/.akari/render.json`, JSON.stringify({ version: 1, phase: 'rendering' }));
  await sleep(900);
  sectionText = await exportSectionText(cdp);
  console.log('render-50pct', sectionText);
  if (!sectionText || !sectionText.includes('rendering') || !sectionText.includes('50%')) fail('50pct stage did not render as expected', { sectionText });
  await screenshot(cdp, `${EVIDENCE_DIR}/final-smoke-04-render-50pct.png`);

  await writeFile(`${WS}/.akari/render.json`, JSON.stringify({
    version: 1, phase: 'verified',
    artifacts: [{ path: 'exports/final.mp4' }],
    verify: { verdict: 'pass', findings: [] }
  }));
  await sleep(900);
  sectionText = await exportSectionText(cdp);
  console.log('render-done', sectionText);
  if (!sectionText || !sectionText.includes('完了') || !sectionText.includes('exports/final.mp4')) fail('done stage did not render as expected', { sectionText });
  await screenshot(cdp, `${EVIDENCE_DIR}/final-smoke-05-render-done.png`);

  await writeFile(`${WS}/.akari/render.json`, '{ broken json ,,,');
  await sleep(900);
  sectionText = await exportSectionText(cdp);
  console.log('render-broken', sectionText);
  if (!sectionText || !sectionText.includes('進捗不明')) fail('broken json did not fall back as expected', { sectionText });
  await screenshot(cdp, `${EVIDENCE_DIR}/final-smoke-06-render-broken-fallback.png`);

  // --- L1-5 regression: existing menu actions + materials tab still reachable ---
  const menuState = await evalMain(cdp, `(() => {
    const labels = Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim());
    return { hasTimeline: labels.includes('タイムライン'), hasTranscript: labels.includes('文字起こし'), hasHome: labels.includes('ホーム'), hasShowChanges: labels.includes('変更を見る') };
  })()`);
  console.log('menuRegression', JSON.stringify(menuState));
  if (!menuState.hasTimeline || !menuState.hasTranscript || !menuState.hasHome || !menuState.hasShowChanges) fail('existing menu actions regressed', menuState);

  const filesIcon = await evalMain(cdp, `(() => {
    const el = Array.from(document.querySelectorAll('.codicon-files')).find(e => e.getBoundingClientRect().width > 0);
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (filesIcon.found) { await realClick(cdp, filesIcon.x, filesIcon.y); await sleep(700); }
  const dzFound = await evalMain(cdp, `(() => {
    const el = document.querySelector('[data-akari-dropzone]');
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  })()`);
  console.log('materialsTabRegression', dzFound);
  if (!dzFound) fail('materials tab regressed', { dzFound });
  await screenshot(cdp, `${EVIDENCE_DIR}/final-smoke-07-materials-regression.png`);

  console.log('FINAL-SMOKE-ALL-PASS');
  cdp.close();
}
main().catch(e => { console.error('FINAL SMOKE FAILED', e); process.exit(1); });
