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
    if (!categoryEntry.isDirectory()) continue;
    const categoryDir = path.join(assetsDir, categoryEntry.name);
    for (const idEntry of readdirSync(categoryDir, { withFileTypes: true })) {
      if (!idEntry.isDirectory()) continue;
      const dir = path.join(categoryDir, idEntry.name);
      if (readdirSync(dir).length > 0) {
        installed.add(`${categoryEntry.name}/${idEntry.name}`);
      }
    }
  }
  return installed;
}
