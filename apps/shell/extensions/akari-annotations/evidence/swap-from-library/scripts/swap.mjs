// L1 (swap-from-library): drive the swap flow with real mouse clicks and record edit.json state.
// Usage:
//   node swap.mjs shelf <out.json>                       — summarise the swap shelf (band + tiers + order)
//   node swap.mjs try <catalogKey> <out.json>            — real click on a shelf card (= お試し), wait, record
//   node swap.mjs bar <label> <out.json>                 — real click on a trial-bar button (▶ もう一度 / 差し替える / やめる)
//   node swap.mjs state <out.json>                       — record current state only
// Env: WS (fixture workspace, default /tmp/swap-l1/ws), ITEM (item id to report), CDP_PORT.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { connectMain, evalMain, realClick } from './cdp-lib.mjs';
const [mode, arg, outArg] = process.argv.slice(2);
const outFile = outArg ?? arg;
const WS = process.env.WS || '/tmp/swap-l1/ws';
const EDIT = `${WS}/edit.json`;
const ITEM = process.env.ITEM || 'bell-1';
const LINT = new URL('../../../../../../../packages/edit-lint/bin/edit-lint.mjs', import.meta.url).pathname;
const cdp = await connectMain(Number(process.env.CDP_PORT || 9395));
const ev = expr => evalMain(cdp, expr, 60000);
const sha = () => createHash('sha256').update(readFileSync(EDIT)).digest('hex');
const findItem = (doc) => {
  for (const track of doc.tracks) for (const item of track.items) if (item.id === ITEM) {
    const src = doc.sources.find(s => s.id === item.source?.src);
    return { track: track.id, id: item.id, at: item.at, duration: item.duration, source: item.source, path: src?.path, transform: item.transform, gain_db: item.gain_db, fade_in: item.fade_in, fade_out: item.fade_out };
  }
  return null;
};
const neighbours = (doc) => {
  for (const track of doc.tracks) if (track.items.some(i => i.id === ITEM)) return track.items.map(i => `${i.id}@${i.at}+${i.duration}`);
  return [];
};
const shelf = `(() => { const s=document.querySelector('[data-akari-swap-shelf]'); if(!s) return null;
  return { head: s.firstElementChild.textContent.trim(), sections: [...s.querySelectorAll('section')].map(x => ({ h: x.querySelector('h4').textContent,
    n: x.querySelectorAll('[data-akari-swap-candidate]').length,
    keys: [...x.querySelectorAll('[data-akari-swap-candidate]')].map(c => c.dataset.akariSwapCandidate + (c.getAttribute('aria-disabled') === 'true' ? ' (お試し不可)' : '')) })) }; })()`;
const ui = `(() => {
  const bar = [...document.querySelectorAll('[data-akari-material-trial]')].map(b => ({ text: b.textContent.trim(), visible: b.getBoundingClientRect().width > 0 }));
  const time = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && /^\\d+:\\d\\d \\/ \\d+:\\d\\d$/.test(e.textContent.trim()) && e.getBoundingClientRect().width > 0)?.textContent.trim();
  const swapRow = !!document.querySelector('[data-akari-material-swap]');
  const lib = document.querySelector('[data-akari-swap-shelf]') ? 'swap-shelf' : (document.querySelector('[data-akari-catalog-item]') ? 'library' : 'other');
  const toasts = [...document.querySelectorAll('.theia-notification-message')].map(e => e.textContent.trim()).slice(-3);
  return { trialBar: bar, previewTime: time, inspectorSwapRow: swapRow, leftPanel: lib, toasts };
})()`;
const CMD = `(() => { const d=window.theia.container._bindingDictionary; const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function'); return window.theia.container.get(C); })()`;
const playhead = () => ev(`${CMD}.executeCommand('akari.timeline.playhead')`);
const rec = { mode, arg: mode === 'state' || mode === 'shelf' ? undefined : arg, at: new Date().toISOString(), shaBefore: sha(), itemBefore: findItem(JSON.parse(readFileSync(EDIT, 'utf8'))) };
const t0 = Date.now();
if (mode === 'try') {
  const pos = await ev(`(() => { const c=document.querySelector('[data-akari-swap-candidate=${JSON.stringify(arg)}]'); if(!c) return null; c.scrollIntoView({block:'center'}); const r=c.getBoundingClientRect(); return [r.left+r.width/2, r.top+Math.min(40, r.height/3)]; })()`);
  if (!pos) { console.log('candidate not found'); process.exit(1); }
  rec.click = pos;
  await realClick(cdp, pos[0], pos[1]);
} else if (mode === 'bar') {
  const pos = await ev(`(() => { const b=[...document.querySelectorAll('[data-akari-material-trial] button')].find(x=>x.textContent.trim()===${JSON.stringify(arg)}); if(!b) return null; const r=b.getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/2]; })()`);
  if (!pos) { console.log('bar button not found'); process.exit(1); }
  rec.click = pos;
  await realClick(cdp, pos[0], pos[1]);
}
if (mode === 'try' || mode === 'bar') {
  // wait for edit.json to settle (import/probe may take a while on first use)
  let last = sha(), stable = 0;
  for (let k = 0; k < 120 && stable < 4; k++) { await sleep(500); const now = sha(); stable = now === last && (now !== rec.shaBefore || k > 6) ? stable + 1 : 0; last = now; }
  rec.settleMs = Date.now() - t0;
  const samples = [];
  for (let k = 0; k < 8; k++) { samples.push(Math.round((await playhead()) * 100) / 100); await sleep(500); }
  rec.previewTimeSamples = samples;
}
const doc = JSON.parse(readFileSync(EDIT, 'utf8'));
rec.shaAfter = sha();
rec.itemAfter = findItem(doc);
rec.sameTrack = neighbours(doc);
rec.ui = await ev(ui);
if (mode === 'shelf') rec.shelf = await ev(shelf);
try { const lint = JSON.parse(execFileSync('node', [LINT, '--json', WS], { encoding: 'utf8' })); rec.lint = { verdict: lint.verdict, errors: lint.findings.filter(f => f.severity === 'error').map(f => `${f.check}: ${f.message}`), sourceRange: lint.findings.filter(f => f.check.includes('source-range')).length }; }
catch (e) { try { const lint = JSON.parse(e.stdout); rec.lint = { verdict: lint.verdict, errors: lint.findings.filter(f => f.severity === 'error').map(f => `${f.check}: ${f.message}`) }; } catch { rec.lint = String(e); } }
writeFileSync(outFile, JSON.stringify(rec, null, 1));
console.log(JSON.stringify({ shaBefore: rec.shaBefore.slice(0, 8), shaAfter: rec.shaAfter.slice(0, 8), item: rec.itemAfter && `${rec.itemAfter.track} ${rec.itemAfter.at}+${rec.itemAfter.duration} ${rec.itemAfter.path}`, sameTrack: rec.sameTrack, ui: rec.ui, samples: rec.previewTimeSamples, lint: rec.lint, settleMs: rec.settleMs }));
cdp.close(); process.exit(0);
