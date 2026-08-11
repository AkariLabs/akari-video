// resolve-source.mjs — face_landmarks トラックの source.path（トラックファイル自身のディレクトリ
// 基準・契約 §2）を、edit.json の source（v0）/ sources[]（v1）と突き合わせ、time-map.mjs へ渡す
// sourceId（v0 は null・v1 は一致した sources[].id）を決める。
import { existsSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";

function resolveReal(path) {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/**
 * @param {string} trackFilePath face-landmarks.json の絶対パス
 * @param {object} track パース済みトラックファイル（source.path を持つ）
 * @param {string} editPath edit.json の絶対パス
 * @param {object} edit パース済み edit.json
 * @param {string|null} [explicitSourceId] --source-id で明示された id（あれば最優先）
 */
export function resolveTargetSourceId(trackFilePath, track, editPath, edit, explicitSourceId = null) {
  if (explicitSourceId) return { ok: true, sourceId: explicitSourceId };

  const trackSourceAbs = resolve(dirname(trackFilePath), track?.source?.path ?? "");
  const trackSourceReal = existsSync(trackSourceAbs) ? resolveReal(trackSourceAbs) : trackSourceAbs;
  const projectRoot = dirname(editPath);

  if (Array.isArray(edit?.sources)) {
    // v1: 複数 source。パス一致するものを探す。
    const matches = edit.sources.filter((s) => {
      const candidate = resolve(projectRoot, s.path);
      const candidateReal = existsSync(candidate) ? resolveReal(candidate) : candidate;
      return candidateReal === trackSourceReal;
    });
    if (matches.length === 1) return { ok: true, sourceId: matches[0].id };
    if (matches.length === 0) {
      return {
        ok: false,
        reason: `edit.json の sources[] にトラックの参照元動画（${trackSourceAbs}）と一致するものが`
          + "見つかりません。--source-id で明示してください。",
      };
    }
    return {
      ok: false,
      reason: `edit.json の sources[] に同一パスの source が複数あり一意に決まりません`
        + "（--source-id で明示してください）。",
    };
  }

  // v0: 単一 source。cuts[] は src を持たない（sourceId=null 固定）。パスが違っても v0 は
  // 単一ソース前提のプロジェクト構造なので、警告だけ返して null を採用する。
  const singleSourcePath = edit?.source?.path;
  if (typeof singleSourcePath === "string" && singleSourcePath.length > 0) {
    const candidate = resolve(projectRoot, singleSourcePath);
    const candidateReal = existsSync(candidate) ? resolveReal(candidate) : candidate;
    if (candidateReal !== trackSourceReal) {
      return {
        ok: true,
        sourceId: null,
        warning:
          `edit.json.source.path（${singleSourcePath}）とトラックの参照元（${trackSourceAbs}）が`
          + "一致しません。v0 は単一 source 前提のため続行しますが、意図した動画か確認してください。",
      };
    }
  }
  return { ok: true, sourceId: null };
}
