// Finder からのファイルドラッグ（CDP の DragData.files のみ = types が Files だけ）を受け口へ運び、
// ドラッグ中の取り込みの枠・document capture 段階の状態・落としたあとの assets/ を記録する。
// Usage: WS=<隔離ワークスペース> node osdrag.mjs <panel|home|timeline> <absFile> <out.json> [shot.png] [drop|cancel|cancel-inside]
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { connectMain, evalMain, screenshot } from './cdp-lib.mjs';
const [target, file, outFile, shot, mode = 'drop'] = process.argv.slice(2);
const WS = process.env.WS;
if (!WS) throw new Error('WS (isolated workspace) is required');
const cdp = await connectMain(Number(process.env.CDP_PORT || 9463));
const ev = e => evalMain(cdp, e, 30000);
const walk = d => existsSync(d) ? readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p).map(x => join(n, x)) : [n]; }) : [];
const SELECTORS = { panel: '#akari-role-buckets-widget', home: '.akari-home-surface', timeline: '.akari-annotations-widget' };
const sel = SELECTORS[target];
if (!sel) throw new Error('target must be panel|home|timeline');
// ページ内の記録: window capture（document capture より先）で types を、document の後段 = window bubble ではなく
// 各 dispatch の直後に「最後のイベントの defaultPrevented」を読む。
await ev(`(() => { window.__fdf = { events: [] };
  for (const type of ['dragenter', 'dragover', 'drop']) {
    window.addEventListener(type, e => { window.__fdf.last = e; window.__fdf.events.push({ type, types: Array.from(e.dataTransfer ? e.dataTransfer.types : []), target: (e.target && e.target.id) || (e.target && e.target.className && String(e.target.className).slice(0, 40)) || (e.target && e.target.nodeName) }); }, true);
  }
  return true; })()`);
const probe = `(() => { const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== 'none'; };
  const texts = root => root ? [...root.querySelectorAll('strong')].filter(e => /ここに落とすと/.test(e.textContent) && vis(e)).map(e => e.textContent.trim()) : [];
  const last = window.__fdf.last;
  return {
    panelOverlay: texts(document.getElementById('akari-role-buckets-widget')),
    homeOverlay: texts(document.querySelector('.akari-home-surface')),
    panelOverlayElement: !!document.querySelector('#akari-role-buckets-widget [data-akari-drop-overlay]'),
    timelineGhost: [...document.querySelectorAll('.akari-annotations-widget div')].filter(e => e.style.display === 'block' && /77, 208, 200|241, 76, 76|4dd0c8/.test(e.style.cssText)).map(e => ({ rejected: /241, 76, 76/.test(e.style.cssText), text: e.textContent.trim() })),
    lastEvent: last ? { type: last.type, defaultPrevented: last.defaultPrevented, dropEffect: last.dataTransfer && last.dataTransfer.dropEffect } : null
  }; })()`;
const readEdit = () => { try { return readFileSync(join(WS, 'edit.json'), 'utf8'); } catch { return null; } };
const tracks = s => { try { return JSON.parse(s).tracks.map(t => [t.id, t.items.map(i => `${i.id}@${i.at}+${i.duration}`)]); } catch { return null; } };
const editBefore = readEdit();
const before = walk(join(WS, 'assets'));
const pt = await ev(`(() => { const e = document.querySelector('${sel}'); const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height * 0.6) }; })()`);
const data = { items: [], files: [file], dragOperationsMask: 1 };
const rec = { target, selector: sel, file: file.split('/').pop(), point: pt, mode };
await cdp.send('Input.dispatchDragEvent', { type: 'dragEnter', ...pt, data });
rec.afterDragEnter = await ev(probe);
for (let k = 0; k < 3; k++) { await cdp.send('Input.dispatchDragEvent', { type: 'dragOver', ...pt, data }); await sleep(150); }
rec.duringDrag = await ev(probe);
if (shot) await screenshot(cdp, shot);
if (mode === 'cancel') {
  const out = { x: 2, y: 2 };
  await cdp.send('Input.dispatchDragEvent', { type: 'dragOver', ...out, data }); await sleep(200);
  rec.afterLeave = await ev(probe);
  await cdp.send('Input.dispatchDragEvent', { type: 'dragCancel', ...out, data }); await sleep(300);
  rec.afterCancel = await ev(probe);
} else if (mode === 'cancel-inside') {
  // 受け口の上にいるまま取り消す（Esc 相当）
  await cdp.send('Input.dispatchDragEvent', { type: 'dragCancel', ...pt, data }); await sleep(300);
  rec.afterCancel = await ev(probe);
} else {
  await cdp.send('Input.dispatchDragEvent', { type: 'drop', ...pt, data });
  let added = [];
  for (let i = 0; i < 30 && added.length === 0; i++) { await sleep(500); added = walk(join(WS, 'assets')).filter(a => !before.includes(a)); }
  rec.assetsAdded = added;
  for (let i = 0; i < 10 && readEdit() === editBefore; i++) await sleep(500);
  rec.editChanged = readEdit() !== editBefore;
  rec.editTracksAfter = tracks(readEdit());
  rec.afterDrop = await ev(probe);
  rec.toasts = await ev(`[...document.querySelectorAll('.theia-notification-message, .theia-notification-list-item')].map(e => e.textContent.trim()).filter(Boolean).slice(-4)`);
}
rec.pageEvents = await ev(`(() => { const s = window.__fdf.events; return { count: s.length, types: [...new Set(s.map(e => e.type))], firstTypes: s[0] && s[0].types, dropSeen: s.some(e => e.type === 'drop') }; })()`);
writeFileSync(outFile, JSON.stringify(rec, null, 1)); console.log(JSON.stringify(rec)); cdp.close(); process.exit(0);
