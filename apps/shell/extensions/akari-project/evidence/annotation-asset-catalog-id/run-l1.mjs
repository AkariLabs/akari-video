// annotation-asset-catalog-id L1 実機検証ドライバ。cdp-lib.mjs は catalog-tab (2026-07-25) と
// 同じ共有ヘルパー（様式踏襲・中身無改変）。依存追加なし（Node 22+ 組み込みの fetch/WebSocket のみ）。
//
// 目的: 記録セッション中にカタログタブの素材カードを実クリックすると、events.jsonl に
// ui.click / target: "asset:<category>/<id>" が記録されることを実測する
// （docs/contract-2026-08-11-review-session-ui-events.md #2 の additive 語彙）。
import { setTimeout as sleep } from 'node:timers/promises';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { connectMain, evalMain, realClick, screenshot } from './cdp-lib.mjs';

const [, , cdpPortArg, workspaceDirArg, evidenceDirArg, catalogItemKeyArg] = process.argv;
const CDP_PORT = Number(cdpPortArg);
const WORKSPACE_DIR = workspaceDirArg;
const EVIDENCE_DIR = evidenceDirArg;
const CATALOG_ITEM_KEY = catalogItemKeyArg || '3d/vintage-camera';

const log = [];
function record(step, data) { const e = { t: new Date().toISOString(), step, ...data }; log.push(e); console.log(`[${step}]`, JSON.stringify(data)); }
function fail(message, data) { record('FAIL:' + message, data || {}); throw new Error(message); }

async function installErrorCounter(cdp) {
  await evalMain(cdp, `(() => {
    window.__errCount = 0;
    window.__errLog = [];
    const orig = console.error;
    console.error = (...args) => { window.__errCount++; window.__errLog.push(String(args[0]).slice(0, 300)); orig(...args); };
    window.addEventListener('error', (e) => { window.__errCount++; window.__errLog.push('window.error: ' + (e.message || '')); });
    window.addEventListener('unhandledrejection', (e) => { window.__errCount++; window.__errLog.push('unhandledrejection: ' + String(e.reason).slice(0, 300)); });
    return true;
  })()`);
}
async function errorLog(cdp) { return evalMain(cdp, 'window.__errLog || []'); }
async function errorCount(cdp) { return evalMain(cdp, 'window.__errCount'); }

// 左サイドの役割別カード棚（AkariRoleBucketsWidget）は起動直後は折り畳まれていることがある。
// 現行 UI（2026-08-12 時点）は 素材/カタログ/プラン の role="tab" 三本ではなく、
// 素材ペイン既定 + 「＋ カタログから素材をさがす」ボタン（data-akari-open-catalog）/
// 「← 素材にもどる」ボタン（data-akari-back-to-materials）の1枚差し替え方式。
async function ensureRoleBucketsWidgetVisible(cdp) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const visible = await evalMain(cdp, `(() => {
      const el = document.querySelector('[data-akari-dropzone]');
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    })()`);
    if (visible) return;
    const icon = await evalMain(cdp, `(() => {
      const el = Array.from(document.querySelectorAll('.codicon-files')).find(e => e.getBoundingClientRect().width > 0);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!icon) fail('files activity icon not found', {});
    await realClick(cdp, icon.x, icon.y);
    await sleep(800);
  }
  fail('role-buckets widget (dropzone) did not become visible after toggling the files activity icon', {});
}

async function clickCatalogTab(cdp) {
  const state = await evalMain(cdp, `(() => {
    const el = document.querySelector('[data-akari-open-catalog]');
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!state.found) fail('"＋ カタログから素材をさがす" button not found', state);
  await realClick(cdp, state.x, state.y);
  await sleep(500);
}
async function clickMaterialsTab(cdp) {
  const state = await evalMain(cdp, `(() => {
    const el = document.querySelector('[data-akari-back-to-materials]');
    if (!el) return { found: true, alreadyOnMaterials: true };
    const r = el.getBoundingClientRect();
    return { found: true, alreadyOnMaterials: false, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (state.alreadyOnMaterials) return;
  await realClick(cdp, state.x, state.y);
  await sleep(500);
}

async function findSampleMaterialCard(cdp) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const state = await evalMain(cdp, `(() => {
      const el = Array.from(document.querySelectorAll('[data-akari-material-path]'))
        .find(e => e.getAttribute('data-akari-material-path').endsWith('sample.mp4'));
      if (!el) return { found: false };
      const r = el.getBoundingClientRect();
      return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2, path: el.getAttribute('data-akari-material-path') };
    })()`);
    if (state.found) return state;
    await sleep(750);
  }
  return { found: false };
}

async function clickSampleMaterialCard(cdp) {
  const state = await findSampleMaterialCard(cdp);
  if (!state.found) fail('sample.mp4 material card not found', state);
  await realClick(cdp, state.x, state.y);
  await sleep(500);
  return state;
}

// 右サイドの縦アイコンバーには「注釈」タブが（レイアウトによっては）2箇所に現れることがある
// （実測: 主要な右パネルの1つと、ボトムパネル隅のもう1つ）。textContent が完全一致する
// .lm-TabBar-tab のうち最も上（y が最小）のものを実体として選ぶ。ensureReviewPanelTab は
// アイコンを常設するだけで activate しないため、素材カードを開いた直後はまだ位置が
// 安定していないことがあり、確定するまでリトライする。
async function findReviewPanelTab(cdp) {
  for (let attempt = 0; attempt < 15; attempt++) {
    const candidates = await evalMain(cdp, `Array.from(document.querySelectorAll('.lm-TabBar-tab'))
      .filter(t => t.textContent.trim() === '注釈')
      .map(t => { const r = t.getBoundingClientRect(); return { w: r.width, h: r.height, x: r.left, y: r.top }; })
      .filter(c => c.w > 0)
      .sort((a, b) => a.y - b.y)`);
    if (candidates.length > 0) return candidates[0];
    await sleep(300);
  }
  return undefined;
}

async function clickReviewPanelIcon(cdp) {
  const tab = await findReviewPanelTab(cdp);
  if (!tab) fail('review panel ("注釈") tab not found', {});
  await realClick(cdp, tab.x + tab.w / 2, tab.y + tab.h / 2);
  await sleep(500);
}

async function recordingButtonState(cdp) {
  return evalMain(cdp, `(() => {
    const btn = document.querySelector('[data-review-recording-toggle]');
    if (!btn) return { found: false };
    const r = btn.getBoundingClientRect();
    return {
      found: true, disabled: btn.disabled, text: btn.textContent.trim(),
      visible: r.width > 0 && r.height > 0, x: r.left + r.width / 2, y: r.top + r.height / 2
    };
  })()`);
}

async function waitFor(fn, predicate, timeoutMs, intervalMs = 300) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    last = await fn();
    if (predicate(last)) return last;
    await sleep(intervalMs);
  }
  return last;
}

async function catalogCounts(cdp) {
  return evalMain(cdp, `(() => {
    const el = document.querySelector('[data-akari-catalog-item-count]');
    if (!el) return { found: false };
    return { found: true, itemCount: Number(el.getAttribute('data-akari-catalog-item-count')) };
  })()`);
}

// カードのルート div 直下 children[0]=サムネイル囲み div, children[1]=情報セクション div、
// その children[0] が item.title の <span>（renderCatalogCard の JSX 構造どおり）。
// 「取り込む」「頼む」ボタン（renderCatalogCardActions）はこの情報セクションの一番下にあるため、
// タイトル span をクリックすればボタン領域と重ならずカード本体（data-akari-ui）だけを叩ける。
async function clickCatalogCardTitle(cdp, itemKey) {
  await evalMain(cdp, `(() => {
    const card = document.querySelector('[data-akari-catalog-item="${itemKey}"]');
    if (card) card.scrollIntoView({ block: 'center' });
  })()`);
  await sleep(300);
  const rect = await evalMain(cdp, `(() => {
    const card = document.querySelector('[data-akari-catalog-item="${itemKey}"]');
    if (!card) return { found: false, reason: 'card-not-found' };
    const info = card.children[1];
    const title = info ? info.children[0] : undefined;
    if (!title) return { found: false, reason: 'title-span-not-found' };
    const r = title.getBoundingClientRect();
    return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2, text: title.textContent };
  })()`);
  if (!rect.found) fail('catalog card title span not clickable', { itemKey, rect });
  await realClick(cdp, rect.x, rect.y);
  await sleep(500);
  return rect;
}

async function findLatestEventsJsonl() {
  const sessionsDir = path.join(WORKSPACE_DIR, 'review', 'sessions');
  const entries = await readdir(sessionsDir).catch(() => []);
  const sessionIds = entries.filter(name => /^s-\d+$/.test(name)).sort();
  if (sessionIds.length === 0) return undefined;
  const latest = sessionIds[sessionIds.length - 1];
  return { id: latest, file: path.join(sessionsDir, latest, 'events.jsonl') };
}

async function main() {
  const cdp = await connectMain(CDP_PORT);
  record('connected-main', {});
  await installErrorCounter(cdp);

  // 初回起動（新規 user-data-dir・ホーム v2 バナー描画込み）は数十秒かかることがあるため、
  // activity bar のアイコン自体が生えるまで長めに待つ。
  const bootState = await waitFor(
    () => evalMain(cdp, `(() => {
      const el = Array.from(document.querySelectorAll('.codicon-files')).find(e => e.getBoundingClientRect().width > 0);
      return { ready: !!el };
    })()`),
    s => s.ready,
    180000,
    1000
  );
  record('app-booted', bootState);
  if (!bootState?.ready) fail('app did not finish booting (files activity icon never appeared)', bootState);
  // アイコンの出現とパネル内容の実描画完了の間にはまだラグがあることがある（実測）。
  await sleep(4000);
  await screenshot(cdp, path.join(EVIDENCE_DIR, '00-boot.png'));

  await ensureRoleBucketsWidgetVisible(cdp);
  await clickMaterialsTab(cdp);
  await screenshot(cdp, path.join(EVIDENCE_DIR, '01-materials-tab.png'));

  // sample.mp4 を実クリックしてプレビューを開く（akari-preview 側の受動アタッチが
  // exports/edit.json を発見し ReviewModel.location.editUri を満たす — 契約とは無関係の
  // 既存配線。ここでは録音ボタンを有効化するための前提操作として使う）。
  const materialClick = await clickSampleMaterialCard(cdp);
  record('clicked-sample-material-card', materialClick);
  await sleep(3000);

  // 右パネルは（おそらく O3 初回導線の自動フォーカス誘導と競合して）不定期に
  // 「パートナーを追加」等へ勝手に切り替わることが実測で分かっている。sleep を挟むと
  // その間に奪われることがあるため、「注釈タブを前面へ→即座に状態確認→即座にクリック」
  // を1拍で行い、失敗したら短い間隔で何度もやり直す（長い待ちを間に置かない）。
  let beforeRecording;
  for (let attempt = 0; attempt < 20; attempt++) {
    await clickReviewPanelIcon(cdp);
    beforeRecording = await recordingButtonState(cdp);
    if (beforeRecording.visible && !beforeRecording.disabled && beforeRecording.text === '録音開始') {
      break;
    }
    if (attempt % 5 === 4) {
      // location.editUri 自体が未解決な可能性もあるので、時々素材カードを開き直す。
      await clickSampleMaterialCard(cdp);
    }
    await sleep(500);
  }
  await screenshot(cdp, path.join(EVIDENCE_DIR, '02-review-panel.png'));
  record('recording-button-enabled', beforeRecording);
  if (!beforeRecording?.found || !beforeRecording.visible || beforeRecording.disabled) {
    fail('recording button did not become visible/enabled (ReviewModel.location.editUri not resolved)', beforeRecording);
  }
  if (beforeRecording.text !== '録音開始') fail('unexpected recording button label before starting', beforeRecording);

  // === 録音開始 ===
  // 「準備中…」（starting 中）の間は絶対にクリックし直さない — 二重クリックで
  // 即座に録音終了へトグルし戻ってしまう事故を避けるため。
  const errCountBeforeRecording = await errorCount(cdp);
  let afterStart;
  let clickedStart = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    afterStart = await recordingButtonState(cdp);
    if (afterStart?.text === '録音終了') break;
    if (clickedStart && afterStart?.text === '準備中…') {
      // 出力プレビューを開く実処理（ensureVisible）が走っている最中。数十秒かかることがある
      // 実測を踏まえ、ここでは絶対に再クリックせず長めに待つ。
      await sleep(1000);
      continue;
    }
    await clickReviewPanelIcon(cdp);
    const clickTarget = await recordingButtonState(cdp);
    if (clickTarget.visible && !clickTarget.disabled && clickTarget.text === '録音開始') {
      await realClick(cdp, clickTarget.x, clickTarget.y);
      clickedStart = true;
      afterStart = await waitFor(() => recordingButtonState(cdp), s => s.found && (s.text === '録音終了' || s.text === '準備中…'), 4000, 200);
      if (afterStart?.text === '録音終了') break;
    } else {
      await sleep(500);
    }
  }
  record('recording-started', afterStart);
  if (afterStart?.text !== '録音終了') fail('recording did not become active after clicking 録音開始', afterStart);
  await sleep(800);
  await screenshot(cdp, path.join(EVIDENCE_DIR, '03-recording-active.png'));
  record('L1-recording-start-PASS', { ok: true });

  // === カタログタブへ切り替え、対象カードのタイトルを実クリック ===
  await clickCatalogTab(cdp);
  const counts = await waitFor(() => catalogCounts(cdp), c => c.found && c.itemCount > 0, 8000);
  record('catalog-loaded', counts);
  if (!counts?.found || counts.itemCount <= 0) fail('catalog did not load any items (dev-layout auto-detect)', counts);

  const cardExists = await evalMain(cdp, `!!document.querySelector('[data-akari-catalog-item="${CATALOG_ITEM_KEY}"]')`);
  if (!cardExists) fail('target catalog card not present in dev-layout catalog', { CATALOG_ITEM_KEY });

  const clicked = await clickCatalogCardTitle(cdp, CATALOG_ITEM_KEY);
  record('clicked-catalog-card-title', clicked);
  await screenshot(cdp, path.join(EVIDENCE_DIR, '04-catalog-card-clicked.png'));

  // === 録音終了（右パネルは開いたままのはず。念のため再度アイコンをクリックしてから止める） ===
  let afterStop;
  let clickedStop = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    afterStop = await recordingButtonState(cdp);
    if (afterStop?.text === '録音開始') break;
    if (clickedStop && afterStop?.text === '保存中…') {
      await sleep(1000);
      continue;
    }
    await clickReviewPanelIcon(cdp);
    const stopTarget = await recordingButtonState(cdp);
    if (stopTarget.visible && !stopTarget.disabled && stopTarget.text === '録音終了') {
      await realClick(cdp, stopTarget.x, stopTarget.y);
      clickedStop = true;
      afterStop = await waitFor(() => recordingButtonState(cdp), s => s.found && (s.text === '録音開始' || s.text === '保存中…'), 4000, 200);
      if (afterStop?.text === '録音開始') break;
    } else {
      await sleep(500);
    }
  }
  record('recording-stopped', afterStop);
  if (afterStop?.text !== '録音開始') fail('recording did not stop cleanly', afterStop);
  await sleep(500);
  await screenshot(cdp, path.join(EVIDENCE_DIR, '05-recording-stopped.png'));

  const errCountAfter = await errorCount(cdp);
  record('console-error-delta', { errCountBeforeRecording, errCountAfter, delta: errCountAfter - errCountBeforeRecording });

  // === events.jsonl の実測 ===
  const session = await findLatestEventsJsonl();
  if (!session) fail('no review/sessions/s-XXXX directory found in workspace', { WORKSPACE_DIR });
  const raw = await readFile(session.file, 'utf8');
  const lines = raw.trim().split('\n').filter(Boolean);
  record('events-jsonl', { sessionId: session.id, file: session.file, lineCount: lines.length, lines });
  const expectedTarget = `asset:${CATALOG_ITEM_KEY}`;
  const matchLine = lines.find(line => {
    try {
      const parsed = JSON.parse(line);
      return parsed.type === 'ui.click' && parsed.target === expectedTarget;
    } catch {
      return false;
    }
  });
  if (!matchLine) fail(`events.jsonl did not contain a ui.click line with target ${expectedTarget}`, { lines });
  record('L1-catalog-card-ui-click-PASS', { ok: true, matchLine, expectedTarget });

  const finalErrLog = await errorLog(cdp);
  record('ALL-PASS', { ok: true, finalErrLog });

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
