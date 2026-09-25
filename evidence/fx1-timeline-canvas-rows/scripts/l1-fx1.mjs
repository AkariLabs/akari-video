#!/usr/bin/env node
// L1（fx1-timeline-canvas-rows）: タイムラインのキャンバスの見せ方を 1 本の Electron で観測し、JSON とスクリーンショットに残す。
//   A. 同じ時刻（5 秒）に段直下の図形 3 個（別々の段）→ 「同じ時刻に N 個」の見出しが出るか・各図形がどの行に描かれるか
//   B. 写真 2 枚（image-1・空の枠 frame-1）を選んで ⌘G「キャンバスにする」→ 畳む / 開くで各チップがどの行に描かれるか
//   C. キャンバスの行の高さと字幕の行の高さ
//   D. キャンバスから 1 つ出す（時刻を保つ）・⌘Z 1 回で戻る
// 使い方: AKARI_CDP_PORT=9565 AKARI_L1_LABEL=before AKARI_L1_REPO=<基点のチェックアウト> node evidence/fx1-timeline-canvas-rows/scripts/l1-fx1.mjs
//         AKARI_CDP_PORT=9565 AKARI_L1_LABEL=after node evidence/fx1-timeline-canvas-rows/scripts/l1-fx1.mjs
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Session, makeProject, sanitizer, evidenceRoot, repoRoot, findItem, sleep } from './l1-lib.mjs';

const port = Number(process.env.AKARI_CDP_PORT ?? 9565);
const label = process.env.AKARI_L1_LABEL ?? 'after';
const outDir = path.join(evidenceRoot, label);
const FPS = 30;
const ffmpeg = process.env.AKARI_FFMPEG ?? 'ffmpeg';

// 図形は本物の置き方（shape-place の buildShapeItem）で作る。
const annotationsLib = path.join(repoRoot, 'apps', 'shell', 'extensions', 'akari-annotations', 'lib', 'common', 'shape-place.js');
const { buildShapeItem } = await import(pathToFileURL(annotationsLib).href);
const shelf = new Map(readFileSync(path.join(repoRoot, 'presets', 'shapes', 'index.jsonl'), 'utf8')
  .trimEnd().split('\n').map(line => JSON.parse(line)).map(row => [row.id, row]));
const output = { width: 1280, height: 720 };
const shape = (id, preset, x) => buildShapeItem({ preset: shelf.get(preset), id, at: 150, duration: 60, output,
  center: { x, y: 200 } });

const edit = {
  version: 2,
  output: { ...output, fps: FPS },
  sources: [{ id: 'clip', path: 'clip.mp4' }, { id: 'img-src-1', path: 'assets/image-1.png' },
    { id: 'frame-src-1', path: 'assets/frame-1.png' }],
  tracks: [
    { id: 'v1', lane: 'visual', name: 'V1', items: [
      { id: 'base', at: 0, duration: 900, source: { kind: 'media', src: 'clip', in: 0, out: 30 } }] },
    // A. 同じ時刻（5〜7 秒）に図形 3 個。重なるので段は別々（アプリで置いたときと同じ形）。
    { id: 's1', lane: 'visual', items: [shape('shape-1', 'basic-square', 300)] },
    { id: 's2', lane: 'visual', items: [shape('shape-2', 'basic-circle', 640)] },
    { id: 's3', lane: 'visual', items: [shape('shape-3', 'basic-square', 980)] },
    // B. 写真 2 枚（15〜18 秒）。別々の段。
    { id: 'p1', lane: 'visual', items: [{ id: 'image-1', name: 'image-1', at: 450, duration: 90,
      transform: { x: -250, y: 0, scale: 0.5 }, source: { kind: 'media', src: 'img-src-1', in: 0, out: 3 } }] },
    { id: 'p2', lane: 'visual', items: [{ id: 'frame-1', name: '空の枠', at: 450, duration: 90,
      transform: { x: 250, y: 0, scale: 0.5 }, source: { kind: 'media', src: 'frame-src-1', in: 0, out: 3 } }] }
  ]
};
const captions = { captions: [
  { id: 'c-0001', start: 1, end: 3, text: '字幕の行', speaker: null, sourceRef: null, edited: true, time_domain: 'output' }
] };

const obs = { label, steps: {}, checks: [] };
const check = (name, ok, data = {}) => { obs.checks.push({ name, ok: Boolean(ok), ...data }); console.log(ok ? 'PASS' : 'FAIL', name); };
const dirs = await makeProject('libcanvas-fx1-timeline-canvas-rows', edit, {
  'captions.json': `${JSON.stringify(captions, null, 2)}\n`
});
for (const [name, color] of [['image-1', '0x2a7fd2'], ['frame-1', '0x9a9a9a']]) {
  await mkdir(path.join(dirs.project, 'assets'), { recursive: true });
  const made = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi',
    '-i', `color=c=${color}:size=640x360`, '-frames:v', '1', path.join(dirs.project, 'assets', `${name}.png`)], { encoding: 'utf8' });
  if (made.status !== 0) throw new Error(`ffmpeg failed: ${made.stderr}`);
}
const clean = sanitizer(dirs);
const s = new Session(dirs, port);
await mkdir(outDir, { recursive: true });

async function waitEdit(predicate, ms = 8000) {
  const deadline = Date.now() + ms;
  let doc = await s.readEdit();
  while (!predicate(doc) && Date.now() < deadline) { await sleep(250); doc = await s.readEdit(); }
  return doc;
}

/** 左の見出しの行（トラック・木の行）と、帯の上の要素。各要素の中心がどの見出しの行に入るかを付ける。 */
async function layout() {
  return s.ev(`(() => {
    const w = document.getElementById('akari-annotations-widget');
    if (!w) return null;
    const rect = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; };
    const visible = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'; };
    const headers = [...w.querySelectorAll('.akari-track-header-row')].filter(visible).map(el => ({
      name: (el.querySelector('.akari-track-header-name')?.textContent || '').trim(),
      trackId: el.dataset.akariTimelineTrackId || null, lane: el.dataset.akariLane || null, kind: el.dataset.akariKind || null,
      track: el.dataset.akariTrack ?? null, tree: el.dataset.akariTreeTrack === 'true', rect: rect(el) }));
    const treeRows = [...w.querySelectorAll('[data-akari-tree-row-id]')].filter(el => el.closest('[data-akari-tree-track]')).filter(visible)
      .map(el => ({ id: el.dataset.akariTreeRowId, ui: el.dataset.akariUi || null, text: el.textContent.trim().slice(0, 60), rect: rect(el) }));
    const bands = [...w.querySelectorAll('.akari-track-band')].filter(visible)
      .map(el => ({ track: el.dataset.akariTrack, kind: el.dataset.akariKind, rect: rect(el) }));
    const items = [...w.querySelectorAll('[data-akari-item-kind]')].filter(el => !el.closest('.akari-track-header-row, [data-akari-tree-track]'))
      .filter(visible).map(el => ({ kind: el.dataset.akariItemKind, id: el.dataset.akariItemId ?? null,
        lane: el.dataset.akariLane ?? null, track: el.dataset.akariTrack ?? null, ui: el.getAttribute('data-akari-ui'),
        text: el.textContent.trim().slice(0, 40), className: String(el.className).slice(0, 120), rect: rect(el) }));
    const sameTime = [...w.querySelectorAll('*')].filter(el => el.children.length === 0 && /同じ時刻に\\s*\\d+\\s*個/.test(el.textContent))
      .map(el => el.textContent.trim());
    const rowOf = y => {
      const tree = treeRows.find(row => y >= row.rect.y && y < row.rect.y + row.rect.height);
      const header = headers.find(row => y >= row.rect.y && y < row.rect.y + row.rect.height);
      return { treeRow: tree ? tree.id : null, header: header ? (header.name || header.trackId) : null };
    };
    // 畳んだキャンバスの帯の上に重ねた子の印（data-akari-canvas-child）。
    const canvasChildMarks = [...w.querySelectorAll('[data-akari-canvas-child]')].filter(visible)
      .map(el => ({ id: el.dataset.akariCanvasChild, canvas: el.closest('[data-akari-item-id]')?.dataset.akariItemId ?? null,
        title: el.title || null, rect: rect(el) }));
    for (const item of items) Object.assign(item, rowOf(item.rect.y + item.rect.height / 2));
    for (const mark of canvasChildMarks) Object.assign(mark, rowOf(mark.rect.y + mark.rect.height / 2));
    return { headers, treeRows, bands, items, sameTime, canvasChildMarks };
  })()`);
}

async function timelineShot(name) {
  const r = await s.timelineRect();
  return s.screenshot(path.join(outDir, name), r ? { x: r.x, y: r.y, width: r.width, height: Math.min(r.height, 900) } : undefined);
}

/** 帯の上の、ある item を描いているチップを探す（media は cut の番号なので、段 id と時刻で当てる）。 */
function chipsFor(state, geometry, id, absSeconds) {
  return state.items.filter(item => {
    if (item.id === id) return true;
    if (item.kind !== 'cut' || !geometry) return false;
    const x = geometry.x0 + absSeconds * geometry.pxPerSec;
    return Math.abs(item.rect.x - x) <= 3;
  });
}

async function geometry() {
  return s.ev(`(() => {
    const w = document.getElementById('akari-annotations-widget');
    const el = w && w.querySelector('[data-akari-ui="timeline:cut:0"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x0: r.left, pxPerSec: r.width / 30 };
  })()`);
}

async function clickCenter(rect, modifiers = 0) {
  await s.click(rect.x + Math.min(rect.width / 2, 40), rect.y + rect.height / 2, { modifiers });
}

/** 帯の上の item のチップを見える位置へスクロールしてからクリックする（当たり判定も記録する）。 */
async function clickItem(id, modifiers = 0, button = 'left') {
  const find = `[...document.querySelectorAll('#akari-annotations-widget [data-akari-item-id="${id}"]')]
    .filter(el => !el.closest('.akari-track-header-row, [data-akari-tree-track]'))[0]`;
  await s.ev(`(() => { const el = ${find}; if (el) el.scrollIntoView({ block: 'center', inline: 'nearest' }); return Boolean(el); })()`);
  await sleep(300);
  const r = await s.ev(`(() => { const el = ${find}; if (!el) return null; const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + 10, r.y + r.height / 2);
    return { x: r.x, y: r.y, width: r.width, height: r.height, hit: Boolean(hit && el.contains(hit)) }; })()`);
  if (!r) return { id, clicked: false };
  await s.click(r.x + 10, r.y + r.height / 2, { modifiers, button });
  return { id, clicked: true, hit: r.hit };
}

async function toggleCanvas(id) {
  return s.ev(`(() => {
    const row = document.querySelector('[data-akari-tree-track] [data-akari-tree-row-id="${id}"]');
    const button = row && row.querySelector('button');
    if (!button) return false;
    button.click();
    return true;
  })()`);
}

const describe = (state, geo, ids) => Object.fromEntries(ids.map(([id, abs]) => [id,
  chipsFor(state, geo, id, abs).map(chip => ({ kind: chip.kind, header: chip.header, treeRow: chip.treeRow, rect: chip.rect, className: chip.className }))]));

try {
  await s.start();
  obs.steps.open = await s.openPreviewAndTimeline();
  await sleep(2500);
  const geo = await geometry();
  obs.steps.geometry = geo;

  // A + C: 開いた直後
  const initial = await layout();
  obs.steps.initial = initial;
  obs.steps.initialShot = await timelineShot('01-initial.png');
  const shapeChips = describe(initial, geo, [['shape-1', 5], ['shape-2', 5], ['shape-3', 5]]);
  obs.steps.shapeChips = shapeChips;
  const shapeHeaders = Object.values(shapeChips).map(list => list[0]?.header ?? null);
  check('A: 「同じ時刻に N 個」の見出しが出ない', initial.sameTime.length === 0, { sameTime: initial.sameTime });
  check('A: 3 つの図形がそれぞれ別のトラックの行に 1 つずつ描かれる',
    Object.values(shapeChips).every(list => list.length === 1) && new Set(shapeHeaders).size === 3 && !shapeHeaders.includes(null),
    { shapeHeaders });

  // B: 写真 2 枚を選んで ⌘G
  const before = await s.readEdit();
  const imageChip = chipsFor(initial, geo, 'image-1', 15).find(chip => chip.header && chip.header.length);
  const frameChip = chipsFor(initial, geo, 'frame-1', 15).filter(chip => chip !== imageChip && chip.header !== imageChip?.header)[0];
  obs.steps.pickedChips = { imageChip, frameChip };
  if (!imageChip || !frameChip) throw new Error('image-1 / frame-1 chips not found');
  obs.steps.pickClicks = [await clickItem('image-1'), await clickItem('frame-1', 8 /* shift */)];
  obs.steps.multiSelectionFooter = await s.ev(`(document.querySelector('#akari-annotations-widget .akari-annotations-footer') || {}).textContent || null`);
  await s.key('g', 'KeyG', 71, 4 /* meta */);
  const hasCanvas = doc => (doc.tracks ?? []).some(track => (track.items ?? []).some(item => item.source?.kind === 'group'));
  let grouped = await waitEdit(hasCanvas, 3000);
  obs.steps.groupedBy = hasCanvas(grouped) ? 'cmd+g' : null;
  if (!hasCanvas(grouped)) {
    // ⌘G が届かない版では、選んだチップの右クリック「キャンバスにする」で作る（同じ操作の別の入口）。
    await clickItem('image-1', 0, 'right');
    await sleep(500);
    const menu = await s.ev(`[...document.querySelectorAll('[data-akari-context-menu] [data-akari-context-item]')]
      .map(b => ({ id: b.dataset.akariContextItem, text: b.textContent.trim() }))`);
    obs.steps.chipMenu = menu;
    const item = menu.find(entry => entry.text === 'キャンバスにする');
    if (item) await s.ev(`document.querySelector('[data-akari-context-menu] [data-akari-context-item="${item.id}"]').click()`);
    grouped = await waitEdit(hasCanvas, 6000);
    obs.steps.groupedBy = hasCanvas(grouped) ? 'context-menu' : null;
  }
  const canvas = grouped.tracks.flatMap(track => track.items.map(item => ({ ...item, trackId: track.id })))
    .find(item => item.source?.kind === 'group');
  obs.steps.canvas = canvas ? { id: canvas.id, trackId: canvas.trackId, at: canvas.at, duration: canvas.duration,
    children: (canvas.items ?? []).map(child => ({ id: child.id, at: child.at, duration: child.duration })) } : null;
  check('B: ⌘G で image-1 と空の枠を子に持つキャンバスが 1 個できる（時刻 450 のまま）', canvas
    && (canvas.items ?? []).map(child => child.id).sort().join(',') === 'frame-1,image-1'
    && ['image-1', 'frame-1'].every(id => findItem(grouped, id)?.absAt === 450), obs.steps.canvas ?? {});
  if (!canvas) throw new Error('canvas not created');
  await sleep(1500);

  const collapsedState = await layout();
  obs.steps.collapsed = collapsedState;
  obs.steps.collapsedShot = await timelineShot('02-canvas-collapsed.png');
  const collapsedChips = describe(collapsedState, geo, [['image-1', 15], ['frame-1', 15], [canvas.id, 15]]);
  obs.steps.collapsedChips = collapsedChips;
  const canvasRow = collapsedState.treeRows.find(row => row.id === canvas.id);
  obs.steps.canvasRowCollapsed = canvasRow ?? null;
  const canvasHeader = collapsedState.headers.find(header => canvasRow
    && canvasRow.rect.y >= header.rect.y && canvasRow.rect.y < header.rect.y + header.rect.height);
  const inCanvas = chip => canvasRow && chip.rect.y + chip.rect.height / 2 >= canvasRow.rect.y
    && chip.rect.y + chip.rect.height / 2 < canvasRow.rect.y + canvasRow.rect.height;
  const childCollapsed = ['image-1', 'frame-1'].map(id => ({ id, chips: collapsedChips[id],
    marks: (collapsedState.canvasChildMarks ?? []).filter(mark => mark.id === id) }));
  check('B: 畳んでいるとき、2 つはキャンバスの行の中にだけ描かれる（外の行に出ない）',
    childCollapsed.every(entry => entry.chips.length + entry.marks.length > 0
      && entry.chips.every(inCanvas) && entry.marks.every(mark => mark.canvas === canvas.id && inCanvas(mark))),
    { childCollapsed: childCollapsed.map(entry => ({ id: entry.id,
      rows: entry.chips.map(chip => ({ header: chip.header, treeRow: chip.treeRow })),
      marks: entry.marks.map(mark => ({ canvas: mark.canvas, header: mark.header, treeRow: mark.treeRow, height: mark.rect.height })) })),
      canvasHeader: canvasHeader?.name ?? null });

  // 開く
  const toggled = await toggleCanvas(canvas.id);
  await sleep(1500);
  const expandedState = await layout();
  obs.steps.toggled = toggled;
  obs.steps.expanded = expandedState;
  obs.steps.expandedShot = await timelineShot('03-canvas-expanded.png');
  const expandedChips = describe(expandedState, geo, [['image-1', 15], ['frame-1', 15], [canvas.id, 15]]);
  obs.steps.expandedChips = expandedChips;
  const childRowOf = id => expandedState.treeRows.find(row => row.id === id);
  check('B: 開いたとき、2 つはそれぞれキャンバスの子の行に描かれる', toggled && ['image-1', 'frame-1'].every(id => {
    const row = childRowOf(id);
    return row && expandedChips[id].length > 0 && expandedChips[id].every(chip => chip.treeRow === id);
  }), { rows: ['image-1', 'frame-1'].map(id => ({ id, row: childRowOf(id)?.rect ?? null,
    chips: expandedChips[id].map(chip => ({ header: chip.header, treeRow: chip.treeRow })) })) });

  // C: 高さ（畳んだキャンバスの行 vs 字幕の行）
  const captionHeader = collapsedState.headers.find(header => header.kind === 'captions' || header.lane === 'captions');
  const canvasBand = collapsedChips[canvas.id]?.[0];
  obs.steps.heights = { captionHeader: captionHeader?.rect.height ?? null, canvasRow: canvasRow?.rect.height ?? null,
    canvasHeaderTrack: canvasHeader?.rect.height ?? null, canvasBand: canvasBand?.rect.height ?? null,
    childRowsExpanded: ['image-1', 'frame-1'].map(id => childRowOf(id)?.rect.height ?? null),
    normalTrack: collapsedState.headers.find(header => header.trackId === 's1')?.rect.height ?? null };
  const h = obs.steps.heights;
  check('C: キャンバスの行の高さ ≒ 字幕の行の高さ（±4px）', h.captionHeader && h.canvasRow
    && Math.abs(h.canvasRow - h.captionHeader) <= 4, h);

  // 畳み直して、D: 1 つ出す（時刻を保つ）→ ⌘Z 1 回
  await toggleCanvas(canvas.id);
  await sleep(1200);
  const grouped2 = await s.readEdit();
  const takeOut = await s.command('akari.annotations.takeOutOfCanvas', { id: 'image-1' }).catch(error => ({ ok: false, error: String(error) }));
  obs.steps.takeOutCommand = takeOut;
  let afterOut = await waitEdit(doc => findItem(doc, 'image-1')?.parentId === null, 4000);
  if (findItem(afterOut, 'image-1')?.parentId !== null) {
    // コマンドが無い版では、子の行の右クリック「キャンバスから出す」で出す。
    await toggleCanvas(canvas.id);
    await sleep(1000);
    const row = (await layout()).treeRows.find(entry => entry.id === 'image-1');
    if (row) {
      await s.click(row.rect.x + 30, row.rect.y + row.rect.height / 2, { button: 'right' });
      await sleep(500);
      const menu = await s.ev(`[...document.querySelectorAll('[data-akari-context-menu] [data-akari-context-item]')]
        .map(b => ({ id: b.dataset.akariContextItem, text: b.textContent.trim() }))`);
      obs.steps.childMenu = menu;
      const out = menu.find(entry => entry.text === 'キャンバスから出す');
      if (out) await s.ev(`document.querySelector('[data-akari-context-menu] [data-akari-context-item="${out.id}"]').click()`);
    }
    afterOut = await waitEdit(doc => findItem(doc, 'image-1')?.parentId === null, 6000);
  }
  const outHit = findItem(afterOut, 'image-1');
  check('D: 1 つ出すと段直下へ・絶対時刻 450 のまま', outHit && outHit.parentId === null && outHit.absAt === 450,
    { parentId: outHit?.parentId, absAt: outHit?.absAt, trackId: outHit?.trackId });
  obs.steps.afterOutShot = await timelineShot('04-after-take-out.png');
  // タイムラインにフォーカスを返してから ⌘Z
  const strip = obs.steps.initial.bands.find(band => band.kind) ?? null;
  if (strip) await s.click(strip.rect.x + 5, strip.rect.y + 2);
  await s.key('z', 'KeyZ', 90, 4 /* meta */);
  const undone = await waitEdit(doc => JSON.stringify(doc) === JSON.stringify(grouped2), 6000);
  check('D: ⌘Z 1 回で出す前の edit.json に戻る', JSON.stringify(undone) === JSON.stringify(grouped2));
  await s.key('z', 'KeyZ', 90, 4 /* meta */);
  const undone2 = await waitEdit(doc => JSON.stringify(doc) === JSON.stringify(before), 6000);
  check('D: もう 1 回の ⌘Z で「キャンバスにする」の前に戻る', JSON.stringify(undone2) === JSON.stringify(before));
  obs.steps.afterUndoShot = await timelineShot('05-after-undo.png');
} catch (error) {
  obs.error = String(error?.stack ?? error);
  console.error(error);
} finally {
  obs.leftoverProcesses = await s.stop();
  await writeFile(path.join(outDir, 'observations.json'), `${clean(JSON.stringify(obs, null, 2))}\n`);
  await s.cleanup();
}
console.log(JSON.stringify({ label, pass: obs.checks.filter(c => c.ok).length, fail: obs.checks.filter(c => !c.ok).length, error: obs.error ?? null }));
