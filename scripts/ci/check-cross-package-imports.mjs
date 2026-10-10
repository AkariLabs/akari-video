#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const codeFile = /\.(?:mjs|js|cjs)$/;
const sourceDirectories = ['src', 'bin', 'lib'];

function packageName(root, source) {
  const relative = path.relative(path.join(root, 'packages'), source);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  const name = relative.split(path.sep)[0];
  return name && name !== '.' ? name : null;
}

async function distributedPackages(root) {
  const shell = JSON.parse(readFileSync(path.join(root, 'apps/shell/package.json'), 'utf8'));
  const names = new Set();
  for (const entry of shell.build?.extraResources ?? []) {
    if (typeof entry.from !== 'string' || !/^packages\//.test(entry.to ?? '')) continue;
    const name = packageName(root, path.resolve(root, 'apps/shell', entry.from));
    if (name) names.add(name);
  }

  const vendorFile = path.join(root, 'packages/akari-launcher/src/vendor-sources.mjs');
  const { VENDOR_SOURCES } = await import(pathToFileURL(vendorFile).href);
  if (!Array.isArray(VENDOR_SOURCES) || VENDOR_SOURCES.some(source => typeof source !== 'string')) {
    throw new Error('VENDOR_SOURCES must be an array of paths');
  }
  for (const source of VENDOR_SOURCES) {
    if (!source.startsWith('packages/')) continue;
    const name = packageName(root, path.resolve(root, source));
    if (name) names.add(name);
  }
  return [...names].sort();
}

function* codeFiles(directory) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* codeFiles(file);
    else if (entry.isFile() && codeFile.test(entry.name)) yield file;
  }
}

// Tokenize enough JavaScript to ignore comments and strings that merely mention imports.
// Keep string tokens so the actual module specifier can be checked without dependencies.
export function crossPackageImports(source) {
  const tokens = [...source.matchAll(/\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|'(?:\\[\s\S]|[^'\\])*'|"(?:\\[\s\S]|[^"\\])*"|`(?:\\[\s\S]|[^`\\])*`|[\w$]+|[^\s]/g)]
    .filter(match => !match[0].startsWith('//') && !match[0].startsWith('/*'));
  const found = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const keyword = tokens[i][0];
    if (!['import', 'export', 'require'].includes(keyword)
      || (keyword !== 'require' && tokens[i - 1]?.[0] === '.')) continue;
    let specifier;
    if (tokens[i + 1]?.[0] === '(' && keyword !== 'export') {
      if (tokens[i + 3]?.[0] === ')' || tokens[i + 3]?.[0] === ',') specifier = tokens[i + 2];
    } else if (keyword === 'import' && /^['"`]/.test(tokens[i + 1]?.[0] ?? '')) {
      specifier = tokens[i + 1];
    } else if (keyword !== 'require' && tokens[i + 1]?.[0] !== '.') {
      for (let j = i + 1; j < tokens.length && j < i + 100 && tokens[j][0] !== ';'; j += 1) {
        if (tokens[j][0] === 'from') {
          specifier = tokens[j + 1];
          break;
        }
      }
    }
    if (!specifier || !/^['"`]/.test(specifier[0])) continue;
    const value = specifier[0].slice(1, -1);
    if (!value.startsWith('@akari-video/')) continue;
    found.push({ specifier: value, line: source.slice(0, tokens[i].index).split(/\r\n|\r|\n/).length });
  }
  return found;
}

async function main(args) {
  let root = defaultRoot;
  if (args.length) {
    if (args.length !== 2 || args[0] !== '--root' || !args[1]) throw new Error('usage: check-cross-package-imports.mjs [--root <directory>]');
    root = path.resolve(args[1]);
  }
  const names = await distributedPackages(root);
  const violations = [];
  let files = 0;
  for (const name of names) {
    const packageRoot = path.join(root, 'packages', name);
    if (!existsSync(packageRoot)) throw new Error(`distributed package is missing: packages/${name}`);
    for (const directory of sourceDirectories) {
      for (const file of codeFiles(path.join(packageRoot, directory))) {
        files += 1;
        for (const found of crossPackageImports(readFileSync(file, 'utf8'))) {
          violations.push(`${path.relative(root, file)}:${found.line}: ${found.specifier}`);
        }
      }
    }
  }
  if (violations.length) {
    for (const violation of violations) process.stderr.write(`[cross-package-imports] ${violation}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`[cross-package-imports] OK: ${names.length} packages, ${files} files\n`);
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`[cross-package-imports] ${error.message}\n`);
    process.exitCode = 1;
  });
}
