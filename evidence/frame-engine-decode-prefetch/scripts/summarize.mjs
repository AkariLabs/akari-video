// gpu-run.json を表にする: node summarize.mjs <results-dir> <label>...
import { readFileSync, existsSync } from 'node:fs';
const [resultsDir, ...labels] = process.argv.slice(2);
const configs = ['1080p-x1', '1080p-pip', '4k-x1-out1080', '4k-pip-out1080', '4k-x1-out4k', '4k-pip-out4k', '1080p-30s'];
const f = (v, d = 1) => v == null ? '-' : Number(v).toFixed(d);
for (const label of labels) {
  console.log(`## ${label}`);
  console.log('| config | elapsedMs | fps | decode p50 | p95 | max | upload p50 | p95 | evaluate p50 | p95 | peak MB | prefetch hit/miss | ahead p50 |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const c of configs) {
    const p = `${resultsDir}/${label}/${c}.gpu-run.json`;
    if (!existsSync(p)) continue;
    const r = JSON.parse(readFileSync(p, 'utf8'));
    const m = r.frameEngineMetrics; const pf = m.prefetch;
    console.log(`| ${c} | ${f(r.elapsedMs, 0)} | ${f(r.framesCompleted / (r.elapsedMs / 1000))} | ${f(m.decode.p50Ms)} | ${f(m.decode.p95Ms)} | ${f(m.decode.maxMs, 0)} | ${f(m.upload.p50Ms)} | ${f(m.upload.p95Ms)} | ${f(r.stages.evaluate.p50)} | ${f(r.stages.evaluate.p95)} | ${f(r.memory.peakBytes / 1048576, 0)} | ${pf ? `${pf.hit}/${pf.miss}` : '-'} | ${pf ? f(pf.aheadFrames?.p50, 0) : '-'} |`);
  }
}
