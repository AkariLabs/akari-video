#!/usr/bin/env node
import { readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASES, FRAMES } from './fixtures.mjs';
import { launcherTierFromSurfaces, recomputeComparisons } from './compare-results.mjs';

const timestamp = (entry, fallback = 0) => {
  const value = Date.parse(entry?.measuredAt);
  return Number.isFinite(value) ? value : fallback;
};

export function mergeReports(documents, shell) {
  const surfaces = new Map();
  let checks = [], checkTime = -Infinity;
  for (const document of documents) {
    const time = timestamp(document.data, document.mtimeMs);
    if (document.data.checks?.length && time >= checkTime) {
      checks = document.data.checks; checkTime = time;
    }
    for (const entry of document.data.surfaces ?? []) {
      if (!CASES.includes(entry.fixture) || !['web', 'gpu', 'osr'].includes(entry.surface)) {
        throw new Error(`Unknown capture ${entry.fixture}/${entry.surface}`);
      }
      const key = `${entry.fixture}/${entry.surface}`, captured = timestamp(entry, time);
      if (!surfaces.has(key) || captured >= surfaces.get(key).time) {
        surfaces.set(key, { time: captured, entry: { ...entry, mergedFrom: document.path } });
      }
    }
  }
  const mergedSurfaces = [...surfaces.values()].map(value => value.entry);
  return { measuredAt: new Date().toISOString(), mergedFrom: documents.map(document => document.path),
    checks, surfaces: mergedSurfaces, shell,
    comparisons: [], launcher_tier: launcherTierFromSurfaces(mergedSurfaces), pass: false };
}

export function compareShellDom(report) {
  return CASES.map(fixture => {
    const web = report.surfaces.find(entry => entry.fixture === fixture && entry.surface === 'web')
      ?.outputs?.find(output => output.frameNumber === FRAMES[0])?.measurement;
    const shell = report.shell?.cases?.find(entry => entry.fixture === fixture)?.measurement;
    const result = { name: `shell-dom-parity:${fixture}`, pass: false, skippedUnrendered: 0 };
    if (!web || !shell) return { ...result, reason: 'measurement missing' };
    const classes = [...new Set([...Object.keys(web.boxes ?? {}), ...Object.keys(shell.boxes ?? {})])];
    const mismatches = [];
    for (const className of classes) {
      const left = web.boxes?.[className] ?? [], right = shell.boxes?.[className] ?? [];
      if (left.length !== right.length) { mismatches.push(`${className}: count ${left.length}/${right.length}`); continue; }
      for (let i = 0; i < left.length; i++) {
        const webUnrendered = left[i].width === 0 && left[i].height === 0;
        const shellUnrendered = right[i].width === 0 && right[i].height === 0;
        if (webUnrendered && shellUnrendered) { result.skippedUnrendered++; continue; }
        if (webUnrendered !== shellUnrendered) {
          mismatches.push(`${className}[${i}]: rendered ${webUnrendered ? 'shell' : 'web'} only`);
          continue;
        }
        for (const key of ['left', 'top', 'width', 'height']) {
          if (!Number.isFinite(left[i][key]) || !Number.isFinite(right[i][key])
            || Math.abs(left[i][key] - right[i][key]) > 1) mismatches.push(`${className}[${i}].${key}`);
        }
      }
    }
    return { ...result, pass: mismatches.length === 0, mismatches };
  });
}

async function main() {
  const out = resolve(process.argv[2] ?? fileURLToPath(new URL('./results/', import.meta.url)));
  const names = (await readdir(out)).filter(name => name === 'results-checks.json'
    || name === 'results.json' || /^results-(?:web|gpu|osr|all)-[a-z-]+\.json$/u.test(name));
  if (!names.length) throw new Error('No capture results');
  const documents = await Promise.all(names.map(async name => ({ path: name,
    mtimeMs: (await stat(join(out, name))).mtimeMs,
    data: JSON.parse(await readFile(join(out, name), 'utf8')) })));
  const shell = JSON.parse(await readFile(join(out, 'shell-results.json'), 'utf8').catch(() => '{"cases":[],"pass":false}'));
  const report = mergeReports(documents, shell);
  await recomputeComparisons(report, out, { requireComplete: true });
  report.shellDomChecks = compareShellDom(report);
  report.pass = report.pass && shell.pass === true && shell.checks?.every(check => check.pass === true)
    && report.shellDomChecks.every(check => check.pass === true);
  const temp = join(out, `results.json.${process.pid}.tmp`);
  await writeFile(temp, JSON.stringify(report, null, 2) + '\n');
  await rename(temp, join(out, 'results.json'));
  console.log(JSON.stringify({ pass: report.pass, checks: report.checks.length,
    captures: report.surfaces.length, shell: report.shell.cases.length,
    comparisons: report.comparisons.length, shellDomChecks: report.shellDomChecks.length,
    missing: report.missingSurfaces }));
  if (!report.pass) process.exitCode = 1;
}

if (process.argv[1] && await realpath(process.argv[1]).catch(() => null)
  === await realpath(fileURLToPath(import.meta.url))) await main();
