#!/usr/bin/env node
// 同梱物に残った AKARI 独自ライセンス識別子を CI で検出する。
// なぜ要るか: 無料の OSS 向けコード署名は、同梱物すべてが OSS ライセンスであることが条件。
// やること: electron-builder の build.files / extraFiles / extraResources に含まれる実ファイルを
// 生バイトで検査し、素材の独自ライセンス表記を止める。識別子を扱うコードのみ狭く許可する。
// 使い方: node scripts/release/check-no-proprietary-licenses.mjs
// 終了コード: 違反 0 件なら 0、違反または安全に読めない入力があれば 1。
import { readFileSync, readdirSync, lstatSync, existsSync, realpathSync } from 'node:fs';
import { resolve, relative, dirname, sep, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SHELL_ROOT = join(REPO_ROOT, 'apps/shell');
const MARKER = Buffer.from('LicenseRef-AKARI-');

// これらは識別子を扱う実装であり、そのライセンスで素材を配布していない。
// 素材ディレクトリへの例外は設けない。
export const CODE_REFERENCE_ALLOWLIST = new Map([
  ['packages/asset-resolver/src/license-axes.mjs', 'ライセンス ID を分類するコード'],
  ['packages/audio-library-setup/shared/akari-sounds.mjs', '元ライブラリのライセンス ID を扱うコード'],
]);

// apps/shell 自前コードの webpack/TypeScript 生成結果。バンドル内の識別子は
// ライセンスを判定する実装に由来する。画像・JSON・音声などは同じディレクトリでも検査する。
const GENERATED_CODE_PATHS = [
  /^apps\/shell\/lib\/.*\.js$/u,
  /^apps\/shell\/src-gen\/.*\.js$/u,
  /^apps\/shell\/electron-entry\.js$/u,
];

function patternRegex(pattern) {
  if (typeof pattern !== 'string' || !pattern || pattern.includes('\\') || pattern.startsWith('/') || pattern.split('/').includes('..')) {
    throw new Error(`安全に解釈できない filter: ${pattern}`);
  }
  let out = '^';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      i++;
      if (pattern[i + 1] === '/') { i++; out += '(?:.*/)?'; }
      else out += '.*';
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(out + '$', 'u');
}

function makeFilter(patterns) {
  if (!Array.isArray(patterns) || patterns.some(x => typeof x !== 'string')) throw new Error('filter は文字列配列が必要です');
  const rules = patterns.map(pattern => ({ positive: !pattern.startsWith('!'), regex: patternRegex(pattern.replace(/^!/, '')) }));
  return name => {
    let included = !rules.some(rule => rule.positive);
    for (const rule of rules) if (rule.regex.test(name)) included = rule.positive;
    return included;
  };
}

function safeSource(source) {
  if (typeof source !== 'string' || !source || source.includes('\\')) throw new Error(`不正な配布元パス: ${source}`);
  const absolute = resolve(SHELL_ROOT, source);
  const rel = relative(REPO_ROOT, absolute);
  if (rel === '..' || rel.startsWith('..' + sep)) throw new Error(`作業場の外を参照: ${source}`);
  return absolute;
}

function* walk(root, directory = root) {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, item.name);
    const type = lstatSync(file);
    if (type.isSymbolicLink()) throw new Error(`symlink の同梱先を安全に確定できません: ${file}`);
    if (type.isDirectory()) yield* walk(root, file);
    else if (type.isFile()) yield { absolute: file, relative: relative(root, file).split(sep).join('/') };
    else throw new Error(`安全に読めない配布ファイル: ${file}`);
  }
}

export function checkBytes(file, bytes, { allowGeneratedCode = true } = {}) {
  if (!Buffer.isBuffer(bytes)) throw new Error('bytes は Buffer が必要です');
  return bytes.includes(MARKER) && !CODE_REFERENCE_ALLOWLIST.has(file) &&
    !(allowGeneratedCode && GENERATED_CODE_PATHS.some(pattern => pattern.test(file)));
}

function collect(packageJson) {
  const build = packageJson?.build;
  if (!build || typeof build !== 'object') throw new Error('apps/shell/package.json の build がありません');
  const files = new Map();
  const add = (file, field) => {
    if (!files.has(file)) files.set(file, new Set());
    files.get(file).add(field);
  };
  const fileExclusions = [];
  for (const field of ['files', 'extraFiles', 'extraResources']) {
    const entries = build[field] ?? [];
    if (!Array.isArray(entries)) throw new Error(`build.${field} は配列が必要です`);
    for (const entry of entries) {
      if (typeof entry === 'string') {
        if (field !== 'files') throw new Error(`build.${field} の文字列指定には未対応です`);
        if (entry.startsWith('!')) {
          fileExclusions.push(patternRegex(entry.slice(1)));
          continue;
        }
        const pattern = entry;
        const staticPrefix = pattern.split(/[*?]/u)[0].replace(/\/$/u, '');
        const source = safeSource(staticPrefix || '.');
        if (!existsSync(source)) continue; // prepackage 前の lib / src-gen
        if (!/[*?]/u.test(pattern) && lstatSync(source).isFile()) {
          add(source, field);
          continue;
        }
        const root = lstatSync(source).isDirectory() ? source : dirname(source);
        const matches = makeFilter([pattern]);
        for (const candidate of walk(root)) {
          const shellRelative = relative(SHELL_ROOT, candidate.absolute).split(sep).join('/');
          if (matches(shellRelative)) add(candidate.absolute, field);
        }
      } else if (entry && typeof entry === 'object' && typeof entry.from === 'string') {
        const source = safeSource(entry.from);
        if (!existsSync(source)) {
          if (source.startsWith(join(SHELL_ROOT, 'native/bin')) ||
              source.startsWith(join(SHELL_ROOT, 'resources/generated-notices')) ||
              source.startsWith(join(SHELL_ROOT, 'resources/vendor-ffmpeg')) ||
              source.startsWith(join(SHELL_ROOT, 'resources/cli-node-modules'))) continue;
          throw new Error(`同梱元がありません: ${entry.from}`);
        }
        if (lstatSync(source).isSymbolicLink()) throw new Error(`symlink の同梱元を安全に確定できません: ${source}`);
        const matches = entry.filter === undefined ? () => true : makeFilter(entry.filter);
        if (lstatSync(source).isFile()) {
          if (matches(posix.basename(source))) add(source, field);
        } else {
          for (const candidate of walk(source)) if (matches(candidate.relative)) add(candidate.absolute, field);
        }
      } else throw new Error(`build.${field} に不正な指定があります`);
    }
  }
  return [...files].filter(([file, fields]) => {
    const name = relative(SHELL_ROOT, file).split(sep).join('/');
    if (fileExclusions.some(regex => regex.test(name))) fields.delete('files');
    return fields.size > 0;
  }).sort(([a], [b]) => a.localeCompare(b));
}

export function checkDistribution(packageJson, { readBytes = readFileSync } = {}) {
  const violations = [];
  for (const [absolute, fields] of collect(packageJson)) {
    const name = relative(REPO_ROOT, absolute).split(sep).join('/');
    if (checkBytes(name, readBytes(absolute), { allowGeneratedCode: fields.size === 1 && fields.has('files') })) violations.push(name);
  }
  return violations;
}

if (realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const shell = JSON.parse(readFileSync(join(SHELL_ROOT, 'package.json'), 'utf8'));
    const violations = checkDistribution(shell);
    if (violations.length) {
      for (const file of violations) console.error(`同梱ライセンス違反: ${file} に LicenseRef-AKARI- が残っています。素材を MIT 等の配布可能なライセンスへ直してください。`);
      console.error('素材ではなく識別子を扱うコードなら、CODE_REFERENCE_ALLOWLIST にファイルと理由を狭く追加してください。');
      process.exitCode = 1;
    } else console.log('同梱ライセンス検査: OK');
  } catch (error) {
    console.error(`同梱ライセンス検査に失敗しました（安全に読めないため停止）: ${error.message}`);
    process.exitCode = 1;
  }
}
