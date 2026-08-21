#!/usr/bin/env node
// L1 (real machine, Electron + CDP) driver for task 2026-08-20-v2-audio-tracks.
//
// Confirms empirically, against the real running app, the two UI-facing acceptance criteria from
// the owner's field-report addendum (tasks/2026-08-20-v2-audio-tracks/task.md):
//   - SFX / narration / BGM render on separate timeline rows (not merged into one "A1" row, which
//     was the reported bug).
//   - Rows can be reordered (z authority = tracks[] array order, per the 5-decision cited in the
//     task contract) and audio rows follow that same rule.
// Also drives one real write-path interaction (editing an SFX clip's gain_db via the inspector) to
// confirm the mutation-routing fix (edit-v2-mutations.ts's *PreferV2 functions) actually reaches
// tracks[].items[] on disk in the real running app, not just in unit tests.
//
// Honest scoping note (same spirit as evidence/render-path-unification-l1's documented drag-bug
// workaround): the gain field is a custom "scrub-number" widget (pointerdown+drag scrubs the
// value; a plain click below the drag threshold swaps in a real <input> for direct typing). We
// drive it as a real user would for the click-to-type path (real CDP click, then a real DOM
// input value + blur to commit -- not a character-by-character key-code simulation, since what's
// under test here is whether the commit reaches the right data location, not keystroke fidelity).
//
// Usage: node run-l1.mjs <phase:separated|reordered> <cdpPort> <workspaceDir> <evidenceDir>

import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CDP, evalOn, keyPress, listTargets, realClick, screenshot } from '../../timeline-tracks/scripts/cdp-lib.mjs';

const [, , phaseArg, cdpPortArg, workspaceDir, evidenceDir] = process.argv;
const VALID_PHASES = ['separated', 'reordered'];
const cdpPort = Number(cdpPortArg || 9333);
if (!VALID_PHASES.includes(phaseArg) || !workspaceDir || !evidenceDir) {
  throw new Error(`usage: run-l1.mjs <phase:${VALID_PHASES.join('|')}> <cdpPort> <workspaceDir> <evidenceDir>`);
}

const projectDir = path.join(workspaceDir, 'project');
const editPath = path.join(projectDir, 'edit.json');
const log = [];

function record(step, data) {
  const entry = { t: new Date().toISOString(), step, ...data };
  log.push(entry);
  console.log(`[${step}]`, JSON.stringify(data));
}

function assert(condition, message, data = {}) {
  if (!condition) {
    record('ASSERTION-FAILED', { message, ...data });
    throw new Error(`assertion failed: ${message} :: ${JSON.stringify(data)}`);
  }
  record('assertion-ok', { message, ...data });
}

async function dismissOnboardingIfPresent(main) {
  // 「このフォルダを AKARI Video プロジェクトとして使いますか？」というオンボーディング
  // モーダルが出て、応答するまでタイムラインへ中身が読み込まれないことがある
  // （evidence/render-path-unification-l1/scripts/run-l1-realdrag.mjs の
  // dismissProjectConsentIfPresent と同じ既知事象。同スクリプトは「使う」ではなく
  // 「開くだけ」を押しており、直接 .click() する形が実証済みなのでそれに合わせる）。
  const dismissed = await evalOn(main, `(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const target = buttons.find(b => b.textContent && b.textContent.trim() === '開くだけ');
    if (target) { target.click(); return true; }
    return false;
  })()`);
  if (dismissed) {
    record('onboarding-modal-dismissed', {});
    await sleep(500);
    return true;
  }
  record('onboarding-modal-absent', {});
  return false;
}

async function openTimeline(main) {
  let found = await evalOn(main, `Boolean(document.getElementById('akari-annotations-widget'))`);
  for (let attempt = 0; attempt < 3 && !found; attempt++) {
    await keyPress(main, { key: 'F1', code: 'F1', windowsVirtualKeyCode: 112 });
    await sleep(500);
    await main.send('Input.insertText', { text: 'タイムラインを開く' });
    await sleep(500);
    await keyPress(main, { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    for (let wait = 0; wait < 20 && !found; wait++) {
      await sleep(250);
      found = await evalOn(main, `Boolean(document.getElementById('akari-annotations-widget'))`);
    }
  }
  assert(found, 'timeline widget opened');
}

async function shot(main, name) {
  await screenshot(main, path.join(evidenceDir, name));
}

async function readEditJson() {
  return JSON.parse(await readFile(editPath, 'utf8'));
}

async function audioItemRects(main) {
  return evalOn(main, `Array.from(document.querySelectorAll('[data-akari-item-kind="audio"]')).map(el => {
    const r = el.getBoundingClientRect();
    return { id: el.dataset.akariItemId, top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width) };
  })`);
}

async function main_() {
  await mkdir(evidenceDir, { recursive: true });
  const targets = await listTargets(cdpPort);
  const pageTarget = targets.find(t => t.type === 'page' && !t.url.startsWith('devtools://'));
  assert(Boolean(pageTarget), 'found electron page target', { targets: targets.map(t => t.url) });
  const main = new CDP(pageTarget.webSocketDebuggerUrl);
  await main.connect();
  await main.send('Page.enable');
  await main.send('Runtime.enable');
  await main.send('DOM.enable');

  // Same technique as evidence/render-path-unification-l1/scripts/run-l1-realdrag.mjs: the
  // default window is too small to show all 4 audio tracks of this fixture at once, so a rect
  // computed for an off-screen (but still DOM-present, so getBoundingClientRect() happily
  // returns numbers for it) clip silently misses the click -- no exception, elementFromPoint()
  // just returns null. Resize before touching any geometry.
  await evalOn(main, `(() => { window.resizeTo(1800, 2000); return true; })()`);
  await sleep(300);

  // let the onboarding modal (if any) mount before probing; poll a few times since first paint
  // can lag CDP readiness.
  let dismissed = false;
  for (let attempt = 0; attempt < 6 && !dismissed; attempt++) {
    await sleep(1000);
    dismissed = await dismissOnboardingIfPresent(main);
  }
  await openTimeline(main);
  await sleep(1500); // let the strip finish its first layout pass
  await shot(main, `${phaseArg}-00-boot.png`);

  const diagnostics = await evalOn(main, `(() => ({
    itemKindCounts: Array.from(document.querySelectorAll('[data-akari-item-kind]'))
      .reduce((acc, el) => { acc[el.dataset.akariItemKind] = (acc[el.dataset.akariItemKind] || 0) + 1; return acc; }, {}),
    trackBandCount: document.querySelectorAll('.akari-track-band').length,
    trackHeaderIds: Array.from(document.querySelectorAll('[data-akari-timeline-track-id]')).map(el => el.dataset.akariTimelineTrackId),
    stripChildCount: document.querySelector('.akari-annotations-strip')?.children.length ?? null,
    bodyText: document.body.innerText.slice(0, 400)
  }))()`);
  record('diagnostics', diagnostics);

  const rects = await audioItemRects(main);
  record('audio-item-rects', { rects });
  assert(rects.length === 4, 'exactly 4 audio clips rendered (sfx-1, sfx-2, narration-1, bgm-1)', { rects, diagnostics });

  // BGM の DOM id は宣言 id (この fixture では "bgm-1") ではなく常に固定文字列 "bgm" になる。
  // packages/edit-store/src/internal-model.ts の buildV2Item (role==='bgm' 分岐) が
  // EditAudioBgm.id を 'bgm' 固定で合成しており（凍結変換器 packages/edit-store/src/migrate/index.ts
  // も移行後の bgm item id を常に 'bgm' で発行するため、実データはそもそも乖離しない）、
  // これは「BGM 高々1」の意味論的シングルトンを表示・選択レイヤで固定 id に正規化する意図的な設計
  // （apps/shell/extensions/akari-annotations/src/common/edit-v2-mutations.ts の
  // findAudioItemIdByRole が書き込み時に実 id へ解決するので永続化は正しい raw id に届く。
  // コード中のコメントも明記: 「BGM は旧表示 id が常に "bgm" のため raw id と異なる場合がある」）。
  // したがって本テストの正しい期待値は 'bgm'（宣言 id 'bgm-1' ではない）。
  const byId = Object.fromEntries(rects.map(r => [r.id, r]));
  const sfx1 = byId['sfx-1'];
  const sfx2 = byId['sfx-2'];
  const narration1 = byId['narration-1'];
  const bgm1 = byId['bgm'];
  assert(Boolean(sfx1 && sfx2 && narration1 && bgm1), 'all 4 expected clip ids found', { byId });

  assert(sfx1.top === sfx2.top, 'sfx-1 and sfx-2 share the same row (same audio track)', { sfx1, sfx2 });
  assert(sfx1.top !== narration1.top, 'sfx row and narration row are visually distinct (the reported bug)', { sfx1, narration1 });
  assert(sfx1.top !== bgm1.top, 'sfx row and bgm row are visually distinct (the reported bug)', { sfx1, bgm1 });
  assert(narration1.top !== bgm1.top, 'narration row and bgm row are visually distinct (the reported bug)', { narration1, bgm1 });

  await writeFile(path.join(evidenceDir, `rects-${phaseArg}.json`), `${JSON.stringify({ rects }, null, 2)}\n`);

  if (phaseArg === 'reordered') {
    const before = JSON.parse(await readFile(path.join(evidenceDir, 'rects-separated.json'), 'utf8'));
    const beforeById = Object.fromEntries(before.rects.map(r => [r.id, r]));
    assert(
      narration1.top === beforeById['bgm'].top && bgm1.top === beforeById['narration-1'].top,
      'reordering tracks[] (narration/bgm swapped) swaps their displayed rows accordingly',
      { before: beforeById, after: byId }
    );
    record('DONE', { phase: phaseArg });
    main.close();
    return;
  }

  // ---- real write-path interaction: edit sfx-1's gain_db via the inspector, verify on disk ----
  const beforeEdit = await readEditJson();
  const sfxTrackBefore = beforeEdit.tracks.find(t => t.id === 'a-sfx');
  const sfx1Before = sfxTrackBefore.items.find(i => i.id === 'sfx-1');
  assert(sfx1Before.gain_db === undefined, 'sfx-1 has no declared gain_db before the edit (baseline)', { sfx1Before });
  assert(beforeEdit.audio === undefined, 'this fixture was authored directly as v2 -- no legacy top-level audio block exists at all', {});

  const clickX = sfx1.left + Math.min(20, sfx1.width / 2);
  const clickY = sfx1.top + 6;
  await realClick(main, clickX, clickY);
  await sleep(400);
  const inspectorOpen = await evalOn(main, `Boolean(document.querySelector('.akari-inspector-row-scrub[aria-label="gain_db"]'))`);
  if (!inspectorOpen) {
    const debugInfo = await evalOn(main, `(() => {
      const el = document.elementFromPoint(${clickX}, ${clickY});
      return {
        elementAtPoint: el ? { tag: el.tagName, cls: el.className, id: el.dataset ? el.dataset.akariItemId : undefined } : null,
        inspectorRoot: Boolean(document.querySelector('.akari-inspector-widget, [id*="inspector"]')),
        selectedSelectorGuess: document.querySelector('.akari-annotations-strip-audio-sfx')
          ? document.querySelector('.akari-annotations-strip-audio-sfx').outerHTML.slice(0, 300) : null,
        allInspectorRowLabels: Array.from(document.querySelectorAll('[aria-label]')).map(e => e.getAttribute('aria-label')).slice(0, 40)
      };
    })()`);
    record('debug-inspector-not-open', { clickX, clickY, debugInfo });
    await shot(main, `${phaseArg}-01-DEBUG-inspector-not-open.png`);
  }
  assert(inspectorOpen, 'inspector opened with a gain_db scrub field after clicking sfx-1');
  await shot(main, `${phaseArg}-01-inspector-open.png`);

  const scrubRect = await evalOn(main, `(() => {
    const el = document.querySelector('.akari-inspector-row-scrub[aria-label="gain_db"]');
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  await realClick(main, scrubRect.x, scrubRect.y);
  await sleep(200);
  const inputPresent = await evalOn(main, `Boolean(document.querySelector('input.akari-inspector-row-input'))`);
  assert(inputPresent, 'click (below drag threshold) swapped the scrub div for a real text <input>');

  const TARGET_GAIN = -7.5;
  await evalOn(main, `(() => {
    const input = document.querySelector('input.akari-inspector-row-input');
    input.value = '${TARGET_GAIN}';
  })()`);
  await evalOn(main, `document.querySelector('input.akari-inspector-row-input').blur()`);
  await sleep(600);
  await shot(main, `${phaseArg}-02-after-gain-edit.png`);

  const afterEdit = await readEditJson();
  const sfxTrackAfter = afterEdit.tracks.find(t => t.id === 'a-sfx');
  const sfx1After = sfxTrackAfter?.items.find(i => i.id === 'sfx-1');
  assert(Boolean(sfx1After), 'sfx-1 still present in tracks[].items[] after the edit', { sfxTrackAfter });
  assert(sfx1After.gain_db === TARGET_GAIN, 'gain_db edit landed in tracks[].items[] (not a silent no-op on an empty legacy array)', { sfx1After, TARGET_GAIN });
  assert(afterEdit.audio === undefined, 'no legacy top-level audio block was created by the edit', { audio: afterEdit.audio });

  const sfx2After = sfxTrackAfter.items.find(i => i.id === 'sfx-2');
  assert(sfx2After.gain_db === undefined, 'sfx-2 (untouched sibling) was not affected by the sfx-1 edit', { sfx2After });

  record('DONE', { phase: phaseArg });
  main.close();
}

main_()
  .then(() => {
    console.log(`PHASE_RESULT=PASS phase=${phaseArg}`);
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    console.log(`PHASE_RESULT=FAIL phase=${phaseArg}`);
    process.exit(1);
  });
