import { accessSync, constants as fsConstants } from 'node:fs';
import path from 'node:path';

const DEFAULT_WINDOWS_EXTENSIONS = ['.exe', '.cmd', '.bat'];

/**
 * Windows の実行可能拡張子一覧を決める。`PATHEXT` があればそれに従い（実 OS の
 * CreateProcess 拡張子解決と同じ規約）、無ければ既定セットへ fallback する。
 * `PATHEXT` は Windows 上では常に `;` 区切り（`path.delimiter` はホスト OS 依存の
 * ため、posix ホストから win32 分岐をテストする際は一致しない）。
 */
function resolveWindowsExtensions(pathExt) {
  const parsed = (pathExt ?? '')
    .split(';')
    .map((extension) => extension.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : DEFAULT_WINDOWS_EXTENSIONS;
}

/**
 * PATH 上に `claude` 実行ファイルがあるかを探す。純粋関数（`pathEnv` / `platform` /
 * `pathExt` を引数として渡せる）にして、実 PATH やシェル alias に依存せずテストできる
 * ようにする。シェル alias（例: 対話シェルの `alias claude=...`）は子プロセス起動では
 * 解決されないため、ここでは実ファイルの存在と実行権限だけを見る。
 *
 * win32 では拡張子なしの `claude` は候補に含めない: CreateProcess は拡張子で実行方式
 * を判定するため、拡張子なしファイル（npm の POSIX シムなど）は直接 spawn できない。
 */
export function findClaudeExecutable(pathEnv = process.env.PATH ?? '', platform = process.platform, pathExt = process.env.PATHEXT) {
  const directories = pathEnv.split(path.delimiter).filter(Boolean);
  const candidateNames = platform === 'win32'
    ? resolveWindowsExtensions(pathExt).map((extension) => `claude${extension.toLowerCase()}`)
    : ['claude'];

  for (const directory of directories) {
    for (const name of candidateNames) {
      const candidate = path.join(directory, name);
      try {
        accessSync(candidate, fsConstants.X_OK);
        return candidate;
      } catch {
        // このディレクトリには無い。次を探す。
      }
    }
  }
  return null;
}
