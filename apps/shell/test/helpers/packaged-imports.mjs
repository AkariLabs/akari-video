// extraResources（electron-builder）の同梱後レイアウトに対する import 解決の純関数。
// electron-builder-validate-asset.test.mjs から切り出した（issue #74 で capture の同梱テストが同じ
// 規則を使うため）。filter のグロブ照合は同梱検査の正本（scripts/release/check-packaged-imports.mjs）
// と同じ実装を使う。
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

import { globToRegExp } from '../../../../scripts/release/check-packaged-imports.mjs';

// extraResources を「同梱後の置き場 resources/<to>/… ← 元 <from>（filter 付き）」の一覧へ。
// 同じ接頭辞が重なる（`to: "."` 等）ので、長い接頭辞から先に照合できるよう並べ替える。
export function packagedRoots(extraResources) {
  return (extraResources ?? [])
    .map((entry) => (typeof entry === 'string' ? { from: entry, to: '.' } : entry))
    .map((entry) => ({
      from: entry.from,
      filter: entry.filter ?? null,
      prefix: path.posix.join('resources', entry.to ?? '.'),
    }))
    .sort((left, right) => right.prefix.length - left.prefix.length);
}

// 指定子 1 本を「同梱後レイアウト上で解決できるか」で判定する。
// ok = node: 組み込み、または (a) 同梱元ファイルが実在し (b) その from の filter に含まれる。
export function resolvePackagedSpecifier(specifier, { fromPackagedPath, roots, shellRoot: root }) {
  if (specifier.startsWith('node:')) return { specifier, ok: true, builtin: true };
  if (!specifier.startsWith('.')) {
    return { specifier, ok: false, reason: '相対 import ではないため同梱後の置き場を特定できない' };
  }
  const packagedPath = path.posix.join(path.posix.dirname(fromPackagedPath), specifier);
  const tried = [];
  for (const candidate of roots) {
    if (packagedPath !== candidate.prefix && !packagedPath.startsWith(`${candidate.prefix}/`)) continue;
    const inside = path.posix.relative(candidate.prefix, packagedPath);
    const sourcePath = path.resolve(root, candidate.from, inside);
    const exists = existsSync(sourcePath) && statSync(sourcePath).isFile();
    const included = candidate.filter === null
      || candidate.filter.some((pattern) => globToRegExp(pattern).test(inside));
    if (exists && included) {
      return { specifier, ok: true, packagedPath, sourcePath, from: candidate.from };
    }
    tried.push(`${candidate.from} → ${inside}（同梱元: ${exists ? '実在' : '無し'} / filter: ${included ? '含む' : '含まない'}）`);
  }
  return {
    specifier,
    ok: false,
    packagedPath,
    reason: `同梱後 ${packagedPath} へ解決できない（候補: ${tried.length > 0 ? tried.join(' / ') : 'extraResources に該当する to が無い'}）`,
  };
}

// 指定子の配列を受け取り、同梱後に解決できないものだけを返す。
export function checkPackagedImports(specifiers, options) {
  return specifiers
    .map((specifier) => resolvePackagedSpecifier(specifier, options))
    .filter((result) => !result.ok);
}

const IMPORT_PATTERNS = [
  /\bimport\s+(?:(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]|\(\s*['"]([^'"]+)['"]\s*\))/g,
  /\bexport\s+[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g,
];

export function collectImportSpecifiers(source) {
  const specifiers = [];
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1] ?? match[2];
      if (specifier && !specifiers.includes(specifier)) specifiers.push(specifier);
    }
  }
  return specifiers;
}

