#!/usr/bin/env node
// t4-track-height-resize の L1 実測ドライバ。トラックヘッダーからの高さ変更
// （compact/standard/large 3 段階循環）・コンパクトでのフィルムストリップ/波形非表示・
// キャッシュ経由の即復活（ffmpeg 起動ゼロ）・コンパクトでも選択/ドラッグ/トリムが効くこと・
// Electron 再起動後のティア保持・回帰（挿入インジケータ・プレイヘッド追従・SE 実尺・
// 波形下寄せ帯・large でのフィルムストリップ拡大表示）を実機 CDP で検証する。
//
// Electron のプロセスライフサイクル（起動・再起動・kill）は run-l1.sh（同ディレクトリ）が
// 担当し、本スクリプトは「起動済み Electron に CDP で繋いで観測する」役割に専念する。
// phase1 = 通常起動後の全受け入れ条件（再起動保持を除く）を実測し、最後に t1 トラックを
// 'compact' に設定した状態で終了する。phase2 = 再起動後の新しい Electron に繋ぎ直し、
// t1 が 'compact' のまま復元されていることだけを確認する（受け入れ条件 4）。
//
// t3-filmstrip-lazy-realdata/scripts/run-l1.mjs（cdp-lib.mjs・openTimeline 系ヘルパー・
// スクロール/クリック/ドラッグの実機操作パターン）を土台に流用している。
//
// 重要: prepare-fixture.mjs は dogfood コピーの edit.json 先頭付近（index 1）へ
// 2本目の cuts トラック（t7・ref1）のクリップを splice 挿入するため、元の cuts 配列の
// index 1 以降は全て 1 つずつ後ろへずれる。T3 で「clip 9（C10）」として使っていた
// 実測済みの温キャッシュ済みクリップ（幅広・フィルムストリップ/波形とも描画される）は
// 本タスクのフィクスチャ適用後は index 10（C11）になる。以後 '10' を使う。
//
// Usage: node run-l1.mjs <phase1|phase2> <cdpPort> <workspaceDir> <evidenceDir>

import { setTimeout as sleep } from 'node:timers/promises';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { CDP, listTargets, evalOn, screenshot, realClick } from './cdp-lib.mjs';

const [, , phaseArg, cdpPortArg, workspaceDirArg, evidenceDirArg] = process.argv;
const PHASE = phaseArg;
const CDP_PORT = Number(cdpPortArg);
const WORKSPACE_DIR = workspaceDirArg;
const EVIDENCE_DIR = evidenceDirArg;
const EDIT_JSON_PATH = path.join(WORKSPACE_DIR, 'edit.json');
const ATLAS_DIR = path.join(WORKSPACE_DIR, '.akari', 'cache', 'timeline', 'filmstrip');
const TARGET_CLIP_INDEX = '10'; // C11 = 元 T3 の「clip 9(C10)」相当（フィクスチャ挿入で 1 つ後ろへずれた）
const OTHER_TRACK_ID = 't7'; // prepare-fixture.mjs が追加する 2 本目の cuts トラック
const MAIN_TRACK_ID = 't1';

const log = [];
function record(step, data) {
  const entry = { t: new Date().toISOString(), step, ...data };
  log.push(entry);
  console.log(`[${step}]`, JSON.stringify(data));
}
function assert(cond, message, data) {
  if (!cond) {
    record('ASSERTION-FAILED', { message, ...data });
    throw new Error(`assertion failed: ${message} :: ${JSON.stringify(data)}`);
  }
  record('assertion-ok', { message, ...data });
}
async function shot(main, name) {
  await screenshot(main, path.join(EVIDENCE_DIR, name));
}
async function readJson(p) {
  return JSON.parse(await readFile(p, 'utf8'));
}
function ffmpegProcessCount() {
  // この L1 ワークスペース由来の ffmpeg のみ数える（入力 source も出力 tmp も
  // /tmp/t4-track-height-resize-l1 配下のパスを引数に含む）。グローバルカウントだと
  // 並行セッションの export/render 用 ffmpeg を拾って偽陽性になる（第 4 走で実証）。
  try {
    const out = execSync("ps aux | grep '[f]fmpeg' | grep 't4-track-height-resize-l1'", { encoding: 'utf8' });
    return out.trim().split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}
async function atlasDirSnapshot() {
  try {
    const files = await readdir(ATLAS_DIR);
    const entries = [];
    for (const f of files) {
      const st = await stat(path.join(ATLAS_DIR, f));
      entries.push({ name: f, mtimeMs: st.mtimeMs, size: st.size });
    }
    return entries.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

async function openTimelineViaCommand(main) {
  // 高負荷マシンでの初回オープンは遅い。コマンド実行自体を最大 5 回試し、
  // 各試行で最大 12 秒待つ（第 3 走はここが単発タイムアウトで ASSERTION-FAILED になった）。
  for (let attempt = 0; attempt < 5; attempt++) {
    const result = await evalOn(main, `(() => {
    const bd = window.theia.container._bindingDictionary;
    const keys = [...bd._map.keys()];
    const CmdClass = keys.find(k => typeof k === 'function' && k.prototype
      && typeof k.prototype.executeCommand === 'function' && typeof k.prototype.registerCommand === 'function');
    if (!CmdClass) return { ok: false };
    const registry = window.theia.container.get(CmdClass);
    void registry.executeCommand('akari.annotations.open');
    return { ok: true };
  })()`);
    if (result.ok) {
      for (let w = 0; w < 24; w++) {
        const found = await evalOn(main, `!!document.getElementById('akari-annotations-widget')`);
        if (found) return true;
        await sleep(500);
      }
    } else {
      await sleep(2000);
    }
  }
  return false;
}
async function openTimeline(main) {
  const alreadyOpen = await evalOn(main, `!!document.getElementById('akari-annotations-widget')`);
  if (alreadyOpen) return true;
  return openTimelineViaCommand(main);
}

/** widget インスタンスを window.__t4.instance へ捕捉する（renderStrip の prototype 計装）。 */
async function installInstrumentation(main) {
  return evalOn(main, `(() => {
    const bd = window.theia.container._bindingDictionary;
    const keys = [...bd._map.keys()];
    const WidgetClass = keys.find(k => typeof k === 'function' && k.prototype && typeof k.prototype.clipLocalGeometry === 'function');
    if (!WidgetClass) return { ok: false, reason: 'WidgetClass not found in binding dictionary' };
    if (window.__t4installed) return { ok: true, alreadyInstalled: true };
    window.__t4installed = true;
    window.__t4 = { instance: null };
    const origRenderStrip = WidgetClass.prototype.renderStrip;
    WidgetClass.prototype.renderStrip = function () {
      if (!window.__t4.instance) window.__t4.instance = this;
      return origRenderStrip.call(this);
    };
    return { ok: true };
  })()`);
}
async function waitForInstance(main) {
  for (let i = 0; i < 20; i++) {
    const has = await evalOn(main, `!!(window.__t4 && window.__t4.instance)`);
    if (has) return true;
    await sleep(300);
  }
  return false;
}

async function clipInfo(main, cutIndex) {
  return evalOn(main, `(() => {
    const matches = document.querySelectorAll('.akari-annotations-strip-clip[data-akari-item-kind="cut"][data-akari-item-id="${cutIndex}"]');
    const clip = matches[0];
    if (!clip) return null;
    const r = clip.getBoundingClientRect();
    const wrappers = clip.querySelectorAll('.akari-annotations-strip-clip-filmstrip');
    const cells = clip.querySelectorAll('.akari-annotations-strip-clip-filmstrip-cell');
    const canvas = clip.querySelector('canvas');
    const canvasRect = canvas ? canvas.getBoundingClientRect() : null;
    return {
      rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
      cellCount: cells.length,
      // 二重ラッパー/重複要素の検出用診断（5 セル anomaly の切り分け）。
      wrapperCount: wrappers.length,
      elementCount: matches.length,
      // DOMRect は prototype プロパティのため CDP の returnByValue で {} に潰れる。明示展開必須。
      cellRect: cells.length ? (cr => ({ top: cr.top, height: cr.height, width: cr.width }))(cells[0].getBoundingClientRect()) : null,
      hasWaveformCanvas: !!canvas,
      canvasTopOffset: canvasRect ? canvasRect.top - r.top : null,
      canvasHeight: canvasRect ? canvasRect.height : null,
      classList: Array.from(clip.classList)
    };
  })()`);
}
async function scrollClipIntoView(main, cutIndex) {
  // タイムラインの横方向は DOM スクロールではなく viewStart の時間窓。クリップが窓の外に
  // 出ると DOM から culling されるため、計装済みインスタンス経由で窓を動かして可視化する
  // （移動テストで at が変わった後もこれで確実に追える）。縦方向は scrollIntoView に委ねる。
  await evalOn(main, `(() => {
    const inst = window.__t4 && window.__t4.instance;
    if (inst && Array.isArray(inst.segments)) {
      const seg = inst.segments.find(s => s.index === ${cutIndex});
      if (seg) {
        const dur = inst.visibleDuration();
        if (seg.tlStart < inst.viewStart || seg.tlEnd > inst.viewStart + dur) {
          inst.viewStart = Math.max(0, seg.tlStart - dur * 0.3);
          inst.renderStrip();
        }
      }
    }
    const clip = document.querySelector('.akari-annotations-strip-clip[data-akari-item-kind="cut"][data-akari-item-id="${cutIndex}"]');
    if (clip) clip.scrollIntoView({ block: 'center' });
    return !!clip;
  })()`);
  await sleep(300);
}
async function allClipsInfo(main) {
  return evalOn(main, `(() => {
    const clips = Array.from(document.querySelectorAll('.akari-annotations-strip-clip[data-akari-item-kind="cut"]'));
    return clips.map(clip => {
      const r = clip.getBoundingClientRect();
      const cells = clip.querySelectorAll('.akari-annotations-strip-clip-filmstrip-cell');
      return { index: clip.dataset.akariItemId, width: r.width, cellCount: cells.length };
    });
  })()`);
}
/** trackId のヘッダー行（top/height/現在のティア）を読む。 */
async function trackHeaderInfo(main, trackId) {
  return evalOn(main, `(() => {
    const row = document.querySelector('.akari-track-header-row[data-akari-timeline-track-id="${trackId}"]');
    if (!row) return null;
    const btn = row.querySelector('button[data-akari-toggle="size"]');
    return {
      top: row.style.top, height: row.style.height,
      tier: btn ? btn.dataset.akariSizeTier : null
    };
  })()`);
}
/** trackId のサイズボタンを 1 回クリックする（ティアが 1 段階循環する）。 */
async function clickSizeButton(main, trackId) {
  const rect = await evalOn(main, `(() => {
    const row = document.querySelector('.akari-track-header-row[data-akari-timeline-track-id="${trackId}"]');
    const btn = row ? row.querySelector('button[data-akari-toggle="size"]') : null;
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!rect) throw new Error(`size button not found for track ${trackId}`);
  await realClick(main, rect.x, rect.y);
  await sleep(300);
}
/** trackId のティアが目標値になるまでサイズボタンを最大 3 回クリックする。 */
async function setTierViaButton(main, trackId, targetTier) {
  for (let i = 0; i < 3; i++) {
    const info = await trackHeaderInfo(main, trackId);
    if (info && info.tier === targetTier) return info;
    await clickSizeButton(main, trackId);
  }
  const finalInfo = await trackHeaderInfo(main, trackId);
  assert(!!finalInfo && finalInfo.tier === targetTier, `size button cycles ${trackId} to tier=${targetTier} within 3 clicks`, { finalInfo });
  return finalInfo;
}

async function connectCdp() {
  const targets = await listTargets(CDP_PORT);
  const mainTarget = targets.find(t => t.type === 'page');
  if (!mainTarget) throw new Error('main page target not found');
  const cdp = new CDP(mainTarget.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  return cdp;
}

async function waitReady(main) {
  for (let i = 0; i < 60; i++) {
    const ready = await evalOn(main, `!!(window.theia && window.theia.container)`);
    if (ready) return true;
    await sleep(500);
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
async function runPhase1() {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const cdp = await connectCdp();
  record('connected', { cdpPort: CDP_PORT, workspace: WORKSPACE_DIR, phase: PHASE });

  await evalOn(cdp, `(() => { window.resizeTo(1800, 2000); return true; })()`);
  await sleep(500);
  const ready = await waitReady(cdp);
  assert(ready, 'theia container ready');

  const instrumented = await installInstrumentation(cdp);
  assert(instrumented.ok, 'runtime instrumentation installed on AkariAnnotationsWidget.prototype', instrumented);

  const opened = await openTimeline(cdp);
  assert(opened, 'timeline widget opened via command palette');
  const instanceReady = await waitForInstance(cdp);
  assert(instanceReady, 'live widget instance captured via renderStrip() instrumentation');

  // fixture 適用直後の edit.json 形状を確認（v0・sidecar 無し・2 本目 cuts トラックあり）。
  const editRaw = await readJson(EDIT_JSON_PATH);
  assert(editRaw.timeline.tracks.some(t => t.id === OTHER_TRACK_ID && t.kind === 'cuts'),
    'fixture added a second cuts track (t7, ref=1) to edit.json', { tracks: editRaw.timeline.tracks });

  // 初期表示が落ち着くまで待つ（ffmpeg が 0 に収束）。
  let settleFfmpeg = ffmpegProcessCount();
  for (let i = 0; i < 40 && settleFfmpeg > 0; i++) {
    await sleep(500);
    settleFfmpeg = ffmpegProcessCount();
  }
  await sleep(500);

  // キャッシュ済みチャンクの遅延ロードは ffmpeg を起動しないため、ffmpeg 静穏だけでは
  // セル数の増加が終わったことを保証できない。cellCount > 0 かつ 6 ポーリング連続
  // （3 秒間）不変になるまで待ち切ってからベースラインを確定する（最大 120 秒）。
  // 安定条件は「cellCount > 0 かつ 6 ポーリング連続不変 かつ ワークスペース ffmpeg = 0」。
  // ffmpeg 条件が無いと、負荷時に数十秒かかるチャンク生成の途中（例: 3 セル中 1 セルだけ
  // 描画済み）を安定と誤認する（第 6 走で実証: baseline=1 → revive=3 の偽不一致）。
  // 上限 300 秒（負荷 40 台のマシンで 120 秒チャンクのデコードに余裕を持たせる）。
  let all = await allClipsInfo(cdp);
  let stablePolls = 0;
  let lastCellCount = -1;
  for (let i = 0; i < 600 && stablePolls < 6; i++) {
    await sleep(500);
    all = await allClipsInfo(cdp);
    const current = all.find(c => c.index === TARGET_CLIP_INDEX);
    const count = current ? current.cellCount : 0;
    if (count > 0 && count === lastCellCount && ffmpegProcessCount() === 0) {
      stablePolls++;
    } else {
      stablePolls = 0;
      lastCellCount = count;
    }
  }
  const baselineTarget = all.find(c => c.index === TARGET_CLIP_INDEX);
  record('baseline-clips', { all, baselineTarget });
  assert(!!baselineTarget && baselineTarget.cellCount > 0,
    `target clip ${TARGET_CLIP_INDEX} (warm cache) renders filmstrip cells at standard tier before any tier change`,
    { baselineTarget });

  const baselineMain = await trackHeaderInfo(cdp, MAIN_TRACK_ID);
  const baselineOther = await trackHeaderInfo(cdp, OTHER_TRACK_ID);
  assert(baselineMain.tier === 'standard' && baselineOther.tier === 'standard',
    'both cuts tracks default to standard tier on first open', { baselineMain, baselineOther });
  const baselineClip = await clipInfo(cdp, TARGET_CLIP_INDEX);
  await scrollClipIntoView(cdp, TARGET_CLIP_INDEX);
  await shot(cdp, '00-baseline-standard.png');

  // --- 受け入れ条件 1: ヘッダー操作で対象トラックのみ高さが変わる ----------------------------
  await setTierViaButton(cdp, MAIN_TRACK_ID, 'compact');
  const afterCompactMain = await trackHeaderInfo(cdp, MAIN_TRACK_ID);
  const afterCompactOther = await trackHeaderInfo(cdp, OTHER_TRACK_ID);
  record('tier-only-target-changed', { afterCompactMain, afterCompactOther, baselineOther });
  assert(afterCompactMain.height === '28px', `${MAIN_TRACK_ID} row height becomes compact (28px)`, { afterCompactMain });
  assert(afterCompactOther.height === baselineOther.height && afterCompactOther.tier === 'standard',
    `${OTHER_TRACK_ID} (other cuts track) is unaffected by ${MAIN_TRACK_ID}'s tier change`, { afterCompactOther, baselineOther });
  await scrollClipIntoView(cdp, TARGET_CLIP_INDEX);
  await shot(cdp, '01-compact-target-only.png');

  // --- 受け入れ条件 2 (前半): コンパクトでフィルムストリップ/波形が消える -----------------------
  const compactClip = await clipInfo(cdp, TARGET_CLIP_INDEX);
  record('compact-clip-media-hidden', { compactClip, baselineClip });
  assert(!!compactClip && compactClip.cellCount === 0 && !compactClip.hasWaveformCanvas,
    'in compact tier, the target clip renders zero filmstrip cells and no waveform canvas', { compactClip });
  assert(compactClip.rect.height < baselineClip.rect.height,
    'compact clip element is visibly thinner than the standard-tier baseline', { compactClip, baselineClip });

  // --- 受け入れ条件 2 (後半): 標準へ戻すと ffmpeg 起動ゼロで即復活 -----------------------------
  // 計測前にこのワークスペース由来の ffmpeg（フィクスチャ新クリップ等の正当な
  // バックグラウンド生成）が静穏になるのを待ち切る（最大 120 秒）。revive の計測を
  // 「静止状態から開始 → 復活後も 0 のまま」という決定的な形にするため。
  for (let q = 0; q < 120 && ffmpegProcessCount() > 0; q++) {
    await sleep(1000);
  }
  const atlasBeforeRevive = await atlasDirSnapshot();
  const ffmpegBeforeRevive = ffmpegProcessCount();
  assert(ffmpegBeforeRevive === 0, 'revive 計測開始時点でこのワークスペース由来の ffmpeg が静穏', { ffmpegBeforeRevive });
  await setTierViaButton(cdp, MAIN_TRACK_ID, 'standard');
  await sleep(600);
  let revivedClip = await clipInfo(cdp, TARGET_CLIP_INDEX);
  for (let i = 0; i < 30 && (!revivedClip || revivedClip.cellCount === 0); i++) {
    await sleep(200);
    revivedClip = await clipInfo(cdp, TARGET_CLIP_INDEX);
  }
  await sleep(500);
  const atlasAfterRevive = await atlasDirSnapshot();
  const ffmpegAfterRevive = ffmpegProcessCount();
  record('revive-from-cache', {
    revivedClip, baselineClip, atlasBeforeRevive, atlasAfterRevive, ffmpegBeforeRevive, ffmpegAfterRevive
  });
  assert(!!revivedClip && revivedClip.cellCount === baselineClip.cellCount && revivedClip.hasWaveformCanvas,
    '戻すと標準ティアの表示（フィルムストリップセル数・波形canvas）がベースラインと一致する形で復活する',
    { revivedClip, baselineClip });
  assert(JSON.stringify(atlasBeforeRevive) === JSON.stringify(atlasAfterRevive),
    '標準へ戻す操作の前後で atlas キャッシュファイル一覧（name/mtime/size）が完全一致 = 再生成なし',
    { atlasBeforeRevive, atlasAfterRevive });
  assert(ffmpegAfterRevive === 0, 'compact→standard の復活時、ffmpeg プロセスは 1 つも起動しない', { ffmpegAfterRevive });
  await scrollClipIntoView(cdp, TARGET_CLIP_INDEX);
  await shot(cdp, '02-standard-revived-from-cache.png');

  // --- 波形下寄せ帯（標準ティア基準） ----------------------------------------------------------
  // canvas top は clipHeightPx-WAVEFORM_BAND_HEIGHT_PX の inline style だが、getBoundingClientRect
  // は親クリップの border-top(1px, box-sizing:border-box) を挟むため理論値と ±2px 程度ずれうる。
  // 許容誤差つきで「clipHeight(72) - WAVEFORM_BAND_HEIGHT_PX(24) = 48px 付近」を検証する。
  assert(Math.abs(revivedClip.canvasTopOffset - 48) <= 2 && Math.abs(revivedClip.canvasHeight - 24) <= 2,
    '標準ティアの波形帯は clipHeight(72) - WAVEFORM_BAND_HEIGHT_PX(24) = 48px オフセット・高さ24pxに固定されている（±2px許容）',
    { revivedClip });

  // --- 受け入れ条件 5 (回帰・large): large でフィルムストリップが拡大表示される ------------------
  await setTierViaButton(cdp, MAIN_TRACK_ID, 'large');
  await sleep(600);
  let largeClip = await clipInfo(cdp, TARGET_CLIP_INDEX);
  for (let i = 0; i < 30 && (!largeClip || largeClip.cellCount === 0); i++) {
    await sleep(200);
    largeClip = await clipInfo(cdp, TARGET_CLIP_INDEX);
  }
  const largeHeaderInfo = await trackHeaderInfo(cdp, MAIN_TRACK_ID);
  record('large-tier', { largeHeaderInfo, largeClip, revivedClip });
  assert(largeHeaderInfo.height === '116px', `${MAIN_TRACK_ID} row height becomes large (116px)`, { largeHeaderInfo });
  assert(!!largeClip && largeClip.rect.height > revivedClip.rect.height,
    'large tier のクリップ帯高さは standard より大きい（一回り大きく見える）', { largeClip, revivedClip });
  assert(!!largeClip.cellRect && !!revivedClip.cellRect
    && largeClip.cellRect.height > revivedClip.cellRect.height,
    'large tier のフィルムストリップセル自体の描画高さも standard より大きい（見かけの拡大表示を実測）',
    { largeCellHeight: largeClip.cellRect.height, standardCellHeight: revivedClip.cellRect.height });
  assert(Math.abs(largeClip.canvasTopOffset - (116 - 24)) <= 2,
    'large ティアでも波形帯オフセットは clipHeight - WAVEFORM_BAND_HEIGHT_PX に追随する（92px 付近、±2px許容）',
    { largeClip });
  await scrollClipIntoView(cdp, TARGET_CLIP_INDEX);
  await shot(cdp, '03-large-tier-enlarged.png');

  // --- 受け入れ条件 3: コンパクトでも選択・ドラッグ・トリムが機能 -------------------------------
  await setTierViaButton(cdp, MAIN_TRACK_ID, 'compact');
  await sleep(400);
  await scrollClipIntoView(cdp, TARGET_CLIP_INDEX);

  // 3a. 挿入インジケータ（回帰・受け入れ条件5）: cuts クリップを最上段より上へ縦ドラッグすると
  //     window.__t4.instance.trackInsertIndicator が表示される。水平移動ゼロで戻すため、
  //     ドロップ後の位置・track は変化しない（無害な計測用ドラッグ）。
  let target = await clipInfo(cdp, TARGET_CLIP_INDEX);
  const startX = target.rect.left + target.rect.width / 2;
  const startY = target.rect.top + target.rect.height / 2;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: startX, y: startY, button: 'none' });
  await sleep(40);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startX, y: startY, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(40);
  // 345770a の仕様: 挿入インジケータは「トラック境界ゾーン（TRACK_INSERT_ZONE_PX）」でのみ
  // 表示され、他種レーン（layers/captions 等）の帯まで持ち上げると拒否＝非表示が正しい。
  // よってドラッグ先は t7↔t1 の境界（t1 の上端 = layouts の lower.top）ゾーンを狙う。
  const stripTopViewport = await evalOn(cdp, `window.__t4.instance.strip.getBoundingClientRect().top`);
  const mainHeaderForDrag = await trackHeaderInfo(cdp, MAIN_TRACK_ID);
  const aboveY = stripTopViewport + parseFloat(mainHeaderForDrag.top); // t1 上端の境界ゾーン中心
  const upSteps = 10;
  for (let s = 1; s <= upSteps; s++) {
    const y = startY + (aboveY - startY) * (s / upSteps);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: startX, y, button: 'left', buttons: 1 });
    await sleep(25);
  }
  await sleep(80);
  const indicatorDuringDrag = await evalOn(cdp, `(() => {
    const el = window.__t4.instance.trackInsertIndicator;
    return { display: el.style.display, top: el.style.top };
  })()`);
  record('insertion-indicator-during-drag', { indicatorDuringDrag });
  assert(indicatorDuringDrag.display === 'block',
    'cuts クリップを最上段の外へ縦ドラッグすると挿入インジケータが表示される（trackInsertIndicator.style.display）',
    { indicatorDuringDrag });
  // 元の位置へ戻してから mouseup（水平移動ゼロ・track も originalTrack のまま = 実質ノーオペで確定）。
  for (let s = 1; s <= upSteps; s++) {
    const y = aboveY + (startY - aboveY) * (s / upSteps);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: startX, y, button: 'left', buttons: 1 });
    await sleep(25);
  }
  await sleep(80);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startX, y: startY, button: 'left' });
  await sleep(400);
  const indicatorAfterDrag = await evalOn(cdp, `window.__t4.instance.trackInsertIndicator.style.display`);
  assert(indicatorAfterDrag === 'none', 'ドラッグ終了後は挿入インジケータが非表示に戻る', { indicatorAfterDrag });

  // 3b. 選択（compact のまま）
  // 直前のインジケータ用ドラッグの解放で click イベントが発生しなかった場合、
  // 仕様の「ドラッグ後 1 クリック抑止」（suppressNextStripClick）が残留して
  // 選択クリックを飲み込む（run 9 で flake を実測）。抑止は仕様どおりの防御なので、
  // ここでは残留フラグをリセットして選択機能そのものを独立に検証する。
  await evalOn(cdp, `(window.__t4.instance.suppressNextStripClick = false, true)`);
  target = await clipInfo(cdp, TARGET_CLIP_INDEX);
  await realClick(cdp, (target.rect.left + target.rect.right) / 2, target.rect.top + target.rect.height / 2);
  await sleep(400);
  const selected = await evalOn(cdp, `(() => {
    const clip = document.querySelector('.akari-annotations-strip-clip[data-akari-item-kind="cut"][data-akari-item-id="${TARGET_CLIP_INDEX}"]');
    return clip ? clip.classList.contains('akari-annotations-selected') : false;
  })()`);
  record('compact-regression-selection', { selected });
  assert(selected, 'compact ティアでもクリップクリックで選択（akari-annotations-selected）が効く', { selected });
  await shot(cdp, '04-compact-selection.png');

  // 3c. ドラッグ移動（compact のまま・末尾クリップを空いている後方へシフト = 重なりなし）
  const editBeforeMove = await readJson(EDIT_JSON_PATH);
  const cutBeforeMove = editBeforeMove.cuts[Number(TARGET_CLIP_INDEX)];
  target = await clipInfo(cdp, TARGET_CLIP_INDEX);
  const moveStartX = target.rect.left + target.rect.width / 2;
  const moveStartY = target.rect.top + target.rect.height / 2;
  const moveEndX = moveStartX + 24;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: moveStartX, y: moveStartY, button: 'none' });
  await sleep(40);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: moveStartX, y: moveStartY, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(40);
  const moveSteps = 8;
  for (let s = 1; s <= moveSteps; s++) {
    const x = moveStartX + (moveEndX - moveStartX) * (s / moveSteps);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: moveStartY, button: 'left', buttons: 1 });
    await sleep(25);
  }
  await sleep(60);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: moveEndX, y: moveStartY, button: 'left' });
  await sleep(500);
  let editAfterMove = await readJson(EDIT_JSON_PATH);
  for (let i = 0; i < 15 && editAfterMove.cuts[Number(TARGET_CLIP_INDEX)].at === cutBeforeMove.at; i++) {
    await sleep(300);
    editAfterMove = await readJson(EDIT_JSON_PATH);
  }
  const cutAfterMove = editAfterMove.cuts[Number(TARGET_CLIP_INDEX)];
  record('compact-regression-move', { cutBeforeMove, cutAfterMove });
  assert(cutAfterMove.at !== cutBeforeMove.at,
    'compact ティアでもクリップの右方向ドラッグ移動が edit.json の at を書き換える', { cutBeforeMove, cutAfterMove });
  await shot(cdp, '05-compact-after-move.png');

  // 3d. トリム（compact のまま・右ハンドルを内側へ）
  await scrollClipIntoView(cdp, TARGET_CLIP_INDEX);
  target = await clipInfo(cdp, TARGET_CLIP_INDEX);
  const cutBeforeTrim = cutAfterMove;
  const trimStartX = target.rect.right - 2;
  const trimStartY = target.rect.top + target.rect.height / 2;
  const shrinkPx = Math.min(40, target.rect.width * 0.3);
  const trimEndX = trimStartX - shrinkPx;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: trimStartX, y: trimStartY, button: 'none' });
  await sleep(40);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: trimStartX, y: trimStartY, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(40);
  const trimSteps = 8;
  for (let s = 1; s <= trimSteps; s++) {
    const x = trimStartX + (trimEndX - trimStartX) * (s / trimSteps);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: trimStartY, button: 'left', buttons: 1 });
    await sleep(25);
  }
  await sleep(60);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: trimEndX, y: trimStartY, button: 'left' });
  await sleep(500);
  let editAfterTrim = await readJson(EDIT_JSON_PATH);
  for (let i = 0; i < 15 && editAfterTrim.cuts[Number(TARGET_CLIP_INDEX)].out === cutBeforeTrim.out; i++) {
    await sleep(300);
    editAfterTrim = await readJson(EDIT_JSON_PATH);
  }
  const cutAfterTrim = editAfterTrim.cuts[Number(TARGET_CLIP_INDEX)];
  record('compact-regression-trim', { cutBeforeTrim, cutAfterTrim });
  assert(cutAfterTrim.out < cutBeforeTrim.out,
    'compact ティアでも右トリムハンドルのドラッグが edit.json の out を書き換える', { cutBeforeTrim, cutAfterTrim });
  await shot(cdp, '06-compact-after-trim.png');

  // --- 受け入れ条件 5 (回帰): プレイヘッド追従 --------------------------------------------------
  // handlePlaybackTick は本番のプレビュー再生ティック受信経路そのもの（public メソッド）。
  // ズーム込みの view で追従が起きるか（this.viewStart が前進するか）を直接実測する。
  // 直前のトリム確定 → ファイルウォッチャー → reloadEdit() の間、cuts が一瞬空になり
  // totalDuration()=0 になる（第 8 走でレース負けを実測）。リロード完了を待ち切ってから
  // ズームを設定する。
  let cutsReady = false;
  for (let i = 0; i < 60 && !cutsReady; i++) {
    await sleep(500);
    cutsReady = await evalOn(cdp, `window.__t4.instance.cuts.length > 0 && window.__t4.instance.totalDuration() > 0`);
  }
  // ズーム設定 → 抑止リセット → tick → 前後読みを単一 eval（単一 JS タスク）で原子実行する。
  // 分割 eval だと、直前の move/trim 由来の遅延 reloadEdit が間に割り込んで totalDuration が
  // 変わり、窓アンカーがタイムライン末尾に落ちて「末尾クランプで前進しない」偽陰性になる
  // （第 12 走で実測: viewStart+visible = total ちょうどの張り付き）。窓は末尾から遠い
  // 25% 位置に置き、tick はその場の実測 total 基準で followEdge(0.78) を確実に越える 0.9 倍点。
  const follow = await evalOn(cdp, `(() => {
    const i = window.__t4.instance;
    const total = i.totalDuration();
    i.applyViewDuration(total / 20, total * 0.25, 0.5);
    i.lastManualScrollAt = 0;
    const before = i.viewStart;
    const vis = i.visibleDuration();
    const t = Math.min(total - 0.5, before + vis * 0.9);
    i.handlePlaybackTick({ videoUri: i.location.editUri.toString(), time: t, playing: true });
    return { before, after: i.viewStart, t, total, vis, left: i.playhead.style.left };
  })()`);
  const viewStartBefore = follow.before;
  const viewStartAfter = follow.after;
  const playheadLeft = follow.left;
  record('playhead-follow-regression', { ...follow });
  assert(viewStartAfter > viewStartBefore,
    'プレイヘッドがフォロー境界を越えて進むと viewStart が追従して前進する（トラック高さ変更後も回帰なし）',
    { viewStartBefore, viewStartAfter });
  assert(playheadLeft !== '' && playheadLeft !== '0%',
    'playhead 要素の left が再生位置に応じて更新される', { playheadLeft });
  await evalOn(cdp, `(() => { window.__t4.instance.viewDuration = undefined; window.__t4.instance.viewStart = 0; window.__t4.instance.renderStrip(); return true; })()`);
  await sleep(300);

  // --- 受け入れ条件 5 (回帰): SE 実尺表示 -------------------------------------------------------
  const sfxInfo = await evalOn(cdp, `(() => {
    const items = Array.from(document.querySelectorAll('[data-akari-item-kind="audio"]'));
    return items.map(el => ({ id: el.dataset.akariItemId, width: el.getBoundingClientRect().width }));
  })()`);
  record('regression-sfx', { sfxInfo });
  assert(sfxInfo.length > 0 && sfxInfo.every(s => s.width > 0),
    'SFX/BGM オーディオ項目は全て非ゼロ幅（実尺表示）でトラック高さ変更後も描画される', { sfxInfo });

  // --- 再起動保持テストの準備: t1 を 'compact' に確定させて終了 --------------------------------
  await setTierViaButton(cdp, MAIN_TRACK_ID, 'compact');
  await sleep(400);
  const finalTier = await trackHeaderInfo(cdp, MAIN_TRACK_ID);
  assert(finalTier.tier === 'compact', `${MAIN_TRACK_ID} は再起動テストのため compact で確定`, { finalTier });
  await writeFile(
    path.join(EVIDENCE_DIR, 'expected-persisted-tier.json'),
    JSON.stringify({ trackId: MAIN_TRACK_ID, tier: 'compact' }, null, 2)
  );
  record('phase1-done', { finalTier });

  await writeFile(path.join(EVIDENCE_DIR, 'run-log.json'), JSON.stringify(log, null, 2));
  cdp.close();
  console.log('PHASE1 ALL ACCEPTANCE CRITERIA PASSED (restart persistence checked separately in phase2)');
}

// ---------------------------------------------------------------------------------------------
async function runPhase2() {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const expected = await readJson(path.join(EVIDENCE_DIR, 'expected-persisted-tier.json'));
  const cdp = await connectCdp();
  record('connected-phase2', { cdpPort: CDP_PORT, workspace: WORKSPACE_DIR, expected });

  await evalOn(cdp, `(() => { window.resizeTo(1800, 2000); return true; })()`);
  await sleep(500);
  const ready = await waitReady(cdp);
  assert(ready, 'theia container ready after restart');

  const opened = await openTimeline(cdp);
  assert(opened, 'timeline widget opened via command palette after restart');
  await sleep(800);

  // --- 受け入れ条件 4: Electron 再起動後にティア保持（StorageService） -------------------------
  const restoredInfo = await trackHeaderInfo(cdp, expected.trackId);
  record('restart-persistence', { restoredInfo, expected });
  assert(!!restoredInfo && restoredInfo.tier === expected.tier,
    `Electron 再起動後、${expected.trackId} のサイズティアが ${expected.tier} のまま StorageService から復元される`,
    { restoredInfo, expected });
  const expectedHeightPx = { compact: '28px', standard: '72px', large: '116px' }[expected.tier];
  assert(restoredInfo.height === expectedHeightPx,
    `再起動後の行高(${restoredInfo.height})が期待値(${expectedHeightPx})と一致する`, { restoredInfo });

  await shot(cdp, '07-restart-persisted.png');
  await writeFile(path.join(EVIDENCE_DIR, 'run-log-phase2.json'), JSON.stringify(log, null, 2));
  cdp.close();
  console.log('PHASE2 RESTART PERSISTENCE PASSED');
}

async function main() {
  if (PHASE === 'phase1') return runPhase1();
  if (PHASE === 'phase2') return runPhase2();
  throw new Error(`unknown phase: ${PHASE}`);
}

main().catch(err => {
  console.error('FAILED', err);
  writeFile(
    path.join(EVIDENCE_DIR, `run-log-${PHASE}-partial.json`), JSON.stringify(log, null, 2)
  ).finally(() => {
    process.exit(1);
  });
});
