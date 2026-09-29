import { readFileSync } from 'node:fs';
const r = JSON.parse(readFileSync(process.argv[2], 'utf8'));
for (const [k, p] of Object.entries(r.phases)) {
  if (k === 'props') { console.log('props', JSON.stringify(p)); continue; }
  const c = p.classified, pc = p.pageClassified, s = p.sinceEdit && p.sinceEdit.classified;
  console.log(k, JSON.stringify({ open: p.openMs ?? p.reloadMs, start: p.startSec, first: p.firstSoundMs, move: p.videoMoveMs, gate: p.gateHeldMs, prep: p.preparingShownMs, wait: p.waitingShownMs, f: c.fetches, fB: c.fetchBytes, d: c.decodes, dMs: c.decodeMs,
    page: { f: pc.fetches, fB: pc.fetchBytes, d: pc.decodes, dMs: pc.decodeMs, fail: pc.decodeFailed }, since: s && { f: s.fetches, fB: s.fetchBytes, d: s.decodes, dMs: s.decodeMs, byFile: s.byFile },
    driftAbs: p.driftMs && p.driftMs.length ? Math.round(p.driftMs.reduce((a, b) => a + Math.abs(b), 0) / p.driftMs.length) : null, bands: p.bands, texts: p.statusTexts }));
}
