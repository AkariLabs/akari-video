// usage: CDP_PORT=9451 node eval.mjs '<js expression>' [screenshot.png]
import { connectMain, evalMain, screenshot } from './cdp-lib.mjs';
const cdp = await connectMain(Number(process.env.CDP_PORT || 9451));
const v = await evalMain(cdp, process.argv[2], 120000);
console.log(JSON.stringify(v, null, 1));
if (process.argv[3]) await screenshot(cdp, process.argv[3]);
cdp.close(); process.exit(0);
