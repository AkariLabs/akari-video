#!/usr/bin/env node
// L1 実測ドライバ（timeline-trim-snap-lane-filter）。
// production ビルドの Electron を隔離 user-data-dir / AKARI_HOME / --remote-debugging-port で
// 起動し、生 CDP で cut-trim の右端ドラッグを実際にディスパッチする。
//
// Usage: node run-l1.mjs [--port 9531] [--evidence <dir>] [--releases 20]

import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

import { CDP, listTargets, evalOn, screenshot, keyPress } from './cdp-lib.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const evidenceRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(evidenceRoot, '..', '..');
const shellDir = path.join(repoRoot, 'apps', 'shell');
const electron = path.join(shellDir, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');
const ffmpeg = path.join(repoRoot, 'packages', 'media-bin', 'vendor', 'darwin-arm64', 'ffmpeg');

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const PORT = Number(argOf('--port', '9531'));
const EVIDENCE_DIR = path.resolve(argOf('--evidence', evidenceRoot));
const RELEASES = Number(argOf('--releases', '20'));

const REJECT_FOOTER = '移動できません（レーンが異なるか、同じ段の中で区間が重なります）。';
const REJECT_FEEDBACK = '⚠ 重なるためトリムできません';

const log = [];
let scratch;
function record(step, data = {}) {
  const entry = { t: new Date().toISOString(), step, ...data };
  log.push(entry);
  console.log(`[${step}]`, JSON.stringify(data));
}
function sanitize(text) {
  return text
    .split(repoRoot).join('<WORKTREE>')
    .split(scratch ?? ' never ').join('<TMP>')
    .split(os.homedir()).join('<HOME>');
}
function assert(cond, message, data = {}) {
  if (!cond) {
    record('ASSERTION-FAILED', { message, ...data });
    throw new Error(`assertion failed: ${message} :: ${JSON.stringify(data)}`);
  }
  record('assertion-ok', { message, ...data });
}

// ---- DOM プローブ -------------------------------------------------------
const rectOfCut = (cdp, index) => evalOn(cdp, `(() => {
  const el = document.querySelector('[data-akari-ui="timeline:cut:${index}"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
})()`);

// フッタ = ウィジェット直下で textOverflow:ellipsis を持つ唯一の div（inline style 由来）。
const footerText = (cdp) => evalOn(cdp, `(() => {
  const w = document.getElementById('akari-annotations-widget');
  if (!w) return null;
  const el = [...w.children].find(e => e.style && e.style.textOverflow === 'ellipsis');
  return el ? el.textContent : null;
})()`);

const clickUndo = (cdp) => evalOn(cdp, `(() => {
  const btn = [...document.querySelectorAll('#akari-annotations-widget button')]
    .find(b => (b.title || '').includes('元に戻す'));
  if (!btn || btn.disabled) return false;
  btn.click();
  return true;
})()`);

// timelineOverlay.append(hoverSeek, playhead, snapGuide, dragFeedback, trackInsertIndicator, ...)
const overlayChild = (cdp, index, prop) => evalOn(cdp, `(() => {
  const marker = document.querySelector('[data-testid="akari-track-insert-indicator"]');
  const overlay = marker && marker.parentElement;
  if (!overlay) return null;
  const el = overlay.children[${index}];
  return el ? ${prop} : null;
})()`);
const dragFeedbackText = (cdp) => overlayChild(cdp, 3, 'el.textContent');

const ghostState = (cdp) => evalOn(cdp, `(() => {
  const g = document.querySelector('.akari-annotations-strip-clip[style*="dashed"]');
  if (!g) return { found: false };
  const r = g.getBoundingClientRect();
  return {
    found: true,
    rejected: g.classList.contains('akari-annotations-ghost-rejected'),
    snapped: g.classList.contains('akari-annotations-ghost-snapped'),
    right: r.right
  };
})()`);

const snapGuideVisible = (cdp) => overlayChild(cdp, 2, "el.style.display !== 'none'");

// ---- 入力 ---------------------------------------------------------------
async function pressAt(cdp, x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  await sleep(20);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(20);
}
async function moveTo(cdp, fromX, toX, y, steps = 8) {
  for (let s = 1; s <= steps; s++) {
    const x = fromX + (toX - fromX) * (s / steps);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
    await sleep(12);
  }
}
async function releaseAt(cdp, x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left' });
}

async function openTimeline(cdp) {
  let found = await evalOn(cdp, `!!document.getElementById('akari-annotations-widget')`);
  for (let attempt = 0; attempt < 8 && !found; attempt++) {
    await keyPress(cdp, { key: 'F1', code: 'F1', windowsVirtualKeyCode: 112 });
    await sleep(900);
    await cdp.send('Input.insertText', { text: 'タイムラインを開く' });
    await sleep(900);
    await keyPress(cdp, { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    for (let w = 0; w < 12 && !found; w++) {
      await sleep(700);
      found = await evalOn(cdp, `!!document.getElementById('akari-annotations-widget')`);
    }
    if (!found) {
      await keyPress(cdp, { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await sleep(300);
    }
  }
  return found;
}

async function enableSnap(cdp) {
  const state = await evalOn(cdp, `(() => {
    const btn = [...document.querySelectorAll('#akari-annotations-widget button')]
      .find(b => (b.title || '').includes('マグネット'));
    if (!btn) return { found: false };
    if (btn.getAttribute('aria-pressed') !== 'true') btn.click();
    return { found: true, pressed: btn.getAttribute('aria-pressed') };
  })()`);
  await sleep(300);
  return state;
}

// ---- 本体 ---------------------------------------------------------------
// fixture(edit.json v2)の cut 索引: 0=a 1=b 2=c 3=d (V1) / 4=e 5=f 6=g 7=h (V2)。
// V1: a[0,2] の右端を同レーン b の頭 3.0 へ。競合する別レーン端は e.end/f.start = 3.0333(+1 フレーム)。
// V2: g[8,10] の右端を同レーン h の頭 11.0 へ。競合する別レーン端は d.start = 11.0333(+1 フレーム)。
const LANES = [
  { name: 'V1-track0', target: 0, boundaryCut: 1, trackId: 'v1', itemId: 'a',
    originalOut: 2, expectedOut: 3, originalDurationSec: 2, shotIndex: 1 },
  { name: 'V2-track1', target: 6, boundaryCut: 7, trackId: 'v2', itemId: 'g',
    originalOut: 10, expectedOut: 11, originalDurationSec: 2, shotIndex: 3 }
];

function itemOutOf(doc, lane) {
  const track = doc.tracks.find(t => t.id === lane.trackId);
  const item = track.items.find(i => i.id === lane.itemId);
  return { out: item.source.out, durationFrames: item.duration };
}

// 直前のトリムを取り消して初期状態へ戻す。widget 自身の undo を使う
// （外から edit.json を上書きすると自己書き込み抑止に飲まれて再読込されないことがある）。
async function restoreEdit(cdp, editPath, pristine, laneCase, pxPerSec) {
  const readOut = async () => itemOutOf(JSON.parse(await readFile(editPath, 'utf8')), laneCase).out;
  let out = await readOut();
  for (let attempt = 0; attempt < 3 && out !== laneCase.originalOut; attempt++) {
    if (!await clickUndo(cdp)) break;
    for (let w = 0; w < 40 && out !== laneCase.originalOut; w++) {
      await sleep(200);
      out = await readOut();
    }
  }
  if (out !== laneCase.originalOut) {
    await writeFile(editPath, pristine);
    for (let w = 0; w < 60 && out !== laneCase.originalOut; w++) {
      await sleep(250);
      out = await readOut();
    }
  }
  if (out !== laneCase.originalOut) return false;
  const wantWidth = laneCase.originalDurationSec * pxPerSec;
  for (let w = 0; w < 60; w++) {
    const r = await rectOfCut(cdp, laneCase.target);
    if (r && Math.abs(r.width - wantWidth) < 3) return true;
    await sleep(250);
  }
  return false;
}

async function main() {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'akari-trim-snap-lane-')));
  const project = path.join(scratch, 'project');
  const profile = path.join(scratch, 'profile');
  const config = path.join(scratch, 'config');
  const akariHome = path.join(scratch, 'akari-home');
  await cp(path.join(evidenceRoot, 'fixture'), project, { recursive: true });
  await Promise.all([mkdir(profile), mkdir(config), mkdir(akariHome), mkdir(path.join(project, 'assets'))]);

  await new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=30',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=30',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
      path.join(project, 'assets', 'source.mp4'), '-loglevel', 'error'], { stdio: 'ignore' });
    p.on('exit', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`)));
    p.on('error', reject);
  });
  const editPath = path.join(project, 'edit.json');
  const pristine = await readFile(editPath, 'utf8');
  record('workspace-ready', { releases: RELEASES, port: PORT });

  let child;
  let cdp;
  try {
    child = spawn(electron, [shellDir, project, `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`, '--no-sandbox'], {
      cwd: shellDir, env: { ...process.env, THEIA_CONFIG_DIR: config, AKARI_HOME: akariHome }, stdio: 'ignore'
    });
    record('electron-spawned', { pid: child.pid });

    let target;
    const deadline = Date.now() + 120000;
    while (!target && Date.now() < deadline) {
      try {
        const targets = await listTargets(PORT);
        target = targets.find(t => t.type === 'page' && !t.url.startsWith('devtools:'));
      } catch { /* not listening yet */ }
      if (!target) await sleep(1000);
    }
    if (!target) throw new Error('CDP page target not found');
    cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    // 帯の px/秒 を実用的な分解能（1 フレーム >= 1.5px）にするため、レイアウト幅を広げる。
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1920, height: 1200, deviceScaleFactor: 1, mobile: false
    });
    await sleep(6000);

    assert(await openTimeline(cdp), 'timeline widget opened');
    await sleep(1500);
    const snap = await enableSnap(cdp);
    assert(snap.found && snap.pressed === 'true', 'magnet (snap) turned ON', snap);
    await screenshot(cdp, path.join(EVIDENCE_DIR, '00-opened-snap-on.png'));

    let r0 = await rectOfCut(cdp, 0);
    let r1 = await rectOfCut(cdp, 1);
    for (let w = 0; w < 60 && !(r0 && r1); w++) {
      await sleep(1000);
      r0 = await rectOfCut(cdp, 0);
      r1 = await rectOfCut(cdp, 1);
    }
    if (!(r0 && r1)) {
      record('diagnostics', await evalOn(cdp, `(() => {
        const w = document.getElementById('akari-annotations-widget');
        return {
          clips: document.querySelectorAll('.akari-annotations-strip-clip').length,
          uiIds: [...document.querySelectorAll('[data-akari-ui]')].map(e => e.getAttribute('data-akari-ui')).slice(0, 40),
          widgetText: w ? w.textContent.slice(0, 900) : null
        };
      })()`));
    }
    assert(Boolean(r0 && r1), 'cut0 / cut1 bands found', { r0, r1 });
    // cut0 = a[0,2] (2 秒) / cut1 = b[3,6] (3 秒)。両方から px/秒 を出して食い違いが無いことを確かめる。
    const pxPerSec = r0.width / 2;
    const pxPerSecCheck = r1.width / 3;
    assert(Math.abs(pxPerSec - pxPerSecCheck) < 1,
      'px/sec is consistent across two clips', { pxPerSec, pxPerSecCheck });
    record('geometry', { pxPerSec, competingCandidateOffsetPx: (1 / 30) * pxPerSec, thresholdPx: 6 });
    assert(pxPerSec > 0 && (1 / 30) * pxPerSec < 6,
      'cross-lane competing edge (+1 frame) sits inside the 6px snap threshold', { pxPerSec });

    const results = [];
    for (const lane of LANES) {
      const boundaryRect = await rectOfCut(cdp, lane.boundaryCut);
      const boundaryX = boundaryRect.left;
      for (let i = 0; i < RELEASES; i++) {
        const offsetPx = -3 + (6 * i) / (RELEASES - 1);
        assert(await restoreEdit(cdp, editPath, pristine, lane, pxPerSec),
          `${lane.name} #${i + 1}: edit.json restored to the pristine state before the drag`);
        const rect = await rectOfCut(cdp, lane.target);
        const grabInset = 2;
        const startX = rect.right - grabInset;
        const y = rect.top + rect.height / 2;
        const endX = boundaryX + offsetPx - grabInset;
        await pressAt(cdp, startX, y);
        await moveTo(cdp, startX, endX, y);
        await sleep(120);
        const mid = await ghostState(cdp);
        const midFeedback = await dragFeedbackText(cdp);
        const guide = await snapGuideVisible(cdp);
        if (i === RELEASES - 1) {
          await screenshot(cdp, path.join(EVIDENCE_DIR, `0${lane.shotIndex}-${lane.name}-mid-drag.png`));
        }
        await releaseAt(cdp, endX, y);
        await sleep(500);
        const footer = await footerText(cdp);
        let after = itemOutOf(JSON.parse(await readFile(editPath, 'utf8')), lane);
        for (let w = 0; w < 25 && after.out === lane.originalOut && footer !== REJECT_FOOTER; w++) {
          await sleep(200);
          after = itemOutOf(JSON.parse(await readFile(editPath, 'utf8')), lane);
        }
        const out = after.out;
        const durationFrames = after.durationFrames;
        // 吸着ガードが無い旧経路では、境界と別レーン端(+1 フレーム)の中点より右で
        // 別レーン端が最寄りになり、同レーン重なりで拒否されていた。
        const legacyWouldReject = offsetPx > pxPerSec / 60;
        const entry = {
          lane: lane.name, release: i + 1, offsetPx: Number(offsetPx.toFixed(3)), legacyWouldReject,
          midRejected: mid.rejected === true, midSnapped: mid.snapped === true, snapGuide: guide,
          midFeedback, footer, out, durationFrames
        };
        results.push(entry);
        record('release', entry);
        assert(mid.rejected !== true && midFeedback !== REJECT_FEEDBACK,
          `${lane.name} #${i + 1} (${offsetPx.toFixed(2)}px): no overlap rejection while dragging`, entry);
        assert(footer !== REJECT_FOOTER,
          `${lane.name} #${i + 1}: no lane-overlap rejection after release`, entry);
        assert(Math.abs(out - lane.expectedOut) < 1e-6,
          `${lane.name} #${i + 1}: committed by snapping to the same-lane boundary (out=${lane.expectedOut})`, entry);
      }
      await screenshot(cdp, path.join(EVIDENCE_DIR, `0${lane.shotIndex + 1}-${lane.name}-after-release.png`));
    }

    const rejectedCount = results.filter(r => r.midRejected || r.footer === REJECT_FOOTER).length;
    const snappedCount = results.filter(r => r.midSnapped).length;
    const legacyRejectCount = results.filter(r => r.legacyWouldReject).length;
    record('summary', {
      releases: results.length, rejected: rejectedCount, snapped: snappedCount, legacyRejectCount,
      perLane: LANES.map(l => ({
        lane: l.name,
        ok: results.filter(r => r.lane === l.name && !r.midRejected && r.footer !== REJECT_FOOTER).length,
        total: results.filter(r => r.lane === l.name).length
      }))
    });
    assert(rejectedCount === 0, `no rejection across all ${results.length} releases`, { rejectedCount });
    assert(snappedCount === results.length, 'same-lane adjacent snapping still engages on every release', { snappedCount });
    assert(legacyRejectCount > 0,
      'the sampled band really contains releases the pre-fix nearest-candidate path would have rejected (derived)',
      { legacyRejectCount, total: results.length });

    const lane = LANES[0];
    assert(await restoreEdit(cdp, editPath, pristine, lane, pxPerSec), 'restored before the negative control');
    const rect = await rectOfCut(cdp, lane.target);
    const boundaryRect = await rectOfCut(cdp, lane.boundaryCut);
    const y = rect.top + rect.height / 2;
    const startX = rect.right - 2;
    const endX = boundaryRect.left + 0.5 * pxPerSec - 2;
    await pressAt(cdp, startX, y);
    await moveTo(cdp, startX, endX, y);
    await sleep(200);
    const controlMid = await ghostState(cdp);
    const controlFeedback = await dragFeedbackText(cdp);
    await screenshot(cdp, path.join(EVIDENCE_DIR, '05-control-real-overlap-rejected.png'));
    await releaseAt(cdp, endX, y);
    await sleep(700);
    const controlFooter = await footerText(cdp);
    const controlEdit = itemOutOf(JSON.parse(await readFile(editPath, 'utf8')), lane);
    record('negative-control', {
      midRejected: controlMid.rejected, midFeedback: controlFeedback, footer: controlFooter,
      out: controlEdit.out
    });
    assert(controlMid.rejected === true && controlFeedback === REJECT_FEEDBACK,
      'negative control: a真の同レーン重なりはドラッグ中に従来どおり拒否表示される');
    assert(controlFooter === REJECT_FOOTER && controlEdit.out === lane.originalOut,
      'negative control: 離しても確定されず、従来どおり拒否メッセージが出る');

    await writeFile(path.join(EVIDENCE_DIR, 'run-log.json'),
      sanitize(JSON.stringify({ releases: results, log }, null, 2)) + '\n');
    console.log('ALL ACCEPTANCE CRITERIA PASSED');
  } finally {
    if (cdp) { try { cdp.close(); } catch { /* noop */ } }
    if (child && child.pid) {
      try { process.kill(child.pid, 'SIGKILL'); } catch { /* already gone */ }
    }
    await sleep(1500);
    if (scratch && existsSync(scratch)) await rm(scratch, { recursive: true, force: true });
  }
}

main().catch(async err => {
  console.error('FAILED', err);
  await writeFile(path.join(EVIDENCE_DIR, 'run-log-partial.json'),
    sanitize(JSON.stringify({ log, error: String(err) }, null, 2)) + '\n').catch(() => undefined);
  process.exit(1);
});
