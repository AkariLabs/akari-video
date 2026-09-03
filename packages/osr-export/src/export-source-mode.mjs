// 書き出し出口（GPU / OSR）が読む素材の既定を決める。既定は **原本**（'original'）。
// `sources[].proxy` は edit.json v1 契約 §1 で「プレビューの任意の最適化」であり、出口が流用すると
// 406x720 のプロキシを 1080x1920 へ引き伸ばした眠い絵になる（task 2026-09-03-export-original-source）。
//
// 切り戻し口は環境変数 AKARI_EXPORT_SOURCE=proxy|original|auto だけ。UI は持たない。
// 未設定・未知の値は 'original' に倒す（プレビュー側の parseSourceSelectionMode は 'auto' へ倒すが、
// 出口の既定は原本でなければならないので既定値だけが異なる）。
export const EXPORT_SOURCE_ENV = "AKARI_EXPORT_SOURCE";

export function resolveExportSourceMode(env = process.env) {
  const raw = typeof env?.[EXPORT_SOURCE_ENV] === "string" ? env[EXPORT_SOURCE_ENV].trim().toLowerCase() : "";
  return raw === "proxy" || raw === "auto" ? raw : "original";
}
