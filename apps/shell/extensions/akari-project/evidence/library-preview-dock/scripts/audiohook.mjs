// Record the shared catalog <audio> (new Audio(), not in DOM) by hooking HTMLMediaElement.play once.
import { connectMain, evalMain } from '../../materials-tab-hardening/cdp-lib.mjs';
const cdp = await connectMain(Number(process.env.CDP_PORT || 9455));
console.log(await evalMain(cdp, `(() => { if (window.__lpdHooked) return 'already'; const orig = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { window.__lpdAudio = this; return orig.apply(this, arguments); }; window.__lpdHooked = true; return 'hooked'; })()`));
process.exit(0);
