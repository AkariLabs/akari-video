import { connectMain, screenshot } from '../../materials-tab-hardening/cdp-lib.mjs';
const cdp = await connectMain(Number(process.env.CDP_PORT || 9455)); await screenshot(cdp, process.argv[2]); process.exit(0);
