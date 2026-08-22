#!/usr/bin/env node
// 3 症状の「再現するかしないか」を同一手順・同一 fixture で実測する記録専用プローブ。
// 修正前ビルド（HEAD の akari-annotations）と修正後ビルドの両方で走らせ、差を比較する。
// アサーションは持たない（修正前は落ちるのが期待値のため）。実 DOM のみを読む。
//
// Usage: node probe-symptoms.mjs <cdpPort> <workspaceDir> <evidenceDir> <label>

import { setTimeout as sleep } from 'node:timers/promises';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { CDP, listTargets, evalOn, screenshot, keyPress, resizeViewport } from './cdp-lib.mjs';

const [, , cdpPortArg, workspaceDirArg, evidenceDirArg, labelArg, phaseArg] = process.argv;
const PHASE = phaseArg || 'all'; // 's31' | 's2' | 'all'
const CDP_PORT = Number(cdpPortArg);
const WORKSPACE_DIR = workspaceDirArg;
const EVIDENCE_DIR = evidenceDirArg;
const LABEL = labelArg || 'probe';
const EDIT_JSON_PATH = path.join(WORKSPACE_DIR, 'edit.json');

const out = { label: LABEL, steps: [] };
function record(step, data) { out.steps.push({ step, ...data }); console.log(`[${step}]`, JSON.stringify(data)); }
async function readJson(p) { return JSON.parse(await readFile(p, 'utf8')); }

async function bandRects(main) {
  return evalOn(main, `(() => {
    const strip = document.getElementById('akari-annotations-widget')
      .children[1].children[1].children[1].children[0];
    return Array.from(strip.querySelectorAll('.akari-track-band')).map(b => {
      const r = b.getBoundingClientRect();
      return { id: b.dataset.akariLane, kind: b.dataset.akariKind, top: r.top, bottom: r.bottom, height: r.height };
    });
  })()`);
}
async function clipRects(main) {
  return evalOn(main, `Array.from(document.querySelectorAll('.akari-annotations-strip-clip'))
    .filter(el => el.dataset.akariItemKind === 'cut')
    .map(el => { const r = el.getBoundingClientRect();
      return { id: el.dataset.akariItemId, top: r.top, bottom: r.bottom, left: r.left, width: r.width, height: r.height }; })`);
}
async function indicator(main) {
  return evalOn(main, `(() => {
    const els = document.querySelectorAll('[data-testid="akari-track-insert-indicator"]');
    let el = els[0];
    if (!el) {
      // 修正前ビルドには data-testid が無い。timelineOverlay の 4 番目の子が
      // trackInsertIndicator（append 順: playhead, snapGuide, dragFeedback, trackInsertIndicator, ...）。
      const w = document.getElementById('akari-annotations-widget');
      el = w.children[1].children[1].children[2].children[3];
    }
    if (!el) return { found: false };
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { found: true, visible: cs.display !== 'none', top: r.top, background: cs.backgroundColor };
  })()`);
}
async function feedback(main) {
  return evalOn(main, `(() => {
    const w = document.getElementById('akari-annotations-widget');
    return w.children[1].children[1].children[2].children[2].textContent;
  })()`);
}
async function ghost(main) {
  return evalOn(main, `(() => {
    const g = document.querySelector('.akari-annotations-strip-clip[style*="dashed"]');
    return g ? { found: true, rejected: g.classList.contains('akari-annotations-ghost-rejected') } : { found: false };
  })()`);
}
async function press(m, x, y) {
  await m.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' }); await sleep(40);
  await m.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(40);
}
async function moveTo(m, x, y) {
  for (let s = 0; s < 6; s++) { await m.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 }); await sleep(12); }
  await sleep(60);
}
async function release(m, x, y) { await m.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left' }); await sleep(700); }
async function openTimeline(m) {
  let found = await evalOn(m, `!!document.getElementById('akari-annotations-widget')`);
  for (let a = 0; a < 6 && !found; a++) {
    await keyPress(m, { key: 'F1', code: 'F1', windowsVirtualKeyCode: 112 }); await sleep(900);
    await m.send('Input.insertText', { text: 'タイムラインを開く' }); await sleep(900);
    await keyPress(m, { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    for (let w = 0; w < 12 && !found; w++) { await sleep(600); found = await evalOn(m, `!!document.getElementById('akari-annotations-widget')`); }
  }
  return found;
}
function shape(e) { return e.tracks.map(t => ({ id: t.id, items: Array.isArray(t.items) ? t.items.map(i => i.id) : null })); }
function inBand(clips, band) { return clips.find(c => c.top >= band.top - 2 && c.bottom <= band.bottom + 4); }

async function main() {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const t = (await listTargets(CDP_PORT)).find(x => x.type === 'page');
  const cdp = new CDP(t.webSocketDebuggerUrl);
  await cdp.connect(); await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  record('viewport', await resizeViewport(cdp, 1440, 1250));
  await sleep(1200);
  record('opened', { ok: await openTimeline(cdp) });
  await sleep(800);
  await screenshot(cdp, path.join(EVIDENCE_DIR, `${LABEL}-00-opened.png`));

  const edit0 = await readJson(EDIT_JSON_PATH);
  const bands = await bandRects(cdp);
  const clips = await clipRects(cdp);
  record('baseline', { tracks: shape(edit0), bands, clips });

  const bV3 = bands.find(b => b.id === 'v3');
  const bV2 = bands.find(b => b.id === 'v2');
  const c3 = inBand(clips, bV3);
  const gx = c3.left + c3.width / 2, gy = c3.top + c3.height / 2;

  // --- 症状 3: V2 の本体へ入ろうとしたときに緑線が出るか ---
  if (PHASE === 's31' || PHASE === 'all') {
  await press(cdp, gx, gy);
  for (const [name, y] of [['v2-top+1', bV2.top + 1], ['v2-top+3', bV2.top + 3], ['v2-top+8', bV2.top + 8],
                           ['v2-center', bV2.top + bV2.height / 2], ['v2-bottom-3', bV2.bottom - 3]]) {
    await moveTo(cdp, gx, y);
    record('s3-probe', { name, y, indicator: await indicator(cdp), feedback: await feedback(cdp), ghost: await ghost(cdp) });
  }
  await screenshot(cdp, path.join(EVIDENCE_DIR, `${LABEL}-01-s3-over-v2.png`));
  await release(cdp, gx, bV2.top + bV2.height / 2);
  await sleep(600);
  const editS3 = await readJson(EDIT_JSON_PATH);
  record('s3-result', { tracks: shape(editS3) });
  await screenshot(cdp, path.join(EVIDENCE_DIR, `${LABEL}-02-s3-after-drop.png`));
  }

  // --- 症状 2: 最上段よりさらに上へ ---
  if (PHASE === 's2' || PHASE === 'all') {
  const bands2 = await bandRects(cdp);
  const clips2 = await clipRects(cdp);
  const top = [...bands2].sort((a, b) => a.top - b.top)[0];
  const cutsBands = [...bands2].filter(b => b.kind === 'cuts').sort((a, b) => a.top - b.top);
  let anyClip;
  for (const b of cutsBands) { const c = inBand(clips2, b); if (c) { anyClip = c; break; } }
  record('s2-grab', { topBand: top.id, grabbedClipId: anyClip && anyClip.id });
  const gx2 = anyClip.left + anyClip.width / 2, gy2 = anyClip.top + anyClip.height / 2;
  await press(cdp, gx2, gy2);
  await moveTo(cdp, gx2, top.top - 4);
  record('s2-near-above', { y: top.top - 4, topBand: top.id, indicator: await indicator(cdp), feedback: await feedback(cdp), ghost: await ghost(cdp) });
  const far = Math.max(8, top.top - 120);
  await moveTo(cdp, gx2, far);
  record('s2-far-above', { y: far, distancePx: top.top - far, indicator: await indicator(cdp), feedback: await feedback(cdp), ghost: await ghost(cdp) });
  await screenshot(cdp, path.join(EVIDENCE_DIR, `${LABEL}-03-s2-far-above.png`));
  await release(cdp, gx2, far);
  await sleep(600);
  const editS2 = await readJson(EDIT_JSON_PATH);
  record('s2-result', { tracks: shape(editS2) });
  await screenshot(cdp, path.join(EVIDENCE_DIR, `${LABEL}-04-s2-after-drop.png`));
  }

  await writeFile(path.join(EVIDENCE_DIR, `probe-${LABEL}.json`), JSON.stringify(out, null, 2));
  cdp.close();
  console.log(`PROBE DONE (${LABEL})`);
}
main().catch(err => {
  console.error('PROBE FAILED', err);
  out.error = String(err && err.stack || err);
  writeFile(path.join(EVIDENCE_DIR, `probe-${LABEL}.json`), JSON.stringify(out, null, 2)).finally(() => process.exit(1));
});
