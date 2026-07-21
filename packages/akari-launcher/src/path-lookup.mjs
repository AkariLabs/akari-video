import { accessSync, constants as fsConstants } from 'node:fs';
import path from 'node:path';

const WINDOWS_EXTENSIONS = ['.exe', '.cmd', '.bat'];

/**
 * PATH 上に `claude` 実行ファイルがあるかを探す。純粋関数（`pathEnv` / `platform` を
 * 引数として渡せる）にして、実 PATH やシェル alias に依存せずテストできるようにする。
 * シェル alias（例: 対話シェルの `alias claude=...`）は子プロセス起動では解決されない
 * ため、ここでは実ファイルの存在と実行権限だけを見る。
 */
export function findClaudeExecutable(pathEnv = process.env.PATH ?? '', platform = process.platform) {
  const directories = pathEnv.split(path.delimiter).filter(Boolean);
  const candidateNames = platform === 'win32'
    ? ['claude', ...WINDOWS_EXTENSIONS.map((extension) => `claude${extension}`)]
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
