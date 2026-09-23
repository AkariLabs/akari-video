import { connectMain, realClick } from '../../materials-tab-hardening/cdp-lib.mjs';
const cdp = await connectMain(Number(process.env.CDP_PORT || 9455)); await realClick(cdp, Number(process.argv[2]), Number(process.argv[3])); process.exit(0);
