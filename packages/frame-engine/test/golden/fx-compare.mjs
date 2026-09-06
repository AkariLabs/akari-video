import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const results = JSON.parse(readFileSync(resolve(directory, '.generated/results.json'), 'utf8'));
const rows = results.fxParity ?? [];

assert.equal(rows.length, 10);
assert.equal(rows.every(row => row.pass === true), true);
assert.equal(rows.find(row => row.id === 'blur')?.monotone, true);
assert.equal(rows.find(row => row.id === 'none')?.differingPixels, 0);
assert.equal(results.fxStats.glErrors, 0);
process.stdout.write('| item fx | meanAbs | maxDelta | differingPixels | tolerance | deterministic | monotone |\n');
process.stdout.write('|---|---:|---:|---:|---|---|---|\n');
for (const row of rows) {
  const tolerance = row.id === 'none' ? 'pixels=0' : `pixels>=${row.tolerance.minDifferingPixels}`;
  process.stdout.write(`| ${row.id} | ${row.meanAbs.toFixed(4)} | ${row.maxDelta} | ${row.differingPixels} | ${tolerance} | ${row.deterministic} | ${row.monotone ?? '-'} |\n`);
}
const cost = results.fxCost;
process.stdout.write(`FX cost (${cost.unit}, ${cost.method}): with=${cost.withFxMs.toFixed(4)}, without=${cost.withoutFxMs.toFixed(4)}, delta=${cost.deltaMs.toFixed(4)}, frames=${cost.frames} per variant; ${cost.calculation}\n`);
process.stdout.write(`Target: delta <= ${cost.targetDeltaMs} ms/frame; meetsTarget=${cost.meetsTarget}\n`);
process.stdout.write(`\nGPU pass breakdown (${cost.passMethod}, ${cost.passFrames} separate frames)\n\n`);
process.stdout.write('| stage | median ms/frame | samples |\n|---|---:|---:|\n');
for (const pass of cost.passes) {
  process.stdout.write(`| ${pass.stage} | ${pass.medianMs?.toFixed(4) ?? 'unavailable'} | ${pass.samples} |\n`);
}
process.stdout.write(`Sum of pass medians: ${cost.passMedianSumMs?.toFixed(4) ?? 'unavailable'}; median of frame sums: ${cost.passFrameMedianMs?.toFixed(4) ?? 'unavailable'}; whole compose: ${cost.withFxMs.toFixed(4)} ms/frame\n`);
if (cost.passFailureReason) process.stdout.write(`Pass measurement incomplete: ${cost.passFailureReason}\n`);
