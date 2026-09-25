#!/usr/bin/env node
// L1 AFTER（c0b-canvas-ui）: 受け入れ条件の実機シナリオを 1 本の Electron で通し、観測値と判定を JSON に残す。
// 使い方: AKARI_CDP_PORT=9548 node evidence/c0b-canvas-ui/scripts/l1-after.mjs
import path from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import { Session, makeProject, sanitizer, evidenceRoot, findItem, sleep } from './l1-lib.mjs';

const port = Number(process.env.AKARI_CDP_PORT ?? 9548);
const label = process.env.AKARI_L1_LABEL ?? 'after';
const outDir = path.join(evidenceRoot, label);
const FPS = 30;
const NAVY = '#1b2a5c';

const tag = `<div class="tag"><style>.tag{position:absolute;inset:0;display:grid;place-items:center;font:700 44px system-ui,sans-serif}
.tag span{padding:14px 26px;border-radius:12px;background:#d24b2a;color:#fff}</style><span data-akari-slot="title">タグ</span></div>\n`;
const html = (id, at, duration, x, y, title) => ({ id, at, duration, transform: { x, y, scale: 1, rotate: 0 },
  source: { kind: 'html', path: 'overlays/tag.html', params: { title } } });

const edit = {
  version: 2,
  output: { width: 1280, height: 720, fps: FPS },
  sources: [{ id: 'clip', path: 'clip.mp4' }],
  tracks: [
    { id: 'v1', lane: 'visual', name: 'V1', items: [
      { id: 'base', at: 0, duration: 900, source: { kind: 'media', src: 'clip', in: 0, out: 30 } }] },
    { id: 'v2', lane: 'visual', name: 'V2', items: [html('tel1', 330, 105, -250, -150, 'テロップ')] },
    // 同じ時刻（25〜27 秒）に 4 個。重なるので段は別々（アプリで置いたときと同じ形）。
    { id: 'f1', lane: 'visual', items: [html('same1', 750, 60, -400, 200, '1')] },
    { id: 'f2', lane: 'visual', items: [html('same2', 750, 60, -130, 200, '2')] },
    { id: 'f3', lane: 'visual', items: [html('same3', 750, 60, 130, 200, '3')] },
    { id: 'f4', lane: 'visual', items: [html('same4', 750, 60, 400, 200, '4')] }
  ]
};
const captions = { captions: [
  { id: 'c-0001', start: 11, end: 12.5, text: '置いた文字', speaker: null, sourceRef: null, edited: true, time_domain: 'output' }
] };

const obs = { label, steps: {}, checks: [] };
const check = (name, ok, data = {}) => { obs.checks.push({ name, ok: Boolean(ok), ...data }); console.log(ok ? 'PASS' : 'FAIL', name); };
const dirs = await makeProject('libcanvas-c0b-after', edit, {
  'overlays/tag.html': tag, 'captions.json': `${JSON.stringify(captions, null, 2)}\n`
});
const clean = sanitizer(dirs);
let s = new Session(dirs, port);
await mkdir(outDir, { recursive: true });

const canvasOf = doc => {
  const all = [];
  const walk = items => { for (const item of items ?? []) { if (item.source?.kind === 'group') all.push(item); walk(item.items); } };
  for (const track of doc.tracks) walk(track.items);
  return all;
};

async function waitEdit(predicate, ms = 8000) {
  const deadline = Date.now() + ms;
  let doc = await s.readEdit();
  while (!predicate(doc) && Date.now() < deadline) { await sleep(250); doc = await s.readEdit(); }
  return doc;
}

async function geometry() {
  // base（0〜30 秒の media）の帯から px/秒 と 0 秒の x を出す。
  return s.ev(`(() => {
    const w = document.getElementById('akari-annotations-widget');
    const el = [...w.querySelectorAll('[data-akari-item-kind]')].find(e => e.dataset.akariItemId === 'base'
      || (e.getAttribute('data-akari-ui') || '') === 'timeline:cut:0');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x0: r.left, pxPerSec: r.width / 30, top: r.top, bottom: r.bottom };
  })()`);
}

async function emptyStripY(x) {
  return s.ev(`(() => {
    const w = document.getElementById('akari-annotations-widget');
    const r = w.getBoundingClientRect();
    const hits = [];
    for (let y = r.top + 40; y < r.bottom - 4; y += 3) {
      const el = document.elementFromPoint(${x}, y);
      if (!el || !w.contains(el)) continue;
      if (el.closest('[data-akari-item-kind], .akari-beat-marker, .akari-track-header-row, .akari-annotations-pin, button, [data-akari-tree-track]')) continue;
      if (!el.closest('.akari-annotations-strip, [class*="strip"]')) continue;
      hits.push(y);
    }
    return hits;
  })()`);
}

async function contextItems() {
  return s.ev(`[...document.querySelectorAll('[data-akari-context-menu] [data-akari-context-item]')]
    .map(b => ({ id: b.dataset.akariContextItem, text: b.textContent.trim() }))`);
}
async function clickContextItem(id) {
  return s.ev(`(() => { const b = document.querySelector('[data-akari-context-menu] [data-akari-context-item="${id}"]');
    if (!b) return false; b.click(); return true; })()`);
}
async function rectOf(selector) {
  // 短いタイムラインの外にあるチップは当たり判定が取れないので、先に見える位置へスクロールする。
  const r = await s.ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right }; })()`);
  if (r) await sleep(250);
  return r ? s.ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
    const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right }; })()`) : null;
}
async function canvasChip(id) { return rectOf(`.akari-timeline-tree-item[data-akari-item-id="${id}"]`); }
async function rightClick(x, y) { await s.click(x, y, { button: 'right' }); await sleep(400); }

async function setInspector(name, value, eventName) {
  return s.ev(`(() => {
    const root = document.querySelector('[data-akari-ui="field:inspector-${name}"]');
    if (!root) return { ok: false, reason: 'field not found' };
    const input = root.matches('input,select') ? root : root.querySelector(${JSON.stringify(eventName === 'color' ? 'input[type=color]' : 'input,select')});
    if (!input) return { ok: false, reason: 'input not found' };
    input.value = ${JSON.stringify(value)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event(${JSON.stringify(eventName === 'blur' ? 'blur' : 'change')}, { bubbles: true }));
    return { ok: true };
  })()`);
}

async function previewOverlays() {
  return s.pv(`(() => {
    const stage = document.getElementById('overlay-stage');
    if (!stage) return null;
    const out = [];
    for (const el of stage.querySelectorAll('*')) {
      const id = el.dataset && (el.dataset.overlayId || el.dataset.akariOverlayId || el.dataset.id);
      if (!id) continue;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      out.push({ id, display: cs.display, visibility: cs.visibility, opacity: cs.opacity, z: cs.zIndex,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        bg: el.firstElementChild ? getComputedStyle(el.firstElementChild).backgroundColor : cs.backgroundColor });
    }
    return out;
  })()`);
}
async function emptyHint() {
  return s.pv(`(() => { const el = document.querySelector('[data-akari-ui="preview-empty-canvas"]'); if (!el) return null;
    const r = el.getBoundingClientRect(); return { display: getComputedStyle(el).display, text: el.textContent,
    border: getComputedStyle(el).borderStyle, rect: { w: Math.round(r.width), h: Math.round(r.height) } }; })()`);
}
async function waitHint(expectShown, ms = 6000) {
  const t0 = Date.now();
  let h = await emptyHint();
  while (Date.now() - t0 < ms && (h?.display === 'flex') !== expectShown) { await sleep(300); h = await emptyHint(); }
  return { ...h, settledMs: Date.now() - t0 };
}
async function rightClickMenu(x, y) {
  await rightClick(x, y);
  let items = await contextItems();
  if (!items.length) { await sleep(800); await rightClick(x, y); items = await contextItems(); items.retried = true; }
  return items;
}
async function previewShot(name) {
  const pr = await s.previewRect();
  return pr ? s.screenshot(path.join(outDir, name), pr) : null;
}
async function timelineShot(name) {
  const tr = await s.timelineRect();
  return tr ? s.screenshot(path.join(outDir, name), tr) : s.screenshot(path.join(outDir, name));
}
async function visibleWordsCheck(where) {
  const main = await s.ev(`document.body.innerText`);
  const pv = await s.pv(`document.body.innerText`).catch(() => '');
  const hits = [];
  for (const word of ['グループ', 'group', 'Group']) {
    for (const [src, text] of [['main', main], ['preview', pv]]) {
      const i = text.indexOf(word);
      if (i >= 0) hits.push({ src, word, context: text.slice(Math.max(0, i - 30), i + 30) });
    }
  }
  obs.steps[`words_${where}`] = hits;
  return hits;
}

const snapshots = [];
const near = (a, b, tol) => typeof a === 'number' && Math.abs(a - b) <= tol;
async function focusTimelineEmpty() {
  const w = await s.timelineRect();
  const g0 = await geometry();
  const ys = await emptyStripY(g0.x0 + 28.5 * g0.pxPerSec);
  if (ys.length) await s.click(g0.x0 + 28.5 * g0.pxPerSec, ys[ys.length - 1]);
  else if (w) await s.click(w.x + w.width - 40, w.y + 30);
}
try {
  await s.start();
  obs.steps.open = await s.openPreviewAndTimeline();
  await sleep(2500);
  await s.seek(0);
  let g = await geometry();
  obs.steps.geometry = g;
  const xAt = t => g.x0 + t * g.pxPerSec;
  snapshots.push(await s.readEdit());

  // 1. 0:10〜0:15 を範囲選択 → 右クリック「キャンバスを作る」
  const ys = await emptyStripY(xAt(12.5));
  obs.steps.emptyYs = ys.slice(0, 5);
  const y = ys[0];
  await s.drag({ x: xAt(10), y }, { x: xAt(15), y }, { steps: 10 });
  await rightClick(xAt(12.5), y);
  obs.steps.emptyMenu = await contextItems();
  check('empty-area menu offers キャンバスを作る and ここにキャンバスを作る',
    obs.steps.emptyMenu.some(i => i.text === 'キャンバスを作る') && obs.steps.emptyMenu.some(i => i.text === 'ここにキャンバスを作る'), { items: obs.steps.emptyMenu });
  await clickContextItem('create-canvas-range');
  let doc = await waitEdit(d => canvasOf(d).length > 0);
  const K = canvasOf(doc)[0];
  obs.steps.created = K ?? null;
  // 1 px = 約 2.3 フレーム（実測の px/秒で決まる）なので、範囲の端は ±1 px 相当まで許す。
  const frameTol = Math.ceil(FPS / g.pxPerSec) + 1;
  check('range canvas created at ~10s for ~5s (fixed, origin user, empty)', K && near(K.at, 300, frameTol) && near(K.duration, 150, 2 * frameTol)
    && K.source.canvas?.origin === 'user' && K.source.canvas?.durationMode === 'fixed' && (K.items ?? []).length === 0, { K, frameTol });
  snapshots.push(doc);
  const KID = K?.id;
  await sleep(1200);
  await rectOf(`.akari-timeline-tree-item[data-akari-item-id="${KID}"]`);
  const kRow = await s.ev(`(() => { const el = document.querySelector('[data-akari-tree-track] [data-akari-tree-row-id="${KID}"]');
    return el ? { text: el.textContent.trim(), bg: el.style.backgroundImage } : null; })()`);
  const kChip = await s.ev(`(() => { const el = document.querySelector('.akari-timeline-tree-item[data-akari-item-id="${KID}"]');
    return el ? { text: el.textContent.trim(), bg: el.style.backgroundImage || getComputedStyle(el).backgroundImage } : null; })()`);
  obs.steps.emptyCanvasRow = { row: kRow, chip: kChip };
  check('empty canvas appears as 1 row with hatched band', kRow && kChip && /repeating-linear-gradient/.test(kChip.bg), obs.steps.emptyCanvasRow);
  await timelineShot('01-empty-canvas-timeline.png');

  // 2. インスペクター: 名前・意図・背景（紺）
  const chip = await canvasChip(KID);
  await s.click(chip.x + chip.width / 2, chip.y + chip.height / 2);
  await s.command('akari.inspector.open', undefined);
  await sleep(1500);
  obs.steps.inspectorFields = await s.ev(`[...document.querySelectorAll('[data-akari-ui^="field:inspector-canvas"]')].map(e => e.getAttribute('data-akari-ui'))`);
  obs.steps.setName = await setInspector('canvas-name', 'オープニング', 'blur');
  doc = await waitEdit(d => canvasOf(d)[0]?.name === 'オープニング'); snapshots.push(doc);
  await sleep(1500);
  obs.steps.rowAfterRename = await s.ev(`(() => { const el = document.querySelector('[data-akari-tree-track] [data-akari-tree-row-id="${KID}"]'); return el ? el.textContent.trim() : null; })()`);
  check('tree row header follows the rename without reopening', (obs.steps.rowAfterRename ?? '').includes('オープニング'), { row: obs.steps.rowAfterRename });
  obs.steps.setIntent = await setInspector('canvas-intent', 'ここにタイトルを入れる', 'blur');
  doc = await waitEdit(d => canvasOf(d)[0]?.source.canvas?.intent === 'ここにタイトルを入れる'); snapshots.push(doc);
  await sleep(800);
  await timelineShot('01b-empty-canvas-named.png');
  await s.activatePreview(); await sleep(800); await s.refreshView();
  await s.seek(12.5);
  obs.steps.emptyHintAt12 = await waitHint(true);
  await s.seek(8);
  obs.steps.emptyHintAt8 = await waitHint(false);
  await s.seek(12.5);
  await previewShot('02-preview-empty-canvas-hint.png');
  check('preview shows dashed frame + intent only inside the empty canvas', obs.steps.emptyHintAt12?.display === 'flex'
    && obs.steps.emptyHintAt12?.text === 'ここにタイトルを入れる' && obs.steps.emptyHintAt12?.border === 'dashed'
    && obs.steps.emptyHintAt8?.display === 'none', { at12: obs.steps.emptyHintAt12, at8: obs.steps.emptyHintAt8 });
  obs.steps.previewTreeHasEmptyCanvas = (await s.previewTree()).some(n => n.id === KID);
  check('empty canvas is a node in the preview selection tree', obs.steps.previewTreeHasEmptyCanvas);

  await s.command('akari.inspector.open', undefined); await sleep(1000);
  obs.steps.setBgMode = await setInspector('canvas-background-mode', '色', 'change');
  doc = await waitEdit(d => canvasOf(d)[0]?.source.canvas?.background?.type === 'color'); snapshots.push(doc);
  await sleep(1200);
  obs.steps.setBgColor = await setInspector('canvas-background-color', NAVY, 'color');
  doc = await waitEdit(d => canvasOf(d)[0]?.source.canvas?.background?.color?.toLowerCase() === NAVY); snapshots.push(doc);
  const named = canvasOf(doc)[0];
  check('inspector wrote name / intent / navy background', named?.name === 'オープニング'
    && named?.source.canvas?.intent === 'ここにタイトルを入れる' && named?.source.canvas?.background?.color?.toLowerCase() === NAVY,
    { canvas: named, fields: obs.steps.inspectorFields });
  await sleep(1000);

  // 3. 字幕 1 行・html 1 個を入れる（右クリック「キャンバスへ入れる」）
  const captionChip = await s.ev(`(() => { const w = document.getElementById('akari-annotations-widget');
    const el = [...w.querySelectorAll('[data-akari-item-kind="caption"]')].find(e => e.textContent.includes('置いた文字'));
    if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, kind: el.dataset.akariItemKind, id: el.dataset.akariItemId }; })()`);
  obs.steps.captionChip = captionChip;
  if (captionChip) {
    obs.steps.captionMenu = await rightClickMenu(captionChip.x + captionChip.width / 2, captionChip.y + captionChip.height / 2);
    obs.steps.captionMenuRetried = Boolean(obs.steps.captionMenu.retried);
    await clickContextItem('put-canvas');
  }
  doc = await waitEdit(d => (canvasOf(d)[0]?.items ?? []).some(i => i.source?.kind === 'caption')); snapshots.push(doc);
  const Kd = canvasOf(doc)[0];
  const capChild = (Kd?.items ?? []).find(i => i.source?.kind === 'caption');
  const bag = doc.tracks.flatMap(t => t.items).find(i => i.source?.kind === 'captions');
  check('placed caption put into canvas as caption item + excluded from the bag (no double draw)',
    capChild && Kd.at + capChild.at === 330 && capChild.duration === 45 && bag?.source.exclude?.includes('c-0001'), { capChild, bag, menu: obs.steps.captionMenu });
  await sleep(1000);
  const telChip = await rectOf('#akari-annotations-widget [data-akari-ui="timeline:overlay:tel1"]');
  if (telChip) {
    obs.steps.telMenu = await rightClickMenu(telChip.x + telChip.width / 2, telChip.y + telChip.height / 2);
    obs.steps.telMenuRetried = Boolean(obs.steps.telMenu.retried);
    await clickContextItem('put-canvas');
  }
  doc = await waitEdit(d => (canvasOf(d)[0]?.items ?? []).some(i => i.id === 'tel1')); snapshots.push(doc);
  const telIn = findItem(doc, 'tel1');
  check('html put into canvas keeping absolute time and transform', telIn?.parentId === KID && telIn.absAt === 330
    && telIn.item.duration === 105 && telIn.item.transform?.x === -250 && telIn.item.transform?.y === -150, { telIn, menu: obs.steps.telMenu });
  await sleep(1500);
  let tl = await s.timelineState();
  obs.steps.rowsAfterPut = tl.rows;
  const kRowAfter = tl.rows.find(r => r.id === KID);
  check('canvas with content = 1 row + ▸', kRowAfter && /▸|▾/.test(kRowAfter.text), { row: kRowAfter });
  await timelineShot('03-canvas-with-content.png');
  await s.activatePreview(); await sleep(800); await s.refreshView();
  await s.seek(12);
  obs.steps.overlaysAt12 = await previewOverlays();
  obs.steps.emptyHintAfterPut = await emptyHint();
  await previewShot('04-preview-canvas-navy-background.png');
  await s.seek(11.75);
  obs.steps.captionInCanvas = await s.pv(`(() => { const p = document.getElementById('caption-plate'); if (!p) return null;
    const line = p.querySelector('.akari-caption__line') || p; const r = line.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { text: p.innerText, display: getComputedStyle(p).display, onTop: Boolean(hit && p.contains(hit)), hit: hit ? (hit.id || hit.className || hit.tagName) : null,
      count: [...document.querySelectorAll('.akari-caption__line')].filter(e => e.textContent.includes('置いた文字')).length }; })()`);
  await previewShot('04b-preview-caption-in-canvas-11_75s.png');
  check('caption inside the canvas is visible above the canvas background, drawn once', obs.steps.captionInCanvas?.text?.includes('置いた文字')
    && obs.steps.captionInCanvas.onTop && obs.steps.captionInCanvas.count === 1, obs.steps.captionInCanvas ?? {});
  obs.steps.previewTreeLabel = (await s.previewTree()).find(n => n.id === KID)?.label;
  check('preview selection label is the canvas name, not the internal id', obs.steps.previewTreeLabel === 'オープニング', { label: obs.steps.previewTreeLabel });
  await s.seek(12);
  const bgRec = (obs.steps.overlaysAt12 ?? []).find(o => o.id === `${KID}:background`);
  const telRec12 = (obs.steps.overlaysAt12 ?? []).find(o => o.id === 'tel1');
  check('navy background record is drawn, below the html child', bgRec && bgRec.display !== 'none' && bgRec.visibility !== 'hidden'
    && telRec12 && (Number(bgRec.z) || 0) <= (Number(telRec12.z) || 0), { bgRec, telRec12, hint: obs.steps.emptyHintAfterPut });

  // 4. チップを 0:20 へ動かす
  g = await geometry();
  const telRelBefore = telIn?.item.at;
  const beforeMove = await s.readEdit();
  let c = await canvasChip(KID);
  const moveDx = (20 - Kd.at / FPS) * g.pxPerSec;
  await s.drag({ x: c.x + c.width / 2, y: c.y + c.height / 2 }, { x: c.x + c.width / 2 + moveDx, y: c.y + c.height / 2 }, { steps: 14 });
  doc = await waitEdit(d => canvasOf(d)[0]?.at !== Kd.at); snapshots.push(doc);
  const moved = canvasOf(doc)[0];
  const telMoved = findItem(doc, 'tel1');
  check('canvas chip drag moves canvas to ~20s; children move with it (relative at unchanged)', near(moved?.at, 600, frameTol)
    && telMoved?.item.at === telRelBefore && telMoved.absAt === moved.at + telRelBefore, { at: moved?.at, tel: telMoved?.item.at, frameTol });
  await sleep(1500);
  await timelineShot('05-canvas-moved-to-20s.png');

  // 5. 右端で尺を 3 秒に
  const beforeResize = await s.readEdit();
  c = await canvasChip(KID);
  const resizeDx = ((moved.at + 90) - (moved.at + moved.duration)) / FPS * g.pxPerSec;
  await s.drag({ x: c.right - 4, y: c.y + c.height / 2 }, { x: c.right - 4 + resizeDx, y: c.y + c.height / 2 }, { steps: 12 });
  doc = await waitEdit(d => canvasOf(d)[0]?.duration !== moved.duration); snapshots.push(doc);
  const shrunk = canvasOf(doc)[0];
  const telShrunk = findItem(doc, 'tel1');
  check('right edge sets duration to ~3s; children unchanged', near(shrunk?.duration, 90, frameTol) && telShrunk?.item.at === telRelBefore
    && telShrunk?.item.duration === 105, { duration: shrunk?.duration, tel: telShrunk?.item });
  await sleep(1500);
  await timelineShot('06-canvas-shrunk-3s.png');
  const kStart = shrunk.at / FPS; const kEnd = (shrunk.at + shrunk.duration) / FPS;
  const telStart = (shrunk.at + telRelBefore) / FPS; const telEnd = telStart + 105 / FPS;
  const inside = (Math.max(kStart, telStart) + Math.min(kEnd, telEnd)) / 2;
  const outside = (kEnd + telEnd) / 2;
  obs.steps.clipTimes = { kStart, kEnd, telStart, telEnd, inside, outside };
  await s.activatePreview(); await sleep(800); await s.refreshView();
  await s.seek(inside);
  obs.steps.overlaysInside = await previewOverlays();
  await previewShot('07-preview-inside-canvas-range.png');
  await s.seek(outside);
  obs.steps.overlaysOutside = await previewOverlays();
  await previewShot('08-preview-outside-canvas-range.png');
  const telAt = list => (list ?? []).find(o => o.id === 'tel1');
  const vis = o => o && o.display !== 'none' && o.visibility !== 'hidden' && o.opacity !== '0';
  check('child part outside the shortened canvas range is not drawn', vis(telAt(obs.steps.overlaysInside)) && !vis(telAt(obs.steps.overlaysOutside)),
    { inside: telAt(obs.steps.overlaysInside), outside: telAt(obs.steps.overlaysOutside), times: obs.steps.clipTimes });
  const telRectInside = telAt(obs.steps.overlaysInside)?.rect;

  // 6. 中身を 1 個「キャンバスから出す」
  const beforeTakeOut = await s.readEdit();
  await s.ev(`(() => { const t = document.querySelector('[data-akari-tree-toggle="${KID}"]'); if (t && t.textContent === '▸') t.click(); return true; })()`);
  await sleep(1200);
  const telTreeChip = await rectOf('.akari-timeline-tree-item[data-akari-item-id="tel1"]');
  const telRow = telTreeChip ? null : await rectOf('[data-akari-tree-track] [data-akari-tree-row-id="tel1"]');
  const target = telTreeChip ?? telRow;
  obs.steps.takeOutTarget = { telRow, telTreeChip };
  if (target) {
    await rightClick(target.x + Math.min(20, target.width / 2), target.y + target.height / 2);
    obs.steps.takeOutMenu = await contextItems();
    const detachId = (obs.steps.takeOutMenu.find(i => i.text === 'キャンバスから出す') ?? {}).id;
    if (detachId) await clickContextItem(detachId);
  }
  doc = await waitEdit(d => findItem(d, 'tel1')?.parentId !== KID); snapshots.push(doc);
  const out = findItem(doc, 'tel1');
  check('take out keeps absolute time and transform', out && out.parentId === null && out.absAt === shrunk.at + telRelBefore
    && out.item.duration === 105 && out.item.transform?.x === -250 && out.item.transform?.y === -150, { out, menu: obs.steps.takeOutMenu });
  await s.activatePreview(); await sleep(800); await s.refreshView();
  await s.seek(inside);
  const telRectOut = telAt(await previewOverlays())?.rect;
  check('on-screen position unchanged after take out', telRectInside && telRectOut
    && Math.abs(telRectInside.x - telRectOut.x) <= 1 && Math.abs(telRectInside.y - telRectOut.y) <= 1, { telRectInside, telRectOut });
  await previewShot('09-preview-after-take-out.png');

  // 7. ⌘Z で 1 操作ずつ戻る（出す → 尺 → 移動）
  const undoResults = [];
  const expectations = [beforeTakeOut, beforeResize, beforeMove];
  for (let back = 1; back <= 3; back++) {
    const expected = expectations[back - 1];
    await focusTimelineEmpty();
    await s.key('z', 'KeyZ', 90, 4);
    let now = await waitEdit(d => JSON.stringify(d) === JSON.stringify(expected), 6000);
    let via = 'cmd+z';
    if (JSON.stringify(now) !== JSON.stringify(expected)) {
      via = 'button';
      await s.ev(`(() => { const b = [...document.querySelectorAll('#akari-annotations-widget button')].find(b => (b.title || '').includes('元に戻す')); if (b && !b.disabled) b.click(); return !!b; })()`);
      now = await waitEdit(d => JSON.stringify(d) === JSON.stringify(expected), 6000);
    }
    undoResults.push({ back, via, equal: JSON.stringify(now) === JSON.stringify(expected) });
  }
  obs.steps.undo = undoResults;
  check('⌘Z undoes one operation at a time (take out, resize, move)', undoResults.every(r => r.equal && r.via === 'cmd+z'), { undoResults });
  const beforeReload = await s.readEdit();
  await timelineShot('09b-after-undo.png');

  // 8. 保存して再読込で同じ（アプリを閉じて同じプロファイル・同じプロジェクトで開き直す）
  obs.steps.leftoverFirstRun = await s.stop();
  s = new Session(dirs, port);
  await s.start();
  obs.steps.reopen = await s.openPreviewAndTimeline();
  await sleep(3000);
  const afterReload = await s.readEdit();
  await rectOf(`.akari-timeline-tree-item[data-akari-item-id="${KID}"]`);
  tl = await s.timelineState();
  obs.steps.rowsAfterReload = tl.rows;
  check('reopen keeps edit.json and the canvas row', JSON.stringify(afterReload) === JSON.stringify(beforeReload)
    && tl.rows.some(r => r.id === KID && r.text.includes('オープニング')), { rows: tl.rows });
  await timelineShot('10-after-reopen.png');
  await s.seek(12);
  obs.steps.overlaysAfterReopen = await previewOverlays();
  await previewShot('11-after-reopen-preview-12s.png');

  // 9. 同じ時刻に 4 個 → 畳み（edit.json は不変）→ 「キャンバスにする」
  const beforeFold = await s.readEdit();
  const foldInfo = await s.ev(`(() => { const w = document.getElementById('akari-annotations-widget');
    const els = [...w.querySelectorAll('*')].filter(e => e.children.length === 0 && /同じ時刻に\\s*4\\s*個/.test(e.textContent));
    return els.map(e => { const host = e.closest('[data-akari-tree-row-id], [data-akari-item-id]') || e; host.scrollIntoView({ block: 'center' }); const r = host.getBoundingClientRect();
      return { text: e.textContent.trim(), id: host.dataset.akariTreeRowId || host.dataset.akariItemId, x: r.x, y: r.y, width: r.width, height: r.height }; }); })()`);
  obs.steps.fold = foldInfo;
  const foldRowText = await s.ev(`(() => { const el = document.querySelector('[data-akari-ui="timeline-same-time-row"]'); return el ? el.textContent.trim() : null; })()`);
  check('fold row label has a single toggle (no doubled ▸)', foldRowText && (foldRowText.match(/▸|▾/g) ?? []).length === 1, { foldRowText });
  const hiddenMembers = await s.ev(`['same1','same2','same3','same4'].filter(id => { const el = document.querySelector('[data-akari-ui="timeline:overlay:' + id + '"]'); return !el || getComputedStyle(el).display === 'none'; })`);
  const afterFoldDoc = await s.readEdit();
  check('4 items at the same time fold to 「同じ時刻に 4 個 ▸」 and edit.json is unchanged', foldInfo.length > 0
    && JSON.stringify(afterFoldDoc) === JSON.stringify(beforeFold), { foldInfo, hiddenMembers });
  await timelineShot('12-same-time-fold.png');
  if (foldInfo.length) {
    const f = foldInfo[foldInfo.length - 1];
    const r = await rectOf(f.id ? `[data-akari-tree-track] [data-akari-tree-row-id="${f.id}"]` : '[data-akari-ui="timeline-same-time-row"]') ?? f;
    await rightClick(r.x + Math.min(30, r.width / 2), r.y + r.height / 2);
    obs.steps.foldMenu = await contextItems();
    const canvasItem = (obs.steps.foldMenu.find(i => i.text === 'キャンバスにする') ?? {}).id;
    if (canvasItem) await clickContextItem(canvasItem);
  }
  doc = await waitEdit(d => canvasOf(d).some(k => ['same1', 'same2', 'same3', 'same4'].every(id => (k.items ?? []).some(i => i.id === id))));
  const foldCanvas = canvasOf(doc).find(k => (k.items ?? []).some(i => i.id === 'same1'));
  const sameAbs = ['same1', 'same2', 'same3', 'same4'].map(id => findItem(doc, id)?.absAt);
  check('right-click 「キャンバスにする」 on the fold makes one canvas of 4 (times kept)', foldCanvas && foldCanvas.items.length === 4
    && foldCanvas.source.canvas?.origin === 'user' && sameAbs.every(a => a === 750), { foldCanvas, sameAbs, menu: obs.steps.foldMenu });
  await sleep(1500);
  await timelineShot('13-fold-made-canvas.png');

  // 10. 何も無い所の右クリック「ここにキャンバスを作る」（プレイヘッドから 5 秒）
  await s.activatePreview(); await sleep(600); await s.refreshView();
  await s.seek(2);
  await sleep(800);
  g = await geometry();
  const ys2 = await emptyStripY(g.x0 + 3 * g.pxPerSec);
  if (ys2.length) {
    await s.click(g.x0 + 3 * g.pxPerSec, ys2[0]);
    await s.seek(2);
    await sleep(600);
    const before = canvasOf(await s.readEdit()).map(k => k.id);
    await rightClick(g.x0 + 3 * g.pxPerSec, ys2[0]);
    obs.steps.hereMenu = await contextItems();
    const hereId = (obs.steps.hereMenu.find(i => i.text === 'ここにキャンバスを作る') ?? {}).id;
    if (hereId) await clickContextItem(hereId);
    doc = await waitEdit(d => canvasOf(d).some(k => !before.includes(k.id)));
    const here = canvasOf(doc).find(k => !before.includes(k.id));
    check('「ここにキャンバスを作る」 makes a 5 s empty canvas at the playhead', here && near(here.at, 60, 2) && here.duration === 150
      && (here.items ?? []).length === 0, { here, menu: obs.steps.hereMenu });
  } else check('「ここにキャンバスを作る」 makes a 5 s empty canvas at the playhead', false, { reason: 'no empty strip point' });

  // 11. 画面に「group」「グループ」が出ない（本文 + ツールチップ・読み上げラベル）
  obs.steps.attrWords = await s.ev(`[...document.querySelectorAll('[title], [aria-label], [placeholder]')].flatMap(e => ['title', 'aria-label', 'placeholder']
    .map(a => e.getAttribute(a) || '').filter(v => /グループ|\\bgroup\\b/i.test(v)))`);
  const words = await visibleWordsCheck('final');
  check('no 「group」/「グループ」 in tooltips / aria labels of the main window', obs.steps.attrWords.length === 0, { attrWords: obs.steps.attrWords });
  check('no 「group」/「グループ」 in visible UI text (main window + preview)', words.length === 0, { words });
} catch (error) {
  obs.error = String(error?.stack ?? error);
  console.error(error);
} finally {
  obs.leftoverProcesses = await s.stop();
  obs.summary = { pass: obs.checks.filter(c => c.ok).length, fail: obs.checks.filter(c => !c.ok).length };
  await writeFile(path.join(outDir, 'observations.json'), clean(JSON.stringify(obs, null, 2)) + '\n');
  await s.cleanup();
  console.log(clean(JSON.stringify({ summary: obs.summary, failed: obs.checks.filter(c => !c.ok).map(c => c.name), error: obs.error }, null, 2)));
}
