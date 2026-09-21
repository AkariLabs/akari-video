// ライブラリ面で左パネルを畳んで開き直す間、rAF ごとに つまみ left と「ライブラリ」ボタン left・幅・transition を記録（パネル展開アニメ中も つまみ がアクティブ側に張り付いているか）。usage: node reopen-align.mjs → ../panel-reopen-align.json
import { connectMain, evalMain, realClick } from '../../materials-tab-hardening/cdp-lib.mjs';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
const cdp = await connectMain(9434);
await evalMain(cdp, `document.querySelector('[data-akari-panel-segment="catalog"]').click()`); await sleep(600);
const f = await evalMain(cdp, `(() => { const el = [...document.querySelectorAll('.codicon-files')].find(e => e.getBoundingClientRect().width > 0); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
await realClick(cdp, f.x, f.y); await sleep(700);
await evalMain(cdp, `(() => { const s = window.__r = []; const t0 = performance.now(); const tick = () => { const t = document.querySelector('[data-akari-panel-segment-thumb]'); const tr = t.parentElement; const cs = getComputedStyle(t); const m = new DOMMatrix(cs.transform); const lib = tr.querySelector('[data-akari-panel-segment="catalog"]').getBoundingClientRect(); const th = t.getBoundingClientRect(); s.push({ ms: +(performance.now() - t0).toFixed(1), tx: +m.m41.toFixed(2), thumbW: +t.offsetWidth, trackW: tr.offsetWidth, thumbLeft: +th.left.toFixed(1), libLeft: +lib.left.toFixed(1), transition: cs.transitionDuration, panelW: +document.getElementById('theia-left-content-panel').getBoundingClientRect().width.toFixed(1) }); if (performance.now() - t0 < 900) requestAnimationFrame(tick); }; requestAnimationFrame(tick); })()`);
await realClick(cdp, f.x, f.y); await sleep(1100);
const r = await evalMain(cdp, 'window.__r');
writeFileSync(new URL('../panel-reopen-align.json', import.meta.url), JSON.stringify({ frames: r, allAligned: r.filter(x => x.trackW > 0).every(x => Math.abs(x.thumbLeft - x.libLeft) <= 0.5) }, null, 1) + '\n');
const seen = new Set(); for (const x of r) { const k = JSON.stringify([x.tx, x.thumbW, x.trackW, x.transition, x.panelW]); if (!seen.has(k)) { seen.add(k); console.log(JSON.stringify(x)); } }
cdp.close(); process.exit(0);
