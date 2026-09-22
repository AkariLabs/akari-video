// L1 helper: print the CSS-pixel center of the first visible element matching selector (+ optional text).
// Usage: node find.mjs '<css selector>' ['<text substring>']
import { connectMain, evalMain } from '../../materials-tab-hardening/cdp-lib.mjs';
const cdp = await connectMain(Number(process.env.CDP_PORT || 9447));
const [sel, text] = process.argv.slice(2);
const r = await evalMain(cdp, `(() => { const els = [...document.querySelectorAll(${JSON.stringify(sel)})].filter(e => e.getClientRects().length && (!${JSON.stringify(text ?? '')} || (e.textContent||'').includes(${JSON.stringify(text ?? '')}) || (e.getAttribute('aria-label')||'').includes(${JSON.stringify(text ?? '')})));
 const e = els[els.length && ${JSON.stringify(text ?? '')} ? els.length - 1 : 0]; if (!e) return 'none'; const b = e.getBoundingClientRect(); return Math.round(b.x + b.width/2) + ' ' + Math.round(b.y + b.height/2); })()`, 20000);
console.log(r); cdp.close();
