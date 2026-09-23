import { connectMain, evalMain } from '../../materials-tab-hardening/cdp-lib.mjs';
const cdp = await connectMain(Number(process.env.CDP_PORT || 9455));
console.log(JSON.stringify(await evalMain(cdp, process.argv[2], 30000), null, 1));
process.exit(0);
