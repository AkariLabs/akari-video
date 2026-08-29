#!/usr/bin/env node
// パッケージ版 Resources の静的 import グラフ検査 — 同梱漏れを CI で機械検出する。
//
// なぜ要るか: extraResources で配る CLI / ランタイム（render-cut・osr-export・gpu-export・edit-lint・
// akari-launcher）は、モノレポでは隣の packages/ や skills/ を相対 import で参照できてしまう。
// パッケージ版の Resources にその参照先が同梱されていないと、import 時点で ERR_MODULE_NOT_FOUND になり
// 書き出しが全滅する（v0.1.25: packages/gpu-export と skills/analyze-footage/bin/person-matte の同梱漏れ、
// および @webav/mp4box.js の同梱 node_modules 漏れ。実ビルドで再現・v0.1.26 で修正）。
// モノレポのテストではこの種の漏れは見えないため、extraResources と同じ構成の「模擬 Resources」を組み、
// 入口から import を辿って欠けを列挙する。
//
// やること:
//   1. apps/shell/package.json の build.extraResources を読み、from → to を filter どおり模擬 Resources に
//      symlink で組む（実ファイルはコピーしない。相対 import の解決は論理パスで行うので symlink で足りる）
//   2. 入口 = 模擬 Resources 内の packages/*/bin/*.mjs 全部 + osr-export / gpu-export の src/electron-main.mjs
//   3. 静的 import（import … from / export … from / import "x"）を再帰的に辿る。相対は存在検査、
//      bare は packages/node_modules（= resources/cli-node-modules）から解決。node: と electron は対象外
//   4. 動的 import("x") は参考情報（hyperframes のように意図的に同梱しない依存があるため fail にしない）
//
// 前提: resources/cli-node-modules が staging 済み（scripts/release/install-bundled-cli-deps.mjs →
// apps/shell/resources/scripts/bundle-cli-node-modules.mjs）。無ければ bare import は全部 missing になる。
//
// 使い方:
//   node scripts/release/check-packaged-imports.mjs [--shell-package apps/shell/package.json] [--keep]
// 終了コード: 欠け 0 なら 0、1 件以上なら 1。
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..');
const args = process.argv.slice(2);
const shellPackagePath = resolve(REPO_ROOT, args.includes('--shell-package') ? args[args.indexOf('--shell-package') + 1] : 'apps/shell/package.json');
const SHELL_DIR = resolve(REPO_ROOT, 'apps', 'shell');
const keep = args.includes('--keep');

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
  for (const runtime of ['osr-export', 'gpu-export']) {
    entries.push(join(packagesDir, runtime, 'src', 'electron-main.mjs'));
  }
  return entries.sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const shellPackage = JSON.parse(readFileSync(shellPackagePath, 'utf8'));
  const resourcesRoot = join(mkdtempSync(join(tmpdir(), 'akari-packaged-')), 'Resources');
  mkdirSync(resourcesRoot, { recursive: true });
  const { skipped } = assembleResources(shellPackage, { resourcesRoot });
  const entries = defaultEntries(resourcesRoot);
  const { walked, missing, dynamic } = walkImports(entries, resourcesRoot);
  console.log(`check-packaged-imports: entries ${entries.length} / walked ${walked} files / Resources = ${resourcesRoot}`);
  if (skipped.length > 0) console.log(`  skipped (from が存在しない・生成物など): ${skipped.join(', ')}`);
  for (const entry of entries) console.log(`  entry: ${relative(resourcesRoot, entry)}`);
  if (dynamic.length > 0) {
    console.log(`  dynamic import（参考・fail にしない）: ${dynamic.length}`);
    for (const item of dynamic) console.log(`    ${item.specifier}  <- ${item.from}`);
  }
  if (missing.length > 0) {
    console.error(`check-packaged-imports: MISSING ${missing.length}（パッケージ版で ERR_MODULE_NOT_FOUND になる）`);
    for (const item of missing) console.error(`    ${item.specifier}  <- imported from ${item.from}`);
    if (!keep) rmSync(dirname(resourcesRoot), { recursive: true, force: true });
    process.exit(1);
  }
  console.log('check-packaged-imports: OK（欠け 0）');
  if (!keep) rmSync(dirname(resourcesRoot), { recursive: true, force: true });
}
