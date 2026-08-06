// patch オブジェクト（src/core.mjs の buildDirectionPatch の出力）を実際の
// edit.json / captions.json オブジェクトへマージする。ここも純粋（引数のオブジェクトを書き換えず
// 新しいオブジェクトを返す）。ファイルの読み書きは bin/ 層が行う。

/**
 * patch を edit オブジェクトへ適用した新しい edit オブジェクトを返す（非破壊）。
 * @param {object} edit
 * @param {object} patch - buildDirectionPatch の戻り値
 */
export function applyPatchToEdit(edit, patch) {
  const next = structuredClone(edit);
  next.cuts = Array.isArray(next.cuts) ? next.cuts : [];

  const cut = next.cuts[patch.cut_index];
  if (!cut) throw new Error(`edit.json cuts[${patch.cut_index}] does not exist`);

  if (Array.isArray(patch.cut_patch.fx) && patch.cut_patch.fx.length > 0) {
    cut.fx = [...(Array.isArray(cut.fx) ? cut.fx : []), ...patch.cut_patch.fx];
  }
  if (patch.cut_patch.framing) cut.framing = patch.cut_patch.framing;
  if (patch.cut_patch.freeze) cut.freeze = patch.cut_patch.freeze;

  if (patch.lead_cut_patch) {
    const leadCut = next.cuts[patch.lead_cut_patch.cut_index];
    if (!leadCut) throw new Error(`edit.json cuts[${patch.lead_cut_patch.cut_index}] (lead cut) does not exist`);
    leadCut.transition_out = patch.lead_cut_patch.transition_out;
  }

  if (patch.output_patch) {
    next.output = { ...(next.output ?? {}), ...patch.output_patch };
  }

  if (patch.audio_sfx_patch) {
    next.audio = next.audio ?? {};
    next.audio.sfx = [...(Array.isArray(next.audio.sfx) ? next.audio.sfx : []), patch.audio_sfx_patch];
  }

  if (patch.emphasis_word_patch) {
    next.emphasis_words = [
      ...(Array.isArray(next.emphasis_words) ? next.emphasis_words : []),
      patch.emphasis_word_patch,
    ];
  }

  return next;
}

/**
 * patch のキャプション部分を captions ルートオブジェクト（{captions:[...], default_text_style?}）へ
 * 適用した新しいオブジェクトを返す（非破壊）。text が無い patch では captions を変更しない。
 * @param {object|null} captionsRoot - 既存の captions.json 内容。無ければ { captions: [] } 扱い
 * @param {object} patch
 */
export function applyPatchToCaptions(captionsRoot, patch) {
  const base = captionsRoot && typeof captionsRoot === 'object'
    ? structuredClone(captionsRoot)
    : { captions: [] };
  if (!Array.isArray(base.captions)) base.captions = [];
  if (patch.caption_patch) {
    base.captions = [...base.captions, patch.caption_patch];
  }
  return base;
}
