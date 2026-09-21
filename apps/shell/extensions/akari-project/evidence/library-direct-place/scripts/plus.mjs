// Click a catalog card's ＋ (data-akari-catalog-action=add) or the card body (mode=body) with a real
// mouse click and record the edit.json diff. Usage: node plus.mjs <catalogKey> <out.json> [body]
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { connectMain, evalMain, realClick } from '../../materials-tab-hardening/cdp-lib.mjs';
const [key, outFile, mode] = process.argv.slice(2);
const EDIT = '/tmp/ldp-l1/ws/edit.json';
const cdp = await connectMain(Number(process.env.CDP_PORT || 9388));
const ev = expr => evalMain(cdp, expr, 30000);
const all = j => ({ items: j.tracks.flatMap(t => t.items.map(i => ({ track: t.id, ...i }))), sfx: j.audio?.sfx ?? [] });
const before = JSON.parse(readFileSync(EDIT, 'utf8'));
const target = await ev(`(() => { const card=document.querySelector('[data-akari-catalog-item=${JSON.stringify(key)}]'); card.scrollIntoView({block:'center'});
  const el = ${mode === 'body' ? "card.querySelector('div') || card" : "card.querySelector('[data-akari-catalog-action=add]')"}; if(!el) return null; const r=el.getBoundingClientRect();
  return { x: r.left + Math.min(r.width/2, 30), y: r.top + Math.min(r.height/2, 30), label: el.textContent.trim().slice(0,20), aria: el.getAttribute('aria-label') }; })()`);
const rec = { key, mode: mode || 'plus', target, at: new Date().toISOString() };
rec.playheadBefore = await ev(`[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&/^\\d+:\\d\\d\\s*\\/\\s*\\d+:\\d\\d$/.test(e.textContent.trim())&&e.getBoundingClientRect().width>0).map(e=>e.textContent.trim())[0]||null`);
await realClick(cdp, target.x, target.y);
const t0 = Date.now(); let after = before;
for (let i = 0; i < Number(process.env.WAIT_TICKS || 60); i++) { await sleep(500); after = JSON.parse(readFileSync(EDIT, 'utf8')); if (JSON.stringify(after) !== JSON.stringify(before)) break; }
rec.waitMs = Date.now() - t0; await sleep(800); after = JSON.parse(readFileSync(EDIT, 'utf8'));
rec.editChanged = JSON.stringify(after) !== JSON.stringify(before);
const b = all(before), a = all(after);
rec.newItems = a.items.filter(i => !b.items.some(x => x.track === i.track && x.id === i.id));
rec.newSfx = a.sfx.filter(i => !b.sfx.some(x => x.id === i.id));
rec.newSources = (after.sources || []).filter(s => !(before.sources || []).some(x => x.id === s.id));
rec.tracksAfter = after.tracks.map(t => `${t.id}:${t.lane}`);
rec.toasts = await ev(`[...document.querySelectorAll('.theia-notification-message')].map(e=>e.textContent.trim()).slice(-3)`);
writeFileSync(outFile, JSON.stringify(rec, null, 1)); console.log(JSON.stringify(rec)); process.exit(0);
