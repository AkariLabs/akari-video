#!/usr/bin/env node
// パッケージ版 Resources の静的参照グラフ検査 — 同梱漏れを CI で機械検出する。
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
//      リンクで組む（symlink が EPERM の環境だけ hardlink / junction / copy へ落とす）
//   2. 入口 = 模擬 Resources 内の packages/*/bin/*.mjs と packages/*/src/cli/*.mjs 全部 +
//      skills/**/bin/**/*.mjs + osr-export / gpu-export の src/electron-main.mjs
//   3. 静的 import と相対 require('…') を再帰的に辿る。相対は存在検査、
//      bare は packages/node_modules（= resources/cli-node-modules）から解決。node: と electron は対象外
//   4. リポジトリのソースツリーにある package 解決関数の文字列リテラル引数を走査し、模擬 Resources
//      の packages/<pkg>/<rel> に実体があるか検査する。非リテラル引数は参考情報に留める
//   5. backend の findGenerationAsset / findAsset / resolveRepoFile の文字列リテラルを検査し、非リテラルは参考にする
//   6. 動的 import("x") は参考情報（hyperframes のように意図的に同梱しない依存があるため fail にしない）
//   7. launcher が宣言するサブコマンド実行体を、模擬 Resources または npm vendor の同梱規則と照合する
//
// 前提: resources/cli-node-modules が staging 済み（scripts/release/install-bundled-cli-deps.mjs →
// apps/shell/resources/scripts/bundle-cli-node-modules.mjs）。無ければ bare import は全部 missing になる。
//
// 使い方:
//   node scripts/release/check-packaged-imports.mjs [--shell-package apps/shell/package.json] [--keep]
// 終了コード: 欠け 0 なら 0、1 件以上なら 1。
import { copyFileSync, cpSync, existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, rmdirSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RESTRICTED_ASSETS } from './check-no-gpl-redistribution.mjs';
import { LAUNCHER_SUBCOMMAND_EXECUTABLES } from '../../packages/akari-launcher/src/repo-assets.mjs';
import { VENDOR_SOURCES } from '../../packages/akari-launcher/src/vendor-sources.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..');
const args = process.argv.slice(2);
const shellPackagePath = resolve(REPO_ROOT, args.includes('--shell-package') ? args[args.indexOf('--shell-package') + 1] : 'apps/shell/package.json');
const SHELL_DIR = resolve(REPO_ROOT, 'apps', 'shell');
const keep = args.includes('--keep');

// 2026-09-14 に akari internal 系 5 本を同梱したので、既知の穴は無くなった。
// 将来また意図的に同梱しないサブコマンドが出たら、ここへ追加すること。
export const KNOWN_UNPACKAGED = new Set([]);

export const REQUIRED_BROWSER_RESOURCE_PATHS = ['catalog/browser/browser-engines.json'];
export const BROWSER_VIEW_PRELOAD_PATHS = ['app.asar/node_modules/akari-project/lib/electron-main/browser-view-preload.js'];
const SOURCE_BROWSER_VIEW_PRELOAD = join(SHELL_DIR, 'extensions', 'akari-project', 'src', 'electron-main', 'browser-view-preload.ts');

export function scanRequiredBrowserResources({ resourcesRoot, viewPreloads = BROWSER_VIEW_PRELOAD_PATHS,
  sourceViewPreload = SOURCE_BROWSER_VIEW_PRELOAD }) {
  const missing = REQUIRED_BROWSER_RESOURCE_PATHS
    .filter(relativePath => !existsSync(join(resourcesRoot, ...relativePath.split('/'))));
  // このジョブは拡張をビルドしないのでソースを確認する。実際の asar 内は verify-asar-contents が検査する。
  for (const relativePath of viewPreloads) {
    const source = relativePath === BROWSER_VIEW_PRELOAD_PATHS[0]
      ? sourceViewPreload : join(resourcesRoot, ...relativePath.split('/'));
    if (!existsSync(source)) missing.push(relativePath);
  }
  return missing;
}

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

// 生成物は checkout に存在しない場合がある。宣言された配置先と filter で判定し、
// electron-builder の実行前に packaging build が元ファイルを用意する。
export function isDeclaredResource(relativePath, extraResources) {
  const normalized = relativePath.replaceAll('\\', '/').replace(/^\/+|\/+$/gu, '');
  return extraResources.some((entry) => {
    const to = (typeof entry === 'string' ? '.' : entry.to ?? '.').replaceAll('\\', '/').replace(/^\/+|\/+$/gu, '').replace(/^\.$/u, '');
    if (to && normalized !== to && !normalized.startsWith(`${to}/`)) return false;
    const inside = to ? normalized.slice(to.length).replace(/^\//u, '') : normalized;
    const filters = typeof entry === 'string' ? null : entry.filter ?? null;
    return filters === null || filters.some((pattern) => globToRegExp(pattern).test(inside));
  });
}

function linkDirectory(source, target, linkedDirectories) {
  try {
    symlinkSync(source, target, 'dir');
  } catch (error) {
    if (error.code !== 'EPERM') throw error;
    try {
      symlinkSync(source, target, 'junction');
    } catch {
      cpSync(source, target, { recursive: true });
      return;
    }
  }
  linkedDirectories.push(target);
}

// 再帰削除が元の checkout に入らないよう、先にディレクトリのリンクを外す。
export function removeAssembledResources(resourcesRoot, linkedDirectories = []) {
  for (const target of linkedDirectories.reverse()) {
    if (existsSync(target)) {
      try { rmdirSync(target); }
      catch (error) {
        if (error.code !== 'ENOTDIR' && error.code !== 'EINVAL') throw error;
        rmSync(target, { force: true });
      }
    }
  }
  rmSync(dirname(resourcesRoot), { recursive: true, force: true });
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
  const linkedDirectories = [];
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
        linkDirectory(from, to, linkedDirectories);
      }
      continue;
    }
    const regexps = (filters ?? ['**/*']).map(globToRegExp);
    for (const file of walkFiles(from)) {
      const rel = relative(from, file).split('\\').join('/');
      if (regexps.some((regexp) => regexp.test(rel))) linkFile(file, join(to, rel));
    }
  }
  return { resourcesRoot, skipped, linkedDirectories };
}

function linkFile(source, target) {
  if (existsSync(target)) return;
  mkdirSync(dirname(target), { recursive: true });
  try {
    symlinkSync(source, target, 'file');
  } catch (error) {
    if (error.code !== 'EPERM') throw error;
    try { linkSync(source, target); }
    catch { copyFileSync(source, target); }
  }
}

const STATIC_IMPORT = /(?:^|\n)\s*(?:import|export)\b[^'"\n;]*?\bfrom\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

export function relativeRequires(source) {
  return syntaxCalls(source, new Set(['require'])).map((call) => call.literal)
    .filter((specifier) => specifier?.startsWith('.'));
}

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
    const fromLabel = relative(resourcesRoot, file).split('\\').join('/');
    for (const specifier of [...source.matchAll(STATIC_IMPORT)].map((match) => match[1] ?? match[2]).concat(relativeRequires(source))) {
      if (!specifier || specifier.startsWith('node:') || specifier === 'electron') continue;
      if (specifier.startsWith('.')) {
        const target = resolveRelative(specifier, file);
        if (target && /\.(?:mjs|cjs|js)$/u.test(target)) queue.push(target);
        else if (target) continue;
        else missing.push({ specifier: relative(resourcesRoot, resolve(dirname(file), specifier)).split('\\').join('/'), from: fromLabel });
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

const ASSET_FINDER_NAMES = new Set(['findGenerationAsset', 'findAsset']);
const REPO_FILE_NAMES = new Set(['resolveRepoFile']);

// 名前で呼び出しを探し、第 1 引数だけを見る。ファイル内の別の正規表現やテンプレートで
// 後続の呼び出しが隠れないようにする。上の package resolver 走査と検出結果はそのまま保つ。
function syntaxCalls(source, names) {
  const calls = [];
  const pattern = names.has('require')
    ? /(?<![\w$.])require\s*\(/gu
    : names.has('resolveRepoFile')
      ? /(?<![\w$])resolveRepoFile\s*\(/gu
      : /(?<![\w$])(?:findGenerationAsset|findAsset)\s*\(/gu;
  for (const match of source.matchAll(pattern)) {
    const start = match.index;
    const lineStart = source.lastIndexOf('\n', start - 1) + 1;
    const before = source.slice(lineStart, start);
    if (/^\s*(?:\/\/|\/\*|\*)/u.test(before)) continue;
    if (/\b(?:function|protected|private|public|static|async)\s+$/u.test(before)) continue;
    const resolver = match[0].slice(0, match[0].indexOf('(')).trim();
    let argumentStart = start + match[0].length;
    while (/\s/u.test(source[argumentStart] ?? '')) argumentStart += 1;
    const quoted = source[argumentStart] === "'" || source[argumentStart] === '"'
      ? readQuoted(source, argumentStart) : null;
    let afterQuoted = quoted?.next ?? -1;
    if (quoted) while (/\s/u.test(source[afterQuoted] ?? '')) afterQuoted += 1;
    const literal = quoted && (source[afterQuoted] === ',' || source[afterQuoted] === ')')
      ? quoted.value : null;
    const end = argumentEnd(source, argumentStart);
    calls.push({ resolver, literal,
      expression: source.slice(argumentStart, end).trim().replace(/\s+/gu, ' ').slice(0, 160),
      line: source.slice(0, start).split('\n').length });
  }
  return calls;
}

function sourceFilesForAssetFinders(repoRoot) {
  const extensions = join(repoRoot, 'apps', 'shell', 'extensions');
  if (!existsSync(extensions)) return [];
  return walkFiles(extensions).filter((file) => file.endsWith('.ts')
    && file.replaceAll('\\', '/').includes('/src/node/')).sort();
}

function scanBackendResourceCalls({ repoRoot, resourcesRoot, generatedResources }, names) {
  const missing = [];
  const dynamic = [];
  let found = 0;
  const files = sourceFilesForAssetFinders(repoRoot);
  for (const file of files) {
    const from = relative(repoRoot, file).split('\\').join('/');
    for (const call of syntaxCalls(readFileSync(file, 'utf8'), names)) {
      if (!call.literal || call.literal.includes('..') || call.literal.startsWith('/')) {
        dynamic.push({ ...call, from });
        continue;
      }
      found += 1;
      const item = { specifier: call.literal, from, line: call.line, finder: call.resolver };
      if (!existsSync(join(resourcesRoot, ...call.literal.split('/')))
        && !isDeclaredResource(call.literal, generatedResources)) missing.push(item);
    }
  }
  return { scanned: files.length, found, missing, dynamic };
}

export function scanAssetFinderCalls({ repoRoot = REPO_ROOT, resourcesRoot, generatedResources = [] }) {
  return scanBackendResourceCalls({ repoRoot, resourcesRoot, generatedResources }, ASSET_FINDER_NAMES);
}

export function scanRepoFileCalls({ repoRoot = REPO_ROOT, resourcesRoot, generatedResources = [] }) {
  return scanBackendResourceCalls({ repoRoot, resourcesRoot, generatedResources }, REPO_FILE_NAMES);
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

// launcher の実行時パス正本を、Electron の Resources と npm vendor の双方の
// 同梱規則へ照合する。既知例外が実際には同梱済みなら例外表の陳腐化として失敗させる。
export function scanLauncherSubcommands({
  repoRoot = REPO_ROOT,
  resourcesRoot,
  knownUnpackaged = KNOWN_UNPACKAGED,
  executables = LAUNCHER_SUBCOMMAND_EXECUTABLES,
  vendorSources = VENDOR_SOURCES,
}) {
  const present = [];
  const missing = [];
  const unpackaged = [];
  const staleKnownUnpackaged = [];
  for (const executable of executables) {
    const normalized = executable.relative.split('\\').join('/');
    const inResources = existsSync(join(resourcesRoot, ...normalized.split('/')));
    const inVendor = executable.resolution === 'launcher-assets'
      && vendorSources.some((source) => normalized === source || normalized.startsWith(`${source}/`))
      && existsSync(join(repoRoot, ...normalized.split('/')));
    const item = { ...executable, relative: normalized, source: inResources ? 'Resources' : inVendor ? 'vendor' : null };
    const known = knownUnpackaged.has(executable.command);
    if (inResources || inVendor) {
      present.push(item);
      if (known) staleKnownUnpackaged.push(item);
    } else if (known) {
      unpackaged.push(item);
    } else {
      missing.push(item);
    }
  }
  return { present, missing, unpackaged, staleKnownUnpackaged };
}

export function defaultEntries(resourcesRoot) {
  const entries = [];
  const packagesDir = join(resourcesRoot, 'packages');
  if (existsSync(packagesDir)) {
    for (const name of readdirSync(packagesDir)) {
      if (name === 'node_modules') continue;
      const binDir = join(packagesDir, name, 'bin');
      if (existsSync(binDir)) {
        for (const file of readdirSync(binDir)) if (file.endsWith('.mjs')) entries.push(join(binDir, file));
      }
      const cliDir = join(packagesDir, name, 'src', 'cli');
      if (existsSync(cliDir)) {
        for (const file of readdirSync(cliDir)) if (file.endsWith('.mjs')) entries.push(join(cliDir, file));
      }
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
  const { skipped, linkedDirectories } = assembleResources(shellPackage, { resourcesRoot });
  const entries = defaultEntries(resourcesRoot);
  const { walked, missing, dynamic } = walkImports(entries, resourcesRoot);
  const packageResolvers = scanPackageResolverCalls({ resourcesRoot });
  const generatedResources = (shellPackage.build?.extraResources ?? []).filter((entry) =>
    skipped.includes(typeof entry === 'string' ? entry : entry.from)
    // filter の無いルート宣言では、任意の finder 対象が生成元に属するとは確認できない。
    // その宣言は資産欠落の免除対象から外す。
    && typeof entry !== 'string' && ((entry.to ?? '.') !== '.' || !!entry.filter?.length));
  const assetFinders = scanAssetFinderCalls({ resourcesRoot, generatedResources });
  const repoFiles = scanRepoFileCalls({ resourcesRoot, generatedResources });
  const launcherSubcommands = scanLauncherSubcommands({ resourcesRoot });
  const missingBrowserResources = scanRequiredBrowserResources({ resourcesRoot });
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
  if (assetFinders.dynamic.length > 0) {
    console.log(`  asset finder の非リテラル引数（参考・fail にしない）: ${assetFinders.dynamic.length}`);
    for (const item of assetFinders.dynamic) {
      console.log(`    (${item.resolver}) ${item.expression}  <- ${item.from}:${item.line}`);
    }
  }
  if (repoFiles.dynamic.length > 0) {
    console.log(`  resolveRepoFile の非リテラル引数（参考・fail にしない）: ${repoFiles.dynamic.length}`);
    for (const item of repoFiles.dynamic) {
      console.log(`    (${item.resolver}) ${item.expression}  <- ${item.from}:${item.line}`);
    }
  }
  if (assetFinders.missing.length > 0) {
    console.error(`check-packaged-imports: ASSET FINDER MISSING ${assetFinders.missing.length}`);
    for (const item of assetFinders.missing) {
      console.error(`    ${item.specifier}  <- ${item.from}:${item.line}`);
    }
  }
  if (repoFiles.missing.length > 0) {
    console.error(`check-packaged-imports: RESOLVE REPO FILE MISSING ${repoFiles.missing.length}`);
    for (const item of repoFiles.missing) {
      console.error(`    ${item.specifier}  <- ${item.from}:${item.line}`);
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
  if (launcherSubcommands.unpackaged.length > 0) {
    console.log(`  launcher 未同梱（既知の穴・別票の材料）: ${launcherSubcommands.unpackaged.length}`);
    for (const item of launcherSubcommands.unpackaged) console.log(`    ${item.command}  -> ${item.relative}`);
  }
  if (launcherSubcommands.staleKnownUnpackaged.length > 0) {
    console.error(`check-packaged-imports: KNOWN_UNPACKAGED STALE ${launcherSubcommands.staleKnownUnpackaged.length}`);
    for (const item of launcherSubcommands.staleKnownUnpackaged) {
      console.error(`    ${item.command}  -> ${item.relative} は同梱されたので KNOWN_UNPACKAGED から外してください`);
    }
  }
  if (launcherSubcommands.missing.length > 0) {
    console.error(`check-packaged-imports: LAUNCHER SUBCOMMAND MISSING ${launcherSubcommands.missing.length}`);
    for (const item of launcherSubcommands.missing) console.error(`    ${item.command}  -> ${item.relative}`);
  }
  if (missing.length > 0) {
    console.error(`check-packaged-imports: MISSING ${missing.length}（パッケージ版で ERR_MODULE_NOT_FOUND になる）`);
    for (const item of missing) console.error(`    ${item.specifier}  <- imported from ${item.from}`);
  }
  if (missingBrowserResources.length > 0) {
    console.error(`check-packaged-imports: BROWSER RESOURCE MISSING ${missingBrowserResources.length}`);
    for (const item of missingBrowserResources) console.error(`    ${item}`);
  }
  if (missing.length > 0 || packageResolvers.missing.length > 0 || assetFinders.missing.length > 0 || repoFiles.missing.length > 0
    || launcherSubcommands.missing.length > 0 || launcherSubcommands.staleKnownUnpackaged.length > 0
    || missingBrowserResources.length > 0) {
    if (!keep) removeAssembledResources(resourcesRoot, linkedDirectories);
    process.exit(1);
  }
  console.log('check-packaged-imports: OK（欠け 0）');
  if (!keep) removeAssembledResources(resourcesRoot, linkedDirectories);
}
