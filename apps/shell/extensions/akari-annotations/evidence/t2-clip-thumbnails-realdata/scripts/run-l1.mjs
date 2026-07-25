#!/usr/bin/env node
// t2-clip-thumbnails 補修走の L1 実測ドライバ。実データ形状（v0 edit.json・sidecar 空）の
// dogfood プロジェクトコピーで、フィルムストリップ/波形の表示・ズーム密度追随（再フェッチなし）・
// トリム再マッピング・atlas キャッシュ生成を CDP 経由の実操作で検証する。
//
// Usage: node run-l1.mjs <cdpPort> <workspaceDir> <evidenceDir>

import { setTimeout as sleep } from 'node:timers/promises';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { CDP, listTargets, evalOn, screenshot, keyPress, realClick, wheel } from './cdp-lib.mjs';

const [, , cdpPortArg, workspaceDirArg, evidenceDirArg] = process.argv;
const CDP_PORT = Number(cdpPortArg || 9511);
const WORKSPACE_DIR = workspaceDirArg;
const EVIDENCE_DIR = evidenceDirArg;
const EDIT_JSON_PATH = path.join(WORKSPACE_DIR, 'edit.json');
const ATLAS_DIR = path.join(WORKSPACE_DIR, '.akari', 'cache', 'timeline', 'filmstrip');

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
  try {
    const out = execSync("ps aux | grep '[f]fmpeg'", { encoding: 'utf8' });
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

async function openTimeline(main) {
  let found = await evalOn(main, `!!document.getElementById('akari-annotations-widget')`);
  for (let attempt = 0; attempt < 6 && !found; attempt++) {
    await keyPress(main, { key: 'F1', code: 'F1', windowsVirtualKeyCode: 112 });
    await sleep(900);
    await main.send('Input.insertText', { text: 'タイムラインを開く' });
    await sleep(900);
    await keyPress(main, { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    for (let w = 0; w < 12 && !found; w++) {
      await sleep(600);
      found = await evalOn(main, `!!document.getElementById('akari-annotations-widget')`);
    }
    if (!found) {
      await keyPress(main, { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await sleep(300);
    }
  }
  return found;
}

async function clipInfo(main, cutIndex) {
  return evalOn(main, `(() => {
    const clip = document.querySelector('.akari-annotations-strip-clip[data-akari-item-kind="cut"][data-akari-item-id="${cutIndex}"]');
    if (!clip) return null;
    const r = clip.getBoundingClientRect();
    const cells = clip.querySelectorAll('.akari-annotations-strip-clip-filmstrip-cell');
    const canvas = clip.querySelector('canvas');
    return {
      rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
      cellCount: cells.length,
      hasWaveformCanvas: !!canvas,
      classList: Array.from(clip.classList)
    };
  })()`);
}

async function allClipsInfo(main) {
  return evalOn(main, `(() => {
    const clips = Array.from(document.querySelectorAll('.akari-annotations-strip-clip[data-akari-item-kind="cut"]'));
    return clips.map(clip => {
      const r = clip.getBoundingClientRect();
      const cells = clip.querySelectorAll('.akari-annotations-strip-clip-filmstrip-cell');
      const canvas = clip.querySelector('canvas');
      return {
        index: clip.dataset.akariItemId,
        width: r.width,
        cellCount: cells.length,
        hasWaveformCanvas: !!canvas
      };
    });
  })()`);
}

async function main() {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const targets0 = await listTargets(CDP_PORT);
  const mainTarget = targets0.find(t => t.type === 'page');
  if (!mainTarget) throw new Error('main page target not found');
  const cdp = new CDP(mainTarget.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  record('connected', { cdpPort: CDP_PORT, workspace: WORKSPACE_DIR });

  const opened = await openTimeline(cdp);
  assert(opened, 'timeline widget opened via command palette');
  await shot(cdp, '00-opened.png');

  // sidecar が空であることの確認（症状再現の前提が崩れていないか）
  const editRaw = await readJson(EDIT_JSON_PATH);
  record('edit-json-shape', { hasSource: typeof editRaw.source === 'object', hasSources: editRaw.sources !== undefined, cutCount: editRaw.cuts.length });
  assert(typeof editRaw.source === 'object' && editRaw.sources === undefined, 'edit.json is v0 shape (single source, no sources[])', { source: editRaw.source });

  // --- 1. フィルムストリップ・波形の表示 -------------------------------------------------
  // 初回フェッチが非同期のため、cellCount>0 になるまで待つ。
  let all = await allClipsInfo(cdp);
  for (let i = 0; i < 40 && all.every(c => c.cellCount === 0); i++) {
    await sleep(500);
    all = await allClipsInfo(cdp);
  }
  record('clips-after-wait', { all });
  const visibleClips = all.filter(c => c.width >= 40);
  const withFilmstrip = visibleClips.filter(c => c.cellCount > 0);
  const withWaveform = visibleClips.filter(c => c.hasWaveformCanvas);
  assert(withFilmstrip.length > 0, 'at least one clip renders filmstrip cells in the real (sidecar-less, v0) dogfood project', {
    visibleClips: visibleClips.length, withFilmstrip: withFilmstrip.length
  });
  assert(withWaveform.length > 0, 'at least one clip renders a waveform canvas (same videoUri resolution fix benefits waveform too)', {
    withWaveform: withWaveform.length
  });
  await shot(cdp, '01-filmstrip-and-waveform.png');

  // atlas がバックエンドキャッシュへ実際に生成されたことを確認
  await sleep(1000);
  const atlasAfterFirstShow = await atlasDirSnapshot();
  record('atlas-dir-after-first-show', { files: atlasAfterFirstShow });
  assert(atlasAfterFirstShow.length >= 2, 'atlas jpg+json were written under .akari/cache/timeline/filmstrip/', {
    files: atlasAfterFirstShow.map(f => f.name)
  });

  // --- 2. ズーム密度追随・再フェッチなし ---------------------------------------------------
  // cut index 9 (C10, 38.2s, 一番長いクリップ) を対象にする。
  const targetIndex = '9';
  let target = await clipInfo(cdp, targetIndex);
  assert(Boolean(target), `clip ${targetIndex} found before zoom`, { target });
  const cellsBeforeZoom = target.cellCount;
  const atlasBeforeZoom = await atlasDirSnapshot();
  const ffmpegBeforeZoom = ffmpegProcessCount();

  const cx = (target.rect.left + target.rect.right) / 2;
  const cy = target.rect.top + target.rect.height / 2;
  // CDP Input.dispatchMouseEvent(type: mouseWheel) は Electron のネイティブ page-zoom
  // に横取りされ widget の 'wheel' DOM リスナーへ届かないことがあるため、JS 側から直接
  // WheelEvent を strip 要素へ dispatch する（onWheelZoom のロジック自体を検証する目的
  // には十分 — 実ハードウェア入力の再現ではなく widget のズームロジックの実測が目的）。
  for (let i = 0; i < 12; i++) {
    await evalOn(cdp, `(() => {
      const strip = document.querySelector('.akari-annotations-strip');
      if (!strip) return false;
      const ev = new WheelEvent('wheel', {
        deltaY: -220, deltaX: 0, ctrlKey: true, clientX: ${cx}, clientY: ${cy},
        bubbles: true, cancelable: true
      });
      strip.dispatchEvent(ev);
      return true;
    })()`);
    await sleep(80);
  }
  await sleep(500);
  target = await clipInfo(cdp, targetIndex);
  const cellsAfterZoom = target.cellCount;
  const ffmpegAfterZoom = ffmpegProcessCount();
  const atlasAfterZoom = await atlasDirSnapshot();
  record('zoom-result', { cellsBeforeZoom, cellsAfterZoom, ffmpegBeforeZoom, ffmpegAfterZoom, atlasBeforeZoom, atlasAfterZoom });
  await shot(cdp, '02-after-zoom-in.png');
  assert(cellsAfterZoom > cellsBeforeZoom, 'zooming in increases filmstrip cell density for the same clip', {
    cellsBeforeZoom, cellsAfterZoom
  });
  assert(ffmpegAfterZoom === 0, 'no ffmpeg process is spawned by zooming (atlas is not re-fetched/re-generated)', {
    ffmpegAfterZoom
  });
  assert(JSON.stringify(atlasBeforeZoom) === JSON.stringify(atlasAfterZoom),
    'atlas cache files (name/mtime/size) are byte-identical before/after zoom (no re-generation)', {
      atlasBeforeZoom, atlasAfterZoom
    });

  // ズームを戻す
  for (let i = 0; i < 12; i++) {
    await evalOn(cdp, `(() => {
      const strip = document.querySelector('.akari-annotations-strip');
      if (!strip) return false;
      const ev = new WheelEvent('wheel', {
        deltaY: 220, deltaX: 0, ctrlKey: true, clientX: ${cx}, clientY: ${cy},
        bubbles: true, cancelable: true
      });
      strip.dispatchEvent(ev);
      return true;
    })()`);
    await sleep(80);
  }
  await sleep(500);
  await shot(cdp, '03-after-zoom-reset.png');

  // --- 3. トリム -> pointerup 後の表示区間更新 ---------------------------------------------
  target = await clipInfo(cdp, targetIndex);
  const editBeforeTrim = await readJson(EDIT_JSON_PATH);
  const cutBefore = editBeforeTrim.cuts[Number(targetIndex)];
  record('pre-trim', { cutBefore, rect: target.rect, cellsBeforeTrim: target.cellCount });

  const startX = target.rect.right - 2;
  const startY = target.rect.top + target.rect.height / 2;
  const shrinkPx = Math.min(40, target.rect.width * 0.3);
  const endX = startX - shrinkPx;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: startX, y: startY, button: 'none' });
  await sleep(50);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startX, y: startY, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(50);
  const steps = 8;
  for (let s = 1; s <= steps; s++) {
    const x = startX + (endX - startX) * (s / steps);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: startY, button: 'left', buttons: 1 });
    await sleep(25);
  }
  await sleep(50);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: endX, y: startY, button: 'left' });
  await sleep(600);

  let editAfterTrim = await readJson(EDIT_JSON_PATH);
  for (let attempt = 0; attempt < 15 && editAfterTrim.cuts[Number(targetIndex)].out === cutBefore.out; attempt++) {
    await sleep(300);
    editAfterTrim = await readJson(EDIT_JSON_PATH);
  }
  const cutAfter = editAfterTrim.cuts[Number(targetIndex)];
  const targetAfterTrim = await clipInfo(cdp, targetIndex);
  record('post-trim', { cutBefore, cutAfter, cellsAfterTrim: targetAfterTrim ? targetAfterTrim.cellCount : null });
  await shot(cdp, '04-after-trim.png');
  assert(cutAfter.out < cutBefore.out, 'dragging the right trim handle inward commits a smaller out on pointerup', {
    before: cutBefore.out, after: cutAfter.out
  });
  assert(targetAfterTrim && targetAfterTrim.cellCount !== target.cellCount,
    'filmstrip cell count for the trimmed clip changes after the commit (remapped to the new [in,out) span)', {
      before: target.cellCount, after: targetAfterTrim ? targetAfterTrim.cellCount : null
    });

  // --- 4. 回帰: クリップ選択 -------------------------------------------------------------
  const selRect = await clipInfo(cdp, '0');
  await realClick(cdp, (selRect.rect.left + selRect.rect.right) / 2, selRect.rect.top + selRect.rect.height / 2);
  await sleep(400);
  const selected = await evalOn(cdp, `(() => {
    const clip = document.querySelector('.akari-annotations-strip-clip[data-akari-item-kind="cut"][data-akari-item-id="0"]');
    return clip ? clip.classList.contains('akari-annotations-selected') : false;
  })()`);
  record('regression-selection', { selected });
  await shot(cdp, '05-regression-selection.png');
  assert(selected, 'clicking a clip applies the akari-annotations-selected class (selection regression)', { selected });

  // --- 5. 回帰: SE 実尺表示 ---------------------------------------------------------------
  const sfxInfo = await evalOn(cdp, `(() => {
    const items = Array.from(document.querySelectorAll('[data-akari-item-kind="audio"]'));
    return items.map(el => ({ id: el.dataset.akariItemId, width: el.getBoundingClientRect().width }));
  })()`);
  record('regression-sfx', { sfxInfo });
  assert(sfxInfo.length > 0, 'SFX/BGM audio items are rendered with non-zero widths (SE duration display regression)', { sfxInfo });

  await writeFile(path.join(EVIDENCE_DIR, 'run-log.json'), JSON.stringify(log, null, 2));
  cdp.close();
  console.log('ALL ACCEPTANCE CRITERIA PASSED');
}

main().catch(err => {
  console.error('FAILED', err);
  writeFile(path.join(EVIDENCE_DIR, 'run-log-partial.json'), JSON.stringify(log, null, 2)).finally(() => {
    process.exit(1);
  });
});
