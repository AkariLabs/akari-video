// ローカルライブラリ（~/.akari/assets/<category>/<id>/）の取得状態スキャン。

import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export function localAssetDir(home, category, id) {
  return path.join(home, 'assets', category, id);
}

/** ディレクトリが存在し、かつ中身が 1 つ以上あれば「取得済み」とみなす */
export function isAssetCached(home, category, id) {
  const dir = localAssetDir(home, category, id);
  try {
    return statSync(dir).isDirectory() && readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

/** `<category>/<id>` キーの Set で、取得済み素材を一括列挙する（composeState 用） */
export function scanLocalLibrary(home) {
  const installed = new Set();
  const assetsDir = path.join(home, 'assets');
  if (!existsSync(assetsDir)) return installed;

  for (const categoryEntry of readdirSync(assetsDir, { withFileTypes: true })) {
    const categoryDir = path.join(assetsDir, categoryEntry.name);
    try {
      if (!statSync(categoryDir).isDirectory()) continue;
      for (const idEntry of readdirSync(categoryDir, { withFileTypes: true })) {
        const dir = path.join(categoryDir, idEntry.name);
        try {
          if (statSync(dir).isDirectory() && readdirSync(dir).length > 0) {
            installed.add(`${categoryEntry.name}/${idEntry.name}`);
          }
        } catch {
          // 壊れた symlink や読めない素材は取得済みとして数えない。
        }
      }
    } catch {
      // ファイルや壊れた category symlink は対象外。
    }
  }
  return installed;
}
