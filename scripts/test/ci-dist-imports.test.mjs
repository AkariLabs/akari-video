// packages/*/dist を読むテストと CI l0 の事前 build を照合する。
// 限界: createRequire や pathToFileURL を組み立てる import は文字列リテラルの検査では検出できない。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { coveredTestFiles } from '../ci/run-unit-tests.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const normalized = file => file.split(path.sep).join('/');

function trackedSources() {
  const result = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: repoRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024
  });
  assert.equal(result.status, 0, result.stderr);
  return [...new Set(result.stdout.split('\0').filter(Boolean).map(normalized))]
    .filter(file => /\.(?:mjs|js|cjs|ts|tsx)$/u.test(file))
    .filter(file => !/(?:^|\/)(?:evidence|node_modules|generated|public|lib)\//u.test(file));
}

function distImports() {
  const importers = new Map();
  for (const file of trackedSources()) {
    const source = readFileSync(path.join(repoRoot, file), 'utf8')
      .split(/\r?\n/u)
      .filter(line => !/^\s*(?:\/\/|\/\*|\*)/u.test(line))
      .join('\n');
    const references = [
      ...source.matchAll(/\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/gu),
      ...source.matchAll(/\bimport\s+(?:[\s\S]{0,300}?\s+from\s+)?(['"])([^'"]+)\1/gu),
      ...source.matchAll(/\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[\s\S]{0,300}?\})\s+from\s+(['"])([^'"]+)\1/gu),
      ...source.matchAll(/\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/gu)
    ];
    for (const match of references) {
      const specifier = match[2];
      const resolved = specifier.startsWith('.')
        ? path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier))
        : specifier;
      const packageName = resolved.match(/(?:^|\/)packages\/([^/]+)\/dist(?:\/|$)/u)?.[1];
      if (!packageName) continue;
      // 自パッケージの dist はそのパッケージ自身の build/test 契約に属する。
      const importerPackage = file.match(/^packages\/([^/]+)\//u)?.[1];
      if (importerPackage === packageName) continue;
      const files = importers.get(packageName) ?? new Set();
      files.add(file);
      importers.set(packageName, files);
    }
  }
  return importers;
}

function l0Builds() {
  const workflow = readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
  const lines = workflow.split(/\r?\n/u);
  const start = lines.findIndex(line => /^  l0:\s*$/u.test(line));
  assert.ok(start >= 0, 'ci.yml に l0 ジョブが無い');
  const end = lines.findIndex((line, index) => index > start && /^  [\w-]+:\s*$/u.test(line));
  const job = lines.slice(start + 1, end < 0 ? undefined : end);
  const commands = [];
  let blockIndent = null;
  for (const line of job) {
    if (/^\s*#/u.test(line)) continue;
    const run = line.match(/^(\s*)(?:-\s*)?run:\s*(.*)$/u);
    if (run) {
      blockIndent = /^[|>]/u.test(run[2]) ? run[1].length : null;
      if (blockIndent === null) commands.push(run[2]);
      continue;
    }
    if (blockIndent !== null && line.trim()) {
      const indent = line.match(/^\s*/u)[0].length;
      if (indent > blockIndent) commands.push(line.trim());
      else blockIndent = null;
    }
  }
  const shell = commands.findIndex(command => /\bnode\s+\S*run-unit-tests\.mjs\s+--lane\s+shell\b/u.test(command));
  assert.ok(shell >= 0, 'ci.yml の l0 ジョブに --lane shell が無い');
  const builds = new Set();
  for (const command of commands.slice(0, shell)) {
    const name = command.match(/\bnpm\s+--prefix\s+(?:\S*\/)?packages\/([^\s/]+)\s+run\s+build\b/u)?.[1];
    if (name) builds.add(name);
  }
  return builds;
}

test('dist import のパッケージと l0 の shell より前の build が一致する', () => {
  const imports = distImports();
  const builds = l0Builds();
  const missing = [...imports.keys()].filter(name => !builds.has(name)).sort();
  const unnecessary = [...builds].filter(name => !imports.has(name)).sort();
  const missingDetails = missing.map(name => `${name}（${[...imports.get(name)].sort().join(', ')}）`);
  assert.deepEqual({ missing, unnecessary }, { missing: [], unnecessary: [] },
    `dist import と build の差分: build 不足=${missingDetails.join(', ') || 'なし'}、不要 build=${unnecessary.join(', ') || 'なし'}。` +
    '.github/workflows/ci.yml の l0 ジョブ、または該当テストの import を直してください');
});

test('dist を import するテストは build の無い pure レーンに載らない', () => {
  const pure = coveredTestFiles(repoRoot, 'pure');
  const leaked = [...distImports()].flatMap(([name, files]) => [...files]
    .filter(file => /\.(?:test|spec)\.(?:mjs|js|cjs|ts|tsx)$/u.test(file) && pure.has(file))
    .map(file => `${file} → ${name}`)).sort();
  assert.deepEqual(leaked, [], `pure に dist import が混入: ${leaked.join(', ')}`);
});
