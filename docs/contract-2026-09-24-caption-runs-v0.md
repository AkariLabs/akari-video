# 字幕の文字範囲（runs）v0

- 日付: 2026-09-24
- 状態: v0

## 保存形

`captions.json` の各 caption に任意の `runs` を追加できる。既存フィールドは変更しない。

```json
{
  "text": "これは最高の案です",
  "runs": [{
    "from": 3, "to": 5, "role": "emphasis",
    "style": {
      "color": "#ff5a5f", "font_weight": 900, "scale": 1.3,
      "baseline_shift_em": -0.1, "rotate_deg": 8, "letter_spacing_em": 0.05,
      "italic": true, "underline": true,
      "stroke": { "color": "#000000", "width_px": 1 }
    },
    "animation": { "loop": { "id": "float" } }
  }]
}
```

`from` は含み、`to` は含まない。単位は Unicode 書記素（grapheme）で、`display_text` があればその文字列、なければ `text` を数える。`display_fragments` の行境界は範囲を切らず、描画時に各行へ投影する。空または範囲外の run は lint warning とし、描画では無視する。role は開いた文字列であり、`emphasis`、`keyword`、`aside` を推奨する。

## 合成と描画

後の run が先の run にフィールド単位で勝つ。`style` は字幕全体の `text_style` に相対的に重ねる。`scale` は文字の倍率、`baseline_shift_em` は正が下方向、`rotate_deg` は文字ごとの回転、`letter_spacing_em` は字間である。v0 の run style は例に挙げた 9 項目（`color`、`font_weight`、`scale`、`baseline_shift_em`、`rotate_deg`、`letter_spacing_em`、`stroke`、`italic`、`underline`）だけで、位置・座布団・影は持たない。

run の文字は `akari-caption__run` span として描き、必要な見た目だけを inline style に置く。run が無い caption の HTML は従来の描画経路をそのまま使う。既存の `emphasis_words` は時刻とプリセットを扱い、runs と併存する。同じ文字に両方かかる場合、run の style が優先する。`emphasis_words` を runs に移す処理は後続の版で扱う。

`animation` は textanim の `in` / `loop` / `out` スロットを予約する。v0 では描画しない。GPU 書き出しの字幕の動きは `gpu-export` の `page-runtime` が字幕単位に `captionMotionAt` を適用しており、run 単位の動きにはその層の変更が要る。プレビュー・OSR だけ先に動かすと 3 経路が一致しないため、同時に有効化する。

## 編集時の付け替え

文字の編集では、元と先の表示文字列の最小差分を書記素単位で計算する。差分より前の run は保持し、後の run は移動し、差分に掛かる run は伸縮する。全範囲が削除された run は除外する。字幕 split は境界で run を分け、merge は後続行のオフセットを足してつなぐ。

外れた run は edit-store の `updateCaptionFieldsInSourceWithReport` が `removedRuns` として返し、`captionRunsRemovedNotice` が通知文を作る。既存の `updateCaptionFieldsInSource` は文字列を返す契約を保つ。台本・インスペクター・プレビューの文字の書き換えから、`captionEditNotices` が `removedRuns` と `removedEmphasis` の通知文を作り、同じ文言の連続を 1 つにして右下の通知に出す。
