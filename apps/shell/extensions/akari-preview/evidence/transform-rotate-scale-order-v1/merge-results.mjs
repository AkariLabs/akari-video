#!/usr/bin/env node
import { readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PARITY_FIXTURES, PARITY_FRAMES, recomputeComparisons } from './compare-results.mjs';

const timestamp = (value, fallback = 0) => {
  const time = Date.parse(value?.measuredAt);
  return Number.isFinite(time) ? time : fallback;
};

/** Latest attempt wins per fixture/surface, including failures (never revive an older PASS). */
export function mergeReports(documents) {
  const surfaces = new Map();
  let latestChecks, latestChecksTime = -Infinity;
  let latest = { data: {} }, latestTime = -Infinity;
  for (const document of documents) {
    const time = timestamp(document.data, document.mtimeMs ?? 0);
    if (time >= latestTime) { latest = document; latestTime = time; }
    if (Array.isArray(document.data.checks) && document.data.checks.length && time >= latestChecksTime) {
      latestChecks = document.data.checks; latestChecksTime = time;
    }
    for (const value of document.data.surfaces ?? []) {
      if (![...PARITY_FIXTURES, 'legacy-keyframes'].includes(value.fixture) || !['web', 'gpu', 'osr'].includes(value.surface)) {
        throw new Error(`Unknown capture identity in ${document.path}: ${value.fixture}/${value.surface}`);
      }
      const key = `${value.fixture}/${value.surface}`, capturedAt = timestamp(value, time);
      if (!surfaces.has(key) || capturedAt >= surfaces.get(key).time) {
        surfaces.set(key, { time: capturedAt, value: { ...value,
          measuredAt: new Date(capturedAt).toISOString(), mergedFrom: document.path } });
      }
    }
  }
  return { ...latest.data, measuredAt: new Date(latestTime).toISOString(), mergedAt: new Date().toISOString(),
    mergedFrom: documents.map(value => value.path), frames: PARITY_FRAMES,
    checks: latestChecks ?? [], surfaces: [...surfaces.values()].map(entry => entry.value),
    comparisons: [], madBaselines: {}, pass: false };
}

async function main() {
  const out = resolve(process.argv[2] ?? fileURLToPath(new URL('./results/', import.meta.url)));
  const names = (await readdir(out)).filter(name => name === 'results.json'
    || /^results-(?:web|gpu|osr|all)-[a-z-]+\.json$/u.test(name));
  names.sort((a, b) => a === 'results.json' ? -1 : b === 'results.json' ? 1 : a.localeCompare(b));
  if (!names.length) throw new Error(`No result JSON files in ${out}`);
  const documents = await Promise.all(names.map(async name => {
    const path = join(out, name);
    return { path: name, mtimeMs: (await stat(path)).mtimeMs, data: JSON.parse(await readFile(path, 'utf8')) };
  }));
  const report = mergeReports(documents);
  await recomputeComparisons(report, out, { requireComplete: true });
  const temporary = join(out, `results.json.${process.pid}.tmp`);
  await writeFile(temporary, JSON.stringify(report, null, 2) + '\n');
  await rename(temporary, join(out, 'results.json'));
  console.log(JSON.stringify({ pass: report.pass, surfaces: report.surfaces.length,
    comparisons: report.comparisons.length, missingSurfaces: report.missingSurfaces }));
  if (!report.pass) process.exitCode = 1;
}

if (process.argv[1] && await realpath(process.argv[1]) === await realpath(fileURLToPath(import.meta.url))) await main();
