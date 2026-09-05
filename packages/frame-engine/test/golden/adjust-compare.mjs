import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const results = JSON.parse(readFileSync(resolve(directory, '.generated/results.json'), 'utf8'));
const rows = results.adjustParity ?? [];

assert.equal(rows.length, 6);
assert.equal(rows.every(row => row.pass === true), true);
process.stdout.write('| item adjust | meanAbs | maxDelta | differingPixels | tolerance |\n');
process.stdout.write('|---|---:|---:|---:|---|\n');
for (const row of rows) {
  process.stdout.write(`| ${row.id} | ${row.meanAbs.toFixed(4)} | ${row.maxDelta} | ${row.differingPixels} | mean<=${row.tolerance.meanAbs}, max<=${row.tolerance.maxDelta} |\n`);
}
