#!/usr/bin/env node
// GPL / 制限付き資産の再配布ガード — MIT 配布物への混入を CI で機械検出する。
//
// なぜ要るか: RVM upstream (PeterL1n/RobustVideoMatting) は GPL-3.0、本プロダクトは MIT で配布するため、
// RVM のコードや重みは同梱した瞬間に再配布になる。2026-08-07 の調査では配布対象から除外していたが、
// その判断が後続作業へ引き継がれず NOTICE に MIT との誤記が入った。人の記憶ではなく配布ゲートで守る。
//
// やること:
//   1. Electron shell の build.files / extraFiles / extraResources が制限対象を取り込まないことを検査
//   2. 制限対象配下のモデル重みが git 追跡されていないことを検査
//   3. npm prepack の VENDOR_SOURCES / package.json#files / capability sources を検査
//
// 使い方:
//   node scripts/release/check-no-gpl-redistribution.mjs
//     [--repo-root <path>] [--shell-package <path>] [--tracked-files <1行1パス>]
//     [--prepack <path>]
// 終了コード: 違反 0 なら 0、1 件以上または入力を安全に検査できなければ 1。
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 配布物に matte-rvm のパス文字列があるだけでは違反にしない。akari-launcher の capability discovery は
// package.json / README*.md を無条件に収集するが、これらは我々が書いた MIT の能書きメタデータであり、
// RVM のコードも重みも含まないためである。許可するものをここで狭く列挙し、それ以外は拒否する。
export const RESTRICTED_ASSETS = [
  {
    id: 'rvm',
    license: 'GPL-3.0',
    reason: 'upstream PeterL1n/RobustVideoMatting is GPL-3.0; this product ships under MIT',
    paths: ['packages/matte-rvm'],
    distributableMetadata: [
      'packages/matte-rvm/package.json',
      /^packages\/matte-rvm\/README[^/]*\.md$/u,
    ],
  },
];

const WEIGHT_EXTENSIONS = new Set([
  '.bin', '.ckpt', '.h5', '.onnx', '.pb', '.pt', '.pth', '.safetensors', '.tflite', '.weights',
]);
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_REPO_ROOT = resolve(dirname(SCRIPT_PATH), '..', '..');

export function checkShellPackage(shellPackage) {
  const violations = [];
  for (const field of ['extraResources', 'files', 'extraFiles']) {
    const entries = shellPackage?.build?.[field];
    if (entries === undefined) continue;
    if (!Array.isArray(entries)) {
      throw new Error(`apps/shell/package.json build.${field} must be an array`);
    }
    entries.forEach((entry, index) => {
      const label = `apps/shell/package.json build.${field}[${index}]`;
      if (typeof entry === 'string') {
        if (entry.startsWith('!')) return;
        const normalized = normalizePattern(entry, 'apps/shell');
        for (const asset of RESTRICTED_ASSETS) {
          if (patternMayIncludeAsset(normalized, asset)) {
            violations.push(violation(label, normalized, asset, 'MIT 配布物へ同梱できない'));
          }
        }
        return;
      }
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.from !== 'string') {
        throw new Error(`${label} must be a string or an object with a string from`);
      }

      const from = normalizePattern(entry.from, 'apps/shell');
      const filters = entry.filter === undefined ? null : entry.filter;
      if (filters !== null && (!Array.isArray(filters) || filters.some((item) => typeof item !== 'string'))) {
        throw new Error(`${label}.filter must be an array of strings`);
      }
      for (const asset of RESTRICTED_ASSETS) {
        if (sourceMayIncludeAsset(from, filters, asset)) {
          violations.push(violation(label, from, asset, 'source/filter が制限対象を配布物へ取り込む'));
          continue;
        }
        if (typeof entry.to === 'string') {
          const destination = normalizePattern(entry.to, '');
          if (containsRestrictedLiteral(destination, asset)) {
            violations.push(violation(label, destination, asset, '配布先が制限対象パスを指している'));
          }
        } else if (entry.to !== undefined) {
          throw new Error(`${label}.to must be a string`);
        }
      }
    });
  }
  return violations;
}

export function checkTrackedFiles(trackedFiles) {
  if (!Array.isArray(trackedFiles) || trackedFiles.some((item) => typeof item !== 'string')) {
    throw new Error('trackedFiles must be an array of strings');
  }
  const violations = [];
  for (const rawPath of trackedFiles) {
    const file = normalizeRepoPath(rawPath);
    const extension = posix.extname(file).toLowerCase();
    if (!WEIGHT_EXTENSIONS.has(extension)) continue;
    for (const asset of RESTRICTED_ASSETS) {
      if (asset.paths.some((root) => isSameOrDescendant(file, root))) {
        violations.push(violation('git ls-files', file, asset, `モデル重み ${extension} が git 追跡下にある`));
      }
    }
  }
  return violations;
}

export function checkNpmDistribution({ prepackSource, packageManifests, capabilitySources }) {
  if (typeof prepackSource !== 'string') throw new Error('prepackSource must be a string');
  if (!Array.isArray(packageManifests)) throw new Error('packageManifests must be an array');
  if (!Array.isArray(capabilitySources) || capabilitySources.some((item) => typeof item !== 'string')) {
    throw new Error('capabilitySources must be an array of strings');
  }

  const violations = [];
  for (const source of new Set(extractVendorSources(prepackSource))) {
    const normalized = normalizeRepoPath(source);
    for (const asset of RESTRICTED_ASSETS) {
      if (patternMayIncludeAsset(normalized, asset) && !isAllowedMetadata(asset, normalized)) {
        violations.push(violation('packages/akari-launcher/scripts/prepack.mjs VENDOR_SOURCES', normalized, asset,
          'npm vendor へコードまたは重みをコピーする'));
      }
    }
  }

  for (const entry of packageManifests) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || typeof entry.path !== 'string' || !entry.manifest || typeof entry.manifest !== 'object'
      || Array.isArray(entry.manifest)) {
      throw new Error('each packageManifests entry must be { path, manifest }');
    }
    const files = entry.manifest.files;
    if (files === undefined) continue;
    if (!Array.isArray(files) || files.some((item) => typeof item !== 'string')) {
      throw new Error(`${entry.path} files must be an array of strings`);
    }
    const manifestDir = posix.dirname(normalizeRepoPath(entry.path));
    files.forEach((file, index) => {
      if (file.startsWith('!')) return;
      const normalized = normalizePattern(file, manifestDir === '.' ? '' : manifestDir);
      for (const asset of RESTRICTED_ASSETS) {
        if (patternMayIncludeAsset(normalized, asset) && !isAllowedMetadata(asset, normalized)) {
          violations.push(violation(`${entry.path} files[${index}]`, normalized, asset,
            'npm package.json#files がコードまたは重みを含める'));
        }
      }
    });
  }

  for (const source of capabilitySources) {
    const normalized = normalizeRepoPath(source);
    for (const asset of RESTRICTED_ASSETS) {
      if (containsRestrictedLiteral(normalized, asset) && !isAllowedMetadata(asset, normalized)) {
        violations.push(violation('akari-launcher capability source', normalized, asset,
          '許可された能書きメタデータ以外を npm vendor へコピーする'));
      }
    }
  }
  return violations;
}

function sourceMayIncludeAsset(from, filters, asset) {
  if (filters === null || filters.length === 0) return patternMayIncludeAsset(from, asset);
  const positives = filters.filter((item) => !item.startsWith('!'));
  const candidates = positives.length > 0 ? positives : ['**/*'];
  const included = candidates.some((filter) => patternMayIncludeAsset(normalizePattern(filter, from), asset));
  if (!included) return false;
  const exclusions = filters.filter((item) => item.startsWith('!'))
    .map((item) => normalizePattern(item.slice(1), from));
  return !asset.paths.every((root) => exclusions.some((pattern) => patternCoversRoot(pattern, root)));
}

function patternMayIncludeAsset(pattern, asset) {
  const normalized = normalizeRepoPath(pattern);
  if (containsRestrictedLiteral(normalized, asset)) return true;
  const prefix = literalPrefix(normalized);
  if (prefix === '') return true;
  return asset.paths.some((root) => isSameOrDescendant(root, prefix));
}

function patternCoversRoot(pattern, root) {
  const normalized = normalizeRepoPath(pattern);
  if (normalized === root || normalized === `${root}/**` || normalized === `${root}/**/*`) return true;
  const prefix = literalPrefix(normalized);
  return prefix !== '' && isSameOrDescendant(root, prefix) && /\*\*/u.test(normalized);
}

function containsRestrictedLiteral(path, asset) {
  return asset.paths.some((root) => path === root
    || path.startsWith(`${root}/`)
    || path.includes(`/${root}/`)
    || path.endsWith(`/${root}`));
}

function literalPrefix(pattern) {
  const index = pattern.search(/[?*[{]/u);
  const prefix = index === -1 ? pattern : pattern.slice(0, index);
  return prefix.replace(/\/$/u, '');
}

function isAllowedMetadata(asset, path) {
  return asset.distributableMetadata.some((rule) => {
    if (typeof rule === 'string') return path === rule;
    rule.lastIndex = 0;
    return rule.test(path);
  });
}

function isSameOrDescendant(path, root) {
  return path === root || path.startsWith(`${root}/`);
}

function normalizePattern(path, base) {
  const slashed = String(path).replaceAll('\\', '/').replace(/^\.\//u, '');
  if (slashed === '') return normalizeRepoPath(base);
  if (slashed.startsWith('/')) return posix.normalize(slashed).replace(/^\/+/, '');
  return normalizeRepoPath(posix.join(base || '.', slashed));
}

function normalizeRepoPath(path) {
  return posix.normalize(String(path).replaceAll('\\', '/')).replace(/^\.\//u, '').replace(/^\/+/, '');
}

function violation(location, path, asset, detail) {
  return { location, path, asset, detail };
}

function formatViolation(item) {
  return `FORBIDDEN: ${item.location} -> ${item.path}  (${item.asset.id}: ${item.asset.license} — ${item.asset.reason} ; ${item.detail})`;
}

function extractVendorSources(source) {
  const declaration = /\b(?:const|let|var)\s+VENDOR_SOURCES\s*=\s*\[/gu.exec(source);
  if (!declaration) throw new Error('VENDOR_SOURCES array literal was not found');
  const open = declaration.index + declaration[0].lastIndexOf('[');
  const close = findClosingBracket(source, open);
  const body = source.slice(open + 1, close);
  const strings = [];
  let index = 0;
  while (index < body.length) {
    index = skipSpaceAndComments(body, index);
    if (index >= body.length) break;
    if (body[index] === ',') { index += 1; continue; }
    const quote = body[index];
    if (quote !== "'" && quote !== '"') {
      throw new Error('VENDOR_SOURCES must contain only string literals');
    }
    const parsed = readStringLiteral(body, index, quote);
    strings.push(parsed.value);
    index = skipSpaceAndComments(body, parsed.next);
    if (index < body.length && body[index] !== ',') {
      throw new Error('VENDOR_SOURCES contains an unsupported expression');
    }
  }
  return strings;
}

function findClosingBracket(source, open) {
  let depth = 0;
  let state = 'code';
  let quote = '';
  for (let index = open; index < source.length; index += 1) {
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
    if (char === '[') depth += 1;
    if (char === ']' && --depth === 0) return index;
  }
  throw new Error('VENDOR_SOURCES array literal is not closed');
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
      if (close === -1) throw new Error('unterminated comment in VENDOR_SOURCES');
      index = close + 2;
      continue;
    }
    break;
  }
  return index;
}

function readStringLiteral(source, start, quote) {
  let value = '';
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === quote) return { value, next: index + 1 };
    if (char === '\\') {
      const escaped = source[index + 1];
      if (escaped === undefined) break;
      value += escaped;
      index += 1;
    } else {
      value += char;
    }
  }
  throw new Error('unterminated string in VENDOR_SOURCES');
}

function parseArgs(argv) {
  const options = {};
  const allowed = new Set(['--repo-root', '--shell-package', '--tracked-files', '--prepack']);
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!allowed.has(key)) throw new Error(`unknown option: ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${key} requires a path`);
    options[key.slice(2)] = value;
    index += 1;
  }
  return options;
}

function readJson(path, label) {
  let source;
  try { source = readFileSync(path, 'utf8'); } catch (error) {
    throw new Error(`${label} cannot be read: ${messageOf(error)}`);
  }
  try {
    const parsed = JSON.parse(source);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('root must be an object');
    return parsed;
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${messageOf(error)}`);
  }
}

function assertRestrictedPathsExist(repoRoot) {
  for (const asset of RESTRICTED_ASSETS) {
    for (const path of asset.paths) {
      if (!existsSync(resolve(repoRoot, path))) {
        throw new Error(`restricted path does not exist (${asset.id}): ${path}`);
      }
    }
  }
}

function resolveOptionPath(value, fallback, repoRoot) {
  if (value === undefined) return resolve(repoRoot, fallback);
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

function loadPackageManifests(repoRoot, trackedFiles) {
  const paths = [...new Set(trackedFiles.filter((path) => posix.basename(normalizeRepoPath(path)) === 'package.json'))].sort();
  return paths.map((path) => ({ path: normalizeRepoPath(path), manifest: readJson(resolve(repoRoot, path), path) }));
}

function discoverCapabilitySources(trackedFiles) {
  return trackedFiles.map(normalizeRepoPath).filter((path) => /^skills\/.+\.md$/u.test(path)
    || /^docs\/contract-[^/]+\.md$/u.test(path)
    || /^packages\/[^/]+\/README[^/]*\.md$/u.test(path)
    || /^packages\/[^/]+\/package\.json$/u.test(path)).sort();
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function runCli() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const repoRoot = resolve(options['repo-root'] ?? DEFAULT_REPO_ROOT);
    assertRestrictedPathsExist(repoRoot);

    const shellPath = resolveOptionPath(options['shell-package'], 'apps/shell/package.json', repoRoot);
    const prepackPath = resolveOptionPath(options.prepack, 'packages/akari-launcher/scripts/prepack.mjs', repoRoot);
    const shellPackage = readJson(shellPath, shellPath);
    let trackedFiles;
    if (options['tracked-files']) {
      const trackedPath = resolveOptionPath(options['tracked-files'], '', repoRoot);
      trackedFiles = readFileSync(trackedPath, 'utf8').split(/\r?\n/u).filter(Boolean);
    } else {
      trackedFiles = execFileSync('git', ['-C', repoRoot, 'ls-files', '-z'], {
        encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
      }).split('\0').filter(Boolean);
    }
    const prepackSource = readFileSync(prepackPath, 'utf8');
    const packageManifests = loadPackageManifests(repoRoot, trackedFiles);
    const capabilitySources = discoverCapabilitySources(trackedFiles);
    const violations = [
      ...checkShellPackage(shellPackage),
      ...checkTrackedFiles(trackedFiles),
      ...checkNpmDistribution({ prepackSource, packageManifests, capabilitySources }),
    ];
    if (violations.length > 0) {
      for (const item of violations) console.error(formatViolation(item));
      console.error(`check-no-gpl-redistribution: FORBIDDEN ${violations.length} 件`);
      process.exitCode = 1;
      return;
    }
    console.log(`check-no-gpl-redistribution: OK（restricted ${RESTRICTED_ASSETS.length} 件 / 違反 0）`);
  } catch (error) {
    console.error(`check-no-gpl-redistribution: ERROR（fail-closed）: ${messageOf(error)}`);
    process.exitCode = 1;
  }
}

// symlink 経由でも CLI が無言終了しないよう、入口と argv の両辺を realpath で比較する。
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(SCRIPT_PATH)) runCli();
