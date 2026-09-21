// Print the centre of the first visible leaf element whose text equals argv[2].
import { connectMain, evalMain } from '../../materials-tab-hardening/cdp-lib.mjs';
const cdp = await connectMain(Number(process.env.CDP_PORT || 9388));
console.log(JSON.stringify(await evalMain(cdp, `(() => { const e=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&e.textContent.trim()===${JSON.stringify(process.argv[2])}&&e.getBoundingClientRect().width>0); if(!e) return null; const r=e.getBoundingClientRect(); return [Math.round(r.left+r.width/2), Math.round(r.top+r.height/2)]; })()`)));
process.exit(0);
