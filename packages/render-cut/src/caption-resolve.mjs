import { createRequire } from "node:module";

import { generateCaptionOverlays, generateResolvedCaptionOverlays } from "./captions.mjs";

const require = createRequire(import.meta.url);
const {
  applyCaptionStylePresets,
  collectExcludedCaptionIds,
  filterCaptionRootByExcludedIds,
  referencedCaptionSourceCount,
  resolveCaptionDisplay,
  TEXTSTYLE_CATALOG,
} = require("../../edit-store/lib/index.js");

/**
 * 字幕表示の単一解決経路。
 *
 * contract-2026-08-03-caption-display-encoding-qc-v1 §1 は
 * 「edit-store の Node カーネルが display_policy の唯一の解決器」と定めるが、
 * その手前（プリセット適用・除外フィルタ・単語帳・cuts 正規化）を各経路が
 * 自前で組み立てていたため、実際には経路ごとに違う結果が出ていた:
 *
 *   - preview-server は cuts を持たない生の v2 を渡し、display_cues が 0 件になる
 *   - gpu-export / osr-export は display_policy を一切見ず、旧 generateCaptionOverlays で
 *     字幕を作り直す（読点で強制改行される・フォント別名が違う）
 *   - gpu-export / osr-export は単語帳を引かないので行分割保護が効かない
 *
 * この関数がその前段ごと単一定義になる。render-cut 内部・preview-server・
 * gpu-export・osr-export の 4 経路はここだけを呼ぶ。
 *
 * IO はしない（captions.json / edit.json の読み込みは各呼び出し元の責務）。
 * 単語帳だけは「4 経路で同じ保護語が効く」ことが解決結果の一部なので、
 * projectRoot を受け取って内部で引く（extraProtectedTerms で上書きできる）。
 *
 * @param {object} args
 * @param {unknown} args.captionsRoot  captions.json のパース結果（配列ルート / オブジェクトルート / undefined）
 * @param {object} args.edit           renderer 互換 edit（cuts 導出済み）。生の v2 を渡してはいけない
 * @param {string} [args.projectRoot]  単語帳の探索起点
 * @param {string[]} [args.extraProtectedTerms] 単語帳の代わりに直接渡す保護語
 * @param {object} [args.output]       既定は edit.output
 * @param {(warning: string) => void} [args.onWarning]
 */
export function resolveCaptionPlan({
  captionsRoot: parsedRoot,
  edit,
  projectRoot,
  extraProtectedTerms,
  output,
  onWarning,
} = {}) {
  if (parsedRoot === undefined || parsedRoot === null) {
    return emptyPlan();
  }
  if (!edit || typeof edit !== "object") {
    throw new Error("resolveCaptionPlan requires a renderer-compatible edit");
  }
  // 生の v2（tracks はあるが cuts が無い）を渡されたら落とす。
  // カーネルは cuts を edit.cuts からしか取らないので、射影前の v2 を渡すと
  // cuts = [] → occurrence 0 → display_cues 0 になり、字幕が「静かに 1 件も出ない」。
  // preview-server の GET /api/captions.json が実際にこれを踏んでいた（2026-09-20）。
  // 空のタイムラインは射影後に cuts: [] を持つので、この条件には当たらない。
  if (!Array.isArray(edit.cuts) && Array.isArray(edit.tracks)) {
    throw new Error(
      "resolveCaptionPlan received an unprojected v2 edit (tracks without derived cuts); "
      + "pass readRenderEdit(...).edit instead of the raw edit.json",
    );
  }

  const presetResolution = applyCaptionStylePresets(parsedRoot, TEXTSTYLE_CATALOG);
  const captionsRoot = filterCaptionRootByExcludedIds(
    presetResolution.root,
    collectExcludedCaptionIds(edit),
  );
  const captions = Array.isArray(captionsRoot)
    ? captionsRoot
    : captionsRoot && typeof captionsRoot === "object" && Array.isArray(captionsRoot.captions)
      ? captionsRoot.captions
      : null;
  if (!captions) {
    throw new Error("captions.json root must be an array or an object with captions[]");
  }

  const warnings = presetResolution.unresolved.map(id => `unknown caption style_preset ignored: ${id}`);
  const warn = (warning) => {
    warnings.push(warning);
    onWarning?.(warning);
  };

  const styleOutput = output ?? edit.output;

  const layout = resolveCaptionDisplay(captionsRoot, captionDisplayEdit(edit), {
    output: styleOutput,
    extra_protected_terms: extraProtectedTerms ?? protectedTermsForProject(projectRoot),
  });

  if (layout) {
    // 単語帳の行分割保護が外れた件数は layout.word_book_fallbacks に載る。
    // どこへ報告するか（stderr / warnings）は経路ごとに違うので、ここでは判断しない。
    return {
      captionsRoot,
      captions,
      layout,
      overlays: generateResolvedCaptionOverlays(layout),
      defaultTextStyle: Array.isArray(captionsRoot) ? null : captionsRoot.default_text_style ?? null,
      emphasisWords: Array.isArray(captionsRoot)
        ? edit.emphasis_words ?? []
        : captionsRoot.emphasis_words ?? edit.emphasis_words ?? [],
      warnings,
    };
  }

  // display_policy 未宣言のプロジェクトは従来経路のまま（契約 §1 の opt-in 互換）。
  // 既定スタイル・強調語の取り方は移設元の loadCaptions と 1 バイトも変えない。
  // emphasis_words は「キーがあるか」で見る（明示 null を edit 側へ落とさないため）。
  const legacyDefaultTextStyle = Array.isArray(captionsRoot) ? undefined : captionsRoot.default_text_style;
  const legacyEmphasisWords = !Array.isArray(captionsRoot)
    && Object.prototype.hasOwnProperty.call(captionsRoot, "emphasis_words")
    ? captionsRoot.emphasis_words
    : edit.emphasis_words;
  // cuts が無い edit でも落ちないよう ?? [] は残す（render-cut では常に配列なので no-op、
  // gpu-export / osr-export の従来挙動と一致する）。
  const overlays = generateCaptionOverlays(captions, edit.cuts ?? [], {
    emphasisWords: legacyEmphasisWords,
    defaultTextStyle: legacyDefaultTextStyle,
    output: styleOutput,
    sourceCount: referencedCaptionSourceCount(edit),
    onWarning: warn,
  });
  return {
    captionsRoot,
    captions,
    layout: null,
    overlays,
    defaultTextStyle: legacyDefaultTextStyle ?? null,
    emphasisWords: legacyEmphasisWords ?? [],
    warnings,
  };
}

function emptyPlan() {
  return {
    captionsRoot: [],
    captions: [],
    layout: null,
    overlays: [],
    defaultTextStyle: null,
    emphasisWords: [],
    warnings: [],
  };
}

/**
 * 単語帳は同期解決。単語帳ファイルが無い・壊れている場合は resolveWordBookSync 自身が
 * layers[].error に畳んで entries だけ返すので、ここでは握り潰さない。
 * それ以外の失敗（creator root の解決不能など）は移設元と同じくそのまま投げる。
 */
function protectedTermsForProject(projectRoot) {
  if (typeof projectRoot !== "string" || projectRoot === "") return undefined;
  const { protectedTermsFrom, resolveWordBookSync } = require("../../word-book/src/index.mjs");
  return protectedTermsFrom(resolveWordBookSync({ projectRoot }).entries);
}

/**
 * display_policy の射影は「素材時間で連続する cuts」を前提にする。
 * 先頭から隙間なく並ぶ単純なタイムラインに限り at / track を落として素材時間軸へ正規化し、
 * そうでなければ edit をそのまま渡してカーネル側の検証に委ねる。
 * （render-cut.mjs の private 実装をここへ移設。4 経路が同じ正規化を通るようにするため）
 */
export function captionDisplayEdit(edit) {
  if (!Array.isArray(edit?.cuts)) return edit;
  let cursor = 0;
  for (const cut of edit.cuts) {
    if (!cut || typeof cut !== "object" || (cut.track ?? 0) !== 0
      || !Number.isFinite(cut.at) || Math.abs(cut.at - cursor) > 1e-6) return edit;
    const speed = Number.isFinite(cut.speed) && cut.speed > 0 ? cut.speed : 1;
    const freeze = Number.isFinite(cut.freeze?.duration_sec) && cut.freeze.duration_sec > 0 ? cut.freeze.duration_sec : 0;
    const overlap = Number.isFinite(cut.transition_out?.duration) && cut.transition_out.duration > 0 ? cut.transition_out.duration : 0;
    cursor = cut.at + (cut.out - cut.in) / speed + freeze - overlap;
  }
  const { timeline: _timeline, ...withoutTimeline } = edit;
  return {
    ...withoutTimeline,
    cuts: edit.cuts.map(({ at: _at, track: _track, ...cut }) => cut),
  };
}
