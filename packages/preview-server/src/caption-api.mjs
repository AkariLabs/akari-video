import { resolveCaptionPlan } from '../../render-cut/src/caption-resolve.mjs';

/**
 * Resolve API payloads in Node. Browser clients only receive completed timeline cues.
 *
 * 前段（プリセット適用・除外フィルタ・単語帳・cuts 正規化）は render-cut の
 * resolveCaptionPlan が 4 経路ぶんの単一定義として持つ。ここはその上に
 * API 固有の 2 点だけを足す薄いアダプタ:
 *   - display_policy 未宣言なら captionsRoot をそのまま返す（契約 §1 の opt-in 互換）
 *   - edit.json が無ければ fail-loud（クライアントは未解決 captions.json へ退避する）
 *
 * editRoot は cuts 導出済みの renderer 互換 edit（readRenderEdit(...).edit）であること。
 * 生の v2 を渡すと resolveCaptionPlan が落とす（cuts が無いと display_cues が
 * 静かに 0 件になり、正常系と区別がつかないため）。
 */
export function resolveCaptionApiPayload(captionsRoot, editRoot, options = {}) {
  if (Array.isArray(captionsRoot) || !captionsRoot || typeof captionsRoot !== 'object'
      || captionsRoot.display_policy === undefined) {
    return captionsRoot;
  }
  if (!editRoot || typeof editRoot !== 'object') {
    throw new Error('edit.json is required to resolve caption display policy');
  }
  const plan = resolveCaptionPlan({
    captionsRoot,
    edit: editRoot,
    projectRoot: options.projectRoot,
    extraProtectedTerms: options.extra_protected_terms,
    output: options.output,
  });
  // display_policy 宣言済みなら layout は必ず解決される（null はカーネルの未宣言判定のみ）。
  return { ...plan.layout, captions: plan.layout.display_cues };
}
