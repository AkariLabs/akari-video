import { builtinModules } from 'node:module';
import path from 'node:path';

// ビルド時の写し・asar の検査・npm test が同じ参照規則を使うための検査器。
// このファイルはビルド時のスクリプトで、配布物には入らない。読み出しと存在確認を
// 引数で受けるので、実ファイルと asar のエントリを同じ純関数で辿れる。
// 解決は指定されたパス → .js/.mjs/.cjs/.json → ディレクトリの index.js の順。
// package.json の main が必要なら推測で進まず止める。
// node 組み込みは無視し、起点パッケージ自身の裸 import は従来どおり通す。
// 辿って写したファイルの裸の指定子は、配布物の lib/packages/ から解決できる
// 保証がないので止める。正規表現はコメントや文字列中の参照も拾うが、
// 実在しない場合は解決できない参照として報告し、黙って捨てない。
const builtins = new Set(builtinModules.map(name => name.replace(/^node:/, '')));
const extensions = ['.js', '.mjs', '.cjs', '.json'];

// CJS の require を見落とすと入口だけが写され、リポ内では本物の packages/ を
// 上方探索できるため露見しない。文字列リテラルの参照を同じ規則で辿る。
function specifiers(source) {
  const found = [];
  const patterns = [
    /\b(?:import|export)(?=\s|[{*])\s*[^'"`;]*?\bfrom\s*(['"`])([^'"`\r\n]+)\1/g,
    /\bimport\s*(['"])([^'"\r\n]+)\1/g,
    /\b(?:require|import)\s*\(\s*(['"`])([^'"`\r\n]+)\1\s*\)/g
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1] === '`' && match[2].includes('${')) continue;
      found.push(match[2]);
    }
  }
  return found;
}

/** 解決できない参照の理由を、修正方法とともに表示する。 */
export function describeUnresolved(issue, file = issue.file) {
  const { specifier, path: target, reason } = issue;
  switch (reason) {
    case 'bare':
      return `${file} が node 組み込み以外の裸の指定子 ${specifier} を使っています。` +
        '配布物の lib/packages/ から解決できる保証がないため、相対参照へ直すか同梱方法を明示してください。';
    case 'outside':
      return `${file} が packages/ の外を相対参照しています: ${specifier}。` +
        'パッケージ済み .app へは運べません（lib/packages/ 配下しか写せません）。参照先を packages/ 内へ寄せてください。';
    case 'package-main':
      return `${file} の ${specifier} は package.json の main が必要なディレクトリを指しています。` +
        'main は辿らないため、実ファイルを指定してください。';
    case 'missing':
      return `${file} の参照先が存在しません: ${specifier ?? '(起点)'}（想定先: ${target}）。` +
        '参照先を追加するか指定子を直してください。';
    default:
      throw new Error(`未知の参照エラー: ${reason}`);
  }
}

function inside(root, candidate, pathApi) {
  const relative = pathApi.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${pathApi.sep}`) && !pathApi.isAbsolute(relative));
}

async function resolveReference(base, { isFile, isDirectory, pathApi }) {
  if (await isFile(base)) return { path: base };
  for (const extension of extensions) {
    if (await isFile(`${base}${extension}`)) return { path: `${base}${extension}` };
  }
  if (await isDirectory(base)) {
    if (await isFile(pathApi.join(base, 'package.json'))) {
      return { path: base, reason: 'package-main' };
    }
    const index = pathApi.join(base, 'index.js');
    if (await isFile(index)) return { path: index };
    return { path: index, reason: 'missing' };
  }
  return { path: pathApi.extname(base) ? base : `${base}.js`, reason: 'missing' };
}

/**
 * 起点ファイルから届く packages/ 内の閉包を返す。読み出しと存在確認を注入して
 * 通常のファイル群と asar のエントリに同じ判定を適用する。
 */
export async function tracePackageClosure({ roots, packagesRoot, readFile, isFile, isDirectory, pathApi = path }) {
  const rootPackages = new Set(roots.map(file => pathApi.relative(packagesRoot, file).split(pathApi.sep)[0]));
  const queue = [...roots];
  const visited = new Set();
  const unresolved = [];
  while (queue.length > 0) {
    const file = queue.shift();
    if (visited.has(file)) continue;
    visited.add(file);
    if (!await isFile(file)) {
      unresolved.push({ file, specifier: null, path: file, reason: 'missing' });
      continue;
    }
    if (!/\.(?:js|mjs|cjs)$/.test(file)) continue;
    const contents = await readFile(file);
    const owner = pathApi.relative(packagesRoot, file).split(pathApi.sep)[0];
    for (const specifier of specifiers(contents)) {
      if (!specifier.startsWith('.')) {
        if (builtins.has(specifier.replace(/^node:/, ''))) continue;
        if (!rootPackages.has(owner)) unresolved.push({ file, specifier, path: null, reason: 'bare' });
        continue;
      }
      const base = pathApi.resolve(pathApi.dirname(file), specifier);
      if (!inside(packagesRoot, base, pathApi)) {
        unresolved.push({ file, specifier, path: base, reason: 'outside' });
        continue;
      }
      const resolved = await resolveReference(base, { isFile, isDirectory, pathApi });
      if (resolved.reason) {
        unresolved.push({ file, specifier, ...resolved });
      } else if (!visited.has(resolved.path)) {
        queue.push(resolved.path);
      }
    }
  }
  return { files: [...visited], unresolved };
}

/** asar の一覧と読み出し関数から、配布された起点すべての閉包を調べる。 */
export async function traceAsarPackageClosure({ entries, readFile }) {
  const names = new Set(entries);
  const directories = new Set();
  for (const entry of entries) {
    let directory = path.posix.dirname(entry);
    while (directory !== '/' && !directories.has(directory)) {
      directories.add(directory);
      directory = path.posix.dirname(directory);
    }
  }
  const prefixes = ['/lib/packages/project-scaffold/src/', '/lib/packages/creator-root/src/'];
  const roots = entries.filter(entry => prefixes.some(prefix => entry.startsWith(prefix))
    && /\.(?:js|mjs|cjs)$/.test(entry));
  return tracePackageClosure({
    roots,
    packagesRoot: '/lib/packages',
    readFile,
    isFile: async file => names.has(file) && !directories.has(file),
    isDirectory: async directory => directories.has(directory),
    pathApi: path.posix
  });
}
