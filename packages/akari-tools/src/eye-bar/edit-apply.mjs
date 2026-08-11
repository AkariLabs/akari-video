// edit-apply.mjs — 生成したレイヤーを edit.json へ additive に、原子的（tmp→rename）に
// 書き込む。契約 contract-2026-07-17-data-contract-versioning.md 原則1（version 据え置き・
// 任意フィールドの追加のみ）に従う: layers[] は既存の任意配列フィールドであり、新しい要素を
// 足すだけで version を bump しない。vision-tracks.mjs の analysis.json 書き込みと同じ
// tmp ファイル→rename パターン（他プロセスから見て常に完全な JSON のどちらかが見える）。
import { readFileSync, renameSync, writeFileSync } from "node:fs";

export function loadEditJson(editPath) {
  const raw = readFileSync(editPath, "utf8");
  const edit = JSON.parse(raw);
  if (edit === null || typeof edit !== "object" || Array.isArray(edit)) {
    throw new Error("edit.json のルートは object である必要があります");
  }
  return edit;
}

/**
 * @param {string} editPath
 * @param {Array<object>} newLayers 追記するレイヤー（id は一意である前提）
 * @returns {{ ok: true, addedIds: string[] } | { ok: false, reason: string }}
 */
export function appendLayersAdditive(editPath, newLayers) {
  const edit = loadEditJson(editPath);
  const existingLayers = Array.isArray(edit.layers) ? edit.layers : [];
  const existingIds = new Set(existingLayers.map((l) => l?.id));
  const collisions = newLayers.filter((l) => existingIds.has(l.id)).map((l) => l.id);
  if (collisions.length > 0) {
    return { ok: false, reason: `edit.json.layers に同じ id が既に存在します: ${collisions.join(", ")}` };
  }
  edit.layers = [...existingLayers, ...newLayers];

  const tmpPath = `${editPath}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(edit, null, 2)}\n`, "utf8");
  renameSync(tmpPath, editPath);
  return { ok: true, addedIds: newLayers.map((l) => l.id) };
}
