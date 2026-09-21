// Evaluate an expression (or a file with -f) in the main page, or take a screenshot (--shot <png>).
import { connectMain, evalMain, screenshot } from './cdp-lib.mjs';
import { readFileSync } from 'node:fs';
const cdp = await connectMain(Number(process.env.CDP_PORT || 9391));
const arg = process.argv[2];
if (arg === '--shot') { await screenshot(cdp, process.argv[3]); console.log('shot', process.argv[3]); }
else { const expr = arg === '-f' ? readFileSync(process.argv[3], 'utf8') : arg; console.log(JSON.stringify(await evalMain(cdp, expr, 60000), null, 1)); }
cdp.close();
process.exit(0);
