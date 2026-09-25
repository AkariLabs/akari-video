#!/usr/bin/env node
// L1 BEFORE（c0b-canvas-ui）: 手で書いた空の group がタイムライン・プレビューに出ないこと、
// group のチップがドラッグで動かないこと、行の D&D で別の group へ入れると時刻がずれることを記録する。
// 使い方: AKARI_CDP_PORT=9548 node evidence/c0b-canvas-ui/scripts/l1-before.mjs
import path from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import { Session, makeProject, sanitizer, evidenceRoot, findItem, sleep } from './l1-lib.mjs';

const port = Number(process.env.AKARI_CDP_PORT ?? 9548);
const label = process.env.AKARI_L1_LABEL ?? 'before';
const outDir = path.join(evidenceRoot, label);

const tag = `<div class="tag"><style>.tag{position:absolute;inset:0;display:grid;place-items:center;font:700 44px system-ui,sans-serif}
.tag span{padding:14px 26px;border-radius:12px;background:#162131;color:#fff}</style><span data-akari-slot="title">タグ</span></div>\n`;

const edit = {
  version: 2,
  output: { width: 1280, height: 720, fps: 30 },
  sources: [{ id: 'clip', path: 'clip.mp4' }],
  tracks: [
    { id: 'v1', lane: 'visual', name: 'V1', items: [
      { id: 'base', at: 0, duration: 900, source: { kind: 'media', src: 'clip', in: 0, out: 30 } }] },
    { id: 'g', lane: 'visual', name: 'V2', items: [
      { id: 'G1', at: 0, duration: 240, name: 'まとまり1', source: { kind: 'group' }, items: [
        { id: 'h1', at: 30, duration: 150, transform: { x: -300, y: -200, scale: 1, rotate: 0 },
          source: { kind: 'html', path: 'overlays/tag.html', params: { title: 'h1' } } }] },
      { id: 'G2', at: 300, duration: 240, name: 'まとまり2', source: { kind: 'group' }, items: [
        { id: 'h2', at: 0, duration: 240, transform: { x: 300, y: 200, scale: 1, rotate: 0 },
          source: { kind: 'html', path: 'overlays/tag.html', params: { title: 'h2' } } }] },
      { id: 'G3', at: 600, duration: 150, name: '空の枠', source: { kind: 'group' }, items: [] }
    ] }
  ]
};

const obs = { label, steps: {} };
const dirs = await makeProject('libcanvas-c0b-before', edit, { 'overlays/tag.html': tag });
const clean = sanitizer(dirs);
const s = new Session(dirs, port);
await mkdir(outDir, { recursive: true });
try {
  await s.start();
  obs.steps.open = await s.openPreviewAndTimeline();
  await sleep(2500);

  // 1. 空の group（G3）はタイムラインに出るか
  let tl = await s.timelineState();
  obs.steps.timeline_initial = { rows: tl.rows, chips: tl.chips };
  obs.steps.emptyGroupInTimeline = {
    row: tl.rows.some(r => r.id === 'G3'), chip: tl.chips.some(c => c.id === 'G3')
  };
  await s.screenshot(path.join(outDir, '01-timeline-initial.png'));

  // 2. 空の group はプレビューの選択の木に出るか（プレイヘッドを 21 秒へ）
  await s.seek(21);
  const tree21 = await s.previewTree();
  obs.steps.previewTreeAt21 = tree21;
  obs.steps.emptyGroupInPreviewTree = tree21.some(n => n.id === 'G3');
  const pr = await s.previewRect();
  if (pr) await s.screenshot(path.join(outDir, '02-preview-at-21s-empty-group.png'), pr);
  await s.seek(12);
  obs.steps.previewTreeAt12 = await s.previewTree();

  // 3. group（G2）のチップを右へドラッグ → at が変わるか
  tl = await s.timelineState();
  const chip = tl.chips.find(c => c.id === 'G2');
  obs.steps.g2ChipBefore = chip ?? null;
  const beforeDoc = await s.readEdit();
  if (chip) {
    const y = chip.rect.y + chip.rect.height / 2;
    const x = chip.rect.x + chip.rect.width / 2;
    await s.drag({ x, y }, { x: x + 120, y });
    await sleep(1200);
  }
  const afterChip = await s.readEdit();
  obs.steps.chipDrag = {
    g2AtBefore: findItem(beforeDoc, 'G2')?.item.at, g2AtAfter: findItem(afterChip, 'G2')?.item.at,
    moved: findItem(beforeDoc, 'G2')?.item.at !== findItem(afterChip, 'G2')?.item.at
  };
  await s.screenshot(path.join(outDir, '03-after-group-chip-drag.png'));

  // 4. 行の D&D: G1 を展開 → h1 の行を G2 の行の中へ落とす → h1 の絶対時刻
  await s.ev(`(() => { const t=document.querySelector('[data-akari-tree-toggle="G1"]'); if(t && t.textContent==='▸') t.click();
    const u=document.querySelector('[data-akari-tree-toggle="G2"]'); if(u && u.textContent==='▸') u.click(); return true; })()`);
  await sleep(1200);
  tl = await s.timelineState();
  obs.steps.rowsExpanded = tl.rows;
  const h1Row = tl.rows.find(r => r.id === 'h1');
  const g2Row = tl.rows.find(r => r.id === 'G2');
  const docBeforeDnD = await s.readEdit();
  if (h1Row && g2Row) {
    await s.drag({ x: h1Row.rect.x + 40, y: h1Row.rect.y + h1Row.rect.height / 2 },
      { x: g2Row.rect.x + 40, y: g2Row.rect.y + g2Row.rect.height / 2 }, { steps: 16 });
    await sleep(1500);
  }
  const docAfterDnD = await s.readEdit();
  const b = findItem(docBeforeDnD, 'h1');
  const a = findItem(docAfterDnD, 'h1');
  obs.steps.rowDnD = {
    rowsFound: Boolean(h1Row && g2Row),
    before: b ? { parentId: b.parentId, at: b.item.at, absAtFrames: b.absAt, absAtSec: b.absAt / 30 } : null,
    after: a ? { parentId: a.parentId, at: a.item.at, absAtFrames: a.absAt, absAtSec: a.absAt / 30 } : null,
    absoluteTimeShiftedSec: a && b ? (a.absAt - b.absAt) / 30 : null
  };
  await s.screenshot(path.join(outDir, '04-after-row-dnd.png'));
} catch (error) {
  obs.error = String(error?.stack ?? error);
} finally {
  obs.leftoverProcesses = await s.stop();
  await writeFile(path.join(outDir, 'observations.json'), clean(JSON.stringify(obs, null, 2)) + '\n');
  await s.cleanup();
  console.log(clean(JSON.stringify({ emptyTimeline: obs.steps.emptyGroupInTimeline, emptyPreview: obs.steps.emptyGroupInPreviewTree,
    chipDrag: obs.steps.chipDrag, rowDnD: obs.steps.rowDnD, error: obs.error, leftover: obs.leftoverProcesses }, null, 2)));
}
