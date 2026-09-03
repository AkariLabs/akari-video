#!/usr/bin/env node
// パッケージ版 Resources の静的 import グラフ検査 — 同梱漏れを CI で機械検出する。
//
// なぜ要るか: extraResources で配る CLI / ランタイム（skills/**/bin・render-cut・osr-export・
// gpu-export・edit-lint・akari-launcher）は、モノレポでは隣の packages/ や skills/ を相対 import で参照できてしまう。
// パッケージ版の Resources にその参照先が同梱されていないと、import 時点で ERR_MODULE_NOT_FOUND になり
// 書き出しが全滅する（v0.1.25: packages/gpu-export と skills/analyze-footage/bin/person-matte の同梱漏れ、
// および @webav/mp4box.js の同梱 node_modules 漏れ。実ビルドで再現・v0.1.26 で修正）。
// モノレポのテストではこの種の漏れは見えないため、extraResources と同じ構成の「模擬 Resources」を組み、
// 入口から import を辿って欠けを列挙する。
//
// やること:
//   1. apps/shell/package.json の build.extraResources を読み、from → to を filter どおり模擬 Resources に
//      symlink で組む（実ファイルはコピーしない。相対 import の解決は論理パスで行うので symlink で足りる）
//   2. 入口 = 模擬 Resources 内の packages/*/bin/*.mjs 全部 + skills/**/bin/**/*.mjs +
//      osr-export / gpu-export の src/electron-main.mjs
//   3. 静的 import（import … from / export … from / import "x"）を再帰的に辿る。相対は存在検査、
//      bare は packages/node_modules（= resources/cli-node-modules）から解決。node: と electron は対象外
//   4. リポジトリのソースツリーにある package 解決関数の文字列リテラル引数を走査し、模擬 Resources
//      の packages/<pkg>/<rel> に実体があるか検査する。非リテラル引数は参考情報に留める
//   5. 動的 import("x") は参考情報（hyperframes のように意図的に同梱しない依存があるため fail にしない）
//
// 前提: resources/cli-node-modules が staging 済み（scripts/release/install-bundled-cli-deps.mjs →
// apps/shell/resources/scripts/bundle-cli-node-modules.mjs）。無ければ bare import は全部 missing になる。
//
// 使い方:
//   node scripts/release/check-packaged-imports.mjs [--shell-package apps/shell/package.json] [--keep]
// 終了コード: 欠け 0 なら 0、1 件以上なら 1。
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RESTRICTED_ASSETS } from './check-no-gpl-redistribution.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..');
const args = process.argv.slice(2);
const shellPackagePath = resolve(REPO_ROOT, args.includes('--shell-package') ? args[args.indexOf('--shell-package') + 1] : 'apps/shell/package.json');
const SHELL_DIR = resolve(REPO_ROOT, 'apps', 'shell');
const keep = args.includes('--keep');

// resolvePackageDir はまだ export されていないが、追加時に走査漏れを作らないため同じ正本へ置く。
export const PACKAGE_RESOLVER_NAMES = new Set([
  'resolvePackageFile',
  'resolvePackageDir',
  'importPackage',
]);

const RESTRICTED_PACKAGE_NAMES = new Set(RESTRICTED_ASSETS.flatMap((asset) =>
  asset.paths.flatMap((assetPath) => {
    const match = /^packages\/([^/]+)$/u.exec(assetPath.replaceAll('\\', '/').replace(/\/$/u, ''));
    return match ? [match[1]] : [];
  })));

// electron-builder の filter（from 相対の glob）を正規表現へ。使っている形は
// `package.json` / `bin/**/*` / `src/**/*` / `generated/**/*` / `*.mjs` / `lib/**` 程度。
export function globToRegExp(pattern) {
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        index += 1;
        if (pattern[index + 1] === '/') { index += 1; source += '(?:.*/)?'; } else { source += '.*'; }
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

function walkFiles(root) {
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else out.push(full);
    }
  }
  return out;
}

// 模擬 Resources を組む。戻り値 = { resourcesRoot, skipped: [生成物などで from が無いエントリ] }
export function assembleResources(shellPackage, { shellDir = SHELL_DIR, resourcesRoot } = {}) {
  const entries = shellPackage.build?.extraResources ?? [];
  const skipped = [];
  for (const entry of entries) {
    const from = resolve(shellDir, typeof entry === 'string' ? entry : entry.from);
    const to = resolve(resourcesRoot, typeof entry === 'string' ? '.' : (entry.to ?? '.'));
    const filters = typeof entry === 'string' ? null : entry.filter ?? null;
    if (!existsSync(from)) { skipped.push(typeof entry === 'string' ? entry : entry.from); continue; }
    if (!filters && statSync(from).isDirectory()) {
      mkdirSync(dirname(to), { recursive: true });
      if (existsSync(to)) {
        // 同じ to に複数エントリが重なる場合（resources/generated-notices -> . など）は中身を個別に張る
        for (const file of walkFiles(from)) linkFile(file, join(to, relative(from, file)));
      } else {
        symlinkSync(from, to, 'dir');
      }
      continue;
    }
    const regexps = (filters ?? ['**/*']).map(globToRegExp);
    for (const file of walkFiles(from)) {
      const rel = relative(from, file).split('\\').join('/');
      if (regexps.some((regexp) => regexp.test(rel))) linkFile(file, join(to, rel));
    }
  }
  return { resourcesRoot, skipped };
}

function linkFile(source, target) {
  if (existsSync(target)) return;
  mkdirSync(dirname(target), { recursive: true });
  symlinkSync(source, target, 'file');
}

const STATIC_IMPORT = /(?:^|\n)\s*(?:import|export)\b[^'"\n;]*?\bfrom\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

function resolveBare(specifier, fromDir, resourcesRoot) {
  const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
  let dir = fromDir;
  while (dir.startsWith(resourcesRoot)) {
    if (existsSync(join(dir, 'node_modules', name))) return true;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return false;
}

function resolveRelative(specifier, fromFile) {
  const base = resolve(dirname(fromFile), specifier);
  for (const candidate of [base, `${base}.mjs`, `${base}.js`, join(base, 'index.mjs'), join(base, 'index.js')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

// 入口から静的 import を辿る。戻り値 = { walked, missing: [{ specifier, from }], dynamic: [{ specifier, from }] }
export function walkImports(entries, resourcesRoot) {
  const seen = new Set();
  const missing = [];
  const dynamic = [];
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!existsSync(file)) { missing.push({ specifier: relative(resourcesRoot, file), from: '(entry)' }); continue; }
    const source = readFileSync(file, 'utf8');
    const fromLabel = relative(resourcesRoot, file);
    for (const match of source.matchAll(STATIC_IMPORT)) {
      const specifier = match[1] ?? match[2];
      if (!specifier || specifier.startsWith('node:') || specifier === 'electron') continue;
      if (specifier.startsWith('.')) {
        const target = resolveRelative(specifier, file);
        if (target) queue.push(target);
        else missing.push({ specifier: relative(resourcesRoot, resolve(dirname(file), specifier)), from: fromLabel });
      } else if (!resolveBare(specifier, dirname(file), resourcesRoot)) {
        missing.push({ specifier: `(bare) ${specifier}`, from: fromLabel });
      }
    }
    for (const match of source.matchAll(DYNAMIC_IMPORT)) {
      const specifier = match[1];
      if (specifier.startsWith('node:') || specifier === 'electron') continue;
      if (specifier.startsWith('.')) {
        const target = resolveRelative(specifier, file);
        if (target) queue.push(target);
        else dynamic.push({ specifier, from: fromLabel });
      } else if (!resolveBare(specifier, dirname(file), resourcesRoot)) {
        dynamic.push({ specifier, from: fromLabel });
      }
    }
  }
  return { walked: seen.size, missing, dynamic };
}

function sourceFilesForPackageResolvers(repoRoot) {
  const files = [];
  const skillsDir = join(repoRoot, 'skills');
  if (existsSync(skillsDir)) {
    for (const file of walkFiles(skillsDir)) {
      const label = relative(skillsDir, file).split('\\').join('/');
      if (label.includes('/bin/') && !label.includes('/bin/test/') && file.endsWith('.mjs')) files.push(file);
    }
  }
  const packagesDir = join(repoRoot, 'packages');
  if (existsSync(packagesDir)) {
    for (const packageName of readdirSync(packagesDir)) {
      for (const directoryName of ['bin', 'src']) {
        const directory = join(packagesDir, packageName, directoryName);
        if (!existsSync(directory) || !statSync(directory).isDirectory()) continue;
        for (const file of walkFiles(directory)) if (file.endsWith('.mjs')) files.push(file);
      }
    }
  }
  return [...new Set(files)].sort();
}

function skipSpaceAndComments(source, start) {
  let index = start;
  while (index < source.length) {
    if (/\s/u.test(source[index])) { index += 1; continue; }
    if (source[index] === '/' && source[index + 1] === '/') {
      index = source.indexOf('\n', index + 2);
      if (index === -1) return source.length;
      continue;
    }
    if (source[index] === '/' && source[index + 1] === '*') {
      const close = source.indexOf('*/', index + 2);
      return close === -1 ? source.length : skipSpaceAndComments(source, close + 2);
    }
    break;
  }
  return index;
}

function readQuoted(source, start) {
  const quote = source[start];
  let value = '';
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === '\\') return null;
    if (char === quote) return { value, next: index + 1 };
    if (char === '\n' || char === '\r') return null;
    value += char;
  }
  return null;
}

function argumentEnd(source, start) {
  let depth = 0;
  let state = 'code';
  let quote = '';
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (state === 'line-comment') {
      if (char === '\n') state = 'code';
      continue;
    }
    if (state === 'block-comment') {
      if (char === '*' && next === '/') { state = 'code'; index += 1; }
      continue;
    }
    if (state === 'string') {
      if (char === '\\') { index += 1; continue; }
      if (char === quote) state = 'code';
      continue;
    }
    if (char === '/' && next === '/') { state = 'line-comment'; index += 1; continue; }
    if (char === '/' && next === '*') { state = 'block-comment'; index += 1; continue; }
    if (char === "'" || char === '"' || char === '`') { state = 'string'; quote = char; continue; }
    if (char === '(' || char === '[' || char === '{') { depth += 1; continue; }
    if (char === ')' || char === ']' || char === '}') {
      if (depth === 0 && char === ')') return index;
      depth -= 1;
      continue;
    }
    if (char === ',' && depth === 0) return index;
  }
  return source.length;
}

function resolverCalls(source) {
  const calls = [];
  let index = 0;
  while (index < source.length) {
    if (source[index] === '/' && source[index + 1] === '/') {
      const newline = source.indexOf('\n', index + 2);
      index = newline === -1 ? source.length : newline + 1;
      continue;
    }
    if (source[index] === '/' && source[index + 1] === '*') {
      const close = source.indexOf('*/', index + 2);
      index = close === -1 ? source.length : close + 2;
      continue;
    }
    if (source[index] === "'" || source[index] === '"' || source[index] === '`') {
      const quote = source[index];
      index += 1;
      while (index < source.length) {
        if (source[index] === '\\') { index += 2; continue; }
        if (source[index] === quote) { index += 1; break; }
        index += 1;
      }
      continue;
    }
    if (!/[A-Za-z_$]/u.test(source[index])) { index += 1; continue; }
    const start = index;
    index += 1;
    while (index < source.length && /[A-Za-z0-9_$]/u.test(source[index])) index += 1;
    const resolver = source.slice(start, index);
    if (!PACKAGE_RESOLVER_NAMES.has(resolver)) continue;
    if (/\bfunction\s*$/u.test(source.slice(Math.max(0, start - 30), start))) continue;
    const open = skipSpaceAndComments(source, index);
    if (source[open] !== '(') continue;
    const argumentStart = skipSpaceAndComments(source, open + 1);
    const end = argumentEnd(source, argumentStart);
    const expression = source.slice(argumentStart, end).trim().replace(/\s+/gu, ' ').slice(0, 160);
    const quoted = source[argumentStart] === "'" || source[argumentStart] === '"'
      ? readQuoted(source, argumentStart)
      : null;
    const afterQuoted = quoted ? skipSpaceAndComments(source, quoted.next) : -1;
    const literal = quoted && (source[afterQuoted] === ',' || source[afterQuoted] === ')')
      ? quoted.value
      : null;
    calls.push({ resolver, literal, expression, line: source.slice(0, start).split('\n').length });
    index = Math.max(index, end);
  }
  return calls;
}

// 実ソースツリーの package 解決呼び出しを、組み上げ済みの模擬 Resources と照合する。
export function scanPackageResolverCalls({ repoRoot = REPO_ROOT, resourcesRoot }) {
  const missing = [];
  const excluded = [];
  const dynamic = [];
  let found = 0;
  const files = sourceFilesForPackageResolvers(repoRoot);
  for (const file of files) {
    const sourceLabel = relative(repoRoot, file).split('\\').join('/');
    for (const call of resolverCalls(readFileSync(file, 'utf8'))) {
      if (!call.literal) {
        dynamic.push({ resolver: call.resolver, expression: call.expression || '(empty)', from: sourceLabel, line: call.line });
        continue;
      }
      const normalized = call.literal.replaceAll('\\', '/').replace(/^\/+|\/+$/gu, '');
      const [packageName, ...rest] = normalized.split('/');
      if (!packageName || rest.length === 0 || normalized.includes('../')) {
        dynamic.push({ resolver: call.resolver, expression: call.expression, from: sourceLabel, line: call.line });
        continue;
      }
      found += 1;
      const item = {
        resolver: call.resolver,
        specifier: `packages/${normalized}`,
        from: sourceLabel,
        line: call.line,
      };
      if (RESTRICTED_PACKAGE_NAMES.has(packageName)) excluded.push(item);
      else if (!existsSync(join(resourcesRoot, 'packages', normalized))) missing.push(item);
    }
  }
  return { scanned: files.length, found, missing, excluded, dynamic };
}

export function defaultEntries(resourcesRoot) {
  const entries = [];
  const packagesDir = join(resourcesRoot, 'packages');
  if (existsSync(packagesDir)) {
    for (const name of readdirSync(packagesDir)) {
      const binDir = join(packagesDir, name, 'bin');
      if (name === 'node_modules' || !existsSync(binDir)) continue;
      for (const file of readdirSync(binDir)) if (file.endsWith('.mjs')) entries.push(join(binDir, file));
    }
  }
  const skillsDir = join(resourcesRoot, 'skills');
  if (existsSync(skillsDir)) {
    for (const file of walkFiles(skillsDir)) {
      const label = relative(skillsDir, file).split('\\').join('/');
      if (label.includes('/bin/') && file.endsWith('.mjs')) entries.push(file);
    }
  }
  for (const runtime of ['osr-export', 'gpu-export']) {
    entries.push(join(packagesDir, runtime, 'src', 'electron-main.mjs'));
  }
  entries.push(join(packagesDir, 'preview-server', 'src', 'server.mjs'));
  return entries.sort();
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const shellPackage = JSON.parse(readFileSync(shellPackagePath, 'utf8'));
  const resourcesRoot = join(mkdtempSync(join(tmpdir(), 'akari-packaged-')), 'Resources');
  mkdirSync(resourcesRoot, { recursive: true });
  const { skipped } = assembleResources(shellPackage, { resourcesRoot });
  const entries = defaultEntries(resourcesRoot);
  const { walked, missing, dynamic } = walkImports(entries, resourcesRoot);
  const packageResolvers = scanPackageResolverCalls({ resourcesRoot });
  console.log(`check-packaged-imports: entries ${entries.length} / walked ${walked} files / Resources = ${resourcesRoot}`);
  if (skipped.length > 0) console.log(`  skipped (from が存在しない・生成物など): ${skipped.join(', ')}`);
  for (const entry of entries) console.log(`  entry: ${relative(resourcesRoot, entry)}`);
  if (dynamic.length > 0) {
    console.log(`  dynamic import（参考・fail にしない）: ${dynamic.length}`);
    for (const item of dynamic) console.log(`    ${item.specifier}  <- ${item.from}`);
  }
  if (packageResolvers.dynamic.length > 0) {
    console.log(`  package resolver の非リテラル引数（参考・fail にしない）: ${packageResolvers.dynamic.length}`);
    for (const item of packageResolvers.dynamic) {
      console.log(`    (${item.resolver}) ${item.expression}  <- ${item.from}:${item.line}`);
    }
  }
  if (packageResolvers.excluded.length > 0) {
    console.log(`  package resolver 除外（restricted・fail にしない）: ${packageResolvers.excluded.length}`);
    for (const item of packageResolvers.excluded) {
      console.log(`    除外した: (${item.resolver}) ${item.specifier}  <- ${item.from}:${item.line}`);
    }
  }
  if (packageResolvers.missing.length > 0) {
    console.error(`check-packaged-imports: PACKAGE RESOLVER MISSING ${packageResolvers.missing.length}`);
    for (const item of packageResolvers.missing) {
      console.error(`    (${item.resolver}) ${item.specifier}  <- ${item.from}:${item.line}`);
    }
  }
  if (missing.length > 0) {
    console.error(`check-packaged-imports: MISSING ${missing.length}（パッケージ版で ERR_MODULE_NOT_FOUND になる）`);
    for (const item of missing) console.error(`    ${item.specifier}  <- imported from ${item.from}`);
  }
  if (missing.length > 0 || packageResolvers.missing.length > 0) {
    if (!keep) rmSync(dirname(resourcesRoot), { recursive: true, force: true });
    process.exit(1);
  }
  console.log('check-packaged-imports: OK（欠け 0）');
  if (!keep) rmSync(dirname(resourcesRoot), { recursive: true, force: true });
}
