// Click a button inside the dock (selector argv[2]) with a real mouse click; record dock/audio/list state.
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { connectMain, evalMain, realClick } from '../../materials-tab-hardening/cdp-lib.mjs';
const [sel, out] = process.argv.slice(2);
const cdp = await connectMain(Number(process.env.CDP_PORT || 9455));
const ev = e => evalMain(cdp, e, 30000);
const st = `(() => ({ dock: !!document.querySelector('[data-akari-catalog-audio-dock]'), playing: [...document.querySelectorAll('[data-akari-catalog-audio-playing=true]')].map(e=>e.closest('[data-akari-catalog-item]')?.getAttribute('data-akari-catalog-item')), audioPaused: window.__lpdAudio ? window.__lpdAudio.paused : null, cardTop: Math.round(document.querySelector('[data-akari-catalog-item]')?.getBoundingClientRect().top*10)/10 }))()`;
const before = await ev(st);
const p = await ev(`(() => { const e=document.querySelector('[data-akari-catalog-audio-dock] ${sel}'); if(!e) return null; const r=e.getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/2, e.textContent.trim()]; })()`);
await realClick(cdp, p[0], p[1]); await sleep(800);
const after = await ev(st);
const rec = { button: sel, label: p[2], before, after, at: new Date().toISOString() };
writeFileSync(out, JSON.stringify(rec, null, 1)); console.log(JSON.stringify(rec)); process.exit(0);
