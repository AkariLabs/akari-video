// presets/direction/index.jsonl の読み込み・参照。純粋（文字列 → 構造体）。
// ファイルシステムアクセスは呼び出し側（bin/ 層）が行う。

/**
 * index.jsonl の生テキストをレシピ配列にパースする。
 * @param {string} text
 * @returns {object[]}
 */
export function parseRecipeIndex(text) {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.map((line, i) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`presets/direction/index.jsonl line ${i + 1}: invalid JSON (${error.message})`);
    }
  });
}

/**
 * レシピ配列から id で 1 件引く。無ければ null。
 * @param {object[]} recipes
 * @param {string} id
 */
export function findRecipe(recipes, id) {
  return recipes.find((r) => r.id === id) ?? null;
}

/** レシピ配列の id 重複を検査する。重複があれば id の配列を返す（無ければ空配列）。 */
export function findDuplicateIds(recipes) {
  const seen = new Set();
  const dupes = new Set();
  for (const r of recipes) {
    if (seen.has(r.id)) dupes.add(r.id);
    seen.add(r.id);
  }
  return [...dupes];
}
