// プレビューへ落とす（pvdrag.mjs）前後の再生位置を記録する: node pvcheck.mjs <project> <card> <stage:fx,fy> <out.json> [--settle=<ms>]
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { connect, evalOn, sleep } from './common.mjs';
import { INSTALL, STATE } from './tdp-lib.mjs';
const [project, card, drop, outFile] = process.argv.slice(2);
const settle = Number(process.argv.find(v => v.startsWith('--settle='))?.slice(9) ?? 12000);
let cdp = await connect();
await evalOn(cdp, INSTALL); await evalOn(cdp, `(window.__tdp.log.length=0,true)`);
const stateBefore = await evalOn(cdp, STATE); cdp.close();
const r = spawnSync(process.execPath, ['pvdrag.mjs', project, card, drop, `${outFile}.drag.json`], { encoding: 'utf8', env: process.env });
cdp = await connect();
const samples = []; const t0 = Date.now();
while (Date.now() - t0 < settle) { samples.push({ ms: Date.now() - t0, ...(await evalOn(cdp, STATE).catch(e => ({ error: String(e) }))) }); await sleep(150); }
const log = await evalOn(cdp, `window.__tdp.log`);
const drag = JSON.parse(await readFile(`${outFile}.drag.json`, 'utf8').catch(() => 'null'));
const start = stateBefore.playheadT;
const summary = { start, minPlayhead: Math.min(...samples.map(s => s.playheadT).filter(Number.isFinite)), end: samples.at(-1).playheadT,
  zeroTicks: log.filter(l => l.k === 'tick' && l.time < 0.05).length, refreshes: log.filter(l => l.k === 'refresh').map(l => ({ seek: l.seek, force: l.force })),
  newItems: (drag?.newItems ?? []).map(i => `${i.trackName}/${i.id}@${i.at}`), pvdragExit: r.status };
summary.resetToZero = summary.minPlayhead < 0.05 || summary.zeroTicks > 0; summary.endMoved = Math.abs(summary.end - start) > 0.05;
await writeFile(outFile, JSON.stringify({ card, drop, stateBefore, samples, log, summary }, null, 1) + '\n');
console.log(JSON.stringify(summary)); cdp.close(); process.exit(0);
