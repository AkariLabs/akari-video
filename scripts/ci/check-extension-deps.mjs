#!/usr/bin/env node

import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// コメントと文字列の中の見かけの import は除外する。位置は元ソースのまま保持する。
export function extractExtensionImports(source, { extensionNames, selfName }) {
  const names = new Set(extensionNames);
  const tokens = [...source.matchAll(/\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|'(?:\\[\s\S]|[^'\\])*'|"(?:\\[\s\S]|[^"\\])*"|`(?:\\[\s\S]|[^`\\])*`|[\w$]+|[^\s]/g)]
    .filter(match => !match[0].startsWith('//') && !match[0].startsWith('/*'));
  const imports = new Map();
  for (let i = 0; i < tokens.length; i += 1) {
    const keyword = tokens[i][0];
    if (tokens[i - 1]?.[0] === '.') continue;
    let specifier;
    if (keyword === 'from') specifier = tokens[i + 1];
    else if ((keyword === 'import' || keyword === 'require') && tokens[i + 1]?.[0] === '(') {
      specifier = tokens[i + 2];
      if (![')', ','].includes(tokens[i + 3]?.[0])) continue;
    }
    if (!specifier || !/^['"]/.test(specifier[0])) continue;
    const name = specifier[0].slice(1, -1).split('/')[0];
    if (!names.has(name) || name === selfName || name.startsWith('.') || name.startsWith('@')) continue;
    const line = source.slice(0, tokens[i].index).split(/\r\n|\r|\n/).length;
    if (!imports.has(name)) imports.set(name, { name, lines: [] });
    const lines = imports.get(name).lines;
    if (!lines.includes(line)) lines.push(line);
  }
  return [...imports.values()];
}

// tsc -b の引数だけを対象にし、後続の別コマンドは混ぜない。
export function parseBuildExtOrder(buildExtScript) {
  const tokens = (buildExtScript ?? '').match(/"[^"]*"|'[^']*'|&&|\|\||[;&|]|[^\s;&|]+/g) ?? [];
  const unquote = token => token.replace(/^(['"])(.*)\1$/, '$2');
  const start = tokens.findIndex((token, i) => unquote(token) === 'tsc' && tokens[i + 1] === '-b');
  if (start < 0) return [];
  const order = [];
  for (const token of tokens.slice(start + 2)) {
    if (/^[;&|]+$/.test(token)) break;
    const match = unquote(token).match(/^(?:\.\/)?extensions\/([^/]+)\/?$/);
    if (match) order.push(match[1]);
  }
  return order;
}

export function findOrderViolations(order, edges) {
  return edges.filter(({ from, to }) => {
    const fromIndex = order.indexOf(from);
    const toIndex = order.indexOf(to);
    return fromIndex < 0 || toIndex < 0 || toIndex >= fromIndex;
  });
}

// devDependencies ではなく、拡張の実行時 dependencies の file: 宣言を要求する。
export function findMissingFileDeps(dependencies, edges) {
  return edges.filter(({ to }) => typeof dependencies?.[to] !== 'string' || !dependencies[to].startsWith('file:'));
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    .flatMap(entry => {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(file);
      return entry.isFile() && /\.(?:ts|tsx|mjs|js|cjs)$/.test(entry.name) ? [file] : [];
    });
}

function main(argv) {
  let shellPackage = path.join(repoRoot, 'apps/shell/package.json');
  let extensionsDir = path.join(repoRoot, 'apps/shell/extensions');
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (!['--shell-package', '--extensions-dir'].includes(flag) || !argv[i + 1] || argv[i + 1].startsWith('--')) {
      throw new Error(`引数が不正です: ${flag}`);
    }
    const value = path.resolve(argv[++i]);
    if (flag === '--shell-package') shellPackage = value;
    else extensionsDir = value;
  }

  const shell = JSON.parse(readFileSync(shellPackage, 'utf8'));
  const order = parseBuildExtOrder(shell.scripts?.['build:ext']);
  const extensionNames = readdirSync(extensionsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  const violations = [];
  let fileCount = 0;
  let edgeCount = 0;
  for (const from of extensionNames) {
    const extensionDir = path.join(extensionsDir, from);
    const pkg = JSON.parse(readFileSync(path.join(extensionDir, 'package.json'), 'utf8'));
    for (const file of sourceFiles(path.join(extensionDir, 'src'))) {
      fileCount += 1;
      const edges = extractExtensionImports(readFileSync(file, 'utf8'), { extensionNames, selfName: from })
        .flatMap(({ name: to, lines }) => lines.map(line => ({ from, to, file, line })));
      edgeCount += edges.length;
      for (const edge of findMissingFileDeps(pkg.dependencies, edges)) {
        violations.push({ ...edge, reason: 'dependencies に file: 依存がありません' });
      }
      for (const edge of findOrderViolations(order, edges)) {
        violations.push({ ...edge, reason: 'build:ext で依存先が先にありません（トークン欠落を含む）' });
      }
    }
  }
  for (const { from, to, file, line, reason } of violations) {
    process.stderr.write(`[extension-deps] ${path.relative(repoRoot, file)}:${line}: ${from} → ${to}: ${reason}\n`);
  }
  if (violations.length > 0) process.exitCode = 1;
  else process.stdout.write(`[extension-deps] OK: ${extensionNames.length} extensions, ${fileCount} files, ${edgeCount} imports\n`);
}

// symlink 経由でも CLI として実行し、import 時には検査を起動しない。
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`[extension-deps] ${error.message}\n`);
    process.exitCode = 1;
  }
}
