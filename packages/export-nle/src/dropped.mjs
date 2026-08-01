// 交換形式に移せないフィールドの棚卸し。黙って落とさない（no silent caps）。
// entry: { field, reason, hint } — report と CLI 出力の両方で使う。

export function collectBaseDropped(model) {
  const dropped = [];
  const push = (field, reason, hint) => dropped.push({ field, reason, hint });

  if (model.bgm?.ducking) {
    push(
      "audio.bgm.ducking",
      "サイドチェーンダッキングはレンダ時処理で交換形式に対応概念がない",
      "書き出し先で BGM トラックへ手動でダッキング（Premiere: Essential Sound / Resolve: Fairlight）を設定する",
    );
  }
  if (model.master) {
    push(
      "audio.master",
      "loudnorm / denoise はレンダ時処理で交換形式に移らない",
      "書き出し先のラウドネス正規化（-14 LUFS 目安）を使う",
    );
  }
  if (model.output?.look?.lut) {
    push(
      "output.look",
      "LUT 適用は交換形式で相互運用できる表現がない",
      `presets/luts の .cube を書き出し先で手動適用する（lut: ${model.output.look.lut}）`,
    );
  }
  for (const source of model.sources) {
    if (source.chroma_key) {
      push(
        `sources[${source.id}].chroma_key`,
        "クロマキーのパラメータ（similarity/blend）は ffmpeg 語彙で NLE と互換がない",
        "書き出し先のキーヤーを手動設定するか、アルファ付きに焼いてから読み込む",
      );
    }
  }
  for (const layer of model.layers) {
    if (layer.chroma_key) {
      push(
        `layers[${layer.id}].chroma_key`,
        "レイヤーのクロマキーは交換形式に移らない",
        "書き出し先のキーヤーを手動設定する",
      );
    }
  }
  if (model.direction) {
    push(
      "direction",
      "演出宣言（preset/intensity）は AKARI 固有の意味論で交換形式に対応概念がない",
      "レンダ済み出力を参照するか、書き出し先で演出を再現する",
    );
  }
  return dropped;
}
