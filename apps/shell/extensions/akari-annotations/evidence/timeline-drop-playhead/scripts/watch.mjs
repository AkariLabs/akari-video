// 再生位置とリフレッシュのログを一定時間見張る: node watch.mjs <ms> <out.json>
import { writeFile } from 'node:fs/promises';
import { connect, evalOn, sleep } from './common.mjs';
import { INSTALL, STATE } from './tdp-lib.mjs';
const [ms, out] = process.argv.slice(2);
const cdp = await connect(); await evalOn(cdp, INSTALL); await evalOn(cdp, `(window.__tdp.log.length=0,true)`);
const samples = []; const t0 = Date.now();
while (Date.now() - t0 < Number(ms)) { samples.push({ ms: Date.now() - t0, ...(await evalOn(cdp, STATE)) }); await sleep(150); }
const log = await evalOn(cdp, 'window.__tdp.log');
await writeFile(out, JSON.stringify({ samples, log }, null, 1));
let p; for (const s of samples) { if (s.playheadT !== p) console.log(s.ms, s.playheadT, s.transport?.t); p = s.playheadT; }
console.log(JSON.stringify(log.filter(l => l.k !== 'tick' && l.k !== 'event')));
console.log('events', JSON.stringify(log.filter(l => l.k === 'event').map(l => l.time)));
cdp.close(); process.exit(0);
