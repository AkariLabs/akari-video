#!/usr/bin/env node
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const baselinePath = path.join(root, 'scripts/ci/i18n-baseline.json');
const japanese = /[\u3040-\u30ff\u3400-\u9fff]/u;
const sourceRoots = [
  'apps/shell/extensions',
  ...['akari-launcher', 'analysis-report', 'decision-log-report', 'decision-cards', 'edit-lint', 'render-cut'].map(name => `packages/${name}`)
];
const catalogRoot = path.join(root, 'packages/i18n/locales');
const allowlist = new Set();
const issues = [];
const counts = {};

function walk(directory, visit) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (['node_modules', 'lib', 'dist', 'vendor', 'evidence', 'test', 'tests', '__tests__', 'fixtures', 'locales'].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute, visit);
    else if (entry.isFile()) visit(absolute);
  }
}

function codeWithoutComments(source) {
  let block = false;
  return source.split(/\r?\n/u).map(line => {
    let result = '';
    let quote = '';
    for (let i = 0; i < line.length; i++) {
      const char = line[i], next = line[i + 1];
      if (block) { if (char === '*' && next === '/') { block = false; i++; } continue; }
      if (quote) {
        result += char;
        if (char === '\\') { result += next ?? ''; i++; }
        else if (char === quote) quote = '';
        continue;
      }
      if (char === '/' && next === '*') { block = true; i++; continue; }
      if (char === '/' && next === '/') break;
      if (char === '"' || char === "'" || char === '`') quote = char;
      result += char;
    }
    return result;
  });
}

for (const relativeRoot of sourceRoots) {
  walk(path.join(root, relativeRoot), absolute => {
    if (!/\.(?:ts|tsx|mjs|js|cjs)$/u.test(absolute) || /(?:^|\/)[^/]+\.(?:test|spec)\.[^/]+$/u.test(absolute)) return;
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    if (allowlist.has(relative)) return;
    if (relativeRoot === 'apps/shell/extensions' && !/^apps\/shell\/extensions\/[^/]+\/src\//u.test(relative)) return;
    if (relativeRoot !== 'apps/shell/extensions' && !/\/(?:src|bin)\//u.test(relative)) return;
    const lines = codeWithoutComments(readFileSync(absolute, 'utf8'));
    const count = lines.filter(line => japanese.test(line)).length;
    if (count) counts[relative] = count;
  });
}

function catalog(language) {
  const entries = {};
  for (const filename of readdirSync(path.join(catalogRoot, language)).filter(name => name.endsWith('.json'))) {
    const values = JSON.parse(readFileSync(path.join(catalogRoot, language, filename), 'utf8'));
    for (const [key, value] of Object.entries(values)) {
      if (typeof value !== 'string' || !key.startsWith(`${filename.slice(0, -5)}.`) || !/^[a-z][a-z0-9-]*(?:\.[a-z][a-zA-Z0-9]*){3,}(?:_(?:one|other))?$/u.test(key)) issues.push(`invalid catalog entry ${language}/${filename}: ${key}`);
      if (key in entries) issues.push(`duplicate catalog key: ${key}`);
      entries[key] = value;
    }
  }
  return entries;
}

const ja = catalog('ja'), en = catalog('en');
const placeholders = value => [...new Set([...value.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/gu)].map(match => match[1]))].sort().join(',');
for (const key of new Set([...Object.keys(ja), ...Object.keys(en)])) {
  if (!(key in ja) || !(key in en)) issues.push(`catalog key mismatch: ${key}`);
  else if (placeholders(ja[key]) !== placeholders(en[key])) issues.push(`placeholder mismatch: ${key}`);
  if (key.endsWith('_one') && !(`${key.slice(0, -4)}_other` in en)) issues.push(`missing plural pair: ${key}`);
  if (key.endsWith('_other') && !(`${key.slice(0, -6)}_one` in en)) issues.push(`missing plural pair: ${key}`);
}

for (const relativeRoot of sourceRoots) {
  walk(path.join(root, relativeRoot), absolute => {
    if (!/\.(?:ts|tsx|mjs|js|cjs)$/u.test(absolute) || /(?:^|\/)[^/]+\.(?:test|spec)\.[^/]+$/u.test(absolute)) return;
    const source = readFileSync(absolute, 'utf8');
    if (!/(?:from\s*['"]@akari-video\/i18n['"]|require\(['"]@akari-video\/i18n['"]\))/u.test(source)) return;
    for (const match of source.matchAll(/\bt\(\s*['"]([a-z][\w.-]*)['"]/gu)) {
      if (!(match[1] in ja) && !(`${match[1]}_other` in ja)) issues.push(`missing catalog key ${match[1]} in ${path.relative(root, absolute)}`);
    }
  });
}

if (process.argv.includes('--write-baseline')) {
  if (issues.length) { console.error(issues.join('\n')); process.exitCode = 1; }
  else { writeFileSync(baselinePath, `${JSON.stringify(counts, null, 2)}\n`); console.log(`wrote ${Object.keys(counts).length} baseline files`); }
} else {
  let baseline;
  try { baseline = JSON.parse(readFileSync(baselinePath, 'utf8')); }
  catch { issues.push('missing i18n baseline'); baseline = {}; }
  for (const [file, count] of Object.entries(counts)) {
    const allowed = baseline[file] ?? 0;
    if (count > allowed) issues.push(`${file}: Japanese lines ${count} > baseline ${allowed}`);
    else if (count < allowed) console.log(`${file}: baseline can decrease ${allowed} -> ${count}`);
  }
  for (const [file, count] of Object.entries(baseline)) if (!(file in counts)) console.log(`${file}: baseline can decrease ${count} -> 0`);
  if (issues.length) { console.error(issues.join('\n')); process.exitCode = 1; }
  else console.log(`i18n lint passed (${Object.keys(counts).length} source files)`);
}
