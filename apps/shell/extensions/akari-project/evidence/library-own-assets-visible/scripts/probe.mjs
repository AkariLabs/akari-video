// L1 probe for library-own-assets-visible (wrapper-written verification script).
// Usage: node probe.mjs <cmd> [args...]  (CDP_PORT, EDIT_JSON)
//   state                      — source filter / category counts+opacity / recent strip / cards on screen
//   filter <all|own|site|lab>  — real click on the source filter button
//   home | open <categoryKey>  — back to library home / open a category row (real click)
//   strip <recentKey>          — real click on a recent-strip chip
//   audition <catalogKey>      — real click on the card's audio toggle; reports the playing audio element
//   plus <catalogKey>          — real click on ＋ ; reports edit.json diff + project assets dir
//   undo <x> <y>               — focus click then Cmd+Z ; reports edit.json counts
//   shot <png>
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { connectMain, evalMain, realClick, screenshot } from '../../materials-tab-hardening/cdp-lib.mjs';

const EDIT = process.env.EDIT_JSON || '/tmp/loav-l1/ws/edit.json';
const cdp = await connectMain(Number(process.env.CDP_PORT || 9412));
const ev = expr => evalMain(cdp, expr, 60000);
const [cmd, ...args] = process.argv.slice(2);
const out = value => { console.log(JSON.stringify(value, null, 1)); cdp.close(); process.exit(0); };

async function clickSelector(selector) {
  const pos = await ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({ block: 'center' });
    const r = e.getBoundingClientRect(); return [r.left + Math.min(r.width / 2, 30), r.top + Math.min(r.height / 2, 20)]; })()`);
  if (!pos) throw new Error('not found: ' + selector);
  await realClick(cdp, pos[0], pos[1]);
  await sleep(900);
  return pos;
}

const STATE = `(() => {
  const vis = e => e.getBoundingClientRect().width > 0;
  const folder = document.querySelector('[data-library-folder-filter]');
  return {
    sourceFilter: [...document.querySelectorAll('[data-source-filter]')].filter(vis).map(e => e.dataset.sourceFilter + ':' + e.getAttribute('aria-pressed')),
    categories: [...document.querySelectorAll('[data-category]')].filter(vis).map(e => ({ key: e.dataset.category, count: e.dataset.count ?? null, opacity: getComputedStyle(e).opacity })),
    recentStrip: [...document.querySelectorAll('[data-recent-key]')].filter(vis).map(e => ({ key: e.dataset.recentKey, text: e.textContent.trim() })),
    folderFilter: folder ? folder.dataset.libraryFolderFilter : null,
    cards: [...document.querySelectorAll('[data-akari-catalog-item]')].filter(vis).map(e => e.getAttribute('data-akari-catalog-item')),
    cardCount: [...document.querySelectorAll('[data-akari-catalog-item]')].filter(vis).length,
    focused: [...document.querySelectorAll('[data-akari-catalog-item]')].filter(e => e === document.activeElement || e.contains(document.activeElement)).map(e => e.getAttribute('data-akari-catalog-item')),
    homeVisible: !!document.querySelector('[data-akari-library-home]')
  };
})()`;

const editSnapshot = () => JSON.parse(readFileSync(EDIT, 'utf8'));
const counts = j => ({ items: j.tracks.flatMap(t => t.items).length, sfx: (j.audio?.sfx || []).length, bgm: (j.audio?.bgm ? 1 : 0), sources: (j.sources || []).length });

if (cmd === 'state') out(await ev(STATE));
if (cmd === 'shot') { await screenshot(cdp, args[0]); out({ shot: args[0] }); }
if (cmd === 'filter') { await clickSelector(`[data-source-filter="${args[0]}"]`); out(await ev(STATE)); }
if (cmd === 'open') { await clickSelector(`[data-category="${args[0]}"]`); await sleep(800); out(await ev(STATE)); }
if (cmd === 'home') {
  const pos = await ev(`(() => { const e=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&/^←?\\s*ライブラリ$/.test(e.textContent.trim())&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().top>80); if(!e) return null; const r=e.getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/2]; })()`);
  if (pos) { await realClick(cdp, pos[0], pos[1]); await sleep(900); }
  out({ backClicked: !!pos, ...(await ev(STATE)) });
}
if (cmd === 'click') { const pos = await clickSelector(args[0]); await sleep(Number(args[1] || 0)); out({ clicked: args[0], pos, ...(await ev(STATE)) }); }
if (cmd === 'eval') out(await ev(args[0]));
if (cmd === 'strip') { await clickSelector(`[data-recent-key="${args[0]}"]`); await sleep(1500); out(await ev(STATE)); }
if (cmd === 'audition') {
  // The widget's audio element is not attached to the DOM (new Audio()), so record play() calls.
  await ev(`(() => { if (!window.__loavPlays) { window.__loavPlays = []; const orig = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { window.__loavPlays.push(this); return orig.apply(this, arguments); }; } window.__loavPlays.length = 0; return true; })()`);
  await clickSelector(`[data-akari-catalog-item="${args[0]}"] [data-akari-catalog-audio-toggle]`);
  await sleep(1500);
  out(await ev(`(() => { const a=window.__loavPlays; return { playingCards: [...document.querySelectorAll('[data-akari-catalog-audio-playing=true]')].map(e => e.closest('[data-akari-catalog-item]')?.getAttribute('data-akari-catalog-item')), audio: a.map(x => ({ src: x.currentSrc || x.src, paused: x.paused, currentTime: x.currentTime, readyState: x.readyState, error: x.error && x.error.code })),
    audioError: [...document.querySelectorAll('[data-akari-catalog-audio-error]')].map(e => e.textContent.trim()) }; })()`));
}
if (cmd === 'plus') {
  const key = args[0];
  const before = editSnapshot();
  const playhead = await ev(`[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&/^\\d+:\\d\\d(\\.\\d+)?\\s*\\/\\s*\\d+:\\d\\d/.test(e.textContent.trim())&&e.getBoundingClientRect().width>0).map(e=>e.textContent.trim())[0]||null`);
  await clickSelector(`[data-akari-catalog-item="${key}"] [data-akari-catalog-action=add]`);
  const t0 = Date.now(); let after = before;
  for (let i = 0; i < 60; i++) { await sleep(500); after = editSnapshot(); if (JSON.stringify(after) !== JSON.stringify(before)) break; }
  const waitMs = Date.now() - t0; await sleep(800); after = editSnapshot();
  const all = j => j.tracks.flatMap(t => t.items.map(i => ({ track: t.id, ...i })));
  const [category, id] = key.split('/');
  const dir = `/tmp/loav-l1/ws/assets/${category}/${id}`;
  out({ key, playheadBefore: playhead, waitMs, editChanged: JSON.stringify(after) !== JSON.stringify(before),
    before: counts(before), after: counts(after),
    newItems: all(after).filter(i => !all(before).some(x => x.track === i.track && x.id === i.id)),
    newSfx: (after.audio?.sfx || []).filter(i => !(before.audio?.sfx || []).some(x => x.id === i.id)),
    bgmAfter: after.audio?.bgm ?? null,
    newSources: (after.sources || []).filter(s => !(before.sources || []).some(x => x.id === s.id)),
    projectAssetDir: existsSync(dir) ? readdirSync(dir) : null,
    toasts: await ev(`[...document.querySelectorAll('.theia-notification-message')].map(e=>e.textContent.trim()).slice(-3)`) });
}
if (cmd === 'undo') {
  const [fx, fy] = args.map(Number);
  const before = counts(editSnapshot());
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: fx, y: fy, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: fx, y: fy, button: 'left', clickCount: 1 });
  await sleep(300);
  const k = { modifiers: 4, key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90, commands: ['undo'] };
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...k });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
  await sleep(1500);
  out({ before, after: counts(editSnapshot()) });
}
out({ error: 'unknown command ' + cmd });
