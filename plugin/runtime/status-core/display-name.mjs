import { readFileSync } from "node:fs";
import { join } from "node:path";

// プロジェクトの人間向け表示名の解決（task 2026-08-09-project-display-title）。
// フォルダ名は作成時刻ベースの機械 ID のまま変えない（オーナー裁定: フォルダ名 = 機械の ID /
// 表示名 = 別に持つ）。人が読む名前は `.akari/intake.json` の `title` に置き、
// `akari status`（プロジェクトスコープ・作業場スコープ双方）はここを通す。

/** `.akari/intake.json` の title を読む。無い・壊れている・型違いは null（フェイルセーフ側）。 */
export function readProjectTitle(projectRoot) {
  try {
    const parsed = JSON.parse(readFileSync(join(projectRoot, ".akari", "intake.json"), "utf8"));
    return typeof parsed?.title === "string" && parsed.title.trim().length > 0 ? parsed.title : null;
  } catch {
    return null;
  }
}

/** title ?? フォルダ名。title が無い（既存プロジェクト）・null・空文字はフォルダ名へフォールバックする。 */
export function resolveProjectDisplayName(title, folderName) {
  return typeof title === "string" && title.trim().length > 0 ? title : folderName;
}
