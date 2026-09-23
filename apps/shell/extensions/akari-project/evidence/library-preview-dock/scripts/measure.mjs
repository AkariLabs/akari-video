// Click a catalog audio card (mode: toggle = the play button, body = card body) and measure list shift.
// Usage: node measure.mjs <index> <mode> <out.json> [scrollBefore]
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { connectMain, evalMain, realClick } from '../../materials-tab-hardening/cdp-lib.mjs';
const [idxRaw, mode, out, scrollRaw] = process.argv.slice(2);
const cdp = await connectMain(Number(process.env.CDP_PORT || 9455));
const ev = e => evalMain(cdp, e, 30000);
const snap = `(() => {
  const cards = [...document.querySelectorAll('[data-akari-catalog-item]')];
  const sc = (() => { let p = cards[0]?.parentElement; while (p && !(p.scrollHeight > p.clientHeight && getComputedStyle(p).overflowY !== 'visible')) p = p.parentElement; return p; })();
  const panel = document.getElementById('akari-role-buckets-widget');
  const pr = panel?.getBoundingClientRect();
  const dock = document.querySelector('[data-akari-catalog-audio-dock],[data-akari-catalog-audio-bar]');
  const dr = dock?.getBoundingClientRect();
  return {
    cardTops: cards.slice(0, 6).map(c => Math.round(c.getBoundingClientRect().top * 10) / 10),
    firstCardKey: cards[0]?.getAttribute('data-akari-catalog-item'),
    scrollTop: sc ? Math.round(sc.scrollTop) : null,
    scrollerClass: sc ? (sc.className || sc.tagName) : null,
    panelRect: pr ? { top: Math.round(pr.top), bottom: Math.round(pr.bottom), left: Math.round(pr.left), right: Math.round(pr.right) } : null,
    playing: [...document.querySelectorAll('[data-akari-catalog-audio-playing=true]')].map(e => e.closest('[data-akari-catalog-item]')?.getAttribute('data-akari-catalog-item')),
    audio: window.__lpdAudio ? { paused: window.__lpdAudio.paused, currentTime: Math.round(window.__lpdAudio.currentTime*100)/100, src: (window.__lpdAudio.src||"").split("/").pop() } : null,
    audioBar: !!document.querySelector('[data-akari-catalog-audio-bar]'),
    audioDock: !!document.querySelector('[data-akari-catalog-audio-dock]'),
    dockRect: dr ? { top: Math.round(dr.top), bottom: Math.round(dr.bottom), height: Math.round(dr.height), position: getComputedStyle(dock).position } : null,
    dockAnim: dock ? (() => { const cs = getComputedStyle(dock); return { name: cs.animationName, duration: cs.animationDuration, zIndex: cs.zIndex }; })() : null,
    dockInsideScroller: dock && sc ? sc.contains(dock) : null,
    dockText: dock?.textContent.trim().slice(0, 80) ?? null,
    dockParentChain: dock ? (() => { const a = []; let p = dock; for (let i = 0; i < 4 && p; i++) { a.push((p.tagName + '.' + (p.className || '') + [...p.attributes].filter(x => x.name.startsWith('data-akari')).map(x => '[' + x.name + ']').join('')).slice(0, 120)); p = p.parentElement; } return a; })() : null
  };
})()`;
if (scrollRaw) {
  await ev(`(() => { const c=document.querySelector('[data-akari-catalog-item]'); let p=c.parentElement; while (p && !(p.scrollHeight > p.clientHeight && getComputedStyle(p).overflowY !== 'visible')) p=p.parentElement; p.scrollTop=${Number(scrollRaw)}; })()`);
  await sleep(600);
}
const before = await ev(snap);
const idx = Number(idxRaw);
const target = await ev(`(() => { const toggles=[...document.querySelectorAll('[data-akari-catalog-item]')].filter(c=>c.querySelector('[data-akari-catalog-audio-toggle]'));
  const vis = toggles.filter(c => { const r=c.getBoundingClientRect(); return r.top > 60 && r.bottom < innerHeight - 60; });
  const card = vis[${idx}]; if (!card) return null;
  const el = ${mode === 'body' ? "card.querySelector('div')||card" : "card.querySelector('[data-akari-catalog-audio-toggle]')"};
  const r = el.getBoundingClientRect(); return { key: card.getAttribute('data-akari-catalog-item'), x: r.left + Math.min(r.width/2, 20), y: r.top + Math.min(r.height/2, 20) }; })()`);
const mo = await ev(`(() => { window.__lpdAdded = []; const m = new MutationObserver(recs => { for (const r of recs) for (const n of r.addedNodes) if (n.nodeType === 1) window.__lpdAdded.push((n.tagName + '.' + (n.className||'') + [...n.attributes].filter(x=>x.name.startsWith('data-akari')).map(x=>'['+x.name+']').join('')).slice(0,140)); }); m.observe(document.getElementById('akari-role-buckets-widget') || document.body, { childList: true, subtree: true }); window.__lpdMo = m; return true; })()`);
await realClick(cdp, target.x, target.y);
await sleep(1200);
const after = await ev(snap);
const added = await ev(`(() => { window.__lpdMo?.disconnect(); return [...new Set(window.__lpdAdded)].slice(0, 20); })()`);
const rec = { mode, target, before, after, added, cardTopShiftPx: after.cardTops[0] - before.cardTops[0], scrollTopDelta: (after.scrollTop ?? 0) - (before.scrollTop ?? 0), at: new Date().toISOString() };
writeFileSync(out, JSON.stringify(rec, null, 1)); console.log(JSON.stringify(rec, null, 1)); process.exit(0);
