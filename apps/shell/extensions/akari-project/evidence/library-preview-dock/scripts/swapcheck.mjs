// Play a catalog card, select timeline item bgm-1, open the swap shelf, then press a shelf card's play toggle.
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { connectMain, evalMain, realClick } from '../../materials-tab-hardening/cdp-lib.mjs';
const cdp = await connectMain(Number(process.env.CDP_PORT || 9455));
const ev = e => evalMain(cdp, e, 60000);
const out = process.argv[2];
const CMD = `(() => { const d=window.theia.container._bindingDictionary; const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function'); return window.theia.container.get(C); })()`;
const st = `({ dock: !!document.querySelector('[data-akari-catalog-audio-dock]'), audioPaused: window.__lpdAudio ? window.__lpdAudio.paused : null, audioSrc: window.__lpdAudio ? (window.__lpdAudio.src||'').split('/').pop() : null, shelf: !!document.querySelector('[data-akari-swap-shelf]'), trialBar: [...document.querySelectorAll('[data-akari-material-trial]')].map(b=>b.textContent.trim().slice(0,40)) })`;
const rec = { at: new Date().toISOString() };
const t = await ev(`(() => { const e=document.querySelector('[data-akari-catalog-audio-toggle]'); const r=e.getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/2]; })()`);
await realClick(cdp, t[0], t[1]); await sleep(1000);
rec.playing = await ev(st);
const it = await ev(`(() => { const r=document.querySelector('[data-akari-item-id=bgm-1]').getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/2]; })()`);
await realClick(cdp, it[0], it[1]); await sleep(800);
rec.afterSelectItem = await ev(st);
rec.openSwap = await ev(`${CMD}.executeCommand('akari.catalog.openSwap', { itemId: 'bgm-1', kind: 'audio', currentRelativePath: 'assets/audio/tone.wav' })`);
await sleep(1500);
rec.shelfOpened = await ev(st);
const s = await ev(`(() => { const e=document.querySelector('[data-akari-swap-shelf] [data-akari-catalog-audio-toggle]'); if(!e) return null; e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/2, e.closest('[data-akari-swap-candidate]')?.dataset.akariSwapCandidate]; })()`);
rec.shelfToggle = s;
if (s) { await realClick(cdp, s[0], s[1]); await sleep(1000); rec.afterShelfToggle = await ev(st); await realClick(cdp, s[0], s[1]); await sleep(600); rec.afterShelfToggleAgain = await ev(st); }
writeFileSync(out, JSON.stringify(rec, null, 1)); console.log(JSON.stringify(rec, null, 1)); process.exit(0);
