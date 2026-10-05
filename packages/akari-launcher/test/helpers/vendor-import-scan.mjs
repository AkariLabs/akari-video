import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

// These test-only references ship under VENDOR_SOURCES but are not runtime
// imports. Keep every source file in the scan and pin each exception exactly.
export const ALLOWED_MISSING = new Map([
  // This preview generator is a development-only bake script, never a launcher runtime entry.
  ['presets/luts/bake-previews.mjs: ../transitions/preview-art.mjs', 'development-only preview baker'],
  // The preview test is shipped as source but is not run by the launcher.
  ['presets/luts/previews.test.mjs: ../transitions/preview-art.mjs', 'test-only preview import'],
  // This skill test reuses a launcher test file; launcher tests are not vendored.
  ['skills/akari/test/skills-command.test.mjs: ../../../packages/akari-launcher/test/skills-command.test.mjs', 'test-only launcher entry'],
  // These three strings are written into scratch JS files by the test.
  ['skills/edit-plan/bin/test/propose-cut-candidates.test.mjs: ./helper.mjs', 'scratch module fixture'],
  ['skills/edit-plan/bin/test/propose-cut-candidates.test.mjs: ./nested/value.mjs', 'scratch nested module fixture'],
  ['skills/edit-plan/bin/test/propose-cut-candidates.test.mjs: ./unregistered.mjs', 'intentional missing scratch module fixture'],
]);

const IMPORTS = [
  /\b(?:import|export)\s+(?:[^'"`;]*?\s+from\s*)?['"](\.{1,2}\/[^'"\n]+)['"]/gu,
  /\bimport\s*\(\s*['"](\.{1,2}\/[^'"\n]+)['"]\s*\)/gu,
  /\brequire\s*\(\s*['"](\.{1,2}\/[^'"\n]+)['"]\s*\)/gu,
];

function allFiles(root) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) files.push(full);
    }
  }
  return files.sort();
}

function resolves(from, specifier) {
  // ESM の指定子は ?query / #hash を付けられる（テストが同じモジュールを別インスタンスで読むのに使う）。ファイル解決では外す
  const base = path.resolve(path.dirname(from), specifier.replace(/[?#].*$/u, ''));
  return [base, `${base}.mjs`, `${base}.js`, `${base}.json`, path.join(base, 'index.mjs'), path.join(base, 'index.js')]
    .some(candidate => existsSync(candidate) && statSync(candidate).isFile());
}

export function scanVendorImports(vendor) {
  const missing = [];
  const sources = allFiles(vendor).filter(file => /\.(?:mjs|js)$/u.test(file));
  for (const file of sources) {
    const source = readFileSync(file, 'utf8');
    for (const pattern of IMPORTS) {
      for (const match of source.matchAll(pattern)) {
        const from = path.relative(vendor, file).split(path.sep).join('/');
        const specifier = match[1];
        if (!resolves(file, specifier)) missing.push(`${from}: ${specifier}`);
      }
    }
  }
  const unresolved = [...new Set(missing)].sort();
  return {
    scannedFiles: sources.length,
    unresolved,
    allowed: unresolved.filter(reference => ALLOWED_MISSING.has(reference)),
    unexpected: unresolved.filter(reference => !ALLOWED_MISSING.has(reference)),
  };
}
